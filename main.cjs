// CommonJS entry point for Electron main process
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const isDev = require("electron-is-dev");
const log = require("electron-log");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Configure logger
log.initialize({ preload: true });
log.info("Application starting...");

console.log("Environment variables loaded:", {
  hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
  hasOpenAIKey: !!process.env.OPENAI_API_KEY,
});

// Global references
let mainWindow = null;
const tempDir = path.join(app.getPath("userData"), "temp");

// Ensure temp directory exists
function ensureTempDir() {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  console.log("Temp directory created at:", tempDir);
  return tempDir;
}

// Basic IPC handlers (reliable baseline)
function setupBasicIpcHandlers() {
  console.log("Setting up basic IPC handlers");

  // Test ping handler
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

  console.log("All IPC handlers set up successfully");
}

// Create the main browser window
async function createWindow() {
  console.log("Creating main window...");

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
      devTools: true,
      webSecurity: false, // Disable for development to allow blob:// URLs
      allowRunningInsecureContent: false,
    },
  });
  
  // Enable loading local resources from blob URLs
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      return callback(true);
    }
    callback(true);
  });
  
  // Set Content Security Policy to allow blob URLs for media and inline styles
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; media-src * blob:; connect-src * blob:; font-src * data:;"
        ]
      }
    });
  });

  console.log(
    "BrowserWindow created, preload path:",
    path.join(__dirname, "preload.cjs")
  );

  // Load the index.html file
  const indexPath = `file://${path.join(__dirname, "index.html")}`;
  console.log("Loading index file:", indexPath);

  try {
    await mainWindow.loadURL(indexPath);
    console.log("Index file loaded successfully");

    // Open DevTools
    mainWindow.webContents.openDevTools();
    console.log("DevTools opened");

    // Add debugging event listeners
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
  } catch (error) {
    console.error("Error loading index file:", error);
  }
}

// Initialize app when ready
app.whenReady().then(async () => {
  try {
    console.log("Electron app is ready");

    // Ensure temp directory exists
    ensureTempDir();

    // Set up IPC handlers first
    setupBasicIpcHandlers();

    // Create the main window
    await createWindow();

    console.log("Main window created successfully");
  } catch (error) {
    console.error("Error during app initialization:", error);
  }
});

// Standard Electron lifecycle handlers
app.on("window-all-closed", () => {
  console.log("All windows closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  console.log("App activated");
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("quit", () => {
  console.log("App is quitting");
});

console.log("Main process script loaded");