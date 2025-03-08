// CommonJS version of main process
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const isDev = require("electron-is-dev");
const log = require("electron-log");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Log loaded env vars
console.log("Environment variables loaded:", {
  hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
  hasOpenAIKey: !!process.env.OPENAI_API_KEY,
});

// Configure logger
log.initialize({ preload: true });
log.info("Application starting...");

let mainWindow = null;

// Simple IPC handlers for testing
function setupBasicIpcHandlers() {
  console.log("Setting up basic IPC handlers");

  // Simple ping-pong handler
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

  console.log("Basic IPC handlers set up");
}

// Create browser window
const createWindow = async () => {
  console.log("Creating window...");

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "dist", "preload", "index.js"),
      devTools: true, // Always enable DevTools
    },
  });

  console.log(
    "Window created, preload path:",
    path.join(__dirname, "dist", "preload", "index.js")
  );

  // Determine the path to load in the window
  const indexPath = `file://${path.join(__dirname, "index.html")}`;
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
};

// Create window when Electron is ready
app.whenReady().then(async () => {
  try {
    // Set up IPC handlers
    setupBasicIpcHandlers();

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

console.log("Main process script loaded");
