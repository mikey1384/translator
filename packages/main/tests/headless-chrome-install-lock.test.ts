import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireInstallLock,
  releaseInstallLock,
  waitForInstallLock,
  type InstallLockLogger,
} from '../services/headless-chrome-install-lock.js';

const logger: InstallLockLogger = {
  info() {},
  warn() {},
  error() {},
};

async function withTempLock(
  run: (lockFile: string) => Promise<void>
): Promise<void> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-headless-lock-')
  );
  try {
    await run(path.join(tempDir, '.install-lock'));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('headless installer reacquires a lock after the observed owner dies', async () => {
  await withTempLock(async lockFile => {
    await fs.writeFile(
      lockFile,
      `${JSON.stringify({ pid: 4242, token: 'first-owner' })}\n`
    );
    let ownerLive = true;
    let waits = 0;

    const result = await waitForInstallLock({
      lockFile,
      findReadyValue: async () => null,
      maxWaitTime: 10_000,
      checkInterval: 100,
      logger,
      isProcessLive: pid => pid === 4242 && ownerLive,
      tokenFactory: () => 'replacement-owner',
      now: () => 0,
      delay: async () => {
        waits += 1;
        ownerLive = false;
      },
    });

    assert.deepEqual(result, {
      readyValue: null,
      lockToken: 'replacement-owner',
    });
    assert.equal(waits, 1);
    const record = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    assert.equal(record.token, 'replacement-owner');
  });
});

test('headless installer releases only the lock token it acquired', async () => {
  await withTempLock(async lockFile => {
    const token = await acquireInstallLock(lockFile, {
      logger,
      tokenFactory: () => 'original-owner',
    });
    assert.equal(token, 'original-owner');

    await fs.writeFile(
      lockFile,
      `${JSON.stringify({ pid: process.pid, token: 'new-owner' })}\n`
    );
    await releaseInstallLock(lockFile, token, logger);

    const record = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    assert.equal(record.token, 'new-owner');
  });
});

test('many simultaneous installers publish one complete lock record', async () => {
  await withTempLock(async lockFile => {
    const attempts = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        acquireInstallLock(lockFile, {
          logger,
          tokenFactory: () => `owner-${index}`,
        })
      )
    );

    const winners = attempts.filter(token => token !== null);
    assert.equal(winners.length, 1);
    const record = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    assert.equal(record.pid, process.pid);
    assert.equal(record.token, winners[0]);
    assert.equal(
      (await fs.readdir(path.dirname(lockFile))).some(entry =>
        entry.includes('.candidate-')
      ),
      false,
      'candidate records must not remain visible after lock publication'
    );

    await releaseInstallLock(lockFile, winners[0]!, logger);
  });
});

test('many stale-lock reclaimers cannot delete a successor lock', async () => {
  await withTempLock(async lockFile => {
    await fs.writeFile(
      lockFile,
      `${JSON.stringify({ pid: 4242, token: 'dead-owner' })}\n`
    );

    const attempts = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        acquireInstallLock(lockFile, {
          logger,
          isProcessLive: pid => pid === process.pid,
          tokenFactory: () => `replacement-${index}`,
        })
      )
    );
    const initialWinners = attempts.filter(token => token !== null);
    assert.ok(initialWinners.length <= 1);

    let winner: string | null = initialWinners[0] ?? null;
    for (let attempt = 0; winner === null && attempt < 10; attempt += 1) {
      winner = await acquireInstallLock(lockFile, {
        logger,
        isProcessLive: pid => pid === process.pid,
        tokenFactory: () => `settled-${attempt}`,
      });
      await new Promise(resolve => setImmediate(resolve));
    }

    assert.notEqual(winner, null);
    const record = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    assert.equal(record.pid, process.pid);
    assert.equal(record.token, winner);
    assert.deepEqual(
      await fs.readdir(`${lockFile}.reclaim`),
      [],
      'all completed recovery claims must be removed'
    );

    await releaseInstallLock(lockFile, winner!, logger);
  });
});

test('headless installer returns a concurrent completed install without taking its lock', async () => {
  await withTempLock(async lockFile => {
    const result = await waitForInstallLock({
      lockFile,
      findReadyValue: async () => '/fixture/headless-chrome',
      maxWaitTime: 10_000,
      checkInterval: 100,
      logger,
      tokenFactory: () => {
        throw new Error('lock acquisition should not run');
      },
    });

    assert.deepEqual(result, {
      readyValue: '/fixture/headless-chrome',
      lockToken: null,
    });
  });
});

test('unexpected recovery state fails immediately instead of waiting', async () => {
  await withTempLock(async lockFile => {
    await fs.mkdir(`${lockFile}.reclaim`);
    await fs.writeFile(`${lockFile}.reclaim/not-an-owner`, 'fixture');

    await assert.rejects(
      acquireInstallLock(lockFile, {
        logger,
        tokenFactory: () => 'new-owner',
      }),
      /Unexpected installation-lock recovery entry/
    );
  });
});
