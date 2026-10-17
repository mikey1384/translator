import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRunningJobOp,
  sanitizeRunningJobRecords,
  STALE_AFTER_MS,
  staleRecords,
  type RunningJobRecord,
} from './running-subtitle-jobs';

const now = 1_000_000_000;
const record = (patch: Partial<RunningJobRecord> = {}): RunningJobRecord => ({
  key: '/v.mp4',
  kind: 'translate',
  language: 'korean',
  startedAt: now,
  aliveAt: now,
  owner: 'tab-a',
  ...patch,
});

test('start replaces a leftover record for the same source and stamps the run', () => {
  const before = [record({ owner: 'old' }), record({ key: '/w.mp4' })];
  const after = applyRunningJobOp(
    before,
    { type: 'start', record: record() },
    'run-1'
  );
  assert.equal(after.length, 2);
  const mine = after.find(r => r.key === '/v.mp4');
  assert.equal(mine?.owner, 'tab-a');
  assert.equal(mine?.session, 'run-1');
});

test('tabs only change their own records', () => {
  const records = [record(), record({ key: '/w.mp4', owner: 'tab-b' })];
  const beat = applyRunningJobOp(records, {
    type: 'heartbeat',
    owner: 'tab-a',
    now: now + 5,
  });
  assert.equal(beat[0].aliveAt, now + 5);
  assert.equal(beat[1].aliveAt, now);
  const ended = applyRunningJobOp(records, { type: 'end', owner: 'tab-a' });
  assert.deepEqual(
    ended.map(r => r.key),
    ['/w.mp4']
  );
  const dismissed = applyRunningJobOp(records, {
    type: 'dismiss',
    key: '/w.mp4',
    keepOwner: 'tab-a',
  });
  assert.deepEqual(
    dismissed.map(r => r.key),
    ['/v.mp4']
  );
});

test('the subtitles on screen are attached to the running translation', () => {
  const after = applyRunningJobOp([record()], {
    type: 'attachDocument',
    key: '/v.mp4',
    owner: 'tab-a',
    documentId: 'doc-1',
  });
  assert.equal(after[0].documentId, 'doc-1');
});

test('a record from an earlier app run is interrupted at once', () => {
  const fresh = record({ owner: 'gone', session: 'run-0' });
  assert.equal(staleRecords([fresh], now + 1_000, 'me', 'run-1').length, 1);
  // Same run: only once nobody refreshed it for a while.
  assert.equal(
    staleRecords([{ ...fresh, session: 'run-1' }], now + 1_000, 'me', 'run-1')
      .length,
    0
  );
  assert.equal(
    staleRecords(
      [{ ...fresh, session: 'run-1' }],
      now + STALE_AFTER_MS + 1,
      'me',
      'run-1'
    ).length,
    1
  );
});

test('malformed stored records are dropped', () => {
  assert.deepEqual(sanitizeRunningJobRecords([{ key: 1 }, null, record()]), [
    record(),
  ]);
  assert.deepEqual(sanitizeRunningJobRecords('nope'), []);
});

test('a record keeps its language and origin through start and attach', () => {
  // The workspace restores the target language and the notice wording from
  // these after a crash.
  const started = applyRunningJobOp(
    [],
    {
      type: 'start',
      record: record({ language: 'japanese', origin: 'subtitles' }),
    },
    'run-1'
  );
  const attached = applyRunningJobOp(started, {
    type: 'attachDocument',
    key: '/v.mp4',
    owner: 'tab-a',
    documentId: 'doc-1',
  });
  const [kept] = sanitizeRunningJobRecords(
    JSON.parse(JSON.stringify(attached))
  );
  assert.equal(kept.language, 'japanese');
  assert.equal(kept.origin, 'subtitles');
  assert.equal(kept.documentId, 'doc-1');
});
