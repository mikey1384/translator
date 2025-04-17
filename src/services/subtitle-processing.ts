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
import { spawn } from 'child_process';
import { once } from 'events';
import * as webrtcvadPackage from 'webrtcvad';

const Vad = webrtcvadPackage.default.default;

// --- Configuration Constants ---
const VAD_NORMALIZATION_MIN_GAP_SEC = 0.2; // Min gap between speech intervals to merge
const VAD_NORMALIZATION_MIN_DURATION_SEC = 0.75; // Min duration for a VAD-detected speech interval
const CHUNK_OVERLAP_SEC = 0.5; // Overlap added to start/end of chunks
const CHUNK_MAX_SPEECH_SEC = 60; // Max duration of a single speech chunk before splitting
const PRUNING_RMS_THRESHOLD = 0.015; // RMS threshold for pruning (if RMS check is enabled)
const PRUNING_MIN_DURATION_SEC = 0.2; // Min duration for a final pruned segment
const PRUNING_MIN_WORDS = 1; // Min words for a final pruned segment
const MIN_CONTEXT_SEC = 30; // Target minimum context window for Whisper
// --- End Configuration Constants ---

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
          current: p?.current,
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

    const finalSrtContent = buildSrt(finalSegments);

    await fileManager.writeTempFile(finalSrtContent, '.srt');
    progressCallback?.({
      percent: STAGE_FINALIZING.end,
      stage: 'Translation and review complete',
      partialResult: finalSrtContent,
    });

    return { subtitles: finalSrtContent };
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

  let openai: OpenAI;
  const overallSegments: SrtSegment[] = [];
  const chunkMetadataList: Array<{
    path: string;
    start: number;
    duration: number;
    index: number;
  }> = [];
  const createdChunkPaths: string[] = [];
  const createdWindowFilePaths: string[] = []; // For combined wav/txt files
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

    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE,
      stage: 'Audio analyzed',
    });

    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE,
      stage: 'Detecting silence boundaries...',
    });

    const rawIntervals = await detectSpeechIntervals({
      inputPath: inputAudioPath,
    });
    const speechIntervals = normalizeSpeechIntervals({
      intervals: rawIntervals,
      minDurSec: VAD_NORMALIZATION_MIN_DURATION_SEC, // Use constant
    });
    log.info(
      `[${operationId}] VAD found ${rawIntervals.length} raw intervals, normalized to ${speechIntervals.length} speech intervals.`
    );

    let chunkIndex = 0;

    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE + 2,
      stage: 'Calculating audio chunks...',
    });

    for (const interval of speechIntervals) {
      const subChunks = chunkSpeechInterval({ interval, duration });
      for (const c of subChunks) {
        chunkIndex++; // Increment index first
        const outPath = path.join(
          tempDir,
          `chunk_${operationId}_${chunkIndex}.wav` // Use updated index
        );

        try {
          await ffmpegService.extractAudioSegment({
            inputPath: inputAudioPath,
            outputPath: outPath,
            startTime: c.start,
            // Calculate duration for ffmpeg based on chunk end/start
            duration: c.end - c.start,
            operationId: `${operationId}-chunk-${chunkIndex}`, // Unique ID per chunk op
          });
          createdChunkPaths.push(outPath); // Add to cleanup list *after* successful creation
        } catch (chunkError) {
          log.error(
            `[${operationId}] Failed to extract audio chunk ${chunkIndex} (${c.start}-${c.end}s):`,
            chunkError
          );
          // Decide how to handle: skip chunk, throw error? For now, just log and continue.
          continue; // Skip adding metadata if chunk creation failed
        }

        chunkMetadataList.push({
          path: outPath, // Use the defined outPath
          start: c.start,
          duration: c.end - c.start, // Duration of the segment *within* the original audio
          index: chunkIndex, // Use the correct index
        });
      }
    }
    log.info(
      `[${operationId}] Created ${chunkMetadataList.length} chunk metadata entries.`
    );

    progressCallback?.({
      percent: PROGRESS_CHUNKING_DONE,
      stage: `Prepared ${chunkMetadataList.length} audio chunks. Starting transcription...`,
    });

    log.info(
      `Grouping ${chunkMetadataList.length} chunks into windows of at least ${MIN_CONTEXT_SEC}s...`
    );
    const windows = groupIntoContextWindows(chunkMetadataList, MIN_CONTEXT_SEC);
    log.info(`Created ${windows.length} transcription windows.`);

    // --- Batch Processing Logic ---
    let completedWindows = 0;
    const totalWindows = windows.length;

    for (let i = 0; i < windows.length; i++) {
      if (signal?.aborted) throw new Error('Operation cancelled');

      const currentWindow = windows[i];
      if (currentWindow.length === 0) continue; // Should not happen with grouping logic, but safe check

      const windowIndex = i + 1;
      const combinedPath = path.join(
        tempDir,
        `window_${windowIndex}_${operationId}.wav`
      );
      const listFilePath = `${combinedPath}.txt`; // Temp file for ffmpeg concat list

      createdWindowFilePaths.push(combinedPath); // Track for cleanup
      createdWindowFilePaths.push(listFilePath); // Track for cleanup

      try {
        // 1. Create the concat list file
        const concatListContent = currentWindow
          .map(c => `file '${c.path.replace(/'/g, "'\\''")}'`)
          .join('\n'); // Basic escaping for paths
        await fsp.writeFile(listFilePath, concatListContent);

        // 2. Run ffmpeg concat demuxer
        log.debug(
          `[${operationId}] Concatenating ${currentWindow.length} chunks for window ${windowIndex}...`
        );
        const ffmpegConcat = spawn(ffmpegService.getFFmpegPath(), [
          '-f',
          'concat',
          '-safe',
          '0', // Allow unsafe file paths (relative paths in list)
          '-i',
          listFilePath,
          '-c',
          'copy', // Just copy streams, no re-encoding
          combinedPath,
        ]);

        let ffmpegErrorOutput = '';
        ffmpegConcat.stderr.on('data', data => {
          ffmpegErrorOutput += data.toString();
        });

        const closePromise = once(ffmpegConcat, 'close');
        const [exitCode] = (await closePromise) as [
          number | null,
          NodeJS.Signals | null,
        ]; // Type assertion needed for TS

        if (exitCode !== 0) {
          log.error(
            `[${operationId}] FFmpeg concat failed for window ${windowIndex}. Exit code: ${exitCode}. Error: ${ffmpegErrorOutput}`
          );
          // Decide how to handle: skip window, throw error? Let's skip for now.
          completedWindows++; // Still count as "processed" for progress
          continue;
        }
        log.debug(
          `[${operationId}] Concatenation complete for window ${windowIndex}: ${combinedPath}`
        );

        // 3. Transcribe the combined window
        const totalStart = currentWindow[0].start; // Start time is the start of the first chunk
        const totalDuration = currentWindow.reduce(
          (sum, c) => sum + c.duration,
          0
        );

        // Note: Using transcribeChunk directly. Its internal filtering will now apply
        // to the start/end of the combined window based on CHUNK_OVERLAP_SEC.
        const windowSegments = await transcribeChunk({
          chunkIndex: windowIndex, // Use window index for logging clarity
          chunkPath: combinedPath,
          startTime: totalStart,
          signal,
          openai,
          operationId: operationId as string,
          chunkDuration: totalDuration,
        });

        if (windowSegments.length > 0) {
          // Adjust timestamps before adding to the main list
          const adjustedSegments = windowSegments.map(seg => ({
            ...seg,
            start: seg.start + totalStart,
            end: seg.end + totalStart,
          }));
          overallSegments.push(...adjustedSegments);
          log.info(
            `[${operationId}] Successfully transcribed window ${windowIndex}. Added ${adjustedSegments.length} adjusted segments.`
          );
        } else {
          console.warn(
            `[${operationId}] Window ${windowIndex} returned no segments.`
          );
        }
      } catch (windowError) {
        console.error(
          `[${operationId}] Error processing window ${windowIndex}:`,
          windowError
        );
        // Optionally re-throw or just log and continue
      } finally {
        completedWindows++; // Increment progress counter

        // Update progress callback based on windows
        const currentProgressPercent = (completedWindows / totalWindows) * 100;
        const scaledProgress = Math.round(
          PROGRESS_TRANSCRIPTION_START +
            (currentProgressPercent / 100) *
              (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START)
        );

        progressCallback?.({
          percent: scaledProgress,
          stage: `Transcribing... (${completedWindows}/${totalWindows} windows complete)`,
          current: completedWindows,
          total: totalWindows,
        });
      }
    }
    // --- End Transcription Window Processing Logic ---

    // Ensure sorting happens after all batches are done
    overallSegments.sort((a, b) => a.start - b.start);

    // --- Add Pruning Step ---
    log.info(
      `[${operationId}] Pruning ${overallSegments.length} segments before finalization...`
    );
    const prunedSegments = pruneSegments({
      segments: overallSegments,
      minDurSec: PRUNING_MIN_DURATION_SEC, // Use constant
      minWords: PRUNING_MIN_WORDS, // Use constant
    });
    log.info(
      `[${operationId}] Pruned down to ${prunedSegments.length} segments.`
    );
    // --- End Pruning Step ---

    progressCallback?.({
      percent: PROGRESS_TRANSCRIPTION_END,
      stage: `Finalizing ${prunedSegments.length} subtitle segments...`,
    });

    // Use prunedSegments for the final output
    const finalSrtContent = buildSrt(prunedSegments);

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
    // Combine original chunk paths and window file paths for cleanup
    const allTempFilesToDelete = [
      ...createdChunkPaths,
      ...createdWindowFilePaths,
    ];
    log.info(
      `[${operationId}] Cleaning up ${allTempFilesToDelete.length} temporary files (chunks, windows, lists)...`
    );
    const deletionTasks = allTempFilesToDelete.map(filePath =>
      fsp.unlink(filePath).catch(err =>
        console.warn(
          `[${operationId}] Failed to delete temp file ${filePath}:`,
          err?.message || err // Log error message if available
        )
      )
    );
    await Promise.allSettled(deletionTasks);
    console.info(`[${operationId}] Finished cleaning up temporary files.`);
  }
}

