import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUpdateInfo } from 'electron-updater/out/providers/Provider.js';

test('updater rejects empty merge sources that exceed the default YAML budget', () => {
  // Just over the default 10,000-unit limit: bounded work even if the fix regresses.
  const metadata =
    `sources: &sources [${Array(100).fill('{}').join(', ')}]\n` +
    'targets:\n' +
    '  - <<: *sources\n'.repeat(101);

  assert.throws(
    () =>
      parseUpdateInfo(
        metadata,
        'latest.yml',
        'https://example.invalid/latest.yml'
      ),
    {
      code: 'ERR_UPDATER_INVALID_UPDATE_INFO',
      message: /maxTotalMergeKeys/,
    }
  );
});

test('updater still parses macOS and Windows metadata with release notes', () => {
  const checksum = Buffer.alloc(64).toString('base64');
  for (const [channel, filename] of [
    ['latest-mac.yml', 'Translator-1.2.3-darwin-arm64.zip'],
    ['latest.yml', 'Translator-Setup-1.2.3.exe'],
  ]) {
    const metadata = [
      'version: 1.2.3',
      'files:',
      `  - url: ${filename}`,
      `    sha512: ${checksum}`,
      '    size: 123',
      `path: ${filename}`,
      `sha512: ${checksum}`,
      "releaseDate: '2026-09-19T00:00:00.000Z'",
      'releaseName: v1.2.3',
      'releaseNotes: |-',
      '  - Security update',
      '  - Automatic updates still work',
      '',
    ].join('\n');

    assert.deepEqual(
      parseUpdateInfo(metadata, channel, `https://example.invalid/${channel}`),
      {
        version: '1.2.3',
        files: [{ url: filename, sha512: checksum, size: 123 }],
        path: filename,
        sha512: checksum,
        releaseDate: '2026-09-19T00:00:00.000Z',
        releaseName: 'v1.2.3',
        releaseNotes: '- Security update\n- Automatic updates still work',
      }
    );
  }
});
