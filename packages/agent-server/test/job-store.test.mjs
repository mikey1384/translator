import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  IdempotencyConflictError,
  PersistentJobStore,
} from '../src/job-store.mjs';

function samplePlan(store, overrides = {}) {
  return store.putPlan({
    request: { source: { path: '/tmp/video.mp4' } },
    plan: {
      source: { kind: 'local_file', path: '/tmp/video.mp4' },
      credit_usage: { total_stage5_credits: 78 },
      estimated_processing_time: { likely_seconds: 600 },
      stages: [
        { id: 'source', label: 'Open source' },
        { id: 'transcription', label: 'Transcribe' },
      ],
      ...overrides,
    },
  });
}

test('persistent jobs deduplicate identical costly requests transactionally', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-job-store-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PersistentJobStore({ environment: 'production', root });
  t.after(() => store.close());
  const plan = samplePlan(store);
  const args = {
    planHash: plan.plan_hash,
    idempotencyKey: 'same-video-transcription',
    request: { requested_by: 'test' },
    creditAuthorization: { max_stage5_credits: 100 },
  };

  const first = store.createJob(args);
  const second = store.createJob(args);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.job.job_id, first.job.job_id);
  assert.equal(store.listJobs().length, 1);
  assert.equal(store.getEvents(first.job.job_id).length, 1);
});

test('an idempotency key cannot be rebound to another authorization', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-job-store-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PersistentJobStore({ environment: 'development', root });
  t.after(() => store.close());
  const plan = samplePlan(store);
  store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'stable-operation-key',
    request: {},
    creditAuthorization: { max_stage5_credits: 100 },
  });
  assert.throws(
    () =>
      store.createJob({
        planHash: plan.plan_hash,
        idempotencyKey: 'stable-operation-key',
        request: {},
        creditAuthorization: { max_stage5_credits: 200 },
      }),
    IdempotencyConflictError
  );
});

test('job state and monotonic event cursors survive reopening the database', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-job-store-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const firstStore = new PersistentJobStore({
    environment: 'production',
    root,
  });
  const plan = samplePlan(firstStore, {
    credit_usage: { total_stage5_credits: 0 },
  });
  const created = firstStore.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'persistent-agent-job',
    request: {},
  }).job;
  const running = firstStore.mutateJob(
    created.job_id,
    job => ({ ...job, status: 'running', stage: 'transcription', percent: 40 }),
    { eventType: 'stage_progress', eventData: { percent: 40 } }
  );
  assert.equal(running.event_cursor, 2);
  firstStore.close();

  const reopenedStore = new PersistentJobStore({
    environment: 'production',
    root,
  });
  t.after(() => reopenedStore.close());
  assert.equal(reopenedStore.requireJob(created.job_id).percent, 40);
  assert.deepEqual(
    reopenedStore.getEvents(created.job_id, 1).map(event => event.cursor),
    [2]
  );
});

test('built-in profiles can be read and overridden without storing credentials', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-job-store-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PersistentJobStore({ environment: 'development', root });
  t.after(() => store.close());
  assert.equal(
    store.getProfile('stage5_korean').glossary['Sam Altman'],
    '샘 알트먼'
  );
  const saved = store.saveProfile('stage5_korean', {
    glossary: {
      OpenAI: '오픈AI',
      password: '비밀번호',
      'client secret': '클라이언트 보안 비밀값',
    },
  });
  assert.equal(saved.revision, 1);
  assert.equal(store.getProfile('stage5_korean').glossary.OpenAI, '오픈AI');
  assert.equal(store.getProfile('stage5_korean').glossary.password, '비밀번호');
  assert.equal(store.getProfile('stage5_korean').target_language, 'Korean');
  assert.equal(
    store.getProfile('stage5_korean').glossary['Sam Altman'],
    '샘 알트먼'
  );
  assert.throws(
    () =>
      store.saveProfile('stage5_korean', {
        glossary: Object.fromEntries(
          Array.from({ length: 999 }, (_, index) => [
            `custom-term-${index}`,
            `custom-translation-${index}`,
          ])
        ),
      }),
    /more than 1000 terms/i
  );
  assert.throws(
    () => store.saveProfile('unsafe', { api_key: 'secret' }),
    /cannot store credential/
  );
  assert.throws(
    () =>
      store.saveProfile('nested-unsafe', {
        settings: { accessToken: 'secret' },
      }),
    /cannot store credential/
  );
  assert.throws(
    () =>
      store.saveProfile('oversized', {
        glossary: Object.fromEntries(
          Array.from({ length: 700 }, (_, index) => [
            `term-${index}-${'x'.repeat(250)}`,
            `translation-${'y'.repeat(250)}`,
          ])
        ),
      }),
    /cannot exceed 256 KiB/
  );
  assert.throws(
    () =>
      store.saveProfile('invalid-style', {
        subtitle_rendering: { font_size: 500 },
      }),
    /font_size must be between 12 and 96/
  );
  assert.throws(
    () =>
      store.saveProfile('invalid-publishing', {
        publishing: { youtube: { visibility: 'accidentally-public-ish' } },
      }),
    /visibility is unsupported/
  );
  assert.throws(
    () =>
      store.saveProfile('control-character-glossary', {
        glossary: { 'unsafe\u0000term': 'translation' },
      }),
    /non-empty text up to 500 characters/
  );
  assert.throws(
    () =>
      store.saveProfile('control-character-language', {
        target_language: 'Korean\nInjected',
      }),
    /between 2 and 80 characters/
  );
});

