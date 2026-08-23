import path from 'node:path';
import { app } from 'electron';
import { settingsStore } from '../store/settings-store.js';
import {
  canonicalizeAgentOutputPath,
  isCanonicalPathInsideAllowedDirectories,
} from './path-containment.js';

/**
 * Re-authorizes an agent-selected output at the main-process write boundary.
 * Normal user-selected save dialogs do not use this gate.
 */
export function assertAgentOutputPathAuthorized(
  outputPath: string,
  outputKind: string
): string {
  if (!path.isAbsolute(outputPath)) {
    throw new Error(`${outputKind} path must be absolute.`);
  }

  if (!app.isPackaged) {
    if (process.env.TRANSLATOR_AGENT_DEV !== '1') {
      throw new Error(
        `${outputKind} paths are available only in local agent development mode.`
      );
    }
    return path.resolve(outputPath);
  }

  if (settingsStore.get('agentControlEnabled', false) !== true) {
    throw new Error(
      `${outputKind} paths require agent control to be enabled in Settings.`
    );
  }

  const configuredAllowedDirs = settingsStore.get(
    'agentAllowedDirectories',
    []
  );
  const allowedDirs =
    Array.isArray(configuredAllowedDirs) && configuredAllowedDirs.length > 0
      ? configuredAllowedDirs
      : [
          app.getPath('downloads'),
          path.join(app.getPath('userData'), 'url-downloads'),
        ];
  const canonicalOutputPath = canonicalizeAgentOutputPath(outputPath);
  if (
    !canonicalOutputPath ||
    !isCanonicalPathInsideAllowedDirectories(canonicalOutputPath, allowedDirs)
  ) {
    throw new Error(
      `${outputKind} directory is not in the agent allowed directories list. Configure allowed directories in Settings → Agent Control.`
    );
  }
  return canonicalOutputPath;
}
