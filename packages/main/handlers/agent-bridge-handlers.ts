/**
 * Agent Bridge IPC Handlers
 * 
 * Secure IPC bridge between agent socket server and renderer translatorAgent bridge.
 * Replaces direct executeJavaScript calls with proper typed IPC handlers.
 */

import { ipcMain, BrowserWindow } from 'electron';
import log from 'electron-log';
import { getActiveAppWebContents } from '../utils/window.js';

type AgentMethod = string;
type AgentParams = Record<string, unknown>;

/**
 * Register an IPC handler that forwards agent requests to the renderer.
 * The renderer must have window.translatorAgent[method] available.
 */
export function registerAgentBridgeHandler(
  mainWindow: BrowserWindow,
  method: AgentMethod
): void {
  ipcMain.handle(`agent-bridge:${method}`, async (_event, params: AgentParams) => {
    try {
      // Get the active tab WebContentsView where translatorAgent lives
      const webContents = getActiveAppWebContents(mainWindow);
      if (!webContents) {
        throw new Error('Active tab WebContents not available');
      }

      // Send request to renderer and wait for response
      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Agent bridge timeout for method: ${method}`));
        }, 120000); // 2 minute timeout for long operations

        const responseChannel = `agent-bridge-response:${method}:${Date.now()}`;
        
        const onResponse = (_evt: any, response: any) => {
          clearTimeout(timeout);
          ipcMain.removeListener(responseChannel, onResponse);
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.result);
          }
        };
        
        ipcMain.on(responseChannel, onResponse);

        webContents.send('agent-bridge-request', {
          method,
          params,
          responseChannel,
        });
      });

      return result;
    } catch (error: any) {
      log.error(`[agent-bridge] Error calling ${method}:`, error);
      throw error;
    }
  });
}

/**
 * Call an agent method directly (used by AgentSocketServer).
 * Do NOT use ipcMain.invoke from main process - call the handler function directly.
 */
export async function callAgentMethod(
  method: AgentMethod,
  params: AgentParams,
  mainWindow: BrowserWindow
): Promise<unknown> {
  try {
    // Get the active tab WebContentsView where translatorAgent lives
    const webContents = getActiveAppWebContents(mainWindow);
    if (!webContents) {
      throw new Error('Active tab WebContents not available');
    }

    // Send request to renderer and wait for response
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Agent bridge timeout for method: ${method}`));
      }, 120000); // 2 minute timeout for long operations

      const responseChannel = `agent-bridge-response:${method}:${Date.now()}`;
      
      ipcMain.handleOnce(responseChannel, async (_evt, response) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.result);
        }
      });

      webContents.send('agent-bridge-request', {
        method,
        params,
        responseChannel,
      });
    });

    return result;
  } catch (error: any) {
    log.error(`[agent-bridge] Failed to call ${method}:`, error);
    throw error;
  }
}

/**
 * Register all agent bridge handlers for the main window.
 * These should match the methods exposed by window.translatorAgent.
 */
export function registerAllAgentBridgeHandlers(mainWindow: BrowserWindow): void {
  const methods = [
    'status',
    'navigationSnapshot',
    'navigate',
    'openExternalWebPage',
    'openCreditCheckout',
    'showSettings',
    'settingsSnapshot',
    'updateSettings',
    'storeProviderKey',
    'clearProviderKey',
    'getDownloads',
    'openDownload',
    'redownloadEntry',
    'startVideoDownload',
    'openVideo',
    'mountSubtitles',
    'setSubtitleDisplay',
    'setSubtitleStyle',
    'startTranscription',
    'startTranslation',
    'startDubbing',
    'startSummary',
    'startCueTranslation',
    'startCueTranscription',
    'startMerge',
    'startMediaWorkflow',
    'processingStatus',
    'processingCancel',
    'getSubtitles',
    'updateSubtitles',
    'mutateSubtitles',
    'exportSubtitles',
    'videoSearch',
    'videoSearchMore',
    'videoSearchStatus',
    'videoSearchCancel',
    'videoBatchDownload',
    'videoBatchCancel',
    'videoBatchStatus',
  ];

  for (const method of methods) {
    registerAgentBridgeHandler(mainWindow, method);
  }

  log.info('[agent-bridge] Registered all agent bridge handlers');
}

/**
 * Cleanup agent bridge handlers when main window closes.
 */
export function cleanupAgentBridgeHandlers(): void {
  const methods = [
    'status',
    'navigationSnapshot',
    'navigate',
    'openExternalWebPage',
    'openCreditCheckout',
    'showSettings',
    'settingsSnapshot',
    'updateSettings',
    'storeProviderKey',
    'clearProviderKey',
    'getDownloads',
    'openDownload',
    'redownloadEntry',
    'startVideoDownload',
    'openVideo',
    'mountSubtitles',
    'setSubtitleDisplay',
    'setSubtitleStyle',
    'startTranscription',
    'startTranslation',
    'startDubbing',
    'startSummary',
    'startCueTranslation',
    'startCueTranscription',
    'startMerge',
    'startMediaWorkflow',
    'processingStatus',
    'processingCancel',
    'getSubtitles',
    'updateSubtitles',
    'mutateSubtitles',
    'exportSubtitles',
    'videoSearch',
    'videoSearchMore',
    'videoSearchStatus',
    'videoSearchCancel',
    'videoBatchDownload',
    'videoBatchCancel',
    'videoBatchStatus',
  ];

  for (const method of methods) {
    ipcMain.removeHandler(`agent-bridge:${method}`);
  }

  log.info('[agent-bridge] Cleaned up agent bridge handlers');
}
