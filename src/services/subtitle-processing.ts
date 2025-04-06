import path from 'path';
import { FFmpegService } from './ffmpeg-service.js';
import { parseSrt, buildSrt } from '../shared/helpers/index.js';
import fs from 'fs';
import fsp from 'fs/promises';
import * as keytar from 'keytar';
import { AI_MODELS } from '../shared/constants/index.js';
import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  SrtSegment,
} from '../types/interface.js';
import log from 'electron-log';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { FileManager } from './file-manager.js';

const KEYTAR_SERVICE_NAME = 'TranslatorApp';

async function getApiKey(keyType: 'openai' | 'anthropic'): Promise<string> {
  const key = await keytar.getPassword(KEYTAR_SERVICE_NAME, keyType);
  if (!key) {
    throw new SubtitleProcessingError(
      `${keyType === 'openai' ? 'OpenAI' : 'Anthropic'} API key not found. Please set it in the application settings.`
    );
  }
  return key;
}

export class SubtitleProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubtitleProcessingError';
  }
}

function createFileFromPath(filePath: string): fs.ReadStream {
  try {
    return fs.createReadStream(filePath);
  } catch (error) {
    throw new SubtitleProcessingError(`Failed to create file stream: ${error}`);
  }
}

export async function extractSubtitlesFromVideo({
  options,
  operationId,
  signal,
  progressCallback,
  services,
}: {
  options: GenerateSubtitlesOptions;
  operationId: string;
  signal: AbortSignal;
  progressCallback?: GenerateProgressCallback;
  services: {
    ffmpegService: FFmpegService;
    fileManager: FileManager;
  };
}): Promise<GenerateSubtitlesResult> {
  if (!options) {
    options = { targetLanguage: 'original' } as GenerateSubtitlesOptions;
  }
  if (!options.videoPath) {
    throw new SubtitleProcessingError('Video path is required');
  }
  if (!services?.ffmpegService || !services?.fileManager) {
    log.error('[subtitle-processing] Required services were not provided.');
    throw new SubtitleProcessingError(
      'Required services (ffmpegService, fileManager) were not provided.'
    );
  }

  const { ffmpegService, fileManager } = services;
  const targetLang = options.targetLanguage.toLowerCase();
  const isTranslationNeeded = targetLang !== 'original';

  const STAGE_AUDIO_EXTRACTION = { start: 0, end: 10 };
  const STAGE_TRANSCRIPTION = { start: 10, end: 50 };
  const STAGE_TRANSLATION = isTranslationNeeded
    ? { start: 50, end: 75 }
    : { start: 50, end: 100 };
  const STAGE_REVIEW = isTranslationNeeded
    ? { start: 75, end: 95 }
    : { start: -1, end: -1 };
  const STAGE_FINALIZING = {
    start: isTranslationNeeded ? 95 : STAGE_TRANSLATION.end,
    end: 100,
  };

  function scaleProgress(
    percent: number,
    stage: { start: number; end: number }
  ) {
    const span = stage.end - stage.start;
    return Math.round(stage.start + (percent / 100) * span);
  }

  let audioPath: string | null = null;

  try {
    progressCallback?.({
      percent: STAGE_AUDIO_EXTRACTION.start,
      stage: 'Starting subtitle generation',
    });

    try {
      audioPath = await ffmpegService.extractAudio({
        videoPath: options.videoPath,
        progressCallback: extractionProgress => {
          const stagePercent =
            STAGE_AUDIO_EXTRACTION.start +
            (extractionProgress.percent / 100) *
              (STAGE_AUDIO_EXTRACTION.end - STAGE_AUDIO_EXTRACTION.start);
          progressCallback?.({
            percent: stagePercent,
            stage: extractionProgress.stage || '',
          });
        },
        operationId,
      });
    } catch (extractionError: any) {
      if (
        extractionError.name === 'AbortError' ||
        (extractionError instanceof Error &&
          extractionError.message === 'Operation cancelled') ||
        signal.aborted
      ) {
        console.info(`[${operationId}] Audio extraction cancelled.`);
      } else {
        console.error(
          `[${operationId}] Error during audio extraction:`,
          extractionError
        );
        throw new Error(
          `Audio extraction failed: ${extractionError.message || extractionError}`
        );
      }
    }

    const subtitlesContent = await generateSubtitlesFromAudio({
      inputAudioPath: audioPath || '',
      progressCallback: p => {
        progressCallback?.({
          percent: scaleProgress(p.percent, STAGE_TRANSCRIPTION),
          stage: p.stage,
          partialResult: p.partialResult,
          current: p.current,
          total: p.total,
          error: p.error,
        });
      },
      signal,
      operationId,
      services,
    });

    if (!isTranslationNeeded) {
      await fileManager.writeTempFile(subtitlesContent, '.srt');
      progressCallback?.({
        percent: STAGE_FINALIZING.end,
        stage: 'Transcription complete',
        partialResult: subtitlesContent,
      });
      return { subtitles: subtitlesContent };
    }

    const segmentsInProcess = parseSrt(subtitlesContent);
    const totalSegments = segmentsInProcess.length;
    const TRANSLATION_BATCH_SIZE = 10;

    for (
      let batchStart = 0;
      batchStart < totalSegments;
      batchStart += TRANSLATION_BATCH_SIZE
    ) {
      const batchEnd = Math.min(
        batchStart + TRANSLATION_BATCH_SIZE,
        totalSegments
      );
      const currentBatchOriginals = segmentsInProcess.slice(
        batchStart,
        batchEnd
      );
      const anthropicApiKey = await getApiKey('anthropic');
      const translatedBatch = await translateBatch({
        batch: {
          segments: currentBatchOriginals.map(seg => ({ ...seg })),
          startIndex: batchStart,
          endIndex: batchEnd,
        },
        targetLang,
        anthropicApiKey,
        operationId: `${operationId}-trans-${batchStart}`,
        signal,
      });
      for (let i = 0; i < translatedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = translatedBatch[i];
      }
      const overallProgress = (batchEnd / totalSegments) * 100;
      const cumulativeSrt = buildSrt(segmentsInProcess);
      progressCallback?.({
        percent: scaleProgress(overallProgress, STAGE_TRANSLATION),
        stage: `Translating batch ${Math.ceil(batchEnd / TRANSLATION_BATCH_SIZE)} of ${Math.ceil(
          totalSegments / TRANSLATION_BATCH_SIZE
        )}`,
        partialResult: cumulativeSrt,
        current: batchEnd,
        total: totalSegments,
      });
    }

    const REVIEW_BATCH_SIZE = 20;
    for (
      let batchStart = 0;
      batchStart < segmentsInProcess.length;
      batchStart += REVIEW_BATCH_SIZE
    ) {
      const batchEnd = Math.min(
        batchStart + REVIEW_BATCH_SIZE,
        segmentsInProcess.length
      );
      const currentBatchTranslated = segmentsInProcess.slice(
        batchStart,
        batchEnd
      );
      const reviewedBatch = await reviewTranslationBatch(
        {
          segments: currentBatchTranslated.map(seg => ({ ...seg })),
          startIndex: batchStart,
          endIndex: batchEnd,
          targetLang,
          allSegments: segmentsInProcess,
        },
        signal,
        `${operationId}-review-${batchStart}`
      );
      for (let i = 0; i < reviewedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = reviewedBatch[i];
      }
      const overallProgress = (batchEnd / segmentsInProcess.length) * 100;
      const cumulativeReviewedSrt = buildSrt(segmentsInProcess);
      progressCallback?.({
        percent: scaleProgress(overallProgress, STAGE_REVIEW),
        stage: `Reviewing batch ${Math.ceil(batchEnd / REVIEW_BATCH_SIZE)} of ${Math.ceil(
          segmentsInProcess.length / REVIEW_BATCH_SIZE
        )}`,
        partialResult: cumulativeReviewedSrt,
        current: batchEnd,
        total: segmentsInProcess.length,
        batchStartIndex: batchStart,
      });
    }

    progressCallback?.({
      percent: STAGE_FINALIZING.start,
      stage: 'Finalizing subtitles',
    });

    const indexedSegments = segmentsInProcess.map((block, idx) => ({
      ...block,
      index: idx + 1,
    }));
    const gapFilledSegments = extendShortSubtitleGaps(indexedSegments, 3);
    const finalSegments = fillBlankTranslations(gapFilledSegments);

    log.debug(
      `[${operationId}] Segments after fillBlankTranslations (${finalSegments.length} segments):`,
      JSON.stringify(finalSegments.slice(0, 5), null, 2)
    );

    const finalSubtitlesContent = buildSrt(finalSegments);

    await fileManager.writeTempFile(finalSubtitlesContent, '.srt');
    progressCallback?.({
      percent: STAGE_FINALIZING.end,
      stage: 'Translation and review complete',
      partialResult: finalSubtitlesContent,
    });

    return { subtitles: finalSubtitlesContent };
  } catch (error: any) {
    console.error(`[${operationId}] Error during subtitle generation:`, error);

    // Detect if cancellation caused this error
    const isCancel =
      error.name === 'AbortError' ||
      (error instanceof Error && error.message === 'Operation cancelled') ||
      signal.aborted;

    // If cancellation, set stage = "Process cancelled"
    if (isCancel) {
      progressCallback?.({
        percent: 100,
        stage: 'Process cancelled',
      });
      log.info(`[${operationId}] Process cancelled by user.`);
    } else {
      // Otherwise, it's an actual error
      progressCallback?.({
        percent: 100,
        stage: `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // Rethrow the error so upper layers know we failed/cancelled
    throw error;
  } finally {
    if (audioPath) {
      try {
        await fileManager.deleteFile(audioPath);
      } catch (cleanupError) {
        console.error(
          `Failed to delete temporary audio file ${audioPath}:`,
          cleanupError
        );
      }
    }
  }
}

export async function generateSubtitlesFromAudio({
  inputAudioPath,
  progressCallback,
  signal,
  operationId,
  services,
}: GenerateSubtitlesFromAudioArgs): Promise<string> {
  const PROGRESS_ANALYSIS_DONE = 5;
  const PROGRESS_CHUNKING_DONE = 15;
  const PROGRESS_TRANSCRIPTION_START = 20;
  const PROGRESS_TRANSCRIPTION_END = 95;
  const PROGRESS_FINALIZING = 100;
  const MAX_CHUNK_SIZE_BYTES = 20 * 1024 * 1024;
  const SILENCE_TOLERANCE_SEC = 2.0;
  const MIN_CHUNK_DURATION_SEC = 1.0;

  let openai: OpenAI;
  const overallSegments: SrtSegment[] = [];
  const chunkMetadataList: Array<{
    path: string;
    start: number;
    duration: number;
    index: number;
  }> = [];
  const createdChunkPaths: string[] = [];
  const tempDir = path.dirname(inputAudioPath);

  try {
    try {
      const openaiApiKey = await getApiKey('openai');
      openai = new OpenAI({ apiKey: openaiApiKey });
    } catch (keyError) {
      const message =
        keyError instanceof Error ? keyError.message : String(keyError);
      progressCallback?.({ percent: 0, stage: 'Error', error: message });
      throw new SubtitleProcessingError(message);
    }

    if (!fs.existsSync(inputAudioPath)) {
      throw new SubtitleProcessingError(
        `Audio file not found: ${inputAudioPath}`
      );
    }

    progressCallback?.({ percent: 0, stage: 'Analyzing audio file...' });

    if (!services?.ffmpegService) {
      throw new SubtitleProcessingError('FFmpegService is required.');
    }
    const { ffmpegService } = services;

    const duration = await ffmpegService.getMediaDuration(inputAudioPath);
    if (isNaN(duration) || duration <= 0) {
      throw new SubtitleProcessingError(
        'Unable to determine valid audio duration.'
      );
    }

    let fileSize = 0;
    try {
      fileSize = fs.statSync(inputAudioPath).size;
    } catch (statError: any) {
      throw new SubtitleProcessingError(
        `Failed to get file stats for ${inputAudioPath}: ${statError.message}`
      );
    }

    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE,
      stage: 'Audio analyzed',
    });

    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE,
      stage: 'Detecting silence boundaries...',
    });

    const { silenceStarts: _silenceStarts = [], silenceEnds = [] } =
      await ffmpegService.detectSilenceBoundaries(inputAudioPath);
    log.info(
      `[${operationId}] Detected ${silenceEnds.length} silence end boundaries.`
    );

    const bitrate =
      fileSize > 0 && duration > 0 ? (fileSize * 8) / duration : 128000;
    let targetChunkDurationSec = duration;
    if (bitrate > 0) {
      targetChunkDurationSec = (MAX_CHUNK_SIZE_BYTES * 8) / bitrate;
    }
    targetChunkDurationSec = Math.min(targetChunkDurationSec, 15 * 60);

    log.info(
      `[${operationId}] Calculated Bitrate: ${bitrate / 1000} kbps, Target Chunk Duration: ${targetChunkDurationSec}s`
    );

    let currentStartTime = 0;
    let chunkIndex = 0;

    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE + 2,
      stage: 'Calculating audio chunks...',
    });

    while (currentStartTime < duration) {
      if (signal?.aborted)
        throw new Error('Operation cancelled during chunking');

      let idealEndTime = currentStartTime + targetChunkDurationSec;
      idealEndTime = Math.min(idealEndTime, duration);

      let chosenEndTime = idealEndTime;

      let bestSilenceEnd = Infinity;
      for (const silenceEnd of silenceEnds) {
        if (
          silenceEnd > currentStartTime &&
          silenceEnd >= idealEndTime &&
          silenceEnd <= idealEndTime + SILENCE_TOLERANCE_SEC
        ) {
          if (silenceEnd < bestSilenceEnd) {
            bestSilenceEnd = silenceEnd;
          }
        } else if (silenceEnd > idealEndTime + SILENCE_TOLERANCE_SEC) {
          break;
        }
      }

      if (bestSilenceEnd !== Infinity) {
        chosenEndTime = bestSilenceEnd;
        log.debug(
          `[${operationId}] Chunk ${chunkIndex + 1}: Snapped ideal end ${idealEndTime.toFixed(2)}s to silence boundary ${chosenEndTime.toFixed(2)}s`
        );
      } else {
        log.debug(
          `[${operationId}] Chunk ${chunkIndex + 1}: No suitable silence boundary found near ${idealEndTime.toFixed(2)}s. Using ideal end.`
        );
      }

      let actualChunkDuration = chosenEndTime - currentStartTime;
      if (
        actualChunkDuration < MIN_CHUNK_DURATION_SEC &&
        chosenEndTime < duration
      ) {
        chosenEndTime = Math.min(
          currentStartTime + MIN_CHUNK_DURATION_SEC,
          duration
        );
        actualChunkDuration = chosenEndTime - currentStartTime;
        log.debug(
          `[${operationId}] Chunk ${chunkIndex + 1}: Adjusted short chunk duration. New end: ${chosenEndTime.toFixed(2)}s`
        );
      }

      if (actualChunkDuration <= 0) {
        log.warn(
          `[${operationId}] Chunk ${chunkIndex + 1}: Calculated duration is <= 0 (${actualChunkDuration}). Skipping chunk.`
        );
        currentStartTime = Math.min(chosenEndTime + 0.1, duration);
        continue;
      }

      const currentChunkIndex = chunkIndex + 1;
      const chunkPath = path.join(
        tempDir,
        `chunk_${operationId}_${currentChunkIndex}.mp3`
      );

      createdChunkPaths.push(chunkPath);

      log.info(
        `[${operationId}] Creating chunk ${currentChunkIndex}: Start ${currentStartTime.toFixed(2)}s, Duration ${actualChunkDuration.toFixed(2)}s, Path: ${chunkPath}`
      );

      try {
        await ffmpegService.extractAudioSegment({
          inputPath: inputAudioPath,
          outputPath: chunkPath,
          startTime: currentStartTime,
          duration: actualChunkDuration,
        });
      } catch (extractError: any) {
        log.error(
          `[${operationId}] Failed to extract audio segment for chunk ${currentChunkIndex}: ${extractError.message}. Skipping chunk.`
        );
        createdChunkPaths.pop();
        currentStartTime = chosenEndTime;
        chunkIndex++;
        continue;
      }

      chunkMetadataList.push({
        path: chunkPath,
        start: currentStartTime,
        duration: actualChunkDuration,
        index: currentChunkIndex,
      });

      const chunkingProgress = currentStartTime / duration;
      progressCallback?.({
        percent:
          PROGRESS_ANALYSIS_DONE +
          chunkingProgress * (PROGRESS_CHUNKING_DONE - PROGRESS_ANALYSIS_DONE),
        stage: `Prepared chunk ${currentChunkIndex}...`,
      });

      currentStartTime = chosenEndTime;
      chunkIndex++;
    }

    progressCallback?.({
      percent: PROGRESS_CHUNKING_DONE,
      stage: `Prepared ${chunkMetadataList.length} audio chunks. Starting transcription...`,
    });

    const chunkTranscriptionPromises: Promise<SrtSegment[]>[] = [];
    const totalChunks = chunkMetadataList.length;

    if (totalChunks === 0) {
      log.warn(
        `[${operationId}] No audio chunks were created. Aborting transcription.`
      );
      throw new SubtitleProcessingError(
        'Audio processing resulted in zero valid chunks.'
      );
    }

    for (const chunkMeta of chunkMetadataList) {
      if (signal?.aborted)
        throw new Error('Operation cancelled during transcription scheduling');

      const transcriptionTask = transcribeChunk({
        chunkIndex: chunkMeta.index,
        totalChunks,
        chunkPath: chunkMeta.path,
        startTime: chunkMeta.start,
        progressCallback,
        signal,
      });

      chunkTranscriptionPromises.push(transcriptionTask);
    }

    const results = await Promise.allSettled(chunkTranscriptionPromises);
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled' && res.value.length > 0) {
        overallSegments.push(...res.value);
      } else if (res.status === 'rejected') {
        console.error(
          `[${operationId}] Chunk ${idx + 1} transcription failed:`,
          res.reason
        );
      } else if (res.status === 'fulfilled' && res.value.length === 0) {
        console.warn(
          `[${operationId}] Chunk ${idx + 1} returned no segments (error or empty).`
        );
      }
    });

    overallSegments.sort((a, b) => a.start - b.start);
    overallSegments.forEach((seg, idx) => {
      seg.index = idx + 1;
    });

    progressCallback?.({
      percent: PROGRESS_TRANSCRIPTION_END,
      stage: `Finalizing ${overallSegments.length} subtitle segments...`,
    });

    const finalSrtContent = buildSrt(overallSegments);

    progressCallback?.({
      percent: PROGRESS_FINALIZING,
      stage: 'Transcription complete!',
    });

    return finalSrtContent;
  } catch (error: any) {
    console.error(
      `[${operationId}] Error in generateSubtitlesFromAudio:`,
      error
    );
    progressCallback?.({
      percent: 100,
      stage: 'Error',
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof SubtitleProcessingError) {
      throw error;
    }
    throw new SubtitleProcessingError(
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    log.info(
      `[${operationId}] Cleaning up ${createdChunkPaths.length} chunk files...`
    );
    const deletionTasks = createdChunkPaths.map(chunkPath =>
      fsp
        .unlink(chunkPath)
        .catch(err =>
          console.warn(
            `[${operationId}] Failed to delete chunk ${chunkPath}:`,
            err
          )
        )
    );
    await Promise.allSettled(deletionTasks);
    console.info(`[${operationId}] Finished cleaning up chunk files.`);
  }

  async function transcribeChunk({
    chunkIndex,
    totalChunks,
    chunkPath,
    startTime,
    progressCallback,
    signal,
  }: {
    chunkIndex: number;
    totalChunks: number;
    chunkPath: string;
    startTime: number;
    progressCallback?: (info: {
      percent: number;
      stage: string;
      current?: number;
      total?: number;
      error?: string;
    }) => void;
    signal?: AbortSignal;
  }): Promise<SrtSegment[]> {
    const basePercent =
      PROGRESS_TRANSCRIPTION_START +
      ((chunkIndex - 1) / totalChunks) *
        (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START);

    progressCallback?.({
      percent: basePercent,
      stage: `Sending audio chunk ${chunkIndex}/${totalChunks} to AI...`,
      current: chunkIndex,
      total: totalChunks,
    });

    try {
      if (signal?.aborted) {
        log.info(
          `[${operationId}] Transcription for chunk ${chunkIndex} cancelled before API call.`
        );
        throw new Error('Operation cancelled');
      }

      console.info(
        `[${operationId}] Sending chunk ${chunkIndex} (${(fs.statSync(chunkPath).size / (1024 * 1024)).toFixed(2)} MB) to OpenAI Whisper API.`
      );
      const fileStream = createFileFromPath(chunkPath);
      const response = await openai.audio.transcriptions.create(
        {
          model: AI_MODELS.WHISPER.id,
          file: fileStream,
          response_format: 'srt',
        },
        { signal }
      );

      console.info(
        `[${operationId}] Received transcription for chunk ${chunkIndex}.`
      );
      const srtContent = response as unknown as string;

      log.debug(
        `[${operationId}] Raw SRT content received for chunk ${chunkIndex} (startTime: ${startTime}):\n--BEGIN RAW SRT CHUNK ${chunkIndex}--\n${srtContent}\n--END RAW SRT CHUNK ${chunkIndex}--`
      );

      const segments =
        srtContent && typeof srtContent === 'string'
          ? parseSrt(srtContent)
          : [];

      segments.forEach(segment => {
        if (
          typeof segment.start === 'number' &&
          typeof segment.end === 'number'
        ) {
          segment.start += startTime;
          segment.end += startTime;
        } else {
          log.warn(
            `[${operationId}] Chunk ${chunkIndex}: Segment found with non-numeric start/end times. Skipping offset.`,
            segment
          );
        }
      });

      const progressAfterApiCall =
        basePercent +
        (0.8 / totalChunks) *
          (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START);

      progressCallback?.({
        percent: progressAfterApiCall,
        stage: `Transcribed chunk ${chunkIndex}/${totalChunks}`,
        current: chunkIndex,
        total: totalChunks,
      });

      return segments;
    } catch (error: any) {
      console.error(
        `[${operationId}] Error transcribing chunk ${chunkIndex}:`,
        error.name,
        error.message
      );

      if (
        signal?.aborted ||
        error.name === 'AbortError' ||
        (error instanceof Error && error.message === 'Operation cancelled')
      ) {
        log.info(
          `[${operationId}] Transcription for chunk ${chunkIndex} was cancelled.`
        );
        progressCallback?.({
          percent:
            basePercent +
            (0.9 / totalChunks) *
              (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START),
          stage: `Chunk ${chunkIndex}/${totalChunks} cancelled`,
          error: `Chunk ${chunkIndex} cancelled`,
          current: chunkIndex,
          total: totalChunks,
        });
        return [];
      }

      // Handle other errors
      progressCallback?.({
        percent:
          basePercent +
          (0.9 / totalChunks) *
            (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START),
        stage: `Error transcribing chunk ${chunkIndex}/${totalChunks}`,
        error: `Chunk ${chunkIndex} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        current: chunkIndex,
        total: totalChunks,
      });
      return [];
    }
  }
}

