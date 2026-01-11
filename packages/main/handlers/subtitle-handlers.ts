import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import type { Stats } from 'fs';
import { IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';
import { FileManager } from '../services/file-manager.js';
import {
  extractSubtitlesFromMedia,
  translateSubtitlesFromSrt,
} from '../services/subtitle-processing/index.js';
import {
  translateBatch,
  reviewTranslationBatch,
} from '../services/subtitle-processing/translator.js';
import type { ReviewBatch } from '../services/subtitle-processing/types.js';
import {
  GenerateProgressCallback,
  GenerateSubtitlesOptions,
  DubSegmentPayload,
  DubSubtitlesOptions,
  TranscriptHighlight,
  HighlightCutProgress,
  CombinedHighlightCutProgress,
  CutCombinedHighlightsRequest,
  CutCombinedHighlightsResult,
} from '@shared-types/app';
import {
  addSubtitle,
  registerAutoCancel,
  finish as registryFinish,
} from '../active-processes.js';
import { ERROR_CODES } from '../../shared/constants/index.js';
import type { FFmpegContext, VideoMeta } from '../services/ffmpeg-runner.js';
import {
  extractAudioSegment,
  mkTempAudioName,
} from '../services/subtitle-processing/audio-extractor.js';
import { transcribePass } from '../services/subtitle-processing/pipeline/transcribe-pass.js';
import { generateTranscriptSummary } from '../services/subtitle-processing/summarizer.js';
import { generateDubbedMedia } from '../services/dubber.js';
import { synthesizeDub as synthesizeDubAi } from '../services/ai-provider.js';
import { voiceCloneDub } from '../services/stage5-client.js';
import {
  detectSpeechIntervals,
  normalizeSpeechIntervals,
  mergeAdjacentIntervals,
  chunkSpeechInterval,
} from '../services/subtitle-processing/audio-chunker.js';

let fileManagerInstance: FileManager | null = null;
let ffmpegCtx: FFmpegContext | null = null;

interface SubtitleHandlerServices {
  ffmpeg: FFmpegContext;
  fileManager: FileManager;
}

export function initializeSubtitleHandlers(
  services: SubtitleHandlerServices
): void {
  if (!services || !services.ffmpeg || !services.fileManager) {
    throw new Error(
      '[subtitle-handlers] Required services (ffmpeg, fileManager) not provided.'
    );
  }
  ffmpegCtx = services.ffmpeg;
  fileManagerInstance = services.fileManager;

  log.info('[handlers/subtitle-handlers.ts] Initialized!');
}

/**
 * Delete a temp file with retry logic for locked files (common on Windows).
 * Silently succeeds if file doesn't exist.
 */
async function safeDeleteTempFile(
  filePath: string,
  retries = 3,
  delayMs = 100
): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fs.unlink(filePath);
      return; // Success
    } catch (err: any) {
      if (err.code === 'ENOENT') return; // File already gone
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
      } else {
        log.warn(
          `[safeDeleteTempFile] Failed to delete ${filePath} after ${retries} attempts: ${err.message}`
        );
      }
    }
  }
}

function checkServicesInitialized(): {
  ffmpeg: FFmpegContext;
  fileManager: FileManager;
} {
  if (!ffmpegCtx || !fileManagerInstance) {
    throw new Error('[subtitle-handlers] Services not initialized before use.');
  }
  return {
    ffmpeg: ffmpegCtx,
    fileManager: fileManagerInstance,
  };
}

const SHORT_CLIP_WIDTH = 1080;
const SHORT_CLIP_HEIGHT = 1920;
const HIGHLIGHT_VIDEO_PRESET = 'superfast';
const HIGHLIGHT_VIDEO_CRF = 23;

function isVideoAlreadyVertical(meta: VideoMeta | null): boolean {
  if (!meta || !meta.width || !meta.height) return false;
  const ratio = meta.height / Math.max(meta.width, 1);
  return ratio >= 1.2;
}

export async function handleGenerateSubtitles(
  event: IpcMainInvokeEvent,
  options: GenerateSubtitlesOptions,
  operationId: string
): Promise<{
  success: boolean;
  subtitles?: string;
  cancelled?: boolean;
  error?: string;
  operationId: string;
}> {
  const { ffmpeg, fileManager } = checkServicesInitialized();

  log.info(`[handleGenerateSubtitles] Starting. Operation ID: ${operationId}`);

  let tempVideoPath: string | null = null;
  const finalOptions = { ...options };
  const controller = new AbortController();

  registerAutoCancel(operationId, event.sender, () => controller.abort());

  addSubtitle(operationId, controller);

  try {
    tempVideoPath = await maybeWriteTempVideo({
      finalOptions,
    });
    if (!finalOptions.videoPath) {
      throw new Error('Video path is required');
    }
    finalOptions.videoPath = path.normalize(finalOptions.videoPath);
    await fs.access(finalOptions.videoPath);

    const progressCallback: GenerateProgressCallback = progress => {
      event.sender.send('generate-subtitles-progress', {
        ...progress,
        operationId,
      });
    };

    const result = await extractSubtitlesFromMedia({
      options: finalOptions,
      operationId,
      signal: controller.signal,
      progressCallback,
      services: { ffmpeg, fileManager },
    });

    await cleanupTempFile(tempVideoPath);

    return { success: true, subtitles: result.subtitles, operationId };
  } catch (error: any) {
    log.error(`[${operationId}] Error generating subtitles:`, error);

    const errorMsg = String(error?.message || '');
    const creditCancel = errorMsg.includes(ERROR_CODES.INSUFFICIENT_CREDITS);
    const isCancel =
      controller.signal.aborted ||
      error.name === 'AbortError' ||
      error.message === 'Operation cancelled' ||
      creditCancel;
    if (tempVideoPath && !isCancel) {
      await cleanupTempFile(tempVideoPath);
    }

    event.sender.send('generate-subtitles-progress', {
      percent: 100,
      stage: isCancel ? 'Process cancelled' : `Error: ${error.message}`,
      error: creditCancel
        ? ERROR_CODES.INSUFFICIENT_CREDITS
        : isCancel
          ? undefined
          : error.message || String(error),
      cancelled: isCancel,
      operationId,
    });
    return {
      success: !isCancel,
      cancelled: isCancel,
      operationId,
    };
  } finally {
    registryFinish(operationId);
  }

  async function maybeWriteTempVideo({
    finalOptions,
  }: {
    finalOptions: GenerateSubtitlesOptions;
  }): Promise<string | null> {
    if (finalOptions.videoFile) {
      const safeName = finalOptions.videoFile.name.replace(
        /[^a-zA-Z0-9_.-]/g,
        '_'
      );
      const tempVideoPath = path.join(
        ffmpegCtx!.tempDir,
        `temp_generate_${Date.now()}_${safeName}`
      );

      const buffer = Buffer.from(await finalOptions.videoFile.arrayBuffer());
      await fs.writeFile(tempVideoPath, buffer);

      finalOptions.videoPath = tempVideoPath;
      delete finalOptions.videoFile;

      return tempVideoPath;
    }
    return null;
  }

  async function cleanupTempFile(tempVideoPath: string | null) {
    if (!tempVideoPath) return;
    try {
      await fs.unlink(tempVideoPath);
    } catch (err) {
      log.warn(`Failed to delete temp video file: ${tempVideoPath}`, err);
    }
  }
}