async function transcribeChunk({
  chunkIndex,
  chunkPath,
  startTime,
  signal,
  openai,
  operationId,
  chunkDuration,
  options,
}: {
  chunkIndex: number;
  chunkPath: string;
  startTime: number;
  signal?: AbortSignal;
  openai: OpenAI;
  operationId: string;
  chunkDuration: number;
  options?: GenerateSubtitlesOptions;
}): Promise<SrtSegment[]> {
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
        temperature: 0,
        language: options?.sourceLang,
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

    const rawSegments = parseSrt(srtContent);
    const segments = rawSegments.map(segment => {
      if (
        typeof segment.start === 'number' &&
        typeof segment.end === 'number'
      ) {
        // Convert segment time (relative to chunk start) to absolute time
        const absoluteStart = segment.start + startTime;
        const absoluteEnd = segment.end + startTime;

        segment.start = absoluteStart;
        segment.end = Math.max(absoluteStart, absoluteEnd); // Ensure end >= start
      } else {
        log.warn(
          `[${operationId}] Chunk ${chunkIndex}: Segment found with non-numeric start/end times. Skipping offset.`,
          segment
        );
      }
      return segment;
    });

    const filteredSegments = segments.filter(segment => {
      // Define the start and end of the "central" non-overlapped region
      const centralRegionStart = startTime;
      const centralRegionEnd = startTime + chunkDuration;

      // Keep the segment if it overlaps with the central region at all.
      // This means the segment's end must be after the central region starts,
      // AND the segment's start must be before the central region ends.
      const overlapsCentralRegion =
        segment.end > centralRegionStart && segment.start < centralRegionEnd;

      return overlapsCentralRegion; // Keep if overlaps or if chunk is too short to have a central region
    });

    return filteredSegments;
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
      return [];
    }

    // Handle other errors
    return [];
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
Your task is to review and improve the provided batch of translated subtitles based on their original counterparts, focusing *only* on translation accuracy, natural phrasing, grammar, and style.

