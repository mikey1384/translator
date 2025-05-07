import { ChildProcess } from 'child_process';
import { execa } from 'execa';
import log from 'electron-log'; // Import log

export type DownloadProcess = ReturnType<typeof execa>;
export type RenderJob = {
  processes: ChildProcess[]; // ffmpeg, etc.
  browser?: { close: () => Promise<void> };
};
export type SubtitleJob = AbortController;

type RegistryEntry =
  | { kind: 'download'; handle: DownloadProcess }
  | { kind: 'subtitle'; handle: SubtitleJob }
  | { kind: 'render'; handle: RenderJob };

const registry = new Map<string, RegistryEntry>();

/**
 * Add a download process to the registry.
 * @param id - The unique identifier for the download process.
 * @param proc - The download process handle.
 */
export function addDownload(id: string, proc: DownloadProcess) {
  log.info(`[registry] add download ${id}`);
  registry.set(id, { kind: 'download', handle: proc });
}

/**
 * Add a subtitle job to the registry.
 * @param id - The unique identifier for the subtitle job.
 * @param ctrl - The subtitle job controller.
 */
export function addSubtitle(id: string, ctrl: SubtitleJob) {
  log.info(`[registry] add subtitle ${id}`);
  registry.set(id, { kind: 'subtitle', handle: ctrl });
}

/**
 * Add a render job to the registry.
 * @param id - The unique identifier for the render job.
 * @param job - The render job details.
 */
export function addRender(id: string, job: RenderJob) {
  log.info(`[registry] add render ${id}`);
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

export async function cancel(id: string): Promise<boolean> {
  const entry = registry.get(id);
  if (!entry) return false;
  const sig = process.platform === 'win32' ? 'SIGINT' : 'SIGTERM';
  switch (entry.kind) {
    case 'subtitle':
      entry.handle.abort();
      break;
    case 'download':
      if (!entry.handle.killed) entry.handle.kill(sig);
      break;
    case 'render':
      entry.handle.processes.forEach(proc => {
        try {
          proc.kill(sig);
        } catch (e) {
          log.error(`[registry] error killing process for ${id}:`, e);
        }
      });
      if (entry.handle.browser) {
        await entry.handle.browser
          .close()
          .catch(err =>
            log.error(`[registry] error closing browser for ${id}:`, err)
          );
      }
      break;
  }
  registry.delete(id);
  log.info(`[registry] cancelled ${entry.kind} ${id}`);
  return true;
}
