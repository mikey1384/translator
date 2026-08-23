import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/lib/puppeteer/revisions.js';

const packageRoot = path.resolve(import.meta.dirname, '..');

test('headless Chrome fallback uses the Puppeteer-pinned build without npx', () => {
  const source = fs.readFileSync(
    path.join(packageRoot, 'services/headless-chrome-installer.ts'),
    'utf8'
  );

  assert.match(
    PUPPETEER_REVISIONS['chrome-headless-shell'],
    /^[0-9A-Za-z._-]+$/
  );
  assert.match(source, /PUPPETEER_REVISIONS\['chrome-headless-shell'\]/);
  assert.match(source, /computeExecutablePath\(\{/);
  assert.match(source, /browser: Browser\.CHROMEHEADLESSSHELL/);
  assert.match(source, /buildId: HEADLESS_CHROME_BUILD_ID/);
  assert.match(source, /cacheDir: headlessDir/);
  assert.match(source, /waitForInstallLock\(\{/);
  assert.match(
    source,
    /const concurrentlyInstalled = await findPinnedExecutable/
  );
  assert.match(source, /new Cache\(headlessDir\)\.installationDir\(/);
  assert.match(
    source,
    /fs\.rm\(installationDir, \{ recursive: true, force: true \}\)/
  );
  assert.doesNotMatch(source, /startsWith\(versionDirPattern\)/);
  assert.doesNotMatch(source, /fallbackExecutable/);
  assert.doesNotMatch(source, /headless_shell(?:\.exe)?/);
  assert.doesNotMatch(source, /chrome-headless-shell@stable/);
  assert.doesNotMatch(source, /\bexeca\b/);
  assert.doesNotMatch(source, /['"]npx['"]/);
});
