// SAVE-HANDLER.JS
// Import required modules
const { ipcMain, app } = require("electron");
const fs = require("fs");
const path = require("path");

// Check if handler already exists
let handlerExists = false;
try {
  ipcMain.handle("save-file", () => {});
  ipcMain.removeHandler("save-file");
} catch (err) {
  handlerExists = true;
}

// Only register if not already registered
if (!handlerExists) {
  ipcMain.handle("save-file", async (_event, options) => {

    try {
      // If forceDialog is true, show a save dialog regardless of other options
      if (options.forceDialog) {
        try {
          const { dialog } = require("electron");
          const BrowserWindow = require("electron").BrowserWindow;

          // Get the focused window or first window
          const focusedWindow =
            BrowserWindow.getFocusedWindow() ||
            BrowserWindow.getAllWindows()[0];

          if (!focusedWindow) {
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
            return { error: "Save was canceled" };
          }

          // Save to the selected path
          fs.writeFileSync(filePath, options.content, "utf8");
          return { filePath };
        } catch (dialogError) {
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
        try {
          // Check if the directory exists first
          const dirExists = fs.existsSync(
            path.dirname(options.originalLoadPath)
          );

          if (dirExists) {
            fs.writeFileSync(options.originalLoadPath, options.content, "utf8");
            return { filePath: options.originalLoadPath };
          }
        } catch (err) {
          // Fall through to next approach
        }
      }

      // CASE 2: If targetPath is provided, try to use it next
      if (options.targetPath && typeof options.targetPath === "string") {
        try {
          // Ensure directory exists
          const targetDir = path.dirname(options.targetPath);
          const dirExists = fs.existsSync(targetDir);

          if (!dirExists) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          fs.writeFileSync(options.targetPath, options.content, "utf8");
          return { filePath: options.targetPath };
        } catch (err) {
          // Fall through to next approach
        }
      }

      // CASE 3: If it's a real file path (not synthetic), save directly to it
      if (options.filePath && !options.filePath.startsWith("/temp/")) {
        try {
          // Check if the directory exists
          const dirExists = fs.existsSync(path.dirname(options.filePath));

          if (dirExists) {
            fs.writeFileSync(options.filePath, options.content, "utf8");
            return { filePath: options.filePath };
          }
        } catch (err) {
          // Fall through to next approach
        }
      }

      // CASE 4: For synthetic paths or all other cases, fallback to Desktop
      // Get the filename from the path or defaultPath
      const filename =
        options.filePath?.split("/").pop() ||
        options.defaultPath ||
        "subtitles.srt";

      // When all else fails, use Desktop
      const saveLocation = app.getPath("desktop");

      // Create the full save path
      const savePath = path.join(saveLocation, filename);

      fs.writeFileSync(savePath, options.content, "utf8");
      return { filePath: savePath };
    } catch (error) {
      return { error: `Save error: ${error.message || String(error)}` };
    }
  });
}
