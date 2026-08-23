import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRetentionState,
  extractManifestPayloadNames,
  planLatestPrefixPrune,
} from '../release-storage-policy.mjs';

const macManifest = `version: 1.16.26
files:
  - url: Translator-1.16.26-darwin-x64.zip
  - url: Translator-1.16.26-darwin-arm64.zip
  - url: Translator-1.16.26-darwin-x64.dmg
  - url: Translator-1.16.26-darwin-arm64.dmg
path: Translator-1.16.26-darwin-x64.zip
`;

const winManifest = `version: 1.16.26
files:
  - url: Translator-Setup-1.16.26.exe
path: Translator-Setup-1.16.26.exe
`;

test('mac latest pruning retains current and exactly one previous generation', () => {
  const currentPayloads = extractManifestPayloadNames(macManifest, 'mac');
  const inventory = [
    'mac/latest/latest-mac.yml',
    'mac/latest/Translator-arm64.dmg',
    'mac/latest/Translator-x64.dmg',
    ...currentPayloads.flatMap(name => [
      `mac/latest/${name}`,
      `mac/latest/${name}.blockmap`,
    ]),
    'mac/latest/Translator-1.16.25-darwin-x64.zip',
    'mac/latest/Translator-1.16.25-darwin-x64.zip.blockmap',
    'mac/latest/Translator-1.16.24-darwin-x64.zip',
    'mac/latest/Translator-1.16.24-darwin-arm64.dmg',
    'mac/latest/builder-debug.yml',
  ];

  const plan = planLatestPrefixPrune({
    platform: 'mac',
    inventoryNames: inventory,
    currentManifest: macManifest,
  });

  assert.equal(plan.currentVersion, '1.16.26');
  assert.equal(plan.previousVersion, '1.16.25');
  assert.ok(plan.keep.includes('Translator-1.16.25-darwin-x64.zip'));
  assert.ok(
    plan.keep.includes('Translator-1.16.25-darwin-x64.zip.blockmap')
  );
  assert.deepEqual(plan.remove, [
    'Translator-1.16.24-darwin-arm64.dmg',
    'Translator-1.16.24-darwin-x64.zip',
  ]);
  assert.deepEqual(plan.ignored, ['builder-debug.yml']);
});

test('Windows latest pruning retains updater files, stable aliases, and one rollback generation', () => {
  const inventory = [
    'latest.yml',
    'Translator-x64.exe',
    'Translator-x64.exe.sha256',
    'Translator-Setup-1.16.26.exe',
    'Translator-Setup-1.16.26.exe.blockmap',
    'Translator-Setup-1.16.25.exe',
    'Translator-Setup-1.16.25.exe.blockmap',
    'Translator-Setup-1.16.24.exe',
    'stale.yml',
  ];

  const plan = planLatestPrefixPrune({
    platform: 'win',
    inventoryNames: inventory,
    currentManifest: winManifest,
  });

  assert.equal(plan.previousVersion, '1.16.25');
  assert.ok(plan.keep.includes('Translator-Setup-1.16.26.exe.blockmap'));
  assert.ok(plan.keep.includes('Translator-Setup-1.16.25.exe'));
  assert.deepEqual(plan.remove, [
    'Translator-Setup-1.16.24.exe',
  ]);
  assert.deepEqual(plan.ignored, ['stale.yml']);
});

test('latest pruning fails closed before deleting around a missing current payload', () => {
  assert.throws(
    () =>
      planLatestPrefixPrune({
        platform: 'win',
        inventoryNames: [
          'latest.yml',
          'Translator-x64.exe',
          'Translator-x64.exe.sha256',
        ],
        currentManifest: winManifest,
      }),
    /required current objects are missing: Translator-Setup-1\.16\.26\.exe/
  );
});

test('manifest parsing rejects payload names outside the platform contract', () => {
  assert.throws(
    () =>
      extractManifestPayloadNames(
        'version: 1.16.26\npath: ../../unexpected.pkg\n',
        'mac'
      ),
    /Unexpected mac updater payload name/
  );
});

