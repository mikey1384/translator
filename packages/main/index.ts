import dotenv from 'dotenv';
import path from 'path';
import { esmDirname } from '@shared/esm-paths';

const __dirname = esmDirname(import.meta.url);

// Configure dotenv to look for .env file in project root
const envPath = path.resolve(__dirname, '../../../../.env');
dotenv.config({ path: envPath });

import log from 'electron-log';

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  dialog,
  MenuItemConstructorOptions,
} from 'electron';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import nodeProcess from 'process';
import os from 'os';
import * as renderWindowHandlers from './handlers/render-window-handlers/index.js';
import * as subtitleHandlers from './handlers/subtitle-handlers.js';
import * as registry from './active-processes.js';
import { buildSettingsHandlers } from './handlers/settings-handlers.js';
import { buildUpdateHandlers } from './handlers/update-handlers.js';
import { settingsStore } from './store/settings-store.js';

import { SaveFileService } from './services/save-file.js';
import { FileManager } from './services/file-manager.js';
import {
  cleanupInterruptedUrlDownloadPromotions,
  cleanupLegacyUrlDownloadScratchDir,
  getUrlDownloadLibraryDir,
  getUrlDownloadScratchDir,
} from './services/url-download-library.js';
import {
  handleAcceptProcessedUrl,
  handleCleanupAcceptedProcessedUrl,
  handleDiscardProcessedUrl,
  handleMutateVideoSuggestionDownloadHistory,
  handleProcessUrl,
  handleSetMountedUrlDownloadLibraryPaths,
  initializeUrlHandler,
} from './handlers/url-handlers.js';
import {
  clearCookiesForUrl,
  connectCookiesInteractive,
  getCookieStatusForUrl,
} from './services/url-processor/site-cookies.js';
import * as fileHandlers from './handlers/file-handlers.js';
import * as subtitleDocumentHandlers from './handlers/subtitle-document-handlers.js';
import * as utilityHandlers from './handlers/utility-handlers.js';
import { createFFmpegContext } from './services/ffmpeg-runner.js';
import type { FFmpegContext } from './services/ffmpeg-runner.js';
import {
  handleCreateCheckoutSession,
  handleResetCredits,
  handleResetCreditsToZero,
  handleCreateByoUnlockSession,
  handleGetCreditSnapshot,
  handleRefreshCreditSnapshot,
  handleCheckoutReturnFromBrowser,
  initializeCreditBalanceState,
  replayPendingCheckoutState,
} from './handlers/credit-handlers.js';
import {
  initEntitlementsManager,
  getCachedEntitlements,
  syncEntitlements,
} from './services/entitlements-manager.js';
import {
  initAiProvider,
  validateApiKey,
  validateAnthropicApiKey,
} from './services/ai-provider.js';
import { getErrorReportContext } from './services/error-report.js';
import {
  deleteStoredSubtitleEntry,
  detachStoredSubtitleSource,
  findStoredSubtitleForVideo,
  rememberStoredSubtitleVideoPath,
  saveStoredSubtitleArtifact,
  syncStoredSubtitleVideoPath,
} from './services/subtitle-library.js';
import {
  findStoredTranscriptAnalysis,
  saveStoredTranscriptAnalysis,
} from './services/transcript-analysis-library.js';
import type {
  VideoSuggestionModelPreference,
  VideoSuggestionRecency,
} from '@shared-types/app';
import { testElevenLabsApiKey } from './services/elevenlabs-client.js';
import {
  getMainWindow,
  broadcastToApp,
  getActiveAppWebContents,
} from './utils/window.js';
import * as tabManager from './tab-manager.js';
import { suggestVideosViaChat } from './services/video-suggestions.js';
import { getPendingStage5UpdateRequiredNotice } from './services/stage5-version-gate.js';
import { hasConfiguredAdminSecret } from './services/admin-auth.js';
import {
  flushPendingCriticalFailures,
  flushPendingProductEvents,
  trackAppOpen,
  trackFirstMeaningfulUse,
  trackTranslationFunnelEvent,
  trackUrlDownloadFunnelEvent,
} from './services/product-analytics.js';
import {
  classifyTranslationOutcome,
  isTranslationMeaningfulUse,
} from './services/translation-funnel.js';
import {
  classifyUrlSourceType,
  type UrlConnectionContext,
} from './services/url-download-funnel.js';
import {
  markStartupSuccessful,
  recordCriticalFailure,
  setStartupPhase,
  type ProcessFailureReason,
} from './services/startup-health.js';
import { createWindowCreationCoordinator } from './window-creation-coordinator.js';
import { AgentSocketServer } from './services/agent-socket-server.js';
import {
  registerAllAgentBridgeHandlers,
  cleanupAgentBridgeHandlers,
} from './handlers/agent-bridge-handlers.js';
import {
  startHungWindowMonitoring,
  stopHungWindowMonitoring,
  recordHeartbeat,
} from './services/hung-window-detector.js';

log.info('--- [main.ts] Execution Started ---');

const CHECKOUT_RETURN_PROTOCOL = 'stage5-translator';
let filePathToOpenOnLoad: string | null = null;
// The tab the queued file was meant for; null means "first tab to finish
// loading" (app startup). Prevents a background tab that happens to finish
// loading first from claiming a file intended for the active tab.
let filePathTargetWebContentsId: number | null = null;
let checkoutReturnUrlToOpenOnLoad: string | null = null;
log.info(`[Main Process] Settings store path: ${settingsStore.path}`);

initEntitlementsManager(settingsStore);
initAiProvider(settingsStore);

// Initialize agent socket server for packaged-app MCP (will be started after main window created)
let agentSocketServer: AgentSocketServer | null = null;
async function updateAgentSocketServer() {
  const agentEnabled = settingsStore.get('agentControlEnabled', false);
  const isPackagedBuild = app.isPackaged;
  
  if (isPackagedBuild && agentEnabled && agentSocketServer && !agentSocketServer.isRunning()) {
    try {
      await agentSocketServer.start();
      log.info('[main] Agent socket server started');
    } catch (err) {
      log.error('[main] Failed to start agent socket server:', err);
    }
  } else if ((!agentEnabled || !isPackagedBuild) && agentSocketServer && agentSocketServer.isRunning()) {
    try {
      await agentSocketServer.stop();
      log.info('[main] Agent socket server stopped');
    } catch (err) {
      log.error('[main] Failed to stop agent socket server:', err);
    }
  }
}

function registerCheckoutReturnProtocol(): void {
  try {
    const isDefaultApp = Boolean((nodeProcess as any).defaultApp);
    if (isDefaultApp && nodeProcess.argv.length >= 2) {
      app.setAsDefaultProtocolClient(
        CHECKOUT_RETURN_PROTOCOL,
        nodeProcess.execPath,
        [path.resolve(nodeProcess.argv[1])]
      );
      return;
    }

    app.setAsDefaultProtocolClient(CHECKOUT_RETURN_PROTOCOL);
  } catch (error) {
    log.warn('[main.ts] Failed to register checkout return protocol:', error);
  }
}

function findCheckoutReturnUrl(args: string[]): string | null {
  for (const arg of args) {
    const normalized = String(arg || '')
      .trim()
      .replace(/^"|"$/g, '');
    if (normalized.toLowerCase().startsWith(`${CHECKOUT_RETURN_PROTOCOL}://`)) {
      return normalized;
    }
  }

  return null;
}

