import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import log from 'electron-log';

export type CookieBrowser =
  | 'safari'
  | 'chrome'
  | 'firefox'
  | 'edge'
  | 'chromium';

function normalizeBrowser(browser: string): CookieBrowser | null {
  const key = browser?.toLowerCase?.();
  switch (key) {
    case 'safari':
    case 'chrome':
    case 'firefox':
    case 'edge':
    case 'chromium':
      return key;
    default:
      return null;
  }
}

const exists = (p: string) => {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    try {
      const stat = fs.lstatSync(p);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
};

function candidateOrder(): CookieBrowser[] {
  switch (process.platform) {
    case 'darwin':
      return ['safari', 'chrome', 'firefox', 'edge'];
    case 'win32':
      return ['edge', 'chrome', 'firefox'];
    default:
      return ['chrome', 'chromium', 'firefox'];
  }
}

function pathCandidates(browser: CookieBrowser): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin': {
      if (browser === 'safari') {
        return [path.join(home, 'Library', 'Safari', 'History.db')];
      }
      if (browser === 'chrome') {
        return [
          path.join(
            home,
            'Library',
            'Application Support',
            'Google',
            'Chrome',
            'Default',
            'Cookies'
          ),
        ];
      }
      if (browser === 'firefox') {
        return [
          path.join(
            home,
            'Library',
            'Application Support',
            'Firefox',
            'Profiles'
          ),
        ];
      }
      if (browser === 'edge') {
        return [
          path.join(
            home,
            'Library',
            'Application Support',
            'Microsoft Edge',
            'Default',
            'Cookies'
          ),
        ];
      }
      if (browser === 'chromium') {
        return [
          path.join(
            home,
            'Library',
            'Application Support',
            'Chromium',
            'Default',
            'Cookies'
          ),
        ];
      }
      break;
    }
    case 'win32': {
      const local =
        process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      const roaming =
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      if (browser === 'edge') {
        return [
          path.join(
            local,
            'Microsoft',
            'Edge',
            'User Data',
            'Default',
            'Cookies'
          ),
        ];
      }
      if (browser === 'chrome') {
        return [
          path.join(
            local,
            'Google',
            'Chrome',
            'User Data',
            'Default',
            'Cookies'
          ),
        ];
      }
      if (browser === 'firefox') {
        return [path.join(roaming, 'Mozilla', 'Firefox', 'Profiles')];
      }
      if (browser === 'chromium') {
        return [
          path.join(local, 'Chromium', 'User Data', 'Default', 'Cookies'),
        ];
      }
      break;
    }
    default: {
      if (browser === 'chrome') {
        return [
          path.join(home, '.config', 'google-chrome', 'Default', 'Cookies'),
        ];
      }
      if (browser === 'chromium') {
        return [
          path.join(home, '.config', 'chromium', 'Default', 'Cookies'),
          path.join(home, '.config', 'chromium-browser', 'Default', 'Cookies'),
        ];
      }
      if (browser === 'firefox') {
        return [path.join(home, '.mozilla', 'firefox')];
      }
      if (browser === 'edge') {
        return [
          path.join(home, '.config', 'microsoft-edge', 'Default', 'Cookies'),
        ];
      }
      if (browser === 'safari') {
        return [path.join(home, '.config', 'safari')];
      }
    }
  }
  return [];
}

export function resolveBrowserCookiesPath(browser: string): string | null {
  const normalized = normalizeBrowser(browser);
  if (!normalized) return null;
  const candidates = pathCandidates(normalized);
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function browserCookiesAvailable(browser: string): boolean {
  return resolveBrowserCookiesPath(browser) !== null;
}

let cachedHint: string | null = null;

export function defaultBrowserHint(): string {
  if (cachedHint) return cachedHint;

  const order = candidateOrder();
  const hint = order.find(browserCookiesAvailable) || 'chrome';
  cachedHint = hint;
  log.info(`[URLProcessor] Auto-detected browser for cookies: ${hint}`);
  return hint;
}
