// CommonJS entry point for Electron main process
console.log("🚨🚨🚨 ENTRY POINT EXECUTION BEGIN 🚨🚨🚨");
console.log("🚨 1. GLOBAL PROCESS INFO:", {
  pid: process.pid,
  platform: process.platform,
  argv: process.argv,
  execPath: process.execPath,
});

// CommonJS entry point for Electron main process
console.log("🔍 MAIN.CJS - SCRIPT STARTING");
console.log("🔍 MAIN.CJS - Process ID:", process.pid);
console.log("🔍 MAIN.CJS - Current working directory:", process.cwd());
console.log("🔍 MAIN.CJS - __dirname:", __dirname);
console.log("🔍 MAIN.CJS - module paths:", module.paths);

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
console.log("🔍 MAIN.CJS - Electron modules imported successfully");

// Check if ipcMain has expected methods
console.log("🚨 2. IPC_MAIN METHODS AVAILABLE:", {
  handle: typeof ipcMain.handle === "function",
  removeHandler: typeof ipcMain.removeHandler === "function",
  handleOnce: typeof ipcMain.handleOnce === "function",
});

const path = require("path");
const fs = require("fs");
const isDev = require("electron-is-dev");
const log = require("electron-log");
const dotenv = require("dotenv");
console.log("🔍 MAIN.CJS - All modules imported successfully");
console.log("🚨 3. FS METHODS AVAILABLE:", {
  existsSync: typeof fs.existsSync === "function",
  writeFileSync: typeof fs.writeFileSync === "function",
  readFileSync: typeof fs.readFileSync === "function",
});

// Check the directory structure
try {
  console.log("🔍 MAIN.CJS - Directory listing for current directory:");
  const files = fs.readdirSync(__dirname);
  files.forEach((file) => {
    console.log(
      `🔍 MAIN.CJS - File: ${file}, isDirectory: ${fs
        .statSync(path.join(__dirname, file))
        .isDirectory()}`
    );
  });
} catch (err) {
  console.error("🔍 MAIN.CJS - Error reading directory:", err);
}

