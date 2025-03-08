import { contextBridge, ipcRenderer } from "electron";

// Log when preload script is executed
console.log("Preload script executing...");

// Define a simplified API for testing
const electronAPI = {
  // Simple ping function to test IPC
  ping: () => ipcRenderer.invoke("ping"),

  // Show a message from main process
  showMessage: (message: string) => ipcRenderer.invoke("show-message", message),

  // Simple test function that returns a value immediately
  test: () => "Electron API is working",

  // The actual API functions will be implemented later
  generateSubtitles: (options: any) =>
    ipcRenderer.invoke("generate-subtitles", options),

  onGenerateSubtitlesProgress: (callback: (progress: any) => void) =>
    ipcRenderer.on("generate-subtitles-progress", (_event, progress) =>
      callback(progress)
    ),
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electron", electronAPI);

// Log when preload script has completed
console.log("Preload script completed, exposed API:", Object.keys(electronAPI));
