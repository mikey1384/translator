import { ipcMain, BrowserWindow, app } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url'; // For __dirname in ES modules
import { RenderSubtitlesOptions } from '../types/interface.js';

// --- ES Module __dirname Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Re-define channels used in this handler file
const RENDER_CHANNELS = {
  REQUEST: 'render-subtitles-request',
  RESULT: 'render-subtitles-result',
};
const WINDOW_CHANNELS = {
  CREATE_REQUEST: 'create-render-window-request',
  CREATE_SUCCESS: 'create-render-window-success',
  DESTROY_REQUEST: 'destroy-render-window-request',
  UPDATE_SUBTITLE: 'render-window-update-subtitle',
};

// Map to store references to active hidden subtitle render windows
const renderWindows = new Map<number, BrowserWindow>();

/**
 * Initializes IPC handlers for the subtitle overlay rendering process.
 */
export function initializeRenderWindowHandlers(): void {
  log.info('[RenderWindowHandlers] Initializing...');

  // --- Main Orchestration Handler ---
  ipcMain.on(
    RENDER_CHANNELS.REQUEST,
    async (event, options: RenderSubtitlesOptions) => {
      const { operationId } = options;
      log.info(
        `[RenderWindowHandlers ${operationId}] Received ${RENDER_CHANNELS.REQUEST}. Orchestration starting.`
      );

      let windowId: number | null = null;
      let tempDirPath: string | null = null; // Keep track of temp dir path

      try {
        // --- Create Temp Directory ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Creating temporary directory...`
        );
        tempDirPath = await createOperationTempDir(operationId); // Now called
        log.info(
          `[RenderWindowHandlers ${operationId}] Temporary directory created: ${tempDirPath}`
        );
        // --- End Temp Directory ---

        // --- Create Hidden Window ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Attempting to create hidden window...`
        );
        windowId = await createHiddenRenderWindow(options);
        log.info(
          `[RenderWindowHandlers ${operationId}] Hidden window created successfully with ID: ${windowId}.`
        );
        // --- End Hidden Window ---

        // --- !!! TEMPORARY IMMEDIATE RESPONSE !!! ---
        log.warn(
          `[RenderWindowHandlers ${operationId}] Functionality beyond setup not yet implemented. Sending placeholder failure.`
        );
        event.reply(RENDER_CHANNELS.RESULT, {
          operationId: operationId,
          success: false,
          error:
            'Render overlay functionality not yet implemented in main process (setup complete).',
        });
        // --- End Temporary Response ---
      } catch (error: any) {
        log.error(
          `[RenderWindowHandlers ${operationId}] Error during orchestration (setup phase):`,
          error
        );
        event.reply(RENDER_CHANNELS.RESULT, {
          operationId,
          success: false,
          error: error.message || 'Setup failed',
        });
        // Cleanup is handled in finally
      } finally {
        // --- Guaranteed Cleanup ---
        log.info(
          `[RenderWindowHandlers ${operationId}] Entering finally block for cleanup.`
        );
        // Clean up window if it exists
        if (windowId !== null) {
          const windowToDestroy = renderWindows.get(windowId);
          if (windowToDestroy && !windowToDestroy.isDestroyed()) {
            log.info(
              `[RenderWindowHandlers ${operationId}] Cleaning up window ID ${windowId} in finally block.`
            );
            windowToDestroy.destroy();
            renderWindows.delete(windowId);
          }
        }
        // Clean up temp directory if it exists
        await cleanupTempDir(tempDirPath, operationId);
        log.info(`[RenderWindowHandlers ${operationId}] Cleanup finished.`);
        // --- End Cleanup ---
      }
    }
  );

  // --- Add other handlers later (CREATE_WINDOW, DESTROY_WINDOW, CAPTURE_FRAME, etc.) ---

  ipcMain.on(WINDOW_CHANNELS.DESTROY_REQUEST, (_event, args) => {
    const { windowId, operationId } = args; // Expect operationId for logging
    log.info(
      `[RenderWindowHandlers ${operationId || 'Cleanup'}] Received request to destroy window ID: ${windowId}`
    );
    const windowToDestroy = renderWindows.get(windowId);
    if (windowToDestroy && !windowToDestroy.isDestroyed()) {
      log.info(
        `[RenderWindowHandlers ${operationId || 'Cleanup'}] Destroying window ID: ${windowId}`
      );
      windowToDestroy.destroy(); // Actually destroy the window
      renderWindows.delete(windowId); // Remove from map
    } else {
      log.warn(
        `[RenderWindowHandlers ${operationId || 'Cleanup'}] Window ID ${windowId} not found or already destroyed.`
      );
    }
  });

  log.info('[RenderWindowHandlers] Initialization complete.');
}