export async function handleTranslateSubtitles(
  event: IpcMainInvokeEvent,
  options: {
    subtitles: string;
    sourceLanguage?: string;
    targetLanguage: string;
    qualityTranslation?: boolean;
  },
  operationId: string
): Promise<{
  success: boolean;
  translatedSubtitles?: string;
  cancelled?: boolean;
  error?: string;
  operationId: string;
}> {
  const { ffmpeg, fileManager } = checkServicesInitialized();
  void ffmpeg; // not used for pure text translation
  void fileManager; // not used for pure text translation

  try {
    const controller = new AbortController();
    registerAutoCancel(operationId, event.sender, () => controller.abort());
    addSubtitle(operationId, controller);

    const result = await translateSubtitlesFromSrt({
      srtContent: options.subtitles,
      targetLanguage: options.targetLanguage,
      operationId,
      signal: controller.signal,
      progressCallback: progress => {
        event.sender.send('generate-subtitles-progress', {
          ...progress,
          operationId,
        });
      },
      fileManager,
      qualityTranslation: options.qualityTranslation,
    });

    return {
      success: true,
      translatedSubtitles: result.subtitles,
      operationId,
    };
  } catch (error: any) {
    const errorMsg = String(error?.message || '');
    const creditCancel = errorMsg.includes(ERROR_CODES.INSUFFICIENT_CREDITS);
    const isCancel =
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled' ||
      creditCancel;
    // Emit a final progress event so renderer updates status appropriately
    try {
      event.sender.send('generate-subtitles-progress', {
        percent: 100,
        stage: isCancel
          ? 'Process cancelled'
          : `Error: ${error?.message || String(error)}`,
        error: creditCancel
          ? ERROR_CODES.INSUFFICIENT_CREDITS
          : isCancel
            ? undefined
            : error?.message || String(error),
        operationId,
      });
    } catch (cbErr: any) {
      log.debug(
        `[${operationId}] Progress callback failed: ${cbErr?.message || cbErr}`
      );
    }
    return {
      success: !isCancel,
      cancelled: isCancel,
      error: isCancel ? undefined : error?.message || String(error),
      operationId,
    };
  } finally {
    registryFinish(operationId);
  }
}

export async function handleDubSubtitles(
  event: IpcMainInvokeEvent,
  options: DubSubtitlesOptions,
  operationId: string
): Promise<{
  success: boolean;
  audioPath?: string;
  videoPath?: string;
  cancelled?: boolean;
  error?: string;
  operationId: string;
}> {
  const { ffmpeg, fileManager } = checkServicesInitialized();

  if (!Array.isArray(options?.segments) || options.segments.length === 0) {
    return {
      success: false,
      error: 'No subtitle segments provided',
      operationId,
    };
  }

  const controller = new AbortController();
  registerAutoCancel(operationId, event.sender, () => controller.abort());
  addSubtitle(operationId, controller);

  let normalizedVideoPath: string | null = options.videoPath ?? null;
  if (normalizedVideoPath) {
    normalizedVideoPath = path.normalize(normalizedVideoPath);
    try {
      await fs.access(normalizedVideoPath);
    } catch (err) {
      log.warn(
        `[${operationId}] Provided video path is not accessible: ${normalizedVideoPath}`,
        err
      );
      normalizedVideoPath = null;
    }
  }

  if (!normalizedVideoPath) {
    return {
      success: false,
      error:
        'Video source is unavailable for dubbing. Please re-open the media.',
      operationId,
    };
  }

  const progressCallback: GenerateProgressCallback = progress => {
    try {
      event.sender.send('dub-subtitles-progress', {
        ...progress,
        operationId,
      });
    } catch (err) {
      log.warn(`[${operationId}] Failed to emit dubbing progress`, err);
    }
  };

  try {
    // Voice cloning path: use ElevenLabs Dubbing API for full workflow
    // Requires a real target language (not 'original') for translation
    if (
      options.useVoiceCloning &&
      options.targetLanguage &&
      options.targetLanguage !== 'original'
    ) {
      progressCallback({
        percent: 5,
        stage: 'Preparing voice cloning...',
        operationId,
      });

      if (!options.videoDurationSeconds || options.videoDurationSeconds <= 0) {
        throw new Error('Video duration is required for voice cloning');
      }

      const videoFileName = path.basename(normalizedVideoPath);
      const videoExt = path.extname(normalizedVideoPath).toLowerCase();
      const mimeType =
        videoExt === '.mp4'
          ? 'video/mp4'
          : videoExt === '.webm'
            ? 'video/webm'
            : videoExt === '.mov'
              ? 'video/quicktime'
              : 'video/mp4';

      progressCallback({
        percent: 10,
        stage: 'Uploading for voice cloning...',
        operationId,
      });

      const voiceCloningResult = await voiceCloneDub({
        file: {
          path: normalizedVideoPath,
          name: videoFileName,
          type: mimeType,
        },
        targetLanguage: options.targetLanguage,
        sourceLanguage: options.sourceLanguage,
        durationSeconds: options.videoDurationSeconds,
        dropBackgroundAudio: false, // Keep original background audio
        onProgress: (status, percent) => {
          progressCallback({
            percent: 10 + Math.round(percent * 0.8), // Scale 0-100 to 10-90
            stage: status,
            operationId,
          });
        },
        signal: controller.signal,
      });

      progressCallback({
        percent: 92,
        stage: 'Saving dubbed audio...',
        operationId,
      });

      // Save the returned audio to a temp file
      const audioBuffer = Buffer.from(voiceCloningResult.audioBase64, 'base64');
      const audioExt = voiceCloningResult.format || 'mp3';
      const audioPath = fileManager.getTempPath(
        `voice-clone-${operationId}.${audioExt}`
      );
      await fs.writeFile(audioPath, audioBuffer);

      progressCallback({
        percent: 95,
        stage: 'Merging with video...',
        operationId,
      });

      // Mux the dubbed audio with the original video
      const outputVideoPath = fileManager.getTempPath(
        `dubbed-${operationId}.mp4`
      );
      await ffmpeg.muxAudioIntoVideo(
        audioPath,
        normalizedVideoPath,
        outputVideoPath
      );

      progressCallback({
        percent: 100,
        stage: 'Voice cloning complete',
        operationId,
      });

      return {
        success: true,
        audioPath,
        videoPath: outputVideoPath,
        operationId,
      };
    }

    // Standard TTS dubbing path
    progressCallback({
      percent: 10,
      stage: 'Detecting speech segments...',
      operationId,
    });

    const preparedSegments = await buildDubSegmentsFromSpeech({
      sourceSegments: options.segments ?? [],
      videoPath: normalizedVideoPath,
      ffmpeg,
      signal: controller.signal,
      operationId,
    });

    if (!preparedSegments.length) {
      throw new Error('No dialogue detected for dubbing.');
    }

    progressCallback({
      percent: 18,
      stage: `Preparing ${preparedSegments.length} voice clips...`,
      operationId,
    });

    const result = await generateDubbedMedia({
      segments: preparedSegments,
      videoPath: normalizedVideoPath,
      voice: options.voice,
      quality: options.quality,
      ambientMix: options.ambientMix,
      targetLanguage: options.targetLanguage,
      operationId,
      signal: controller.signal,
      progressCallback,
      fileManager,
      ffmpeg,
    });

    progressCallback({
      percent: 100,
      stage: 'Dub generation complete',
      operationId,
    });

    return {
      success: true,
      audioPath: result.audioPath,
      videoPath: result.videoPath,
      operationId,
    };
  } catch (error: any) {
    const isCancel =
      controller.signal.aborted ||
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled';

    progressCallback({
      percent: 100,
      stage: isCancel
        ? 'Process cancelled'
        : `Error: ${error?.message || String(error)}`,
      operationId,
      error: isCancel ? undefined : error?.message || String(error),
    });

    return {
      success: false,
      cancelled: isCancel,
      error: isCancel ? undefined : error?.message || String(error),
      operationId,
    };
  } finally {
    registryFinish(operationId);
  }
}