function parseCheckoutReturnUrl(rawUrl: string): {
  status: 'success' | 'cancelled';
  sessionId: string | null;
  returnId: string | null;
  mode: 'credits' | 'byo';
} | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== `${CHECKOUT_RETURN_PROTOCOL}:`) {
      return null;
    }

    const path = `${url.hostname}${url.pathname}`.replace(/^\/+/, '');
    const status = path.endsWith('checkout/cancelled')
      ? 'cancelled'
      : path.endsWith('checkout/success')
        ? 'success'
        : null;
    if (!status) {
      return null;
    }

    return {
      status,
      sessionId:
        url.searchParams.get('session_id') ?? url.searchParams.get('sessionId'),
      returnId:
        url.searchParams.get('return_id') ?? url.searchParams.get('returnId'),
      mode: url.searchParams.get('mode') === 'byo' ? 'byo' : 'credits',
    };
  } catch {
    return null;
  }
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    ensureMainWindow()
      .then(window => {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      })
      .catch(err =>
        log.error('[main.ts] Error creating window for checkout return:', err)
      );
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function handleCheckoutReturnUrl(rawUrl: string): boolean {
  const checkoutReturn = parseCheckoutReturnUrl(rawUrl);
  if (!checkoutReturn) {
    return false;
  }

  log.info(
    `[main.ts] Checkout return URL received: status=${checkoutReturn.status}, mode=${checkoutReturn.mode}, session=${checkoutReturn.sessionId ?? 'n/a'}, return=${checkoutReturn.returnId ?? 'n/a'}`
  );

  if (!app.isReady()) {
    checkoutReturnUrlToOpenOnLoad = rawUrl;
    return true;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    checkoutReturnUrlToOpenOnLoad = rawUrl;
    ensureMainWindow().catch(err =>
      log.error('[main.ts] Error creating window for checkout return:', err)
    );
    return true;
  }

  focusMainWindow();
  if (mainWindow.webContents.isLoading()) {
    checkoutReturnUrlToOpenOnLoad = rawUrl;
    return true;
  }

  handleCheckoutReturnFromBrowser(checkoutReturn);
  return true;
}

registerCheckoutReturnProtocol();

if (!app.requestSingleInstanceLock()) {
  log.info('[main.ts] Another instance detected. Quitting this instance.');
  // This is an expected early exit, not an interrupted startup.
  markStartupSuccessful();
  app.quit();
  nodeProcess.exit(0);
}

const checkoutReturnUrlFromPrimaryInstance = findCheckoutReturnUrl(
  nodeProcess.argv
);
if (checkoutReturnUrlFromPrimaryInstance) {
  checkoutReturnUrlToOpenOnLoad = checkoutReturnUrlFromPrimaryInstance;
}

const fileArgFromPrimaryInstance = nodeProcess.argv
  .slice(1)
  .find(
    p =>
      /\.\w+$/.test(p) &&
      !p.startsWith('--') &&
      fs.existsSync(p.replace(/^"|"$/g, ''))
  );
if (fileArgFromPrimaryInstance) {
  log.info(
    `[main.ts] Application launched with file argument (primary instance): ${fileArgFromPrimaryInstance}`
  );
  filePathToOpenOnLoad = fileArgFromPrimaryInstance.replace(/^"|"$/g, '');
}

