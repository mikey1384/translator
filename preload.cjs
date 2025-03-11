// CommonJS version of preload script
const { contextBridge, ipcRenderer } = require("electron");

// Add better error handling for IPC calls
const invokeWithRetry = async (channel, ...args) => {
  try {
    console.log(`Invoking ${channel} with args:`, args);
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    console.error(`Error invoking ${channel}:`, error);
    if (error.message && error.message.includes("No handler registered")) {
      console.warn(`No handler registered for ${channel}, will retry`);
      const retryDelays = [
        300, 600, 1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000,
      ];

      for (const delay of retryDelays) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          return await ipcRenderer.invoke(channel, ...args);
        } catch (retryError) {
          // Continue to the next retry
          console.warn(`Retry failed for ${channel}:`, retryError);
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
  generateSubtitles: async (options) => {
    console.log("Generate subtitles called with options:", options);

    // Prepare options for sending to main process
    const processedOptions = { ...options };

    // If we have a videoFile (browser File object) but no videoPath,
    // we need to read the file data and send it to the main process
    if (options.videoFile && !options.videoPath) {
      console.log("File object detected without path - reading file data");

      try {
        // Read the File object as an ArrayBuffer
        const fileData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsArrayBuffer(options.videoFile);
        });

        console.log(`Read ${fileData.byteLength} bytes from file`);

        // Create properties for main process to use
        processedOptions.videoFileData = fileData;
        processedOptions.videoFileName = options.videoFile.name;
      } catch (error) {
        console.error("Error reading file data:", error);
        throw new Error("Failed to read video file data");
      }
    }

    // Remove the File object since it can't be serialized for IPC
    delete processedOptions.videoFile;

    console.log("Sending options to main process");
    return ipcRenderer.invoke("generate-subtitles", processedOptions);
  },

  onGenerateSubtitlesProgress: (callback) => {
    // Make sure callback is a function before registering the listener
    if (typeof callback === 'function') {
      const listener = (_event, progress) => {
        try {
          callback(progress || {});
        } catch (error) {
          console.error("Error in generate-subtitles-progress callback:", error);
        }
      };
      
      ipcRenderer.on("generate-subtitles-progress", listener);
      
      // Return a function to remove the listener
      return () => {
        try {
          ipcRenderer.removeListener("generate-subtitles-progress", listener);
        } catch (error) {
          console.error("Error removing generate-subtitles-progress listener:", error);
        }
      };
    } else {
      console.warn("Invalid callback provided to onGenerateSubtitlesProgress");
      // Return a no-op function so calling code doesn't break
      return () => {};
    }
  },

  // Subtitle translation
  translateSubtitles: (options) =>
    ipcRenderer.invoke("translate-subtitles", options),

  onTranslateSubtitlesProgress: (callback) => {
    // Make sure callback is a function before registering the listener
    if (typeof callback === 'function') {
      const listener = (_event, progress) => {
        try {
          callback(progress || {});
        } catch (error) {
          console.error("Error in translate-subtitles-progress callback:", error);
        }
      };
      
      ipcRenderer.on("translate-subtitles-progress", listener);
      
      // Return a function to remove the listener
      return () => {
        try {
          ipcRenderer.removeListener("translate-subtitles-progress", listener);
        } catch (error) {
          console.error("Error removing translate-subtitles-progress listener:", error);
        }
      };
    } else {
      console.warn("Invalid callback provided to onTranslateSubtitlesProgress");
      // Return a no-op function so calling code doesn't break
      return () => {};
    }
  },

  // Subtitle merging with video
  mergeSubtitles: (options) => ipcRenderer.invoke("merge-subtitles", options),

  onMergeSubtitlesProgress: (callback) => {
    // Make sure callback is a function before registering the listener
    if (typeof callback === 'function') {
      const listener = (_event, progress) => {
        try {
          callback(progress || {});
        } catch (error) {
          console.error("Error in merge-subtitles-progress callback:", error);
        }
      };
      
      ipcRenderer.on("merge-subtitles-progress", listener);
      
      // Return a function to remove the listener
      return () => {
        try {
          ipcRenderer.removeListener("merge-subtitles-progress", listener);
        } catch (error) {
          console.error("Error removing merge-subtitles-progress listener:", error);
        }
      };
    } else {
      console.warn("Invalid callback provided to onMergeSubtitlesProgress");
      // Return a no-op function so calling code doesn't break
      return () => {};
    }
  },

  // File operations - check readiness first
  saveFile: async (options) => {
    console.log("Saving file with options:", options);
    return await invokeWithRetry("save-file", options);
  },

  openFile: async (options) => {
    console.log("Opening file with options:", options);
    try {
      const result = await invokeWithRetry("open-file", options);

      // Add videoPath property if we have filePath or filePaths[0] but no explicit videoPath
      if (
        !result.videoPath &&
        (result.filePath || (result.filePaths && result.filePaths.length > 0))
      ) {
        result.videoPath = result.filePath || result.filePaths[0];
        console.log("Added videoPath to result:", result.videoPath);
      }

      console.log("Open file result after processing:", result);
      return result;
    } catch (error) {
      console.error("Error in openFile:", error);
      return { error: String(error), filePaths: [] };
    }
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electron", electronAPI);

console.log("Preload script initialized successfully");
