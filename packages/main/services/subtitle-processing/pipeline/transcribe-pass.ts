import { FFmpegContext } from '../../ffmpeg-runner.js';
import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import log from 'electron-log';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { SubtitleProcessingError } from '../errors.js';
import { Stage } from './progress.js';
import { rebaseWordTimingsToSegment } from '../word-timing-normalization.js';
import { throwIfAborted, formatElevenLabsTimeRemaining } from '../utils.js';
import {
  transcribe as transcribeAi,
  getActiveProviderForAudio,
  assertTranscriptionAvailable,
  transcribeLargeFileViaR2,
} from '../../ai-provider.js';
import { STAGE5_SCRIBE_REQUEST_MODEL } from '../../stage5-client.js';
import {
  chooseScribeRoute,
  isCancellationError,
  runScribeWithRetries,
  transcriptionTooLargeError,
} from './scribe-runner.js';

/**
 * Transcribe one audio file with ElevenLabs Scribe. Transcription is
 * Scribe-only (OpenAI whisper-1 retires 2027-02-26): BYO ElevenLabs, or Stage5
 * credits via the direct relay (small/short audio) or the durable R2 flow
 * (large/long audio). There is no Whisper fallback; failures end the job with
 * a clear error.
 */
export async function transcribePass({
  audioPath,
  sourceMediaPath,
  durableRecoverySeed,
  services,
  progressCallback,
  operationId,
  signal,
}: {
  audioPath: string;
  sourceMediaPath?: string;
  durableRecoverySeed?: string;
  services: { ffmpeg: FFmpegContext };
  progressCallback?: GenerateProgressCallback;
  operationId: string;
  signal: AbortSignal;
}): Promise<{
  segments: SrtSegment[];
  speechIntervals: Array<{ start: number; end: number }>;
  transcriptionEngine: 'elevenlabs';
}> {
  const tempDir = path.dirname(audioPath);

  try {
    if (!services?.ffmpeg) {
      throw new SubtitleProcessingError('FFmpegContext is required.');
    }
    const { ffmpeg } = services;

    // API key mode without a usable BYO ElevenLabs key cannot transcribe
    // (an OpenAI key no longer can). Fail before any upload.
    assertTranscriptionAvailable();

    if (!fs.existsSync(audioPath)) {
      throw new SubtitleProcessingError(`Audio file not found: ${audioPath}`);
    }

    const duration = await ffmpeg.getMediaDuration(audioPath, signal);
    if (signal?.aborted) throw new Error('Cancelled');

    if (isNaN(duration) || duration <= 0) {
      throw new SubtitleProcessingError(
        'Unable to determine valid audio duration.'
      );
    }

    const audioStats = await fsp.stat(audioPath);
    const fileSizeMB = audioStats.size / (1024 * 1024);
    const route = chooseScribeRoute({
      useByoElevenLabs: getActiveProviderForAudio() === 'elevenlabs',
      fileSizeMB,
      durationSec: duration,
    });
    log.info(
      `[${operationId}] Scribe route=${route} (${fileSizeMB.toFixed(1)}MB, ${(duration / 60).toFixed(1)} min)`
    );

    if (route === 'stage5-too-large') {
      throw transcriptionTooLargeError();
    }

    const finalizeTranscriptionResult = async ({
      result,
      completionLogLabel,
    }: {
      result: any;
      completionLogLabel: string;
    }): Promise<{
      segments: SrtSegment[];
      speechIntervals: Array<{ start: number; end: number }>;
      transcriptionEngine: 'elevenlabs';
    }> => {
      const segments = (result?.segments || []) as Array<{
        id: number;
        start: number;
        end: number;
        text: string;
        words?: Array<{ word: string; start: number; end: number }>;
      }>;

      const srtSegments: SrtSegment[] = segments.map((seg, idx) => ({
        id: crypto.randomUUID(),
        index: idx + 1,
        start: seg.start,
        end: seg.end,
        original: seg.text?.trim() || '',
        words: rebaseWordTimingsToSegment(seg.words, seg.start, seg.end),
      }));

      const cleaned = srtSegments
        .filter(s => (s.original ?? '').trim() !== '')
        .sort((a, b) => a.start - b.start)
        .map((s, i) => ({
          ...s,
          index: i + 1,
          original: (s.original ?? '').replace(/\s{2,}/g, ' ').trim(),
        }));

      const finalSrt = buildSrt({ segments: cleaned, mode: 'original' });
      await fsp.writeFile(
        path.join(tempDir, `${operationId}_final.srt`),
        finalSrt,
        'utf8'
      );

      log.info(
        `[${operationId}] ✏️ ${completionLogLabel}: ${cleaned.length} segments`
      );

      progressCallback?.({ percent: 100, stage: '__i18n__:completed' });
      return {
        segments: cleaned,
        speechIntervals: [],
        transcriptionEngine: 'elevenlabs',
      };
    };

    const reportRetry = (attempt: number, maxAttempts: number) => {
      progressCallback?.({
        percent: Stage.TRANSCRIBE,
        stage: `__i18n__:transcription_retry:${attempt}:${maxAttempts}`,
      });
    };
    const runnerLog = {
      info: (msg: string) => log.info(`[${operationId}] ${msg}`),
      warn: (msg: string) => log.warn(`[${operationId}] ${msg}`),
    };

    // Direct Scribe: BYO ElevenLabs key, or small/short Stage5 audio.
    const transcribeDirect = async () => {
      log.info(
        `[${operationId}] Transcribing with ElevenLabs Scribe (${fileSizeMB.toFixed(1)}MB)`
      );

      // ElevenLabs processes at ~8x real-time, estimate completion time
      const durationMinutes = duration / 60;
      const bufferMultiplier = durationMinutes > 60 ? 1.5 : 1.2;
      const estimatedProcessingTime = (duration / 8) * bufferMultiplier;
      const startTime = Date.now();
      const progressInterval = setInterval(() => {
        if (signal?.aborted) {
          clearInterval(progressInterval);
          return;
        }

        const elapsed = (Date.now() - startTime) / 1000;
        const estimatedPercent = Math.min(
          95,
          Stage.TRANSCRIBE +
            (elapsed / estimatedProcessingTime) * (95 - Stage.TRANSCRIBE)
        );
        const remainingSec = Math.max(0, estimatedProcessingTime - elapsed);

        progressCallback?.({
          percent: Math.round(estimatedPercent),
          stage: formatElevenLabsTimeRemaining(remainingSec),
          phaseKey: 'transcribe_vendor',
          etaSeconds: Math.round(remainingSec),
        });
      }, 2000);

      progressCallback?.({
        percent: Stage.TRANSCRIBE,
        stage: formatElevenLabsTimeRemaining(estimatedProcessingTime),
        phaseKey: 'transcribe_vendor',
        etaSeconds: Math.round(estimatedProcessingTime),
      });

      try {
        const result = await transcribeAi({
          filePath: audioPath,
          model: STAGE5_SCRIBE_REQUEST_MODEL,
          durationSec: duration,
          // Use operationId as an idempotency key so retries can't double-bill.
          idempotencyKey: operationId,
          signal,
        });
        throwIfAborted(signal);
        return finalizeTranscriptionResult({
          result,
          completionLogLabel: 'ElevenLabs transcription complete',
        });
      } catch (error: any) {
        if (!isCancellationError(error, signal)) {
          log.warn(
            `[${operationId}] ElevenLabs transcription failed: ${error?.message || String(error)}`
          );
        }
        throw error;
      } finally {
        clearInterval(progressInterval);
      }
    };

    // Durable R2 flow for large or long Stage5 audio (up to the upload limit).
    const transcribeDurable = async () => {
      log.info(
        `[${operationId}] Using durable R2 transcription flow (${fileSizeMB.toFixed(1)}MB)`
      );
      progressCallback?.({
        percent: Stage.TRANSCRIBE,
        stage: '__i18n__:transcribing_r2_upload',
        phaseKey: 'upload_audio',
      });

      const result = await transcribeLargeFileViaR2({
        filePath: audioPath,
        // The durable client derives the server upload key from stable
        // recovery identity; operationId is only a per-run fallback.
        idempotencyKey: operationId,
        recoverySeed: durableRecoverySeed,
        recoverySourcePath: sourceMediaPath || audioPath,
        signal,
        durationSec: duration,
        onProgress: (stage, percent) => {
          progressCallback?.({
            percent: percent ?? Stage.TRANSCRIBE,
            stage: stage || '__i18n__:transcribing_elevenlabs_finishing',
            phaseKey: 'transcribe_vendor',
          });
        },
      });

      throwIfAborted(signal);
      return finalizeTranscriptionResult({
        result,
        completionLogLabel: 'Durable R2 transcription complete',
      });
    };

    return await runScribeWithRetries({
      run: route === 'stage5-r2' ? transcribeDurable : transcribeDirect,
      signal,
      label:
        route === 'stage5-r2'
          ? 'Durable R2 transcription'
          : 'ElevenLabs transcription',
      onRetry: reportRetry,
      log: runnerLog,
    });
  } catch (error: any) {
    console.error(
      `[${operationId}] Error in transcribePass:`,
      error?.message || error
    );
    const isCancel = isCancellationError(error, signal);

    progressCallback?.({
      percent: 100,
      stage: isCancel ? '__i18n__:process_cancelled' : '__i18n__:error',
      error: !isCancel ? error?.message || String(error) : undefined,
    });

    if (error instanceof SubtitleProcessingError || isCancel) {
      throw error;
    } else {
      throw new SubtitleProcessingError(error?.message || String(error));
    }
  }
}
