import assert from 'node:assert/strict';
import test from 'node:test';
import signChromium from '../sign-chromium.cjs';

for (const identity of [null, false, '', 'null']) {
  test(`Chromium signing hook honors disabled identity ${JSON.stringify(identity)}`, async () => {
    await assert.doesNotReject(
      signChromium({
        appOutDir: '/path/that/must/not/be-read',
        packager: { platformSpecificBuildOptions: { identity } },
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
