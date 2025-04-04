const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  // Test methods
  ping: async () => {
    try {
      return await ipcRenderer.invoke('ping');
    } catch (error) {
      throw error;
    }
  },

  // Show a message from main process
  showMessage: message => ipcRenderer.invoke('show-message', message),

  // Simple test function that returns a value immediately
  test: () => 'Electron API is working',

  // Subtitle generation
  generateSubtitles: async options => {
    console.log('Generate subtitles called with options:', options);

    // Prepare options for sending to main process
    const processedOptions = { ...options };

    // If we have a videoFile (browser File object) but no videoPath,
    // we need to read the file data and send it to the main process
    if (options.videoFile && !options.videoPath) {
      console.log('File object detected without path - reading file data');

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
        console.error('Error reading file data:', error);
        throw new Error('Failed to read video file data');
      }
    }

    // Remove the File object since it can't be serialized for IPC
    delete processedOptions.videoFile;

    console.log('Sending options to main process:', processedOptions);
    return ipcRenderer.invoke('generate-subtitles', processedOptions);
  },
  onGenerateSubtitlesProgress: callback => {
    try {
      if (typeof callback !== 'function') {
        console.warn(
          'Invalid callback provided to onGenerateSubtitlesProgress'
        );
        return;
      }
      const listener = (event, progress) => {
        try {
          // Pass the progress object directly to the callback
          callback(progress);
        } catch (error) {
          console.error(
            'Error in generate-subtitles-progress callback:',
            error
          );
        }
      };
      ipcRenderer.on('generate-subtitles-progress', listener);

      // Return cleanup function
      return () => {
        try {
          ipcRenderer.removeListener('generate-subtitles-progress', listener);
        } catch (error) {
          console.error(
            'Error removing generate-subtitles-progress listener:',
            error
          );
        }
      };
    } catch (error) {
      console.error('Error in onGenerateSubtitlesProgress:', error);
    }
  },

  // Video merging
  mergeSubtitles: async options => {
    console.log('Merge subtitles called with options:', options);

    // Handle File object if present
    if (options.videoFile instanceof File) {
      console.log('File object detected in merge options - reading file data');
      const file = options.videoFile;
      const buffer = await file.arrayBuffer();
      console.log(`Read ${buffer.byteLength} bytes from video file for merge`);
      // Modify options for IPC: replace File with ArrayBuffer and name
      options.videoFileData = buffer;
      options.videoFileName = file.name;
      delete options.videoFile; // Remove non-serializable File object
    }

    // Keep operationId if present
    const finalOptions = { ...options };
    if (options.operationId) {
      finalOptions.operationId = options.operationId;
    }

    console.log('Sending merge options to main process:', finalOptions);
    try {
      const result = await ipcRenderer.invoke('merge-subtitles', finalOptions);
      console.log('Received merge result from main process:', result);
      return result;
    } catch (error) {
      console.error('Error during merge subtitles call:', error);
      throw error;
    }
  },

  onMergeSubtitlesProgress: callback => {
    try {
      if (typeof callback !== 'function') {
        console.warn('Invalid callback provided to onMergeSubtitlesProgress');
        return;
      }
      const listener = (event, progress) => callback(event, progress);
      ipcRenderer.on('merge-subtitles-progress', listener);

      // Return cleanup function
      return () => {
        try {
          ipcRenderer.removeListener('merge-subtitles-progress', listener);
        } catch (error) {
          console.error(
            'Error removing merge-subtitles-progress listener:',
            error
          );
        }
      };
    } catch (error) {
      console.error('Error in onMergeSubtitlesProgress:', error);
    }
  },

  // File operations
  saveFile: options => ipcRenderer.invoke('save-file', options),
  openFile: options => ipcRenderer.invoke('open-file', options),

  // Merge cancellation
  cancelOperation: async operationId => {
    console.log(
      `[Preload] Invoking 'cancel-operation' for operationId: ${operationId}`
    );
    try {
      const result = await ipcRenderer.invoke('cancel-operation', operationId);
      console.log(
        `[Preload] 'cancel-operation' result received for ${operationId}:`,
        result
      );
      return result;
    } catch (error) {
      console.error(
        `[Preload] Error invoking 'cancel-operation' for ${operationId}:`,
        error
      );
      throw error;
    }
  },

  // Move file
  moveFile: (sourcePath, destinationPath) =>
    ipcRenderer.invoke('move-file', sourcePath, destinationPath),

  // Delete file
  deleteFile: options => ipcRenderer.invoke('delete-file', options),

  // === API Key Management ===
  getApiKeyStatus: () => ipcRenderer.invoke('get-api-key-status'),
  saveApiKey: (keyType, apiKey) =>
    ipcRenderer.invoke('save-api-key', { keyType, apiKey }),

  // === Add Subtitle Translation ===
  translateSubtitles: options =>
    ipcRenderer.invoke('translate-subtitles', options),
  onTranslateSubtitlesProgress: callback => {
    if (!callback) {
      ipcRenderer.removeAllListeners('translate-subtitles-progress');
      return;
    }
    const listener = (event, progress) => callback(event, progress);
    ipcRenderer.on('translate-subtitles-progress', listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('translate-subtitles-progress', listener);
    };
  },

  // === URL Processing ===
  processUrl: async options => {
    console.log('Process URL called with options:', options);
    // Add validation if needed
    if (!options || !options.url) {
      throw new Error('URL is required for processing.');
    }
    return ipcRenderer.invoke('process-url', options);
  },
  onProcessUrlProgress: callback => {
    try {
      if (typeof callback !== 'function') {
        console.warn('Invalid callback provided to onProcessUrlProgress');
        return;
      }
      const listener = (event, progress) => {
        try {
          callback(progress); // Pass progress data to renderer callback
        } catch (error) {
          console.error('Error in process-url-progress callback:', error);
        }
      };
      ipcRenderer.on('process-url-progress', listener);

      // Return cleanup function
      return () => {
        try {
          ipcRenderer.removeListener('process-url-progress', listener);
        } catch (error) {
          console.error('Error removing process-url-progress listener:', error);
        }
      };
    } catch (error) {
      console.error('Error in onProcessUrlProgress:', error);
    }
  },

  // --- Expose copyFile function --- START ---
  copyFile: (sourcePath, destinationPath) =>
    ipcRenderer.invoke('copy-file', sourcePath, destinationPath),
  // --- Expose copyFile function --- END ---

  // === Add readFileContent === START ===
  readFileContent: async filePath => {
    console.log(`[preload] readFileContent called for path: ${filePath}`);
    return ipcRenderer.invoke('readFileContent', filePath);
  },
  // === Add readFileContent === END ===
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electron', electronAPI);

console.log('Preload script initialized successfully');
