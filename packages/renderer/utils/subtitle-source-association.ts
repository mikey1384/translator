type MountedSubtitleSourceState = {
  order: string[];
  sourceVideoPath?: string | null;
  sourceVideoAssetIdentity?: string | null;
};

function normalizeComparablePath(
  value: string | null | undefined
): string | null {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  return normalized || null;
}

function pathsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizeComparablePath(a);
  const right = normalizeComparablePath(b);
  return Boolean(left && right && left === right);
}

export function mountedSubtitleMatchesVideoSource(
  subtitleState: MountedSubtitleSourceState,
  args: {
    sourceVideoPath?: string | null;
    sourceVideoAssetIdentity?: string | null;
  }
): boolean {
  if (!Array.isArray(subtitleState.order) || subtitleState.order.length === 0) {
    return false;
  }

  if (
    args.sourceVideoAssetIdentity &&
    subtitleState.sourceVideoAssetIdentity === args.sourceVideoAssetIdentity
  ) {
    return true;
  }

  if (
    args.sourceVideoAssetIdentity &&
    subtitleState.sourceVideoAssetIdentity &&
    subtitleState.sourceVideoAssetIdentity !== args.sourceVideoAssetIdentity
  ) {
    return false;
  }

  if (
    args.sourceVideoPath &&
    pathsMatch(subtitleState.sourceVideoPath, args.sourceVideoPath)
  ) {
    return true;
  }

  return false;
}
