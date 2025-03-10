// MESSAGE-HANDLER.JS
// Import required modules
const { ipcMain, dialog } = require("electron");

// Register ping handler
let pingHandlerExists = false;
try {
  ipcMain.handle("ping", () => {});
  ipcMain.removeHandler("ping");
} catch (err) {
  pingHandlerExists = true;
}

if (!pingHandlerExists) {
  ipcMain.handle("ping", () => {
    return "pong";
  });
  console.log("Ping handler registered");
}

// Register show-message handler
let messageHandlerExists = false;
try {
  ipcMain.handle("show-message", () => {});
  ipcMain.removeHandler("show-message");
} catch (err) {
  messageHandlerExists = true;
}

if (!messageHandlerExists) {
  ipcMain.handle("show-message", async (_event, message) => {
    try {
      const BrowserWindow = require("electron").BrowserWindow;

      // Get the focused window or first window
      const focusedWindow =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

      if (!focusedWindow) {
        console.warn("No window available for message dialog");
        return false;
      }

      // Show the message
      await dialog.showMessageBox(focusedWindow, {
        type: "info",
        title: "Translator",
        message: message || "Operation completed",
        buttons: ["OK"],
      });

      return true;
    } catch (error) {
      console.error("Error showing message:", error);
      return false;
    }
  });

  console.log("Show message handler registered");
}
