import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import { JobOwnerLease, probeJobOwnerLease } from '../src/job-owner-lease.mjs';

test('job owner lease proves the exact live controller and revokes on close', async t => {
  const lease = new JobOwnerLease();
  await lease.start();
  t.after(() => lease.close());

  const descriptor = lease.descriptor();
  assert.equal(await probeJobOwnerLease(descriptor), true);
  assert.equal(
    await probeJobOwnerLease({ ...descriptor, token: '0'.repeat(64) }),
    false
  );

  const endpoint = descriptor.endpoint;
  await lease.close();
  assert.equal(await probeJobOwnerLease(descriptor), false);
  if (process.platform !== 'win32') {
    await assert.rejects(fs.stat(endpoint), { code: 'ENOENT' });
  }
});

test('job owner lease endpoint lives in a private temporary directory', async t => {
  if (process.platform === 'win32') {
    t.skip('Windows named pipes do not have filesystem permissions.');
    return;
  }
  const lease = new JobOwnerLease({ tempDirectory: os.tmpdir() });
  await lease.start();
  t.after(() => lease.close());
  const endpointStat = await fs.stat(lease.endpoint);
  const directoryStat = await fs.stat(lease.endpointDirectory);
  assert.equal(endpointStat.mode & 0o777, 0o600);
  assert.equal(directoryStat.mode & 0o777, 0o700);
});

test('job owner lease probes treat synchronous connection failures as not alive', async () => {
  const descriptor = {
    protocol_version: 1,
    endpoint: 'unavailable-owner-endpoint',
    token: 'a'.repeat(64),
  };
  assert.equal(
    await probeJobOwnerLease(descriptor, {
      connectionFactory() {
        throw new Error('socket factory unavailable');
      },
    }),
    false
  );
});