export async function mergeSubtitlesWithVideo({
  options,
  operationId,
  services,
  progressCallback,
}: MergeSubtitlesWithVideoArgs): Promise<{ outputPath: string }> {
  const { ffmpegService } = services;
  log.info(`[${operationId}] mergeSubtitlesWithVideo called.`);

  const inputPathForNaming = options.videoFileName || options.videoPath;
  if (!inputPathForNaming) {
    throw new SubtitleProcessingError(
      'Either videoFileName or videoPath is required for naming output.'
    );
  }
  if (!options.videoPath) {
    throw new SubtitleProcessingError('Video path is required for merging');
  }
  if (!options.subtitlesPath) {
    throw new SubtitleProcessingError('Subtitles path is required');
  }

  if (progressCallback) {
    progressCallback({ percent: 0, stage: 'Starting subtitle merging' });
  }

  const videoExt = path.extname(inputPathForNaming);
  const baseName = path.basename(inputPathForNaming, videoExt);
  const tempFilename = `temp_merge_${Date.now()}_${baseName}_with_subtitles.mp4`;
  const outputPath = path.join(ffmpegService.getTempDir(), tempFilename);

  if (progressCallback) {
    progressCallback({ percent: 25, stage: 'Processing video' });
  }

  log.info(
    `[${operationId}] Target temporary output path (forced MP4): ${outputPath}`
  );

  try {
    log.info(
      `[${operationId}] Calling ffmpegService.mergeSubtitles with video: ${options.videoPath}, subtitles: ${options.subtitlesPath}, output: ${outputPath}`
    );
    const mergeResult = await ffmpegService.mergeSubtitles(
      options.videoPath!,
      options.subtitlesPath!,
      outputPath,
      operationId,
      options.fontSize,
      options.stylePreset,
      progressCallback
    );

    if (!mergeResult || mergeResult === '' || !fs.existsSync(outputPath)) {
      log.info(
        `[${operationId}] Merge operation was cancelled or failed to create output file`
      );
      if (progressCallback) {
        progressCallback({ percent: 100, stage: 'Merge cancelled' });
      }
      return { outputPath: '' };
    }

    if (progressCallback) {
      progressCallback({
        percent: 100,
        stage: 'Merge complete',
      });
    }
    return { outputPath };
  } catch (error) {
    log.error(`[${operationId}] Error during merge:`, error);

    // Check if the error indicates cancellation
    const isCancellation =
      error instanceof Error && error.message === 'Operation cancelled';

    if (progressCallback) {
      progressCallback({
        percent: 100,
        stage: isCancellation
          ? 'Merge cancelled'
          : `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (isCancellation) {
      log.info(`[${operationId}] Merge operation was cancelled.`);
      return { outputPath: '' };
    } else {
      throw error;
    }
  }
}

async function translateBatch({
  batch,
  targetLang,
  anthropicApiKey,
  operationId,
  signal,
}: TranslateBatchArgs): Promise<any[]> {
  log.info(
    `[${operationId}] Starting translation batch: ${batch.startIndex}-${batch.endIndex}`
  );
  let anthropic: Anthropic;
  try {
    anthropic = new Anthropic({ apiKey: anthropicApiKey });
  } catch (keyError) {
    throw new SubtitleProcessingError(
      keyError instanceof Error ? keyError.message : String(keyError)
    );
  }

  const MAX_RETRIES = 3;
  let retryCount = 0;
  const batchContextPrompt = batch.segments.map((segment, idx) => {
    const absoluteIndex = batch.startIndex + idx;
    return `Line ${absoluteIndex + 1}: ${segment.text}`;
  });

  const combinedPrompt = `
You are a professional subtitle translator. Translate the following subtitles 
into natural, fluent ${targetLang}.

Here are the subtitles to translate:
${batchContextPrompt.join('\n')}

Translate EACH line individually, preserving the line order. 
- **Never merge** multiple lines into one, and never skip or omit a line. 
- If a line's content was already translated in the previous line, LEAVE IT BLANK. WHEN THERE ARE LIKE 1~2 WORDS THAT ARE LEFT OVERS FROM THE PREVIOUS SENTENCE, THEN THIS IS ALMOST ALWAYS THE CASE. DO NOT ATTEMPT TO FILL UP THE BLANK WITH THE NEXT TRANSLATION. AVOID SYNCHRONIZATION ISSUES AT ALL COSTS.
- Provide exactly one translation for every line, in the same order, 
  prefixed by "Line X:" where X is the line number.
- If you're unsure, err on the side of literal translations.
- For languages with different politeness levels, ALWAYS use polite/formal style for narrations.
`;

  while (retryCount < MAX_RETRIES) {
    try {
      log.info(
        `[${operationId}] Sending translation batch (Attempt ${retryCount + 1})`
      );
      const response = await anthropic.messages.create(
        {
          model: AI_MODELS.CLAUDE_3_7_SONNET,
          max_tokens: AI_MODELS.MAX_TOKENS,
          messages: [{ role: 'user', content: combinedPrompt }],
        } as Anthropic.MessageCreateParams,
        { signal }
      );
      log.info(
        `[${operationId}] Received response for translation batch (Attempt ${retryCount + 1})`
      );

      const translationResponse = response as Anthropic.Message;

      let translation = '';
      if (
        translationResponse.content &&
        translationResponse.content.length > 0 &&
        translationResponse.content[0].type === 'text'
      ) {
        translation = translationResponse.content[0].text;
      } else {
        throw new Error('Unexpected translation response format from Claude.');
      }

      const translationLines = translation
        .split('\n')
        .filter((line: string) => line.trim() !== '');
      const lineRegex = /^Line\s+(\d+):\s*(.*)$/;

      let lastNonEmptyTranslation = '';
      return batch.segments.map((segment, idx) => {
        const absoluteIndex = batch.startIndex + idx;
        let translatedText = segment.text;
        const originalSegmentText = segment.text;

        for (const line of translationLines) {
          const match = line.match(lineRegex);
          if (match && parseInt(match[1]) === absoluteIndex + 1) {
            const potentialTranslation = match[2].trim();
            if (potentialTranslation === originalSegmentText) {
              translatedText = lastNonEmptyTranslation;
            } else {
              translatedText = potentialTranslation || lastNonEmptyTranslation;
            }
            lastNonEmptyTranslation = translatedText;
            break;
          }
        }

        return {
          ...segment,
          text: `${originalSegmentText}###TRANSLATION_MARKER###${translatedText}`,
          originalText: originalSegmentText,
          translatedText,
        };
      });
    } catch (err: any) {
      log.error(
        `[${operationId}] Error during translation batch (Attempt ${retryCount + 1}):`,
        err.name,
        err.message
      );

      if (err.name === 'AbortError' || signal?.aborted) {
        log.info(
          `[${operationId}] Translation batch detected cancellation signal/error.`
        );
      }

      if (
        err.message &&
        (err.message.includes('timeout') ||
          err.message.includes('rate') ||
          err.message.includes('ECONNRESET')) &&
        retryCount < MAX_RETRIES - 1
      ) {
        retryCount++;
        const delay = 1000 * Math.pow(2, retryCount);
        log.info(
          `[${operationId}] Retrying translation batch in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      log.error(
        `[${operationId}] Unhandled error or retries exhausted in translateBatch. Falling back.`
      );
      return batch.segments.map(segment => ({
        ...segment,
        text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
        originalText: segment.text,
        translatedText: segment.text,
      }));
    }
  }

  log.warn(
    `[${operationId}] Translation failed after ${MAX_RETRIES} retries, using original text`
  );

  return batch.segments.map(segment => ({
    ...segment,
    text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
    originalText: segment.text,
    translatedText: segment.text,
  }));
}

async function reviewTranslationBatch(
  batch: {
    segments: any[];
    startIndex: number;
    endIndex: number;
    targetLang: string;
    allSegments: SrtSegment[];
  },
  signal?: AbortSignal,
  parentOperationId: string = 'review-batch'
): Promise<any[]> {
  const operationId = `${parentOperationId}-review-${batch.startIndex}-${batch.endIndex}`;
  log.info(
    `[${operationId}] Starting review batch: ${batch.startIndex}-${batch.endIndex}`
  );

  let anthropic: Anthropic;
  try {
    const anthropicApiKey = await getApiKey('anthropic');
    anthropic = new Anthropic({ apiKey: anthropicApiKey });
  } catch (keyError) {
    throw new SubtitleProcessingError(
      keyError instanceof Error ? keyError.message : String(keyError)
    );
  }

  const CONTEXT_WINDOW_SIZE = 5;

  const allSegments = batch.allSegments;
  const totalAvailableSegments = allSegments.length;

  const contextStartIndex = Math.max(0, batch.startIndex - CONTEXT_WINDOW_SIZE);
  const contextEndIndex = Math.min(
    batch.startIndex + batch.segments.length + CONTEXT_WINDOW_SIZE,
    totalAvailableSegments + batch.startIndex
  );

  const batchItemsWithContext = batch.segments.map(
    (block: any, idx: number) => {
      const absoluteIndex = batch.startIndex + idx;
      const [original, translation] = block.text.split(
        '###TRANSLATION_MARKER###'
      );
      return {
        index: absoluteIndex + 1,
        original: original?.trim() || '',
        translation: (translation || original || '').trim(),
        isPartOfBatch: true,
      };
    }
  );

  const originalTexts = batchItemsWithContext
    .map(item => `[${item.index}] ${item.original}`)
    .join('\n');
  const translatedTexts = batchItemsWithContext
    .map(item => `[${item.index}] ${item.translation}`)
    .join('\n');

  const contextBlocks = [];

  for (let i = contextStartIndex; i < batch.startIndex; i++) {
    if (i >= 0 && i < allSegments.length) {
      const [original, translation] = allSegments[i].text.split(
        '###TRANSLATION_MARKER###'
      );
      contextBlocks.push({
        index: i + 1,
        original: original?.trim() || '',
        translation: (translation || original || '').trim(),
      });
    }
  }

  for (let i = batch.endIndex; i < contextEndIndex; i++) {
    if (i >= 0 && i < allSegments.length) {
      const [original, translation] = allSegments[i].text.split(
        '###TRANSLATION_MARKER###'
      );
      contextBlocks.push({
        index: i + 1,
        original: original?.trim() || '',
        translation: (translation || original || '').trim(),
      });
    }
  }

  const contextOriginalTexts = contextBlocks
    .map(item => `[${item.index}] ${item.original}`)
    .join('\n');
  const contextTranslatedTexts = contextBlocks
    .map(item => `[${item.index}] ${item.translation}`)
    .join('\n');

  const prompt = `
You are a professional subtitle translator and reviewer for ${batch.targetLang}.
Review and improve each translated subtitle block below **individually**.

**RULES:**
- Maintain the original order. **NEVER** merge or split blocks.
- For each block, provide the improved translation. Focus on accuracy, completeness, consistency, and context based on the original text.
- Preserve the sequence of information from the corresponding original text.
- **CRITICAL SYNC RULE:** If a block's content (e.g., 1-2 leftover words) logically belongs to the *previous* block's translation, leave the *current* block's translation **COMPLETELY BLANK**. Do not fill it with the *next* block's content.
- Ensure consistency in terminology and style across all blocks.
- Look at the surrounding context to ensure your translations maintain narrative coherence.

**SURROUNDING CONTEXT (DO NOT TRANSLATE THESE - FOR REFERENCE ONLY):**
**Original Context:**
${contextOriginalTexts}

**Translated Context:**
${contextTranslatedTexts}

**BLOCKS TO REVIEW (TRANSLATE ONLY THESE):**
**ORIGINAL TEXT (Context Only - DO NOT MODIFY):**
${originalTexts}

**TRANSLATION TO REVIEW & IMPROVE:**
${translatedTexts}

**Output Format:**
- Return **ONLY** the improved translation text for each block, one per line, in the **exact same order** as the input.
- **DO NOT** include the "[index]" prefixes in your output.
- If a line should be blank (per the SYNC RULE), output an empty line.

Example Output (for 3 blocks):
Improved translation for block 1

Improved translation for block 3
`;

  try {
    log.info(
      `[Review] Sending review batch (${parentOperationId}) to Claude API`
    );

    const response = await anthropic.messages.create(
      {
        model: AI_MODELS.CLAUDE_3_7_SONNET,
        max_tokens: AI_MODELS.MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      } as Anthropic.MessageCreateParams,
      { signal }
    );
    log.info(
      `[Review] Received response for review batch (${parentOperationId})`
    );

    const reviewResponse = response as Anthropic.Message;

    let reviewedContent = '';
    if (
      reviewResponse.content &&
      reviewResponse.content.length > 0 &&
      reviewResponse.content[0].type === 'text'
    ) {
      reviewedContent = reviewResponse.content[0].text;
    } else {
      log.warn(
        '[Review] Review response content was not in the expected format.'
      );
      log.warn(
        `[Review] Translation review output format unexpected. Using original translations for this batch.`
      );
      return batch.segments;
    }

    const reviewedLines = reviewedContent.split('\n');

    if (reviewedLines.length !== batch.segments.length) {
      log.warn(
        `[Review] Translation review output line count (${reviewedLines.length}) does not match batch size (${batch.segments.length}). Using original translations for this batch.`
      );
      return batch.segments;
    }

    return batch.segments.map((segment, idx) => {
      const [originalText] = segment.text.split('###TRANSLATION_MARKER###');
      const reviewedTranslation = reviewedLines[idx]?.trim() ?? '';

      const finalTranslation =
        reviewedTranslation === '' ? '' : reviewedTranslation;

      return {
        ...segment,
        text: `${originalText}###TRANSLATION_MARKER###${finalTranslation}`,
        originalText: originalText,
        reviewedText: finalTranslation,
      };
    });
  } catch (error: any) {
    log.error(
      `[Review] Error during review batch (${parentOperationId}):`,
      error.name,
      error.message
    );
    if (error.name === 'AbortError' || signal?.aborted) {
      log.info(
        `[Review] Review batch (${parentOperationId}) cancelled. Rethrowing.`
      );
      // Re-throw cancellation errors so the caller can handle them
      throw error;
    }
    // For other errors, log and fallback to original segments
    log.error(
      `[Review] Unhandled error in reviewTranslationBatch (${parentOperationId}). Falling back to original batch segments.`
    );
    return batch.segments;
  }
}

