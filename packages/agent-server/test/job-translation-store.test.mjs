import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  IdempotencyConflictError,
  PersistentJobStore,
} from '../src/job-store.mjs';

function setup(store) {
  const plan = store.putPlan({
    request: { source: { transcript_path: '/tmp/source.srt' } },
    plan: {
      source: { kind: 'transcript' },
      credit_usage: { total_stage5_credits: 0 },
      stages: [{ id: 'translation_external', label: 'External translation' }],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'external-translation-test',
    request: {},
  }).job;
  return store.mutateJob(job.job_id, next => {
    next.status = 'waiting_for_agent';
    next.stage = 'translation_external';
    next.stages[0].status = 'waiting_for_agent';
    return next;
  });
}

const SEGMENTS = [
  { id: 'seg_1', start: 0, end: 2, source: 'First thought.' },
  { id: 'seg_2', start: 2, end: 4, source: 'Second thought continues' },
  { id: 'seg_3', start: 5.5, end: 7, source: 'After a pause' },
  { id: 'seg_4', start: 7, end: 9, source: 'Final thought.' },
];

test('issued batches are semantic, exact, resumable, and idempotent', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-translation-store-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PersistentJobStore({ environment: 'production', root });
  t.after(() => store.close());
  const job = setup(store);
  const initialized = store.initializeTranslationSession(job.job_id, {
    segments: SEGMENTS,
    targetLanguage: 'Korean',
    glossary: { 'First thought': '첫 번째 생각' },
  });
  assert.equal(initialized.reused, false);
  assert.equal(
    store.initializeTranslationSession(job.job_id, {
      segments: SEGMENTS,
      targetLanguage: 'Korean',
    }).reused,
    true
  );

  assert.throws(
    () =>
      store.issueTranslationBatch(job.job_id, {
        mode: 'review',
        maxSegments: 3,
      }),
    /not atomically waiting/i,
    'an initial translation checkpoint must not masquerade as an empty review pass'
  );

  const batch = store.issueTranslationBatch(job.job_id, { maxSegments: 3 });
  assert.ok(batch.batch_id);
  assert.deepEqual(
    batch.segments.map(item => item.id),
    ['seg_1', 'seg_2'],
    'the batch should stop at the meaningful pause before the hard segment cap'
  );
  assert.deepEqual(
    batch.context_after.map(item => item.id),
    ['seg_3', 'seg_4']
  );
  const replayedIssue = store.issueTranslationBatch(job.job_id, {
    maxSegments: 3,
  });
  assert.equal(replayedIssue.batch_id, batch.batch_id);

  assert.throws(
    () =>
      store.submitTranslationBatch(job.job_id, batch.batch_id, [
        { id: 'seg_1', text: '첫째' },
      ]),
    /exactly the issued segment IDs/
  );
  const translations = batch.segments.map(item => ({
    id: item.id,
    text: `${item.id} 번역`,
  }));
  const accepted = store.submitTranslationBatch(
    job.job_id,
    batch.batch_id,
    translations
  );
  assert.equal(accepted.reused, false);
  assert.equal(accepted.session.translated_segments, 2);
  assert.equal(
    store.submitTranslationBatch(job.job_id, batch.batch_id, translations)
      .reused,
    true
  );
  assert.throws(
    () =>
      store.submitTranslationBatch(
        job.job_id,
        batch.batch_id,
        translations.map((item, index) =>
          index ? item : { ...item, text: '다른 번역' }
        )
      ),
    IdempotencyConflictError
  );
});

test('translation sessions survive process restart and reject source replacement', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-translation-store-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = new PersistentJobStore({ environment: 'development', root });
  const job = setup(first);
  first.initializeTranslationSession(job.job_id, {
    segments: SEGMENTS,
    targetLanguage: 'Korean',
  });
  first.close();

  const reopened = new PersistentJobStore({ environment: 'development', root });
  t.after(() => reopened.close());
  assert.equal(reopened.getTranslationSession(job.job_id).segments.length, 4);
  assert.throws(
    () =>
      reopened.initializeTranslationSession(job.job_id, {
        segments: [{ ...SEGMENTS[0], source: 'Changed source.' }],
        targetLanguage: 'Korean',
      }),
    IdempotencyConflictError
  );

  assert.throws(
    () =>
      reopened.synchronizeTranslationSession(job.job_id, [
        ...SEGMENTS,
        { ...SEGMENTS[0], translation: 'duplicate' },
      ]),
    IdempotencyConflictError,
    'duplicate cue IDs cannot be hidden by Map key replacement'
  );
});