async function buildDubSegmentsFromSpeech({
  sourceSegments,
  videoPath,
  ffmpeg,
  signal,
  operationId,
}: {
  sourceSegments: DubSegmentPayload[];
  videoPath: string;
  ffmpeg: FFmpegContext;
  signal: AbortSignal;
  operationId: string;
}): Promise<DubSegmentPayload[]> {
  if (!sourceSegments.length) {
    return [];
  }

  const MAX_UTTERANCE_DURATION = 20;

  let speechWindows: Array<{ start: number; end: number }> = [];
  try {
    const raw = await detectSpeechIntervals({
      inputPath: videoPath,
      operationId,
      signal,
      ffmpegPath: ffmpeg.ffmpegPath,
    });
    if (signal.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }
    const normalized = normalizeSpeechIntervals({ intervals: raw });
    const merged = mergeAdjacentIntervals(normalized, 0.25);
    speechWindows = merged.flatMap(iv =>
      iv.end - iv.start > MAX_UTTERANCE_DURATION
        ? chunkSpeechInterval({
            interval: iv,
            duration: MAX_UTTERANCE_DURATION,
          })
        : [iv]
    );
  } catch (err) {
    log.warn(
      `[${operationId}] Falling back to subtitle timings; VAD failed:`,
      err
    );
    speechWindows = [];
  }

  const sortedSpeech = speechWindows
    .filter(iv => iv.end - iv.start >= 0.12)
    .sort((a, b) => a.start - b.start);

  const sortedSubs = [...sourceSegments].sort(
    (a, b) => (a.start ?? 0) - (b.start ?? 0)
  );
  const tolerance = 0.15;
  const assignments = new Map<number, DubSegmentPayload[]>();
  sortedSpeech.forEach((_, idx) => assignments.set(idx, []));
  const leftovers: DubSegmentPayload[] = [];

  let intervalIdx = 0;
  for (const seg of sortedSubs) {
    const segStart = Number(seg.start ?? 0);
    const segEnd = Number(seg.end ?? segStart);
    const segMid = segStart + (segEnd - segStart) / 2;

    while (
      intervalIdx < sortedSpeech.length &&
      segMid > sortedSpeech[intervalIdx].end + tolerance
    ) {
      intervalIdx++;
    }

    let assigned = false;
    const candidates = [intervalIdx, intervalIdx - 1];
    for (const idx of candidates) {
      if (idx == null || idx < 0) continue;
      const interval = sortedSpeech[idx];
      if (!interval) continue;
      const overlaps =
        segEnd >= interval.start - tolerance &&
        segStart <= interval.end + tolerance;
      if (overlaps) {
        assignments.get(idx)?.push(seg);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      leftovers.push(seg);
    }
  }

  const normalizeText = (text?: string) =>
    text?.replace(/\s+/g, ' ').trim() ?? '';

  const aggregated: DubSegmentPayload[] = [];
  sortedSpeech.forEach((interval, idx) => {
    const bucket = assignments.get(idx) ?? [];
    if (!bucket.length) return;

    const textParts: string[] = [];
    const originalParts: string[] = [];
    bucket.forEach(seg => {
      const translated = normalizeText(seg.translation);
      if (translated) textParts.push(translated);
      const original = normalizeText(seg.original);
      if (original) originalParts.push(original);
    });

    let dialogueText = textParts.join(' ');
    if (!dialogueText) {
      dialogueText = originalParts.join(' ');
    }
    dialogueText = dialogueText.trim();
    if (!dialogueText) return;

    const bucketStarts = bucket
      .map(seg => (Number.isFinite(seg.start) ? Number(seg.start) : NaN))
      .filter(n => !Number.isNaN(n));
    const bucketEnds = bucket
      .map(seg => (Number.isFinite(seg.end) ? Number(seg.end) : NaN))
      .filter(n => !Number.isNaN(n));

    let mergedStart = interval.start;
    if (bucketStarts.length) {
      const earliest = Math.min(...bucketStarts);
      if (Number.isFinite(earliest)) {
        mergedStart = Math.max(interval.start, earliest);
      }
    }

    let mergedEnd = interval.end;
    if (bucketEnds.length) {
      const latest = Math.max(...bucketEnds);
      if (Number.isFinite(latest)) {
        mergedEnd = Math.max(interval.end, latest);
      }
    }
    if (!Number.isFinite(mergedStart) || mergedStart < 0)
      mergedStart = interval.start;
    if (!Number.isFinite(mergedEnd) || mergedEnd <= mergedStart) {
      mergedEnd = mergedStart + Math.max(0.01, interval.end - interval.start);
    }

    aggregated.push({
      start: mergedStart,
      end: mergedEnd,
      translation: dialogueText,
      original: originalParts.join(' '),
      targetDuration: Math.max(0.01, mergedEnd - mergedStart),
      index: aggregated.length + 1,
    });
  });

  leftovers.forEach(seg => {
    const text = normalizeText(seg.translation) || normalizeText(seg.original);
    if (!text) return;
    const start = Number(seg.start ?? 0);
    const end = Number(seg.end ?? start);
    aggregated.push({
      start,
      end,
      translation: text,
      original: normalizeText(seg.original),
      targetDuration: end > start ? end - start : undefined,
      index: aggregated.length + 1,
    });
  });

  const MIN_SEGMENT_DURATION = 0.6;
  const MAX_SEGMENT_DURATION = 20;
  const BASE_TEXT_DURATION = 0.55;
  const PER_WORD_DURATION = 0.17;
  const APPROX_CHARS_PER_WORD = 3;
  const SILENCE_BUFFER = 0.15;

  const computeDurationFloor = (text: string): number => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return MIN_SEGMENT_DURATION;
    }
    const words = normalized.split(' ').filter(Boolean).length;
    const charCount = normalized.replace(/\s+/g, '').length;
    const approxWords = Math.max(
      words,
      Math.ceil(charCount / APPROX_CHARS_PER_WORD)
    );
    const estimated =
      BASE_TEXT_DURATION + Math.max(0, approxWords - 1) * PER_WORD_DURATION;
    return Math.max(
      MIN_SEGMENT_DURATION,
      Math.min(MAX_SEGMENT_DURATION, estimated)
    );
  };

  const sortedAggregated = [...aggregated].sort((a, b) => a.start - b.start);
  const finalSegments: DubSegmentPayload[] = [];

  sortedAggregated.forEach((seg, idx) => {
    const translation = (seg.translation ?? '').replace(/\s+/g, ' ').trim();
    if (!translation) return;

    const original = (seg.original ?? '').replace(/\s+/g, ' ').trim();
    const baseStart = Number.isFinite(seg.start) ? Number(seg.start) : 0;
    const anchorStart = Math.max(0, baseStart);
    let start = anchorStart;
    const expectedDuration = seg.targetDuration ?? seg.end - seg.start;
    let duration = Math.max(MIN_SEGMENT_DURATION, expectedDuration || 0);
    const minDurationForText = computeDurationFloor(translation);
    const desiredDuration = Math.min(
      MAX_SEGMENT_DURATION,
      Math.max(duration, minDurationForText)
    );
    let end = start + duration;
    let extraNeeded = desiredDuration - duration;

    if (extraNeeded > 0) {
      const nextStart = sortedAggregated[idx + 1]?.start;
      let availableAfter = Number.POSITIVE_INFINITY;
      if (Number.isFinite(nextStart)) {
        availableAfter = Math.max(
          0,
          (nextStart as number) - SILENCE_BUFFER - end
        );
      }
      const extendAfter = Math.min(extraNeeded, availableAfter);
      if (extendAfter > 0) {
        duration += extendAfter;
        end = start + duration;
        extraNeeded -= extendAfter;
      }

      if (extraNeeded > 0 && !Number.isFinite(availableAfter)) {
        duration += extraNeeded;
        end = start + duration;
        extraNeeded = 0;
      }

      if (extraNeeded > 0) {
        const prevSegment = finalSegments[finalSegments.length - 1];
        const earliestStart = prevSegment
          ? Math.max(prevSegment.end + SILENCE_BUFFER, anchorStart)
          : anchorStart;
        const maxShiftEarlier = Math.max(0, start - earliestStart);
        const shiftEarlier = Math.min(extraNeeded, maxShiftEarlier);
        if (shiftEarlier > 0) {
          start -= shiftEarlier;
          duration += shiftEarlier;
          end = start + duration;
          extraNeeded -= shiftEarlier;
        }
      }

      if (extraNeeded > 0) {
        duration += extraNeeded;
        end = start + duration;
        extraNeeded = 0;
      }
    }

    finalSegments.push({
      start,
      end,
      translation,
      original,
      targetDuration: duration,
      index: idx + 1,
    });
  });

  log.info(
    `[${operationId}] Prepared ${finalSegments.length} dub segments from ${sortedSpeech.length} speech windows (source lines: ${sortedSubs.length}).`
  );

  return finalSegments;
}

