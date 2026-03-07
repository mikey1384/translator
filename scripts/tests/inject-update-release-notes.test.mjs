import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'inject-update-release-notes.mjs');

test('inject-update-release-notes appends release metadata and replaces stale values', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'translator-release-notes-'));
  const yamlPath = path.join(tempDir, 'latest-mac.yml');
  const notesPath = path.join(tempDir, 'release-notes.txt');

  fs.writeFileSync(
    yamlPath,
    [
      'version: 1.2.3',
      'files:',
      '  - url: Translator-1.2.3-darwin-arm64.zip',
      'releaseName: stale',
      'releaseNotes: |-',
      '  old line',
      '',
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(notesPath, '- First line\n- Second line\n', 'utf8');

  execFileSync(
    process.execPath,
    [
      scriptPath,
      '--yaml',
      yamlPath,
      '--version',
      '1.2.3',
      '--release-notes-file',
      notesPath,
    ],
    { stdio: 'pipe' }
  );

  const updated = fs.readFileSync(yamlPath, 'utf8');
  assert.match(updated, /releaseName: v1\.2\.3/);
  assert.match(updated, /releaseNotes: \|-\n  - First line\n  - Second line\n$/);
  assert.equal((updated.match(/^releaseName:/gm) || []).length, 1);
  assert.equal((updated.match(/^releaseNotes:/gm) || []).length, 1);
  assert.doesNotMatch(updated, /stale/);
  assert.doesNotMatch(updated, /old line/);
});
