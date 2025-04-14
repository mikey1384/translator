import {
  RenderSubtitlesOptions,
  ExposedRenderResult,
} from '../../types/interface.js'; // Import types

// Add this type definition
type PngRenderResult = {
  operationId: string;
  success: boolean;
  outputPath?: string; // Optional: path to the final overlay video on success
  error?: string; // Optional: error message on failure
};

// Channels for the main renderer client triggering the process
export const RENDER_CHANNELS = {
  REQUEST: 'render-subtitles-request', // Main Window -> Main Process
  RESULT: 'render-subtitles-result', // Main Process -> Main Window
};

// Channels for managing the hidden render window
export const WINDOW_CHANNELS = {
  CREATE_REQUEST: 'create-render-window-request', // Main Window Client -> Main Process
  CREATE_SUCCESS: 'create-render-window-success', // Main Process -> Main Window Client
  DESTROY_REQUEST: 'destroy-render-window-request', // Main Window Client -> Main Process
  UPDATE_SUBTITLE: 'render-window-update-subtitle', // Main Process -> Hidden Window (relayed)
};

// Channels for coordinating frame capture and final assembly
export const CAPTURE_CHANNELS = {
  CAPTURE_FRAME_REQUEST: 'capture-frame-request', // Main Window Client -> Main Process
  FFMPEG_ASSEMBLE_REQUEST: 'ffmpeg-assemble-pngs-request', // Main Window Client -> Main Process
  // Results for invoke calls are handled via Promise resolution/rejection
};

// Basic class structure (will be filled in later)
class SubtitleRendererClient {
  private removeResultListener: (() => void) | null = null; // Store cleanup function
  private renderPromises = new Map<
    string,
    { resolve: (result: PngRenderResult) => void; reject: (error: any) => void }
  >();

  constructor() {
    console.log(
      '[SubtitleRendererClient] Initializing client (using preload bridge ONLY)...'
    );
    this.setupIpcListenersViaBridge();
  }

  // Setup listener via the preload bridge
  private setupIpcListenersViaBridge(): void {
    console.log(
      '[SubtitleRendererClient] Setting up result listener via window.electron.onPngRenderResult'
    );
    try {
      // Remove previous listener if exists (safety measure)
      if (this.removeResultListener) {
        this.removeResultListener();
        this.removeResultListener = null;
      }

      // Use the exposed function from preload
      this.removeResultListener = window.electron.onPngRenderResult(
        (result: PngRenderResult) => {
          const { operationId, success, error, outputPath } = result;
          console.info(`[Preload] Received PngRenderResult:`, result); // Log the raw result

          // Find the corresponding promise callbacks
          const promiseCallbacks = this.renderPromises.get(operationId);

          if (promiseCallbacks) {
            if (success) {
              console.info(
                `[SubtitleRendererClient ${operationId}] Received SUCCESS result from main.`
              );
              promiseCallbacks.resolve({ operationId, success, outputPath }); // Resolve the promise
            } else {
              console.error(
                `[SubtitleRendererClient ${operationId}] Received FAILURE result from main:`,
                error
              );
              promiseCallbacks.reject(
                new Error(error || 'Unknown rendering error from main process')
              ); // Reject the promise
            }
            // Clean up the stored promise
            this.renderPromises.delete(operationId);
          } else {
            console.warn(
              `[SubtitleRendererClient] Received result for unknown or already completed operation ID: ${operationId}`
            );
          }
        }
      );
    } catch (error) {
      console.error(
        '[SubtitleRendererClient] Failed to set up listener via preload bridge:',
        error
      );
      // Maybe show an error to the user?
    }
  }

  // Main method called by the UI
  async renderSubtitles(
    options: RenderSubtitlesOptions
  ): Promise<PngRenderResult> {
    const { operationId } = options;
    console.log(
      `[SubtitleRendererClient ${operationId}] Starting overlay render process via bridge:`,
      options
    );

    // Return a new Promise
    return new Promise((resolve, reject) => {
      // Store the resolve/reject functions
      this.renderPromises.set(operationId, { resolve, reject });

      try {
        // Send the request via the preload bridge
        window.electron.sendPngRenderRequest(options);
        console.log(
          `[SubtitleRendererClient ${operationId}] Sent request via window.electron.sendPngRenderRequest.`
        );
        // DO NOT resolve or return anything else here - wait for the listener
      } catch (error) {
        console.error(
          `[SubtitleRendererClient ${operationId}] Error sending request via bridge:`,
          error
        );
        // If sending fails immediately, remove from map and reject
        this.renderPromises.delete(operationId);
        reject(error); // Reject the promise
      }
    });
  }

  // Optional: Add a cleanup method if needed when the client is no longer used
  // cleanup() {
  //    if (this.removeResultListener) {
  //       this.removeResultListener();
  //       this.removeResultListener = null;
  //    }
  // }
}

// Instantiate and export
const subtitleRendererClient = new SubtitleRendererClient();
export default subtitleRendererClient;

// Export types needed by consumers of this client
export type { RenderSubtitlesOptions };
