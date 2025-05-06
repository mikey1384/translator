import { RenderSubtitlesOptions } from '@shared-types/app'; // Import types
import * as SubtitleIPC from '@ipc/subtitles';

type PngRenderResult = {
  operationId: string;
  success: boolean;
  outputPath?: string;
  error?: string;
};

export const RENDER_CHANNELS = {
  REQUEST: 'render-subtitles-request',
  RESULT: 'render-subtitles-result',
};

export const WINDOW_CHANNELS = {
  CREATE_REQUEST: 'create-render-window-request',
  CREATE_SUCCESS: 'create-render-window-success',
  DESTROY_REQUEST: 'destroy-render-window-request',
  UPDATE_SUBTITLE: 'render-window-update-subtitle',
};

export const CAPTURE_CHANNELS = {
  CAPTURE_FRAME_REQUEST: 'capture-frame-request',
  FFMPEG_ASSEMBLE_REQUEST: 'ffmpeg-assemble-pngs-request',
};

class SubtitleRendererClient {
  private removeResultListener: (() => void) | null = null;
  private renderPromises = new Map<
    string,
    {
      resolve: (result: PngRenderResult) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor() {
    console.log(
      '[SubtitleRendererClient] Initializing client (using preload bridge ONLY)...'
    );
    this.setupIpcListenersViaBridge();
  }

  private setupIpcListenersViaBridge(): void {
    console.log(
      '[SubtitleRendererClient] Setting up result listener via window.electron.onPngRenderResult'
    );
    try {
      if (this.removeResultListener) {
        this.removeResultListener();
        this.removeResultListener = null;
      }

      this.removeResultListener = SubtitleIPC.onPngRenderResult(
        (result: PngRenderResult) => {
          const { operationId, success, error, outputPath } = result;
          console.info(`[Preload] Received PngRenderResult:`, result);

          const promiseCallbacks = this.renderPromises.get(operationId);

          if (promiseCallbacks) {
            if (success) {
              console.info(
                `[SubtitleRendererClient ${operationId}] Received SUCCESS result from main.`
              );
              promiseCallbacks.resolve({ operationId, success, outputPath });
            } else {
              console.error(
                `[SubtitleRendererClient ${operationId}] Received FAILURE result from main:`,
                error
              );
              promiseCallbacks.reject(
                new Error(
                  String(error || 'Unknown rendering error from main process')
                )
              );
            }
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
    }
  }

  async renderSubtitles(
    options: RenderSubtitlesOptions & { timeoutMs?: number }
  ): Promise<PngRenderResult> {
    const DEFAULT_TIMEOUT_MS = 60_000;
    const { operationId, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    console.log(
      `[SubtitleRendererClient ${operationId}] Starting overlay render process via bridge:`,
      options
    );

    let timer: ReturnType<typeof setTimeout>;
    let offProgress: (() => void) | null = null;

    return new Promise<PngRenderResult>((resolve, reject) => {
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (offProgress) offProgress();
          this.renderPromises.delete(operationId);
          reject(
            new Error(
              `Render ${operationId} stalled or timed out after ${timeoutMs} ms`
            )
          );
        }, timeoutMs);
      };

      arm();

      this.renderPromises.set(operationId, {
        resolve: result => {
          clearTimeout(timer);
          if (offProgress) offProgress();
          resolve(result);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          if (offProgress) offProgress();
          reject(error);
        },
      });

      offProgress = SubtitleIPC.onMergeProgress(
        (p: { operationId: string; [key: string]: any }) => {
          if (p.operationId === operationId) {
            arm();
          }
        }
      );

      try {
        SubtitleIPC.sendPngRenderRequest(options);
        console.log(
          `[SubtitleRendererClient ${operationId}] Sent request via SubtitleIPC.sendPngRenderRequest.`
        );
      } catch (error) {
        console.error(
          `[SubtitleRendererClient ${operationId}] Error sending request via bridge:`,
          error
        );
        clearTimeout(timer);
        if (offProgress) offProgress();
        this.renderPromises.delete(operationId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

const subtitleRendererClient = new SubtitleRendererClient();
export default subtitleRendererClient;
