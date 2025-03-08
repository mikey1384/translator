// Simple debug script to test Electron initialization
const { app, BrowserWindow } = require("electron");
const path = require("path");

// Log all application events to help debug
app.on("ready", () => console.log("App ready event fired"));
app.on("window-all-closed", () => console.log("window-all-closed event fired"));
app.on("activate", () => console.log("activate event fired"));
app.on("will-quit", () => console.log("will-quit event fired"));

// Create a minimal window for testing
function createWindow() {
  console.log("Creating minimal test window");

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "dist/preload/index.js"),
    },
  });

  console.log("Loading blank HTML content");
  win.loadFile("index.html");

  // Open DevTools
  win.webContents.openDevTools();

  console.log("Window created successfully");
}

// Initialize app
app.whenReady().then(() => {
  console.log("App is ready, creating window");
  createWindow();

  console.log("App initialized successfully");
});

// Standard macOS behavior
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

console.log("Debug script loaded");
