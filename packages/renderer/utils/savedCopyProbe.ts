// Pure helpers for re-pointing the mounted video at a saved copy.

export function pathsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }

  const normalize = (value: string) =>
    value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

  return normalize(a) === normalize(b);
}

/**
 * "Save As" re-points the mounted video at the saved copy. It is the same
 * bytes, so the probe result for the old path carries over. Without this the
 * workspace waits for a probe of the new path that nothing starts (the
 * player's loadedmetadata may or may not fire again), "Reading the file…"
 * stays up and the download handoff card disappears. A probe still in flight
 * for the old path is discarded when the path changes, so ask for one.
 */
export function carryProbeToSavedCopy(
  state: {
    activeTrack: 'original' | 'dubbed';
    metaPath: string | null;
    metaError: { path: string; code: string } | null;
  },
  previousPath: string,
  savedPath: string
): {
  metaPath: string | null;
  metaError: { path: string; code: string } | null;
  needsProbe: boolean;
} {
  if (state.activeTrack !== 'original') {
    return {
      metaPath: state.metaPath,
      metaError: state.metaError,
      needsProbe: false,
    };
  }
  const metaPath = pathsMatch(state.metaPath, previousPath)
    ? savedPath
    : state.metaPath;
  const metaError =
    state.metaError && pathsMatch(state.metaError.path, previousPath)
      ? { ...state.metaError, path: savedPath }
      : state.metaError;
  return {
    metaPath,
    metaError,
    needsProbe: metaPath !== savedPath && metaError?.path !== savedPath,
  };
}