**Input:**
You will receive ${batch.segments.length} pairs of original and translated subtitles, prefixed with their line number (e.g., "[index] Original Text").

**Original Texts:**
${originalTexts}

**Translations to Review:**
${translatedTexts}

**Strict Instructions:**
1.  **Review Individually:** Review each translation line-by-line against its corresponding original text.
2.  **Improve Wording & Style ONLY:** Correct errors in translation, grammar, or style. Ensure the translation is natural and fluent in ${batch.targetLang}.
3.  **DO NOT CHANGE STRUCTURE:** You MUST **NOT** merge multiple lines into one, split a line into multiple lines, or reorder lines. Maintain the exact one-to-one correspondence.
4.  **Synchronization Rule (Handling Leftovers):** If a translated line's content (often short phrases like one or two words) clearly belongs linguistically to the *previous* line's translation and makes no sense on its own, output a **COMPLETELY BLANK** line for the current translation's review. Do *not* pull content from the *next* line to fill it.
5.  **Consistency:** Ensure consistent terminology and style throughout the batch.

**Output Format:**
- **Prefix EVERY line** you output with the exact delimiter \`@@SUB_LINE@@\` (including blank lines required by the Synchronization Rule).
- Provide **ONLY** the reviewed and improved translation text for **each** line in the batch, respecting the structure.
- Output exactly one reviewed translation per line, in the **exact same order** as the input batch.
- **DO NOT add extra blank lines between translations.** Only output a blank line if the Synchronization Rule explicitly requires it.
- **DO NOT** include the "[index]" prefixes in your output.
- If a line's translation should be blank according to the Synchronization Rule, output ONLY the prefix \`@@SUB_LINE@@\` followed by a newline.

Now, provide the reviewed translations for the ${batch.segments.length} lines above, adhering strictly to all instructions and ensuring each line starts with \`@@SUB_LINE@@\`:
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
    const parsedLines = splitByDelimiter.filter(
      (line, index) => index > 0 || line.trim() !== ''
    );

    // Check if the number of parsed lines matches the expected batch size
    if (parsedLines.length !== batch.segments.length) {
      log.warn(
        `[Review Fallback] Review output line count (${parsedLines.length}) does not match batch size (${batch.segments.length}). Expected ${batch.segments.length}. Falling back to original translations for this batch.`
      );
      log.info('--- Faulty Review Output ---');
      log.info(reviewedContent); // Log the faulty content for debugging
      log.info('--- End Faulty Review Output ---');
      // Return the original, unreviewed segments for this batch
      return batch.segments;
    }

    // If the line count is correct, proceed to map the results
    log.info(
      `[Review] Successfully parsed ${parsedLines.length} reviewed lines.`
    );
    return batch.segments.map((segment, idx) => {
      const [originalText] = segment.text.split('###TRANSLATION_MARKER###');
      // IMPORTANT: Ensure trimming happens correctly here if needed based on AI output habits
      const reviewedTranslation = parsedLines[idx]?.trim() ?? '';

      // Keep blank if the review explicitly returned blank, otherwise use the review.
      const finalTranslation = reviewedTranslation; // Simplified

      return {
        ...segment,
        text: `${originalText}###TRANSLATION_MARKER###${finalTranslation}`,
        originalText: originalText,
        // Keep a record of the reviewed text if needed, adjust property name if desired
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

