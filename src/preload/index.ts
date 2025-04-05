import { contextBridge, ipcRenderer } from 'electron';

console.log('[preload] Script start');

const electronAPI = {
  // Test methods
  ping: async (): Promise<string> => {
    return await ipcRenderer.invoke('ping');
  },

  // Show a message from main process
  showMessage: (message: string) => ipcRenderer.invoke('show-message', message),

  // Simple test function that returns a value immediately
  test: () => 'Electron API is working',

  // Subtitle generation
  generateSubtitles: async (options: any) => {
    console.log('Generate subtitles called with options:', options);

    // Prepare options for sending to main process
    const processedOptions = { ...options };

    // If we have a videoFile (browser File object) but no videoPath,
    // we need to read the file data and send it to the main process
    if (options.videoFile && !options.videoPath) {
      console.log('File object detected without path - reading file data');

      try {
        // Read the File object as an ArrayBuffer
        const fileData = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
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

  onGenerateSubtitlesProgress: (callback: (progress: any) => void) => {
    try {
      if (typeof callback !== 'function') {
        console.warn(
          'Invalid callback provided to onGenerateSubtitlesProgress'
        );
        return;
      }
      const listener = (_event: any, progress: any) => {
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
  mergeSubtitles: async (options: any) => {
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

  onMergeSubtitlesProgress: (callback: (event: any, progress: any) => void) => {
    try {
      if (typeof callback !== 'function') {
        console.warn('Invalid callback provided to onMergeSubtitlesProgress');
        return;
      }
      const listener = (event: any, progress: any) => callback(event, progress);
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
  chooseFile: options => ipcRenderer.invoke('choose-file', options),
  saveFile: options => ipcRenderer.invoke('save-file', options),
  writeFile: (filePath, data) =>
    ipcRenderer.invoke('write-file', filePath, data),
  readFile: filePath => ipcRenderer.invoke('read-file', filePath),
  deleteFile: filePath => ipcRenderer.invoke('delete-file', filePath),
  getLastSaveDirectory: () => ipcRenderer.invoke('get-last-save-directory'),
  getAppName: () => ipcRenderer.invoke('get-app-name'),

  // Screenshot
  processVideo: options => ipcRenderer.invoke('process-video', options),
  cancelVideoProcessing: operationId =>
    ipcRenderer.invoke('cancel-video-processing', operationId),
  detectScenes: options => ipcRenderer.invoke('detect-scenes', options),
  cancelSceneDetection: operationId =>
    ipcRenderer.invoke('cancel-scene-detection', operationId),
  extractAudio: options => ipcRenderer.invoke('extract-audio', options),
  cancelAudioExtraction: operationId =>
    ipcRenderer.invoke('cancel-audio-extraction', operationId),
  convertSubtitles: options => ipcRenderer.invoke('convert-subtitles', options),

  // New URL handler
  processUrl: options => ipcRenderer.invoke('process-url', options),

  // Test function
  testDownload: url => ipcRenderer.invoke('test-download', url),

  // OpenAI Connections
  transcribeAudio: options => ipcRenderer.invoke('transcribe-audio', options),
  cancelTranscription: operationId =>
    ipcRenderer.invoke('cancel-transcription', operationId),
  translateText: options => ipcRenderer.invoke('translate-text', options),
  cancelTranslation: operationId =>
    ipcRenderer.invoke('cancel-translation', operationId),

  // Credentials
  saveCredentials: (service, username, password) =>
    ipcRenderer.invoke('save-credentials', service, username, password),
  getCredentials: service => ipcRenderer.invoke('get-credentials', service),
  deleteCredentials: service =>
    ipcRenderer.invoke('delete-credentials', service),
  isCredentialStored: service =>
    ipcRenderer.invoke('is-credential-stored', service),

  // Progress updates via events (one-way)
  onProgress: callback => {
    const progressHandler = (_, progress) => callback(progress);
    ipcRenderer.on('conversion-progress', progressHandler);
    return () =>
      ipcRenderer.removeListener('conversion-progress', progressHandler);
  },

  // Merge cancellation
  cancelOperation: async (operationId: string) => {
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
  moveFile: (sourcePath: string, destinationPath: string) =>
    ipcRenderer.invoke('move-file', sourcePath, destinationPath),

  // === API Key Management ===
  getApiKeyStatus: () => ipcRenderer.invoke('get-api-key-status'),
  saveApiKey: (keyType: string, apiKey: string) =>
    ipcRenderer.invoke('save-api-key', { keyType, apiKey }),

  // === URL Processing ===
  onProcessUrlProgress: (callback: (progress: any) => void) => {
    try {
      if (typeof callback !== 'function') {
        console.warn('Invalid callback provided to onProcessUrlProgress');
        return;
      }
      const listener = (_event: any, progress: any) => {
        try {
          callback(progress); // Pass progress data to renderer callback
        } catch (error) {
          console.error('Error in process-url-progress callback:', error);
        }
      };
      ipcRenderer.on('url-processing-progress', listener);

      // Return cleanup function
      return () => {
        try {
          ipcRenderer.removeListener('url-processing-progress', listener);
        } catch (error) {
          console.error('Error removing process-url-progress listener:', error);
        }
      };
    } catch (error) {
      console.error('Error in onProcessUrlProgress:', error);
    }
  },

  // --- Expose copyFile function ---
  copyFile: (sourcePath: string, destinationPath: string) =>
    ipcRenderer.invoke('copy-file', sourcePath, destinationPath),

  // === Add readFileContent ===
  readFileContent: async (filePath: string) => {
    console.log(`[preload] readFileContent called for path: ${filePath}`);
    return ipcRenderer.invoke('readFileContent', filePath);
  },

  // --- Add Find-in-Page Functions ---
  sendFindInPage: (options: any) => {
    ipcRenderer.send('find-in-page', options);
  },

  sendStopFind: () => {
    ipcRenderer.send('stop-find');
  },

  onShowFindBar: (callback: () => void) => {
    console.log('[preload] Setting up onShowFindBar listener');
    const listener = () => callback();
    ipcRenderer.on('show-find-bar', listener);
    // Return cleanup function
    return () => {
      console.log('[preload] Cleaning up onShowFindBar listener');
      ipcRenderer.removeListener('show-find-bar', listener);
    };
  },

  onFindResults: (callback: (results: any) => void) => {
    console.log('[preload] Setting up onFindResults listener');
    const listener = (_event: any, results: any) => callback(results);
    ipcRenderer.on('find-results', listener);
    // Return cleanup function
    return () => {
      console.log('[preload] Cleaning up onFindResults listener');
      ipcRenderer.removeListener('find-results', listener);
    };
  },
};

// Expose your API
try {
  contextBridge.exposeInMainWorld('electron', electronAPI);
  console.log('[preload] contextBridge.exposeInMainWorld succeeded');
} catch (error) {
  console.error('[preload] Error exposing preload APIs:', error);
}

console.log('[preload] Script end');