function extendShortSubtitleGaps(
  segments: SrtSegment[],
  threshold: number = 3
): SrtSegment[] {
  if (!segments || segments.length < 2) {
    return segments;
  }

  const adjustedSegments = segments.map(segment => ({ ...segment }));

  for (let i = 0; i < adjustedSegments.length - 1; i++) {
    const currentSegment = adjustedSegments[i];
    const nextSegment = adjustedSegments[i + 1];

    const currentEndTime = Number(currentSegment.end);
    const nextStartTime = Number(nextSegment.start);

    if (isNaN(currentEndTime) || isNaN(nextStartTime)) {
      log.warn(
        `Invalid time encountered at index ${i}, skipping gap adjustment.`
      );
      continue;
    }

    const gap = nextStartTime - currentEndTime;

    if (gap > 0 && gap < threshold) {
      currentSegment.end = nextStartTime;
    }
  }

  return adjustedSegments;
}

function fillBlankTranslations(segments: SrtSegment[]): SrtSegment[] {
  if (!segments || segments.length < 2) {
    return segments;
  }

  const adjustedSegments = segments.map(segment => ({ ...segment }));

  for (let i = 1; i < adjustedSegments.length; i++) {
    const currentSegment = adjustedSegments[i];
    const prevSegment = adjustedSegments[i - 1];

    const currentParts = currentSegment.text.split('###TRANSLATION_MARKER###');
    const currentHasMarker = currentParts.length > 1;
    const currentOriginal = currentParts[0] || '';
    const currentTranslation = currentParts[1] || '';
    const isCurrentBlank =
      currentHasMarker &&
      currentOriginal.trim() !== '' &&
      currentTranslation.trim() === '';

    if (isCurrentBlank) {
      const prevParts = prevSegment.text.split('###TRANSLATION_MARKER###');
      const prevTranslation = prevParts[1] || '';

      if (prevTranslation.trim() !== '') {
        currentSegment.text = `${currentOriginal}###TRANSLATION_MARKER###${prevTranslation}`;
      }
    }
  }

  return adjustedSegments;
}