test('two SQLite clients can claim a stage and control request only once', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-job-claim-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = new PersistentJobStore({ environment: 'production', root });
  const second = new PersistentJobStore({ environment: 'production', root });
  t.after(() => first.close());
  t.after(() => second.close());
  const plan = samplePlan(first, { credit_usage: { total_stage5_credits: 0 } });
  const job = first.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'cross-process-stage-claim',
    request: {},
  }).job;

  const firstClaim = first.claimCurrentStage(job.job_id, 'stable-operation');
  const secondClaim = second.claimCurrentStage(job.job_id, 'stable-operation');
  assert.equal(firstClaim.claimed, true);
  assert.equal(secondClaim.claimed, false);
  assert.equal(first.claimControlRequest(job.job_id, 'cancel'), true);
  assert.equal(second.claimControlRequest(job.job_id, 'cancel'), false);
});

test('cross-process job activities are mutually exclusive and generation-fenced', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-job-activity-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = new PersistentJobStore({ environment: 'production', root });
  const second = new PersistentJobStore({ environment: 'production', root });
  t.after(() => first.close());
  t.after(() => second.close());
  const plan = samplePlan(first, { credit_usage: { total_stage5_credits: 0 } });
  const job = first.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'cross-process-job-activity',
    request: {},
  }).job;
  const firstOwner = {
    protocol_version: 1,
    endpoint: 'first-owner',
    token: 'a'.repeat(64),
    pid: 100,
  };
  const secondOwner = {
    protocol_version: 1,
    endpoint: 'second-owner',
    token: 'b'.repeat(64),
    pid: 200,
  };
  const firstToken = '00000000-0000-4000-8000-000000000001';
  const secondToken = '00000000-0000-4000-8000-000000000002';

  assert.equal(
    first.claimJobActivity(job.job_id, 'render_preview', firstToken, firstOwner)
      .claimed,
    true
  );
  const blocked = second.claimJobActivity(
    job.job_id,
    'render_authorization',
    secondToken,
    secondOwner
  );
  assert.equal(blocked.claimed, false);
  assert.equal(blocked.activity_kind, 'render_preview');
  assert.equal(
    second.replaceJobActivityClaim(
      job.job_id,
      blocked.activity_kind,
      blocked.activity_token,
      blocked.owner,
      'render_authorization',
      secondToken,
      secondOwner
    ),
    true
  );
  assert.equal(
    first.releaseJobActivity(
      job.job_id,
      'render_preview',
      firstToken,
      firstOwner
    ),
    false,
    'a stale completion cannot release the replacement activity generation'
  );
  assert.equal(
    second.releaseJobActivity(
      job.job_id,
      'render_authorization',
      secondToken,
      secondOwner
    ),
    true
  );
  assert.equal(second.getJobActivityClaim(job.job_id), null);
});

test('a stale callback cannot overwrite a newer status in the same stage attempt', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-job-status-fence-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PersistentJobStore({ environment: 'production', root });
  t.after(() => store.close());
  const plan = samplePlan(store, {
    credit_usage: { total_stage5_credits: 0 },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'same-attempt-status-fence',
    request: {},
  }).job;
  const claimed = store.claimCurrentStage(job.job_id, 'stable-operation').job;
  const startingFence = { ...claimed.stages[claimed.stage_index] };

  const running = store.mutateJob(
    job.job_id,
    next => {
      next.stages[next.stage_index].status = 'running';
      next.status = 'running';
      return next;
    },
    { expectedStage: startingFence }
  );
  const revision = running.revision;
  const suppressed = store.mutateJob(
    job.job_id,
    next => {
      next.stages[next.stage_index].status = 'failed';
      next.status = 'failed';
      return next;
    },
    { expectedStage: startingFence }
  );

  assert.equal(suppressed.revision, revision);
  assert.equal(suppressed.status, 'running');
  assert.equal(suppressed.stages[suppressed.stage_index].status, 'running');
});

test('future schemas fail closed and stores close idempotently', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-job-schema-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PersistentJobStore({ environment: 'development', root });
  const databasePath = store.databasePath;
  store.close();
  store.close();

  const database = new DatabaseSync(databasePath);
  database
    .prepare("UPDATE metadata SET value = '999' WHERE key = 'schema_version'")
    .run();
  database.close();
  assert.throws(
    () => new PersistentJobStore({ environment: 'development', root }),
    /Unsupported MCP job database schema 999/
  );
});