// Import and run our save-file handler immediately with full path and error handling
console.log("🚨 4. ABOUT TO LOAD SAVE HANDLER - EXECUTION CHECKPOINT");
console.log("🔍 MAIN.CJS - About to try loading save-handler.js");
try {
  const saveHandlerPath = path.join(__dirname, "save-handler.js");
  console.log("🚨 5. SAVE HANDLER PATH:", saveHandlerPath);
  console.log("🚨 ATTEMPTING TO LOAD SAVE HANDLER from:", saveHandlerPath);

  // Check if file exists BEFORE trying to load it
  const saveHandlerExists = fs.existsSync(saveHandlerPath);
  console.log("🚨 6. SAVE HANDLER FILE EXISTS:", saveHandlerExists);

  // Check file stats if it exists
  if (saveHandlerExists) {
    try {
      const stats = fs.statSync(saveHandlerPath);
      console.log("🚨 7. SAVE HANDLER FILE STATS:", {
        size: stats.size,
        isFile: stats.isFile(),
        created: stats.birthtime,
        modified: stats.mtime,
      });

      // Read the first few lines to verify content
      try {
        const fileContent = fs
          .readFileSync(saveHandlerPath, "utf8")
          .slice(0, 200);
        console.log("🚨 8. SAVE HANDLER FILE FIRST 200 CHARS:", fileContent);
      } catch (readErr) {
        console.error("🚨 8. FAILED TO READ SAVE HANDLER CONTENT:", readErr);
      }
    } catch (statErr) {
      console.error("🚨 7. FAILED TO GET SAVE HANDLER STATS:", statErr);
    }
  }

  console.log("File exists:", fs.existsSync(saveHandlerPath));

  if (!fs.existsSync(saveHandlerPath)) {
    console.error(
      "❌ ERROR: save-handler.js FILE DOES NOT EXIST at path:",
      saveHandlerPath
    );

    // Try to create the file directly
    try {
      console.log("🔍 MAIN.CJS - Attempting to create save-handler.js file...");
      const basicHandler = `
// Basic save handler file created on startup
console.log("🔍 BASIC SAVE HANDLER LOADED");

const { ipcMain, dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');

// Register basic save handler
console.log("🔍 BASIC SAVE HANDLER - Registering save-file handler");
ipcMain.handle('save-file', async (_event, options) => {
  console.log("🔍 BASIC SAVE HANDLER - Handler called with options:", options);
  
  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: options.defaultPath || "untitled.srt",
      filters: options.filters || [{ name: "SRT Files", extensions: ["srt"] }],
    });
    
    if (canceled || !filePath) {
      return { error: "Save was canceled" };
    }
    
    fs.writeFileSync(filePath, options.content, 'utf8');
    console.log("🔍 BASIC SAVE HANDLER - File saved to:", filePath);
    return { filePath };
  } catch (error) {
    console.error("🔍 BASIC SAVE HANDLER - Error:", error);
    return { error: String(error) };
  }
});

console.log("🔍 BASIC SAVE HANDLER SETUP COMPLETE");
      `;

      fs.writeFileSync(saveHandlerPath, basicHandler, "utf8");
      console.log(
        "✅ Successfully created save-handler.js file at:",
        saveHandlerPath
      );
    } catch (writeErr) {
      console.error("❌ Failed to create save-handler.js file:", writeErr);
    }
  }

  // Try to import the module
  console.log("🚨 9. IMMEDIATELY BEFORE REQUIRE - SAVE-HANDLER.JS");
  console.log("🔍 MAIN.CJS - About to require save-handler.js");
  try {
    console.log("🚨 10. INSIDE TRY BLOCK BEFORE REQUIRE");
    const saveHandler = require(saveHandlerPath);
    console.log("🚨 11. REQUIRE COMPLETED SUCCESSFULLY");
    console.log("🚨 SAVE HANDLER IMPORT SUCCESSFUL:", !!saveHandler);
    console.log("🚨 12. SAVE HANDLER TYPE:", typeof saveHandler);
    if (typeof saveHandler === "object") {
      console.log("🚨 13. SAVE HANDLER KEYS:", Object.keys(saveHandler));
    }
  } catch (requireErr) {
    console.error("🚨 REQUIRE FAILED WITH ERROR:", requireErr);
    console.error("🚨 ERROR TYPE:", typeof requireErr);
    console.error("🚨 ERROR STACK:", requireErr.stack);
    console.error(
      "🚨 CRITICAL ERROR: Failed to load save-handler.js:",
      requireErr
    );
    // Create a backup handler if the module failed to load
    try {
      // First check if handler is already registered
      let saveHandlerExists = false;
      try {
        const tempHandler = () => {};
        ipcMain.handle("save-file", tempHandler);
        ipcMain.removeHandler("save-file");
      } catch (err) {
        saveHandlerExists = true;
        console.log("🚨 Emergency handler - save-file already registered");
      }

      if (!saveHandlerExists) {
        console.log("🚨 Creating EMERGENCY save-file handler...");
        ipcMain.handle("save-file", async (_event, options) => {
          console.log("🚨 EMERGENCY save-file handler invoked with options:", {
            hasContent: !!options.content,
            contentLength: options.content?.length,
            defaultPath: options.defaultPath,
            filePath: options.filePath,
          });

          try {
            // If filePath is provided, save directly without showing a dialog
            if (options.filePath) {
              // Check if it's a synthetic path (from browser file input)
              if (options.filePath.startsWith("/temp/")) {
                // Get the filename from the path
                const filename =
                  options.filePath.split("/").pop() ||
                  options.defaultPath ||
                  "subtitles.srt";

                // Create path to Desktop (or other user-accessible location)
                const desktopPath = path.join(app.getPath("desktop"), filename);

                console.log(
                  "🚨 EMERGENCY handler - Saving synthetic path file silently to Desktop:",
                  desktopPath
                );
                fs.writeFileSync(desktopPath, options.content, "utf8");
                console.log(
                  "🚨 EMERGENCY handler - File saved successfully to:",
                  desktopPath
                );
                return { filePath: desktopPath };
              } else {
                // It's a real file path, save directly
                console.log(
                  "🚨 EMERGENCY handler - Direct save to real path:",
                  options.filePath
                );
                fs.writeFileSync(options.filePath, options.content, "utf8");
                console.log(
                  "🚨 EMERGENCY handler - File saved successfully to:",
                  options.filePath
                );
                return { filePath: options.filePath };
              }
            } else if (options.defaultPath) {
              // No filePath but defaultPath is provided - use it to create a path on Desktop
              const filename = path.basename(options.defaultPath);
              const desktopPath = path.join(app.getPath("desktop"), filename);

              console.log(
                "🚨 EMERGENCY handler - Saving with defaultPath silently to Desktop:",
                desktopPath
              );
              fs.writeFileSync(desktopPath, options.content, "utf8");
              console.log(
                "🚨 EMERGENCY handler - File saved successfully to:",
                desktopPath
              );
              return { filePath: desktopPath };
            } else {
              // Neither filePath nor defaultPath - use generic name
              const desktopPath = path.join(
                app.getPath("desktop"),
                "subtitles.srt"
              );

              console.log(
                "🚨 EMERGENCY handler - Saving with generic name silently to Desktop:",
                desktopPath
              );
              fs.writeFileSync(desktopPath, options.content, "utf8");
              console.log(
                "🚨 EMERGENCY handler - File saved successfully to:",
                desktopPath
              );
              return { filePath: desktopPath };
            }
          } catch (saveError) {
            console.error(
              "🚨 EMERGENCY handler - Error saving file:",
              saveError
            );
            return {
              filePath: null,
              error: `Save failed: ${saveError.message || String(saveError)}`,
            };
          }
        });

        console.log("🚨 EMERGENCY save-file handler created successfully");

        // Verify it was registered
        let verifyExists = false;
        try {
          const tempHandler = () => {};
          ipcMain.handle("save-file", tempHandler);
          ipcMain.removeHandler("save-file");
        } catch (err) {
          verifyExists = true;
          console.log(
            "🚨 EMERGENCY handler verification - handler registered successfully"
          );
        }

        if (!verifyExists) {
          console.error(
            "🚨 EMERGENCY handler verification FAILED - handler not registered properly"
          );

          // Try one more time with different technique
          console.log("🚨 Attempting fallback registration technique");
          try {
            ipcMain.handle("save-file", (e, o) => ({ filePath: "emergency" }));
            console.log("🚨 Fallback registration completed");
          } catch (fallbackErr) {
            console.error("🚨 Fallback registration also failed:", fallbackErr);
          }
        }
      }
    } catch (backupErr) {
      console.error("🚨 Failed to create emergency handler:", backupErr);
    }
  }
} catch (err) {
  console.error("🚨 CRITICAL ERROR: Failed to load save-handler.js:", err);
  // Create a backup handler if the module failed to load
  try {
    // First check if handler is already registered
    let saveHandlerExists = false;
    try {
      const tempHandler = () => {};
      ipcMain.handle("save-file", tempHandler);
      ipcMain.removeHandler("save-file");
    } catch (err) {
      saveHandlerExists = true;
      console.log("🚨 Emergency handler - save-file already registered");
    }

    if (!saveHandlerExists) {
      console.log("🚨 Creating EMERGENCY save-file handler...");
      ipcMain.handle("save-file", async (_event, options) => {
        console.log("🚨 EMERGENCY save-file handler invoked with options:", {
          hasContent: !!options.content,
          contentLength: options.content?.length,
          defaultPath: options.defaultPath,
          filePath: options.filePath,
        });

        try {
          // If filePath is provided, save directly without showing a dialog
          if (options.filePath) {
            // Check if it's a synthetic path (from browser file input)
            if (options.filePath.startsWith("/temp/")) {
              // Get the filename from the path
              const filename =
                options.filePath.split("/").pop() ||
                options.defaultPath ||
                "subtitles.srt";

              // Create path to Desktop (or other user-accessible location)
              const desktopPath = path.join(app.getPath("desktop"), filename);

              console.log(
                "🚨 EMERGENCY handler - Saving synthetic path file silently to Desktop:",
                desktopPath
              );
              fs.writeFileSync(desktopPath, options.content, "utf8");
              console.log(
                "🚨 EMERGENCY handler - File saved successfully to:",
                desktopPath
              );
              return { filePath: desktopPath };
            } else {
              // It's a real file path, save directly
              console.log(
                "🚨 EMERGENCY handler - Direct save to real path:",
                options.filePath
              );
              fs.writeFileSync(options.filePath, options.content, "utf8");
              console.log(
                "🚨 EMERGENCY handler - File saved successfully to:",
                options.filePath
              );
              return { filePath: options.filePath };
            }
          } else if (options.defaultPath) {
            // No filePath but defaultPath is provided - use it to create a path on Desktop
            const filename = path.basename(options.defaultPath);
            const desktopPath = path.join(app.getPath("desktop"), filename);

            console.log(
              "🚨 EMERGENCY handler - Saving with defaultPath silently to Desktop:",
              desktopPath
            );
            fs.writeFileSync(desktopPath, options.content, "utf8");
            console.log(
              "🚨 EMERGENCY handler - File saved successfully to:",
              desktopPath
            );
            return { filePath: desktopPath };
          } else {
            // Neither filePath nor defaultPath - use generic name
            const desktopPath = path.join(
              app.getPath("desktop"),
              "subtitles.srt"
            );

            console.log(
              "🚨 EMERGENCY handler - Saving with generic name silently to Desktop:",
              desktopPath
            );
            fs.writeFileSync(desktopPath, options.content, "utf8");
            console.log(
              "🚨 EMERGENCY handler - File saved successfully to:",
              desktopPath
            );
            return { filePath: desktopPath };
          }
        } catch (saveError) {
          console.error("🚨 EMERGENCY handler - Error saving file:", saveError);
          return {
            filePath: null,
            error: `Save failed: ${saveError.message || String(saveError)}`,
          };
        }
      });

      console.log("🚨 EMERGENCY save-file handler created successfully");

      // Verify it was registered
      let verifyExists = false;
      try {
        const tempHandler = () => {};
        ipcMain.handle("save-file", tempHandler);
        ipcMain.removeHandler("save-file");
      } catch (err) {
        verifyExists = true;
        console.log(
          "🚨 EMERGENCY handler verification - handler registered successfully"
        );
      }

      if (!verifyExists) {
        console.error(
          "🚨 EMERGENCY handler verification FAILED - handler not registered properly"
        );

        // Try one more time with different technique
        console.log("🚨 Attempting fallback registration technique");
        try {
          ipcMain.handle("save-file", (e, o) => ({ filePath: "emergency" }));
          console.log("🚨 Fallback registration completed");
        } catch (fallbackErr) {
          console.error("🚨 Fallback registration also failed:", fallbackErr);
        }
      }
    }
  } catch (backupErr) {
    console.error("🚨 Failed to create emergency handler:", backupErr);
  }
}

