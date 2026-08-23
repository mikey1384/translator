import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  getOwnerSupervisorPath,
  NativeOwnerMonitor,
} from '../src/native-owner-monitor.mjs';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

class FakeMonitorProcess extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.killCalls = [];
  }

  kill(signal) {
    this.killCalls.push(signal);
    return true;
  }
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitFor(check, message, milliseconds = 3_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

test('native owner monitor arms once and sends idempotent exact tracking commands', async () => {
  const child = new FakeMonitorProcess();
  const spawnCalls = [];
  const monitor = new NativeOwnerMonitor({
    executablePath: '/fixture/owner-monitor',
    ownerPid: 3001,
    controllerPid: 3002,
    platform: 'darwin',
    spawnImplementation: (...args) => {
      spawnCalls.push(args);
      return child;
    },
  });
  let control = '';
  child.stdin.on('data', chunk => {
    control += chunk.toString('utf8');
  });

  const starting = Promise.all([monitor.start(), monitor.start()]);
  child.stdout.write('READY\n');
  await starting;

  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(spawnCalls[0][1], ['--watch', '3001', '3002']);
  assert.equal(monitor.trackProcess(4001), true);
  assert.equal(monitor.trackProcess(4001), false);
  assert.throws(
    () => monitor.trackProcess(4002),
    /already owns a different Electron root/
  );
  assert.equal(monitor.untrackProcess(4001), true);
  assert.equal(monitor.untrackProcess(4001), false);

  const closing = Promise.all([monitor.close(), monitor.close()]);
  await nextTurn();
  child.exitCode = 0;
  child.emit('exit', 0, null);
  await closing;
  assert.equal(control, 'TRACK 4001\nUNTRACK 4001\nCLOSING\n');
});

test('native owner monitor reports repeated monitor failures once', async () => {
  const child = new FakeMonitorProcess();
  const losses = [];
  const monitor = new NativeOwnerMonitor({
    executablePath: '/fixture/owner-monitor',
    ownerPid: 3011,
    controllerPid: 3012,
    spawnImplementation: () => child,
    onOwnershipLost: (reason, error) => losses.push({ reason, error }),
  });

  const starting = monitor.start();
  child.stdout.write('READY\n');
  await starting;
  child.emit('exit', 70, null);
  child.stdin.emit('error', new Error('control closed'));
  child.emit('exit', 70, null);
  await nextTurn();

  assert.equal(losses.length, 1);
  assert.equal(losses[0].reason, 'owner-monitor:exit');
});

test('native owner monitor fails closed when its readiness handshake hangs', async () => {
  const child = new FakeMonitorProcess();
  let readinessDeadline;
  const monitor = new NativeOwnerMonitor({
    executablePath: '/fixture/owner-monitor',
    ownerPid: 3021,
    controllerPid: 3022,
    spawnImplementation: () => child,
    setTimer: callback => {
      readinessDeadline = callback;
      return { unref() {} };
    },
    clearTimer: () => {},
  });

  const starting = monitor.start();
  readinessDeadline();
  await assert.rejects(starting, /did not become ready in time/);
  assert.deepEqual(child.killCalls, ['SIGKILL']);
});

test('native owner monitor cleanup does not wait for exit after spawn failure', async () => {
  const monitor = new NativeOwnerMonitor({
    executablePath: path.join(
      os.tmpdir(),
      'translator-owner-monitor-does-not-exist'
    ),
  });

  await assert.rejects(monitor.start(), error => error?.code === 'ENOENT');
  await monitor.close();
});

test('native owner monitor close is bounded when forced termination is denied', async () => {
  const child = new FakeMonitorProcess();
  const timers = [];
  const monitor = new NativeOwnerMonitor({
    executablePath: '/fixture/owner-monitor',
    ownerPid: 3031,
    controllerPid: 3032,
    spawnImplementation: () => child,
    setTimer: callback => {
      timers.push(callback);
      return { unref() {} };
    },
    clearTimer: () => {},
  });

  const starting = monitor.start();
  child.stdout.write('READY\n');
  await starting;

  const closing = monitor.close();
  await nextTurn();
  timers.at(-1)();
  await closing;

  assert.deepEqual(child.killCalls, ['SIGKILL']);
});

test('Windows supervisor uses exact process handles and an uncapped tree snapshot', async () => {
  const source = await fs.readFile(
    path.join(packageRoot, 'native', 'translator-owner-supervisor-win.c'),
    'utf8'
  );

  assert.match(source, /OpenProcess\(/);
  assert.match(source, /GetProcessTimes\(/);
  assert.match(source, /WaitForMultipleObjects\(/);
  assert.match(source, /HANDLE tracked_handle/);
  assert.match(source, /HANDLE transition_applied/);
  assert.match(source, /handles\[3\] = control\.tracked_handle/);
  assert.match(
    source,
    /WaitForSingleObject\(control->transition_applied, INFINITE\)/
  );
  assert.match(source, /SetEvent\(control\.transition_applied\)/);
  assert.match(
    source,
    /retirement_applied = control\.retire_tracked;[\s\S]*if \(retirement_applied\)\s+SetEvent\(control\.transition_applied\);/
  );
  assert.match(
    source,
    /terminate_pinned_process_tree\(&exited, exited_handle\)/
  );
  assert.match(
    source,
    /TerminateProcess\(root_handle, 1\)[\s\S]*WaitForSingleObject\(root_handle, INFINITE\)[\s\S]*terminate_process_tree_internal\(root, TRUE\)/
  );
  assert.match(source, /root_identity_pinned/);
  assert.match(source, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(source, /console_shutdown_requested/);
  assert.match(source, /CloseHandle\(job\)/);
  assert.match(source, /snapshot_started/);
  assert.match(source, /identity\.created, &snapshot_started/);
  assert.match(source, /parent\.created, &current\.created/);
  assert.match(source, /realloc\(/);
  assert.doesNotMatch(source, /MAX_TREE_PROCESSES/);
});

test('every documented development launcher starts inside native supervision', async () => {
  const [packageJson, codexConfig, shellLauncher, windowsLauncher] =
    await Promise.all([
      fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'),
      fs.readFile(
        path.join(packageRoot, '..', '..', '.codex', 'config.toml'),
        'utf8'
      ),
      fs.readFile(path.join(packageRoot, 'bin', 'translator-dev-mcp'), 'utf8'),
      fs.readFile(
        path.join(packageRoot, 'bin', 'translator-dev-mcp.cmd'),
        'utf8'
      ),
    ]);
  assert.equal(JSON.parse(packageJson).scripts.mcp, 'bin/translator-dev-mcp');
  assert.match(
    codexConfig,
    /command = "packages\/agent-server\/bin\/translator-owner-supervisor"/
  );
  assert.match(shellLauncher, /translator-owner-supervisor/);
  assert.match(shellLauncher, /--supervise 1 --/);
  assert.match(windowsLauncher, /translator-owner-supervisor\.exe/);
  assert.match(windowsLauncher, /--supervise 2 --/);
});

test(
  'native supervisor observes exact owner death while another process retains stdio',
  { skip: process.platform === 'win32' },
  async t => {
    const fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'translator-native-owner-test-')
    );
    const childPidPath = path.join(fixtureRoot, 'controller.pid');
    const supervisorPath = getOwnerSupervisorPath();
    const controlledSource =
      "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);";
    const ownerSource = `
      const { spawn } = require('node:child_process');
      const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      holder.unref();
      const supervisor = spawn(process.argv[1], [
        '--supervise', '1', '--', process.execPath, '-e', process.argv[3], process.argv[2]
      ], {
        detached: true,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      supervisor.unref();
      process.stdout.write(JSON.stringify({ holderPid: holder.pid, supervisorPid: supervisor.pid }) + '\\n');
      setInterval(() => {}, 1000);
    `;
    const owner = spawn(
      process.execPath,
      ['-e', ownerSource, supervisorPath, childPidPath, controlledSource],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let ownerLine = '';
    const ownerInfo = new Promise((resolve, reject) => {
      owner.once('error', reject);
      owner.stdout.on('data', chunk => {
        ownerLine += chunk.toString('utf8');
        const newline = ownerLine.indexOf('\n');
        if (newline >= 0) resolve(JSON.parse(ownerLine.slice(0, newline)));
      });
    });
    let holderPid = null;
    let supervisorPid = null;
    let controllerPid = null;
    t.after(async () => {
      for (const pid of [owner.pid, controllerPid, supervisorPid, holderPid]) {
        if (pid && isProcessAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Exact fixture process already exited.
          }
        }
      }
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    });

    ({ holderPid, supervisorPid } = await waitFor(
      () => ownerInfo,
      'fixture owner did not publish its descendants'
    ));
    controllerPid = Number(
      await waitFor(async () => {
        try {
          return await fs.readFile(childPidPath, 'utf8');
        } catch {
          return null;
        }
      }, 'supervised controller did not start')
    );
    assert.ok(isProcessAlive(holderPid));
    assert.ok(isProcessAlive(supervisorPid));
    assert.ok(isProcessAlive(controllerPid));

    process.kill(owner.pid, 'SIGKILL');
    await waitFor(
      () => !isProcessAlive(supervisorPid),
      'native supervisor survived its exact owner'
    );
    await waitFor(
      () => !isProcessAlive(controllerPid),
      'controlled process survived exact owner loss'
    );

    assert.ok(
      isProcessAlive(holderPid),
      'descriptor holder must remain alive to prove stdio stayed open'
    );
  }
);

test(
  'native supervisor reaps the controlled process group when its root exits first',
  { skip: process.platform === 'win32' },
  async t => {
    const fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'translator-native-controller-exit-test-')
    );
    const descendantPidPath = path.join(fixtureRoot, 'descendant.pid');
    const supervisorPath = getOwnerSupervisorPath();
    const controlledSource = `
      const { spawn } = require('node:child_process');
      const { writeFileSync } = require('node:fs');
      const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      writeFileSync(process.argv[1], String(descendant.pid));
      descendant.unref();
      setTimeout(() => {}, 200);
    `;
    const supervisor = spawn(
      supervisorPath,
      [
        '--supervise',
        '1',
        '--',
        process.execPath,
        '-e',
        controlledSource,
        descendantPidPath,
      ],
      { stdio: 'ignore' }
    );
    let descendantPid = null;
    t.after(async () => {
      for (const pid of [supervisor.pid, descendantPid]) {
        if (pid && isProcessAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Exact fixture process already exited.
          }
        }
      }
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    });

    descendantPid = Number(
      await waitFor(async () => {
        try {
          return await fs.readFile(descendantPidPath, 'utf8');
        } catch {
          return null;
        }
      }, 'controlled root did not publish its descendant')
    );
    assert.ok(isProcessAlive(descendantPid));

    await waitFor(
      () => !isProcessAlive(supervisor.pid),
      'native supervisor did not finish after its controlled root exited'
    );
    await waitFor(
      () => !isProcessAlive(descendantPid),
      'controlled process-group descendant survived its root'
    );
  }
);
