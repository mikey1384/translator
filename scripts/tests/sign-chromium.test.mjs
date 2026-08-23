import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import signChromium from '../sign-chromium.cjs';

for (const identity of [null, false, '', 'null']) {
  test(`Chromium signing hook honors disabled identity ${JSON.stringify(identity)}`, async () => {
    await assert.doesNotReject(
      signChromium({
        appOutDir: '/path/that/must/not/be-read',
        packager: {
          platform: { nodeName: 'darwin' },
          platformSpecificBuildOptions: { identity },
        },
      })
    );
  });
}

test('Chromium signing hook keeps its signed-build path enabled', async () => {
  const messages = [];
  const originalLog = console.log;
  console.log = (...args) => messages.push(args.join(' '));

  try {
    await signChromium({
      appOutDir: '/path/that/must/not-be-present',
      packager: {
        platform: { nodeName: 'darwin' },
        platformSpecificBuildOptions: {
          identity: 'Developer ID Application: Example (TESTTEAMID)',
        },
      },
    });
  } finally {
    console.log = originalLog;
  }

  assert.ok(
    messages.some(message =>
      message.includes('signing vendored headless_shell binaries')
    ),
    'an explicit identity must not be treated as disabled signing'
  );
  assert.ok(
    !messages.some(message => message.includes('code signing disabled')),
    'the signed-build path must not report that signing was disabled'
  );
});

test('Windows signing hook signs the copied owner supervisor exactly once', async t => {
  const appOutDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'translator-windows-signing-')
  );
  t.after(() => fs.rmSync(appOutDir, { recursive: true, force: true }));

  const supervisorPath = path.join(
    appOutDir,
    'resources',
    'translator-owner-supervisor.exe'
  );
  fs.mkdirSync(path.dirname(supervisorPath), { recursive: true });
  fs.writeFileSync(supervisorPath, 'test executable');

  const signedPaths = [];
  await signChromium({
    appOutDir,
    packager: {
      platform: { nodeName: 'win32' },
      platformSpecificBuildOptions: {},
      async signIf(file) {
        signedPaths.push(file);
        return true;
      },
    },
  });

  assert.deepEqual(signedPaths, [supervisorPath]);
});

for (const disabledOption of ['signExecutable', 'signAndEditExecutable']) {
  test(`Windows signing hook honors disabled ${disabledOption}`, async () => {
    let signCalls = 0;
    await assert.doesNotReject(
      signChromium({
        appOutDir: '/path/that/must/not-be-read',
        packager: {
          platform: { nodeName: 'win32' },
          platformSpecificBuildOptions: { [disabledOption]: false },
          async signIf() {
            signCalls += 1;
            return true;
          },
        },
      })
    );
    assert.equal(signCalls, 0);
  });
}

test('Windows signing hook fails closed when the supervisor is missing', async t => {
  const appOutDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'translator-windows-signing-missing-')
  );
  t.after(() => fs.rmSync(appOutDir, { recursive: true, force: true }));

  await assert.rejects(
    signChromium({
      appOutDir,
      packager: {
        platform: { nodeName: 'win32' },
        platformSpecificBuildOptions: {},
        async signIf() {
          return true;
        },
      },
    }),
    /Windows owner supervisor is missing/
  );
});

test('Windows signing hook fails closed when electron-builder does not sign', async t => {
  const appOutDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'translator-windows-signing-failed-')
  );
  t.after(() => fs.rmSync(appOutDir, { recursive: true, force: true }));

  const supervisorPath = path.join(
    appOutDir,
    'resources',
    'translator-owner-supervisor.exe'
  );
  fs.mkdirSync(path.dirname(supervisorPath), { recursive: true });
  fs.writeFileSync(supervisorPath, 'test executable');

  await assert.rejects(
    signChromium({
      appOutDir,
      packager: {
        platform: { nodeName: 'win32' },
        platformSpecificBuildOptions: {},
        async signIf() {
          return false;
        },
      },
    }),
    /failed to sign Windows owner supervisor/
  );
});
