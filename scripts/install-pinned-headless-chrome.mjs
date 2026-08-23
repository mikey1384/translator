import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Browser,
  BrowserPlatform,
  computeExecutablePath,
  install,
} from '@puppeteer/browsers';
import { resolvePuppeteerHeadlessRevision } from './resolve-puppeteer-headless-revision.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const targetDefinitions = new Map([
  [
    'mac_arm',
    {
      platform: BrowserPlatform.MAC_ARM,
      cacheDir: path.join(repoRoot, 'vendor', 'headless-arm64'),
    },
  ],
  [
    'mac',
    {
      platform: BrowserPlatform.MAC,
      cacheDir: path.join(repoRoot, 'vendor', 'headless-x64'),
    },
  ],
  [
    'win64',
    {
      platform: BrowserPlatform.WIN64,
      cacheDir: path.join(repoRoot, 'vendor', 'headless-x64'),
    },
  ],
]);

export function requiresExecutablePermission(platform) {
  return (
    platform !== BrowserPlatform.WIN32 && platform !== BrowserPlatform.WIN64
  );
}

async function validateExecutable(executablePath, platform) {
  const stat = await fs.stat(executablePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Headless Chrome executable is invalid: ${executablePath}`);
  }
  // Validate the downloaded artifact, not the machine doing the download.
  // Windows PE files do not carry a Unix executable bit when fetched on a
  // Mac/Linux release host, while Unix targets must remain executable.
  if (requiresExecutablePermission(platform)) {
    await fs.access(executablePath, fsConstants.X_OK);
  }
}

export async function installPinnedHeadlessChrome(targetNames) {
  if (!Array.isArray(targetNames) || targetNames.length === 0) {
    throw new Error(
      'Usage: node scripts/install-pinned-headless-chrome.mjs <mac_arm|mac|win64> [...]'
    );
  }

  const uniqueTargets = new Set(targetNames);
  if (uniqueTargets.size !== targetNames.length) {
    throw new Error('Headless Chrome install targets must be unique.');
  }

  const targets = targetNames.map(targetName => {
    const target = targetDefinitions.get(targetName);
    if (!target) {
      throw new Error(`Unsupported headless Chrome target: ${targetName}`);
    }
    return { targetName, ...target };
  });
  const uniqueCacheDirs = new Set(targets.map(target => target.cacheDir));
  if (uniqueCacheDirs.size !== targets.length) {
    throw new Error(
      'Headless Chrome install targets cannot share an output directory.'
    );
  }

  const buildId = resolvePuppeteerHeadlessRevision();
  for (const target of targets) {
    await fs.rm(target.cacheDir, { recursive: true, force: true });
    const installedBrowser = await install({
      browser: Browser.CHROMEHEADLESSSHELL,
      buildId,
      cacheDir: target.cacheDir,
      platform: target.platform,
    });
    const expectedExecutable = computeExecutablePath({
      browser: Browser.CHROMEHEADLESSSHELL,
      buildId,
      cacheDir: target.cacheDir,
      platform: target.platform,
    });

    if (
      path.resolve(installedBrowser.executablePath) !==
      path.resolve(expectedExecutable)
    ) {
      throw new Error(
        `Headless Chrome installed at an unexpected path: ${installedBrowser.executablePath}`
      );
    }

    await validateExecutable(expectedExecutable, target.platform);
    console.log(
      `Installed chrome-headless-shell@${buildId} for ${target.targetName}: ${expectedExecutable}`
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  installPinnedHeadlessChrome(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