// Confirm the main process is loaded
console.log("Main process loaded - THIS IS THE DIRECT APPROACH");

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

// Basic IPC handlers only for core functions
function setupBasicIpcHandlers() {
  console.log("Setting up basic IPC handlers");

  // Skip registering handlers that might conflict with advanced handlers

  // Only register core communication handlers

  // Show message handler
  if (!ipcMainIsHandled("show-message")) {
    ipcMain.handle("show-message", (_event, message) => {
      console.log("Show message requested:", message);
      dialog.showMessageBox({
        type: "info",
        title: "Message from Renderer",
        message: message,
      });
      return true;
    });
  }

  // DO NOT REGISTER SAVE-FILE HANDLER HERE - Use save-handler.js instead
  /* Removed direct handler registration to avoid conflicts with save-handler.js
  if (!ipcMainIsHandled("save-file")) {
    console.log("⚠️ DIRECTLY REGISTERING SAVE-FILE HANDLER IN main.cjs");
    ipcMain.handle("save-file", async (_event, options) => {
      // ... handler code removed ...
    });
    console.log("⚠️ SAVE-FILE HANDLER REGISTERED SUCCESSFULLY IN main.cjs");
  }
  */

  console.log("All basic IPC handlers set up successfully");
}

// Function to check if a channel is already being handled
function ipcMainIsHandled(channel) {
  // This is a workaround since Electron doesn't provide a way to check this directly
  try {
    // Attempt to register a temporary handler
    const tempHandler = () => {};
    ipcMain.handle(channel, tempHandler);

    // If successful, remove it immediately and return false
    ipcMain.removeHandler(channel);
    return false;
  } catch (error) {
    // If there's an error, assume the channel is already handled
    return true;
  }
}