/** Decode to 16‑kHz mono signed‑16‑bit PCM */
async function decodeToPcmBuffer({
  inputPath,
}: {
  inputPath: string;
}): Promise<Buffer> {
  const ffmpeg = spawn('ffmpeg', [
    '-i',
    inputPath,
    '-f',
    's16le',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-',
  ]);
  const chunks: Buffer[] = [];
  ffmpeg.stdout.on('data', b => chunks.push(b));
  await once(ffmpeg, 'close');
  return Buffer.concat(chunks);
}

export async function detectSpeechIntervals({
  inputPath,
  vadMode = 3, // 0–3 (3 = most aggressive)
  frameMs = 30, // WebRTC supports 10/20/30 ms
}: {
  inputPath: string;
  vadMode?: 0 | 1 | 2 | 3;
  frameMs?: 10 | 20 | 30;
}): Promise<Array<{ start: number; end: number }>> {
  const pcm = await decodeToPcmBuffer({ inputPath });
  const sampleRate = 16_000;
  const bytesPerFrame = ((sampleRate * frameMs) / 1000) * 2; // 16‑bit mono
  const vad = new Vad(sampleRate, vadMode);

  const intervals: Array<{ start: number; end: number }> = [];
  let speechOpen = false,
    segStart = 0;

  for (let i = 0; i + bytesPerFrame <= pcm.length; i += bytesPerFrame) {
    const frame = pcm.subarray(i, i + bytesPerFrame);
    const t = (i / bytesPerFrame) * (frameMs / 1000); // seconds
    const isSpeech = vad.process(frame);

    if (isSpeech && !speechOpen) {
      segStart = t;
      speechOpen = true;
    }
    if (!isSpeech && speechOpen) {
      intervals.push({ start: segStart, end: t });
      speechOpen = false;
    }
  }
  if (speechOpen)
    intervals.push({ start: segStart, end: pcm.length / 2 / sampleRate }); // flush
  return intervals;
}

