import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

/** Stream a pinned archive to a private staging path before allowing extraction. */
export async function downloadVerifiedBrowserArchive({
  url,
  destination,
  sha256,
  size,
  fetchArchive = fetch,
  onProgress,
  idleTimeoutMs = 30_000,
}: {
  url: string;
  destination: string;
  sha256: string;
  size: number;
  fetchArchive?: (url: string, init?: RequestInit) => Promise<Response>;
  onProgress: (bytes: number, total: number) => void;
  idleTimeoutMs?: number;
}): Promise<void> {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout>;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
    idleTimer.unref?.();
  };
  const deadline = setTimeout(() => controller.abort(), 30 * 60_000);
  deadline.unref?.();
  resetIdleTimer();
  let file: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const response = await fetchArchive(url, { signal: controller.signal });
    if (response.status !== 200 || !response.body) {
      throw new Error(
        `Video export tools download failed (${response.status})`
      );
    }
    file = await fs.open(destination, 'wx');
    const reader = response.body.getReader();
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdleTimer();
        bytes += value.byteLength;
        if (bytes > size)
          throw new Error('Video export tools archive exceeds its pinned size');
        hash.update(value);
        await file.writeFile(value);
        onProgress(bytes, size);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (bytes !== size || hash.digest('hex') !== sha256) {
      throw new Error('Video export tools archive checksum did not match');
    }
  } finally {
    clearTimeout(idleTimer!);
    clearTimeout(deadline);
    controller.abort();
    await file?.close();
  }
}
