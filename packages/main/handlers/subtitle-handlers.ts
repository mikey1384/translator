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
  DubSegmentPayload,
  DubSubtitlesOptions,
  TranscriptHighlight,
  StylizeHighlightRequest,
  StylizeHighlightResult,
  StylizeHighlightProgress,
  GenerateSubtitlesResult,
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
import { transcribePass } from '../services/subtitle-processing/pipeline/transcribe-pass.js';
import { generateTranscriptSummary } from '../services/subtitle-processing/summarizer.js';
import { generateDubbedMedia } from '../services/dubber.js';
import { synthesizeDub as synthesizeDubAi } from '../services/ai-provider.js';
import {
  detectSpeechIntervals,
  normalizeSpeechIntervals,
  mergeAdjacentIntervals,
  chunkSpeechInterval,
} from '../services/subtitle-processing/audio-chunker.js';
import {
  DEFAULT_STYLIZED_CAPTION_STYLE,
  renderStylizedHighlight,
} from '../services/highlight-stylizer.js';

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

function extractHighlightScore(
  highlight: TranscriptHighlight | undefined
): number {
  if (!highlight) return 0;
  if (Number.isFinite(highlight.score ?? null)) {
    return highlight.score as number;
  }
  if (Number.isFinite(highlight.confidence ?? null)) {
    return (highlight.confidence as number) * 100;
  }
  return 0;
}

function resolveHighlightLimit(value?: number | null): number {
  if (!Number.isFinite(value ?? null)) {
    return 10;
  }
  const numeric = Math.floor(value as number);
  return Math.max(0, numeric);
}

type GenerateSubtitlesHandlerResult = GenerateSubtitlesResult & {
  operationId: string;
};

export async function handleGenerateSubtitles(
  event: IpcMainInvokeEvent,
  options: GenerateSubtitlesOptions,
  operationId: string
): Promise<GenerateSubtitlesHandlerResult> {
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

    try {
      const segs: any[] = (result as any)?.segments || [];
      const withOrig = segs.filter(
        s =>
          Array.isArray((s as any)?.origWords) &&
          (s as any).origWords.length > 0
      ).length;
      log.info(
        `[handleGenerateSubtitles ${operationId}] Returned segments=${segs.length}, withOrigWords=${withOrig}`
      );
    } catch {
      // Do nothing
    }
    return {
      success: true,
      subtitles: result.subtitles,
      segments: result.segments,
      speechIntervals: result.speechIntervals,
      operationId,
    };
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
      success: false,
      cancelled: isCancel,
      operationId,
      error: creditCancel
        ? 'insufficient-credits'
        : error?.message || String(error),
    } as any;
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
  options: {
    segments: { start: number; end: number; text: string }[];
    targetLanguage: string;
    videoPath?: string | null;
    maxHighlights?: number;
  },
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
    const { ffmpeg } = checkServicesInitialized();
    const highlightLimit = resolveHighlightLimit(options.maxHighlights);
    const { summary, highlights, sections } = await generateTranscriptSummary({
      segments: options.segments,
      targetLanguage: options.targetLanguage,
      signal: controller.signal,
      operationId,
      maxHighlights: highlightLimit,
      progressCallback: progress => {
        event.sender.send('transcript-summary-progress', {
          ...progress,
          operationId,
        });
      },
    });

    let cutHighlights:
      | import('@shared-types/app').TranscriptHighlight[]
      | undefined = undefined;

    if (
      highlightLimit > 0 &&
      Array.isArray(highlights) &&
      highlights.length > 0
    ) {
      cutHighlights = [];
      const inputVideo = options.videoPath || null;
      const toCut = [...highlights]
        .sort((a, b) => {
          const scoreA = extractHighlightScore(a);
          const scoreB = extractHighlightScore(b);
          if (scoreA !== scoreB) {
            return scoreB - scoreA;
          }
          return a.start - b.start;
        })
        .slice(0, Math.min(highlightLimit, highlights.length));

      if (inputVideo) {
        let totalDur = 0;
        let durationKnown = false;
        let videoAvailable = true;

        try {
          await fs.access(inputVideo);
          totalDur = await ffmpeg.getMediaDuration(
            inputVideo,
            controller.signal
          );
          durationKnown = Number.isFinite(totalDur) && totalDur > 0;
        } catch (err) {
          videoAvailable = false;
          log.warn(
            `[${operationId}] Highlight clipping skipped; video unavailable or duration probe failed for ${inputVideo}`,
            err
          );
        }

        if (videoAvailable) {
          const basePercent = 95; // continue from selection stage
          const step = toCut.length > 0 ? 5 / toCut.length : 5; // up to 100%

          try {
            for (let i = 0; i < toCut.length; i++) {
              const h = toCut[i];
              const rawStart = Number.isFinite(h.start)
                ? Math.max(0, Number(h.start))
                : 0;
              const fallbackEnd = rawStart + 30;
              const requestedEnd = Number.isFinite(h.end)
                ? Math.max(rawStart + 2, Number(h.end))
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

              // Apply small lead/tail padding to ensure natural breathing room
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
                `highlight-${operationId}-${i + 1}-${Math.round(safeStart)}-${Math.round(safeEnd)}.mp4`
              );

              event.sender.send('transcript-summary-progress', {
                percent: Math.min(100, basePercent + step * i),
                stage: `Cutting highlight ${i + 1} of ${toCut.length}`,
                operationId,
                current: i + 1,
                total: toCut.length,
              });

              const args = [
                '-y',
                '-ss',
                String(safeStart),
                '-i',
                inputVideo,
                '-t',
                String(duration),
                '-map',
                '0:v:0?',
                '-map',
                '0:a:0?',
              ];

              if (duration > fadeDuration * 2) {
                args.push(
                  '-vf',
                  `fade=t=in:st=0:d=${fadeDuration.toFixed(2)},fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDuration.toFixed(2)}`,
                  '-af',
                  `afade=t=in:st=0:d=${fadeDuration.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDuration.toFixed(2)}`
                );
              }

              args.push(
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-crf',
                '23',
                '-c:a',
                'aac',
                '-b:a',
                '128k',
                '-movflags',
                '+faststart',
                outPath
              );

              await ffmpeg.run(args, {
                operationId,
                signal: controller.signal,
              });

              cutHighlights.push({
                start: safeStart,
                end: safeEnd,
                title: h.title,
                description: h.description,
                score: h.score,
                confidence: h.confidence,
                category: h.category,
                justification: h.justification,
                videoPath: outPath,
              });
            }

            event.sender.send('transcript-summary-progress', {
              percent: 100,
              stage: 'Highlights ready',
              operationId,
              partialHighlights: cutHighlights,
              partialSections: sections,
            });
          } catch (err) {
            log.warn(
              `[${operationId}] Highlight clipping failed; returning metadata only`,
              err
            );
            videoAvailable = false;
          }
        }

        if (!videoAvailable) {
          cutHighlights = toCut.map(h => ({ ...h }));
          event.sender.send('transcript-summary-progress', {
            percent: 100,
            stage: 'Highlights metadata ready',
            operationId,
            partialHighlights: cutHighlights,
            partialSections: sections,
          });
        }
      } else {
        // No video available; return just the metadata
        cutHighlights = toCut.map(h => ({ ...h }));
        event.sender.send('transcript-summary-progress', {
          percent: 100,
          stage: 'Highlights metadata ready',
          operationId,
          partialHighlights: cutHighlights,
          partialSections: sections,
        });
      }
    }

    return {
      success: true,
      summary,
      highlights: cutHighlights,
      sections,
      operationId,
    };
  } catch (error: any) {
    const aborted =
      controller.signal.aborted ||
      error?.name === 'AbortError' ||
      error?.message === 'Operation cancelled';

    const insufficientCredits =
      !aborted && /insufficient-credits/i.test(String(error?.message ?? ''));

    event.sender.send('transcript-summary-progress', {
      percent: 100,
      stage: aborted ? 'cancelled' : 'error',
      error: insufficientCredits ? 'insufficient-credits' : error?.message,
      operationId,
    });

    if (insufficientCredits) {
      throw new Error('insufficient-credits');
    }

    if (aborted) {
      return { success: false, cancelled: true, operationId };
    }

    throw error;
  } finally {
    registryFinish(operationId);
  }
}