app.on('second-instance', (_event, commandLine, _workingDirectory) => {
  log.info("[main.ts] 'second-instance' event triggered.");
  log.info(`[main.ts] Command line: ${commandLine.join(' ')}`);

  const checkoutReturnUrl = findCheckoutReturnUrl(commandLine);
  if (checkoutReturnUrl && handleCheckoutReturnUrl(checkoutReturnUrl)) {
    return;
  }

  const fileArg = commandLine
    .slice(1)
    .find(
      arg =>
        /\.\w+$/.test(arg) &&
        !arg.startsWith('--') &&
        fs.existsSync(arg.replace(/^"|"$/g, ''))
    );

  if (fileArg) {
    log.info(
      `[main.ts] File path found in second-instance commandLine: ${fileArg}`
    );
    openVideoFile(fileArg.replace(/^"|"$/g, ''));
  } else {
    log.info(
      '[main.ts] No specific file path found or file does not exist in second-instance commandLine. Focusing window.'
    );
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (fileArg) {
    ensureMainWindow().catch(err =>
      log.error(
        '[main.ts] Error creating window on second-instance for file:',
        err
      )
    );
  } else {
    ensureMainWindow().catch(err =>
      log.error('[main.ts] Error creating window on second-instance:', err)
    );
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleCheckoutReturnUrl(url);
});

let mainWindow: BrowserWindow | null = null;
let releaseWindowCreationGate: (() => void) | null = null;
const windowCreationGate = new Promise<void>(resolve => {
  releaseWindowCreationGate = resolve;
});
const mainWindowCoordinator = createWindowCreationCoordinator<BrowserWindow>({
  getCurrent: () => mainWindow,
  setCurrent: window => {
    mainWindow = window;
  },
  isDestroyed: window => window.isDestroyed(),
  create: createWindow,
});

function allowMainWindowCreation(): void {
  if (!releaseWindowCreationGate) return;
  const release = releaseWindowCreationGate;
  releaseWindowCreationGate = null;
  release();
}

async function ensureMainWindow(): Promise<BrowserWindow> {
  // macOS can emit `activate` as soon as Electron is ready, while our startup
  // cleanup is still running. Queue every creation request behind that cleanup
  // and then coalesce competing requests through one shared promise.
  await windowCreationGate;
  return mainWindowCoordinator.ensure();
}

let services: {
  saveFileService: SaveFileService;
  fileManager: FileManager;
  ffmpeg: FFmpegContext;
} | null = null;
let isQuitting = false;
let quitCleanupPromise: Promise<void> | null = null;
let quitAfterCleanupScheduled = false;

const isDev = !app.isPackaged;

function getRendererHtmlPath() {
  return app.isPackaged
    ? path.join(app.getAppPath(), 'packages', 'renderer', 'dist', 'index.html')
    : path.join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'packages',
        'renderer',
        'dist',
        'index.html'
      );
}

function getPreloadPath() {
  return app.isPackaged
    ? path.join(
        app.getAppPath(),
        'packages',
        'main',
        'dist',
        'preload',
        'preload.cjs'
      )
    : path.join(__dirname, '../preload/preload.cjs');
}

function getShellAssetPath(fileName: string) {
  return app.isPackaged
    ? path.join(app.getAppPath(), 'packages', 'main', 'dist', 'shell', fileName)
    : path.join(__dirname, '../shell', fileName);
}

try {
  setStartupPhase('services_initialization');
  log.info('[main.ts] Initializing Services...');

  const tempPath = getUrlDownloadScratchDir(
    app.getPath('temp'),
    app.isPackaged
  );
  const downloadLibraryDir = getUrlDownloadLibraryDir(app.getPath('userData'));
  log.info(`[main.ts] Determined temp path for services: ${tempPath}`);
  log.info(`[main.ts] Persistent URL download library: ${downloadLibraryDir}`);

  const saveFileService = SaveFileService.getInstance();
  const fileManager = new FileManager(tempPath);
  const ffmpeg = await createFFmpegContext(tempPath);
  services = { saveFileService, fileManager, ffmpeg };
  log.info('[main.ts] Services Initialized.');

  log.info('[main.ts] Initializing Handlers...');
  fileHandlers.initializeFileHandlers({ fileManager, saveFileService });
  subtitleHandlers.initializeSubtitleHandlers({ ffmpeg, fileManager });
  initializeUrlHandler({ fileManager, ffmpeg, downloadLibraryDir });
  renderWindowHandlers.initializeRenderWindowHandlers({ ffmpeg });
  log.info('[main.ts] Handlers Initialized.');

  log.info('[main.ts] Registering IPC Handlers...');

  // ──────────────────────────────────────────────────────────────
  // Settings IPC handlers
  // ──────────────────────────────────────────────────────────────
  const settingsHandlers = buildSettingsHandlers({
    store: settingsStore,
    isDev,
  });

  ipcMain.handle('get-locale-url', settingsHandlers.getLocaleUrl);
  ipcMain.handle(
    'get-language-preference',
    settingsHandlers.getLanguagePreference
  );
  ipcMain.handle(
    'set-language-preference',
    settingsHandlers.setLanguagePreference
  );
  ipcMain.handle(
    'get-subtitle-target-language',
    settingsHandlers.getSubtitleTargetLanguage
  );
  ipcMain.handle(
    'set-subtitle-target-language',
    settingsHandlers.setSubtitleTargetLanguage
  );
  ipcMain.handle(
    'save-video-playback-position',
    settingsHandlers.saveVideoPlaybackPosition
  );
  ipcMain.handle(
    'get-video-playback-position',
    settingsHandlers.getVideoPlaybackPosition
  );

  ipcMain.handle('has-video-track', async (_evt, filePath: string) => {
    try {
      return await services!.ffmpeg.hasVideoTrack(filePath);
    } catch (err: any) {
      log.error('[main] has-video-track error:', err);
      return { success: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('ping', utilityHandlers.handlePing);
  ipcMain.handle('heartbeat-pong', () => {
    recordHeartbeat();
    return { success: true };
  });
  ipcMain.handle('show-message', utilityHandlers.handleShowMessage);
  ipcMain.handle('save-file', fileHandlers.handleSaveFile);
  ipcMain.handle(
    'save-subtitle-document-record',
    subtitleDocumentHandlers.handleSaveSubtitleDocumentRecord
  );
  ipcMain.handle(
    'read-subtitle-document',
    subtitleDocumentHandlers.handleReadSubtitleDocument
  );
  ipcMain.handle(
    'find-subtitle-document-for-file',
    subtitleDocumentHandlers.handleFindSubtitleDocumentForFile
  );
  ipcMain.handle(
    'find-subtitle-document-for-source',
    subtitleDocumentHandlers.handleFindSubtitleDocumentForSource
  );
  ipcMain.handle(
    'detach-subtitle-document-source',
    subtitleDocumentHandlers.handleDetachSubtitleDocumentSource
  );
  ipcMain.handle(
    'save-subtitle-document',
    fileHandlers.handleSaveSubtitleDocument
  );
  ipcMain.handle('open-file', async (event, options) => {
    const result = await fileHandlers.handleOpenFile(event, options);
    if (!result.canceled && result.filePaths.length > 0 && !result.error) {
      void trackFirstMeaningfulUse('video_open');
    }
    return result;
  });
  ipcMain.handle(
    'read-saved-subtitle-metadata',
    fileHandlers.handleReadSavedSubtitleMetadata
  );
  ipcMain.handle('move-file', fileHandlers.handleMoveFile);
  ipcMain.handle('copy-file', fileHandlers.handleCopyFile);
  ipcMain.handle('delete-file', fileHandlers.handleDeleteFile);
  ipcMain.handle('readFileContent', fileHandlers.handleReadFileContent);
  ipcMain.handle('getFileSize', fileHandlers.handleGetFileSize);
  ipcMain.handle('getFileIdentity', fileHandlers.handleGetFileIdentity);
  ipcMain.handle('getDiskSpace', fileHandlers.handleGetDiskSpace);
  ipcMain.handle('getTempDiskSpace', fileHandlers.handleGetTempDiskSpace);
  ipcMain.handle('save-stored-subtitle-artifact', async (_event, options) => {
    try {
      const entry = await saveStoredSubtitleArtifact(options || {});
      return { success: true, entry };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
  ipcMain.handle('find-stored-subtitle-for-video', async (_event, options) => {
    try {
      const result = await findStoredSubtitleForVideo(options || {});
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
  ipcMain.handle('save-stored-transcript-analysis', async (_event, options) => {
    try {
      const entry = await saveStoredTranscriptAnalysis(options || {});
      return { success: true, entry };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
  ipcMain.handle('find-stored-transcript-analysis', async (_event, options) => {
    try {
      const result = await findStoredTranscriptAnalysis(options || {});
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
  ipcMain.handle(
    'sync-stored-subtitle-video-path',
    async (_event, previousPath: string, savedPath: string) => {
      try {
        const updated = await syncStoredSubtitleVideoPath({
          previousPath,
          savedPath,
        });
        return { success: true, updated };
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    }
  );
  ipcMain.handle(
    'remember-stored-subtitle-video-path',
    async (_event, entryId: string, sourceVideoPath: string) => {
      try {
        const updated = await rememberStoredSubtitleVideoPath({
          entryId,
          sourceVideoPath,
        });
        return { success: true, updated };
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    }
  );
  ipcMain.handle('detach-stored-subtitle-source', async (_event, options) => {
    try {
      const updated = await detachStoredSubtitleSource(options || {});
      return { success: true, updated };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
  ipcMain.handle(
    'delete-stored-subtitle-entry',
    async (_event, entryId: string) => {
      try {
        const removed = await deleteStoredSubtitleEntry(entryId);
        return { success: true, removed };
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    }
  );

  ipcMain.handle('generate-subtitles', async (event, options) => {
    const operationId =
      options.operationId ||
      `generate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    log.info(`[main.ts/generate-subtitles] Starting operation: ${operationId}`);

    try {
      const result = await subtitleHandlers.handleGenerateSubtitles(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/generate-subtitles] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/generate-subtitles] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/generate-subtitles] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('translate-subtitles', async (event, options) => {
    const operationId =
      options.operationId ||
      `translate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(
      `[main.ts/translate-subtitles] Starting operation: ${operationId}`
    );
    void trackTranslationFunnelEvent('translation_started');
    try {
      const result = await subtitleHandlers.handleTranslateSubtitles(
        event,
        options,
        operationId
      );
      const translationOutcome = classifyTranslationOutcome(result);
      void trackTranslationFunnelEvent(translationOutcome);
      if (isTranslationMeaningfulUse(translationOutcome)) {
        void trackFirstMeaningfulUse('translation');
      }
      log.info(
        `[main.ts/translate-subtitles] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/translate-subtitles] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/translate-subtitles] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('dub-subtitles', async (event, options) => {
    const operationId =
      options.operationId ||
      `dub-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(`[main.ts/dub-subtitles] Starting operation: ${operationId}`);
    try {
      const result = await subtitleHandlers.handleDubSubtitles(
        event,
        options,
        operationId
      );
      log.info(`[main.ts/dub-subtitles] Operation ${operationId} completed.`);
      return result;
    } catch (error) {
      log.error(
        `[main.ts/dub-subtitles] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/dub-subtitles] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('preview-dub-voice', async (_event, options) => {
    return subtitleHandlers.previewDubVoice(options ?? {});
  });

  ipcMain.handle('generate-transcript-summary', async (event, options) => {
    const operationId =
      options.operationId ||
      `summary-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(
      `[main.ts/generate-transcript-summary] Starting operation: ${operationId}`
    );

    try {
      const result = await subtitleHandlers.handleGenerateTranscriptSummary(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/generate-transcript-summary] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/generate-transcript-summary] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/generate-transcript-summary] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('cut-highlight-clip', async (event, options) => {
    const operationId =
      options.operationId ||
      `highlight-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(`[main.ts/cut-highlight-clip] Starting operation: ${operationId}`);

    try {
      const result = await subtitleHandlers.handleCutHighlightClip(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/cut-highlight-clip] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/cut-highlight-clip] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/cut-highlight-clip] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('cut-combined-highlights', async (event, options) => {
    const operationId =
      options.operationId ||
      `combined-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(
      `[main.ts/cut-combined-highlights] Starting operation: ${operationId}`
    );

    try {
      const result = await subtitleHandlers.handleCutCombinedHighlights(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/cut-combined-highlights] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/cut-combined-highlights] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/cut-combined-highlights] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('translate-one-line', async (event, options) => {
    const operationId =
      options.operationId ||
      `translate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(`[main.ts/translate-one-line] Starting operation: ${operationId}`);
    try {
      const result = await subtitleHandlers.handleTranslateOneLine(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/translate-one-line] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/translate-one-line] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/translate-one-line] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('transcribe-one-line', async (event, options) => {
    const operationId =
      options.operationId ||
      `transcribe-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(
      `[main.ts/transcribe-one-line] Starting operation: ${operationId}`
    );
    try {
      const result = await subtitleHandlers.handleTranscribeOneLine(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/transcribe-one-line] Operation ${operationId} completed.`
      );
      return result;
    } catch (error) {
      log.error(
        `[main.ts/transcribe-one-line] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/transcribe-one-line] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('transcribe-remaining', async (event, options) => {
    const operationId =
      options.operationId ||
      `transcribe-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    log.info(
      `[main.ts/transcribe-remaining] Starting operation: ${operationId}`
    );
    try {
      const res = await subtitleHandlers.handleTranscribeRemaining(
        event,
        options,
        operationId
      );
      log.info(
        `[main.ts/transcribe-remaining] Operation ${operationId} completed.`
      );
      return res;
    } catch (error) {
      log.error(
        `[main.ts/transcribe-remaining] Error in operation ${operationId}:`,
        error
      );
      throw error;
    } finally {
      registry.finish(operationId);
      log.info(
        `[main.ts/transcribe-remaining] Removed controller for ${operationId}.`
      );
    }
  });

  ipcMain.handle('process-url', handleProcessUrl);
  ipcMain.handle('process-url:accept', async (event, operationId) => {
    const result = await handleAcceptProcessedUrl(event, operationId);
    if (result.success) {
      void trackFirstMeaningfulUse('video_download');
    }
    return result;
  });
  ipcMain.handle('process-url:discard', handleDiscardProcessedUrl);
  ipcMain.handle(
    'process-url:cleanup-accepted',
    handleCleanupAcceptedProcessedUrl
  );
  ipcMain.handle(
    'video-suggestion-download-history:mutate',
    handleMutateVideoSuggestionDownloadHistory
  );
  ipcMain.handle(
    'process-url:set-mounted-library-paths',
    handleSetMountedUrlDownloadLibraryPaths
  );
  ipcMain.handle('suggest-videos', async (event, request) => {
    const operationId =
      request?.operationId ||
      `video-suggest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const controller = new AbortController();

    registry.registerAutoCancel(operationId, event.sender, () => {
      controller.abort();
    });

    try {
      return await suggestVideosViaChat(
        {
          ...(request || {}),
          operationId,
        },
        {
          signal: controller.signal,
          onProgress: progress => {
            try {
              event.sender.send('video-suggestion-progress', progress);
            } catch {
              // Renderer may be unavailable; ignore progress emit failures.
            }
          },
        }
      );
    } finally {
      registry.finish(operationId);
    }
  });

  ipcMain.handle('cancel-operation', async (_event, operationId: string) => {
    log.info(`[main.ts/cancel-operation] Received request for: ${operationId}`);
    try {
      const success = await registry.cancel(operationId);
      return {
        success,
        message: success
          ? `Cancellation requested for ${operationId}`
          : `Cancellation failed for ${operationId}`,
      };
    } catch (error) {
      log.error(
        `[main.ts/cancel-operation] Error cancelling operation ${operationId}:`,
        error
      );
      throw new Error(
        `Failed to cancel operation ${operationId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  });

  ipcMain.handle('get-app-path', () => {
    return app.getAppPath();
  });

  // App-managed cookies session (cross-platform, avoids Windows DPAPI / locked DB issues)
  ipcMain.handle(
    'cookies:connect',
    async (_evt, url: string, requestedContext?: UrlConnectionContext) => {
      const sourceType = classifyUrlSourceType(url);
      const connectionContext: UrlConnectionContext =
        requestedContext === 'download_recovery'
          ? 'download_recovery'
          : 'settings';
      void trackUrlDownloadFunnelEvent('url_cookie_connect_started', {
        sourceType,
        connectionContext,
      });
      try {
        const result = await connectCookiesInteractive(url);
        const event = result.success
          ? 'url_cookie_connect_completed'
          : result.cancelled
            ? 'url_cookie_connect_cancelled'
            : 'url_cookie_connect_failed';
        void trackUrlDownloadFunnelEvent(event, {
          sourceType,
          connectionContext,
        });
        return result;
      } catch (error) {
        void trackUrlDownloadFunnelEvent('url_cookie_connect_failed', {
          sourceType,
          connectionContext,
        });
        throw error;
      }
    }
  );
  ipcMain.handle('cookies:clear', (_evt, url: string) =>
    clearCookiesForUrl(url)
  );
  ipcMain.handle('cookies:status', (_evt, url: string) =>
    getCookieStatusForUrl(url)
  );

  ipcMain.handle('get-video-metadata', subtitleHandlers.handleGetVideoMetadata);

  ipcMain.handle('create-checkout-session', handleCreateCheckoutSession);
  ipcMain.handle('create-byo-unlock-session', () =>
    handleCreateByoUnlockSession()
  );
  ipcMain.handle('get-credit-snapshot', handleGetCreditSnapshot);
  ipcMain.handle('refresh-credit-snapshot', (_event, force?: boolean) =>
    handleRefreshCreditSnapshot(force === true)
  );
  
  // Purchase funnel tracking from renderer
  // Only allow renderer to emit: button_shown, button_clicked, and *_failed
  // (session_created, opened, completed, cancelled must come from main process only)
  ipcMain.handle(
    'track-purchase-event',
    async (
      _event,
      eventName: PurchaseFunnelEvent,
      context?: {
        packId?: CreditPackId;
        placement?: PurchasePlacement;
        failureReason?: PurchaseFailureReason;
      }
    ) => {
      try {
        // Validate that renderer can only emit specific events
        const allowedRendererEvents = [
          'credit_checkout_button_shown',
          'credit_checkout_button_clicked',
          'credit_checkout_failed',
          'byo_unlock_button_shown',
          'byo_unlock_button_clicked',
          'byo_unlock_failed',
        ];
        
        if (!allowedRendererEvents.includes(eventName)) {
          log.warn(
            `[main] Renderer attempted to emit restricted purchase event: ${eventName}`
          );
          return {
            success: false,
            error: `Event ${eventName} can only be emitted from main process`,
          };
        }
        
        await trackPurchaseFunnelEvent(eventName, context || {});
        return { success: true };
      } catch (error: any) {
        log.error('[main] track-purchase-event error:', error);
        return {
          success: false,
          error: error?.message || String(error),
        };
      }
    }
  );
  ipcMain.handle('reset-credits', handleResetCredits);
  ipcMain.handle('reset-credits-to-zero', handleResetCreditsToZero);
  ipcMain.handle('is-admin-mode', () => hasConfiguredAdminSecret());
  ipcMain.handle('get-system-info', () => {
    try {
      const platform = process.platform;
      const arch = process.arch;
      const release = os.release();
      const cpu = os.cpus()?.[0]?.model ?? '';
      const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
      return { platform, arch, release, cpu, isAppleSilicon };
    } catch {
      return {
        platform: process.platform,
        arch: process.arch,
      } as any;
    }
  });
  ipcMain.handle('get-error-report-context', () => getErrorReportContext());

  // yt-dlp auto update is always on; no IPC settings

  ipcMain.handle('get-entitlements', () => getCachedEntitlements());
  ipcMain.handle('refresh-entitlements', async () => {
    const mainWin = getMainWindow();
    return syncEntitlements({ window: mainWin ?? undefined });
  });

  // Check if encryption is available for secure key storage
  ipcMain.handle('check-encryption-available', () =>
    settingsHandlers.checkEncryptionAvailable()
  );

  // Batched BYO settings - single call to load all settings at once
  ipcMain.handle('get-all-byo-settings', () =>
    settingsHandlers.getAllByoSettings()
  );

  ipcMain.handle('get-openai-api-key', () => settingsHandlers.getApiKey());
  ipcMain.handle('set-openai-api-key', async (event, apiKey: string) => {
    const result = await settingsHandlers.setApiKey(event, apiKey);
    broadcastToApp('openai-api-key-changed', {
      hasKey: result.success && Boolean(apiKey?.trim?.()),
    });
    return result;
  });
  ipcMain.handle('clear-openai-api-key', async () => {
    const result = await settingsHandlers.clearApiKey();
    broadcastToApp('openai-api-key-changed', { hasKey: false });
    return result;
  });
  ipcMain.handle('validate-openai-api-key', async (_event, apiKey?: string) => {
    const provided = typeof apiKey === 'string' ? apiKey.trim() : '';
    const keyToCheck = provided || settingsHandlers.getApiKey();
    if (!keyToCheck) {
      return { ok: false, error: 'Missing API key' };
    }
    return validateApiKey(keyToCheck);
  });
  ipcMain.handle('get-byo-provider-enabled', () =>
    settingsHandlers.getUseByoOpenAi()
  );
  ipcMain.handle('set-byo-provider-enabled', (_event, value: boolean) =>
    settingsHandlers.setUseByoOpenAi(Boolean(value))
  );

  // Anthropic API key handlers
  ipcMain.handle('get-anthropic-api-key', () =>
    settingsHandlers.getAnthropicApiKey()
  );
  ipcMain.handle('set-anthropic-api-key', async (event, apiKey: string) => {
    const result = await settingsHandlers.setAnthropicApiKey(event, apiKey);
    broadcastToApp('anthropic-api-key-changed', {
      hasKey: result.success && Boolean(apiKey?.trim?.()),
    });
    return result;
  });
  ipcMain.handle('clear-anthropic-api-key', async () => {
    const result = await settingsHandlers.clearAnthropicApiKey();
    broadcastToApp('anthropic-api-key-changed', { hasKey: false });
    return result;
  });
  ipcMain.handle(
    'validate-anthropic-api-key',
    async (_event, apiKey?: string) => {
      const provided = typeof apiKey === 'string' ? apiKey.trim() : '';
      const keyToCheck = provided || settingsHandlers.getAnthropicApiKey();
      if (!keyToCheck) {
        return { ok: false, error: 'Missing API key' };
      }
      return validateAnthropicApiKey(keyToCheck);
    }
  );
  ipcMain.handle('get-byo-anthropic-enabled', () =>
    settingsHandlers.getUseByoAnthropic()
  );
  ipcMain.handle('set-byo-anthropic-enabled', (_event, value: boolean) =>
    settingsHandlers.setUseByoAnthropic(Boolean(value))
  );

  // ElevenLabs API key handlers
  ipcMain.handle('get-elevenlabs-api-key', () =>
    settingsHandlers.getElevenLabsApiKey()
  );
  ipcMain.handle('set-elevenlabs-api-key', async (event, apiKey: string) => {
    const result = await settingsHandlers.setElevenLabsApiKey(event, apiKey);
    broadcastToApp('elevenlabs-api-key-changed', {
      hasKey: result.success && Boolean(apiKey?.trim?.()),
    });
    return result;
  });
  ipcMain.handle('clear-elevenlabs-api-key', async () => {
    const result = await settingsHandlers.clearElevenLabsApiKey();
    broadcastToApp('elevenlabs-api-key-changed', { hasKey: false });
    return result;
  });
  ipcMain.handle(
    'validate-elevenlabs-api-key',
    async (_event, apiKey?: string) => {
      const provided = typeof apiKey === 'string' ? apiKey.trim() : '';
      const keyToCheck = provided || settingsHandlers.getElevenLabsApiKey();
      if (!keyToCheck) {
        return { ok: false, error: 'Missing API key' };
      }
      try {
        await testElevenLabsApiKey(keyToCheck);
        return { ok: true };
      } catch (err: any) {
        return {
          ok: false,
          error: err?.message || 'API key validation failed',
        };
      }
    }
  );
  ipcMain.handle('get-byo-elevenlabs-enabled', () =>
    settingsHandlers.getUseByoElevenLabs()
  );
  ipcMain.handle('set-byo-elevenlabs-enabled', (_event, value: boolean) =>
    settingsHandlers.setUseByoElevenLabs(Boolean(value))
  );

  // API key mode handlers
  ipcMain.handle('get-api-key-mode-enabled', () =>
    settingsHandlers.getApiKeyModeEnabled()
  );
  ipcMain.handle('set-api-key-mode-enabled', (_event, value: boolean) =>
    settingsHandlers.setApiKeyModeEnabled(Boolean(value))
  );

  // Agent control handlers
  ipcMain.handle('get-agent-control-enabled', () =>
    settingsHandlers.getAgentControlEnabled()
  );
  ipcMain.handle('set-agent-control-enabled', async (_event, value: boolean) => {
    const result = settingsHandlers.setAgentControlEnabled(Boolean(value));
    if (result.success) {
      // Broadcast to all windows that agent control state changed
      broadcastToApp('agent-control-changed', { enabled: Boolean(value) });
      // Update socket server state
      await updateAgentSocketServer();
    }
    return result;
  });
  ipcMain.handle('get-agent-allowed-directories', () =>
    settingsHandlers.getAgentAllowedDirectories()
  );
  ipcMain.handle('set-agent-allowed-directories', (_event, dirs: string[]) =>
    settingsHandlers.setAgentAllowedDirectories(dirs)
  );
  ipcMain.handle('add-agent-allowed-directory', (_event, dir: string) =>
    settingsHandlers.addAgentAllowedDirectory(dir)
  );
  ipcMain.handle('remove-agent-allowed-directory', (_event, dir: string) =>
    settingsHandlers.removeAgentAllowedDirectory(dir)
  );
  ipcMain.handle('get-agent-socket-status', () => {
    if (!agentSocketServer) {
      return { running: false, connectedClients: 0 };
    }
    return {
      running: agentSocketServer.isRunning(),
      connectedClients: agentSocketServer.getConnectedClientCount(),
    };
  });

  ipcMain.handle('check-agent-path-allowed', async (_event, filePath: string) => {
    if (!app.isPackaged) {
      return true; // In dev mode, all paths allowed
    }
    
    const agentEnabled = settingsStore.get('agentControlEnabled', false);
    if (!agentEnabled) {
      return false;
    }
    
    const allowedDirs = settingsStore.get('agentAllowedDirectories', []);
    // Fall back to default if empty
    const dirs = Array.isArray(allowedDirs) && allowedDirs.length > 0
      ? allowedDirs
      : [
          app.getPath('downloads'),
          path.join(app.getPath('userData'), 'url-downloads'),
        ];
    
    // Use realpath to prevent symlink escapes
    let realPath: string;
    try {
      realPath = fs.realpathSync(path.resolve(filePath));
    } catch (err) {
      // Path doesn't exist yet - use resolved path for new files
      realPath = path.resolve(filePath);
    }
    
    return dirs.some(dir => {
      let realDir: string;
      try {
        realDir = fs.realpathSync(path.resolve(String(dir)));
      } catch (err) {
        realDir = path.resolve(String(dir));
      }
      return realPath.startsWith(realDir + path.sep) || 
             realPath === realDir;
    });
  });
  ipcMain.handle('show-open-dialog', async (_event, options) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return { canceled: true, filePaths: [] };
    }
    return await dialog.showOpenDialog(mainWindow, options);
  });

  // Claude translation preference handlers
  ipcMain.handle('get-prefer-claude-translation', () =>
    settingsHandlers.getPreferClaudeTranslation()
  );
  ipcMain.handle('set-prefer-claude-translation', (_event, value: boolean) =>
    settingsHandlers.setPreferClaudeTranslation(Boolean(value))
  );

  // Claude review preference handlers
  ipcMain.handle('get-prefer-claude-review', () =>
    settingsHandlers.getPreferClaudeReview()
  );
  ipcMain.handle('set-prefer-claude-review', (_event, value: boolean) =>
    settingsHandlers.setPreferClaudeReview(Boolean(value))
  );

  // Claude summary preference handlers
  ipcMain.handle('get-prefer-claude-summary', () =>
    settingsHandlers.getPreferClaudeSummary()
  );
  ipcMain.handle('set-prefer-claude-summary', (_event, value: boolean) =>
    settingsHandlers.setPreferClaudeSummary(Boolean(value))
  );
  ipcMain.handle('get-stage5-video-suggestion-mode', () =>
    settingsHandlers.getStage5VideoSuggestionMode()
  );
  ipcMain.handle(
    'set-stage5-video-suggestion-mode',
    (_event, value: 'standard' | 'high') =>
      settingsHandlers.setStage5VideoSuggestionMode(value)
  );
  ipcMain.handle('get-byo-video-suggestion-model', () =>
    settingsHandlers.getByoVideoSuggestionModel()
  );
  ipcMain.handle('set-byo-video-suggestion-model', (_event, value: string) =>
    settingsHandlers.setByoVideoSuggestionModel(value)
  );
  ipcMain.handle('get-video-suggestion-model-preference', () =>
    settingsHandlers.getVideoSuggestionModelPreference()
  );
  ipcMain.handle(
    'set-video-suggestion-model-preference',
    (_event, value: VideoSuggestionModelPreference) =>
      settingsHandlers.setVideoSuggestionModelPreference(value)
  );
  ipcMain.handle('get-video-suggestion-target-country', () =>
    settingsHandlers.getVideoSuggestionTargetCountry()
  );
  ipcMain.handle(
    'set-video-suggestion-target-country',
    (_event, value: string) =>
      settingsHandlers.setVideoSuggestionTargetCountry(value)
  );
  ipcMain.handle('get-video-suggestion-recency', () =>
    settingsHandlers.getVideoSuggestionRecency()
  );
  ipcMain.handle(
    'set-video-suggestion-recency',
    (_event, value: VideoSuggestionRecency) =>
      settingsHandlers.setVideoSuggestionRecency(value)
  );
  ipcMain.handle('get-video-suggestion-preference-topic', () =>
    settingsHandlers.getVideoSuggestionPreferenceTopic()
  );
  ipcMain.handle(
    'set-video-suggestion-preference-topic',
    (_event, value: string) =>
      settingsHandlers.setVideoSuggestionPreferenceTopic(value)
  );

  // Transcription provider preference handlers
  ipcMain.handle('get-preferred-transcription-provider', () =>
    settingsHandlers.getPreferredTranscriptionProvider()
  );
  ipcMain.handle(
    'set-preferred-transcription-provider',
    (_event, value: 'elevenlabs' | 'openai' | 'stage5') =>
      settingsHandlers.setPreferredTranscriptionProvider(value)
  );

  // Dubbing provider preference handlers
  ipcMain.handle('get-preferred-dubbing-provider', () =>
    settingsHandlers.getPreferredDubbingProvider()
  );
  ipcMain.handle(
    'set-preferred-dubbing-provider',
    (_event, value: 'elevenlabs' | 'openai' | 'stage5') =>
      settingsHandlers.setPreferredDubbingProvider(value)
  );

  // Stage5 dubbing TTS provider handlers
  ipcMain.handle('get-stage5-dubbing-tts-provider', () =>
    settingsHandlers.getStage5DubbingTtsProvider()
  );
  ipcMain.handle(
    'set-stage5-dubbing-tts-provider',
    (_event, value: 'openai' | 'elevenlabs') =>
      settingsHandlers.setStage5DubbingTtsProvider(value)
  );

  ipcMain.on('stripe-cancelled', (_event, data) => {
    log.info('[main.ts] Received stripe-cancelled message:', data);
    
    // Track cancellation event (guard already handled by the caller)
    if (data?.mode === 'byo') {
      void trackPurchaseFunnelEvent('byo_unlock_cancelled');
      broadcastToApp('byo-unlock-cancelled');
      return;
    }

    void trackPurchaseFunnelEvent('credit_checkout_cancelled', {
      packId: data?.packId,
    });
    broadcastToApp('checkout-cancelled');
  });

  // Expose app.isPackaged to renderer via preload (sync)
  ipcMain.on('is-packaged', event => {
    event.returnValue = app.isPackaged;
  });
  ipcMain.handle('update:get-required-notice', () =>
    getPendingStage5UpdateRequiredNotice()
  );
} catch (error) {
  recordCriticalFailure(
    'startup_initialization_failed',
    'services_initialization'
  );
  log.error('[main.ts] FATAL: Error during initial setup:', error);
  app
    .whenReady()
    .then(() => {
      dialog.showErrorBox(
        'Initialization Error',
        `Failed to initialize. Check logs. Error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      setTimeout(() => {
        app.quit();
        nodeProcess.exit(1);
      }, 5000);
    })
    .catch(readyErr => {
      console.error('FATAL: Error during app.whenReady after setup:', readyErr);
      nodeProcess.exit(1);
    });
}

async function prepareToQuit(reason: 'normal' | 'update'): Promise<void> {
  if (isQuitting) {
    await quitCleanupPromise;
    return;
  }

  isQuitting = true;
  quitCleanupPromise = (async () => {
    log.info(`[main.ts] Starting cleanup before ${reason} quit...`);
    try {
      // Stop agent socket server
      if (agentSocketServer && agentSocketServer.isRunning()) {
        log.info('[main.ts] Stopping agent socket server...');
        await agentSocketServer.stop();
        log.info('[main.ts] Agent socket server stopped.');
      }
      
      if (services?.fileManager?.cleanup) {
        log.info('[main.ts] Attempting FileManager cleanup...');
        await services.fileManager.cleanup();
        log.info('[main.ts] FileManager cleanup finished.');
      } else {
        log.warn('[main.ts] FileManager service not available for cleanup.');
      }
    } catch (err) {
      log.error('[main.ts] Error during cleanup:', err);
    } finally {
      log.info(`[main.ts] Cleanup finished for ${reason} quit.`);
    }
  })();

  await quitCleanupPromise;
}

app.on('will-quit', event => {
  log.info(`[main.ts] 'will-quit' event triggered. isQuitting: ${isQuitting}`);
  if (isQuitting) {
    // Update installation calls prepareToQuit() before quitAndInstall(), so
    // Squirrel's quit must pass through without being cancelled here.
    return;
  }

  event.preventDefault();
  if (quitAfterCleanupScheduled) return;
  quitAfterCleanupScheduled = true;

  void prepareToQuit('normal').finally(() => {
    log.info('[main.ts] Quitting app after cleanup.');
    app.quit();
  });
});

app.on('window-all-closed', () => {
  log.info('[main.ts] All windows closed.');
  if (nodeProcess.platform !== 'darwin') {
    log.info('[main.ts] Quitting app (non-macOS).');
    app.quit();
  }
});

app.on('activate', () => {
  const needsWindow = !mainWindow || mainWindow.isDestroyed();
  if (needsWindow || mainWindowCoordinator.isCreating()) {
    log.info(
      `[main.ts] 'activate': Main window unavailable${
        mainWindowCoordinator.isCreating() ? ' (creation already pending)' : ''
      }; ensuring one window.`
    );
  }

  ensureMainWindow()
    .then(window => {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      if (filePathToOpenOnLoad) {
        log.info(
          `[main.ts] 'activate' with pending file: ${filePathToOpenOnLoad}. Ensuring it's processed.`
        );
        openVideoFile(filePathToOpenOnLoad);
      }
    })
    .catch(err =>
      log.error('[main.ts] Error ensuring window on activate:', err)
    );
});

nodeProcess.on('uncaughtException', error => {
  recordCriticalFailure('main_process_exception', 'runtime');
  log.error('[main.ts] UNCAUGHT EXCEPTION:', error);
  if (!isDev) {
    dialog.showErrorBox(
      'Unhandled Error',
      `Unexpected error: ${error.message}\nApp will now quit.`
    );
    app.quit();
    nodeProcess.exit(1);
  }
});

nodeProcess.on('unhandledRejection', reason => {
  recordCriticalFailure('main_process_rejection', 'runtime');
  log.error('[main.ts] UNHANDLED REJECTION:', reason);
  if (!isDev) {
    dialog.showErrorBox(
      'Unhandled Error',
      'An unexpected background error occurred. The app will now quit.'
    );
    app.quit();
    nodeProcess.exit(1);
  }
});

app.on('child-process-gone', (_event, details) => {
  if (!isQuitting && details.reason !== 'clean-exit') {
    recordCriticalFailure(
      'child_process_gone',
      'runtime',
      details.reason as ProcessFailureReason
    );
  }
  log.error(
    `[main.ts] Child process gone (${details.type}, ${details.reason}).`
  );
});

async function createWindow(): Promise<BrowserWindow> {
  setStartupPhase('window_creation');
  log.info('[main.ts] Creating main window...');
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: getShellAssetPath('shell-preload.cjs'),
    },
  });
  mainWindow = window;

  // Capture this exact instance. A stale window closing must never clear a
  // newer main window that replaced it after a lifecycle transition.
  window.on('closed', () => {
    log.info('[main.ts] Main window closed.');
    stopHungWindowMonitoring();
    mainWindowCoordinator.clearIfCurrent(window);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    if (!isQuitting && details.reason !== 'clean-exit') {
      recordCriticalFailure(
        'renderer_process_gone',
        'runtime',
        details.reason as ProcessFailureReason
      );
    }
    log.error(`[main.ts] Shell renderer gone (${details.reason}).`);
  });

  tabManager.initTabManager({
    window,
    rendererHtmlPath: getRendererHtmlPath(),
    preloadPath: getPreloadPath(),
    isDev,
    onTabClosed: closedWebContentsId => {
      // A queued file-open whose target tab died would otherwise wait for
      // an unrelated future tab load; re-route it to the active tab now.
      if (
        !filePathToOpenOnLoad ||
        filePathTargetWebContentsId !== closedWebContentsId
      ) {
        return;
      }
      const active = getActiveAppWebContents();
      if (active && !active.isLoading()) {
        log.info(
          `[main.ts] Re-routing queued file to active tab after target tab closed: ${filePathToOpenOnLoad}`
        );
        active.send('open-video-file', filePathToOpenOnLoad);
        filePathToOpenOnLoad = null;
        filePathTargetWebContentsId = null;
      } else {
        filePathTargetWebContentsId = active?.id ?? null;
      }
    },
    onCriticalFailure: processReason => {
      if (isQuitting) return;
      recordCriticalFailure(
        'renderer_process_gone',
        'runtime',
        processReason as ProcessFailureReason
      );
    },
    onTabCreated: (wc, { isFirst }) => {
      wc.on('found-in-page', (_event, result) => {
        if (!wc.isDestroyed()) {
          wc.send('find-results', {
            matches: result.matches,
            activeMatchOrdinal: result.activeMatchOrdinal,
            finalUpdate: result.finalUpdate,
          });
        }
      });

      wc.on('did-finish-load', () => {
        // A tab created mid-checkout missed the pending broadcast; replay
        // it so the tab can't start a conflicting payment session.
        replayPendingCheckoutState(wc);

        // Consume a queued file-open, but only in the tab it was meant for.
        // A null target means "first tab to load" (startup); a destroyed
        // target falls back to whichever tab finishes next.
        if (filePathToOpenOnLoad) {
          const targetGone =
            filePathTargetWebContentsId !== null &&
            !tabManager
              .getAllTabWebContents()
              .some(t => t.id === filePathTargetWebContentsId);
          const isIntendedTab =
            filePathTargetWebContentsId === null ||
            filePathTargetWebContentsId === wc.id ||
            targetGone;
          if (isIntendedTab) {
            log.info(
              `[main.ts] Processing queued file path on did-finish-load: ${filePathToOpenOnLoad}`
            );
            if (!wc.isDestroyed()) {
              wc.send('open-video-file', filePathToOpenOnLoad);
            }
            filePathToOpenOnLoad = null;
            filePathTargetWebContentsId = null;
          }
        }

        if (!isFirst) return;
        log.info('[main.ts] First tab finished loading content.');

        if (checkoutReturnUrlToOpenOnLoad) {
          const checkoutReturnUrl = checkoutReturnUrlToOpenOnLoad;
          checkoutReturnUrlToOpenOnLoad = null;
          log.info('[main.ts] Processing queued checkout return URL.');
          handleCheckoutReturnUrl(checkoutReturnUrl);
        }

        void initializeCreditBalanceState(window).catch(err => {
          log.warn('[main.ts] Initial credit balance sync failed:', err);
        });
      });
    },
  });

  const shellPath = getShellAssetPath('shell.html');
  log.info(`[main.ts] Loading tab shell from: ${shellPath}`);
  try {
    await window.loadFile(shellPath);
    await tabManager.createTab({ activate: true });
    log.info('[main.ts] Shell and first tab loaded successfully.');
  } catch (loadError: any) {
    log.error('[main.ts] Error loading renderer:', loadError);
    dialog.showErrorBox(
      'Load Error',
      `Failed to load UI: ${loadError.message}`
    );
    app.quit();
    return window;
  }

  if (isDev) {
    tabManager.getActiveTabWebContents()?.openDevTools({ mode: 'detach' });
  }

  let currentFindText = '';
  ipcMain.on(
    'find-in-page',
    (event, { text, findNext, forward, matchCase }) => {
      // Find runs in the tab that asked for it.
      const wc = event.sender;
      if (wc.isDestroyed()) return;
      if (text && text.length > 0) {
        if (text !== currentFindText) currentFindText = text;
        wc.findInPage(text, {
          findNext: !!findNext,
          forward: forward === undefined ? true : forward,
          matchCase: !!matchCase,
        });
      } else {
        wc.stopFindInPage('clearSelection');
        currentFindText = '';
      }
    }
  );

  ipcMain.on('stop-find', event => {
    if (!event.sender.isDestroyed()) {
      event.sender.stopFindInPage('clearSelection');
      currentFindText = '';
    }
  });

  createApplicationMenu();

  syncEntitlements({ window, silent: true }).catch(err => {
    log.warn('[main.ts] Initial entitlements sync failed:', err);
  });

  return window;
}

function createApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...((nodeProcess.platform === 'darwin'
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []) as MenuItemConstructorOptions[]),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            // On macOS the app outlives the window (closing the last tab
            // closes it); Cmd+T must bring the window back.
            if (!mainWindow || mainWindow.isDestroyed()) {
              ensureMainWindow().catch(err =>
                log.error('[main.ts] Error recreating window for New Tab:', err)
              );
              return;
            }
            tabManager.newTab();
          },
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => tabManager.closeActiveTab(),
        },
        { type: 'separator' },
        {
          label: 'Next Tab',
          accelerator: 'Ctrl+Tab',
          click: () => tabManager.selectRelativeTab(1),
        },
        {
          label: 'Previous Tab',
          accelerator: 'Ctrl+Shift+Tab',
          click: () => tabManager.selectRelativeTab(-1),
        },
        { type: 'separator' },
        // Cmd+W belongs to Close Tab; the window close gets Shift+Cmd+W
        // (browser convention) so the accelerators never collide.
        nodeProcess.platform === 'darwin'
          ? ({
              role: 'close',
              accelerator: 'Shift+CmdOrCtrl+W',
            } as MenuItemConstructorOptions)
          : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...((nodeProcess.platform === 'darwin'
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: 'Speech',
                submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
              },
            ]
          : [
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' },
            ]) as MenuItemConstructorOptions[]),
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => getActiveAppWebContents()?.send('show-find-bar'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...((isDev
          ? [{ role: 'toggleDevTools' }]
          : []) as MenuItemConstructorOptions[]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        ...(Array.from({ length: 9 }, (_, i) => ({
          label: `Select Tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => tabManager.selectTabAtIndex(i === 8 ? -1 : i),
        })) as MenuItemConstructorOptions[]),
        { role: 'minimize' },
        { role: 'zoom' },
        ...((nodeProcess.platform === 'darwin'
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' },
            ]
          : [
              // Ctrl+W belongs to Close Tab; see the File menu note.
              { role: 'close', accelerator: 'Shift+CmdOrCtrl+W' },
            ]) as MenuItemConstructorOptions[]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  log.info('[main.ts] Application menu created.');
}

async function testYtDlpInstallation() {
  log.warn(
    '[main.ts] testYtDlpInstallation function is a placeholder (implement if needed).'
  );
  return true;
}

app
  .whenReady()
  .then(async () => {
    setStartupPhase('app_ready');
    log.info('[main.ts] App is ready.');

    // Customize About panel
    app.setAboutPanelOptions({
      applicationName: 'Translator',
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: '© 2025 Stage5 Tools LLC',
    });

    try {
      const logDirPath = isDev ? '.' : app.getPath('logs');
      const logFileName = isDev ? 'dev-main.log' : 'main.log';
      const logFilePath = path.join(logDirPath, logFileName);

      try {
        await fsPromises.mkdir(logDirPath, { recursive: true });
      } catch (mkdirError: any) {
        if (mkdirError.code !== 'EEXIST') {
          console.error(
            `[main.ts] Failed to ensure log directory ${logDirPath}:`,
            mkdirError
          );
        }
      }

      log.transports.file.resolvePathFn = () => logFilePath;
      log.transports.file.level = isDev ? 'debug' : 'info';
      log.transports.console.level = isDev ? 'debug' : 'info';

      const resolvedLogPath = log.transports.file.getFile().path;
      log.info(
        `[main.ts] Logging Mode: ${isDev ? 'Development' : 'Production'}`
      );
      log.info(`[main.ts] Log Level: ${log.transports.file.level}`);
      log.info(`[main.ts] Attempting to log to: ${logFilePath}`);
      log.info(`[main.ts] Resolved log file path: ${resolvedLogPath}`);
    } catch (error) {
      console.error('[main.ts] Error configuring logging:', error);
    }

    // Register updater listeners and IPC exactly once for the lifetime of the
    // main process. createWindow() may run repeatedly on macOS.
    try {
      const updateHandlers = buildUpdateHandlers({
        isDev,
        prepareToQuitForUpdate: () => prepareToQuit('update'),
      });
      if (updateHandlers) {
        log.info('[main.ts] Update handlers initialized.');
      }
    } catch (err: any) {
      log.error('[main.ts] Error initializing update handlers:', err);
      throw err;
    }

    try {
      await cleanupInterruptedUrlDownloadPromotions({
        libraryDir: getUrlDownloadLibraryDir(app.getPath('userData')),
        logger: log,
      });
    } catch (cleanupError) {
      log.error(
        '[main.ts] Error cleaning interrupted URL download promotions:',
        cleanupError
      );
    }

    // Packaged upgrades own the legacy shared directory. Avoid having a
    // development instance delete work belonging to an older packaged build
    // that may still be running under a separate app identity.
    if (app.isPackaged) {
      try {
        await cleanupLegacyUrlDownloadScratchDir({
          systemTempDir: app.getPath('temp'),
          logger: log,
        });
      } catch (cleanupError) {
        log.error(
          '[main.ts] Error cleaning legacy translator-electron scratch directory:',
          cleanupError
        );
      }
    }

    setStartupPhase('startup_cleanup');
    log.info('[main.ts] Performing startup cleanup...');
    if (services?.fileManager?.cleanup) {
      try {
        await services.fileManager.cleanup();
        log.info('[main.ts] Startup cleanup finished.');
      } catch (cleanupError) {
        log.error('[main.ts] Error during startup cleanup:', cleanupError);
      }
    } else {
      log.warn('[main.ts] FileManager service not available for cleanup.');
    }

    if (services?.fileManager?.ensureTempDir) {
      try {
        await services.fileManager.ensureTempDir();
        log.info('[main.ts] Temp directory is ready after startup cleanup.');
      } catch (tempDirError) {
        log.error(
          '[main.ts] Failed to re-create temp directory after cleanup:',
          tempDirError
        );
      }
    }

    if (app.isPackaged) {
      log.info('[main.ts] Checking yt-dlp installation...');
      await testYtDlpInstallation();
    }

    allowMainWindowCreation();
    await ensureMainWindow().then(window => {
      setStartupPhase('renderer_ready');
      markStartupSuccessful();
      log.info('[main.ts] Main window created.');
      
      // Initialize agent socket server for packaged mode
      if (!agentSocketServer) {
        agentSocketServer = new AgentSocketServer(window);
        log.info('[main.ts] Agent socket server initialized');
      }
      
      void trackAppOpen();
      void flushPendingCriticalFailures();
      void flushPendingProductEvents();
      startHungWindowMonitoring(window);
      if (isDev) {
        window.webContents.on('devtools-opened', () => {
          // Additional dev logic if desired
        });
      }
    });

    // Start agent socket server if agent control is enabled in packaged build
    await updateAgentSocketServer();

    // Prewarm the download pipeline (yt-dlp binary check + self-update +
    // JS-runtime probe) off the critical path so the user's first download
    // skips the multi-second warm-up.
    setTimeout(() => {
      import('./services/url-processor/index.js')
        .then(urlProcessor => urlProcessor.prewarmDownloadPipeline())
        .catch(err =>
          log.warn('[main.ts] Download pipeline prewarm failed:', err)
        );
    }, 4_000);
  })
  .catch(error => {
    recordCriticalFailure('startup_initialization_failed');
    log.error('[main.ts] Error during app.whenReady:', error);
    dialog.showErrorBox(
      'Application Error',
      `Failed to start: ${error.message}`
    );
    app.quit();
    nodeProcess.exit(1);
  });

function openVideoFile(filePath: string) {
  log.info(`[main.ts] Request to open video file: ${filePath}`);
  if (!filePath || !fs.existsSync(filePath)) {
    log.warn(
      `[main.ts] Invalid or non-existent file path for openVideoFile: ${filePath}`
    );
    filePathToOpenOnLoad = null;
    filePathTargetWebContentsId = null;
    return;
  }

  void trackFirstMeaningfulUse('video_open');

  const activeTab = getActiveAppWebContents();
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    activeTab &&
    !activeTab.isLoading()
  ) {
    log.info(
      `[main.ts] Active tab is ready. Sending 'open-video-file' IPC for: ${filePath}`
    );
    activeTab.send('open-video-file', filePath);
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
    filePathToOpenOnLoad = null;
  } else {
    log.info(
      `[main.ts] Main window not fully ready or available. Queuing filePath: ${filePath}`
    );
    filePathToOpenOnLoad = filePath;
    filePathTargetWebContentsId = activeTab?.id ?? null;
    if (app.isReady() && (!mainWindow || mainWindow.isDestroyed())) {
      log.info(
        '[main.ts] No windows open, creating one to handle queued file.'
      );
      ensureMainWindow().catch(err =>
        log.error('[main.ts] Error creating window for queued file:', err)
      );
    }
  }
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  log.info(`[main.ts] 'open-file' event (macOS) for: ${filePath}`);
  if (!filePath || !fs.existsSync(filePath)) {
    log.warn(
      `[main.ts] Invalid or non-existent file path from 'open-file' event: ${filePath}`
    );
    filePathToOpenOnLoad = null;
    filePathTargetWebContentsId = null;
    return;
  }
  if (app.isReady()) {
    openVideoFile(filePath);
  } else {
    filePathToOpenOnLoad = filePath;
    filePathTargetWebContentsId = null;
  }
});