export async function handleGenerateTranscriptSummary(
  event: IpcMainInvokeEvent,
  options: import('@shared-types/app').TranscriptSummaryRequest,
  operationId: string
): Promise<{
  success: boolean;
  summary?: string;
  highlights?: import('@shared-types/app').TranscriptHighlight[];
  sections?: import('@shared-types/app').TranscriptSummarySection[];
  error?: string;
  cancelled?: boolean;
  operationId: string;
}> {
  const controller = new AbortController();
  registerAutoCancel(operationId, event.sender, () => controller.abort());

  addSubtitle(operationId, controller);

  try {
    const { summary, sections, highlights } = await generateTranscriptSummary({
      segments: options.segments,
      targetLanguage: options.targetLanguage,
      signal: controller.signal,
      operationId,
      includeHighlights: options.includeHighlights !== false,
      effortLevel: options.effortLevel,
      progressCallback: progress => {
        event.sender.send('transcript-summary-progress', {
          ...progress,
          operationId,
        });
      },
    });

    return {
      success: true,
      summary,
      sections,
      highlights,
      operationId,
    };
  } catch (error: any) {
    const aborted =
      controller.signal.aborted ||
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled';

    const insufficientCredits =
      !aborted &&
      String(error?.message ?? '').includes(ERROR_CODES.INSUFFICIENT_CREDITS);

    event.sender.send('transcript-summary-progress', {
      percent: 100,
      stage: aborted ? 'cancelled' : 'error',
      error: insufficientCredits
        ? ERROR_CODES.INSUFFICIENT_CREDITS
        : error?.message,
      operationId,
    });

    if (insufficientCredits) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }

    if (aborted) {
      return { success: false, cancelled: true, operationId };
    }

    throw error;
  } finally {
    registryFinish(operationId);
  }
}