export function normalizeSpeechIntervals({
  intervals,
  minGapSec = VAD_NORMALIZATION_MIN_GAP_SEC, // Use constant as default
  minDurSec = VAD_NORMALIZATION_MIN_DURATION_SEC, // Use constant as default
}: {
  intervals: Array<{ start: number; end: number }>;
  minGapSec?: number;
  minDurSec?: number;
}) {
  intervals.sort((a, b) => a.start - b.start);
  const merged: typeof intervals = [];
  for (const cur of intervals) {
    const last = merged.at(-1);
    if (last && cur.start - last.end < minGapSec) last.end = cur.end;
    else merged.push({ ...cur });
  }
  return merged.filter(i => i.end - i.start >= minDurSec);
}

export function chunkSpeechInterval({
  interval,
  duration,
}: {
  interval: { start: number; end: number };
  duration: number;
}): Array<{ start: number; end: number }> {
  const span = interval.end - interval.start;
  if (span <= CHUNK_MAX_SPEECH_SEC) {
    // Use constant
    return [
      {
        start: Math.max(0, interval.start - CHUNK_OVERLAP_SEC), // Use constant
        end: Math.min(duration, interval.end + CHUNK_OVERLAP_SEC), // Use constant
      },
    ];
  }
  // recursively split at mid‑point (cheap), or call a stronger‑pause finder
  const mid = (interval.start + interval.end) / 2;
  return [
    ...chunkSpeechInterval({
      interval: { start: interval.start, end: mid },
      duration,
    }),
    ...chunkSpeechInterval({
      interval: { start: mid, end: interval.end },
      duration,
    }),
  ];
}