test('latest pruning rejects payloads that disagree with the manifest version', () => {
  const mismatchedManifest = winManifest.replaceAll('1.16.26', '1.16.25');

  assert.throws(
    () =>
      planLatestPrefixPrune({
        platform: 'win',
        inventoryNames: [
          'latest.yml',
          'Translator-x64.exe',
          'Translator-x64.exe.sha256',
          'Translator-Setup-1.16.25.exe',
        ],
        currentManifest: mismatchedManifest.replace(
          'version: 1.16.25',
          'version: 1.16.26'
        ),
      }),
    /Manifest version 1\.16\.26 does not match payloads: Translator-Setup-1\.16\.25\.exe/
  );
});

test('a rollback retains the highest other generation without deleting unknown files', () => {
  const rollbackManifest = macManifest.replaceAll('1.16.26', '1.16.24');
  const rollbackPayloads = extractManifestPayloadNames(rollbackManifest, 'mac');
  const inventory = [
    'latest-mac.yml',
    'Translator-arm64.dmg',
    'Translator-x64.dmg',
    ...rollbackPayloads,
    'Translator-1.16.26-darwin-x64.zip',
    'Translator-1.16.25-darwin-x64.zip',
    'future-channel.json',
  ];

  const plan = planLatestPrefixPrune({
    platform: 'mac',
    inventoryNames: inventory,
    currentManifest: rollbackManifest,
  });

  assert.equal(plan.currentVersion, '1.16.24');
  assert.equal(plan.previousVersion, '1.16.26');
  assert.ok(plan.keep.includes('Translator-1.16.26-darwin-x64.zip'));
  assert.deepEqual(plan.remove, ['Translator-1.16.25-darwin-x64.zip']);
  assert.deepEqual(plan.ignored, ['future-channel.json']);
});

test('release-note text cannot be interpreted as updater metadata', () => {
  const manifest = `${winManifest}releaseNotes: |-\n  path: unexpected.pkg\n  - url: unexpected.pkg\n`;

  assert.deepEqual(extractManifestPayloadNames(manifest, 'win'), [
    'Translator-Setup-1.16.26.exe',
  ]);
});

test('retention state records the exact previously published payload set', () => {
  const previousManifest = winManifest.replaceAll('1.16.26', '1.16.25');
  const state = createRetentionState({
    platform: 'win',
    currentManifest: winManifest,
    publishedManifest: previousManifest,
  });

  assert.deepEqual(state, {
    schema: 1,
    platform: 'win',
    currentVersion: '1.16.26',
    previousVersion: '1.16.25',
    previousPayloads: ['Translator-Setup-1.16.25.exe'],
  });
});

test('a retry reuses exact retention instead of guessing from inventory', () => {
  const existing = {
    schema: 1,
    platform: 'win',
    currentVersion: '1.16.26',
    previousVersion: '1.16.25',
    previousPayloads: ['Translator-Setup-1.16.25.exe'],
  };
  const state = createRetentionState({
    platform: 'win',
    currentManifest: winManifest,
    publishedManifest: winManifest,
    existingRetention: JSON.stringify(existing),
  });
  assert.deepEqual(state, existing);

  const plan = planLatestPrefixPrune({
    platform: 'win',
    inventoryNames: [
      'latest.yml',
      'release-retention.json',
      'Translator-x64.exe',
      'Translator-x64.exe.sha256',
      'Translator-Setup-1.16.26.exe',
      'Translator-Setup-1.16.25.exe',
      'Translator-Setup-1.16.99.exe',
    ],
    currentManifest: winManifest,
    retentionState: JSON.stringify(existing),
  });

  assert.equal(plan.retentionMode, 'exact');
  assert.equal(plan.previousVersion, '1.16.25');
  assert.deepEqual(plan.remove, ['Translator-Setup-1.16.99.exe']);
});

test('exact retention fails closed if a previously published payload is missing', () => {
  const retention = JSON.stringify({
    schema: 1,
    platform: 'win',
    currentVersion: '1.16.26',
    previousVersion: '1.16.25',
    previousPayloads: ['Translator-Setup-1.16.25.exe'],
  });

  assert.throws(
    () =>
      planLatestPrefixPrune({
        platform: 'win',
        inventoryNames: [
          'latest.yml',
          'release-retention.json',
          'Translator-x64.exe',
          'Translator-x64.exe.sha256',
          'Translator-Setup-1.16.26.exe',
        ],
        currentManifest: winManifest,
        retentionState: retention,
      }),
    /retained previous objects are missing: Translator-Setup-1\.16\.25\.exe/
  );
});
