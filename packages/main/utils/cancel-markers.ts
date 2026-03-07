const cancelMarkers = new Map<string, number>();
const CANCEL_MARKER_TTL_MS = 5 * 60 * 1000;

function pruneCancelMarkers(now: number): void {
  for (const [id, ts] of cancelMarkers) {
    if (now - ts > CANCEL_MARKER_TTL_MS) {
      cancelMarkers.delete(id);
    }
  }
}

export function markCancelled(id: string): void {
  const now = Date.now();
  pruneCancelMarkers(now);
  cancelMarkers.set(id, now);
}

export function consumeCancelMarker(id: string): boolean {
  const now = Date.now();
  pruneCancelMarkers(now);
  const had = cancelMarkers.has(id);
  if (had) cancelMarkers.delete(id);
  return had;
}
