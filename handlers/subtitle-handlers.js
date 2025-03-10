// SUBTITLE-HANDLERS.JS
// Import required modules
const { ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Load optional subtitle processing services if available
let subtitleService;
try {
  subtitleService = require("../dist/services/subtitle-processing").default;
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
      if (!subtitleService) {
        return { error: "Subtitle service is not available" };
      }

      // Process the job
      const result = await subtitleService.generateSubtitles(
        options,
        (progress) => {
          event.sender.send("generate-subtitles-progress", progress);
        }
      );

      return result;
    } catch (error) {
      console.error("Error in generate-subtitles handler:", error);
      return {
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
      if (!subtitleService) {
        return { error: "Subtitle service is not available" };
      }

      // Process the job
      const result = await subtitleService.translateSubtitles(
        options,
        (progress) => {
          event.sender.send("translate-subtitles-progress", progress);
        }
      );

      return result;
    } catch (error) {
      console.error("Error in translate-subtitles handler:", error);
      return {
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
      if (!subtitleService) {
        return { error: "Subtitle service is not available" };
      }

      // Process the job
      const result = await subtitleService.mergeSubtitlesWithVideo(
        options,
        (progress) => {
          event.sender.send("merge-subtitles-progress", progress);
        }
      );

      return result;
    } catch (error) {
      console.error("Error in merge-subtitles handler:", error);
      return {
        error: `Merge subtitles error: ${error.message || String(error)}`,
      };
    }
  });

  console.log("Merge subtitles handler registered");
}
