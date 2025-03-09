// CommonJS version of preload script
const { contextBridge, ipcRenderer } = require("electron");

// Add better error handling for IPC calls
const invokeWithRetry = async (channel, ...args) => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    if (error.message && error.message.includes("No handler registered")) {
      const retryDelays = [
        300, 600, 1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000,
      ];

      for (const delay of retryDelays) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          return await ipcRenderer.invoke(channel, ...args);
        } catch (retryError) {
          // Continue to the next retry
        }
      }
      throw new Error(
        `Failed to connect to ${channel} after multiple retries. The main process may not be fully initialized.`
      );
    }
    throw error;
  }
};

// Define the API to expose to the renderer process
const electronAPI = {
  // Test methods
  ping: async () => {
    try {
      return await ipcRenderer.invoke("ping");
    } catch (error) {
      throw error;
    }
  },

  // Show a message from main process
  showMessage: (message) => ipcRenderer.invoke("show-message", message),

  // Simple test function that returns a value immediately
  test: () => "Electron API is working",

  // Subtitle generation
  generateSubtitles: (options) => {
    const processedOptions = { ...options };
    if (options.videoFile && typeof options.videoFile === "object") {
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
    return () =>
      ipcRenderer.removeListener("generate-subtitles-progress", listener);
  },

  // Subtitle translation
  translateSubtitles: (options) =>
    ipcRenderer.invoke("translate-subtitles", options),

  onTranslateSubtitlesProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("translate-subtitles-progress", listener);
    return () =>
      ipcRenderer.removeListener("translate-subtitles-progress", listener);
  },

  // Subtitle merging with video
  mergeSubtitles: (options) => ipcRenderer.invoke("merge-subtitles", options),

  onMergeSubtitlesProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("merge-subtitles-progress", listener);
    return () =>
      ipcRenderer.removeListener("merge-subtitles-progress", listener);
  },

  // File operations - check readiness first
  saveFile: async (options) => {
    return await invokeWithRetry("save-file", options);
  },

  openFile: (options) => {
    return invokeWithRetry("open-file", options);
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electron", electronAPI);
