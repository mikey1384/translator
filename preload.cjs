// CommonJS version of preload script
const { contextBridge, ipcRenderer } = require("electron");

// Log when preload script is executed
console.log("Preload script executing...");

// Helper function to serialize a File object
function serializeFile(file) {
  if (!file || typeof file !== "object") return {};

  // Extract the properties we need from the File object
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  };
}

// Define a complete API for our application
const electronAPI = {
  // Test methods
  ping: () => ipcRenderer.invoke("ping"),

  // Show a message from main process
  showMessage: (message) => ipcRenderer.invoke("show-message", message),

  // Simple test function that returns a value immediately
  test: () => "Electron API is working",

  // Subtitle generation
  generateSubtitles: (options) => {
    // Process and serialize the videoFile if it's a File object
    const processedOptions = { ...options };
    if (options.videoFile instanceof File) {
      console.log("Serializing File object for IPC");
      processedOptions.videoFile = serializeFile(options.videoFile);
    }

    return ipcRenderer.invoke("generate-subtitles", processedOptions);
  },

  onGenerateSubtitlesProgress: (callback) => {
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
  translateSubtitles: (options) =>
    ipcRenderer.invoke("translate-subtitles", options),

  onTranslateSubtitlesProgress: (callback) => {
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
  mergeSubtitles: (options) => ipcRenderer.invoke("merge-subtitles", options),

  onMergeSubtitlesProgress: (callback) => {
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
  saveFile: (options) => ipcRenderer.invoke("save-file", options),
  openFile: (options) => ipcRenderer.invoke("open-file", options),
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electron", electronAPI);

// Log when preload script has completed
console.log("Preload script completed, exposed API:", Object.keys(electronAPI));
