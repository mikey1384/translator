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

// Add hot reload capability in development
if (isDev) {
  try {
    // Using require since this is a development-only dependency
    require("electron-reloader")(module, {
      watchRenderer: true,
      debug: true,
      ignore: [
        "node_modules/**/*",
        "src/renderer/**/*.{css,scss}",
        "**/*.json",
      ],
    });
  } catch (err) {
    console.error("Error setting up electron-reloader:", err);
  }
}

// Ensure ipcMain is properly defined
const ipcMain = electronIpcMain;

// Load environment variables from .env file
dotenv.config();

// Enable hardware acceleration for video
app.commandLine.appendSwitch("enable-accelerated-video-decode");
app.commandLine.appendSwitch("ignore-gpu-blacklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");


// Configure logger
log.initialize({ preload: true });
log.info("Application starting...");

let mainWindow: BrowserWindow | null = null;
let fileManager: FileManager;

// Add these handlers right before creating the window
// Simple ping-pong handler for testing IPC
ipcMain.handle("ping", () => {
  return "pong";
});

// Show message handler
ipcMain.handle("show-message", (_event, message) => {
  dialog.showMessageBox({
    type: "info",
    title: "Message from Renderer",
    message: message,
  });
  return true;
});

// Create browser window
const createWindow = async () => {
  try {

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
        preload: calculatePreloadPath(),
        devTools: true, // Always enable DevTools
        webSecurity: true, // Ensure web security is enabled
        additionalArguments: ["--enable-features=VideoPlayback"], // Enable video playback features
      },
    });

    // Calculate the correct preload path based on the current execution environment
    function calculatePreloadPath() {
      const isDev = process.env.NODE_ENV === "development";

      // Potential preload paths to try
      const possiblePaths = [
        path.join(process.cwd(), "preload.cjs"), // Direct CJS preload script
        path.join(__dirname, "../../preload/index.js"), // Normal path after TS compile
        path.join(__dirname, "../preload/index.js"), // Alternative path
        path.join(process.cwd(), "dist/preload/index.js"), // Absolute path
      ];

      // Try each path and use the first one that exists
      const fs = require("fs");
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          return possiblePath;
        }
      }

      // Default to the first path if none exist
      return possiblePaths[0];
    }


    // Determine the path to load in the window
    const indexPaths = [
      path.join(__dirname, "../../../index.html"),
      path.join(__dirname, "../../index.html"),
      path.join(process.cwd(), "index.html"),
    ];

    let indexPath = "";
    const fs = require("fs");

    // Find the first valid index.html path
    for (const possiblePath of indexPaths) {
      if (fs.existsSync(possiblePath)) {
        indexPath = `file://${possiblePath}`;
        break;
      }
    }

    if (!indexPath) {
      indexPath = `file://${indexPaths[0]}`;
    }

    // Load the index.html
    await mainWindow.loadURL(indexPath);

    // Open the DevTools automatically
    mainWindow.webContents.openDevTools();

    // Add a content reload watcher for development
    if (isDev) {
      const fs = require("fs");
      const path = require("path");

      // Watch for changes in the renderer build output
      const rendererBuildPath = path.join(
        __dirname,
        "../../dist/renderer/index.js"
      );
      let lastModified = 0;

      // Check for changes every 1 second
      const watchInterval = setInterval(() => {
        try {
          if (fs.existsSync(rendererBuildPath)) {
            const stats = fs.statSync(rendererBuildPath);
            const currentModified = stats.mtimeMs;

            // If the file has been modified since last check
            if (lastModified > 0 && currentModified > lastModified) {
              mainWindow?.webContents.reloadIgnoringCache();
            }

            lastModified = currentModified;
          }
        } catch (err) {
          console.error("Error checking renderer build:", err);
        }
      }, 1000);

      // Clean up on window close
      mainWindow.on("closed", () => {
        clearInterval(watchInterval);
      });
    }

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

    return mainWindow;
  } catch (error) {
    console.error("Error creating window:", error);
    log.error("Error creating window:", error);
    throw error;
  }
};

// Create window when Electron is ready
app.whenReady().then(async () => {
  try {
    // Initialize file manager after app is ready
    fileManager = new FileManager();

    // Set up temp directory
    await fileManager.ensureTempDir();

    // Create the main window first to ensure the app is ready
    await createWindow();

    // Set up IPC handlers after the window is created to ensure app is ready
    initIpcHandlers();

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

// This function is no longer needed as we're using the imported setupIpcHandlers
// from ../electron/ipc-handlers.ts instead
/*
function setupIpcHandlers() {
  // We'll implement these in separate modules
  // ipcMain.handle('generate-subtitles', handleGenerateSubtitles);
  // ipcMain.handle('translate-subtitles', handleTranslateSubtitles);
  // ipcMain.handle('merge-subtitles', handleMergeSubtitles);
}
*/
