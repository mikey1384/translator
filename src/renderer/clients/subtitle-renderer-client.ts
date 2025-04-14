import { RenderSubtitlesOptions } from '../../types/interface.js'; // Adjust path if necessary

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

  constructor() {
    console.log(
      '[SubtitleRendererClient] Initializing client (using dynamic import)...'
    );
    this.setupIpcListeners(); // Call setup, it will dynamically import
  }

  // Use dynamic import inside the listener setup
  private async setupIpcListeners(): Promise<void> {
    try {
      // Dynamically import ipcRenderer only when needed
      const { ipcRenderer } = await import('electron');

      // Listener for the *final* result from the main process
      ipcRenderer.on(
        RENDER_CHANNELS.RESULT,
        (_event, result: RenderResult & { operationId: string }) => {
          if (result.operationId === this.currentOperationId) {
            console.log(
              `[SubtitleRendererClient ${this.currentOperationId}] Received final render result:`,
              result
            );
            this.isRendering = false;
            this.currentOperationId = null;
          } else {
            console.warn(
              `[SubtitleRendererClient] Received result for unexpected operation ID: ${result.operationId}`
            );
          }
        }
      );
      console.log(
        `[SubtitleRendererClient] Dynamically imported ipcRenderer and listening for final results on ${RENDER_CHANNELS.RESULT}`
      );
    } catch (error) {
      console.error(
        '[SubtitleRendererClient] Failed to dynamically import electron for listener setup:',
        error
      );
    }
  }

  // Main method called by the UI (e.g., EditSubtitles component)
  async startOverlayRenderProcess(
    options: RenderSubtitlesOptions
  ): Promise<{ success: boolean; error?: string }> {
    const { ipcRenderer } = await import('electron');
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
    this.currentOperationId = options.operationId; // Store the operation ID
    console.log(
      `[SubtitleRendererClient ${this.currentOperationId}] Starting overlay render process:`,
      options
    );

    try {
      // Explicitly check if ipcRenderer exists on the imported module
      if (ipcRenderer && ipcRenderer) {
        // Send the initial request using the imported object
        ipcRenderer.send(RENDER_CHANNELS.REQUEST, options); // Use ipcRenderer
        console.log(
          `[SubtitleRendererClient ${this.currentOperationId}] Dynamically imported electron module and sent ${RENDER_CHANNELS.REQUEST} via ipcRenderer.`
        );
        // Indicate that the process *started* successfully.
        return { success: true };
      } else {
        // Log the whole imported object for debugging if ipcRenderer is missing
        console.error(
          '[SubtitleRendererClient] Dynamically imported electron module does NOT contain ipcRenderer. Module content:',
          ipcRenderer
        );
        throw new Error(
          'Dynamically imported electron module is missing ipcRenderer property.'
        );
      }
    } catch (error: any) {
      console.error(
        `[SubtitleRendererClient ${this.currentOperationId}] Error during dynamic import or sending request:`,
        error
      );
      this.isRendering = false; // Reset state on error
      this.currentOperationId = null;
      return {
        success: false,
        error: error.message || 'Failed to send render request',
      };
    }
  }
}

// Instantiate and export
const subtitleRendererClient = new SubtitleRendererClient();
export default subtitleRendererClient;

// Export types needed by consumers of this client
export type { RenderSubtitlesOptions };
