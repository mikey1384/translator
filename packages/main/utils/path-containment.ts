import fs from 'node:fs';
import path from 'node:path';

type Realpath = (targetPath: string) => string;

/**
 * Resolves an existing target, or the existing parent of a not-yet-created
 * file. Missing parents and resolution failures are rejected instead of
 * falling back to a symlink-vulnerable lexical path.
 */
export function canonicalizeAgentOutputPath(
  targetPath: string,
  realpath: Realpath = fs.realpathSync
): string | null {
  const resolved = path.resolve(targetPath);
  try {
    return realpath(resolved);
  } catch {
    try {
      // An existing path that realpath cannot resolve is not a new output.
      // In particular, treating a dangling symlink as a missing file would
      // let the eventual write follow that link beyond the allowlist.
      fs.lstatSync(resolved);
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') return null;
    }

    try {
      const canonicalParent = realpath(path.dirname(resolved));
      return path.join(canonicalParent, path.basename(resolved));
    } catch {
      return null;
    }
  }
}

export function isPathInsideAllowedDirectories(
  targetPath: string,
  allowedDirectories: readonly unknown[],
  realpath: Realpath = fs.realpathSync
): boolean {
  const canonicalTarget = canonicalizeAgentOutputPath(targetPath, realpath);
  if (!canonicalTarget) return false;

  return isCanonicalPathInsideAllowedDirectories(
    canonicalTarget,
    allowedDirectories,
    realpath
  );
}

export function isCanonicalPathInsideAllowedDirectories(
  canonicalTarget: string,
  allowedDirectories: readonly unknown[],
  realpath: Realpath = fs.realpathSync
): boolean {
  if (!path.isAbsolute(canonicalTarget)) return false;

  return allowedDirectories.some(directory => {
    if (typeof directory !== 'string' || !directory.trim()) return false;
    let canonicalDirectory: string;
    try {
      canonicalDirectory = realpath(path.resolve(directory));
      if (!fs.statSync(canonicalDirectory).isDirectory()) return false;
    } catch {
      return false;
    }

    const relative = path.relative(canonicalDirectory, canonicalTarget);
    return (
      relative === '' ||
      (relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  });
}
