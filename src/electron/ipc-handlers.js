"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupIpcHandlers = setupIpcHandlers;
const electron_1 = require("electron");
const electron_log_1 = __importDefault(require("electron-log"));
const ffmpeg_service_1 = require("./ffmpeg-service");
const file_manager_1 = require("./file-manager");
const subtitle_processing_1 = require("../api/subtitle-processing");
const ai_service_1 = require("../api/ai-service");
// Ensure ipcMain is properly defined
const ipcMain = electron_1.ipcMain;
// Service instances - these will be initialized when setupIpcHandlers is called
let ffmpegService;
let fileManager;
let aiService;
let subtitleProcessing;
/**
 * Set up all IPC handlers
 */
function setupIpcHandlers() {
    try {
        // Verify ipcMain exists and has the handle method
        if (!ipcMain) {
            electron_log_1.default.error("IPC main is not properly initialized");
            throw new Error("IPC main is missing or not properly initialized");
        }
        if (typeof ipcMain.handle !== "function") {
            electron_log_1.default.error("IPC main missing handle method", { ipcMain });
            throw new Error("IPC main does not have handle method");
        }
        // Initialize services
        electron_log_1.default.info("Initializing services for IPC handlers");
        ffmpegService = new ffmpeg_service_1.FFmpegService();
        fileManager = new file_manager_1.FileManager();
        aiService = new ai_service_1.AIService(ffmpegService);
        subtitleProcessing = new subtitle_processing_1.SubtitleProcessing(ffmpegService, fileManager, aiService);
    }
    catch (error) {
        electron_log_1.default.error("Error setting up IPC handlers:", error);
        throw error;
    }
    // Subtitle generation
    ipcMain.handle("generate-subtitles", async (event, options) => {
        try {
            electron_log_1.default.info("Generating subtitles with options:", options);
            const result = await subtitleProcessing.generateSubtitlesFromVideo(options, (progress) => {
                event.sender.send("generate-subtitles-progress", progress);
            });
            return result;
        }
        catch (error) {
            electron_log_1.default.error("Error generating subtitles:", error);
            return {
                subtitles: "",
                error: error instanceof Error ? error.message : String(error),
            };
        }
    });
    // Subtitle translation
    ipcMain.handle("translate-subtitles", async (event, options) => {
        try {
            electron_log_1.default.info("Translating subtitles with options:", options);
            const result = await subtitleProcessing.translateSubtitles(options, (progress) => {
                event.sender.send("translate-subtitles-progress", progress);
            });
            return result;
        }
        catch (error) {
            electron_log_1.default.error("Error translating subtitles:", error);
            return {
                translatedSubtitles: "",
                error: `Error translating subtitles: ${error}`,
            };
        }
    });
    // Merge subtitles with video
    ipcMain.handle("merge-subtitles", async (event, options) => {
        try {
            electron_log_1.default.info("Merging subtitles with options:", options);
            const outputPath = await ffmpegService.mergeSubtitlesWithVideo(options.videoPath, options.subtitlesPath, (progress) => {
                event.sender.send("merge-subtitles-progress", {
                    percent: progress,
                    stage: "Merging subtitles with video",
                });
            });
            return { outputPath };
        }
        catch (error) {
            electron_log_1.default.error("Error merging subtitles:", error);
            return {
                outputPath: "",
                error: `Error merging subtitles: ${error}`,
            };
        }
    });
    // Save file
    ipcMain.handle("save-file", async (_event, options) => {
        try {
            electron_log_1.default.info("Saving file with options:", options);
            const filePath = await fileManager.saveFile(options.content, options.defaultPath, options.filters);
            return { filePath };
        }
        catch (error) {
            electron_log_1.default.error("Error saving file:", error);
            return {
                filePath: "",
                error: `Error saving file: ${error}`,
            };
        }
    });
    // Open file
    ipcMain.handle("open-file", async (_event, options) => {
        try {
            electron_log_1.default.info("Opening file with options:", options);
            const result = await fileManager.openFile(options.filters, options.multiple);
            return result;
        }
        catch (error) {
            electron_log_1.default.error("Error opening file:", error);
            return {
                filePaths: [],
                error: `Error opening file: ${error}`,
            };
        }
    });
    electron_log_1.default.info("IPC handlers set up");
}
//# sourceMappingURL=ipc-handlers.js.map