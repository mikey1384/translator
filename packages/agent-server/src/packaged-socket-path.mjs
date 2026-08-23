import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { isPackagedSocketDiscovery } from './packaged-agent-protocol.mjs';

const APP_DIRECTORY_NAMES = ['Translator', 'translator'];

/**
 * Finds the app-published socket path without assuming filesystem case folding.
 * Electron/userData naming has used both the product and package-name casing
 * across builds, so both exact, bounded candidates are part of the contract.
 */
export function getPackagedSocketPathCandidates({
  platformName = platform(),
  homeDirectory = homedir(),
  appDataDirectory = process.env.APPDATA || '',
  configDirectory = process.env.XDG_CONFIG_HOME || '',
  exists = existsSync,
  readFile = filePath => readFileSync(filePath, 'utf8'),
} = {}) {
  return getPackagedSocketDiscoveryCandidates({
    platformName,
    homeDirectory,
    appDataDirectory,
    configDirectory,
    exists,
    readFile,
  }).map(candidate => candidate.socketPath);
}

export function getPackagedSocketDiscoveryCandidates({
  platformName = platform(),
  homeDirectory = homedir(),
  appDataDirectory = process.env.APPDATA || '',
  configDirectory = process.env.XDG_CONFIG_HOME || '',
  exists = existsSync,
  readFile = filePath => readFileSync(filePath, 'utf8'),
} = {}) {
  let appDataRoot;
  if (platformName === 'darwin') {
    appDataRoot = path.join(homeDirectory, 'Library', 'Application Support');
  } else if (platformName === 'win32') {
    appDataRoot =
      appDataDirectory || path.join(homeDirectory, 'AppData', 'Roaming');
  } else if (platformName === 'linux') {
    appDataRoot = configDirectory || path.join(homeDirectory, '.config');
  } else {
    throw new Error(`Unsupported platform: ${platformName}`);
  }

  const userDataCandidates = APP_DIRECTORY_NAMES.map(name =>
    path.join(appDataRoot, name)
  );
  const candidates = [];
  const addCandidate = candidate => {
    if (
      candidate?.socketPath &&
      !candidates.some(
        existing =>
          existing.socketPath === candidate.socketPath &&
          existing.instanceToken === candidate.instanceToken
      )
    ) {
      candidates.push(candidate);
    }
  };

  for (const userDataPath of userDataCandidates) {
    const socketInfoPath = path.join(userDataPath, 'agent', 'socket-path.txt');
    try {
      if (!exists(socketInfoPath)) continue;
      const published = String(readFile(socketInfoPath)).trim();
      try {
        const discovery = JSON.parse(published);
        if (isPackagedSocketDiscovery(discovery)) addCandidate(discovery);
      } catch {
        // Plain paths identify legacy helpers but deliberately carry no lease
        // token. The caller can reject them without connecting to a new app.
        if (published && !published.startsWith('{')) {
          addCandidate({
            socketPath: published,
            protocolVersion: 1,
            instanceToken: null,
          });
        }
      }
    } catch {
      // Try the other exact application-directory spelling, then fallback.
    }
  }

  if (platformName === 'win32') {
    for (const userDataPath of userDataCandidates) {
      const sanitized = userDataPath.replace(/[^a-zA-Z0-9]/g, '_');
      addCandidate({
        socketPath: `\\\\.\\pipe\\translator-agent-${sanitized}`,
        protocolVersion: null,
        instanceToken: null,
      });
    }
    return candidates;
  }

  const socketCandidates = userDataCandidates.map(userDataPath =>
    path.join(userDataPath, 'agent', 'translator-agent.sock')
  );
  // Existing endpoints precede default fallbacks, but retain every bounded
  // candidate. A stale discovery file or stale Unix socket under one historic
  // app-name spelling must not mask a live endpoint under the other spelling.
  for (const candidate of socketCandidates) {
    if (exists(candidate)) {
      addCandidate({
        socketPath: candidate,
        protocolVersion: null,
        instanceToken: null,
      });
    }
  }
  for (const candidate of socketCandidates) {
    addCandidate({
      socketPath: candidate,
      protocolVersion: null,
      instanceToken: null,
    });
  }
  return candidates;
}

export function getPackagedSocketPath(options) {
  return getPackagedSocketPathCandidates(options)[0];
}
