import { ChildProcess } from 'child_process';
import { execa } from 'execa';
import log from 'electron-log';
import type { WebContents } from 'electron';
import { app } from 'electron';
import { forceKillWindows } from './utils/process-killer.js';
import { attachAutoCancelListeners } from './utils/auto-cancel-listeners.js';
import { consumeCancelMarker, markCancelled } from './utils/cancel-markers.js';

export { consumeCancelMarker } from './utils/cancel-markers.js';

export type DownloadProcess = ReturnType<typeof execa>;
export type RenderJob = {
  processes: ChildProcess[];
  browser?: { close: () => Promise<void> };
};
export type SubtitleJob = AbortController;

type RegistryEntryBase = {
  autoCancelCleanup?: () => void;
};

type RegistryEntry =
  | (RegistryEntryBase & {
      kind: 'download';
      handle: DownloadProcess;
      cancel?: () => void;
    })
  | (RegistryEntryBase & { kind: 'subtitle'; handle: SubtitleJob })
  | (RegistryEntryBase & { kind: 'render'; handle: RenderJob })
  | (RegistryEntryBase & {
      kind: 'generic';
      wc: WebContents;
      cancel: () => void;
    });

const registry = new Map<string, RegistryEntry>();

function cleanupAutoCancel(entry: RegistryEntry | undefined): void {
  if (!entry?.autoCancelCleanup) return;
  try {
    entry.autoCancelCleanup();
  } catch (error) {
    log.warn('[registry] Failed to remove auto-cancel listeners:', error);
  } finally {
    entry.autoCancelCleanup = undefined;
  }
}

function deleteRegistryEntry(id: string): boolean {
  const entry = registry.get(id);
  if (!entry) return false;
  cleanupAutoCancel(entry);
  return registry.delete(id);
}

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
        autoCancelCleanup: existing.autoCancelCleanup,
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
  const existing = registry.get(id);
  log.info(`[registry] add subtitle ${id}`);
  registry.set(id, {
    kind: 'subtitle',
    handle: job,
    autoCancelCleanup: existing?.autoCancelCleanup,
  });
}

export function registerRenderJob(id: string, job: RenderJob) {
  const existing = registry.get(id);

  if (existing && existing.kind !== 'render') {
    if (existing.kind === 'generic') {
      registry.set(id, {
        kind: 'render',
        handle: job,
        autoCancelCleanup: existing.autoCancelCleanup,
      });
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
  return deleteRegistryEntry(id);
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

  cleanupAutoCancel(existing);

  if (existing?.kind === 'generic') {
    existing.cancel = cancel;
    existing.wc = wc;
    log.info(
      `[registry] Updated cancel function for existing operation ${operationId}`
    );
  } else if (!existing) {
    registry.set(operationId, { kind: 'generic', wc, cancel });
    log.info(`[registry] Registered new generic operation ${operationId}`);
  }

  const autoCancelCleanup = attachAutoCancelListeners(
    wc as any,
    operationId,
    () => {
      void cancelSafely(operationId).catch(error => {
        log.error(
          `[registry] Auto-cancel failed for operation ${operationId}:`,
          error
        );
      });
    },
    log
  );

  const updatedEntry = registry.get(operationId);
  if (updatedEntry) {
    updatedEntry.autoCancelCleanup = autoCancelCleanup;
  }
}

export async function cancel(id: string): Promise<boolean> {
  return cancelSafely(id);
}

export async function cancelSafely(id: string): Promise<boolean> {
  // Record user intent to cancel even when the process handle is between retries
  // and temporarily absent from the registry.
  markCancelled(id);

  const entry = registry.get(id);
  if (!entry) {
    log.info(
      `[registry] Recorded cancellation marker for ${id} without active handle`
    );
    return true;
  }

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
            // Non-Windows: try to kill the whole process group first (covers yt-dlp → ffmpeg),
            // then fall back to the direct handle kill.
            if (entry.handle.pid) {
              try {
                process.kill(-entry.handle.pid, sig);
              } catch {
                // ignore; fall back to direct kill
              }
            }
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
    deleteRegistryEntry(id);
  }
  return true;
}

if (app?.on) {
  app.on('before-quit', () => {
    for (const id of registry.keys()) {
      cancelSafely(id);
    }
  });
}
