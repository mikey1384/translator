import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  // Simple test/ping
  ping: async (): Promise<string> => ipcRenderer.invoke('ping'),
  test: () => 'Electron API is working',
  showMessage: (message: string) => ipcRenderer.invoke('show-message', message),

  // Subtitle generation
  generateSubtitles: async (options: any) => {
    const processedOptions = { ...options };

    // If a File object is present but no path, convert it to ArrayBuffer
    if (options.videoFile && !options.videoPath) {
      try {
        const fileData = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = reject;
          reader.readAsArrayBuffer(options.videoFile);
        });
        processedOptions.videoFileData = fileData;
        processedOptions.videoFileName = options.videoFile.name;
      } catch (error) {
        console.error('[preload] Error reading video file:', error);
        throw new Error('Failed to read video file');
      }
    }
    delete processedOptions.videoFile;
    return ipcRenderer.invoke('generate-subtitles', processedOptions);
  },
  onGenerateSubtitlesProgress: (callback: (progress: any) => void) => {
    if (typeof callback !== 'function') return;
    const listener = (_: any, progress: any) => {
      try {
        callback(progress);
      } catch (error) {
        console.error('[preload] generate-subtitles-progress error:', error);
      }
    };
    ipcRenderer.on('generate-subtitles-progress', listener);
    return () =>
      ipcRenderer.removeListener('generate-subtitles-progress', listener);
  },

  // Merging subtitles
  mergeSubtitles: async (options: any) => {
    // Prioritize videoPath if it exists (meaning file loaded from disk)
    if (!options.videoPath && options.videoFile instanceof File) {
      // Only process videoFile if videoPath is NOT provided
      try {
        const buffer = await options.videoFile.arrayBuffer();
        options.videoFileData = buffer;
        options.videoFileName = options.videoFile.name;
        options.videoPath = options.videoPath; // Keep the original path
        // Explicitly remove videoFile and videoFileName if path is used
        delete options.videoFile;
        delete options.videoFileName;
      } catch (error) {
        console.error(
          '[preload] Error reading videoFile for mergeSubtitles:',
          error
        );
        // Decide how to handle - maybe throw or return error?
        throw new Error('Failed to read video file for merge');
      }
    } else if (options.videoPath) {
      delete options.videoFileName;
    }
    // Always remove videoFile object if it exists, as we use path or data
    delete options.videoFile;
    // Log the options being sent using console.log
    console.log(
      '[preload] mergeSubtitles sending options keys:',
      JSON.stringify(Object.keys(options))
    );
    // Send potentially modified options to main process
    return ipcRenderer.invoke('merge-subtitles', { ...options });
  },
  onMergeSubtitlesProgress: (callback: (event: any, progress: any) => void) => {
    if (typeof callback !== 'function') return;
    const listener = (event: any, progress: any) => callback(event, progress);
    ipcRenderer.on('merge-subtitles-progress', listener);
    return () =>
      ipcRenderer.removeListener('merge-subtitles-progress', listener);
  },

  // File operations
  openFile: (options: any) => ipcRenderer.invoke('open-file', options),
  saveFile: (options: any) => ipcRenderer.invoke('save-file', options),
  writeFile: (filePath: string, data: any) =>
    ipcRenderer.invoke('write-file', filePath, data),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  getLastSaveDirectory: () => ipcRenderer.invoke('get-last-save-directory'),
  getAppName: () => ipcRenderer.invoke('get-app-name'),

  // Video processing & screenshots
  processVideo: (options: any) => ipcRenderer.invoke('process-video', options),
  cancelVideoProcessing: (opId: string) =>
    ipcRenderer.invoke('cancel-video-processing', opId),
  detectScenes: (options: any) => ipcRenderer.invoke('detect-scenes', options),
  cancelSceneDetection: (opId: string) =>
    ipcRenderer.invoke('cancel-scene-detection', opId),
  extractAudio: (options: any) => ipcRenderer.invoke('extract-audio', options),
  cancelAudioExtraction: (opId: string) =>
    ipcRenderer.invoke('cancel-audio-extraction', opId),
  convertSubtitles: (options: any) =>
    ipcRenderer.invoke('convert-subtitles', options),

  // URL processing
  processUrl: (options: any) => ipcRenderer.invoke('process-url', options),
  onProcessUrlProgress: (callback: (progress: any) => void) => {
    if (typeof callback !== 'function') return;
    const listener = (_: any, progress: any) => {
      try {
        callback(progress);
      } catch (error) {
        console.error('[preload] process-url-progress callback error:', error);
      }
    };
    ipcRenderer.on('url-processing-progress', listener);
    return () =>
      ipcRenderer.removeListener('url-processing-progress', listener);
  },

  // OpenAI
  transcribeAudio: (options: any) =>
    ipcRenderer.invoke('transcribe-audio', options),
  cancelTranscription: (opId: string) =>
    ipcRenderer.invoke('cancel-transcription', opId),
  translateText: (options: any) =>
    ipcRenderer.invoke('translate-text', options),
  cancelTranslation: (opId: string) =>
    ipcRenderer.invoke('cancel-translation', opId),

  // Credentials
  saveCredentials: (service: string, username: string, password: string) =>
    ipcRenderer.invoke('save-credentials', service, username, password),
  getCredentials: (service: string) =>
    ipcRenderer.invoke('get-credentials', service),
  deleteCredentials: (service: string) =>
    ipcRenderer.invoke('delete-credentials', service),
  isCredentialStored: (service: string) =>
    ipcRenderer.invoke('is-credential-stored', service),

  // Additional progress events
  onProgress: (callback: (progress: any) => void) => {
    const handler = (_: any, progress: any) => callback(progress);
    ipcRenderer.on('conversion-progress', handler);
    return () => ipcRenderer.removeListener('conversion-progress', handler);
  },

  // Merging or canceling operation
  cancelOperation: async (operationId: string) => {
    try {
      return await ipcRenderer.invoke('cancel-operation', operationId);
    } catch (error) {
      console.error('[preload] cancelOperation error:', error);
      throw error;
    }
  },

  // Move / Copy
  moveFile: (src: string, dest: string) =>
    ipcRenderer.invoke('move-file', src, dest),
  copyFile: (src: string, dest: string) =>
    ipcRenderer.invoke('copy-file', src, dest),

  // API Key
  getApiKeyStatus: () => ipcRenderer.invoke('get-api-key-status'),
  saveApiKey: (keyType: string, apiKey: string) =>
    ipcRenderer.invoke('save-api-key', { keyType, apiKey }),

  // Reading file contents
  readFileContent: (filePath: string) =>
    ipcRenderer.invoke('readFileContent', filePath),

  // Find-in-page
  sendFindInPage: (opts: any) => ipcRenderer.send('find-in-page', opts),
  sendStopFind: () => ipcRenderer.send('stop-find'),
  onShowFindBar: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('show-find-bar', listener);
    return () => ipcRenderer.removeListener('show-find-bar', listener);
  },
  onFindResults: (callback: (results: any) => void) => {
    const listener = (_: any, results: any) => callback(results);
    ipcRenderer.on('find-results', listener);
    return () => ipcRenderer.removeListener('find-results', listener);
  },
};

try {
  contextBridge.exposeInMainWorld('electron', electronAPI);
  console.log('[preload] contextBridge.exposeInMainWorld: success');
} catch (error) {
  console.error('[preload] exposeInMainWorld error:', error);
}