// Create the main browser window
async function createWindow() {
  try {
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

    console.log(
      "BrowserWindow created, preload path:",
      path.join(__dirname, "preload.cjs")
    );

    // Load the index.html file
    const indexPath = `file://${path.join(__dirname, "index.html")}`;
    console.log("Loading index file:", indexPath);

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
    console.error("Error creating window:", error);
  }
}

// Register handlers when app is ready
let handlersRegistered = false;
function registerHandlers() {
  if (handlersRegistered) {
    console.log("Handlers already registered, skipping");
    return;
  }

  console.log("==== REGISTERING CORE HANDLERS ====");

  // Register core ping handler
  if (typeof ipcMain.removeHandler === "function") {
    try {
      ipcMain.removeHandler("ping");
      console.log("Removed existing ping handler");

      // Don't remove our save-file handler that was registered in save-handler.js
      // ipcMain.removeHandler("save-file");
      // console.log("Removed existing save-file handler");

      ipcMain.removeHandler("open-file");
      console.log("Removed existing open-file handler");
    } catch (err) {
      console.error("Error removing handlers:", err);
    }
  } else {
    console.warn(
      "ipcMain.removeHandler is not a function, cannot remove existing handlers"
    );
  }

  console.log("Registering ping handler...");
  try {
    ipcMain.handle("ping", () => {
      console.log("Ping handler called from main.cjs");
      return "pong";
    });
    console.log("✓ ping handler registered successfully");
  } catch (err) {
    console.error("❌ Failed to register ping handler:", err);
  }

  console.log("Registering open-file handler...");
  try {
    ipcMain.handle("open-file", async (_event, options = {}) => {
      console.log(
        "💥 [PATH DEBUG] open-file handler called with options:",
        options
      );

      try {
        const mainWindow = BrowserWindow.getFocusedWindow();
        if (!mainWindow) {
          console.error("No focused window found for open-file dialog");
          return { error: "No focused window found" };
        }

        const { canceled, filePaths } = await dialog.showOpenDialog(
          mainWindow,
          {
            title: options.title || "Open File",
            properties: options.multiple
              ? ["openFile", "multiSelections"]
              : ["openFile"],
            filters: options.filters || [
              { name: "All Files", extensions: ["*"] },
            ],
          }
        );

        if (canceled || filePaths.length === 0) {
          console.log("💥 [PATH DEBUG] open-file dialog was canceled");
          return { canceled: true };
        }

        console.log("💥 [PATH DEBUG] open-file selected files:", filePaths);

        // For all text files, read the contents
        const fileContents = await Promise.all(
          filePaths.map(async (filePath) => {
            try {
              const content = await fs.promises.readFile(filePath, "utf8");
              console.log(
                `💥 [PATH DEBUG] Read file ${filePath}, content length: ${content.length}`
              );
              return content;
            } catch (err) {
              console.error(
                `💥 [PATH DEBUG] Error reading file ${filePath}:`,
                err
              );
              return null;
            }
          })
        );

        console.log(
          `💥 [PATH DEBUG] Successfully read ${
            fileContents.filter(Boolean).length
          } files`
        );

        return {
          filePaths,
          fileContents: fileContents.filter(Boolean),
        };
      } catch (err) {
        console.error("💥 [PATH DEBUG] Error in open-file handler:", err);
        return { error: String(err) };
      }
    });
    console.log("✓ open-file handler registered successfully");
  } catch (err) {
    console.error("❌ Failed to register open-file handler:", err);
  }

  // Set up file system handlers
  try {
    // Check if save-file handler is registered
    const saveFileHandlerExists = ipcMainIsHandled("save-file");
    if (!saveFileHandlerExists) {
      console.log("save-file handler missing, re-importing save-handler.js");
      require("./save-handler");
    }

    console.log("✓ File system handlers registered successfully");
  } catch (err) {
    console.error("❌ Error setting up file system handlers:", err);
  }

  // Verify all handlers are registered
  console.log("Verifying handlers are registered:");
  ["ping", "save-file", "open-file"].forEach((channel) => {
    const isHandled = ipcMainIsHandled(channel);
    console.log(
      `- ${channel}: ${isHandled ? "✓ Registered" : "❌ NOT REGISTERED"}`
    );
  });

  handlersRegistered = true;
  console.log("==== HANDLER REGISTRATION COMPLETE ====");
}

