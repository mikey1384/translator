import {
  app,
  BrowserWindow,
  ipcMain as electronIpcMain,
  dialog,
} from "electron";
import path from "path";
import fs from "fs";
import isDev from "electron-is-dev";
import log from "electron-log";
import { setupIpcHandlers as initIpcHandlers } from "../electron/ipc-handlers";
import { FileManager } from "../electron/file-manager";
import dotenv from "dotenv";

// Ensure ipcMain is properly defined
const ipcMain = electronIpcMain;

// Load environment variables from .env file
dotenv.config();

// Log that environment variables are loaded (don't log the actual values)
console.log("Environment variables loaded:", {
  hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
  hasOpenAIKey: !!process.env.OPENAI_API_KEY,
});

// Configure logger
log.initialize({ preload: true });
log.info("Application starting...");

let mainWindow: BrowserWindow | null = null;
let fileManager: FileManager;

// Add these handlers right before creating the window
// Simple ping-pong handler for testing IPC
ipcMain.handle("ping", () => {
  console.log("Received ping from renderer");
  return "pong";
});

// Show message handler
ipcMain.handle("show-message", (_event, message) => {
  console.log("Show message requested:", message);
  dialog.showMessageBox({
    type: "info",
    title: "Message from Renderer",
    message: message,
  });
  return true;
});

// Create browser window
const createWindow = async () => {
  console.log("Creating window...");

  // Register the ffmpeg module paths
  // ... existing code ...

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
      devTools: true, // Always enable DevTools
    },
  });

  console.log(
    "Window created, preload path:",
    path.join(__dirname, "../preload/index.js")
  );

  // Determine the path to load in the window
  const indexPath = `file://${path.join(__dirname, "../../index.html")}`;
  console.log("Loading index file:", indexPath);

  // Load the index.html
  await mainWindow.loadURL(indexPath);
  console.log("Index file loaded");

  // Open the DevTools automatically
  mainWindow.webContents.openDevTools();
  console.log("DevTools opened");

  // Add event listeners for debugging
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("Page finished loading");
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription) => {
      console.error("Failed to load page:", errorCode, errorDescription);
    }
  );

  mainWindow.webContents.on(
    "console-message",
    (event, level, message, line, sourceId) => {
      const levels = ["verbose", "info", "warning", "error"];
      console.log(`[${levels[level]}] ${message} (${sourceId}:${line})`);
    }
  );

  // ... existing code ...
};

// Create window when Electron is ready
app.whenReady().then(async () => {
  try {
    // Initialize file manager after app is ready
    fileManager = new FileManager();

    // Set up temp directory
    await fileManager.ensureTempDir();

    // Set up IPC handlers
    initIpcHandlers();

    // Create the main window
    await createWindow();

    // On macOS, re-create window when dock icon is clicked
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    log.info("Application ready");
  } catch (error) {
    log.error("Error during app initialization:", error);
  }
});

// Quit the app when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Clean up resources before quitting
app.on("will-quit", async () => {
  try {
    if (fileManager) {
      await fileManager.cleanup();
      log.info("Temp directory cleaned up");
    }
  } catch (error) {
    log.error("Error cleaning up temp directory:", error);
  }
});

// Set up temporary directory for file processing
function setupTempDirectory() {
  const tempDir = path.join(app.getPath("userData"), "temp");

  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    log.info(`Temp directory created at: ${tempDir}`);
  } catch (error) {
    log.error("Failed to create temp directory:", error);
  }
}

// Clean up temporary directory
async function cleanupTempDirectory() {
  const tempDir = path.join(app.getPath("userData"), "temp");

  try {
    if (fs.existsSync(tempDir)) {
      // Simple cleanup - in a real app, add more sophisticated file management
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
    }
  } catch (error) {
    log.error("Error cleaning up temp directory:", error);
    throw error;
  }
}

// Set up IPC handlers (will expand these later)
function setupIpcHandlers() {
  // We'll implement these in separate modules
  // ipcMain.handle('generate-subtitles', handleGenerateSubtitles);
  // ipcMain.handle('translate-subtitles', handleTranslateSubtitles);
  // ipcMain.handle('merge-subtitles', handleMergeSubtitles);
}