test('correction review batches include translations that are completely missing', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-translation-corrections-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PersistentJobStore({ environment: 'production', root });
  t.after(() => store.close());
  const job = setup(store);
  store.initializeTranslationSession(job.job_id, {
    segments: [
      { ...SEGMENTS[0], translation: '기존 번역' },
      { ...SEGMENTS[1], translation: '' },
    ],
    targetLanguage: 'Korean',
  });
  store.mutateJob(job.job_id, next => {
    next.status = 'blocked';
    next.stage = 'translation_validation';
    next.error = { code: 'TRANSLATION_VALIDATION_FAILED' };
    next.stages[0].id = 'translation_validation';
    next.stages[0].status = 'blocked';
    return next;
  });

  const marked = store.markTranslationSegmentsForCorrection(job.job_id, [
    'seg_1',
    'seg_2',
  ]);
  assert.deepEqual(
    marked.segments.map(segment => segment.status),
    ['needs_correction', 'needs_correction']
  );

  const batch = store.issueTranslationBatch(job.job_id, {
    mode: 'review',
    maxSegments: 10,
  });
  assert.deepEqual(
    batch.segments.map(segment => [segment.id, segment.translation || '']),
    [
      ['seg_1', '기존 번역'],
      ['seg_2', ''],
    ]
  );
  const accepted = store.submitTranslationBatch(
    job.job_id,
    batch.batch_id,
    [
      { id: 'seg_1', text: '수정된 번역' },
      { id: 'seg_2', text: '누락분 번역' },
    ]
  );
  assert.equal(accepted.session.pending_segments, 0);
});

test('clearing obsolete correction markers preserves completed translations', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-translation-clear-corrections-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PersistentJobStore({ environment: 'production', root });
  t.after(() => store.close());
  const job = setup(store);
  store.initializeTranslationSession(job.job_id, {
    segments: [
      { ...SEGMENTS[0], translation: '기존 번역' },
      { ...SEGMENTS[1], translation: '' },
    ],
    targetLanguage: 'Korean',
  });
  const marked = store.markTranslationSegmentsForCorrection(job.job_id, [
    'seg_1',
    'seg_2',
  ]);
  const markedRevision = marked.revision;

  const cleared = store.clearTranslationCorrectionMarkers(job.job_id);
  assert.deepEqual(
    cleared.segments.map(segment => [segment.status, segment.translation]),
    [
      ['translated', '기존 번역'],
      ['pending', ''],
    ]
  );
  assert.equal(cleared.revision, markedRevision + 1);
  assert.equal(
    store.clearTranslationCorrectionMarkers(job.job_id).revision,
    cleared.revision
  );
});

test('translation sessions enforce bounded identities, cue counts, and known statuses', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-translation-bounds-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PersistentJobStore({ environment: 'production', root });
  t.after(() => store.close());

  const normalizedJob = setup(store);
  const initialized = store.initializeTranslationSession(normalizedJob.job_id, {
    segments: [
      {
        id: 'bounded-id',
        start: 0,
        end: 2,
        source: 'Source.',
        translation: '번역.',
        status: 'invented-state',
      },
    ],
    targetLanguage: 'Korean',
  });
  assert.equal(initialized.session.segments[0].status, 'translated');

  const longIdStore = new PersistentJobStore({
    environment: 'development',
    root: path.join(root, 'long-id'),
  });
  t.after(() => longIdStore.close());
  const longIdJob = setup(longIdStore);
  assert.throws(
    () =>
      longIdStore.initializeTranslationSession(longIdJob.job_id, {
        segments: [{ ...SEGMENTS[0], id: 'x'.repeat(201) }],
        targetLanguage: 'Korean',
      }),
    /at most 200 printable characters/
  );
  assert.throws(
    () =>
      longIdStore.initializeTranslationSession(longIdJob.job_id, {
        segments: [{ ...SEGMENTS[0], source: 'x'.repeat(10_001) }],
        targetLanguage: 'Korean',
      }),
    /Source text exceeds 10000 characters/
  );
  assert.throws(
    () =>
      longIdStore.initializeTranslationSession(longIdJob.job_id, {
        segments: SEGMENTS,
        targetLanguage: 'Korean\nInjected',
      }),
    /between 2 and 80 printable characters/
  );

  const countStore = new PersistentJobStore({
    environment: 'production',
    root: path.join(root, 'cue-count'),
  });
  t.after(() => countStore.close());
  const countJob = setup(countStore);
  assert.throws(
    () =>
      countStore.initializeTranslationSession(countJob.job_id, {
        segments: Array(100_001).fill(SEGMENTS[0]),
        targetLanguage: 'Korean',
      }),
    /cannot exceed 100000 segments/
  );

  const textStore = new PersistentJobStore({
    environment: 'production',
    root: path.join(root, 'session-text'),
  });
  t.after(() => textStore.close());
  const textJob = setup(textStore);
  const maximumCueText = 'x'.repeat(10_000);
  assert.throws(
    () =>
      textStore.initializeTranslationSession(textJob.job_id, {
        segments: Array.from({ length: 3_356 }, (_, index) => ({
          id: `large-${index}`,
          start: index * 2,
          end: index * 2 + 1,
          source: maximumCueText,
        })),
        targetLanguage: 'Korean',
      }),
    /Translation session text cannot exceed 33554432 characters/
  );
});
