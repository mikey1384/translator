import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PersistentJobStore } from '../src/job-store.mjs';
import {
  normalizeSubtitleRevision,
  repairSubtitleTimings,
  subtitleTimingIssues,
} from '../src/subtitle-revisions.mjs';
import { validateSubtitleSegments } from '../src/subtitle-quality.mjs';
import { buildSrt } from '../src/srt.mjs';

const RAW = [
  { id: 'a', start: 0.2, end: 1, source: 'A sentence', translation: '첫 문장' },
  { id: 'b', start: 1.1, end: 2, source: 'fragment.', translation: '조각.' },
  { id: 'c', start: 2.1, end: 2.2, source: 'Um.', translation: '음.' },
  {
    id: 'd',
    start: 8,
    end: 12.6,
    source: 'After a pause.',
    translation: '잠시 후.',
  },
];
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-revisions-'));
  let store = new PersistentJobStore({ environment: 'development', root });
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const plan = store.putPlan({
    request: {},
    plan: {
      source: { kind: 'local_file' },
      credit_usage: { total_stage5_credits: 0 },
      stages: [
        { id: 'translation_validation' },
        { id: 'render_outputs' },
        { id: 'manifest' },
      ],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'subtitle-revision-test',
    request: {},
  }).job;
  store.initializeTranslationSession(job.job_id, {
    segments: RAW,
    targetLanguage: 'Korean',
    mediaDurationSeconds: 10,
  });
  store.mutateJob(job.job_id, j => {
    j.status = 'blocked';
    j.stages[0].status = 'blocked';
    j.preview = { old: true };
    j.render_authorized = true;
    return j;
  });
  return {
    get store() {
      return store;
    },
    jobId: job.job_id,
    reopen() {
      store.close();
      store = new PersistentJobStore({ environment: 'development', root });
      return store;
    },
  };
}
const REVIEWED = [
  {
    ...RAW[0],
    end: 2,
    source: 'A sentence fragment.',
    translation: '첫 문장 조각.',
    source_ids: ['a', 'b'],
  },
  { ...RAW[3], end: 10, source_ids: ['d'] },
];

test('reviewed timing, merges and deletions survive restart with original provenance and text intact', t => {
  const f = setup(t),
    raw = f.store.getTranslationSession(f.jobId);
  const originalId = f.store.getSubtitleRevision(f.jobId).revision_id;
  const revision = f.store.applySubtitleRevision(f.jobId, {
    expectedRevisionId: originalId,
    cues: REVIEWED,
    mediaDurationSeconds: 10,
  });
  assert.deepEqual(revision.deleted_source_ids, ['c']);
  assert.deepEqual(f.store.getTranslationSession(f.jobId), raw);
  const job = f.store.requireJob(f.jobId);
  assert.equal(job.preview, null);
  assert.equal(job.render_authorized, false);
  assert.match(job.stages[1].operation_id, /:subtitles-1$/);
  const reloaded = f.reopen().getSelectedSubtitleSession(f.jobId);
  assert.equal(reloaded.subtitle_revision_id, revision.revision_id);
  assert.equal(reloaded.segments.length, 2);
  assert.deepEqual(reloaded.segments[0].source_ids, ['a', 'b']);
  assert.equal(
    validateSubtitleSegments(reloaded.segments, { mediaDurationSeconds: 10 })
      .passed,
    true
  );
  assert.match(
    buildSrt(reloaded.segments, 'translation'),
    /00:00:08,000 --> 00:00:10,000/
  );
  f.store.applySubtitleRevision(f.jobId, {
    expectedRevisionId: revision.revision_id,
    revisionId: originalId,
  });
  assert.equal(
    f.store.getSelectedSubtitleSession(f.jobId).segments.at(-1).end,
    12.6
  );
  assert.equal(
    validateSubtitleSegments(
      f.store.getSelectedSubtitleSession(f.jobId).segments,
      { mediaDurationSeconds: 10 }
    ).passed,
    false
  );
});

