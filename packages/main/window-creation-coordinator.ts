export interface WindowCreationCoordinatorOptions<T> {
  getCurrent: () => T | null;
  setCurrent: (window: T | null) => void;
  isDestroyed: (window: T) => boolean;
  create: () => Promise<T>;
}

/**
 * Serializes every request for the app's single main window.
 *
 * macOS can emit `activate` while the normal `whenReady` initialization is
 * still running. Without a shared in-flight promise, both paths can construct
 * a BrowserWindow and overwrite the singleton tab manager's window state.
 */
export function createWindowCreationCoordinator<T>(
  options: WindowCreationCoordinatorOptions<T>
) {
  let inFlight: Promise<T> | null = null;

  function ensure(): Promise<T> {
    // `create` may publish the native window before its shell and first tab
    // finish loading. Any request arriving in that interval must await the
    // complete initialization, not treat the allocated window as ready.
    if (inFlight) return inFlight;

    const current = options.getCurrent();
    if (current && !options.isDestroyed(current)) {
      return Promise.resolve(current);
    }

    // Defer the factory by one microtask so `inFlight` is installed before any
    // asynchronous creation work can yield back to a competing caller.
    const creation = Promise.resolve().then(options.create);
    const tracked = creation.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  }

  function clearIfCurrent(closedWindow: T): boolean {
    if (options.getCurrent() !== closedWindow) return false;
    options.setCurrent(null);
    return true;
  }

  function isCreating(): boolean {
    return inFlight !== null;
  }

  return { ensure, clearIfCurrent, isCreating };
}
