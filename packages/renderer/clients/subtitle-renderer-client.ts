import { RenderSubtitlesOptions } from '@shared-types/app'; // Import types
import * as SubtitleIPC from '@ipc/subtitles';
import type { RenderCancelRequestResult } from '@ipc/subtitles';
import { useTaskStore } from '../state';
import { SUBTITLE_RENDER_TIMEOUT } from '../../shared/constants/runtime-config';

type PngRenderResult = {
  operationId: string;
  success: boolean;
  outputPath?: string;
  error?: string;
  cancelled?: boolean;
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
  private cancelRequestedOperations = new Set<string>();
  private cancelDeadlines = new Map<string, number>();
  private operationTimeouts = new Map<string, number>();

  private rejectPendingOperation(operationId: string, error: Error): boolean {
    const pending = this.renderPromises.get(operationId);
    if (!pending) return false;
    this.renderPromises.delete(operationId);
    pending.reject(error);
    return true;
  }

  private markCancelRequested(operationId: string): void {
    if (this.cancelRequestedOperations.has(operationId)) return;
    this.cancelRequestedOperations.add(operationId);
    const timeoutMs =
      this.operationTimeouts.get(operationId) ?? SUBTITLE_RENDER_TIMEOUT;
    this.cancelDeadlines.set(operationId, Date.now() + timeoutMs);
  }

  private clearOperationTracking(operationId: string): void {
    this.cancelRequestedOperations.delete(operationId);
    this.cancelDeadlines.delete(operationId);
    this.operationTimeouts.delete(operationId);
  }

  private isCurrentMergeOperation(operationId: string): boolean {
    return useTaskStore.getState().merge.id === operationId;
  }

  private isOperationPending(operationId: string): boolean {
    return this.renderPromises.has(operationId);
  }

  private async getOperationStatus(operationId: string): Promise<{
    active: boolean;
    savePhase: boolean;
  } | null> {
    try {
      return await SubtitleIPC.requestPngRenderStatus(operationId);
    } catch (error) {
      console.warn(
        `[SubtitleRendererClient ${operationId}] Failed to query render status:`,
        error
      );
      return null;
    }
  }

  async waitForMergeSettlement(
    operationId: string,
    timeoutMs = 5_000
  ): Promise<boolean> {
    const deadlineAt = Date.now() + timeoutMs;

    return new Promise(resolve => {
      const poll = async () => {
        const status = await this.getOperationStatus(operationId);
        if (status && !status.active) {
          this.clearOperationTracking(operationId);
          resolve(true);
          return;
        }
        if (Date.now() >= deadlineAt) {
          resolve(false);
          return;
        }
        window.setTimeout(() => {
          void poll();
        }, 100);
      };

      void poll();
    });
  }

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
          const { operationId, success, error, outputPath, cancelled } = result;
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
              const reason = cancelled
                ? 'Cancelled'
                : String(error || 'Unknown rendering error from main process');
              promiseCallbacks.reject(new Error(reason));
            }
            this.renderPromises.delete(operationId);
          } else {
            console.warn(
              `[SubtitleRendererClient] Received result for unknown or already completed operation ID: ${operationId}`
            );
          }
          this.clearOperationTracking(operationId);
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
    const DEFAULT_TIMEOUT_MS = SUBTITLE_RENDER_TIMEOUT;
    const { operationId, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    this.clearOperationTracking(operationId);
    this.operationTimeouts.set(operationId, timeoutMs);
    console.log(
      `[SubtitleRendererClient ${operationId}] Starting overlay render process via bridge:`,
      options
    );

    let timer: ReturnType<typeof setTimeout>;
    let offProgress: (() => void) | null = null;

    return new Promise<PngRenderResult>((resolve, reject) => {
      const arm = () => {
        clearTimeout(timer);
        const cancelDeadline = this.cancelDeadlines.get(operationId);
        const delayMs =
          cancelDeadline != null
            ? Math.max(50, Math.min(timeoutMs, cancelDeadline - Date.now()))
            : timeoutMs;
        timer = setTimeout(() => {
          const cancelDeadlineAt = this.cancelDeadlines.get(operationId);
          if (cancelDeadlineAt != null) {
            if (Date.now() < cancelDeadlineAt) {
              // Cancellation was requested; wait only until the hard deadline.
              arm();
              return;
            }
            this.clearOperationTracking(operationId);
            this.rejectPendingOperation(
              operationId,
              new Error(
                `Render ${operationId} did not settle within ${timeoutMs} ms after cancellation was requested`
              )
            );
            return;
          }
          this.markCancelRequested(operationId);
          try {
            SubtitleIPC.cancelPngRender(operationId);
          } catch {
            // ignore; best-effort cancellation
          }
          this.clearOperationTracking(operationId);
          this.rejectPendingOperation(
            operationId,
            new Error(
              `Render ${operationId} stalled or timed out after ${timeoutMs} ms`
            )
          );
        }, delayMs);
      };

      arm();

      this.renderPromises.set(operationId, {
        resolve: result => {
          clearTimeout(timer);
          if (offProgress) offProgress();
          this.clearOperationTracking(operationId);
          resolve(result);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          if (offProgress) offProgress();
          this.clearOperationTracking(operationId);
          reject(error);
        },
      });

      offProgress = SubtitleIPC.onMergeProgress(
        (p: { operationId: string; [key: string]: any }) => {
          if (p.operationId !== operationId) return;
          if (!this.isCurrentMergeOperation(operationId)) return;

          arm();
          const { percent = 0, stage = '' } = p ?? {};
          useTaskStore.getState().setMerge({ percent, stage });
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
        this.clearOperationTracking(operationId);
        this.renderPromises.delete(operationId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async cancelMerge(operationId: string): Promise<RenderCancelRequestResult> {
    if (this.cancelRequestedOperations.has(operationId)) {
      const status = await this.getOperationStatus(operationId);
      if (status == null) {
        return {
          accepted: false,
          reason: 'cancel_pending',
        };
      }
      if (status?.active) {
        return {
          accepted: false,
          reason: 'cancel_pending',
        };
      }
      if (status && !status.active) {
        this.clearOperationTracking(operationId);
      }
      return {
        accepted: false,
        reason: 'not_found',
      };
    }
    const result = await SubtitleIPC.requestPngRenderCancel(operationId);
    if (!result.accepted) {
      return result;
    }
    this.markCancelRequested(operationId);
    return result;
  }
}

const subtitleRendererClient = new SubtitleRendererClient();
export default subtitleRendererClient;
