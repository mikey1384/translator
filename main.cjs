// CommonJS entry point for Electron main process
// This acts as a loader for the compiled TypeScript file
const path = require("path");
const fs = require("fs");
const log = require("electron-log");
const { ipcMain } = require("electron");

// Configure logger
log.initialize({ preload: true });
log.info("Loading application...");

// Helper function to check if a handler is already registered
function isHandlerRegistered(channel) {
  try {
    // This will throw an error if the handler is already registered
    const tempHandler = () => {};
    ipcMain.handle(channel, tempHandler);
    ipcMain.removeHandler(channel);
    return false; // Not registered
  } catch (error) {
    return true; // Already registered
  }
}

// Find the compiled main.js file
let mainPath;

// First, try the expected location in dist
const distMainPath = path.join(__dirname, "dist", "main.js");
if (fs.existsSync(distMainPath)) {
  mainPath = distMainPath;
  log.info(`Found main module at ${mainPath}`);
} else {
  // Fall back to scanning potential locations
  const potentialLocations = [
    path.join(__dirname, "dist", "main.js"),
    path.join(__dirname, "main.js"),
    path.join(__dirname, "dist", "index.js"),
  ];

  for (const location of potentialLocations) {
    if (fs.existsSync(location)) {
      mainPath = location;
      log.info(`Found main module at ${mainPath}`);
      break;
    }
  }
}

if (!mainPath) {
  log.error("Could not find main module! Application cannot start.");
  process.exit(1);
}

// Initialize handlers early, but only if they're not already registered
// This prevents duplicate handler registration errors
if (!isHandlerRegistered("ping")) {
  log.info("Initializing handlers from main.cjs");
  try {
    require("./handlers/index");
    log.info("Handlers initialized successfully");
  } catch (err) {
    log.warn("Error initializing handlers:", err.message);
    // Continue anyway, as the main process might register its own handlers
  }
} else {
  log.info(
    "Handlers already registered, skipping initialization from main.cjs"
  );
}

// Load the compiled main module
try {
  require(mainPath);
} catch (err) {
  log.error("Error loading main module:", err);
  process.exit(1);
}
