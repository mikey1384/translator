import fs from 'fs';

/**
 * Create a file read stream that will be force-closed when `signal` aborts.
 *
 * Why: when we abort an HTTP upload mid-flight, Node streams can keep the
 * underlying fd open. If we then delete the temp file on a FUSE filesystem,
 * it can be renamed to `.fuse_hidden*` and linger, consuming disk.
 */
export function createAbortableReadStream(
  filePath: string,
  signal?: AbortSignal
): { stream: fs.ReadStream; cleanup: () => void } {
  const stream = fs.createReadStream(filePath);

  const onAbort = () => {
    try {
      stream.destroy(new Error('Aborted'));
    } catch {
      // ignore
    }
  };

  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const cleanup = () => {
    try {
      signal?.removeEventListener('abort', onAbort);
    } catch {
      // ignore
    }
  };

  stream.once('close', cleanup);
  stream.once('error', cleanup);

  return { stream, cleanup };
}