// Ensure critical handlers exist
function ensureCriticalHandlersExist() {
  console.log("Ensuring critical handlers exist...");

  // Check if save-file handler exists
  const saveFileHandlerExists = ipcMainIsHandled("save-file");
  console.log(
    `- save-file handler exists: ${saveFileHandlerExists ? "Yes" : "No"}`
  );

  if (!saveFileHandlerExists) {
    console.log(
      "Critical save-file handler missing, re-importing save-handler.js..."
    );
    require("./save-handler");
  }
}

// Initialize app when ready
app.whenReady().then(async () => {
  try {
    console.log("Electron app is ready");

    // Ensure temp directory exists
    ensureTempDir();

    // Ensure critical handlers are registered
    ensureCriticalHandlersExist();

    // Register handlers - this will set up file handlers too
    console.log("Initializing main process handlers...");
    registerHandlers();

    // Verify handlers again after a short delay
    setTimeout(() => {
      console.log("==== DELAYED VERIFICATION OF HANDLERS ====");
      ["ping", "save-file", "open-file"].forEach((channel) => {
        const isHandled = ipcMainIsHandled(channel);
        console.log(
          `- ${channel}: ${isHandled ? "✓ Registered" : "❌ NOT REGISTERED"}`
        );

        // Re-register any missing critical handlers
        if (!isHandled && channel === "save-file") {
          console.log("Critical save-file handler missing, re-registering...");
          require("./save-handler");
        }
      });

      // Run the verification script
      try {
        console.log("🔍 MAIN.CJS - Running test-save.js verification script");
        const testSaveScript = path.join(__dirname, "test-save.js");
        if (fs.existsSync(testSaveScript)) {
          console.log("🔍 MAIN.CJS - test-save.js exists, running it");
          require("./test-save");
        } else {
          console.error(
            "🔍 MAIN.CJS - test-save.js not found at:",
            testSaveScript
          );
        }
      } catch (testErr) {
        console.error("🔍 MAIN.CJS - Error running test-save.js:", testErr);
      }
    }, 500);

    // Set up basic IPC handlers
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
