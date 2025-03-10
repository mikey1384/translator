import path from "path";
import log from "electron-log";
import { FFmpegService } from "./ffmpeg-service";
import { FileManager } from "./file-manager";
import { AIService } from "./ai-service";

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
      if (!options.videoPath) {
        throw new SubtitleProcessingError("Video path is required");
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

      // For now, we'll just create a dummy SRT file since we don't have the AI service integrated yet
      // In a real implementation, this would call the AI service to transcribe the audio
      if (progressCallback) {
        progressCallback({ percent: 50, stage: "Transcribing audio" });
      }

      // Simulate AI transcription with a dummy SRT
      const dummySrt = this.generateDummySrt();

      // Save the SRT to a file
      const srtPath = path.join(
        path.dirname(options.videoPath),
        `${path.basename(
          options.videoPath,
          path.extname(options.videoPath)
        )}.srt`
      );

      await this.fileManager.writeTempFile(dummySrt, ".srt");

      if (progressCallback) {
        progressCallback({
          percent: 100,
          stage: "Subtitle generation complete",
        });
      }

      return {
        subtitles: dummySrt,
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
    progressCallback?: (progress: { percent: number; stage: string }) => void
  ): Promise<TranslateSubtitlesResult> {
    try {
      if (!options.subtitles) {
        throw new SubtitleProcessingError("Subtitles content is required");
      }

      // Report initial progress
      if (progressCallback) {
        progressCallback({
          percent: 0,
          stage: "Starting subtitle translation",
        });
      }

      // For now, we'll just create a dummy translated SRT file
      // In a real implementation, this would call the AI service to translate the subtitles
      if (progressCallback) {
        progressCallback({ percent: 50, stage: "Translating subtitles" });
      }

      // Simulate AI translation with a dummy translated SRT
      const translatedSrt = this.generateDummyTranslatedSrt(
        options.targetLanguage
      );

      if (progressCallback) {
        progressCallback({
          percent: 100,
          stage: "Subtitle translation complete",
        });
      }

      return {
        translatedSubtitles: translatedSrt,
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

  /**
   * Generate a dummy SRT file for testing
   */
  private generateDummySrt(): string {
    return `1
00:00:01,000 --> 00:00:04,000
Hello, this is a test subtitle.

2
00:00:05,000 --> 00:00:08,000
This is a dummy SRT file for testing.

3
00:00:10,000 --> 00:00:15,000
In a real implementation, this would be generated by AI.`;
  }

  /**
   * Generate a dummy translated SRT file for testing
   */
  private generateDummyTranslatedSrt(language: string): string {
    if (language === "spanish") {
      return `1
00:00:01,000 --> 00:00:04,000
Hola, esto es un subtítulo de prueba.

2
00:00:05,000 --> 00:00:08,000
Este es un archivo SRT ficticio para pruebas.

3
00:00:10,000 --> 00:00:15,000
En una implementación real, esto sería generado por IA.`;
    }

    if (language === "french") {
      return `1
00:00:01,000 --> 00:00:04,000
Bonjour, ceci est un sous-titre de test.

2
00:00:05,000 --> 00:00:08,000
Ceci est un fichier SRT fictif pour les tests.

3
00:00:10,000 --> 00:00:15,000
Dans une implémentation réelle, cela serait généré par l'IA.`;
    }

    // Default to the original
    return this.generateDummySrt();
  }
}
