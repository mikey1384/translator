import path from 'node:path';
import {
  Browser,
  computeExecutablePath,
  detectBrowserPlatform,
} from '@puppeteer/browsers';
import { app, net } from 'electron';
import log from 'electron-log';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/lib/puppeteer/revisions.js';
import manifest from './headless-chrome-manifest.json';
import {
  createHeadlessChromeRuntime,
  isHeadlessChromeBinaryValid,
  type HeadlessChromeRequest,
} from './headless-chrome-runtime.js';

export type { HeadlessChromeProgress } from './headless-chrome-runtime.js';

const HEADLESS_CHROME_BUILD_ID = PUPPETEER_REVISIONS['chrome-headless-shell'];
let runtime: ReturnType<typeof createHeadlessChromeRuntime> | undefined;

function getRuntime() {
  if (runtime) return runtime;
  if (manifest.buildId !== HEADLESS_CHROME_BUILD_ID) {
    throw new Error(
      'Video export tools manifest does not match the installed Puppeteer version'
    );
  }
  const platform = detectBrowserPlatform();
  const artifact =
    platform && manifest.archives[platform as keyof typeof manifest.archives];
  if (!platform || !artifact) {
    throw new Error(
      `Video export tools are not available for ${process.platform}/${process.arch}`
    );
  }
  runtime = createHeadlessChromeRuntime({
    cacheDir: path.join(
      app.getPath('userData'),
      'bin',
      `headless-${process.arch}`
    ),
    platform,
    buildId: HEADLESS_CHROME_BUILD_ID,
    baseUrl: manifest.baseUrl,
    sha256: artifact.sha256,
    size: artifact.size,
    logger: log,
    fetchArchive: net.fetch.bind(net),
  });
  return runtime;
}

export async function ensureHeadlessChrome(
  request?: HeadlessChromeRequest
): Promise<string> {
  return getRuntime().ensure(request);
}

export async function getHeadlessChromePath(
  request?: HeadlessChromeRequest
): Promise<string> {
  if (!app.isPackaged) return '';
  request?.signal?.throwIfAborted();
  // Continue to accept the signed, pinned payload in older packaged builds.
  const platform = detectBrowserPlatform();
  if (platform) {
    const executablePath = computeExecutablePath({
      browser: Browser.CHROMEHEADLESSSHELL,
      buildId: HEADLESS_CHROME_BUILD_ID,
      cacheDir: path.join(process.resourcesPath, `headless-${process.arch}`),
      platform,
    });
    if (await isHeadlessChromeBinaryValid(executablePath, platform))
      return executablePath;
  }
  try {
    return await ensureHeadlessChrome(request);
  } catch (error) {
    if (request?.signal?.aborted) throw error;
    log.warn('[HeadlessChrome] Video export tools preparation failed:', error);
    // A full disk needs different advice than a network failure.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOSPC') throw error;
    throw new Error(
      'Video export tools could not be downloaded. Check your connection and try exporting again.',
      { cause: error }
    );
  }
}

export function prefetchHeadlessChrome(): void {
  if (!app.isPackaged) return;
  void getHeadlessChromePath().catch(() => {
    log.info(
      '[HeadlessChrome] Background preparation deferred; the next export will retry.'
    );
  });
}
