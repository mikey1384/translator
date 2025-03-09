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

// Global references
let mainWindow = null;
const tempDir = path.join(app.getPath("userData"), "temp");

// Ensure temp directory exists
function ensureTempDir() {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

// Function to check if a channel is already being handled
function ipcMainIsHandled(channel) {
  try {
    const tempHandler = () => {};
    ipcMain.handle(channel, tempHandler);
    ipcMain.removeHandler(channel);
    return false;
  } catch (error) {
    return true;
  }
}

// Basic IPC handlers only for core functions
function setupBasicIpcHandlers() {
  if (!ipcMainIsHandled("show-message")) {
    ipcMain.handle("show-message", (_event, message) => {
      dialog.showMessageBox({
        type: "info",
        title: "Message from Renderer",
        message: message,
      });
      return true;
    });
  }
}

// Register handlers when app is ready
let handlersRegistered = false;
function registerHandlers() {
  if (handlersRegistered) return;

  if (typeof ipcMain.removeHandler === "function") {
    try {
      ipcMain.removeHandler("ping");
      ipcMain.removeHandler("open-file");
    } catch (err) {
      // Error handling preserved
    }
  }

  ipcMain.handle("ping", () => "pong");

  ipcMain.handle("open-file", async (_event, options = {}) => {
    try {
      const mainWindow = BrowserWindow.getFocusedWindow();
      if (!mainWindow) return { error: "No focused window found" };

      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: options.title || "Open File",
        properties: options.multiple
          ? ["openFile", "multiSelections"]
          : ["openFile"],
        filters: options.filters || [{ name: "All Files", extensions: ["*"] }],
      });

      if (canceled || filePaths.length === 0) return { canceled: true };

      const fileContents = await Promise.all(
        filePaths.map(async (filePath) => {
          try {
            return await fs.promises.readFile(filePath, "utf8");
          } catch (err) {
            return null;
          }
        })
      );

      return {
        filePaths,
        fileContents: fileContents.filter(Boolean),
      };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // Ensure save-file handler is registered
  if (!ipcMainIsHandled("save-file")) {
    require("./save-handler");
  }

  handlersRegistered = true;
}

// Ensure critical handlers exist
function ensureCriticalHandlersExist() {
  if (!ipcMainIsHandled("save-file")) {
    require("./save-handler");
  }
}

// Create the main browser window
async function createWindow() {
  try {
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
        webSecurity: false,
        allowRunningInsecureContent: false,
      },
    });

    // Enable loading local resources from blob URLs
    mainWindow.webContents.session.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        if (permission === "media") {
          return callback(true);
        }
        callback(true);
      }
    );

    // Set Content Security Policy to allow blob URLs for media and inline styles
    mainWindow.webContents.session.webRequest.onHeadersReceived(
      (details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; media-src * blob:; connect-src * blob:; font-src * data:;",
            ],
          },
        });
      }
    );

    const indexPath = `file://${path.join(__dirname, "index.html")}`;
    await mainWindow.loadURL(indexPath);
    mainWindow.webContents.openDevTools();
  } catch (error) {
    // Error handling preserved
  }
}

// Initialize app when ready
app.whenReady().then(async () => {
  try {
    ensureTempDir();
    ensureCriticalHandlersExist();
    registerHandlers();
    setupBasicIpcHandlers();
    await createWindow();
  } catch (error) {
    // Error handling preserved
  }
});

// Standard Electron lifecycle handlers
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("quit", () => {
  // Cleanup if needed
});
