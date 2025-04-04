import path from 'path';
import { FFmpegService } from './ffmpeg-service';
import { FileManager } from './file-manager';
import { parseSrt, buildSrt } from '../renderer/helpers/subtitle-utils';
import fs from 'fs';
import fsp from 'fs/promises';
import keytar from 'keytar';
import { AI_MODELS } from '../renderer/constants';
import { SrtSegment } from '../types/interface';
import Anthropic from '@anthropic-ai/sdk';
import { OpenAI } from 'openai';
// import log from 'electron-log';

import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  MergeSubtitlesOptions,
} from '../types/interface';

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

async function generateSubtitlesFromAudio({
  inputAudioPath,
  progressCallback,
}: {
  inputAudioPath: string;
  progressCallback?: (progress: {
    percent: number;
    stage: string;
    current?: number;
    total?: number;
    partialResult?: string;
    error?: string;
  }) => void;
}): Promise<string> {
  let openai: OpenAI;
  try {
    const openaiApiKey = await getApiKey('openai');
    openai = new OpenAI({ apiKey: openaiApiKey });
  } catch (keyError) {
    progressCallback?.({
      percent: 0,
      stage: 'Error',
      error: keyError instanceof Error ? keyError.message : String(keyError),
    });
    throw new SubtitleProcessingError(
      keyError instanceof Error ? keyError.message : String(keyError)
    );
  }

  const _callId = `${Date.now()}${Math.random().toString(36).substring(2, 7)}`;
  const tempDir = path.dirname(inputAudioPath);
  const overallSrtSegments: SrtSegment[] = [];
  const createdChunkPaths: string[] = [];

  const ANALYSIS_PROGRESS = 5;
  const CHUNKING_PROGRESS = 15;
  const TRANSCRIPTION_START_PROGRESS = 20;
  const TRANSCRIPTION_END_PROGRESS = 95;
  const FINALIZING_PROGRESS = 100;

  try {
    if (!fs.existsSync(inputAudioPath)) {
      throw new SubtitleProcessingError(
        `Audio file not found: ${inputAudioPath}`
      );
    }

    progressCallback?.({ percent: 0, stage: 'Analyzing audio file...' });

    const ffmpegService = new FFmpegService();
    const duration = await ffmpegService.getMediaDuration(inputAudioPath);
    if (isNaN(duration) || duration <= 0) {
      throw new SubtitleProcessingError(
        'Could not determine valid audio duration.'
      );
    }
    console.info(`[${_callId}] Audio duration: ${duration}s`);
    progressCallback?.({ percent: ANALYSIS_PROGRESS, stage: 'Audio analyzed' });

    const TARGET_CHUNK_DURATION_SECONDS = 10 * 60;
    const numChunks = Math.max(
      1,
      Math.ceil(duration / TARGET_CHUNK_DURATION_SECONDS)
    );
    console.info(
      `[${_callId}] Calculated ${numChunks} chunks based on ${TARGET_CHUNK_DURATION_SECONDS}s target duration.`
    );
    progressCallback?.({
      percent: CHUNKING_PROGRESS,
      stage: `Preparing ${numChunks} audio chunks...`,
    });

    const chunkProcessingPromises: Promise<SrtSegment[]>[] = [];

    for (let i = 0; i < numChunks; i++) {
      const startTime = i * TARGET_CHUNK_DURATION_SECONDS;
      const currentChunkDuration = Math.min(
        TARGET_CHUNK_DURATION_SECONDS,
        duration - startTime
      );
      const chunkIndex = i + 1;

      if (currentChunkDuration <= 0) continue;

      const chunkPath = path.join(
        tempDir,
        `chunk_${_callId}_${chunkIndex}.mp3`
      );
      createdChunkPaths.push(chunkPath);

      console.info(
        `[${_callId}] Extracting chunk ${chunkIndex}/${numChunks} (Start: ${startTime.toFixed(3)}s, Duration: ${currentChunkDuration.toFixed(3)}s) to ${chunkPath}`
      );

      await ffmpegService.extractAudioSegment(
        inputAudioPath,
        chunkPath,
        startTime,
        currentChunkDuration
      );
      console.info(
        `[${_callId}] Successfully extracted chunk ${chunkIndex}: ${chunkPath}`
      );

      chunkProcessingPromises.push(
        (async () => {
          const progressBeforeApiCall =
            TRANSCRIPTION_START_PROGRESS +
            (i / numChunks) *
              (TRANSCRIPTION_END_PROGRESS - TRANSCRIPTION_START_PROGRESS);
          progressCallback?.({
            percent: progressBeforeApiCall,
            stage: `Transcribing chunk ${chunkIndex}/${numChunks}...`,
            current: chunkIndex,
            total: numChunks,
          });

          try {
            console.info(
              `[${_callId}] Sending chunk ${chunkIndex} to OpenAI Whisper API.`
            );
            const fileStream = createFileFromPath(chunkPath);

            const response = await openai.audio.transcriptions.create({
              model: AI_MODELS.WHISPER.id,
              file: fileStream,
              response_format: 'srt',
            });

            console.info(
              `[${_callId}] Received transcription for chunk ${chunkIndex}.`
            );

            const srtContent = response as unknown as string;
            let chunkSegments: SrtSegment[] = [];
            if (srtContent && typeof srtContent === 'string') {
              chunkSegments = parseSrt(srtContent);
            } else {
              console.warn(
                `[${_callId}] Received unexpected non-SRT response for chunk ${chunkIndex}:`,
                response
              );
            }

            chunkSegments.forEach(segment => {
              segment.start += startTime;
              segment.end += startTime;
            });

            const progressAfterApiCall =
              TRANSCRIPTION_START_PROGRESS +
              ((i + 0.8) / numChunks) *
                (TRANSCRIPTION_END_PROGRESS - TRANSCRIPTION_START_PROGRESS);
            progressCallback?.({
              percent: progressAfterApiCall,
              stage: `Processed chunk ${chunkIndex}/${numChunks}`,
              current: chunkIndex,
              total: numChunks,
            });

            return chunkSegments;
          } catch (error) {
            console.error(
              `[${_callId}] Error transcribing chunk ${chunkIndex} (${chunkPath}):`,
              error
            );
            progressCallback?.({
              percent:
                TRANSCRIPTION_START_PROGRESS +
                ((i + 0.9) / numChunks) *
                  (TRANSCRIPTION_END_PROGRESS - TRANSCRIPTION_START_PROGRESS),
              stage: `Error on chunk ${chunkIndex}/${numChunks}`,
              error: `Chunk ${chunkIndex} failed: ${error instanceof Error ? error.message : String(error)}`,
              current: chunkIndex,
              total: numChunks,
            });
            return [];
          }
        })()
      );
    }

    const results = await Promise.allSettled(chunkProcessingPromises);

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        overallSrtSegments.push(...result.value);
        console.info(
          `[${_callId}] Added ${result.value.length} segments from chunk ${index + 1}`
        );
      } else if (result.status === 'rejected') {
        console.error(
          `[${_callId}] Promise for chunk ${index + 1} rejected:`,
          result.reason
        );
      } else if (result.status === 'fulfilled' && result.value.length === 0) {
        console.warn(
          `[${_callId}] Chunk ${index + 1} processing returned no segments (potentially due to an error).`
        );
      }
    });

    overallSrtSegments.sort((a, b) => a.start - b.start);

    overallSrtSegments.forEach((segment, index) => {
      segment.index = index + 1;
    });

    console.info(
      `[${_callId}] Total segments processed: ${overallSrtSegments.length}`
    );
    progressCallback?.({
      percent: TRANSCRIPTION_END_PROGRESS,
      stage: 'Finalizing subtitles...',
    });

    const finalSrtContent = buildSrt(overallSrtSegments);

    progressCallback?.({
      percent: FINALIZING_PROGRESS,
      stage: 'Transcription complete!',
    });
    return finalSrtContent;
  } catch (error) {
    console.error(`[${_callId}] Error in generateSubtitlesFromAudio:`, error);
    progressCallback?.({
      percent: 100,
      stage: 'Error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error instanceof SubtitleProcessingError
      ? error
      : new SubtitleProcessingError(
          error instanceof Error ? error.message : String(error)
        );
  } finally {
    console.info(
      `[${_callId}] Cleaning up ${createdChunkPaths.length} audio chunks...`
    );
    const cleanupPromises = createdChunkPaths.map(chunkPath =>
      fsp
        .unlink(chunkPath)
        .catch(err =>
          console.warn(`[${_callId}] Failed to delete chunk ${chunkPath}:`, err)
        )
    );
    await Promise.allSettled(cleanupPromises);
    console.info(`[${_callId}] Chunk cleanup finished.`);
  }
}

export async function generateSubtitlesFromVideo(
  options: GenerateSubtitlesOptions,
  progressCallback?: (progress: {
    percent: number;
    stage: string;
    current?: number;
    total?: number;
    partialResult?: string;
    error?: string;
  }) => void,
  services?: {
    ffmpegService: FFmpegService;
    fileManager: FileManager;
  }
): Promise<GenerateSubtitlesResult> {
  if (!options) {
    options = { targetLanguage: 'original' } as GenerateSubtitlesOptions;
  }
  if (!options.videoPath) {
    throw new SubtitleProcessingError('Video path is required');
  }
  if (!services?.ffmpegService || !services?.fileManager) {
    throw new SubtitleProcessingError('Required services not provided');
  }

  const { ffmpegService, fileManager } = services;
  let audioPath: string | null = null;

  const targetLang = options.targetLanguage?.toLowerCase() || 'original';
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

  const scaleProgress = (
    percent: number,
    stage: { start: number; end: number }
  ) => {
    const stageSpan = stage.end - stage.start;
    const calculatedPercent = stage.start + (percent / 100) * stageSpan;
    return Math.round(calculatedPercent);
  };

  try {
    if (progressCallback) {
      progressCallback({
        percent: STAGE_AUDIO_EXTRACTION.start,
        stage: 'Starting subtitle generation',
      });
      progressCallback({
        percent: STAGE_AUDIO_EXTRACTION.end,
        stage: 'Extracting audio from video',
      });
    }

    audioPath = await ffmpegService.extractAudio(options.videoPath);

    const subtitlesContent = await generateSubtitlesFromAudio({
      inputAudioPath: audioPath,
      progressCallback: (progress: any) => {
        if (progressCallback) {
          progressCallback({
            percent: scaleProgress(progress.percent, STAGE_TRANSCRIPTION),
            stage: progress.stage,
            partialResult: progress.partialResult,
            current: progress.current,
            total: progress.total,
            error: progress.error,
          });
        }
      },
    });

    if (!isTranslationNeeded) {
      await fileManager.writeTempFile(subtitlesContent, '.srt');
      if (progressCallback) {
        progressCallback({
          percent: STAGE_FINALIZING.end,
          stage: 'Transcription complete',
          partialResult: subtitlesContent,
        });
      }
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

      const batchToTranslate = {
        segments: currentBatchOriginals.map(seg => ({ ...seg })),
        startIndex: batchStart,
        endIndex: batchEnd,
      };

      const translatedBatch = await translateBatch(
        batchToTranslate,
        targetLang
      );

      for (let i = 0; i < translatedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = translatedBatch[i];
      }

      if (progressCallback) {
        const overallProgressPercent = (batchEnd / totalSegments) * 100;
        const cumulativeSrt = buildSrt(segmentsInProcess);

        progressCallback({
          percent: scaleProgress(overallProgressPercent, STAGE_TRANSLATION),
          stage: `Translating batch ${Math.ceil(batchEnd / TRANSLATION_BATCH_SIZE)} of ${Math.ceil(totalSegments / TRANSLATION_BATCH_SIZE)}`,
          partialResult: cumulativeSrt,
          current: batchEnd,
          total: totalSegments,
        });
      }
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

      const batchToReview = {
        segments: currentBatchTranslated.map(seg => ({ ...seg })),
        startIndex: batchStart,
        endIndex: batchEnd,
        targetLang: targetLang,
      };

      const reviewedBatch = await reviewTranslationBatch(batchToReview);

      for (let i = 0; i < reviewedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = reviewedBatch[i];
      }

      if (progressCallback) {
        const overallProgressPercent =
          (batchEnd / segmentsInProcess.length) * 100;

        const cumulativeReviewedSrt = buildSrt(segmentsInProcess);

        progressCallback({
          percent: scaleProgress(overallProgressPercent, STAGE_REVIEW),
          stage: `Reviewing batch ${Math.ceil(batchEnd / REVIEW_BATCH_SIZE)} of ${Math.ceil(segmentsInProcess.length / REVIEW_BATCH_SIZE)}`,
          partialResult: cumulativeReviewedSrt,
          current: batchEnd,
          total: segmentsInProcess.length,
        });
      }
    }

    if (progressCallback) {
      progressCallback({
        percent: STAGE_FINALIZING.start,
        stage: 'Finalizing subtitles',
      });
    }

    const indexedSegments = segmentsInProcess.map((block, idx) => ({
      ...block,
      index: idx + 1,
    }));

    const gapFilledSegments = extendShortSubtitleGaps(indexedSegments, 3);

    const finalSegments = fillBlankTranslations(gapFilledSegments);

    const finalSubtitlesContent = buildSrt(finalSegments);
    await fileManager.writeTempFile(finalSubtitlesContent, '.srt');

    if (progressCallback) {
      progressCallback({
        percent: STAGE_FINALIZING.end,
        stage: 'Translation and review complete',
        partialResult: finalSubtitlesContent,
      });
    }

    return { subtitles: finalSubtitlesContent };
  } finally {
    if (audioPath) {
      try {
        await fsp.unlink(audioPath);
      } catch (cleanupError) {
        console.error(
          `Failed to delete temporary audio file ${audioPath}:`,
          cleanupError
        );
      }
    }
  }
}

export async function mergeSubtitlesWithVideo(
  options: MergeSubtitlesOptions,
  operationId: string,
  progressCallback?: (progress: { percent: number; stage: string }) => void,
  services?: {
    ffmpegService: FFmpegService;
  }
): Promise<{ outputPath: string }> {
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
  if (!services?.ffmpegService) {
    throw new SubtitleProcessingError('FFmpeg service not provided');
  }

  const { ffmpegService } = services;

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

  console.info(
    `[${operationId}] Target temporary output path (forced MP4): ${outputPath}`
  );

  try {
    const mergeResult = await ffmpegService.mergeSubtitles(
      options.videoPath!,
      options.subtitlesPath!,
      outputPath,
      operationId,
      options.fontSize,
      options.stylePreset,
      progress => {
        if (progressCallback) {
          progressCallback(progress);
        }
      }
    );

    // Check if file exists - if empty string was returned, it means the operation was cancelled
    if (!mergeResult || mergeResult === '' || !fs.existsSync(outputPath)) {
      console.info(
        `[${operationId}] Merge operation was cancelled or failed to create output file`
      );
      if (progressCallback) {
        progressCallback({ percent: 100, stage: 'Merge cancelled' });
      }
      return { outputPath: '' }; // Return empty path to indicate cancellation
    }

    if (progressCallback) {
      progressCallback({
        percent: 100,
        stage: 'Merge complete, ready to save',
      });
    }
    return { outputPath };
  } catch (error) {
    console.error(`[${operationId}] Error during merge:`, error);
    if (progressCallback) {
      progressCallback({
        percent: 100,
        stage: `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // Check if this was a cancellation (no active process with this ID)
    if (!services.ffmpegService.isActiveProcess(operationId)) {
      console.info(
        `[${operationId}] Merge was cancelled, returning empty path`
      );
      return { outputPath: '' }; // Empty path indicates cancellation
    }

    throw error; // Re-throw if it was a genuine error
  }
}

async function translateBatch(
  batch: { segments: any[]; startIndex: number; endIndex: number },
  targetLang: string
): Promise<any[]> {
  let anthropic: Anthropic;
  try {
    const anthropicApiKey = await getApiKey('anthropic');
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
      const response = await anthropic.messages.create({
        model: AI_MODELS.CLAUDE_3_7_SONNET,
        max_tokens: AI_MODELS.MAX_TOKENS,
        messages: [{ role: 'user', content: combinedPrompt }],
      } as Anthropic.MessageCreateParams);

      const translationResponse = response as Anthropic.Message;

      let translation = '';
      if (
        translationResponse.content &&
        translationResponse.content.length > 0 &&
        translationResponse.content[0].type === 'text'
      ) {
        translation = translationResponse.content[0].text;
      } else {
        console.warn(
          'Translation response content was not in the expected format.'
        );
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
      if (
        err.message &&
        (err.message.includes('timeout') ||
          err.message.includes('rate') ||
          err.message.includes('ECONNRESET'))
      ) {
        retryCount++;
        const delay = 1000 * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return batch.segments.map(segment => ({
        ...segment,
        text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
        originalText: segment.text,
        translatedText: segment.text,
      }));
    }
  }

  return batch.segments.map(segment => ({
    ...segment,
    text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
    originalText: segment.text,
    translatedText: segment.text,
  }));
}

async function reviewTranslationBatch(batch: {
  segments: any[];
  startIndex: number;
  endIndex: number;
  targetLang: string;
}): Promise<any[]> {
  let anthropic: Anthropic;
  try {
    const anthropicApiKey = await getApiKey('anthropic');
    anthropic = new Anthropic({ apiKey: anthropicApiKey });
  } catch (keyError) {
    throw new SubtitleProcessingError(
      keyError instanceof Error ? keyError.message : String(keyError)
    );
  }

  const batchItems = batch.segments.map((block: any, idx: number) => {
    const absoluteIndex = batch.startIndex + idx;
    const [original, translation] = block.text.split(
      '###TRANSLATION_MARKER###'
    );
    return {
      index: absoluteIndex + 1,
      original: original?.trim() || '',
      translation: (translation || original || '').trim(),
    };
  });

  const originalTexts = batchItems
    .map(item => `[${item.index}] ${item.original}`)
    .join('\n');
  const translatedTexts = batchItems
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
    const response = await anthropic.messages.create({
      model: AI_MODELS.CLAUDE_3_7_SONNET,
      max_tokens: AI_MODELS.MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    } as Anthropic.MessageCreateParams);

    const reviewResponse = response as Anthropic.Message;

    let reviewedContent = '';
    if (
      reviewResponse.content &&
      reviewResponse.content.length > 0 &&
      reviewResponse.content[0].type === 'text'
    ) {
      reviewedContent = reviewResponse.content[0].text;
    } else {
      console.warn('Review response content was not in the expected format.');
      console.warn(
        `Translation review output format unexpected. Using original translations for this batch.`
      );
      return batch.segments;
    }

    const reviewedLines = reviewedContent.split('\n');

    if (reviewedLines.length !== batch.segments.length) {
      console.warn(
        `Translation review output line count (${reviewedLines.length}) does not match batch size (${batch.segments.length}). Using original translations for this batch.`
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
  } catch (error) {
    console.error('Error calling Claude for translation review batch:', error);
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
      console.warn(
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