export async function handleCutHighlightClip(
  event: IpcMainInvokeEvent,
  options: import('@shared-types/app').CutHighlightClipRequest,
  operationId: string
): Promise<import('@shared-types/app').CutHighlightClipResult> {
  const controller = new AbortController();
  registerAutoCancel(operationId, event.sender, () => controller.abort());
  addSubtitle(operationId, controller);

  let resolvedHighlightId: string | undefined = options.highlight?.id;
  const emitHighlightProgress = (
    percent: number,
    stage: string,
    extra?: Partial<HighlightCutProgress>
  ) => {
    const safePercent = Math.max(0, Math.min(100, percent));
    const payload: HighlightCutProgress = {
      percent: safePercent,
      stage,
      operationId,
      highlightId: extra?.highlightId ?? resolvedHighlightId,
      ...extra,
    };
    event.sender.send('highlight-cut-progress', payload);
  };

  try {
    const { ffmpeg } = checkServicesInitialized();
    const videoPath = options.videoPath;
    const highlight = options.highlight;

    if (!videoPath) {
      throw new Error('video-path-missing');
    }
    if (!highlight) {
      throw new Error('highlight-missing');
    }

    await fs.access(videoPath);

    let totalDur = 0;
    let durationKnown = false;
    try {
      totalDur = await ffmpeg.getMediaDuration(videoPath, controller.signal);
      durationKnown = Number.isFinite(totalDur) && totalDur > 0;
    } catch (err) {
      log.warn(
        `[${operationId}] Highlight clip duration probe failed for ${videoPath}`,
        err
      );
    }

    let videoMeta: VideoMeta | null = null;
    try {
      videoMeta = await ffmpeg.getVideoMetadata(videoPath);
      if (
        !durationKnown &&
        Number.isFinite(videoMeta?.duration) &&
        (videoMeta?.duration ?? 0) > 0
      ) {
        totalDur = videoMeta!.duration;
        durationKnown = true;
      }
    } catch (err) {
      log.warn(`[${operationId}] Video metadata probe failed`, err);
    }

    // Only apply vertical cropping if aspectMode is 'vertical' (default) and video is not already vertical
    const aspectMode = options.aspectMode ?? 'vertical';
    const enforceVertical =
      aspectMode === 'vertical' && !isVideoAlreadyVertical(videoMeta);

    const sanitizedHighlight: TranscriptHighlight = {
      id: highlight.id,
      start: highlight.start,
      end: highlight.end,
      title: highlight.title,
      description: highlight.description,
      score: highlight.score,
      confidence: highlight.confidence,
      category: highlight.category,
      justification: highlight.justification,
    };
    resolvedHighlightId = sanitizedHighlight.id;

    const progressThrottleMs = 250;
    let lastProgressPercent = 5;
    let lastProgressAt = Date.now();

    emitHighlightProgress(lastProgressPercent, 'Preparing highlight clip');

    const rawStart = Number.isFinite(sanitizedHighlight.start)
      ? Math.max(0, Number(sanitizedHighlight.start))
      : 0;
    const fallbackEnd = rawStart + 30;
    const requestedEnd = Number.isFinite(sanitizedHighlight.end)
      ? Math.max(rawStart + 2, Number(sanitizedHighlight.end))
      : fallbackEnd;

    let safeStart = durationKnown
      ? Math.min(rawStart, Math.max(0, totalDur - 1))
      : rawStart;

    let safeEnd = durationKnown
      ? Math.min(Math.max(safeStart + 2, requestedEnd), totalDur)
      : Math.max(safeStart + 2, requestedEnd);

    if (!Number.isFinite(safeEnd) || safeEnd <= safeStart) {
      safeEnd = durationKnown
        ? Math.min(totalDur, safeStart + 15)
        : safeStart + 15;
    }

    const leadPadding = 0.35;
    const tailPadding = 0.45;
    safeStart = Math.max(0, safeStart - leadPadding);
    safeEnd = durationKnown
      ? Math.min(totalDur, safeEnd + tailPadding)
      : safeEnd + tailPadding;

    const duration = Math.max(2, safeEnd - safeStart);
    const fadeDuration = Math.min(0.6, Math.max(0.25, duration / 12));
    const fadeOutStart = Math.max(0.1, duration - fadeDuration);

    const outPath = path.join(
      ffmpeg.tempDir,
      `highlight-${operationId}-${Math.round(safeStart)}-${Math.round(safeEnd)}.mp4`
    );

    emitHighlightProgress(lastProgressPercent, 'Cutting highlight clip');
    const handleFfmpegProgress = (pct: number) => {
      if (!Number.isFinite(pct)) return;
      const clamped =
        pct >= 100 ? 99 : Math.max(0, Math.min(100, Math.round(pct)));
      const now = Date.now();
      if (clamped < lastProgressPercent) {
        return;
      }
      if (
        clamped === lastProgressPercent &&
        now - lastProgressAt < progressThrottleMs
      ) {
        return;
      }
      lastProgressPercent = clamped;
      lastProgressAt = now;
      emitHighlightProgress(clamped, 'Cutting highlight clip');
    };

    const args = [
      '-y',
      '-ss',
      String(safeStart),
      '-i',
      videoPath,
      '-t',
      String(duration),
    ];

    const filterParts: string[] = [];
    let currentLabel = '0:v:0';
    let filterLabelCounter = 0;
    const nextLabel = (prefix: string) => `${prefix}${++filterLabelCounter}`;

    if (enforceVertical) {
      const paddedLabel = nextLabel('pad');
      filterParts.push(
        `[${currentLabel}]scale=${SHORT_CLIP_WIDTH}:-2:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${SHORT_CLIP_WIDTH}:${SHORT_CLIP_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black[${paddedLabel}]`
      );
      currentLabel = paddedLabel;
    }

    const cleanup: string[] = [];
    try {
      await fs.mkdir(ffmpeg.tempDir, { recursive: true });
    } catch {
      // ignore mkdir errors; writeFile will throw if still unavailable
    }

    const needsVideoFade = duration > fadeDuration * 2;
    let audioFadeFilter: string | null = null;
    if (needsVideoFade) {
      const fadeLabel = nextLabel('fade');
      filterParts.push(
        `[${currentLabel}]fade=t=in:st=0:d=${fadeDuration.toFixed(
          2
        )},fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDuration.toFixed(2)}[${fadeLabel}]`
      );
      currentLabel = fadeLabel;
      audioFadeFilter = `afade=t=in:st=0:d=${fadeDuration.toFixed(
        2
      )},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDuration.toFixed(2)}`;
    }

    const requiresVideoFilter = filterParts.length > 0;
    if (requiresVideoFilter) {
      args.push(
        '-filter_complex',
        filterParts.join(';'),
        '-map',
        `[${currentLabel}]`
      );
    } else {
      args.push('-map', '0:v:0?');
    }

    args.push('-map', '0:a:0?');

    if (audioFadeFilter) {
      args.push('-af', audioFadeFilter);
    }

    if (requiresVideoFilter) {
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        HIGHLIGHT_VIDEO_PRESET,
        '-crf',
        String(HIGHLIGHT_VIDEO_CRF)
      );
    } else {
      args.push('-c:v', 'copy');
    }

    if (audioFadeFilter) {
      args.push('-c:a', 'aac', '-b:a', '128k');
    } else {
      args.push('-c:a', 'copy');
    }

    args.push('-movflags', '+faststart', outPath);

    try {
      await ffmpeg.run(args, {
        operationId,
        signal: controller.signal,
        totalDuration: duration,
        progress: handleFfmpegProgress,
      });
    } finally {
      await Promise.all(
        cleanup.map(temp => fs.unlink(temp).catch(() => void 0))
      );
    }

    const cutHighlight: TranscriptHighlight = {
      ...sanitizedHighlight,
      start: safeStart,
      end: safeEnd,
      videoPath: outPath,
    };

    emitHighlightProgress(100, 'ready', { highlight: cutHighlight });

    return {
      success: true,
      highlight: cutHighlight,
      operationId,
    };
  } catch (error: any) {
    const aborted =
      controller.signal.aborted ||
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled';

    const message = error?.message || 'Failed to cut highlight clip';

    emitHighlightProgress(100, aborted ? 'cancelled' : 'error', {
      error: message,
    });

    if (aborted) {
      return { success: false, cancelled: true, operationId };
    }
    throw error;
  } finally {
    registryFinish(operationId);
  }
}

/**
 * Check if a video file has at least one audio stream.
 */
async function hasAudioStream(
  videoPath: string,
  ffprobePath: string
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const p = spawn(ffprobePath, [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      videoPath,
    ]);
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('error', () => resolve(false));
    p.on('close', () => resolve(out.trim().length > 0));
  });
}

/**
 * Convert highlights to time ranges in user-defined order.
 * Applies lead padding to first segment and tail padding to last segment.
 */