export async function handleStylizeHighlight(
  event: IpcMainInvokeEvent,
  options: StylizeHighlightRequest,
  operationId: string
): Promise<StylizeHighlightResult> {
  const controller = new AbortController();
  registerAutoCancel(operationId, event.sender, () => controller.abort());
  addSubtitle(operationId, controller);

  try {
    const { ffmpeg } = checkServicesInitialized();
    if (!options?.highlight?.videoPath) {
      throw new Error(
        'Highlight clip is not available. Generate highlights before stylizing.'
      );
    }

    const progress = (update: StylizeHighlightProgress): void => {
      event.sender.send('stylize-highlight-progress', {
        ...update,
        operationId,
      });
    };

    progress({ percent: 5, stage: 'Preparing stylized captions', operationId });

    const outputPath = await renderStylizedHighlight({
      ffmpeg,
      highlight: options.highlight,
      words: options.words ?? [],
      operationId,
      signal: controller.signal,
      style: options.style ?? DEFAULT_STYLIZED_CAPTION_STYLE,
      progressCallback: update => progress({ ...update, operationId }),
    });

    progress({
      percent: 100,
      stage: 'Stylized highlight ready',
      videoPath: outputPath,
      operationId,
    });

    return { success: true, videoPath: outputPath, operationId };
  } catch (error: any) {
    const aborted =
      controller.signal.aborted ||
      error?.name === 'AbortError' ||
      error?.message === 'Operation aborted';

    const message = error?.message || String(error);
    event.sender.send('stylize-highlight-progress', {
      percent: 100,
      stage: aborted ? 'cancelled' : 'error',
      error: message,
      operationId,
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
        stage: isCancel ? '__i18n__:process_cancelled' : '__i18n__:error',
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
        stage: isCancel ? '__i18n__:process_cancelled' : '__i18n__:error',
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
