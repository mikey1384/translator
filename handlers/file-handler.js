// FILE-HANDLER.JS
// Import required modules
const { ipcMain } = require("electron");
const { dialog } = require("electron");
const fs = require("fs");
const path = require("path");

// Check if handler already exists
let handlerExists = false;
try {
  ipcMain.handle("open-file", () => {});
  ipcMain.removeHandler("open-file");
} catch (err) {
  handlerExists = true;
}

// Only register if not already registered
if (!handlerExists) {
  ipcMain.handle("open-file", async (_event, options = {}) => {
    try {
      const BrowserWindow = require("electron").BrowserWindow;

      // Get the focused window or first window
      const focusedWindow =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

      if (!focusedWindow) {
        return { error: "No window available for dialog", filePaths: [] };
      }

      // Show the open dialog
      const { canceled, filePaths } = await dialog.showOpenDialog(
        focusedWindow,
        {
          properties: options.properties || ["openFile"],
          filters: options.filters || [
            { name: "All Files", extensions: ["*"] },
          ],
          title: options.title || "Open File",
          defaultPath: options.defaultPath || "",
          buttonLabel: options.buttonLabel || "Open",
          message: options.message || "",
        }
      );

      if (canceled || filePaths.length === 0) {
        return { canceled: true, filePaths: [] };
      }

      // For SRT files, always read the content
      const isSrtFile =
        options.filters &&
        options.filters.some((f) => f.extensions.includes("srt"));

      // If readFile option is true or it's an SRT file, read the file content
      if (options.readFile || isSrtFile) {
        try {
          // Read all files in filePaths
          const fileContents = [];
          for (const filePath of filePaths) {
            try {
              const content = fs.readFileSync(filePath, "utf8");
              fileContents.push(content);
            } catch (readError) {
              console.error(`Error reading file ${filePath}:`, readError);
              fileContents.push(null);
            }
          }

          return {
            filePaths,
            fileContents,
            filePath: filePaths[0],
            extension: path.extname(filePaths[0]).toLowerCase(),
          };
        } catch (readError) {
          return {
            error: `Error reading file: ${
              readError.message || String(readError)
            }`,
            filePaths,
          };
        }
      }

      // Return the selected file paths
      return {
        filePaths,
        filePath: filePaths[0], // Add single filePath for convenience
      };
    } catch (error) {
      console.error("Open file error:", error);
      return {
        error: `Open file error: ${error.message || String(error)}`,
        filePaths: [],
      };
    }
  });

  console.log("File handler (open-file) registered");
}
