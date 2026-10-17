import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
// conf is ESM-only; tsx resolves it at runtime, tsc's node resolution can't.
// @ts-expect-error -- conf ships ESM-only types
import Conf from 'conf';
import {
  buildQuarantinePath,
  openStoreSafely,
  resolveDeviceId,
  salvageDeviceId,
  startupNoticesFor,
} from '../store/safe-store-core.js';

const silent = { warn: () => {}, error: () => {} };

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'safe-store-test-'));
}

function openConf(cwd: string, name: string, onQuarantined?: any) {
  return openStoreSafely({
    filePath: path.join(cwd, `${name}.json`),
    create: () =>
      new Conf<Record<string, unknown>>({
        cwd,
        configName: name,
        defaults: { balanceCredits: 0 },
      }),
    logger: silent,
    now: () => new Date('2026-10-17T12:00:00.000Z'),
    onQuarantined,
  });
}

for (const [label, content] of [
  ['truncated', '{"broken": '],
  ['empty', ''],
  ['garbage', '\u0000\u0000\u0000'],
] as const) {
  test(`a ${label} store file is moved aside and the store starts fresh`, () => {
    const cwd = tempDir();
    try {
      const file = path.join(cwd, 'credit-balance.json');
      fs.writeFileSync(file, content);
      let quarantined: { quarantinedPath: string; rawContent: string } | null =
        null;
      const store = openConf(cwd, 'credit-balance', (info: any) => {
        quarantined = info;
      });
      assert.equal(store.get('balanceCredits'), 0);
      store.set('balanceCredits', 5);
      assert.equal(store.get('balanceCredits'), 5);
      assert.ok(quarantined, 'expected the file to be quarantined');
      const q = quarantined as { quarantinedPath: string; rawContent: string };
      assert.equal(
        q.quarantinedPath,
        path.join(cwd, 'credit-balance.corrupt-2026-10-17T12-00-00-000Z.json')
      );
      assert.equal(fs.readFileSync(q.quarantinedPath, 'utf8'), content);
      assert.equal(q.rawContent, content);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
}

test('a healthy store file is opened untouched', () => {
  const cwd = tempDir();
  try {
    fs.writeFileSync(
      path.join(cwd, 'app-settings.json'),
      JSON.stringify({ balanceCredits: 42 })
    );
    const store = openConf(cwd, 'app-settings', () => {
      throw new Error('should not quarantine');
    });
    assert.equal(store.get('balanceCredits'), 42);
    assert.deepEqual(
      fs.readdirSync(cwd).filter(f => f.includes('corrupt')),
      []
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('repeat corruptions in the same instant never overwrite an earlier quarantine', () => {
  const cwd = tempDir();
  try {
    const file = path.join(cwd, 'x.json');
    fs.writeFileSync(file, '{');
    openConf(cwd, 'x');
    fs.writeFileSync(file, '{"second": ');
    openConf(cwd, 'x');
    const corrupt = fs.readdirSync(cwd).filter(f => f.includes('corrupt'));
    assert.equal(corrupt.length, 2);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('an error that persists after quarantine still surfaces', () => {
  const cwd = tempDir();
  try {
    const file = path.join(cwd, 'y.json');
    fs.writeFileSync(file, '{');
    assert.throws(() =>
      openStoreSafely({
        filePath: file,
        create: () => {
          throw new Error('always broken');
        },
        logger: silent,
      })
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('buildQuarantinePath keeps the extension', () => {
  assert.equal(
    buildQuarantinePath('/u/device-config.json', new Date(0)),
    '/u/device-config.corrupt-1970-01-01T00-00-00-000Z.json'
  );
});

test('salvageDeviceId reads the id out of a truncated file', () => {
  assert.equal(
    salvageDeviceId('{"deviceId":"3f1c2a9e-1111-4222-8333-444455556666","x'),
    '3f1c2a9e-1111-4222-8333-444455556666'
  );
  assert.equal(salvageDeviceId('{"deviceId": "'), null);
  assert.equal(salvageDeviceId(''), null);
});

test('resolveDeviceId prefers primary, then mirror, then salvaged, then new', () => {
  const gen = () => 'new-id-000';
  assert.deepEqual(
    resolveDeviceId({ primary: 'aaaaaaaa', mirror: 'aaaaaaaa', generate: gen }),
    {
      id: 'aaaaaaaa',
      generated: false,
      writePrimary: false,
      writeMirror: false,
    }
  );
  assert.deepEqual(
    resolveDeviceId({ primary: 'aaaaaaaa', mirror: undefined, generate: gen }),
    { id: 'aaaaaaaa', generated: false, writePrimary: false, writeMirror: true }
  );
  // device-config.json was corrupt and reset: recover from stage5-auth.json.
  assert.deepEqual(
    resolveDeviceId({ primary: undefined, mirror: 'bbbbbbbb', generate: gen }),
    { id: 'bbbbbbbb', generated: false, writePrimary: true, writeMirror: false }
  );
  assert.deepEqual(
    resolveDeviceId({
      primary: undefined,
      mirror: undefined,
      salvaged: [null, 'cccccccc'],
      generate: gen,
    }),
    { id: 'cccccccc', generated: false, writePrimary: true, writeMirror: true }
  );
  assert.deepEqual(
    resolveDeviceId({ primary: '', mirror: '  ', generate: gen }),
    { id: 'new-id-000', generated: true, writePrimary: true, writeMirror: true }
  );
});

test('startupNoticesFor reports lost settings and a replaced device id only', () => {
  assert.deepEqual(
    startupNoticesFor({ quarantinedStores: [], deviceIdGenerated: true }),
    []
  );
  assert.deepEqual(
    startupNoticesFor({
      quarantinedStores: ['app-settings'],
      deviceIdGenerated: false,
    }),
    ['settingsReset']
  );
  assert.deepEqual(
    startupNoticesFor({
      quarantinedStores: ['device-config', 'stage5-auth'],
      deviceIdGenerated: true,
    }),
    ['deviceIdReplaced']
  );
  // The id was recovered from the mirror: nothing to report.
  assert.deepEqual(
    startupNoticesFor({
      quarantinedStores: ['device-config', 'credit-balance'],
      deviceIdGenerated: false,
    }),
    []
  );
});
