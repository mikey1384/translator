import path from 'node:path';

export const RENDER_TEMP_DIR_PREFIX = 'subtitle-render-';
export const STALE_RENDER_TEMP_AGE_MS = 60 * 60 * 1000;

export type RenderTempSweepFs = {
  readdir: (dir: string) => Promise<string[]>;
  stat: (p: string) => Promise<{ isDirectory(): boolean; mtimeMs: number }>;
  rm: (p: string) => Promise<void>;
};

/**
 * Removes `subtitle-render-*` directories left behind by renders that never
 * reached their cleanup (crash, force quit, quit at the save dialog). Skips
 * directories a live render owns and anything touched within `maxAgeMs`.
 * Returns the removed paths.
 */
export async function sweepStaleRenderTempDirs({
  tempRoot,
  liveDirs,
  fs,
  now = Date.now(),
  maxAgeMs = STALE_RENDER_TEMP_AGE_MS,
}: {
  tempRoot: string;
  liveDirs: Iterable<string>;
  fs: RenderTempSweepFs;
  now?: number;
  maxAgeMs?: number;
}): Promise<string[]> {
  const live = new Set([...liveDirs].map(dir => path.resolve(dir)));
  let names: string[];
  try {
    names = await fs.readdir(tempRoot);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!name.startsWith(RENDER_TEMP_DIR_PREFIX)) continue;
    const full = path.resolve(tempRoot, name);
    if (live.has(full)) continue;
    try {
      const st = await fs.stat(full);
      if (!st.isDirectory()) continue;
      if (now - st.mtimeMs < maxAgeMs) continue;
      await fs.rm(full);
      removed.push(full);
    } catch {
      // Vanished or locked; try again next launch.
    }
  }
  return removed;
}
