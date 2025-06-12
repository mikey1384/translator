import { contextBridge, ipcRenderer, IpcRendererEvent, shell } from 'electron';
import {
  ExposedRenderResult,
  RenderSubtitlesOptions,
  CreditBalanceResult,
} from '@shared-types/app';
import { promises as fs } from 'fs';

const electronAPI = {
  // ---------------------- Basic / Test Methods ----------------------
  ping: async (): Promise<string> => ipcRenderer.invoke('ping'),
  test: () => 'Electron API is working',
  showMessage: (message: string) => ipcRenderer.invoke('show-message', message),

  // ---------------------- Subtitle Generation ----------------------
  generateSubtitles: async (options: any) => {
    const processedOptions = { ...options };

    console.log('[preload] generateSubtitles options:', options);
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

  onMergeSubtitlesProgress: (cb: (p: any) => void) => {
    const handler = (_: any, progress: any) => cb(progress);
    ipcRenderer.on('merge-subtitles-progress', handler);
    return () =>
      ipcRenderer.removeListener('merge-subtitles-progress', handler);
  },

  // ---------------------- File Operations ----------------------
  openFile: (options: any) => ipcRenderer.invoke('open-file', options),
  saveFile: (options: any) => ipcRenderer.invoke('save-file', options),
  writeFile: (filePath: string, data: any) =>
    ipcRenderer.invoke('write-file', filePath, data),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  getLastSaveDirectory: () => ipcRenderer.invoke('get-last-save-directory'),
  getAppName: () => ipcRenderer.invoke('get-app-name'),

  // ---------------------- Video Processing & Screenshots ----------------------
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

  // ---------------------- URL Processing ----------------------
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

  // ---------------------- AI Connections ----------------------
  transcribeAudio: (options: any) =>
    ipcRenderer.invoke('transcribe-audio', options),
  cancelTranscription: (opId: string) =>
    ipcRenderer.invoke('cancel-transcription', opId),
  translateText: (options: any) =>
    ipcRenderer.invoke('translate-text', options),
  cancelTranslation: (opId: string) =>
    ipcRenderer.invoke('cancel-translation', opId),

  // ---------------------- Credentials ----------------------
  saveCredentials: (service: string, username: string, password: string) =>
    ipcRenderer.invoke('save-credentials', service, username, password),
  getCredentials: (service: string) =>
    ipcRenderer.invoke('get-credentials', service),
  deleteCredentials: (service: string) =>
    ipcRenderer.invoke('delete-credentials', service),
  isCredentialStored: (service: string) =>
    ipcRenderer.invoke('is-credential-stored', service),

  // ---------------------- Additional Progress Events ----------------------
  onProgress: (callback: (progress: any) => void) => {
    const handler = (_: any, progress: any) => callback(progress);
    ipcRenderer.on('conversion-progress', handler);
    return () => ipcRenderer.removeListener('conversion-progress', handler);
  },

  // ---------------------- Cancel / Move / Copy ----------------------
  cancelOperation: async (operationId: string) => {
    try {
      console.log('[preload] cancelOperation:', operationId);
      return await ipcRenderer.invoke('cancel-operation', operationId);
    } catch (error) {
      console.error('[preload] cancelOperation error:', error);
      throw error;
    }
  },
  moveFile: (src: string, dest: string) =>
    ipcRenderer.invoke('move-file', src, dest),
  copyFile: (src: string, dest: string) =>
    ipcRenderer.invoke('copy-file', src, dest),

  // ---------------------- Read File Content ----------------------
  readFileContent: (filePath: string) =>
    ipcRenderer.invoke('readFileContent', filePath),

  // ---------------------- Find-in-Page ----------------------
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

  // ---------------------- Get App Path ----------------------
  getAppPath: () => ipcRenderer.invoke('get-app-path'),

  // ---------------------- Get Locale URL ----------------------
  getLocaleUrl: (lang: string) => ipcRenderer.invoke('get-locale-url', lang),

  // ---------------------- Language Preferences ----------------------
  getLanguagePreference: () => ipcRenderer.invoke('get-language-preference'),
  setLanguagePreference: (lang: string) =>
    ipcRenderer.invoke('set-language-preference', lang),

  // --- ADD THESE LINES for Subtitle Target Language ---
  getSubtitleTargetLanguage: (): Promise<string> =>
    ipcRenderer.invoke('get-subtitle-target-language'),
  setSubtitleTargetLanguage: (lang: string): Promise<void> =>
    ipcRenderer.invoke('set-subtitle-target-language', lang),
  // --- END ADD ---

  // === Add Video Metadata Function ===
  getVideoMetadata: (filePath: string) =>
    ipcRenderer.invoke('get-video-metadata', filePath),
  hasVideoTrack: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('has-video-track', filePath),

  // === Add functions for PNG Sequence Rendering ===

  /**
   * Sends the initial request to start the PNG sequence render process.
   */
  sendPngRenderRequest: (options: RenderSubtitlesOptions): void => {
    try {
      console.log('[Preload] Sending PngRenderRequest:', options);
      ipcRenderer.send('render-subtitles-request', options);
    } catch (error) {
      console.error('[Preload] Error sending PngRenderRequest:', error);
    }
  },
  cancelPngRender: (operationId: string): void => {
    console.log('[Preload] Cancelling render job:', operationId);
    ipcRenderer.send('render-subtitles-cancel', { operationId });
  },
  onPngRenderResult: (
    callback: (result: ExposedRenderResult) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, result: ExposedRenderResult) => {
      console.log('[Preload] Received PngRenderResult:', result);
      callback(result);
    };

    console.log(`[Preload] Adding listener for render-subtitles-result`);
    ipcRenderer.on('render-subtitles-result', handler);

    // Return cleanup function
    return () => {
      console.log(`[Preload] Removing listener for render-subtitles-result`);
      ipcRenderer.removeListener('render-subtitles-result', handler);
    };
  },

  // === End Add ===

  // --- ADD THESE MAPPINGS ---
  saveVideoPlaybackPosition: (
    filePath: string,
    position: number
  ): Promise<void> =>
    ipcRenderer.invoke('save-video-playback-position', filePath, position),
  getVideoPlaybackPosition: (filePath: string): Promise<number | null> =>
    ipcRenderer.invoke('get-video-playback-position', filePath),
  // --- END ADD MAPPINGS ---

  getCreditBalance: (): Promise<CreditBalanceResult> =>
    ipcRenderer.invoke('get-credit-balance'),

  createCheckoutSession: (packId: 'STARTER' | 'STANDARD' | 'PRO') =>
    ipcRenderer.invoke('create-checkout-session', packId),

  // Admin credit reset function
  resetCredits: (): Promise<{
    success: boolean;
    creditsAdded?: number;
    error?: string;
  }> => ipcRenderer.invoke('reset-credits'),

  // Admin reset credits to zero function
  resetCreditsToZero: (): Promise<{
    success: boolean;
    error?: string;
  }> => ipcRenderer.invoke('reset-credits-to-zero'),

  // Get device ID for admin button visibility
  getDeviceId: (): Promise<string> => ipcRenderer.invoke('get-device-id'),
  getAdminDeviceId: (): Promise<string | null> =>
    ipcRenderer.invoke('get-admin-device-id'),

  // Listen for credit balance updates from the main process
  onCreditsUpdated: (
    callback: (payload: { creditBalance: number; hoursBalance: number }) => void
  ) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('credits-updated', handler);
    return () => ipcRenderer.removeListener('credits-updated', handler);
  },

  // Listen for checkout status events
  onCheckoutPending: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('checkout-pending', handler);
    return () => ipcRenderer.removeListener('checkout-pending', handler);
  },

  onCheckoutConfirmed: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('checkout-confirmed', handler);
    return () => ipcRenderer.removeListener('checkout-confirmed', handler);
  },

  // ---------------------- Update System ----------------------
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (callback: (info: any) => void) => {
    const handler = (_: any, info: any) => callback(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateProgress: (callback: (percent: number) => void) => {
    const handler = (_: any, percent: number) => callback(percent);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  onUpdateDownloaded: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('update:downloaded', handler);
    return () => ipcRenderer.removeListener('update:downloaded', handler);
  },
  onUpdateError: (callback: (msg: string) => void) => {
    const handler = (_: any, msg: string) => callback(msg);
    ipcRenderer.on('update:error', handler);
    return () => ipcRenderer.removeListener('update:error', handler);
  },
};

try {
  contextBridge.exposeInMainWorld('electron', electronAPI);
  console.log('[preload] contextBridge.exposeInMainWorld: success');
} catch (error) {
  console.error('[preload] exposeInMainWorld error:', error);
}

contextBridge.exposeInMainWorld('fileApi', {
  readText: (p: string) => fs.readFile(p, 'utf8'),
  writeText: (p: string, data: string) => fs.writeFile(p, data, 'utf8'),
});

contextBridge.exposeInMainWorld('appShell', {
  openExternal: (url: string): Promise<void> => shell.openExternal(url),
});

const isPackaged = ipcRenderer.sendSync('is-packaged');
contextBridge.exposeInMainWorld('env', { isPackaged });

// Listen for postMessage from Stripe checkout pages and forward to main process
window.addEventListener('message', event => {
  // Only accept messages from our trusted checkout domains
  const trustedOrigins = ['https://stage5.tools'];

  // In development, also allow localhost for testing
  const isPackaged = ipcRenderer.sendSync('is-packaged');
  if (!isPackaged) {
    trustedOrigins.push('http://localhost:3000');
  }

  if (!trustedOrigins.includes(event.origin)) {
    return;
  }

  if (event.data?.type === 'stripe-success') {
    ipcRenderer.send('stripe-success', event.data);
  } else if (event.data?.type === 'stripe-cancelled') {
    ipcRenderer.send('stripe-cancelled', event.data);
  }
});
