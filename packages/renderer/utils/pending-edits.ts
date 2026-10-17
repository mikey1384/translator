// Text fields commit to the subtitle store on a short debounce. Anything that
// reads the store to save, export or close must flush those first, or the
// last few keystrokes are missing from the result.

type Flusher = () => void;

const flushers = new Set<Flusher>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A listener failure must not block edits.
    }
  }
}

/** Register while a field holds an uncommitted edit; call the result once committed. */
export function registerPendingEdit(flush: Flusher): () => void {
  const wasEmpty = flushers.size === 0;
  flushers.add(flush);
  if (wasEmpty) notify();
  return () => {
    if (flushers.delete(flush) && flushers.size === 0) notify();
  };
}

/** Commits every uncommitted field edit to the store, synchronously. */
export function flushPendingEdits(): void {
  for (const flush of [...flushers]) {
    try {
      flush();
    } catch (error) {
      console.error('[pending-edits] Failed to flush an edit:', error);
    }
  }
}

export function hasPendingEdits(): boolean {
  return flushers.size > 0;
}

export function subscribePendingEdits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
