import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js';
import { resolvePuppeteerHeadlessRevision } from '../resolve-puppeteer-headless-revision.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = relativePath =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const readJson = relativePath => JSON.parse(read(relativePath));

test('packaged apps carry only their target headless-browser architecture', () => {
  const base = readJson('electron-builder.base.json');
  const x64 = readJson('electron-builder.x64.json');
  const win = readJson('electron-builder.win.json');

  const headlessSources = config =>
    config.extraResources
      .map(entry => entry.from)
      .filter(source => source.startsWith('vendor/headless-'));

  assert.deepEqual(headlessSources(base), ['vendor/headless-${arch}']);
  assert.deepEqual(headlessSources(x64), ['vendor/headless-x64']);
  assert.deepEqual(headlessSources(win), ['vendor/headless-x64']);

  const verifier = read('scripts/verify-architectures.sh');
  assert.match(verifier, /Unexpected non-target headless browser payload/);
  assert.match(verifier, /verify_macho_arch "\$headless_binary"/);
});

test('Windows headless download cannot report success with stale output', () => {
  const script = read('scripts/download-headless-win.bat');

  assert.match(script, /rmdir \/s \/q "vendor\\headless-x64"/i);
  assert.match(
    script,
    /chrome-headless-shell@!HEADLESS_REVISION! --platform win64/i
  );
  assert.doesNotMatch(script, /chrome-headless-shell@stable/i);
  assert.match(script, /if not defined HEADLESS_BINARY/i);
  assert.match(script, /exit \/b !errorlevel!/i);
  assert.equal(
    resolvePuppeteerHeadlessRevision(),
    PUPPETEER_REVISIONS['chrome-headless-shell']
  );
});

test('Windows release wrappers propagate package and upload failures', () => {
  const batch = read('Release-Windows-OneClick.bat');
  const release = read('scripts/release-windows-oneclick.ps1');
  const upload = read('scripts/upload-to-r2-win.ps1');

  assert.match(batch, /set "RELEASE_EXIT=%ERRORLEVEL%"/i);
  assert.match(batch, /endlocal & exit \/b %RELEASE_EXIT%/i);
  assert.match(release, /npm run package:win failed with exit code/);
  assert.match(release, /exit \$exitCode/);
  assert.match(release, /Get-AuthenticodeSignature/);
  assert.match(upload, /Assert-UpdaterMetadataMatchesInstaller/);
  assert.match(upload, /latest\.yml sha512 mismatch/);
  assert.equal(
    (upload.match(/rclone .*failed with exit code/g) || []).length,
    3,
    'every rclone upload mode must turn native failures into terminating errors'
  );
});

test('Windows icon generation emits and validates every PNG frame', () => {
  const script = read('scripts/create-windows-icon.ps1');

  assert.match(script, /\$sizes = @\(16, 32, 48, 64, 128, 256\)/);
  assert.match(script, /\$writer\.Write\(\[UInt32\]\$frame\.Bytes\.Length\)/);
  assert.match(script, /foreach \(\$frame in \$frames\)/);
  assert.match(script, /Assert-IcoStructure/);
  assert.match(script, /ICO frame \$index points outside the output file/);
  assert.doesNotMatch(script, /copying PNG as ICO/i);
});

test('Windows package smoke test fails closed and checks the owner supervisor', () => {
  const script = read('scripts/test-windows-package.bat');

  assert.match(script, /translator-owner-supervisor\.exe/i);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /headless-arm64/i);
  assert.match(script, /exit \/b !TEST_EXIT!/i);
});
