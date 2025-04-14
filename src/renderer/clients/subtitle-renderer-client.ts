import {
  RenderSubtitlesOptions,
  ExposedRenderResult,
} from '../../types/interface.js'; // Import types

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

// Channels for file/directory operations needed by the client
// Let's reuse existing file handler channels if possible, or define specific ones if needed.
// For now, we'll assume the main process handles temp dir creation internally when needed.

// Interface for the result expected by the main window
interface RenderResult {
  success: boolean;
  outputPath?: string; // Path to the generated final video (or temp overlay)
  error?: string;
}

// Basic class structure (will be filled in later)
class SubtitleRendererClient {
  private isRendering: boolean = false;
  private currentOperationId: string | null = null;
  private removeResultListener: (() => void) | null = null; // Store cleanup function

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
        (result: ExposedRenderResult) => {
          // Ensure the callback is bound correctly or defined elsewhere if needed
          this.handleRenderResult(result);
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

  // Handler for the result received via the bridge
  private handleRenderResult(result: ExposedRenderResult): void {
    if (result.operationId === this.currentOperationId) {
      console.log(
        `[SubtitleRendererClient ${this.currentOperationId}] Received final render result via bridge:`,
        result
      );

      // TODO: Add UI logic here based on result
      // e.g., show success/error message, clear progress bar
      if (result.success) {
        // Handle success - maybe show message with result.outputPath
      } else if (result.cancelled) {
        // Handle cancellation
      } else {
        // Handle error - show result.error
      }

      this.isRendering = false;
      this.currentOperationId = null;
    } else {
      console.warn(
        `[SubtitleRendererClient] Received result for unexpected operation ID via bridge: ${result.operationId}`
      );
    }
  }

  // Main method called by the UI
  async startOverlayRenderProcess(
    options: RenderSubtitlesOptions
  ): Promise<{ success: boolean; error?: string }> {
    if (this.isRendering) {
      console.warn(
        '[SubtitleRendererClient] Render process already in progress.'
      );
      return { success: false, error: 'Renderer busy' };
    }
    if (
      !options ||
      !options.operationId ||
      !options.srtContent ||
      !options.outputDir ||
      !options.videoDuration ||
      !options.videoWidth ||
      !options.videoHeight ||
      !options.frameRate
    ) {
      console.error(
        '[SubtitleRendererClient] Invalid options provided for rendering.',
        options
      );
      return { success: false, error: 'Invalid options for rendering' };
    }

    this.isRendering = true;
    this.currentOperationId = options.operationId;
    console.log(
      `[SubtitleRendererClient ${this.currentOperationId}] Starting overlay render process via bridge:`,
      options
    );

    try {
      // Call the exposed function from preload to send the request
      window.electron.sendPngRenderRequest(options);
      console.log(
        `[SubtitleRendererClient ${this.currentOperationId}] Sent request via window.electron.sendPngRenderRequest.`
      );
      // Return success indicating the request was *sent*
      return { success: true };
    } catch (error: any) {
      console.error(
        `[SubtitleRendererClient ${this.currentOperationId}] Error calling sendPngRenderRequest via bridge:`,
        error
      );
      this.isRendering = false;
      this.currentOperationId = null;
      return {
        success: false,
        error: error.message || 'Failed to send render request via bridge',
      };
    }
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