// --- Placeholder functions for later implementation ---

async function createOperationTempDir(operationId: string): Promise<string> {
  // TODO: Implement temp directory creation logic using fsPromises and app.getPath('temp')
  log.info(
    `[RenderWindowHandlers ${operationId}] Placeholder: Create Temp Dir`
  );
  const tempDir = path.join(
    app.getPath('temp'),
    `subtitle-render-${operationId}`
  );
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

async function createHiddenRenderWindow(
  options: RenderSubtitlesOptions
): Promise<number> {
  const { operationId, videoWidth, videoHeight } = options;
  log.info(
    `[RenderWindowHandlers ${operationId}] Creating hidden window (${videoWidth}x${videoHeight}).`
  );

  return new Promise<number>((resolve, reject) => {
    try {
      const renderWindow = new BrowserWindow({
        width: videoWidth,
        height: videoHeight,
        show: false, // Keep it hidden
        frame: false,
        transparent: true, // Allows capturing only the subtitles if background is transparent in CSS
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          // SECURITY: Ensure this preload script is correctly configured and secured
          preload: path.join(__dirname, 'preload-render-window.js'), // Preload for this specific window
          backgroundThrottling: false, // Keep rendering smoothly even when hidden
          devTools: !app.isPackaged, // Enable DevTools only in development
        },
        skipTaskbar: true, // Don't show in the taskbar
      });

      const windowId = renderWindow.id;
      renderWindows.set(windowId, renderWindow);
      log.info(
        `[RenderWindowHandlers ${operationId}] Stored hidden render window ID: ${windowId}`
      );

      // Handle window closure events gracefully
      renderWindow.on('closed', () => {
        log.info(
          `[RenderWindowHandlers ${operationId}] Hidden window ID ${windowId} was closed.`
        );
        renderWindows.delete(windowId); // Remove from map if closed unexpectedly
      });

      // Prevent accidental closure - should only be closed via IPC
      renderWindow.on('close', e => {
        if (!renderWindow.isDestroyed()) {
          log.warn(
            `[RenderWindowHandlers ${operationId}] Attempt to close hidden window ID ${windowId} directly was prevented. Use DESTROY_REQUEST.`
          );
          e.preventDefault(); // Prevent closing
        }
      });

      // Load the host HTML file for the React component
      // TODO: Ensure 'render-host.html' exists and is correctly built/copied.
      // Adjust the path based on your build output structure (dev vs. prod).
      const hostHtmlPath = path.join(
        app.getAppPath(),
        'dist',
        'render-host.html'
      );
      log.info(
        `[RenderWindowHandlers ${operationId}] Loading render host HTML: ${hostHtmlPath}`
      );

      renderWindow
        .loadFile(hostHtmlPath)
        .then(() => {
          log.info(
            `[RenderWindowHandlers ${operationId}] Render host HTML loaded for window ID ${windowId}.`
          );
          // Now that the window and its HTML are ready, resolve the promise with the ID
          resolve(windowId);
        })
        .catch(err => {
          log.error(
            `[RenderWindowHandlers ${operationId}] Failed to load host HTML for window ID ${windowId}:`,
            err
          );
          // Clean up the failed window attempt
          if (!renderWindow.isDestroyed()) {
            renderWindow.destroy();
          }
          renderWindows.delete(windowId);
          reject(new Error(`Failed to load render-host.html: ${err.message}`));
        });
    } catch (error) {
      log.error(
        `[RenderWindowHandlers ${operationId}] Error creating hidden window:`,
        error
      );
      reject(error); // Reject the promise on error
    }
  });
}

async function cleanupTempDir(
  tempDirPath: string | null,
  operationId: string
): Promise<void> {
  if (!tempDirPath) {
    log.warn(
      `[RenderWindowHandlers ${operationId}] No temp directory path provided for cleanup.`
    );
    return;
  }
  try {
    log.info(
      `[RenderWindowHandlers ${operationId}] Cleaning up temporary directory: ${tempDirPath}`
    );
    await fs.rm(tempDirPath, { recursive: true, force: true });
    log.info(
      `[RenderWindowHandlers ${operationId}] Successfully removed temp directory: ${tempDirPath}`
    );
  } catch (error) {
    log.error(
      `[RenderWindowHandlers ${operationId}] Error removing temporary directory ${tempDirPath}:`,
      error
    );
    // Decide if this should throw or just be logged
  }
}
