import { ChildProcess } from 'child_process';
import { execa } from 'execa';
import log from 'electron-log';
import type { WebContents } from 'electron';
import { app } from 'electron';

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

/**
 * Add a download process to the registry.
 * @param id - The unique identifier for the download process.
 * @param proc - The download process to register.
 */
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

  // not tracked yet → add it
  log.info(`[registry] register download process ${id}`);
  registry.set(id, { kind: 'download', handle: proc });
}

/**
 * Add a subtitle job to the registry.
 * @param id - The unique identifier for the subtitle job.
 * @param job - The subtitle job to add.
 */
export function addSubtitle(id: string, job: SubtitleJob) {
  log.info(`[registry] add subtitle ${id}`);
  registry.set(id, { kind: 'subtitle', handle: job });
}

/**
 * Add a render job to the registry.
 * @param id - The unique identifier for the render job.
 * @param job - The render job to add.
 */
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
    existing.handle = job; // refresh handle
    return;
  }

  log.info(`[registry] register render job ${id}`);
  registry.set(id, { kind: 'render', handle: job });
}

/**
 * Remove a process from the registry.
 * @param id - The ID of the process to remove.
 * @returns True if the process was removed, false if it was not found.
 */
export function finish(id: string): boolean {
  return registry.delete(id);
}

/**
 * Check if a process with the given ID exists in the registry.
 * @param id - The ID of the process to check.
 * @returns True if the process exists in the registry, false otherwise.
 */
export function hasProcess(id: string): boolean {
  return registry.has(id);
}

/**
 * Attach WebContents listener so the job auto-cancels if that renderer dies
 * @param operationId - The unique identifier for the operation.
 * @param wc - The WebContents object to attach the listener to.
 * @param cancel - The function to call when the WebContents is destroyed.
 */
export function registerAutoCancel(
  operationId: string,
  wc: WebContents,
  cancel: () => void
) {
  const existing = registry.get(operationId);

  if (existing?.kind === 'generic') {
    existing.cancel = cancel; // refresh cancel function
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
        if (!entry.handle.killed) entry.handle.kill(sig);
        break;
      case 'render':
        entry.handle.processes.forEach(p => {
          if (!p.killed) p.kill(sig);
        });
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
