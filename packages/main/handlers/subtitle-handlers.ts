import path from 'path';
import fs from 'fs/promises';
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
} from '@shared-types/app';
import {
  addSubtitle,
  registerAutoCancel,
  finish as registryFinish,
} from '../active-processes.js';
import type { FFmpegContext } from '../services/ffmpeg-runner.js';
import {
  extractAudioSegment,
  mkTempAudioName,
} from '../services/subtitle-processing/audio-extractor.js';
import * as stage5Client from '../services/stage5-client.js';
import { transcribePass } from '../services/subtitle-processing/pipeline/transcribe-pass.js';

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

    const isCancel =
      controller.signal.aborted ||
      error.name === 'AbortError' ||
      error.message === 'Operation cancelled' ||
      /insufficient-credits|Insufficient credits/i.test(
        String(error?.message || '')
      );
    const creditCancel = /insufficient-credits|Insufficient credits/i.test(
      String(error?.message || '')
    );
    if (tempVideoPath && !isCancel) {
      await cleanupTempFile(tempVideoPath);
    }

    event.sender.send('generate-subtitles-progress', {
      percent: 100,
      stage: isCancel ? 'Process cancelled' : `Error: ${error.message}`,
      error: creditCancel
        ? 'insufficient-credits'
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
    });

    return {
      success: true,
      translatedSubtitles: result.subtitles,
      operationId,
    };
  } catch (error: any) {
    const isCancel =
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled' ||
      /insufficient-credits|Insufficient credits/i.test(
        String(error?.message || '')
      );
    const creditCancel = /insufficient-credits|Insufficient credits/i.test(
      String(error?.message || '')
    );
    // Emit a final progress event so renderer updates status appropriately
    try {
      event.sender.send('generate-subtitles-progress', {
        percent: 100,
        stage: isCancel
          ? 'Process cancelled'
          : `Error: ${error?.message || String(error)}`,
        error: creditCancel
          ? 'insufficient-credits'
          : isCancel
            ? undefined
            : error?.message || String(error),
        operationId,
      });
    } catch {
      // Do nothing
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
      stage: 'Starting...',
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
      stage: 'Beginning review...',
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
      stage: 'Completed',
      operationId,
    });

    return { success: true, translation, operationId };
  } catch (error: any) {
    const isCancel =
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled' ||
      /insufficient-credits|Insufficient credits/i.test(
        String(error?.message || '')
      );
    const creditCancel = /insufficient-credits|Insufficient credits/i.test(
      String(error?.message || '')
    );
    try {
      event.sender.send('generate-subtitles-progress', {
        percent: 100,
        stage: isCancel
          ? 'Process cancelled'
          : `Error: ${error?.message || String(error)}`,
        error: creditCancel
          ? 'insufficient-credits'
          : isCancel
            ? undefined
            : error?.message || String(error),
        operationId,
      });
    } catch {
      // Do nothing
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
    const LONG_SEGMENT_SEC = 20;

    let transcriptText = '';
    let segsOut: import('@shared-types/app').SrtSegment[] | undefined;

    if (baseDur >= LONG_SEGMENT_SEC) {
      // Segmentation path using full pipeline on sliced audio
      const pad = 0.2;
      const start = Math.max(0, baseStart - pad);
      const duration = baseDur + pad * 2;

      const baseName = mkTempAudioName(`${operationId}_slice`);
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
        start,
        duration,
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
      });
      const offset = start;
      segsOut = res.segments.map(s => ({
        ...s,
        start: s.start + offset,
        end: s.end + offset,
      })) as any;
      transcriptText = (segsOut || [])
        .map(s => String((s as any).original ?? ''))
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    } else {
      // Short segment: direct whisper with small padding retries
      const paddings = [0, 0.3, 0.6];
      for (let i = 0; i < paddings.length; i++) {
        const pad = paddings[i];
        const start = Math.max(0, baseStart - pad);
        const duration = baseDur + pad * 2;

        if (tempAudioPath) {
          try {
            await fs.unlink(tempAudioPath);
          } catch {
            // Do nothing
          }
          tempAudioPath = null;
        }
        const baseName = mkTempAudioName(`${operationId}_seg_${i}`);
        tempAudioPath = path.isAbsolute(baseName)
          ? baseName
          : path.join(ffmpeg.tempDir, baseName);

        event.sender.send('generate-subtitles-progress', {
          percent: 10 + i * 10,
          stage: 'Extracting audio segment...',
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
          percent: 25 + i * 20,
          stage: 'Transcribing 1/1',
          operationId,
        });
        // Retry the network transcription up to 3 attempts before moving on
        const resp: any = await (async () => {
          const maxAttempts = 3;
          let lastErr: any = null;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (controller.signal?.aborted) {
              throw new DOMException('Operation cancelled', 'AbortError');
            }
            try {
              return await stage5Client.transcribe({
                filePath: tempAudioPath,
                promptContext,
                signal: controller.signal,
              });
            } catch (err: any) {
              if (
                err?.name === 'AbortError' ||
                err?.message === 'insufficient-credits' ||
                /Insufficient credits/i.test(String(err?.message || err))
              ) {
                throw err;
              }
              lastErr = err;
              log.warn(
                `[${operationId}] One-line transcription attempt ${attempt}/${maxAttempts} failed: ${String(
                  err?.message || err
                )}`
              );
              if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, attempt * 300));
                continue;
              }
            }
          }
          if (lastErr) throw lastErr;
          return null;
        })();
        if (Array.isArray(resp?.segments) && resp.segments.length > 0) {
          transcriptText = resp.segments
            .map((s: any) => String(s?.text ?? ''))
            .join(' ');
        } else if (Array.isArray(resp?.words)) {
          transcriptText = resp.words
            .map((w: any) => String(w?.word ?? ''))
            .join(' ');
        }
        transcriptText = (transcriptText || '').replace(/\s{2,}/g, ' ').trim();
        if (transcriptText) break;
      }
    }

    event.sender.send('generate-subtitles-progress', {
      percent: 100,
      stage: 'Completed',
      operationId,
    });

    return {
      success: true,
      transcript: transcriptText,
      segments: segsOut,
      operationId,
    };
  } catch (error: any) {
    const isCancel =
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled' ||
      /insufficient-credits|Insufficient credits/i.test(
        String(error?.message || '')
      );
    const creditCancel = /insufficient-credits|Insufficient credits/i.test(
      String(error?.message || '')
    );
    try {
      event.sender.send('generate-subtitles-progress', {
        percent: 100,
        stage: isCancel
          ? 'Process cancelled'
          : `Error: ${error?.message || String(error)}`,
        error: creditCancel
          ? 'insufficient-credits'
          : isCancel
            ? undefined
            : error?.message || String(error),
        operationId,
      });
    } catch {
      // Do nothing
    }
    return {
      success: !isCancel,
      cancelled: isCancel,
      error: isCancel ? undefined : error?.message || String(error),
      operationId,
    };
  } finally {
    if (tempAudioPath) {
      try {
        await fs.unlink(tempAudioPath);
      } catch {
        // Do nothing
      }
    }
    registryFinish(operationId);
  }
}

