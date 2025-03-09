// SAVE-HANDLER.JS - PROPER FIX WITH ENHANCED LOGGING
console.log("🚨 SAVE-HANDLER.JS LOADED - VERSION WITH ENHANCED LOGGING 🚨");

// Import required modules
const { ipcMain, app } = require("electron");
const fs = require("fs");
const path = require("path");

// Log critical info
console.log("🚨 SAVE-HANDLER: Process ID:", process.pid);
console.log("🚨 SAVE-HANDLER: Running directory:", process.cwd());
console.log("🚨 SAVE-HANDLER: Module directory:", __dirname);

// Check if handler already exists
let handlerExists = false;
try {
  ipcMain.handle("save-file", () => {});
  ipcMain.removeHandler("save-file");
  console.log("🚨 SAVE-HANDLER: Removed existing save-file handler");
} catch (err) {
  handlerExists = true;
  console.log(
    "🚨 SAVE-HANDLER: save-file handler already exists, will not register"
  );
}

// Only register if not already registered
if (!handlerExists) {
  console.log("🚨 SAVE-HANDLER: Registering save-file handler");
  ipcMain.handle("save-file", async (_event, options) => {
    console.log(
      "💥 [PATH DEBUG] SAVE-HANDLER: Handler invoked with RAW OPTIONS:",
      options
    );
    console.log(
      "💥 [PATH DEBUG] SAVE-HANDLER: Checking for expected properties:",
      {
        hasOriginalLoadPath: !!options.originalLoadPath,
        originalLoadPath: options.originalLoadPath,
        hasTargetPath: !!options.targetPath,
        targetPath: options.targetPath,
        hasFilePath: !!options.filePath,
        filePath: options.filePath,
        hasDefaultPath: !!options.defaultPath,
        defaultPath: options.defaultPath,
        forceDialog: !!options.forceDialog,
      }
    );

    console.log("🚨 SAVE-HANDLER: Handler invoked with options", {
      hasContent: !!options.content,
      contentLength: options.content?.length || 0,
      defaultPath: options.defaultPath,
      filePath: options.filePath,
      originalLoadPath: options.originalLoadPath,
      targetPath: options.targetPath,
      forceDialog: options.forceDialog,
    });

    try {
      // If forceDialog is true, show a save dialog regardless of other options
      if (options.forceDialog) {
        console.log(
          "🚨 SAVE-HANDLER: forceDialog is true, showing save dialog"
        );

        try {
          const { dialog } = require("electron");
          const BrowserWindow = require("electron").BrowserWindow;

          // Get the focused window or first window
          const focusedWindow =
            BrowserWindow.getFocusedWindow() ||
            BrowserWindow.getAllWindows()[0];

          if (!focusedWindow) {
            console.error("🚨 SAVE-HANDLER: No window available for dialog");
            return { error: "No window available for dialog" };
          }

          // Show the save dialog
          const { canceled, filePath } = await dialog.showSaveDialog(
            focusedWindow,
            {
              title: options.title || "Save File",
              defaultPath: options.defaultPath || "untitled.srt",
              filters: options.filters || [
                { name: "All Files", extensions: ["*"] },
              ],
            }
          );

          if (canceled || !filePath) {
            console.log("🚨 SAVE-HANDLER: Save dialog was canceled");
            return { error: "Save was canceled" };
          }

          // Save to the selected path
          fs.writeFileSync(filePath, options.content, "utf8");
          console.log(
            "🚨 SAVE-HANDLER: File saved successfully with dialog to:",
            filePath
          );
          return { filePath };
        } catch (dialogError) {
          console.error(
            "🚨 SAVE-HANDLER: Error showing save dialog:",
            dialogError
          );
          return {
            error: `Error showing save dialog: ${
              dialogError.message || String(dialogError)
            }`,
          };
        }
      }

      // CASE 1: If originalLoadPath is provided, try to use it first
      if (
        options.originalLoadPath &&
        typeof options.originalLoadPath === "string"
      ) {
        console.log(
          "💥 [PATH DEBUG] SAVE-HANDLER: Found originalLoadPath:",
          options.originalLoadPath
        );
        try {
          // Check if the directory exists first
          const dirExists = fs.existsSync(
            path.dirname(options.originalLoadPath)
          );
          console.log(
            "💥 [PATH DEBUG] SAVE-HANDLER: originalLoadPath directory exists:",
            dirExists
          );

          if (dirExists) {
            console.log(
              "🚨 SAVE-HANDLER: Using original load path:",
              options.originalLoadPath
            );
            fs.writeFileSync(options.originalLoadPath, options.content, "utf8");
            console.log(
              "🚨 SAVE-HANDLER: File saved successfully to original location:",
              options.originalLoadPath
            );
            return { filePath: options.originalLoadPath };
          } else {
            console.log(
              "💥 [PATH DEBUG] SAVE-HANDLER: originalLoadPath directory doesn't exist - can't save there"
            );
          }
        } catch (err) {
          console.error("🚨 SAVE-HANDLER: Error saving to original path:", err);
          console.error("💥 [PATH DEBUG] SAVE-HANDLER: Error details:", {
            message: err.message,
            code: err.code,
            stack: err.stack,
          });
          // Fall through to next approach
        }
      } else {
        console.log(
          "💥 [PATH DEBUG] SAVE-HANDLER: No originalLoadPath found in options"
        );
      }

      // CASE 2: If targetPath is provided, try to use it next
      if (options.targetPath && typeof options.targetPath === "string") {
        console.log(
          "💥 [PATH DEBUG] SAVE-HANDLER: Found targetPath:",
          options.targetPath
        );
        try {
          // Ensure directory exists
          const targetDir = path.dirname(options.targetPath);
          const dirExists = fs.existsSync(targetDir);
          console.log(
            "💥 [PATH DEBUG] SAVE-HANDLER: targetPath directory exists:",
            dirExists
          );

          if (!dirExists) {
            fs.mkdirSync(targetDir, { recursive: true });
            console.log(
              "💥 [PATH DEBUG] SAVE-HANDLER: Created targetPath directory"
            );
          }

          console.log(
            "🚨 SAVE-HANDLER: Using provided target path:",
            options.targetPath
          );
          fs.writeFileSync(options.targetPath, options.content, "utf8");
          console.log(
            "🚨 SAVE-HANDLER: File saved successfully to target path:",
            options.targetPath
          );
          return { filePath: options.targetPath };
        } catch (err) {
          console.error("🚨 SAVE-HANDLER: Error saving to target path:", err);
          console.error("💥 [PATH DEBUG] SAVE-HANDLER: Error details:", {
            message: err.message,
            code: err.code,
            stack: err.stack,
          });
          // Fall through to next approach
        }
      } else {
        console.log(
          "💥 [PATH DEBUG] SAVE-HANDLER: No targetPath found in options"
        );
      }

      // CASE 3: If it's a real file path (not synthetic), save directly to it
      if (options.filePath && !options.filePath.startsWith("/temp/")) {
        console.log(
          "💥 [PATH DEBUG] SAVE-HANDLER: Found real filePath:",
          options.filePath
        );
        try {
          // Check if the directory exists
          const dirExists = fs.existsSync(path.dirname(options.filePath));
          console.log(
            "💥 [PATH DEBUG] SAVE-HANDLER: filePath directory exists:",
            dirExists
          );

          if (dirExists) {
            console.log(
              "🚨 SAVE-HANDLER: Using real file path:",
              options.filePath
            );
            fs.writeFileSync(options.filePath, options.content, "utf8");
            console.log(
              "🚨 SAVE-HANDLER: File saved successfully to original location:",
              options.filePath
            );
            return { filePath: options.filePath };
          } else {
            console.log(
              "💥 [PATH DEBUG] SAVE-HANDLER: filePath directory doesn't exist - can't save there"
            );
          }
        } catch (err) {
          console.error("🚨 SAVE-HANDLER: Error saving to file path:", err);
          console.error("💥 [PATH DEBUG] SAVE-HANDLER: Error details:", {
            message: err.message,
            code: err.code,
            stack: err.stack,
          });
          // Fall through to next approach
        }
      } else {
        console.log(
          "💥 [PATH DEBUG] SAVE-HANDLER: No real filePath found, or it's a synthetic path"
        );
      }

      // CASE 4: For synthetic paths or all other cases, fallback to Desktop
      console.log(
        "💥 [PATH DEBUG] SAVE-HANDLER: All other methods failed, falling back to Desktop"
      );

      // Get the filename from the path or defaultPath
      const filename =
        options.filePath?.split("/").pop() ||
        options.defaultPath ||
        "subtitles.srt";

      // When all else fails, use Desktop
      const saveLocation = app.getPath("desktop");
      console.log(
        "🚨 SAVE-HANDLER: Using desktop as fallback location:",
        saveLocation
      );

      // Create the full save path
      const savePath = path.join(saveLocation, filename);

      console.log("🚨 SAVE-HANDLER: Saving file to:", savePath);
      fs.writeFileSync(savePath, options.content, "utf8");
      console.log("🚨 SAVE-HANDLER: File saved successfully to:", savePath);

      return { filePath: savePath };
    } catch (error) {
      console.error("🚨 SAVE-HANDLER: Error saving file:", error);
      return { error: `Save error: ${error.message || String(error)}` };
    }
  });

  console.log("🚨 SAVE-HANDLER: save-file handler registered successfully");
}

console.log("🚨 SAVE-HANDLER.JS COMPLETED 🚨");
