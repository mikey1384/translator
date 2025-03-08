import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import isDev from "electron-is-dev";
import log from "electron-log";
import { setupIpcHandlers as initIpcHandlers } from "../electron/ipc-handlers";
import { FileManager } from "../electron/file-manager";

// Configure logger
log.initialize({ preload: true });
log.info("Application starting...");

let mainWindow: BrowserWindow | null = null;
const fileManager = new FileManager();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the index.html file or the dev server URL
  const indexPath = isDev
    ? "http://localhost:3000"
    : `file://${path.join(__dirname, "../../index.html")}`;

  mainWindow.loadURL(indexPath);

  // Open DevTools automatically in development mode
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  log.info("Main window created");
}

// Create window when Electron is ready
app.whenReady().then(async () => {
  try {
    // Set up temp directory
    await fileManager.ensureTempDir();

    // Set up IPC handlers
    initIpcHandlers();

    // Create the main window
    createWindow();

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
    await fileManager.cleanup();
    log.info("Temp directory cleaned up");
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
