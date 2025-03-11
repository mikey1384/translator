import path from "path";
import log from "electron-log";
import { FFmpegService } from "./ffmpeg-service";
import { FileManager } from "./file-manager";
import { AIService } from "./ai-service";
import { parseSrt, buildSrt } from "../renderer/helpers/subtitle-utils";

// Import types from preload script
import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  TranslateSubtitlesOptions,
  TranslateSubtitlesResult,
  MergeSubtitlesOptions,
  MergeSubtitlesResult,
} from "../types";

export class SubtitleProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubtitleProcessingError";
  }
}

export class SubtitleProcessing {
  private ffmpegService: FFmpegService;
  private fileManager: FileManager;
  private aiService?: AIService;

  constructor(
    ffmpegService: FFmpegService,
    fileManager: FileManager,
    aiService?: AIService
  ) {
    this.ffmpegService = ffmpegService;
    this.fileManager = fileManager;
    this.aiService = aiService;
  }

  /**
   * Generate subtitles from a video file
   */
  async generateSubtitlesFromVideo(
    options: GenerateSubtitlesOptions,
    progressCallback?: (progress: { percent: number; stage: string }) => void
  ): Promise<GenerateSubtitlesResult> {
    try {
      // If options is undefined, default it to an object with targetLanguage 'original'
      if (!options) {
        options = { targetLanguage: "original" } as GenerateSubtitlesOptions;
      }
      if (!options.videoPath) {
        throw new SubtitleProcessingError("Video path is required");
      }

      if (!this.aiService) {
        throw new SubtitleProcessingError("AI Service is not available");
      }

      // Report initial progress
      if (progressCallback) {
        progressCallback({ percent: 0, stage: "Starting subtitle generation" });
      }

      // Extract audio from video
      if (progressCallback) {
        progressCallback({ percent: 10, stage: "Extracting audio from video" });
      }

      const audioPath = await this.ffmpegService.extractAudio(
        options.videoPath
      );

      // Use AI service to transcribe the audio
      const subtitlesContent = await this.aiService.generateSubtitlesFromAudio(
        audioPath,
        "original",
        (progress) => {
          if (progressCallback) {
            const scaledPercent = 10 + (progress.percent * 80) / 100;
            progressCallback({
              percent: scaledPercent,
              stage: progress.stage,
            });
          }
        }
      );

      let finalSubtitlesContent = subtitlesContent;
      const targetLang = options.targetLanguage
        ? options.targetLanguage
        : "original";
      if (targetLang.toLowerCase() !== "original") {
        if (progressCallback) {
          progressCallback({
            percent: 90,
            stage: "Starting subtitle translation",
          });
        }
        const translationResult = await this.translateSubtitles(
          {
            subtitles: subtitlesContent,
            targetLanguage: targetLang,
            sourceLanguage: "original",
          },
          progressCallback
        );
        finalSubtitlesContent = translationResult.translatedSubtitles;
      }

      // Save the SRT to a file
      await this.fileManager.writeTempFile(finalSubtitlesContent, ".srt");

      if (progressCallback) {
        progressCallback({
          percent: 100,
          stage: "Subtitle generation complete",
        });
      }

      return {
        subtitles: finalSubtitlesContent,
      };
    } catch (error) {
      log.error("Error generating subtitles:", error);
      throw new SubtitleProcessingError(
        `Failed to generate subtitles: ${error}`
      );
    }
  }

