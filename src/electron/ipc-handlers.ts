import { ipcMain, IpcMainInvokeEvent } from "electron";
import path from "path";
import log from "electron-log";
import { FFmpegService } from "./ffmpeg-service";
import { FileManager } from "./file-manager";
import { SubtitleProcessing } from "../api/subtitle-processing";

// Import types from preload script
import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  TranslateSubtitlesOptions,
  TranslateSubtitlesResult,
  MergeSubtitlesOptions,
  MergeSubtitlesResult,
  SaveFileOptions,
  SaveFileResult,
  OpenFileOptions,
  OpenFileResult,
} from "../preload";

// Create service instances
const ffmpegService = new FFmpegService();
const fileManager = new FileManager();
const subtitleProcessing = new SubtitleProcessing(ffmpegService, fileManager);

/**
 * Set up all IPC handlers
 */
export function setupIpcHandlers(): void {
  // Subtitle generation
  ipcMain.handle(
    "generate-subtitles",
    async (
      event: IpcMainInvokeEvent,
      options: GenerateSubtitlesOptions
    ): Promise<GenerateSubtitlesResult> => {
      try {
        log.info("Generating subtitles with options:", options);

        const result = await subtitleProcessing.generateSubtitlesFromVideo(
          options,
          (progress) => {
            event.sender.send("generate-subtitles-progress", progress);
          }
        );

        return result;
      } catch (error) {
        log.error("Error generating subtitles:", error);
        return {
          subtitles: "",
          error: `Error generating subtitles: ${error}`,
        };
      }
    }
  );

  // Subtitle translation
  ipcMain.handle(
    "translate-subtitles",
    async (
      event: IpcMainInvokeEvent,
      options: TranslateSubtitlesOptions
    ): Promise<TranslateSubtitlesResult> => {
      try {
        log.info("Translating subtitles with options:", options);

        const result = await subtitleProcessing.translateSubtitles(
          options,
          (progress) => {
            event.sender.send("translate-subtitles-progress", progress);
          }
        );

        return result;
      } catch (error) {
        log.error("Error translating subtitles:", error);
        return {
          translatedSubtitles: "",
          error: `Error translating subtitles: ${error}`,
        };
      }
    }
  );

  // Merge subtitles with video
  ipcMain.handle(
    "merge-subtitles",
    async (
      event: IpcMainInvokeEvent,
      options: MergeSubtitlesOptions
    ): Promise<MergeSubtitlesResult> => {
      try {
        log.info("Merging subtitles with options:", options);

        const outputPath = await ffmpegService.mergeSubtitlesWithVideo(
          options.videoPath,
          options.subtitlesPath,
          (progress) => {
            event.sender.send("merge-subtitles-progress", {
              percent: progress,
              stage: "Merging subtitles with video",
            });
          }
        );

        return { outputPath };
      } catch (error) {
        log.error("Error merging subtitles:", error);
        return {
          outputPath: "",
          error: `Error merging subtitles: ${error}`,
        };
      }
    }
  );

  // Save file
  ipcMain.handle(
    "save-file",
    async (
      _event: IpcMainInvokeEvent,
      options: SaveFileOptions
    ): Promise<SaveFileResult> => {
      try {
        log.info("Saving file with options:", options);

        const filePath = await fileManager.saveFile(
          options.content,
          options.defaultPath,
          options.filters
        );

        return { filePath };
      } catch (error) {
        log.error("Error saving file:", error);
        return {
          filePath: "",
          error: `Error saving file: ${error}`,
        };
      }
    }
  );

  // Open file
  ipcMain.handle(
    "open-file",
    async (
      _event: IpcMainInvokeEvent,
      options: OpenFileOptions
    ): Promise<OpenFileResult> => {
      try {
        log.info("Opening file with options:", options);

        const result = await fileManager.openFile(
          options.filters,
          options.multiple
        );

        return result;
      } catch (error) {
        log.error("Error opening file:", error);
        return {
          filePaths: [],
          error: `Error opening file: ${error}`,
        };
      }
    }
  );

  log.info("IPC handlers set up");
}
