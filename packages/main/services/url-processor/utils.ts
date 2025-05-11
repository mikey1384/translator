import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import log from 'electron-log';

const exists = (p: string) => {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

let cachedHint: string | null = null;

export function defaultBrowserHint(): string {
  if (cachedHint) return cachedHint;

  const home = os.homedir();

  const candidates: [string, string][] = [];

  switch (process.platform) {
    case 'darwin': {
      candidates.push(
        ['safari', path.join(home, 'Library', 'Safari', 'History.db')],
        [
          'chrome',
          path.join(
            home,
            'Library',
            'Application Support',
            'Google',
            'Chrome',
            'Default',
            'Cookies'
          ),
        ],
        [
          'firefox',
          path.join(
            home,
            'Library',
            'Application Support',
            'Firefox',
            'Profiles'
          ),
        ],
        [
          'edge',
          path.join(
            home,
            'Library',
            'Application Support',
            'Microsoft Edge',
            'Default',
            'Cookies'
          ),
        ]
      );
      break;
    }

    case 'win32': {
      const local =
        process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      const roaming =
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

      candidates.push(
        [
          'edge',
          path.join(
            local,
            'Microsoft',
            'Edge',
            'User Data',
            'Default',
            'Cookies'
          ),
        ],
        [
          'chrome',
          path.join(
            local,
            'Google',
            'Chrome',
            'User Data',
            'Default',
            'Cookies'
          ),
        ],
        ['firefox', path.join(roaming, 'Mozilla', 'Firefox', 'Profiles')]
      );
      break;
    }

    default: {
      candidates.push(
        [
          'chrome',
          path.join(home, '.config', 'google-chrome', 'Default', 'Cookies'),
        ],
        [
          'chromium',
          path.join(home, '.config', 'chromium', 'Default', 'Cookies'),
        ],
        ['firefox', path.join(home, '.mozilla', 'firefox')]
      );
    }
  }

  const hint =
    candidates.find(
      ([_, p]) =>
        exists(p) || (fs.existsSync(p) && fs.lstatSync(p).isDirectory())
    )?.[0] || 'chrome';

  cachedHint = hint;
  log.info(`[URLProcessor] Auto-detected browser for cookies: ${hint}`);
  return hint;
}