export function pruneSegments({
  segments,
  rmsByTime, // Optional function to get RMS
  rmsThreshold = PRUNING_RMS_THRESHOLD, // Use constant as default
  minDurSec = PRUNING_MIN_DURATION_SEC, // Use constant as default
  minWords = PRUNING_MIN_WORDS, // Use constant as default
}: {
  segments: SrtSegment[];
  rmsByTime?: (t: number) => number; // Made optional
  rmsThreshold?: number;
  minDurSec?: number;
  minWords?: number;
}) {
  return segments.filter(seg => {
    const dur = seg.end - seg.start;
    const wordCount = seg.text.trim().split(/\s+/).length;

    // Basic duration and word count check
    const meetsBasicCriteria = dur >= minDurSec && wordCount >= minWords;
    if (!meetsBasicCriteria) {
      return false; // Fail fast if basic criteria aren't met
    }

    // Optional RMS check
    if (rmsByTime && typeof rmsThreshold === 'number') {
      const rms = rmsByTime((seg.start + seg.end) / 2);
      // If RMS check is enabled, it must also pass
      return rms >= rmsThreshold;
    }

    // If RMS check is not enabled, just return the basic criteria result
    return true;
  });
}

export function mergeCloseSegments({
  segments,
  maxGap = 0.2,
}: {
  segments: SrtSegment[];
  maxGap?: number;
}) {
  const out: SrtSegment[] = [];
  for (const cur of segments) {
    const prev = out.at(-1);
    if (prev && cur.start - prev.end < maxGap) {
      prev.end = cur.end;
      prev.text = `${prev.text} ${cur.text}`.trim();
    } else out.push({ ...cur });
  }
  return out;
}

/** Calculates the RMS (Root Mean Square) of a 16-bit signed PCM buffer */
function calculatePcmRms(pcm: Buffer): number {
  if (pcm.length === 0) {
    return 0;
  }
  let sumOfSquares = 0;
  // Process 16-bit samples (2 bytes each)
  for (let i = 0; i < pcm.length; i += 2) {
    // Read signed 16-bit integer in little-endian format
    const sample = pcm.readInt16LE(i);
    // Normalize sample to range [-1.0, 1.0] (approximately)
    const normalizedSample = sample / 32768.0;
    sumOfSquares += normalizedSample * normalizedSample;
  }
  // Calculate mean square and then RMS
  const meanSquare = sumOfSquares / (pcm.length / 2);
  return Math.sqrt(meanSquare);
}

/**
 * Groups chunks into windows ensuring each window's duration meets MIN_CONTEXT_SEC.
 */
function groupIntoContextWindows(
  chunks: Array<{ path: string; start: number; duration: number }>,
  minContextSec: number
): Array<typeof chunks> {
  const groups: Array<typeof chunks> = [];
  if (chunks.length === 0) {
    return groups;
  }

  let currentGroup: typeof chunks = [];
  let currentGroupDuration = 0;

  for (const chunk of chunks) {
    currentGroup.push(chunk);
    currentGroupDuration += chunk.duration;

    // If adding the current chunk meets or exceeds the minimum context, finalize the group
    if (currentGroupDuration >= minContextSec) {
      groups.push(currentGroup);
      // Reset for the next group
      currentGroup = [];
      currentGroupDuration = 0;
    }
  }

  // Handle any remaining chunks in the buffer
  if (currentGroup.length > 0) {
    // If there's a previous group, append the remaining buffer to it
    if (groups.length > 0) {
      const lastGroup = groups[groups.length - 1];
      // Add only if the last group itself isn't already large enough
      // (avoids making the last group excessively large if the remainder is tiny)
      const lastGroupDuration = lastGroup.reduce(
        (sum, c) => sum + c.duration,
        0
      );
      if (lastGroupDuration < minContextSec * 1.5) {
        // Heuristic: don't append to already large groups
        lastGroup.push(...currentGroup);
      } else {
        groups.push(currentGroup); // Create a final, potentially short group
      }
    } else {
      // If this is the only group (total duration < minContextSec), just add it
      groups.push(currentGroup);
    }
  }

  return groups;
}
