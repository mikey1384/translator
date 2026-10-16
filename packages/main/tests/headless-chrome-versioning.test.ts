import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Browser, BrowserPlatform, getDownloadUrl } from '@puppeteer/browsers';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/lib/puppeteer/revisions.js';

test('every shipped platform has a checksummed archive for the Puppeteer-pinned revision', () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        '../services/headless-chrome-manifest.json'
      ),
      'utf8'
    )
  );
  assert.equal(manifest.buildId, PUPPETEER_REVISIONS['chrome-headless-shell']);
  assert.equal(
    manifest.baseUrl,
    'https://downloads.stage5.tools/chrome-for-testing'
  );
  assert.deepEqual(
    Object.keys(manifest.archives).sort(),
    [BrowserPlatform.MAC, BrowserPlatform.MAC_ARM, BrowserPlatform.WIN64].sort()
  );
  for (const [platform, value] of Object.entries(manifest.archives) as [
    BrowserPlatform,
    any,
  ][]) {
    assert.match(value.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(value.size) && value.size > 0);
    assert.equal(
      getDownloadUrl(
        Browser.CHROMEHEADLESSSHELL,
        platform,
        manifest.buildId,
        manifest.baseUrl
      ).href,
      `${manifest.baseUrl}/${value.path}`
    );
  }
});