export async function handleTranscribeRemaining(
  event: IpcMainInvokeEvent,
  options: { videoPath: string; start: number; end?: number },
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
    const isCancel =
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled' ||
      /insufficient-credits|Insufficient credits/i.test(
        String(error?.message || '')
      );
    const creditCancel = /insufficient-credits|Insufficient credits/i.test(
      String(error?.message || '')
    );
    try {
      event.sender.send('generate-subtitles-progress', {
        percent: 100,
        stage: isCancel
          ? 'Process cancelled'
          : `Error: ${error?.message || String(error)}`,
        error: creditCancel
          ? 'insufficient-credits'
          : isCancel
            ? undefined
            : error?.message || String(error),
        operationId,
      });
    } catch {
      // Do nothing
    }
    return {
      success: !isCancel,
      cancelled: isCancel,
      error: isCancel ? undefined : error?.message || String(error),
      operationId,
    };
  } finally {
    if (tempAudioPath) {
      try {
        await fs.unlink(tempAudioPath);
      } catch {
        // Do nothing
      }
    }
    registryFinish(operationId);
  }
}

export async function handleGetVideoMetadata(_event: any, filePath: string) {
  if (!ffmpegCtx) {
    log.error('[getVideoMetadata] FFmpegContext not initialized.');
    return { success: false, error: 'FFmpegContext not available.' };
  }
  try {
    const metadata = await ffmpegCtx.getVideoMetadata(filePath);
    return { success: true, metadata };
  } catch (error: any) {
    log.error(
      `[getVideoMetadata] Error getting metadata for ${filePath}:`,
      error
    );
    return {
      success: false,
      error: error.message || 'Failed to get video metadata.',
    };
  }
}
