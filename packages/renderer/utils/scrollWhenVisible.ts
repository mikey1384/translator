interface ScrollWhenVisibleDeps {
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
  now: () => number;
}

const browserDeps = (): ScrollWhenVisibleDeps => ({
  requestFrame: cb => window.requestAnimationFrame(() => cb()),
  cancelFrame: id => window.cancelAnimationFrame(id),
  now: () => performance.now(),
});

/**
 * Scrolls an element into view as soon as it has a layout box. A panel that
 * is mounted while its screen is still hidden (display: none) can't be
 * scrolled to yet, so this keeps checking every frame for up to `timeoutMs`
 * of wall-clock time (a frame count would expire much sooner on a 120 Hz
 * display). Returns a cancel function.
 */
export function scrollIntoViewWhenVisible(
  getElement: () => Element | null,
  {
    timeoutMs = 4000,
    block = 'start',
    deps = browserDeps(),
  }: {
    timeoutMs?: number;
    block?: ScrollLogicalPosition;
    deps?: ScrollWhenVisibleDeps;
  } = {}
): () => void {
  const startedAt = deps.now();
  let frame: number | null = null;
  let cancelled = false;
  const attempt = () => {
    frame = null;
    if (cancelled) return;
    const element = getElement();
    if (element && element.getClientRects().length > 0) {
      element.scrollIntoView({ block });
      return;
    }
    if (deps.now() - startedAt < timeoutMs) {
      frame = deps.requestFrame(attempt);
    }
  };
  frame = deps.requestFrame(attempt);
  return () => {
    cancelled = true;
    if (frame != null) deps.cancelFrame(frame);
  };
}
