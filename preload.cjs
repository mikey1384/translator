// CommonJS version of preload script
const { contextBridge, ipcRenderer } = require("electron");

// Log when preload script is executed
console.log("==== PRELOAD SCRIPT STARTING ====");
console.log("Process ID:", process.pid);
console.log("ipcRenderer available:", !!ipcRenderer);
console.log(
  "Is ipcRenderer.invoke a function:",
  typeof ipcRenderer.invoke === "function"
);

// Add better error handling for IPC calls
const invokeWithRetry = async (channel, ...args) => {
  console.log(
    `[PRELOAD] STARTING invoke: ${channel} with args:`,
    args.length ? args[0] : "none"
  );

  // Try to ping to check if IPC is working
  try {
    console.log("[PRELOAD] Testing basic IPC with ping before trying", channel);
    const pingResult = await ipcRenderer.invoke("ping");
    console.log(
      `[PRELOAD] SUCCESS: Ping test before ${channel}: ${pingResult}`
    );
  } catch (pingError) {
    console.warn(
      `[PRELOAD] WARNING: Ping test failed before ${channel}:`,
      pingError
    );
  }

  try {
    console.log(`[PRELOAD] Making direct invoke call to ${channel}...`);
    const result = await ipcRenderer.invoke(channel, ...args);
    console.log(`[PRELOAD] SUCCESS: Direct invoke of ${channel} succeeded`);
    return result;
  } catch (error) {
    console.error(`[PRELOAD] ERROR: Error invoking ${channel}:`, error);

    // If handler not registered, wait and retry multiple times
    if (error.message && error.message.includes("No handler registered")) {
      console.log(
        `[PRELOAD] RETRY: Handler not registered for ${channel}, waiting for main process...`
      );

      // Try pinging to verify IPC is working
      try {
        const pingResult = await ipcRenderer.invoke("ping");
        console.log(
          `[PRELOAD] Ping successful during ${channel} retry: ${pingResult}`
        );
      } catch (pingError) {
        console.warn(
          `[PRELOAD] Ping also failed during ${channel} retry:`,
          pingError
        );
      }

      // Try multiple times with increasing delays
      const retryDelays = [
        300, 600, 1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000,
      ];

      for (const delay of retryDelays) {
        console.log(
          `[PRELOAD] RETRY: Waiting ${delay}ms before retry ${channel}...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));

        try {
          console.log(
            `[PRELOAD] RETRY: Attempting ${channel} invocation again...`
          );
          const result = await ipcRenderer.invoke(channel, ...args);
          console.log(
            `[PRELOAD] SUCCESS: Retry of ${channel} succeeded after ${delay}ms delay`
          );
          return result;
        } catch (retryError) {
          console.error(
            `[PRELOAD] ERROR: Retry failed for ${channel} after ${delay}ms:`,
            retryError
          );

          // Try pinging again to check IPC status
          try {
            const pingResult = await ipcRenderer.invoke("ping");
            console.log(
              `[PRELOAD] RETRY: Ping successful after failed ${channel} retry: ${pingResult}`
            );
          } catch (pingError) {
            console.warn(
              `[PRELOAD] ERROR: Ping also failed after ${channel} retry:`,
              pingError
            );
          }
        }
      }

      console.error(`[PRELOAD] FATAL ERROR: All retries for ${channel} failed`);
      throw new Error(
        `Failed to connect to ${channel} after multiple retries. The main process may not be fully initialized.`
      );
    }

    throw error;
  }
};

console.log("[PRELOAD] Setting up electron API bridge");

// Define a minimal API to test the IPC connection
const electronAPI = {
  // Test methods
  ping: async () => {
    console.log("[PRELOAD] API.ping called");
    try {
      const result = await ipcRenderer.invoke("ping");
      console.log("[PRELOAD] API.ping result:", result);
      return result;
    } catch (error) {
      console.error("[PRELOAD] API.ping error:", error);
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
    return () =>
      ipcRenderer.removeListener("generate-subtitles-progress", listener);
  },

  // Subtitle translation
  translateSubtitles: (options) =>
    ipcRenderer.invoke("translate-subtitles", options),

  onTranslateSubtitlesProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("translate-subtitles-progress", listener);

    // Return a function to remove the listener when no longer needed
    return () =>
      ipcRenderer.removeListener("translate-subtitles-progress", listener);
  },

  // Subtitle merging with video
  mergeSubtitles: (options) => ipcRenderer.invoke("merge-subtitles", options),

  onMergeSubtitlesProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("merge-subtitles-progress", listener);

    // Return a function to remove the listener when no longer needed
    return () =>
      ipcRenderer.removeListener("merge-subtitles-progress", listener);
  },

  // File operations - check readiness first
  saveFile: async (options) => {
    console.log("[PRELOAD] API.saveFile called with options:", {
      hasContent: !!options.content,
      contentLength: options.content?.length,
      defaultPath: options.defaultPath,
      filePath: options.filePath,
    });

    // Always use the retry mechanism which is more reliable
    console.log("[PRELOAD] API.saveFile using invokeWithRetry for save-file");
    const result = await invokeWithRetry("save-file", options);
    console.log("[PRELOAD] API.saveFile completed with result:", result);
    return result;
  },

  openFile: (options) => {
    console.log("[PRELOAD] API.openFile called");
    return invokeWithRetry("open-file", options);
  },
};

// Expose the API to the renderer process
console.log("[PRELOAD] Exposing electron API to renderer via contextBridge");
contextBridge.exposeInMainWorld("electron", electronAPI);

// Log when preload script has completed
console.log("[PRELOAD] Exposed API with methods:", Object.keys(electronAPI));
console.log("==== PRELOAD SCRIPT COMPLETED ====");
