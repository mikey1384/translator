"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileManager = exports.FileManagerError = void 0;
const electron_1 = require("electron");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const electron_log_1 = __importDefault(require("electron-log"));
const os_1 = __importDefault(require("os"));
class FileManagerError extends Error {
    constructor(message) {
        super(message);
        this.name = "FileManagerError";
    }
}
exports.FileManagerError = FileManagerError;
class FileManager {
    tempDir;
    constructor() {
        // Safely get a temp directory - use app.getPath if available, otherwise use OS temp dir
        try {
            this.tempDir = path_1.default.join(electron_1.app.getPath("userData"), "temp");
        }
        catch (error) {
            // Fallback to OS temp directory if app is not ready yet
            electron_log_1.default.warn("Electron app not ready, using OS temp directory as fallback for FileManager");
            this.tempDir = path_1.default.join(os_1.default.tmpdir(), "translator-electron-temp");
        }
        electron_log_1.default.info(`FileManager temp directory: ${this.tempDir}`);
    }
    /**
     * Ensure the temporary directory exists
     */
    async ensureTempDir() {
        try {
            await promises_1.default.mkdir(this.tempDir, { recursive: true });
            electron_log_1.default.info(`Temp directory created at: ${this.tempDir}`);
        }
        catch (error) {
            electron_log_1.default.error("Failed to create temp directory:", error);
            throw new FileManagerError(`Failed to create temp directory: ${error}`);
        }
    }
    /**
     * Clean up the temporary directory
     */
    async cleanup() {
        try {
            await promises_1.default.rm(this.tempDir, { recursive: true, force: true });
            await promises_1.default.mkdir(this.tempDir, { recursive: true });
            electron_log_1.default.info("Temp directory cleaned up");
        }
        catch (error) {
            electron_log_1.default.error("Error cleaning up temp directory:", error);
            throw new FileManagerError(`Error cleaning up temp directory: ${error}`);
        }
    }
    /**
     * Save content to a file with a dialog
     */
    async saveFile(content, defaultPath, filters) {
        try {
            const window = electron_1.BrowserWindow.getFocusedWindow();
            if (!window) {
                throw new FileManagerError("No focused window found");
            }
            const { canceled, filePath } = await electron_1.dialog.showSaveDialog(window, {
                defaultPath,
                filters: filters || [
                    { name: "Text Files", extensions: ["txt", "srt"] },
                    { name: "All Files", extensions: ["*"] },
                ],
            });
            if (canceled || !filePath) {
                throw new FileManagerError("File save was canceled");
            }
            await promises_1.default.writeFile(filePath, content, "utf8");
            electron_log_1.default.info(`File saved to: ${filePath}`);
            return filePath;
        }
        catch (error) {
            electron_log_1.default.error("Error saving file:", error);
            throw new FileManagerError(`Error saving file: ${error}`);
        }
    }
    /**
     * Open a file with a dialog
     */
    async openFile(filters, multiple = false) {
        try {
            const window = electron_1.BrowserWindow.getFocusedWindow();
            if (!window) {
                throw new FileManagerError("No focused window found");
            }
            const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(window, {
                properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
                filters: filters || [
                    { name: "Media Files", extensions: ["mp4", "avi", "mkv", "mov"] },
                    { name: "Subtitle Files", extensions: ["srt", "ass", "vtt"] },
                    { name: "All Files", extensions: ["*"] },
                ],
            });
            if (canceled || filePaths.length === 0) {
                throw new FileManagerError("File open was canceled");
            }
            // For text files, also read the content
            const isTextFile = (filePath) => {
                const ext = path_1.default.extname(filePath).toLowerCase();
                return [".srt", ".ass", ".vtt", ".txt"].includes(ext);
            };
            if (filePaths.some(isTextFile)) {
                const fileContents = await Promise.all(filePaths.map(async (filePath) => {
                    if (isTextFile(filePath)) {
                        return await promises_1.default.readFile(filePath, "utf8");
                    }
                    return "";
                }));
                return { filePaths, fileContents };
            }
            return { filePaths };
        }
        catch (error) {
            electron_log_1.default.error("Error opening file:", error);
            throw new FileManagerError(`Error opening file: ${error}`);
        }
    }
    /**
     * Write content to a temporary file
     */
    async writeTempFile(content, extension) {
        try {
            const filename = `temp_${Date.now()}${extension}`;
            const filePath = path_1.default.join(this.tempDir, filename);
            await promises_1.default.writeFile(filePath, content, "utf8");
            electron_log_1.default.info(`Temp file written to: ${filePath}`);
            return filePath;
        }
        catch (error) {
            electron_log_1.default.error("Error writing temp file:", error);
            throw new FileManagerError(`Error writing temp file: ${error}`);
        }
    }
    /**
     * Read content from a file
     */
    async readFile(filePath) {
        try {
            return await promises_1.default.readFile(filePath, "utf8");
        }
        catch (error) {
            electron_log_1.default.error(`Error reading file ${filePath}:`, error);
            throw new FileManagerError(`Error reading file: ${error}`);
        }
    }
}
exports.FileManager = FileManager;
//# sourceMappingURL=file-manager.js.map