  /**
   * Translate subtitles to a different language
   */
  async translateSubtitles(
    options: TranslateSubtitlesOptions,
    progressCallback?: (progress: {
      percent: number;
      stage: string;
      partialResult?: string;
      current?: number;
      total?: number;
    }) => void
  ): Promise<TranslateSubtitlesResult> {
    try {
      if (!options.subtitles) {
        throw new SubtitleProcessingError("Subtitles content is required");
      }

      if (!this.aiService) {
        throw new SubtitleProcessingError("AI Service is not available");
      }

      // Set default values if not provided
      const targetLang = options.targetLanguage
        ? options.targetLanguage
        : "original";
      const sourceLang = options.sourceLanguage
        ? options.sourceLanguage
        : "original";

      // You can also define a language prompt based on targetLang if needed
      let languagePrompt = targetLang;
      if (targetLang.toLowerCase() === "korean") languagePrompt = "Korean";
      else if (targetLang.toLowerCase() === "japanese")
        languagePrompt = "Japanese";
      else if (targetLang.toLowerCase() === "chinese")
        languagePrompt = "Chinese";
      else if (targetLang.toLowerCase() === "spanish")
        languagePrompt = "Spanish";
      else if (targetLang.toLowerCase() === "french") languagePrompt = "French";
      else if (targetLang.toLowerCase() === "german") languagePrompt = "German";

      // Report initial progress
      progressCallback &&
        progressCallback({
          percent: 0,
          stage: "Starting subtitle translation",
          partialResult: "",
        });

      const originalSegments = parseSrt(options.subtitles);
      const totalSegments = originalSegments.length;
      const translatedSegments: any[] = [];
      const BATCH_SIZE = 10;

      for (
        let batchStart = 0;
        batchStart < totalSegments;
        batchStart += BATCH_SIZE
      ) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, totalSegments);
        const currentBatch = originalSegments.slice(batchStart, batchEnd);

        // Build prompt context for current batch
        const batchContextPrompt = currentBatch
          .map((segment, idx) => {
            const absoluteIndex = batchStart + idx;
            return `Line ${absoluteIndex + 1}: ${segment.text}`;
          })
          .join("\n");

        const combinedPrompt = `
You are a professional subtitle translator. Translate the following subtitles to natural, fluent ${languagePrompt}.

Here are the subtitles to translate:
${batchContextPrompt}

Translate ALL lines to ${languagePrompt}.
Respond with ONLY the translations in this format:
Line 1: <translation>
Line 2: <translation>
...and so on for each line

Ensure you preserve the exact line numbers as given in the original text.
IMPORTANT: Do not modify any part of the original text except for performing the translation.
        `;

        // Batch translation with retry logic
        const MAX_RETRIES = 3;
        const TIMEOUT_MS = 120000; // 2 minutes timeout
        let retryCount = 0;
        let batchTranslation = "";
        let success = false;
        let lastError: any = null;

        while (!success && retryCount < MAX_RETRIES) {
          try {
            batchTranslation = await this.aiService.translateBatch(
              combinedPrompt,
              sourceLang,
              targetLang
            );
            success = true;
          } catch (err: any) {
            lastError = err;
            if (
              err.message &&
              (err.message.includes("timeout") ||
                err.message.includes("rate") ||
                err.message.includes("ECONNRESET"))
            ) {
              retryCount++;
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * Math.pow(2, retryCount))
              );
            } else {
              break;
            }
          }
        }

        if (!success) {
          // Fallback: use original text for current batch
          currentBatch.forEach((segment) => {
            translatedSegments.push({
              ...segment,
              text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
              originalText: segment.text,
              translatedText: segment.text,
            });
          });
        } else {
          // Parse the batch translation response
          const translationLines = batchTranslation
            .split("\n")
            .filter((line) => line.trim() !== "");
          const lineRegex = /^Line\s+(\d+):\s*(.+)$/;
          for (let i = 0; i < currentBatch.length; i++) {
            const absoluteIndex = batchStart + i;
            const segment = currentBatch[i];
            let translatedText = segment.text; // default fallback
            for (const line of translationLines) {
              const match = line.match(lineRegex);
              if (match && parseInt(match[1]) === absoluteIndex + 1) {
                translatedText = match[2].trim();
                break;
              }
            }
            translatedSegments.push({
              ...segment,
              text: `${segment.text}###TRANSLATION_MARKER###${translatedText}`,
              originalText: segment.text,
              translatedText,
            });
          }
        }

        const overallProgress = Math.floor((batchEnd / totalSegments) * 100);
        const partialSrt = buildSrt(translatedSegments);
        progressCallback &&
          progressCallback({
            percent: overallProgress,
            stage: `Translating segments ${
              batchStart + 1
            } to ${batchEnd} of ${totalSegments}`,
            partialResult: partialSrt,
            current: batchEnd,
            total: totalSegments,
          });
      }

      const finalSrt = buildSrt(translatedSegments);
      progressCallback &&
        progressCallback({
          percent: 100,
          stage: "Subtitle translation complete",
          partialResult: finalSrt,
        });

      return {
        translatedSubtitles: finalSrt,
      };
    } catch (error) {
      log.error("Error translating subtitles:", error);
      throw new SubtitleProcessingError(
        `Failed to translate subtitles: ${error}`
      );
    }
  }

  /**
   * Merge subtitles with a video file
   */
  async mergeSubtitlesWithVideo(
    options: MergeSubtitlesOptions,
    progressCallback?: (progress: { percent: number; stage: string }) => void
  ): Promise<MergeSubtitlesResult> {
    try {
      if (!options.videoPath) {
        throw new SubtitleProcessingError("Video path is required");
      }

      if (!options.subtitlesPath) {
        throw new SubtitleProcessingError("Subtitles path is required");
      }

      // Report initial progress
      if (progressCallback) {
        progressCallback({
          percent: 0,
          stage: "Starting subtitle merging",
        });
      }

      // Output path for the merged video
      const outputPath =
        options.outputPath ||
        path.join(
          path.dirname(options.videoPath),
          `${path.basename(
            options.videoPath,
            path.extname(options.videoPath)
          )}_with_subtitles${path.extname(options.videoPath)}`
        );

      // Use FFmpeg to merge subtitles with video
      if (progressCallback) {
        progressCallback({ percent: 25, stage: "Processing video" });
      }

      await this.ffmpegService.mergeSubtitles(
        options.videoPath,
        options.subtitlesPath,
        outputPath,
        (progress) => {
          if (progressCallback) {
            // Scale FFmpeg progress (typically 0-100) to our 25-90% range
            const scaledProgress = 25 + progress.percent * 0.65;
            progressCallback({
              percent: Math.min(90, scaledProgress),
              stage: progress.stage || "Merging subtitles with video",
            });
          }
        }
      );

      if (progressCallback) {
        progressCallback({
          percent: 100,
          stage: "Subtitle merging complete",
        });
      }

      return {
        outputPath,
      };
    } catch (error) {
      log.error("Error merging subtitles with video:", error);
      throw new SubtitleProcessingError(
        `Failed to merge subtitles with video: ${error}`
      );
    }
  }
}
