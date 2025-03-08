// Minimal test for Electron IPC setup
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

let win;

// Basic IPC handler
function setupBasicIpc() {
  console.log("Setting up basic IPC handlers");

  // Test if ipcMain exists and has handle method
  console.log("ipcMain exists:", !!ipcMain);
  console.log("ipcMain.handle exists:", !!ipcMain.handle);

  // Try to set up a simple handler
  try {
    ipcMain.handle("ping", () => "pong");
    console.log("Successfully registered ping handler");
  } catch (error) {
    console.error("Error registering IPC handler:", error);
  }
}

// Create window with minimal preload
function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "minimal-preload.js"),
    },
  });

  // Load empty HTML
  win.loadFile("minimal.html");
  win.webContents.openDevTools();
}

// App initialization
app.whenReady().then(() => {
  console.log("App is ready");

  // Set up IPC before creating window
  setupBasicIpc();

  // Create window
  createWindow();
});

// Exit when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Recreate window when activated on macOS
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

console.log("Minimal test script loaded");
