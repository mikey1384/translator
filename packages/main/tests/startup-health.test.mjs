import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStartupHealth } from '../startup-health.mjs';

function createHarness() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'translator-startup-')
  );
  const stateFile = path.join(directory, 'startup-health.json');
  const launch = (appVersion = '1.16.9') =>
    createStartupHealth({
      stateFile,
      appVersion,
      platform: 'darwin',
      architecture: 'x64',
    });
  return { directory, stateFile, launch };
}

test('an interrupted startup is reported by the next launch with minimized dimensions', t => {
  const harness = createHarness();
  t.after(() => fs.rmSync(harness.directory, { recursive: true, force: true }));

  const first = harness.launch('1.16.8');
  first.setPhase('window_creation');

  const recovered = harness.launch('1.16.9');
  assert.deepEqual(
    recovered.listPendingFailures().map(failure => ({
      failureClass: failure.failureClass,
      startupPhase: failure.startupPhase,
      failedAppVersion: failure.failedAppVersion,
      failedPlatform: failure.failedPlatform,
      failedArchitecture: failure.failedArchitecture,
    })),
    [
      {
        failureClass: 'startup_incomplete',
        startupPhase: 'window_creation',
        failedAppVersion: '1.16.8',
        failedPlatform: 'darwin',
        failedArchitecture: 'x64',
      },
    ]
  );
});

test('a successful startup does not create a false recovered-failure event', t => {
  const harness = createHarness();
  t.after(() => fs.rmSync(harness.directory, { recursive: true, force: true }));

  const first = harness.launch();
  first.setPhase('renderer_ready');
  first.markSuccessful();

  const second = harness.launch();
  assert.deepEqual(second.listPendingFailures(), []);
});

test('runtime failures persist until acknowledged without storing error content', t => {
  const harness = createHarness();
  t.after(() => fs.rmSync(harness.directory, { recursive: true, force: true }));

  const launch = harness.launch();
  launch.markSuccessful();
  launch.recordFailure('renderer_process_gone', 'runtime', 'oom');

  const [failure] = launch.listPendingFailures();
  assert.equal(failure.failureClass, 'renderer_process_gone');
  assert.equal(failure.processReason, 'oom');
  assert.equal(JSON.stringify(failure).includes('stack'), false);
  assert.equal(JSON.stringify(failure).includes('path'), false);

  launch.acknowledgeFailure(failure.eventId);
  assert.deepEqual(launch.listPendingFailures(), []);
});

test('malformed persisted failures cannot block later valid reports', t => {
  const harness = createHarness();
  t.after(() => fs.rmSync(harness.directory, { recursive: true, force: true }));

  fs.mkdirSync(path.dirname(harness.stateFile), { recursive: true });
  fs.writeFileSync(
    harness.stateFile,
    JSON.stringify({
      schemaVersion: 1,
      currentAttempt: null,
      pendingFailures: [
        {
          eventId: 'poisoned',
          failureClass: 'arbitrary_error_text',
          startupPhase: 'customer_file_path',
          failedAppVersion: '1.16.8',
          failedPlatform: 'not-a-platform',
          failedArchitecture: 'not-an-architecture',
        },
      ],
    })
  );

  const launch = harness.launch();
  assert.deepEqual(launch.listPendingFailures(), []);
});