test('invalid timing, invented provenance, stale edits and active renders leave the revision untouched', t => {
  const f = setup(t),
    originalId = f.store.getSubtitleRevision(f.jobId).revision_id;
  const apply = cues =>
    f.store.applySubtitleRevision(f.jobId, {
      expectedRevisionId: originalId,
      cues,
      mediaDurationSeconds: 10,
    });
  assert.throws(() => apply(RAW), /timing is invalid/);
  assert.throws(
    () => apply([{ ...REVIEWED[0], source_ids: ['invented'] }]),
    /provenance/
  );
  assert.throws(
    () => apply([{ ...REVIEWED[0], end: 9 }, REVIEWED[1]]),
    /timestamp_overlap/
  );
  assert.equal(f.store.listSubtitleRevisions(f.jobId).length, 1);
  const r = apply(REVIEWED);
  assert.throws(() => apply(REVIEWED), /revision changed/);
  f.store.mutateJob(f.jobId, j => {
    j.stages[1].status = 'running';
    return j;
  });
  assert.throws(
    () =>
      f.store.applySubtitleRevision(f.jobId, {
        expectedRevisionId: r.revision_id,
        cues: REVIEWED,
        mediaDurationSeconds: 10,
      }),
    /idle/
  );
  assert.equal(f.store.getSubtitleRevision(f.jobId).revision_id, r.revision_id);
  assert.throws(
    () => f.store.submitTranslationBatch(f.jobId, 'stale-batch', []),
    /apply_subtitle_revision/
  );
});

test('partial downstream exports cannot be carried into a different subtitle revision', t => {
  const f = setup(t);
  const originalId = f.store.getSubtitleRevision(f.jobId).revision_id;
  f.store.mutateJob(f.jobId, job => {
    job.stage_index = 1;
    job.status = 'failed';
    job.stages[0].status = 'completed';
    job.stages[1].status = 'failed';
    job.artifacts.push({
      stage: 'render_outputs',
      kind: 'video',
      partial: true,
      path: 'earlier-revision.mp4',
    });
    return job;
  });
  assert.throws(
    () =>
      f.store.applySubtitleRevision(f.jobId, {
        expectedRevisionId: originalId,
        cues: REVIEWED,
        mediaDurationSeconds: 10,
      }),
    /derived outputs/
  );
  assert.equal(f.store.getSubtitleRevision(f.jobId).revision_id, originalId);
  assert.equal(f.store.requireJob(f.jobId).artifacts.length, 1);
});

test('reviewed cue IDs cannot overwrite properties of the editor cue map', () => {
  for (const id of ['__proto__', 'constructor', 'prototype', 'toString']) {
    assert.throws(
      () => normalizeSubtitleRevision([{ ...REVIEWED[0], id }], RAW),
      /cue IDs/
    );
  }
});

test('explicit end repair trims or removes out-of-media cues without changing raw timing', () => {
  const raw = [...RAW, { id: 'e', start: 13, end: 14, source: 'Outside' }];
  const repaired = repairSubtitleTimings(raw, {
    mediaDurationSeconds: 10,
    trimToMedia: true,
  });
  assert.equal(repaired.segments.at(-1).end, 10);
  assert.equal(raw[3].end, 12.6);
  assert.equal(raw.length, 5);
  assert.deepEqual(
    repaired.changes.map(c => c.action),
    ['trim_end', 'remove_after_media']
  );
  assert.equal(subtitleTimingIssues(repaired.segments, 10).length, 0);
  assert.equal(
    subtitleTimingIssues([{ id: 'x', start: 9, end: 10.1 }], 10)[0].code,
    'subtitle_exceeds_media_duration'
  );
});

test('joining selected small gaps extends ends only and preserves deliberate and longer pauses', () => {
  const cues = [
    { id: 'a', start: 0.2, end: 1 },
    { id: 'b', start: 1.1, end: 2 },
    { id: 'c', start: 2.15, end: 3 },
    { id: 'd', start: 5, end: 6 },
  ];
  assert.deepEqual(
    repairSubtitleTimings(cues).segments,
    cues,
    'no automatic timing repair'
  );
  const result = repairSubtitleTimings(cues, {
    joinGapsUpToSeconds: 0.2,
    preserveGapAfterIds: ['b'],
  });
  assert.deepEqual(
    result.segments.map(c => c.start),
    cues.map(c => c.start)
  );
  assert.deepEqual(
    result.segments.map(c => c.end),
    [1.1, 2, 3, 6]
  );
  assert.throws(
    () => repairSubtitleTimings(cues, { joinGapsUpToSeconds: 8 }),
    /0.5/
  );
});

test('split cues may share original provenance but fabricated or duplicate cue IDs cannot', () => {
  assert.equal(
    normalizeSubtitleRevision(
      [
        { ...RAW[0], id: 'split-1', end: 0.6, source_ids: ['a'] },
        { ...RAW[0], id: 'split-2', start: 0.6, source_ids: ['a'] },
      ],
      RAW
    ).segments.length,
    2
  );
  assert.throws(
    () => normalizeSubtitleRevision([RAW[0], RAW[0]], RAW),
    /unique/
  );
});