function highlightsToSegments(
  highlights: TranscriptHighlight[],
  totalDur: number
): Array<{ start: number; end: number }> {
  if (highlights.length === 0) return [];

  const leadPadding = 0.35;
  const tailPadding = 0.45;

  return highlights.map((h, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === highlights.length - 1;

    let segStart = Math.max(0, h.start);
    let segEnd = Math.max(segStart + 0.5, h.end);

    if (isFirst) {
      segStart = Math.max(0, segStart - leadPadding);
    }
    if (isLast) {
      segEnd = totalDur > 0
        ? Math.min(totalDur, segEnd + tailPadding)
        : segEnd + tailPadding;
    }

    return { start: segStart, end: segEnd };
  });
}

export async function handleCutCombinedHighlights(
  event: IpcMainInvokeEvent,
  options: CutCombinedHighlightsRequest,
  operationId: string
): Promise<CutCombinedHighlightsResult> {
  const controller = new AbortController();
  registerAutoCancel(operationId, event.sender, () => controller.abort());
  addSubtitle(operationId, controller);

  const emitProgress = (
    percent: number,
    stage: string,
    extra?: Partial<CombinedHighlightCutProgress>
  ) => {
    const safePercent = Math.max(0, Math.min(100, percent));
    const payload: CombinedHighlightCutProgress = {
      percent: safePercent,
      stage,
      operationId,
      ...extra,
    };
    event.sender.send('combined-highlight-cut-progress', payload);
  };

  try {
    const { ffmpeg } = checkServicesInitialized();
    const videoPath = options.videoPath;
    const highlights = options.highlights;

    if (!videoPath) {
      throw new Error('video-path-missing');
    }
    if (!highlights || highlights.length < 2) {
      throw new Error('at-least-two-highlights-required');
    }

    await fs.access(videoPath);

    emitProgress(5, 'Preparing combined clip');

    // Get video duration
    let totalDur = 0;
    let durationKnown = false;
    try {
      totalDur = await ffmpeg.getMediaDuration(videoPath, controller.signal);
      durationKnown = Number.isFinite(totalDur) && totalDur > 0;
    } catch (err) {
      log.warn(
        `[${operationId}] Combined clip duration probe failed for ${videoPath}`,
        err
      );
    }

    // Get video metadata for aspect ratio
    let videoMeta: VideoMeta | null = null;
    try {
      videoMeta = await ffmpeg.getVideoMetadata(videoPath);
      if (
        !durationKnown &&
        Number.isFinite(videoMeta?.duration) &&
        (videoMeta?.duration ?? 0) > 0
      ) {
        totalDur = videoMeta!.duration;
        durationKnown = true;
      }
    } catch (err) {
      log.warn(`[${operationId}] Video metadata probe failed`, err);
    }

    const aspectMode = options.aspectMode ?? 'vertical';
    const enforceVertical =
      aspectMode === 'vertical' && !isVideoAlreadyVertical(videoMeta);

    // Check if video has audio stream
    const hasAudio = await hasAudioStream(videoPath, ffmpeg.ffprobePath);

    // Convert highlights to segments in user-defined order
    const segments = highlightsToSegments(highlights, totalDur);
    if (segments.length === 0) {
      throw new Error('no-valid-segments');
    }

    log.info(
      `[${operationId}] Combined highlights: ${highlights.length} highlights → ${segments.length} segments`
    );

    emitProgress(10, 'Building combined clip');

    // Calculate total combined duration for progress
    let totalCombinedDuration = 0;
    for (const seg of segments) {
      totalCombinedDuration += seg.end - seg.start;
    }

    // Build FFmpeg filter chain with trim+concat
    const videoFilters: string[] = [];
    const audioFilters: string[] = [];
    const concatVideoInputs: string[] = [];
    const concatAudioInputs: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const safeStart = Math.max(0, seg.start);
      const safeEnd = durationKnown ? Math.min(totalDur, seg.end) : seg.end;

      // Video trim + scale/pad
      let vFilter = `[0:v]trim=start=${safeStart.toFixed(3)}:end=${safeEnd.toFixed(3)},setpts=PTS-STARTPTS`;
      if (enforceVertical) {
        vFilter += `,scale=${SHORT_CLIP_WIDTH}:-2:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${SHORT_CLIP_WIDTH}:${SHORT_CLIP_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`;
      }
      vFilter += `[v${i}]`;
      videoFilters.push(vFilter);
      concatVideoInputs.push(`[v${i}]`);

      // Audio trim (only if video has audio)
      if (hasAudio) {
        audioFilters.push(
          `[0:a]atrim=start=${safeStart.toFixed(3)}:end=${safeEnd.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
        );
        concatAudioInputs.push(`[a${i}]`);
      }
    }

    // Concat all segments (with or without audio)
    const concatFilter = hasAudio
      ? `${concatVideoInputs.join('')}${concatAudioInputs.join('')}concat=n=${segments.length}:v=1:a=1[outv][outa]`
      : `${concatVideoInputs.join('')}concat=n=${segments.length}:v=1:a=0[outv]`;

    const filterComplex = hasAudio
      ? [...videoFilters, ...audioFilters, concatFilter].join(';')
      : [...videoFilters, concatFilter].join(';');

    const outPath = path.join(ffmpeg.tempDir, `combined-${operationId}.mp4`);

    const args = [
      '-y',
      '-i',
      videoPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[outv]',
      ...(hasAudio ? ['-map', '[outa]'] : []),
      '-c:v',
      'libx264',
      '-preset',
      HIGHLIGHT_VIDEO_PRESET,
      '-crf',
      String(HIGHLIGHT_VIDEO_CRF),
      ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : []),
      '-movflags',
      '+faststart',
      outPath,
    ];

    const progressThrottleMs = 250;
    let lastProgressPercent = 10;
    let lastProgressAt = Date.now();

    const handleFfmpegProgress = (pct: number) => {
      if (!Number.isFinite(pct)) return;
      // Map FFmpeg progress (0-100) to our range (10-99)
      const mapped = 10 + pct * 0.89;
      const clamped = Math.max(10, Math.min(99, Math.round(mapped)));
      const now = Date.now();
      if (clamped <= lastProgressPercent) return;
      if (now - lastProgressAt < progressThrottleMs) return;
      lastProgressPercent = clamped;
      lastProgressAt = now;
      emitProgress(clamped, 'Cutting combined highlights');
    };

    emitProgress(10, 'Cutting combined highlights');

    await ffmpeg.run(args, {
      operationId,
      signal: controller.signal,
      totalDuration: totalCombinedDuration,
      progress: handleFfmpegProgress,
    });

    emitProgress(100, 'ready');

    return {
      success: true,
      videoPath: outPath,
      operationId,
    };
  } catch (error: any) {
    const aborted =
      controller.signal.aborted ||
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled';

    const message = error?.message || 'Failed to cut combined highlights';

    emitProgress(100, aborted ? 'cancelled' : 'error', {
      error: message,
    });

    if (aborted) {
      return { success: false, cancelled: true, operationId };
    }
    throw error;
  } finally {
    registryFinish(operationId);
  }
}

export async function previewDubVoice({
  voice,
  text,
}: {
  voice: string;
  text?: string;
}): Promise<{
  success: boolean;
  audioBase64?: string;
  format?: string;
  error?: string;
}> {
  const phrase = (text ?? 'Hello').trim() || 'Hello';
  try {
    const result = await synthesizeDubAi({
      segments: [
        {
          index: 1,
          start: 0,
          end: 1.5,
          translation: phrase,
          original: phrase,
        },
      ],
      voice,
      quality: 'standard',
    });

    const audioBase64 =
      result.segments?.[0]?.audioBase64 ?? result.audioBase64 ?? null;
    if (!audioBase64) {
      return {
        success: false,
        error: 'Preview synthesis returned no audio',
      };
    }

    return {
      success: true,
      audioBase64,
      format: result.format ?? 'mp3',
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

export async function handleTranslateOneLine(
  event: IpcMainInvokeEvent,
  options: {
    segment: import('@shared-types/app').SrtSegment;
    contextBefore?: import('@shared-types/app').SrtSegment[];
    contextAfter?: import('@shared-types/app').SrtSegment[];
    targetLanguage: string;
  },
  operationId: string
): Promise<{
  success: boolean;
  translation?: string;
  cancelled?: boolean;
  error?: string;
  operationId: string;
}> {
  const controller = new AbortController();
  registerAutoCancel(operationId, event.sender, () => controller.abort());
  addSubtitle(operationId, controller);

  try {
    const seg = options.segment;
    const ctxBefore = options.contextBefore ?? [];
    const ctxAfter = options.contextAfter ?? [];

    // Initial progress
    event.sender.send('generate-subtitles-progress', {
      percent: 0,
      stage: '__i18n__:starting',
      operationId,
    });

    // 1) Rough translation
    const rough = await translateBatch({
      batch: {
        segments: [seg],
        startIndex: 0,
        endIndex: 1,
        contextBefore: [],
        contextAfter: [],
        targetLang: options.targetLanguage,
      },
      targetLang: options.targetLanguage,
      operationId,
      signal: controller.signal,
    });

    event.sender.send('generate-subtitles-progress', {
      percent: 40,
      stage: 'Translating 1/1',
      operationId,
      partialResult: '',
    });

    // Indicate review is about to begin for clearer UX
    event.sender.send('generate-subtitles-progress', {
      percent: 60,
      stage: '__i18n__:reviewing_range:1:1:1',
      operationId,
    });

    // 2) Review with context to improve quality
    const reviewBatch: ReviewBatch = {
      segments: rough,
      startIndex: 0,
      endIndex: rough.length,
      targetLang: options.targetLanguage,
      contextBefore: ctxBefore,
      contextAfter: ctxAfter,
    };
    const reviewed = await reviewTranslationBatch({
      batch: reviewBatch,
      operationId,
      signal: controller.signal,
    });

    const translation = (reviewed[0]?.translation ?? '').trim();

    event.sender.send('generate-subtitles-progress', {
      percent: 100,
      stage: '__i18n__:completed',
      operationId,
    });

    return { success: true, translation, operationId };
  } catch (error: any) {
    const errorMsg = String(error?.message || '');
    const creditCancel = errorMsg.includes(ERROR_CODES.INSUFFICIENT_CREDITS);
    const isCancel =
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled' ||
      creditCancel;
    try {
      event.sender.send('generate-subtitles-progress', {
        percent: 100,
        stage: isCancel ? '__i18n__:process_cancelled' : '__i18n__:error',
        error: creditCancel
          ? ERROR_CODES.INSUFFICIENT_CREDITS
          : isCancel
            ? undefined
            : error?.message || String(error),
        operationId,
      });
    } catch (cbErr: any) {
      log.debug(
        `[${operationId}] Progress callback failed: ${cbErr?.message || cbErr}`
      );
    }
    return {
      success: !isCancel,
      cancelled: isCancel,
      error: isCancel ? undefined : error?.message || String(error),
      operationId,
    };
  } finally {
    registryFinish(operationId);
  }
}

export async function handleTranscribeOneLine(
  event: IpcMainInvokeEvent,
  options: {
    videoPath: string;
    segment: { start: number; end: number };
    promptContext?: string;
  },
  operationId: string
): Promise<{
  success: boolean;
  transcript?: string;
  segments?: import('@shared-types/app').SrtSegment[];
  cancelled?: boolean;
  error?: string;
  operationId: string;
}> {
  const { ffmpeg } = checkServicesInitialized();

  const controller = new AbortController();
  registerAutoCancel(operationId, event.sender, () => controller.abort());
  addSubtitle(operationId, controller);

  let tempAudioPath: string | null = null;
  try {
    const { videoPath, segment, promptContext } = options;
    if (!videoPath || !segment || segment.end <= segment.start) {
      throw new Error('Invalid transcribe-one-line options');
    }
    const baseStart = Math.max(0, segment.start);
    const baseDur = Math.max(0.05, segment.end - segment.start);
    const pad = 0.2;
    const start = Math.max(0, baseStart - pad);
    const duration = baseDur + pad * 2;

    const baseName = mkTempAudioName(`${operationId}_slice_fill`);
    tempAudioPath = path.isAbsolute(baseName)
      ? baseName
      : path.join(ffmpeg.tempDir, baseName);

    event.sender.send('generate-subtitles-progress', {
      percent: 10,
      stage: '__i18n__:extracting_audio',
      operationId,
    });
    await extractAudioSegment(ffmpeg, {
      input: videoPath,
      output: tempAudioPath,
      start,
      duration,
      operationId,
      signal: controller.signal,
    });

    event.sender.send('generate-subtitles-progress', {
      percent: 30,
      stage: '__i18n__:transcribing_of:1:1',
      operationId,
    });

    const res = await transcribePass({
      audioPath: tempAudioPath,
      services: { ffmpeg },
      progressCallback: p => {
        const mapped = Math.min(95, Math.max(35, p.percent));
        // Do NOT forward partialResult for one-line transcribe to avoid replacing the entire store
        event.sender.send('generate-subtitles-progress', {
          percent: mapped,
          stage: p.stage,
          current: p.current,
          total: p.total,
          operationId,
        });
      },
      operationId,
      signal: controller.signal,
      promptContext,
    });
    const offset = start;
    const segsOut = res.segments.map(s => ({
      ...s,
      start: s.start + offset,
      end: s.end + offset,
    })) as any;
    const transcriptText = (segsOut || [])
      .map((s: any) => String((s as any).original ?? ''))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    event.sender.send('generate-subtitles-progress', {
      percent: 100,
      stage: '__i18n__:completed',
      operationId,
    });

    return {
      success: true,
      transcript: transcriptText,
      segments: segsOut,
      operationId,
    };
  } catch (error: any) {
    const errorMsg = String(error?.message || '');
    const creditCancel = errorMsg.includes(ERROR_CODES.INSUFFICIENT_CREDITS);
    const isCancel =
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled' ||
      creditCancel;
    try {
      event.sender.send('generate-subtitles-progress', {
        percent: 100,
        stage: isCancel ? '__i18n__:process_cancelled' : '__i18n__:error',
        error: creditCancel
          ? ERROR_CODES.INSUFFICIENT_CREDITS
          : isCancel
            ? undefined
            : error?.message || String(error),
        operationId,
      });
    } catch (cbErr: any) {
      log.debug(
        `[${operationId}] Progress callback failed: ${cbErr?.message || cbErr}`
      );
    }
    return {
      success: !isCancel,
      cancelled: isCancel,
      error: isCancel ? undefined : error?.message || String(error),
      operationId,
    };
  } finally {
    if (tempAudioPath) {
      await safeDeleteTempFile(tempAudioPath);
    }
    registryFinish(operationId);
  }
}

export async function handleTranscribeRemaining(
  event: IpcMainInvokeEvent,
  options: {
    videoPath: string;
    start: number;
    end?: number;
    qualityTranscription?: boolean;
  },
  operationId: string
): Promise<{
  success: boolean;
  segments?: import('@shared-types/app').SrtSegment[];
  cancelled?: boolean;
  error?: string;
  operationId: string;
}> {
  const { ffmpeg } = checkServicesInitialized();

  const controller = new AbortController();
  registerAutoCancel(operationId, event.sender, () => controller.abort());
  addSubtitle(operationId, controller);

  let tempAudioPath: string | null = null;
  try {
    const { videoPath, start, end } = options;
    if (!videoPath || typeof start !== 'number') {
      throw new Error('Invalid transcribe-remaining options');
    }
    const durationFull = await ffmpeg.getMediaDuration(
      videoPath,
      controller.signal
    );
    const sliceStart = Math.max(0, start);
    const sliceEnd =
      typeof end === 'number' ? Math.min(end, durationFull) : durationFull;
    const sliceDur = Math.max(0, sliceEnd - sliceStart);
    if (sliceDur <= 0.05) {
      return { success: true, segments: [], operationId };
    }

    const baseName = mkTempAudioName(`${operationId}_tail`);
    tempAudioPath = path.isAbsolute(baseName)
      ? baseName
      : path.join(ffmpeg.tempDir, baseName);

    event.sender.send('generate-subtitles-progress', {
      percent: 10,
      stage: 'Extracting audio segment...',
      operationId,
    });
    await extractAudioSegment(ffmpeg, {
      input: videoPath,
      output: tempAudioPath,
      start: sliceStart,
      duration: sliceDur,
      operationId,
      signal: controller.signal,
    });

    event.sender.send('generate-subtitles-progress', {
      percent: 30,
      stage: 'Transcribing 1/1',
      operationId,
    });

    const res = await transcribePass({
      audioPath: tempAudioPath,
      services: { ffmpeg },
      progressCallback: p => {
        const mapped = Math.min(95, Math.max(35, p.percent));
        // Forward partialResult with an absolute time offset so renderer can append tail incrementally
        event.sender.send('generate-subtitles-progress', {
          percent: mapped,
          stage: p.stage,
          current: p.current,
          total: p.total,
          partialResult: (p as any).partialResult,
          operationId,
          startOffset: sliceStart,
          tailMode: true,
        });
      },
      operationId,
      signal: controller.signal,
      qualityTranscription: options?.qualityTranscription ?? false,
    });

    const segsOut = res.segments.map(s => ({
      ...s,
      start: s.start + sliceStart,
      end: s.end + sliceStart,
    })) as any;

    event.sender.send('generate-subtitles-progress', {
      percent: 100,
      stage: 'Completed',
      operationId,
    });
    return { success: true, segments: segsOut, operationId };
  } catch (error: any) {
    const errorMsg = String(error?.message || '');
    const creditCancel = errorMsg.includes(ERROR_CODES.INSUFFICIENT_CREDITS);
    const isCancel =
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled' ||
      creditCancel;
    try {
      event.sender.send('generate-subtitles-progress', {
        percent: 100,
        stage: isCancel
          ? 'Process cancelled'
          : `Error: ${error?.message || String(error)}`,
        error: creditCancel
          ? ERROR_CODES.INSUFFICIENT_CREDITS
          : isCancel
            ? undefined
            : error?.message || String(error),
        operationId,
      });
    } catch (cbErr: any) {
      log.debug(
        `[${operationId}] Progress callback failed: ${cbErr?.message || cbErr}`
      );
    }
    return {
      success: !isCancel,
      cancelled: isCancel,
      error: isCancel ? undefined : error?.message || String(error),
      operationId,
    };
  } finally {
    if (tempAudioPath) {
      await safeDeleteTempFile(tempAudioPath);
    }
    registryFinish(operationId);
  }
}

export async function handleGetVideoMetadata(_event: any, filePath: string) {
  if (!ffmpegCtx) {
    log.error('[getVideoMetadata] FFmpegContext not initialized.');
    return { success: false, error: 'FFmpegContext not available.' };
  }

  let statInfo: Stats | null = null;
  try {
    statInfo = await fs.stat(filePath);
  } catch (statError: any) {
    log.warn(
      `[getVideoMetadata] Failed to stat ${filePath}:`,
      statError?.message || statError
    );
  }

  if (isLikelyICloudPlaceholder(statInfo)) {
    log.warn(
      `[getVideoMetadata] ${filePath} appears to be an iCloud placeholder (size=${statInfo?.size}, blocks=${(statInfo as any)?.blocks ?? 'n/a'})`
    );
    return {
      success: false,
      error: 'File is still downloading from iCloud.',
      code: 'icloud-placeholder',
    };
  }

  try {
    const metadata = await ffmpegCtx.getVideoMetadata(filePath);
    return { success: true, metadata };
  } catch (error: any) {
    log.error(
      `[getVideoMetadata] Error getting metadata for ${filePath}:`,
      error
    );
    if (!statInfo) {
      try {
        statInfo = await fs.stat(filePath);
      } catch {
        // ignore second stat failure
      }
    }

    const details: string | undefined =
      typeof error?.details === 'string' ? error.details : undefined;
    const placeholderAfterError = isLikelyICloudPlaceholder(statInfo);
    const code = placeholderAfterError ? 'icloud-placeholder' : 'probe-error';
    let message: string;

    if (placeholderAfterError) {
      message = 'File is still downloading from iCloud.';
    } else if (code === 'probe-error') {
      message =
        'Unable to analyse video metadata. Please ensure the file is fully downloaded and accessible, then try again.';
    } else {
      message = error?.message || 'Failed to get video metadata.';
    }

    return {
      success: false,
      error: message,
      code,
      details,
    };
  }
}

function isLikelyICloudPlaceholder(stat: Stats | null): boolean {
  if (!stat) return false;
  if (process.platform !== 'darwin') return false;
  if (typeof (stat as any).blocks !== 'number') return false;
  if (stat.isDirectory()) return false;
  if (stat.size <= 0) return false;
  return (stat as any).blocks === 0;
}
