import { contextBridge, ipcRenderer } from "electron";


// Define a complete API for our application
const electronAPI = {
  // Test methods - implementing a direct ping to avoid IPC
  ping: () => {
    console.log("Ping called in preload - direct response");
    return Promise.resolve("pong");
  },

  // Show a message from main process
  showMessage: (message: string) => ipcRenderer.invoke("show-message", message),

  // Simple test function that returns a value immediately
  test: () => "Electron API is working",

  // Subtitle generation
  generateSubtitles: (options: any) =>
    ipcRenderer.invoke("generate-subtitles", options),

  onGenerateSubtitlesProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("generate-subtitles-progress", (_event, progress) =>
      callback(progress)
    );
    // Return a function to remove the listener when no longer needed
    return () =>
      ipcRenderer.removeListener(
        "generate-subtitles-progress",
        (_event, progress) => callback(progress)
      );
  },

  // Subtitle translation
  translateSubtitles: (options: any) =>
    ipcRenderer.invoke("translate-subtitles", options),

  onTranslateSubtitlesProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("translate-subtitles-progress", (_event, progress) =>
      callback(progress)
    );
    // Return a function to remove the listener when no longer needed
    return () =>
      ipcRenderer.removeListener(
        "translate-subtitles-progress",
        (_event, progress) => callback(progress)
      );
  },

  // Subtitle merging with video
  mergeSubtitles: (options: any) =>
    ipcRenderer.invoke("merge-subtitles", options),

  onMergeSubtitlesProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("merge-subtitles-progress", (_event, progress) =>
      callback(progress)
    );
    // Return a function to remove the listener when no longer needed
    return () =>
      ipcRenderer.removeListener(
        "merge-subtitles-progress",
        (_event, progress) => callback(progress)
      );
  },

  // File operations
  saveFile: (options: any) => {
    console.log("Invoking saveFile in preload with options:", options);
    return ipcRenderer.invoke("save-file", options);
  },
  openFile: (options: any) => ipcRenderer.invoke("open-file", options),
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electron", electronAPI);

