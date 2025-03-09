// CommonJS version of preload script
const { contextBridge, ipcRenderer } = require("electron");

// Log when preload script is executed
console.log("Preload script executing...");

// Define a minimal API to test the IPC connection
const electronAPI = {
  // Test methods
  ping: async () => {
    console.log("Ping called in preload");
    try {
      const result = await ipcRenderer.invoke("ping");
      console.log("Ping result:", result);
      return result;
    } catch (error) {
      console.error("Ping error:", error);
      throw error;
    }
  },

  // Show a message from main process
  showMessage: (message) => ipcRenderer.invoke("show-message", message),

  // Simple test function that returns a value immediately
  test: () => "Electron API is working",

  // Subtitle generation
  generateSubtitles: (options) => {
    // Process and serialize the videoFile if it's a File object
    const processedOptions = { ...options };
    if (options.videoFile && typeof options.videoFile === "object") {
      console.log("Serializing File object for IPC");
      processedOptions.videoFile = {
        name: options.videoFile.name,
        size: options.videoFile.size,
        type: options.videoFile.type,
        lastModified: options.videoFile.lastModified,
      };
    }

    return ipcRenderer.invoke("generate-subtitles", processedOptions);
  },

  onGenerateSubtitlesProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("generate-subtitles-progress", listener);
    
    // Return a function to remove the listener when no longer needed
    return () => ipcRenderer.removeListener("generate-subtitles-progress", listener);
  },

  // Subtitle translation
  translateSubtitles: (options) =>
    ipcRenderer.invoke("translate-subtitles", options),

  onTranslateSubtitlesProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("translate-subtitles-progress", listener);
    
    // Return a function to remove the listener when no longer needed
    return () => ipcRenderer.removeListener("translate-subtitles-progress", listener);
  },

  // Subtitle merging with video
  mergeSubtitles: (options) => ipcRenderer.invoke("merge-subtitles", options),

  onMergeSubtitlesProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("merge-subtitles-progress", listener);
    
    // Return a function to remove the listener when no longer needed
    return () => ipcRenderer.removeListener("merge-subtitles-progress", listener);
  },

  // File operations
  saveFile: (options) => ipcRenderer.invoke("save-file", options),
  openFile: (options) => ipcRenderer.invoke("open-file", options),
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electron", electronAPI);

// Log when preload script has completed
console.log("Preload script completed, exposed API:", Object.keys(electronAPI));