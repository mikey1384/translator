import { ChildProcess } from 'child_process';
import { execa } from 'execa';
import log from 'electron-log';
import type { WebContents } from 'electron';
import { app } from 'electron';
import { forceKillWindows } from './utils/process-killer.js';

export type DownloadProcess = ReturnType<typeof execa>;
export type RenderJob = {
  processes: ChildProcess[];
  browser?: { close: () => Promise<void> };
};
export type SubtitleJob = AbortController;

type RegistryEntry =
  | { kind: 'download'; handle: DownloadProcess; cancel?: () => void }
  | { kind: 'subtitle'; handle: SubtitleJob }
  | { kind: 'render'; handle: RenderJob }
  | { kind: 'generic'; wc: WebContents; cancel: () => void };

const registry = new Map<string, RegistryEntry>();

export async function registerDownloadProcess(
  id: string,
  proc: DownloadProcess
) {
  const existing = registry.get(id);

  if (existing && existing.kind !== 'download') {
    if (existing.kind === 'generic') {
      registry.set(id, {
        kind: 'download',
        handle: proc,
        cancel: existing.cancel,
      });
      log.info(`[registry] Promoted generic entry to download process ${id}`);
      return;
    } else {
      log.warn(`[registry] ID ${id} already used for a ${existing.kind} job`);
      return;
    }
  }

  if (existing?.kind === 'download') {
    if (existing.handle !== proc) {
      existing.handle = proc;
      log.info(`[registry] Updated handle for existing download process ${id}`);
    }
    return;
  }

  log.info(`[registry] register download process ${id}`);
  registry.set(id, { kind: 'download', handle: proc });
}

export function addSubtitle(id: string, job: SubtitleJob) {
  log.info(`[registry] add subtitle ${id}`);
  registry.set(id, { kind: 'subtitle', handle: job });
}

export function registerRenderJob(id: string, job: RenderJob) {
  const existing = registry.get(id);

  if (existing && existing.kind !== 'render') {
    if (existing.kind === 'generic') {
      registry.set(id, { kind: 'render', handle: job });
      log.info(`[registry] Promoted generic entry to render job ${id}`);
    } else {
      log.warn(`[registry] ID ${id} already used for a ${existing.kind} job`);
    }
    return;
  }

  if (existing?.kind === 'render') {
    existing.handle = job;
    return;
  }

  log.info(`[registry] register render job ${id}`);
  registry.set(id, { kind: 'render', handle: job });
}

export function finish(id: string): boolean {
  return registry.delete(id);
}

export function hasProcess(id: string): boolean {
  return registry.has(id);
}

export function registerAutoCancel(
  operationId: string,
  wc: WebContents,
  cancel: () => void
) {
  const existing = registry.get(operationId);

  if (existing?.kind === 'generic') {
    existing.cancel = cancel;
    log.info(
      `[registry] Updated cancel function for existing operation ${operationId}`
    );
  } else if (!existing) {
    registry.set(operationId, { kind: 'generic', wc, cancel });
    log.info(`[registry] Registered new generic operation ${operationId}`);
  }

  const cancelOnce = () => {
    cancelSafely(operationId);
  };
  wc.once('destroyed', cancelOnce);
  wc.once('render-process-gone', cancelOnce);
  wc.once('will-navigate', cancelOnce);
  wc.once(
    'did-start-navigation' as any,
    (
      _e: unknown,
      _url: unknown,
      _isInPlace: unknown,
      _isMainFrame: unknown,
      _frameId: unknown,
      _parentFrameId: unknown,
      details: unknown
    ) => {
      if ((details as any)?.isReload) {
        log.info(
          `[registry] Cancelling due to reload for operation ${operationId}`
        );
        cancelOnce();
      }
    }
  );
}

export async function cancel(id: string): Promise<boolean> {
  return cancelSafely(id);
}

export async function cancelSafely(id: string): Promise<boolean> {
  const entry = registry.get(id);
  if (!entry) return false;

  const sig = process.platform === 'win32' ? 'SIGINT' : 'SIGTERM';

  try {
    switch (entry.kind) {
      case 'subtitle':
        entry.handle.abort();
        break;
      case 'download':
        if (!entry.handle.killed) {
          if (process.platform === 'win32' && entry.handle.pid) {
            // On Windows, use taskkill for reliable termination of yt-dlp
            log.info(
              `[registry] Force-killing Windows process tree for ${id}, PID: ${entry.handle.pid}`
            );
            const killed = await forceKillWindows({
              pid: entry.handle.pid,
              logPrefix: `registry-download-${id}`,
            });
            if (killed) {
              // Mark the process as killed to help with error handling
              try {
                entry.handle.kill('SIGTERM');
              } catch {
                // Ignore errors since taskkill already terminated it
              }
            } else {
              // Fallback to signal if taskkill fails
              log.warn(
                `[registry] taskkill failed for ${id}, trying SIGTERM fallback`
              );
              entry.handle.kill('SIGTERM');
            }
          } else {
            // Non-Windows: use regular SIGTERM
            entry.handle.kill(sig);
          }
        }
        break;
      case 'render':
        // Terminate child processes (FFmpeg, etc.) with Windows-specific handling
        for (const p of entry.handle.processes) {
          if (!p.killed) {
            if (process.platform === 'win32' && p.pid) {
              // On Windows, use taskkill for reliable termination of FFmpeg processes
              log.info(
                `[registry] Force-killing Windows render process PID: ${p.pid} for ${id}`
              );
              const killed = await forceKillWindows({
                pid: p.pid,
                logPrefix: `registry-render-${id}`,
              });
              if (!killed) {
                // Fallback to signal if taskkill fails
                log.warn(
                  `[registry] taskkill failed for render process ${id}, trying SIGTERM fallback`
                );
                try {
                  p.kill('SIGTERM');
                } catch {
                  // Ignore errors since process might already be dead
                }
              }
            } else {
              // Non-Windows: use regular signal
              p.kill(sig);
            }
          }
        }
        // Close Puppeteer browser (this handles browser process termination properly)
        await entry.handle.browser?.close().catch(() => {});
        break;
      case 'generic':
        entry.cancel();
        break;
    }
  } finally {
    registry.delete(id);
  }
  return true;
}

app.on('before-quit', () => {
  for (const id of registry.keys()) {
    cancelSafely(id);
  }
});
