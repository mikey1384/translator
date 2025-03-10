// SUBTITLE-HANDLERS.JS
// Import required modules
const { ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Load service dependencies
let subtitleProcessingService;
let ffmpegService;
let fileManagerService;
let aiService;

try {
  // Import the required services
  const {
    SubtitleProcessing,
  } = require("../dist/services/subtitle-processing");
  const { FFmpegService } = require("../dist/services/ffmpeg-service");
  const { FileManager } = require("../dist/services/file-manager");
  const { AIService } = require("../dist/services/ai-service");

  // Initialize services
  ffmpegService = new FFmpegService();
  fileManagerService = new FileManager();
  aiService = new AIService(ffmpegService);
  subtitleProcessingService = new SubtitleProcessing(
    ffmpegService,
    fileManagerService,
    aiService
  );

  console.log("Subtitle processing services initialized successfully");
} catch (err) {
  console.warn("Subtitle processing service not loaded:", err.message);
}

// Register generate-subtitles handler
let generateHandlerExists = false;
try {
  ipcMain.handle("generate-subtitles", () => {});
  ipcMain.removeHandler("generate-subtitles");
} catch (err) {
  generateHandlerExists = true;
}

if (!generateHandlerExists) {
  ipcMain.handle("generate-subtitles", async (event, options) => {
    try {
      // If no subtitle service is available, return an error
      if (!subtitleProcessingService) {
        console.error("Subtitle processing service is not available");
        return {
          subtitles: "",
          error: "Subtitle service is not available",
        };
      }

      console.log(
        "Generate subtitles received options:",
        JSON.stringify(options, null, 2)
      );

      // Handle videoFile from browser context (packaged app)
      if (options.videoFileName && options.videoFileData) {
        console.log("Processing video file data from browser context");

        try {
          // Create a temporary file path
          const tempDir = fileManagerService.tempDir;
          const safeFileName = options.videoFileName.replace(
            /[^a-zA-Z0-9_.-]/g,
            "_"
          );
          const tempFilePath = path.join(
            tempDir,
            `temp_${Date.now()}_${safeFileName}`
          );

          console.log(`Created temporary path: ${tempFilePath}`);

          // Write the file data to the temporary path
          const buffer = Buffer.from(options.videoFileData);
          await fs.promises.writeFile(tempFilePath, buffer);

          console.log(`Wrote ${buffer.length} bytes to ${tempFilePath}`);

          // Set the videoPath to the temporary path
          options.videoPath = tempFilePath;

          // Remove the data from options to save memory
          delete options.videoFileData;

          // We'll continue processing with this path
          console.log(
            `Using temporary path for video processing: ${options.videoPath}`
          );
        } catch (error) {
          console.error("Error saving temporary file:", error);
          return {
            subtitles: "",
            error: "Failed to save temporary video file: " + error.message,
          };
        }
      }

      // Simple validation: ensure videoPath exists and is accessible
      if (!options.videoPath) {
        console.error(
          "No videoPath provided in options:",
          JSON.stringify(options)
        );

        // Check if there are other properties that might contain the path
        if (options.filePath) {
          console.log("Using filePath instead of videoPath");
          options.videoPath = options.filePath;
        } else if (options.filePaths && options.filePaths.length > 0) {
          console.log("Using filePaths[0] instead of videoPath");
          options.videoPath = options.filePaths[0];
        } else {
          return {
            subtitles: "",
            error: "Video path is required and was not provided in any field",
          };
        }
      }

      // Log path details to help with debugging
      console.log(`Video path: ${options.videoPath}`);
      console.log(
        `Path as Buffer: ${Buffer.from(options.videoPath).toString("hex")}`
      );

      // Normalize the path - important for paths with international characters
      options.videoPath = path.normalize(options.videoPath);
      console.log(`Normalized path: ${options.videoPath}`);

      // Verify file exists and is readable using fs.promises for better error handling
      try {
        await fs.promises.access(options.videoPath, fs.constants.R_OK);
        console.log(
          `Verified file exists and is readable: ${options.videoPath}`
        );
      } catch (err) {
        console.error(`Cannot access video file at ${options.videoPath}:`, err);

        // Try an alternative approach with Buffer for paths with international characters
        try {
          // Create a temporary copy with a simpler path if needed
          const tempDir = fileManagerService.tempDir;
          const tempFileName = `temp_video_${Date.now()}${path.extname(
            options.videoPath
          )}`;
          const tempFilePath = path.join(tempDir, tempFileName);

          console.log(`Creating temporary copy at: ${tempFilePath}`);

          // Copy the file to a temp location without international characters
          await fs.promises.copyFile(options.videoPath, tempFilePath);
          console.log(`Successfully copied to: ${tempFilePath}`);

          // Use the temporary path instead
          options.videoPath = tempFilePath;
        } catch (copyErr) {
          console.error(`Failed to create temporary copy:`, copyErr);
          return {
            subtitles: "",
            error: `Cannot access video file. The path may contain unsupported characters: ${err.message}`,
          };
        }
      }

      console.log(`Processing video file at: ${options.videoPath}`);

      // Process the job
      const result = await subtitleProcessingService.generateSubtitlesFromVideo(
        options,
        (progress) => {
          event.sender.send("generate-subtitles-progress", progress);
        }
      );

      return result;
    } catch (error) {
      console.error("Error in generate-subtitles handler:", error);
      return {
        subtitles: "",
        error: `Generate subtitles error: ${error.message || String(error)}`,
      };
    }
  });

  console.log("Generate subtitles handler registered");
}

// Register translate-subtitles handler
let translateHandlerExists = false;
try {
  ipcMain.handle("translate-subtitles", () => {});
  ipcMain.removeHandler("translate-subtitles");
} catch (err) {
  translateHandlerExists = true;
}

if (!translateHandlerExists) {
  ipcMain.handle("translate-subtitles", async (event, options) => {
    try {
      // If no subtitle service is available, return an error
      if (!subtitleProcessingService) {
        console.error("Subtitle processing service is not available");
        return {
          translatedSubtitles: "",
          error: "Subtitle service is not available",
        };
      }

      // Process the job
      const result = await subtitleProcessingService.translateSubtitles(
        options,
        (progress) => {
          event.sender.send("translate-subtitles-progress", progress);
        }
      );

      return result;
    } catch (error) {
      console.error("Error in translate-subtitles handler:", error);
      return {
        translatedSubtitles: "",
        error: `Translate subtitles error: ${error.message || String(error)}`,
      };
    }
  });

  console.log("Translate subtitles handler registered");
}

// Register merge-subtitles handler
let mergeHandlerExists = false;
try {
  ipcMain.handle("merge-subtitles", () => {});
  ipcMain.removeHandler("merge-subtitles");
} catch (err) {
  mergeHandlerExists = true;
}

if (!mergeHandlerExists) {
  ipcMain.handle("merge-subtitles", async (event, options) => {
    try {
      // If no subtitle service is available, return an error
      if (!subtitleProcessingService) {
        console.error("Subtitle processing service is not available");
        return {
          outputPath: "",
          error: "Subtitle service is not available",
        };
      }

      // Process the job
      const result = await subtitleProcessingService.mergeSubtitlesWithVideo(
        options,
        (progress) => {
          event.sender.send("merge-subtitles-progress", progress);
        }
      );

      return result;
    } catch (error) {
      console.error("Error in merge-subtitles handler:", error);
      return {
        outputPath: "",
        error: `Merge subtitles error: ${error.message || String(error)}`,
      };
    }
  });

  console.log("Merge subtitles handler registered");
}
