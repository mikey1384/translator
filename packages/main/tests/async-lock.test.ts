import test from 'node:test';
import assert from 'node:assert/strict';
import { withLock } from '../services/async-lock.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('withLock serializes read-modify-write sections (no lost updates)', async () => {
  // Simulated index file: read, await (as fs would), write back.
  let stored: string[] = [];
  const addEntry = async (entry: string) => {
    const snapshot = [...stored]; // "readIndex"
    await sleep(10); // the interleave window
    stored = [...snapshot, entry]; // "writeIndex"
  };

  // Unlocked, concurrent calls lose updates (sanity-check the simulation).
  stored = [];
  await Promise.all([addEntry('a'), addEntry('b')]);
  assert.equal(stored.length, 1, 'simulation should exhibit the lost update');

  // Locked, both survive.
  stored = [];
  await Promise.all([
    withLock('idx', () => addEntry('a')),
    withLock('idx', () => addEntry('b')),
  ]);
  assert.deepEqual([...stored].sort(), ['a', 'b']);
});

test('withLock keeps the chain alive after a failure', async () => {
  const ran: string[] = [];
  await assert.rejects(
    withLock('k', async () => {
      throw new Error('boom');
    }),
    /boom/
  );
  await withLock('k', async () => {
    ran.push('after-failure');
  });
  assert.deepEqual(ran, ['after-failure']);
});

test('different keys do not serialize against each other', async () => {
  const order: string[] = [];
  await Promise.all([
    withLock('slow', async () => {
      await sleep(30);
      order.push('slow');
    }),
    withLock('fast', async () => {
      order.push('fast');
    }),
  ]);
  assert.deepEqual(order, ['fast', 'slow']);
});
