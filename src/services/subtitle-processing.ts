import path from 'path';
import { FFmpegService, FFmpegError } from './ffmpeg-service.js';
import { parseSrt, buildSrt } from '../shared/helpers/index.js';
import fs from 'fs';
import fsp from 'fs/promises';
import { getApiKey as getSecureApiKey } from './secure-store.js';
import { AI_MODELS } from '../shared/constants/index.js';
import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  SrtSegment,
} from '../types/interface.js';
import log from 'electron-log';
import OpenAI from 'openai';
import { FileManager } from './file-manager.js';

async function getApiKey(keyType: 'openai'): Promise<string> {
  const key = await getSecureApiKey(keyType);
  if (key) {
    return key;
  }

  throw new SubtitleProcessingError(
    `OpenAI API key not found. Please set it in the application settings.`
  );
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
      const translatedBatch = await translateBatch({
        batch: {
          segments: currentBatchOriginals.map(seg => ({ ...seg })),
          startIndex: batchStart,
          endIndex: batchEnd,
        },
        targetLang,
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

    const REVIEW_BATCH_SIZE = 50;
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

  progressCallback?.({ percent: 0, stage: 'Starting subtitle merging' });

  const videoExt = path.extname(inputPathForNaming);
  const baseName = path.basename(inputPathForNaming, videoExt);
  const tempFilename = `temp_merge_${Date.now()}_${baseName}_with_subtitles.mp4`;
  const outputPath = path.join(ffmpegService.getTempDir(), tempFilename);

  progressCallback?.({ percent: 25, stage: 'Analyzing input file' });
  log.info(`[${operationId}] Checking if input has a video stream...`);
  let hasVideo: boolean;
  try {
    hasVideo = await ffmpegService.hasVideoTrack(options.videoPath);
  } catch (probeError) {
    log.error(`[${operationId}] Error probing for video track:`, probeError);
    throw new SubtitleProcessingError(
      `Failed to analyze input file: ${probeError instanceof Error ? probeError.message : String(probeError)}`
    );
  }

  log.info(
    `[${operationId}] Input is ${hasVideo ? 'video' : 'audio-only'}. Output path: ${outputPath}`
  );

  try {
    let mergeResultPath: string;
    if (hasVideo) {
      log.info(
        `[${operationId}] Input has video. Calling standard mergeSubtitles for: ${options.videoPath}`
      );
      mergeResultPath = await ffmpegService.mergeSubtitles(
        options.videoPath!,
        options.subtitlesPath!,
        outputPath,
        operationId,
        options.fontSize,
        options.stylePreset,
        progressCallback
      );
    } else {
      log.info(
        `[${operationId}] Input is audio only. Calling mergeAudioOnlyWithSubtitles for: ${options.videoPath}`
      );
      mergeResultPath = await ffmpegService.mergeAudioOnlyWithSubtitles({
        audioPath: options.videoPath!,
        subtitlesPath: options.subtitlesPath!,
        outputPath,
        operationId,
        fontSize: options.fontSize,
        stylePreset: options.stylePreset,
        progressCallback,
      });
    }

    if (
      !mergeResultPath ||
      mergeResultPath === '' ||
      !fs.existsSync(outputPath)
    ) {
      log.info(
        `[${operationId}] Merge operation (video or audio) was cancelled or failed to create output file.`
      );
      progressCallback?.({ percent: 100, stage: 'Merge cancelled' });
      return { outputPath: '' };
    }

    progressCallback?.({
      percent: 100,
      stage: hasVideo ? 'Merge complete' : 'Audio + Subtitles complete',
    });
    return { outputPath };
  } catch (error: any) {
    log.error(`[${operationId}] Error during merge process:`, error);

    const isCancellation =
      error instanceof FFmpegError && error.message === 'Operation cancelled';

    progressCallback?.({
      percent: 100,
      stage: isCancellation
        ? 'Merge cancelled'
        : `Error: ${error instanceof Error ? error.message : String(error)}`,
    });

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
  operationId,
  signal,
}: TranslateBatchArgs): Promise<any[]> {
  log.info(
    `[${operationId}] Starting translation batch: ${batch.startIndex}-${batch.endIndex}`
  );

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
      log.info(`[${operationId}] Sending translation batch via callChatModel`);
      const translation = await callAIModel({
        messages: [{ role: 'user', content: combinedPrompt }],
        max_tokens: AI_MODELS.MAX_TOKENS,
        signal,
        operationId: `${operationId}-translate`,
        retryAttempts: 3,
      });
      log.info(`[${operationId}] Received response for translation batch`);
      log.info(
        `[${operationId}] Received response for translation batch (Attempt ${retryCount + 1})`
      );

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
  },
  signal?: AbortSignal,
  parentOperationId: string = 'review-batch'
): Promise<any[]> {
  const operationId = `${parentOperationId}-review-${batch.startIndex}-${batch.endIndex}`;
  log.info(
    `[${operationId}] Starting review batch: ${batch.startIndex}-${batch.endIndex}`
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

  const prompt = `
You are a professional subtitle reviewer for ${batch.targetLang}.
Your task is to review and improve the provided batch of translated subtitles based on their original counterparts.

**Input:**
You will receive ${batch.segments.length} pairs of original and translated subtitles, prefixed with their line number (e.g., "[index] Original Text").

**Original Texts:**
${originalTexts}

**Translations to Review:**
${translatedTexts}

**Instructions:**
1.  **Review Individually:** Review each translation line-by-line against its corresponding original text.
2.  **Improve:** Correct any errors in translation, grammar, or style. Ensure the translation is natural and fluent in ${batch.targetLang}.
3.  **Maintain Order & Structure:** Do **NOT** merge, split, or reorder lines.
4.  **Synchronization Rule:** If a translated line's content (often short leftover phrases) clearly belongs to the *previous* line's translation, output a **COMPLETELY BLANK** line for the current translation. Do *not* pull content from the *next* line.
5.  **Consistency:** Ensure consistent terminology and style throughout the batch.

**Output Format:**
- **Prefix EVERY line** you output with the exact delimiter \`@@SUB_LINE@@\` (including blank lines required by the Synchronization Rule).
- Provide **ONLY** the reviewed and improved translation text for **each** line in the batch.
- Output one reviewed translation per line, in the **exact same order** as the input batch.
- **DO NOT add extra blank lines between translations.** Only output a blank line if the Synchronization Rule explicitly requires it.
- **DO NOT** include the "[index]" prefixes in your output.
- If a line's translation should be blank according to the Synchronization Rule, output an empty line (prefixed with \`@@SUB_LINE@@\`).

**Example (if Input Batch had 3 lines):**
@@SUB_LINE@@Improved translation for line 1
@@SUB_LINE@@
@@SUB_LINE@@Improved translation for line 3

Now, provide the reviewed translations for the ${batch.segments.length} lines above, ensuring each line starts with \`@@SUB_LINE @@\`:
`;

  try {
    const reviewedContent = await callAIModel({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: AI_MODELS.MAX_TOKENS,
      signal,
      operationId: `${operationId}-review`,
      retryAttempts: 3,
    });

    if (!reviewedContent) {
      log.warn(
        '[Review] Review response content was empty or null. Using original translations.'
      );
      return batch.segments;
    }

    // Split by delimiter. Result will have an empty string at the start if content begins with the delimiter.
    const splitByDelimiter = reviewedContent.split('@@SUB_LINE@@');
    // Filter out potential empty first element and any trailing empty strings from final delimiter.
    let parsedLines = splitByDelimiter.filter(
      (line, index) => index > 0 || line.trim() !== ''
    );

    if (parsedLines.length !== batch.segments.length) {
      log.warn(
        `[Review Correction] Initial review output line count (${parsedLines.length}) does not match batch size (${batch.segments.length}). Expected ${batch.segments.length}. Attempting correction.`
      );
      log.info('--- Faulty Review Output ---');
      log.info(reviewedContent); // Log the faulty content for debugging
      log.info('--- End Faulty Review Output ---');

      // Construct the correction prompt
      const correctionPrompt = `
You previously reviewed a batch of ${batch.segments.length} subtitles.
Your goal was to provide exactly ${batch.segments.length} lines of reviewed text, one for each original line.
However, your last response contained ${parsedLines.length} lines.

Please correct your previous output to strictly match the required ${batch.segments.length} lines.

**Original Texts (for reference):**
${originalTexts}

**Your Previous (Incorrect Line Count) Output:**
${reviewedContent}

**Correction Instructions:**
1.  Analyze your previous output and the original texts.
2.  Adjust your reviewed translations so that you output **exactly** ${batch.segments.length} lines.
3.  Strictly follow the Synchronization Rule: If a line's content belongs to the previous line, output a BLANK line for the current line.
4.  **Remove the unnecessary blank lines you added between translations in your previous output.** Only keep blank lines required by the Synchronization Rule.

**Output Format:**
- **Prefix EVERY line** you output with the exact delimiter \`@@SUB_LINE@@\` (including blank lines required by the Synchronization Rule).
- Return **ONLY** the corrected reviewed translation text.
- Output exactly ${batch.segments.length} lines, one per original segment, in the correct order.
- **DO NOT add extra blank lines between translations.** Only output a blank line if the Synchronization Rule explicitly requires it.
- Do NOT include "[index]" prefixes.
- Use blank lines where required by the Synchronization Rule (prefixed with \`@@SUB_LINE@@\`).

Now, provide the corrected reviewed translations with exactly ${batch.segments.length} lines, ensuring each line starts with \`@@SUB_LINE@@\`:
`;

      try {
        log.info(`[Review Correction] Sending correction request to AI.`);
        const correctedReviewedContent = await callAIModel({
          messages: [{ role: 'user', content: correctionPrompt }],
          max_tokens: AI_MODELS.MAX_TOKENS, // Keep same token limit
          signal,
          operationId: `${operationId}-review-correction`,
          retryAttempts: 1, // Maybe fewer retries for correction? Or keep 3? Let's start with 1.
        });

        if (!correctedReviewedContent) {
          log.warn(
            `[Review Correction] Correction attempt returned empty content. Falling back to original batch.`
          );
          return batch.segments;
        }

        // *** CRITICAL: Check the count AGAIN ***
        if (
          correctedReviewedContent.split('@@SUB_LINE@@').length !==
          batch.segments.length
        ) {
          log.error(
            `[Review Correction] Correction attempt FAILED. Output line count (${correctedReviewedContent.split('@@SUB_LINE@@').length}) still does not match batch size (${batch.segments.length}). Falling back to original batch.`
          );
          log.info('--- Failed Correction Output ---');
          log.info(correctedReviewedContent);
          log.info('--- End Failed Correction Output ---');
          return batch.segments; // Fallback after failed correction
        }

        // SUCCESS! Use the corrected lines
        log.info(
          `[Review Correction] Correction successful. Using corrected review.`
        );
        parsedLines = correctedReviewedContent.split('@@SUB_LINE@@');
      } catch (correctionError: any) {
        log.error(
          `[Review Correction] Error during correction API call:`,
          correctionError.name,
          correctionError.message
        );
        log.error(
          `[Review Correction] Falling back to original batch due to correction error.`
        );
        return batch.segments; // Fallback on correction error
      }
    } // End of the correction block

    return batch.segments.map((segment, idx) => {
      const [originalText] = segment.text.split('###TRANSLATION_MARKER###');
      const reviewedTranslation = parsedLines[idx]?.trim() ?? ''; // Uses potentially updated parsedLines

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
      `[Review] Error during initial review batch (${parentOperationId}):`, // Updated log message slightly
      error.name,
      error.message
    );
    if (error.name === 'AbortError' || signal?.aborted) {
      log.info(
        `[Review] Review batch (${parentOperationId}) cancelled. Rethrowing.`
      );
      throw error;
    }
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

export async function callOpenAIChat({
  model,
  messages,
  max_tokens,
  signal,
  retryAttempts = 3,
}: {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  max_tokens?: number;
  signal?: AbortSignal;
  operationId: string;
  retryAttempts?: number;
}): Promise<string> {
  let openai: OpenAI;
  try {
    const openaiApiKey = await getApiKey('openai');
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not found');
    }
    openai = new OpenAI({ apiKey: openaiApiKey });
  } catch (keyError) {
    const message =
      keyError instanceof Error ? keyError.message : String(keyError);
    throw new Error(`OpenAI initialization failed: ${message}`);
  }

  let currentAttempt = 0;
  while (currentAttempt < retryAttempts) {
    currentAttempt++;
    try {
      const response = await openai.chat.completions.create(
        {
          model: model,
          messages: messages,
          max_tokens: max_tokens,
          temperature: 0.1,
        },
        { signal }
      );
      const content = response.choices[0]?.message?.content;
      if (content) {
        return content;
      } else {
        throw new Error('Unexpected response format from OpenAI Chat API.');
      }
    } catch (error: any) {
      if (signal?.aborted || error.name === 'AbortError') {
        throw new Error('Operation cancelled');
      }

      if (
        (error instanceof OpenAI.APIError &&
          (error.status === 429 ||
            error.status === 500 ||
            error.status === 503)) ||
        (error.message &&
          error.message.includes('timeout') &&
          currentAttempt < retryAttempts)
      ) {
        const delay = 1000 * Math.pow(2, currentAttempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw new Error(
        `OpenAI Chat API call failed: ${error.message || String(error)}`
      );
    }
  }

  throw new Error(
    `OpenAI Chat API call failed after ${retryAttempts} attempts.`
  );
}

export async function callAIModel({
  messages,
  max_tokens,
  signal,
  operationId,
  retryAttempts = 3,
}: {
  messages: any[];
  max_tokens?: number;
  signal?: AbortSignal;
  operationId: string;
  retryAttempts?: number;
}): Promise<string> {
  return callOpenAIChat({
    model: AI_MODELS.GPT,
    messages,
    max_tokens: max_tokens ?? 1000,
    signal,
    operationId,
    retryAttempts,
  });
}
