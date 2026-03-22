import { contextBridge, ipcRenderer, IpcRendererEvent, shell } from 'electron';
import { createHash } from 'crypto';
import {
  AllByoSettings,
  ExposedRenderResult,
  RenderSubtitlesOptions,
  CreditBalanceResult,
  ByoVideoSuggestionModel,
  Stage5VideoSuggestionMode,
  VideoSuggestionModelPreference,
  VideoSuggestionRecency,
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
        processedOptions.durableRecoverySeed = [
          'generate-subtitles-file-sha256-v1',
          createHash('sha256').update(Buffer.from(fileData)).digest('hex'),
        ].join('\n');
      } catch (error) {
        console.error('[preload] Error reading video file:', error);
        throw new Error('Failed to read video file');
      }
    }
    delete processedOptions.videoFile;
    return ipcRenderer.invoke('generate-subtitles', processedOptions);
  },

  translateSubtitles: async (options: any) => {
    return ipcRenderer.invoke('translate-subtitles', options);
  },

  dubSubtitles: async (options: any) => {
    return ipcRenderer.invoke('dub-subtitles', options);
  },

  previewDubVoice: async (options: any) => {
    return ipcRenderer.invoke('preview-dub-voice', options);
  },

  generateTranscriptSummary: async (options: any) => {
    return ipcRenderer.invoke('generate-transcript-summary', options);
  },

  cutHighlightClip: async (options: any) => {
    return ipcRenderer.invoke('cut-highlight-clip', options);
  },

  translateOneLine: async (options: any) => {
    return ipcRenderer.invoke('translate-one-line', options);
  },

  transcribeOneLine: async (options: any) => {
    return ipcRenderer.invoke('transcribe-one-line', options);
  },

  transcribeRemaining: async (options: any) => {
    return ipcRenderer.invoke('transcribe-remaining', options);
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

  onDubSubtitlesProgress: (callback: (progress: any) => void) => {
    if (typeof callback !== 'function') return;
    const listener = (_: any, progress: any) => {
      try {
        callback(progress);
      } catch (error) {
        console.error('[preload] dub-subtitles-progress error:', error);
      }
    };
    ipcRenderer.on('dub-subtitles-progress', listener);
    return () => ipcRenderer.removeListener('dub-subtitles-progress', listener);
  },

  onMergeSubtitlesProgress: (cb: (p: any) => void) => {
    const handler = (_: any, progress: any) => cb(progress);
    ipcRenderer.on('merge-subtitles-progress', handler);
    return () =>
      ipcRenderer.removeListener('merge-subtitles-progress', handler);
  },

  onTranscriptSummaryProgress: (callback: (progress: any) => void) => {
    if (typeof callback !== 'function') return;
    const handler = (_: any, progress: any) => {
      try {
        callback(progress);
      } catch (error) {
        console.error('[preload] transcript-summary-progress error:', error);
      }
    };
    ipcRenderer.on('transcript-summary-progress', handler);
    return () =>
      ipcRenderer.removeListener('transcript-summary-progress', handler);
  },

  onHighlightCutProgress: (callback: (progress: any) => void) => {
    if (typeof callback !== 'function') return;
    const handler = (_: any, progress: any) => {
      try {
        callback(progress);
      } catch (error) {
        console.error('[preload] highlight-cut-progress error:', error);
      }
    };
    ipcRenderer.on('highlight-cut-progress', handler);
    return () => ipcRenderer.removeListener('highlight-cut-progress', handler);
  },

  cutCombinedHighlights: async (options: any) => {
    return ipcRenderer.invoke('cut-combined-highlights', options);
  },

  onCombinedHighlightCutProgress: (callback: (progress: any) => void) => {
    if (typeof callback !== 'function') return;
    const handler = (_: any, progress: any) => {
      try {
        callback(progress);
      } catch (error) {
        console.error(
          '[preload] combined-highlight-cut-progress error:',
          error
        );
      }
    };
    ipcRenderer.on('combined-highlight-cut-progress', handler);
    return () =>
      ipcRenderer.removeListener('combined-highlight-cut-progress', handler);
  },

  // ---------------------- File Operations ----------------------
  openFile: (options: any) => ipcRenderer.invoke('open-file', options),
  saveFile: (options: any) => ipcRenderer.invoke('save-file', options),
  saveSubtitleDocumentRecord: (options: any) =>
    ipcRenderer.invoke('save-subtitle-document-record', options),
  readSubtitleDocument: (options: any) =>
    ipcRenderer.invoke('read-subtitle-document', options),
  findSubtitleDocumentForFile: (options: any) =>
    ipcRenderer.invoke('find-subtitle-document-for-file', options),
  findSubtitleDocumentForSource: (options: any) =>
    ipcRenderer.invoke('find-subtitle-document-for-source', options),
  detachSubtitleDocumentSource: (options: any) =>
    ipcRenderer.invoke('detach-subtitle-document-source', options),
  saveSubtitleDocument: (options: any) =>
    ipcRenderer.invoke('save-subtitle-document', options),
  readSavedSubtitleMetadata: (options: any) =>
    ipcRenderer.invoke('read-saved-subtitle-metadata', options),
  saveStoredSubtitleArtifact: (options: any) =>
    ipcRenderer.invoke('save-stored-subtitle-artifact', options),
  findStoredSubtitleForVideo: (options: any) =>
    ipcRenderer.invoke('find-stored-subtitle-for-video', options),
  saveStoredTranscriptAnalysis: (options: any) =>
    ipcRenderer.invoke('save-stored-transcript-analysis', options),
  findStoredTranscriptAnalysis: (options: any) =>
    ipcRenderer.invoke('find-stored-transcript-analysis', options),
  syncStoredSubtitleVideoPath: (previousPath: string, savedPath: string) =>
    ipcRenderer.invoke(
      'sync-stored-subtitle-video-path',
      previousPath,
      savedPath
    ),
  rememberStoredSubtitleVideoPath: (entryId: string, sourceVideoPath: string) =>
    ipcRenderer.invoke(
      'remember-stored-subtitle-video-path',
      entryId,
      sourceVideoPath
    ),
  detachStoredSubtitleSource: (options: any) =>
    ipcRenderer.invoke('detach-stored-subtitle-source', options),
  deleteStoredSubtitleEntry: (entryId: string) =>
    ipcRenderer.invoke('delete-stored-subtitle-entry', entryId),
  deleteFile: (options: { filePath?: string } | string) => {
    const filePathToDelete =
      typeof options === 'string' ? options : options?.filePath;
    return ipcRenderer.invoke('delete-file', { filePathToDelete });
  },

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
  acceptProcessedUrl: (operationId: string) =>
    ipcRenderer.invoke('process-url:accept', operationId),
  discardProcessedUrl: (operationId: string) =>
    ipcRenderer.invoke('process-url:discard', operationId),
  cleanupAcceptedProcessedUrl: (options: {
    operationId: string;
    filePath: string;
  }) => ipcRenderer.invoke('process-url:cleanup-accepted', options),
  suggestVideos: (request: any) =>
    ipcRenderer.invoke('suggest-videos', request),
  onVideoSuggestionProgress: (callback: (progress: any) => void) => {
    if (typeof callback !== 'function') return () => void 0;
    const listener = (_: any, progress: any) => {
      try {
        callback(progress);
      } catch (error) {
        console.error('[preload] video-suggestion-progress error:', error);
      }
    };
    ipcRenderer.on('video-suggestion-progress', listener);
    return () =>
      ipcRenderer.removeListener('video-suggestion-progress', listener);
  },
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

  // ---------------------- Get File Size ----------------------
  getFileSize: (filePath: string) =>
    ipcRenderer.invoke('getFileSize', filePath),
  getFileIdentity: (filePath: string) =>
    ipcRenderer.invoke('getFileIdentity', filePath),

  // ---------------------- Disk Space ----------------------
  getDiskSpace: (filePath: string) =>
    ipcRenderer.invoke('getDiskSpace', filePath),
  getTempDiskSpace: () => ipcRenderer.invoke('getTempDiskSpace'),

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
  requestPngRenderCancel: async (operationId: string) => {
    return ipcRenderer.invoke('request-render-subtitles-cancel', {
      operationId,
    });
  },
  requestPngRenderStatus: async (operationId: string) => {
    return ipcRenderer.invoke('request-render-subtitles-status', {
      operationId,
    });
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

  createCheckoutSession: (packId: 'MICRO' | 'STARTER' | 'STANDARD' | 'PRO') =>
    ipcRenderer.invoke('create-checkout-session', packId),
  createByoUnlockSession: (): Promise<void> =>
    ipcRenderer.invoke('create-byo-unlock-session'),

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

  // Check if encryption is available for secure key storage
  checkEncryptionAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('check-encryption-available'),

  // Batched BYO settings - single call to load all settings at once
  getAllByoSettings: (): Promise<AllByoSettings> =>
    ipcRenderer.invoke('get-all-byo-settings'),

  getOpenAiApiKey: (): Promise<string | null> =>
    ipcRenderer.invoke('get-openai-api-key'),
  setOpenAiApiKey: (
    apiKey: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-openai-api-key', apiKey),
  clearOpenAiApiKey: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('clear-openai-api-key'),
  validateOpenAiApiKey: (
    apiKey?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('validate-openai-api-key', apiKey),
  getByoProviderEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('get-byo-provider-enabled'),
  setByoProviderEnabled: (
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-byo-provider-enabled', enabled),

  // Anthropic API key functions
  getAnthropicApiKey: (): Promise<string | null> =>
    ipcRenderer.invoke('get-anthropic-api-key'),
  setAnthropicApiKey: (
    apiKey: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-anthropic-api-key', apiKey),
  clearAnthropicApiKey: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('clear-anthropic-api-key'),
  validateAnthropicApiKey: (
    apiKey?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('validate-anthropic-api-key', apiKey),
  getByoAnthropicEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('get-byo-anthropic-enabled'),
  setByoAnthropicEnabled: (
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-byo-anthropic-enabled', enabled),

  isAdminMode: (): Promise<boolean> => ipcRenderer.invoke('is-admin-mode'),
  getSystemInfo: (): Promise<{
    platform: string;
    arch: string;
    release?: string;
    cpu?: string;
    isAppleSilicon?: boolean;
  }> => ipcRenderer.invoke('get-system-info'),
  getErrorReportContext: () => ipcRenderer.invoke('get-error-report-context'),

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
  onCheckoutCancelled: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('checkout-cancelled', handler);
    return () => ipcRenderer.removeListener('checkout-cancelled', handler);
  },

  getEntitlements: (): Promise<{
    byoOpenAi: boolean;
    byoAnthropic: boolean;
    byoElevenLabs: boolean;
    stage5AnthropicReviewAvailable: boolean;
    fetchedAt?: string;
  }> => ipcRenderer.invoke('get-entitlements'),
  refreshEntitlements: (): Promise<{
    byoOpenAi: boolean;
    byoAnthropic: boolean;
    byoElevenLabs: boolean;
    stage5AnthropicReviewAvailable: boolean;
    fetchedAt?: string;
  }> => ipcRenderer.invoke('refresh-entitlements'),
  onEntitlementsUpdated: (
    callback: (snapshot: {
      byoOpenAi: boolean;
      byoAnthropic: boolean;
      byoElevenLabs: boolean;
      stage5AnthropicReviewAvailable: boolean;
      fetchedAt?: string;
    }) => void
  ) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('entitlements-updated', handler);
    return () => ipcRenderer.removeListener('entitlements-updated', handler);
  },
  onEntitlementsError: (callback: (payload: { message: string }) => void) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('entitlements-error', handler);
    return () => ipcRenderer.removeListener('entitlements-error', handler);
  },
  onByoUnlockPending: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('byo-unlock-pending', handler);
    return () => ipcRenderer.removeListener('byo-unlock-pending', handler);
  },
  onByoUnlockConfirmed: (
    callback: (snapshot: {
      byoOpenAi: boolean;
      byoAnthropic: boolean;
      byoElevenLabs: boolean;
      stage5AnthropicReviewAvailable: boolean;
      fetchedAt?: string;
    }) => void
  ) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('byo-unlock-confirmed', handler);
    return () => ipcRenderer.removeListener('byo-unlock-confirmed', handler);
  },
  onByoUnlockCancelled: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('byo-unlock-cancelled', handler);
    ipcRenderer.on('byo-unlock-closed', handler);
    return () => {
      ipcRenderer.removeListener('byo-unlock-cancelled', handler);
      ipcRenderer.removeListener('byo-unlock-closed', handler);
    };
  },
  onByoUnlockError: (callback: (payload: { message?: string }) => void) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('byo-unlock-error', handler);
    return () => ipcRenderer.removeListener('byo-unlock-error', handler);
  },
  onOpenAiApiKeyChanged: (callback: (payload: { hasKey: boolean }) => void) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('openai-api-key-changed', handler);
    return () => ipcRenderer.removeListener('openai-api-key-changed', handler);
  },
  onAnthropicApiKeyChanged: (
    callback: (payload: { hasKey: boolean }) => void
  ) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('anthropic-api-key-changed', handler);
    return () =>
      ipcRenderer.removeListener('anthropic-api-key-changed', handler);
  },

  // ElevenLabs API key functions
  getElevenLabsApiKey: (): Promise<string | null> =>
    ipcRenderer.invoke('get-elevenlabs-api-key'),
  setElevenLabsApiKey: (
    apiKey: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-elevenlabs-api-key', apiKey),
  clearElevenLabsApiKey: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('clear-elevenlabs-api-key'),
  validateElevenLabsApiKey: (
    apiKey?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('validate-elevenlabs-api-key', apiKey),
  getByoElevenLabsEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('get-byo-elevenlabs-enabled'),
  setByoElevenLabsEnabled: (
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-byo-elevenlabs-enabled', enabled),

  // API key mode
  getApiKeyModeEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('get-api-key-mode-enabled'),
  setApiKeyModeEnabled: (
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-api-key-mode-enabled', enabled),

  // Claude translation preference
  getPreferClaudeTranslation: (): Promise<boolean> =>
    ipcRenderer.invoke('get-prefer-claude-translation'),
  setPreferClaudeTranslation: (
    prefer: boolean
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-prefer-claude-translation', prefer),

  // Claude review preference
  getPreferClaudeReview: (): Promise<boolean> =>
    ipcRenderer.invoke('get-prefer-claude-review'),
  setPreferClaudeReview: (
    prefer: boolean
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-prefer-claude-review', prefer),

  // Claude summary preference
  getPreferClaudeSummary: (): Promise<boolean> =>
    ipcRenderer.invoke('get-prefer-claude-summary'),
  setPreferClaudeSummary: (
    prefer: boolean
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-prefer-claude-summary', prefer),
  getStage5VideoSuggestionMode: (): Promise<Stage5VideoSuggestionMode> =>
    ipcRenderer.invoke('get-stage5-video-suggestion-mode'),
  setStage5VideoSuggestionMode: (
    mode: Stage5VideoSuggestionMode
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-stage5-video-suggestion-mode', mode),
  getByoVideoSuggestionModel: (): Promise<ByoVideoSuggestionModel> =>
    ipcRenderer.invoke('get-byo-video-suggestion-model'),
  setByoVideoSuggestionModel: (
    model: ByoVideoSuggestionModel
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-byo-video-suggestion-model', model),
  getVideoSuggestionModelPreference:
    (): Promise<VideoSuggestionModelPreference> =>
      ipcRenderer.invoke('get-video-suggestion-model-preference'),
  setVideoSuggestionModelPreference: (
    model: VideoSuggestionModelPreference
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-video-suggestion-model-preference', model),
  getVideoSuggestionTargetCountry: (): Promise<string> =>
    ipcRenderer.invoke('get-video-suggestion-target-country'),
  setVideoSuggestionTargetCountry: (
    country: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-video-suggestion-target-country', country),
  getVideoSuggestionRecency: (): Promise<VideoSuggestionRecency> =>
    ipcRenderer.invoke('get-video-suggestion-recency'),
  setVideoSuggestionRecency: (
    recency: VideoSuggestionRecency
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-video-suggestion-recency', recency),
  getVideoSuggestionPreferenceTopic: (): Promise<string> =>
    ipcRenderer.invoke('get-video-suggestion-preference-topic'),
  setVideoSuggestionPreferenceTopic: (
    value: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-video-suggestion-preference-topic', value),

  // Transcription provider preference
  getPreferredTranscriptionProvider: (): Promise<
    'elevenlabs' | 'openai' | 'stage5'
  > => ipcRenderer.invoke('get-preferred-transcription-provider'),
  setPreferredTranscriptionProvider: (
    provider: 'elevenlabs' | 'openai' | 'stage5'
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-preferred-transcription-provider', provider),

  // Dubbing provider preference
  getPreferredDubbingProvider: (): Promise<
    'elevenlabs' | 'openai' | 'stage5'
  > => ipcRenderer.invoke('get-preferred-dubbing-provider'),
  setPreferredDubbingProvider: (
    provider: 'elevenlabs' | 'openai' | 'stage5'
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-preferred-dubbing-provider', provider),

  // Stage5 dubbing TTS provider (when using Stage5 API)
  getStage5DubbingTtsProvider: (): Promise<'openai' | 'elevenlabs'> =>
    ipcRenderer.invoke('get-stage5-dubbing-tts-provider'),
  setStage5DubbingTtsProvider: (
    provider: 'openai' | 'elevenlabs'
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-stage5-dubbing-tts-provider', provider),

  onElevenLabsApiKeyChanged: (
    callback: (payload: { hasKey: boolean }) => void
  ) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('elevenlabs-api-key-changed', handler);
    return () =>
      ipcRenderer.removeListener('elevenlabs-api-key-changed', handler);
  },

  // App log channel (network/status messages from main)
  onAppLog: (callback: (payload: any) => void) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('app:log', handler);
    return () => ipcRenderer.removeListener('app:log', handler);
  },

  // ---------------------- Update System ----------------------
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateGetPostInstallNotice: () =>
    ipcRenderer.invoke('update:get-post-install-notice'),
  updateClearPostInstallNotice: (version?: string) =>
    ipcRenderer.invoke('update:clear-post-install-notice', version),
  updateGetRequiredNotice: () =>
    ipcRenderer.invoke('update:get-required-notice'),
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
  onUpdateRequired: (callback: (payload: any) => void) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('update:required', handler);
    return () => ipcRenderer.removeListener('update:required', handler);
  },

  // --- App-managed cookies session (cross-platform) ---
  connectCookiesForUrl: (
    url: string
  ): Promise<{
    success: boolean;
    cookiesWritten: number;
    cancelled: boolean;
    error?: string;
  }> => ipcRenderer.invoke('cookies:connect', url),
  getCookiesStatusForUrl: (
    url: string
  ): Promise<{ count: number; hasYouTubeAuth: boolean }> =>
    ipcRenderer.invoke('cookies:status', url),
  clearCookiesForUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('cookies:clear', url),

  // yt-dlp auto-update is always on; no setting exposed
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
  fileExists: async (p: string): Promise<boolean> => {
    if (!String(p || '').trim()) return false;
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  },
});

contextBridge.exposeInMainWorld('appShell', {
  openExternal: (url: string): Promise<void> => shell.openExternal(url),
  openPath: (path: string): Promise<string> => shell.openPath(path),
});

const isPackaged = ipcRenderer.sendSync('is-packaged');
contextBridge.exposeInMainWorld('env', { isPackaged });

// Listen for postMessage from Stripe checkout pages and forward to main process
window.addEventListener('message', event => {
  // Only accept messages from our trusted checkout domains
  const trustedOrigins = ['https://stage5.tools', 'https://translator.tools'];

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
