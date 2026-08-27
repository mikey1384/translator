import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PersistentJobStore } from '../src/job-store.mjs';
import {
  creditLedgerCheckpointSha256,
  persistentJobCheckpointSha256,
  translationSessionCheckpointSha256,
  validationCheckpointSha256,
} from '../src/render-checkpoint-recovery.mjs';
import { McpV2Service } from '../src/mcp-v2-service.mjs';

function data(execution) {
  assert.equal(
    execution.isError,
    false,
    JSON.stringify(execution.value?.error || null)
  );
  return execution.value.data;
}

function koreanOrdinal(value) {
  let remaining = Number(value);
  let result = '';
  do {
    result += String.fromCodePoint(0xac00 + (remaining % 11_172));
    remaining = Math.floor(remaining / 11_172);
  } while (remaining > 0);
  return result;
}

async function recoveryFixture(
  t,
  {
    segmentCount = 5_700,
    legacyRenderSpec = false,
    terminalCancelledRender = false,
    sourceMetadataOverrides = {},
    subtitleDisplayMode = 'translation',
  } = {}
) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-render-recovery-')
  );
  const outputDirectory = path.join(root, 'outputs');
  await fs.mkdir(outputDirectory);
  const sourcePath = path.join(root, 'source.mp4');
  const sourceContent = Buffer.from('exact-render-recovery-source-v1');
  await fs.writeFile(sourcePath, sourceContent);
  const sourceSha256 = createHash('sha256').update(sourceContent).digest('hex');
  const sourceKey = `file:sha256:${sourceSha256}`;
  const store = new PersistentJobStore({ environment: 'production', root });
  const appCalls = [];
  const service = new McpV2Service({
    environment: 'production',
    store,
    callApp: async (method, params) => {
      appCalls.push({ method, params });
      if (method === 'mcpContext') {
        return {
          app: { version: '1.18.0', platform: 'test', arch: 'arm64' },
          stage5: {
            account: { reference: 'device…test', authenticated: true },
            credits: { balance: 999_999, authoritative: true },
          },
          providers: {},
          planning: {},
          agent_control: { source_binding_protocol_version: 1 },
        };
      }
      throw new Error(`Unexpected recovery fixture app call: ${method}`);
    },
    ownerLease: {
      async start() {},
      descriptor: () => ({
        protocol_version: 1,
        endpoint: 'test-render-recovery-owner',
        token: 'a'.repeat(64),
        pid: process.pid,
      }),
      async close() {},
    },
    probeOwnerLease: async () => false,
  });
  t.after(async () => {
    await service.close('test_cleanup');
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const durationSeconds = segmentCount * 2;
  const originalRenderSpec = {
    display_mode: 'translation',
    style: 'Default',
    base_font_size_px: 24,
    output_font_size_px: 36,
    video_width_px: 1920,
    video_height_px: 1080,
    display_width_px: 1920,
    display_height_px: 1080,
    font_family: 'Noto Sans',
    font_asset: 'NotoSans-Regular.ttf',
    scale_rule: 'height_ratio_720_clamped_0.5_2',
    schema_version: 1,
    field_sources: {
      display_mode: 'request',
      style: 'request',
      base_font_size_px: 'request',
    },
  };
  const plan = store.putPlan({
    request: { source: { path: sourcePath } },
    plan: {
      source: {
        kind: 'local_file',
        path: sourcePath,
        source_key: sourceKey,
        sha256: sourceSha256,
        bytes: sourceContent.byteLength,
      },
      source_metadata: {
        title: 'Recovery fixture',
        duration_seconds: durationSeconds,
        width: 1920,
        height: 1080,
        display_width: 1920,
        display_height: 1080,
        bytes: sourceContent.byteLength,
        ...sourceMetadataOverrides,
      },
      project_profile: 'stage5_korean',
      profile_snapshot: {
        target_language: 'Korean',
        translation_style: {
          max_lines: 2,
          max_characters_per_line: 42,
          preferred_characters_per_second: 20,
        },
        glossary: {},
      },
      target_language: 'Korean',
      transcription: { method: 'stage5', provider: 'stage5' },
      translation: { provider: 'agent', stage5_fallback_allowed: false },
      options: {
        include_summary: false,
        include_dubbing: false,
        outputs: {
          output_directory: outputDirectory,
          base_name: 'recovered-video',
          presets: ['youtube_1080p'],
          subtitle_formats: ['srt'],
          burn_subtitles: true,
          subtitle_display_mode: subtitleDisplayMode,
          subtitle_style: 'Default',
          subtitle_font_size: 24,
          overwrite: false,
        },
      },
      outputs: {
        output_directory: outputDirectory,
        base_name: 'recovered-video',
        presets: ['youtube_1080p'],
        subtitle_formats: ['srt'],
        burn_subtitles: true,
        subtitle_display_mode: subtitleDisplayMode,
        subtitle_style: 'Default',
        subtitle_font_size: 24,
        ...(legacyRenderSpec
          ? {}
          : { subtitle_render_spec: originalRenderSpec }),
        x_account_tier: 'standard',
        overwrite: false,
      },
      stages: [
        { id: 'transcription', label: 'Prepare media and transcribe' },
        {
          id: 'translation_external',
          label: 'External-agent translation',
        },
        {
          id: 'translation_validation',
          label: 'Validate subtitles',
        },
        { id: 'render_outputs', label: 'Render planned outputs' },
        { id: 'verify_outputs', label: 'Verify rendered outputs' },
        { id: 'manifest', label: 'Write result manifest' },
      ],
      estimated_processing_time: { likely_seconds: 120 },
      estimated_disk_usage: { peak_additional_bytes: 1_024 },
      credit_usage: {
        transcription: 147_319,
        translation: 0,
        summary: 0,
        dubbing: 0,
        rendering: 0,
        total_stage5_credits: 147_319,
      },
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: `source-job-${segmentCount}`,
    request: {},
    creditAuthorization: { max_stage5_credits: 147_319 },
  }).job;
  store.initializeTranslationSession(created.job_id, {
    targetLanguage: 'Korean',
    sourceLanguage: 'English',
    profileName: 'stage5_korean',
    glossary: {},
    mediaDurationSeconds: durationSeconds,
    segments: Array.from({ length: segmentCount }, (_, index) => ({
      id: `seg_${String(index + 1).padStart(5, '0')}`,
      index: index + 1,
      start: index * 2,
      end: index * 2 + 1.5,
      source: `Source cue ${index + 1}`,
      translation: `번역${koreanOrdinal(index)}`,
      status: 'reviewed',
      revision_count: 1,
    })),
  });
  const validation = await service.runValidation(created.job_id);
  assert.equal(validation.passed, true);
  store.mutateJob(
    created.job_id,
    job => {
      for (let index = 0; index < 3; index += 1) {
        job.stages[index].status = 'completed';
        job.stages[index].percent = 100;
      }
      job.stages[2].result = validation;
      const renderStage = job.stages[3];
      renderStage.status = 'cancelled';
      renderStage.operation_id = `mcp-v2:${created.job_id}:render_outputs`;
      if (terminalCancelledRender) {
        renderStage.attempts = 2;
        renderStage.started_at = '2026-08-27T12:00:00.000Z';
        renderStage.finished_at = '2026-08-27T12:01:00.000Z';
        renderStage.result = {
          id: renderStage.operation_id,
          status: 'cancelled',
          percent: 37,
        };
        renderStage.error = null;
        job.render_authorized = true;
      } else {
        renderStage.attempts = 1;
        renderStage.error = {
          code: 'RENDER_AUTHORIZATION_REQUIRED',
          message: 'Explicit render authorization required.',
        };
      }
      job.stage_index = 3;
      job.status = 'cancelled';
      job.stage = 'cancelled';
      job.cancel_requested = true;
      job.human_status = 'Cancelled';
      job.validation = validation;
      job.error = null;
      job.credit_usage = {
        estimated_stage5_credits: 147_319,
        authorized_stage5_credits: 147_319,
        consumed_stage5_credits: 147_319,
        authorization_kind: 'preflight_estimate_gate',
        authorization_is_hard_cap: false,
        consumption_attribution_authoritative: true,
        measurement: 'authoritative_stage_results',
        entries: [
          {
            stage: 'transcription',
            operation_id: `mcp-v2:${created.job_id}:transcription`,
            stage5_credits_consumed: 147_319,
            authoritative: true,
          },
        ],
      };
      return job;
    },
    { eventType: 'synthetic_recovery_fixture_cancelled' }
  );

  const sourceJob = store.requireJob(created.job_id);
  const session = store.getTranslationSession(created.job_id);
  const expected = {
    source_key: sourceKey,
    source_checkpoint_sha256: sourceSha256,
    source_checkpoint_bytes: sourceContent.byteLength,
    translation_session_sha256: translationSessionCheckpointSha256(session),
    accepted_segment_count: segmentCount,
    target_language: 'Korean',
    validation_sha256: validationCheckpointSha256(sourceJob.validation),
    credit_ledger_sha256: creditLedgerCheckpointSha256(sourceJob.credit_usage),
    credit_ledger_value_field: 'consumed_stage5_credits',
    credit_ledger_value: 147_319,
  };
  return {
    store,
    service,
    appCalls,
    sourcePath,
    outputDirectory,
    sourceJobId: created.job_id,
    expected,
    preflightArgs: {
      source_job_id: created.job_id,
      expected,
      render_override: { style: 'LineBox', base_font_size_px: 40 },
    },
  };
}

test('pure preflight preserves 5,700 accepted translations and the exact ledger without writes', async t => {
  const fixture = await recoveryFixture(t);
  const sourceJobBefore = fixture.store.requireJob(fixture.sourceJobId);
  const sourceSessionBefore = fixture.store.getTranslationSession(
    fixture.sourceJobId
  );
  const totalChangesBefore = fixture.store.totalChanges();

  const preflight = data(
    await fixture.service.execute(
      'preflight_render_checkpoint_fork',
      fixture.preflightArgs
    )
  );

  assert.equal(preflight.eligible, true);
  assert.equal(preflight.blockers.length, 0);
  assert.equal(preflight.translations.total_segments, 5_700);
  assert.equal(preflight.translations.accepted_segments, 5_700);
  assert.equal(
    preflight.translations.session_sha256,
    fixture.expected.translation_session_sha256
  );
  assert.equal(preflight.validation.recomputed_matches, true);
  assert.equal(
    preflight.credits.source_ledger_sha256,
    fixture.expected.credit_ledger_sha256
  );
  assert.equal(preflight.credits.observed_value, 147_319);
  assert.deepEqual(preflight.credits.projected_delta, {
    estimated: 0,
    authorized: 0,
    reserved: 0,
    charged: 0,
  });
  assert.equal(preflight.render.resolved_spec.style, 'LineBox');
  assert.equal(preflight.render.resolved_spec.base_font_size_px, 40);
  assert.equal(preflight.render.resolved_spec.output_font_size_px, 60);
  assert.equal(preflight.render.resolved_spec.selection_binding_version, 1);
  assert.deepEqual(preflight.candidate.stages, [
    'render_outputs',
    'verify_outputs',
    'manifest',
  ]);
  assert.equal(preflight.candidate.persisted, false);
  assert.equal(fixture.store.getPlan(preflight.candidate.plan_hash), null);
  assert.equal(preflight.mutation_proof.writes, 0);
  assert.equal(preflight.mutation_proof.app_mutations, 0);
  assert.equal(preflight.mutation_proof.provider_calls, 0);
  assert.equal(preflight.mutation_proof.ids_allocated, 0);
  assert.equal(fixture.store.totalChanges(), totalChangesBefore);
  assert.deepEqual(
    fixture.store.requireJob(fixture.sourceJobId),
    sourceJobBefore
  );
  assert.deepEqual(
    fixture.store.getTranslationSession(fixture.sourceJobId),
    sourceSessionBefore
  );
  assert.deepEqual(
    fixture.appCalls.map(call => call.method),
    ['mcpContext']
  );

  const created = data(
    await fixture.service.execute('create_render_checkpoint_fork', {
      ...fixture.preflightArgs,
      preflight_digest: preflight.preflight_digest,
      idempotency_key: 'render-recovery-fork-5700',
      confirm: 'CREATE_RENDER_CHECKPOINT_FORK',
    })
  );
  assert.equal(created.reused, false);
  assert.equal(created.render_started, false);
  assert.equal(created.stage5_credits_consumed, 0);
  assert.equal(created.job.status, 'blocked');
  assert.equal(created.job.stage, 'render_outputs');
  assert.equal(created.job.render_authorized, false);
  assert.equal(created.job.credit_usage.consumed_stage5_credits, 0);
  assert.equal(
    created.job.credit_usage.inherited_ledger.ledger_sha256,
    fixture.expected.credit_ledger_sha256
  );
  assert.deepEqual(
    created.plan.stages.map(stage => stage.id),
    ['render_outputs', 'verify_outputs', 'manifest']
  );
  assert.equal(created.plan.outputs.subtitle_style, 'LineBox');
  assert.equal(created.plan.outputs.subtitle_font_size, 40);
  assert.equal(created.plan.credit_usage.total_stage5_credits, 0);
  assert.equal(
    translationSessionCheckpointSha256(
      fixture.store.getTranslationSession(created.job.job_id)
    ),
    fixture.expected.translation_session_sha256
  );
  assert.deepEqual(
    fixture.store.requireJob(fixture.sourceJobId),
    sourceJobBefore
  );
  assert.deepEqual(
    fixture.store.getTranslationSession(fixture.sourceJobId),
    sourceSessionBefore
  );
  assert.equal(
    persistentJobCheckpointSha256(
      fixture.store.requireJob(fixture.sourceJobId)
    ),
    preflight.source_job.job_sha256
  );
  assert.deepEqual(
    fixture.appCalls.map(call => call.method),
    ['mcpContext', 'mcpContext']
  );

  const forkBeforeRead = fixture.store.requireJob(created.job.job_id);
  const observed = data(
    await fixture.service.execute('get_job', {
      job_id: created.job.job_id,
    })
  );
  assert.equal(observed.job.status, 'blocked');
  assert.equal(observed.job.stage, 'render_outputs');
  assert.equal(observed.job.render_authorized, false);
  assert.deepEqual(
    fixture.store.requireJob(created.job.job_id),
    forkBeforeRead
  );
  assert.deepEqual(
    fixture.appCalls.filter(call => call.method !== 'mcpContext'),
    []
  );

  const replay = data(
    await fixture.service.execute('create_render_checkpoint_fork', {
      ...fixture.preflightArgs,
      preflight_digest: preflight.preflight_digest,
      idempotency_key: 'render-recovery-fork-5700',
      confirm: 'CREATE_RENDER_CHECKPOINT_FORK',
    })
  );
  assert.equal(replay.reused, true);
  assert.equal(replay.job.job_id, created.job.job_id);
  assert.equal(fixture.store.listJobs({ limit: 100 }).length, 2);
});

test('terminally cancelled legacy render synthesizes only the explicit LineBox/40 override', async t => {
  const fixture = await recoveryFixture(t, {
    segmentCount: 5_700,
    legacyRenderSpec: true,
    terminalCancelledRender: true,
  });
  const sourceJobBefore = fixture.store.requireJob(fixture.sourceJobId);
  const sourceSessionBefore = fixture.store.getTranslationSession(
    fixture.sourceJobId
  );
  const changesBefore = fixture.store.totalChanges();

  const evaluated = await fixture.service.evaluateRenderCheckpointFork(
    fixture.preflightArgs
  );
  const preflight = evaluated.receipt;
  assert.equal(preflight.eligible, true);
  assert.deepEqual(preflight.blockers, []);
  assert.equal(preflight.source_job.render_stage_attempts, 2);
  assert.equal(preflight.translations.total_segments, 5_700);
  assert.equal(preflight.translations.accepted_segments, 5_700);
  assert.equal(
    preflight.translations.session_sha256,
    fixture.expected.translation_session_sha256
  );
  assert.equal(preflight.validation.recomputed_matches, true);
  assert.equal(
    preflight.credits.source_ledger_sha256,
    fixture.expected.credit_ledger_sha256
  );
  assert.equal(preflight.credits.observed_value, 147_319);
  assert.equal(preflight.render.previous_spec, null);
  assert.deepEqual(preflight.render.resolved_spec, {
    display_mode: 'translation',
    style: 'LineBox',
    base_font_size_px: 40,
    output_font_size_px: 60,
    video_width_px: 1920,
    video_height_px: 1080,
    display_width_px: 1920,
    display_height_px: 1080,
    font_family: 'Noto Sans',
    font_asset: 'NotoSans-Regular.ttf',
    scale_rule: 'height_ratio_720_clamped_0.5_2',
    schema_version: 1,
    field_sources: {
      display_mode: 'legacy_plan_outputs',
      style: 'render_checkpoint_fork',
      base_font_size_px: 'render_checkpoint_fork',
    },
    selection_binding_version: 1,
  });
  assert.equal(evaluated.candidatePlan.outputs.base_name, 'recovered-video');
  assert.deepEqual(evaluated.candidatePlan.outputs.presets, ['youtube_1080p']);
  assert.deepEqual(evaluated.candidatePlan.outputs.subtitle_formats, ['srt']);
  assert.equal(evaluated.candidatePlan.outputs.burn_subtitles, true);
  assert.equal(
    evaluated.candidatePlan.outputs.subtitle_display_mode,
    'translation'
  );
  assert.equal(evaluated.candidatePlan.outputs.x_account_tier, 'standard');
  assert.equal(evaluated.candidatePlan.outputs.overwrite, false);
  assert.equal(preflight.mutation_proof.writes, 0);
  assert.equal(preflight.mutation_proof.app_mutations, 0);
  assert.equal(preflight.mutation_proof.provider_calls, 0);
  assert.equal(preflight.mutation_proof.ids_allocated, 0);
  assert.equal(fixture.store.totalChanges(), changesBefore);
  assert.deepEqual(
    fixture.store.requireJob(fixture.sourceJobId),
    sourceJobBefore
  );
  assert.deepEqual(
    fixture.store.getTranslationSession(fixture.sourceJobId),
    sourceSessionBefore
  );
  assert.deepEqual(
    fixture.appCalls.map(call => call.method),
    []
  );

  const created = data(
    await fixture.service.execute('create_render_checkpoint_fork', {
      ...fixture.preflightArgs,
      preflight_digest: preflight.preflight_digest,
      idempotency_key: 'legacy-terminal-render-recovery-fork',
      confirm: 'CREATE_RENDER_CHECKPOINT_FORK',
    })
  );
  assert.equal(created.render_started, false);
  assert.equal(created.job.status, 'blocked');
  assert.equal(created.job.render_authorized, false);
  assert.equal(created.plan.outputs.subtitle_style, 'LineBox');
  assert.equal(created.plan.outputs.subtitle_font_size, 40);
  assert.equal(created.plan.credit_usage.total_stage5_credits, 0);
  assert.deepEqual(
    fixture.store.requireJob(fixture.sourceJobId),
    sourceJobBefore
  );
  assert.deepEqual(
    fixture.store.getTranslationSession(fixture.sourceJobId),
    sourceSessionBefore
  );
  assert.deepEqual(
    fixture.appCalls.map(call => call.method),
    ['mcpContext']
  );
});

test('fork creation fails closed when a bound checkpoint changes after preflight', async t => {
  const fixture = await recoveryFixture(t, { segmentCount: 12 });
  const preflight = data(
    await fixture.service.execute(
      'preflight_render_checkpoint_fork',
      fixture.preflightArgs
    )
  );
  assert.equal(preflight.eligible, true);

  fixture.store.mutateJob(
    fixture.sourceJobId,
    job => {
      job.credit_usage = {
        ...job.credit_usage,
        consumed_stage5_credits: 147_320,
      };
      return job;
    },
    { eventType: 'synthetic_ledger_drift' }
  );
  const rejected = await fixture.service.execute(
    'create_render_checkpoint_fork',
    {
      ...fixture.preflightArgs,
      preflight_digest: preflight.preflight_digest,
      idempotency_key: 'stale-render-recovery-fork',
      confirm: 'CREATE_RENDER_CHECKPOINT_FORK',
    }
  );
  assert.equal(rejected.isError, true);
  assert.equal(rejected.value.error.code, 'RENDER_CHECKPOINT_FORK_INELIGIBLE');
  assert.ok(
    rejected.value.error.blockers.some(
      blocker => blocker.code === 'CREDIT_LEDGER_DIGEST_MISMATCH'
    )
  );
  assert.equal(fixture.store.listJobs({ limit: 100 }).length, 1);
});

test('source-byte drift is reported without mutating the canceled job', async t => {
  const fixture = await recoveryFixture(t, { segmentCount: 12 });
  const jobBefore = fixture.store.requireJob(fixture.sourceJobId);
  const sessionBefore = fixture.store.getTranslationSession(
    fixture.sourceJobId
  );
  const changesBefore = fixture.store.totalChanges();
  await fs.writeFile(fixture.sourcePath, 'changed-source-bytes');

  const preflight = data(
    await fixture.service.execute(
      'preflight_render_checkpoint_fork',
      fixture.preflightArgs
    )
  );
  assert.equal(preflight.eligible, false);
  assert.ok(
    preflight.blockers.some(
      blocker => blocker.code === 'SOURCE_CHECKPOINT_CHANGED'
    )
  );
  assert.equal(preflight.mutation_proof.writes, 0);
  assert.equal(fixture.store.totalChanges(), changesBefore);
  assert.deepEqual(fixture.store.requireJob(fixture.sourceJobId), jobBefore);
  assert.deepEqual(
    fixture.store.getTranslationSession(fixture.sourceJobId),
    sessionBefore
  );
});

test('output collisions and duplicate fork identities fail closed', async t => {
  const collisionFixture = await recoveryFixture(t, { segmentCount: 12 });
  const collisionPath = path.join(
    collisionFixture.outputDirectory,
    'recovered-video-youtube_1080p.mp4'
  );
  await fs.writeFile(collisionPath, 'existing-output');
  const collision = data(
    await collisionFixture.service.execute(
      'preflight_render_checkpoint_fork',
      collisionFixture.preflightArgs
    )
  );
  assert.equal(collision.eligible, false);
  assert.ok(
    collision.blockers.some(blocker => blocker.code === 'PLANNED_OUTPUT_EXISTS')
  );
  assert.equal(collision.mutation_proof.writes, 0);
  assert.equal(collisionFixture.store.listJobs({ limit: 100 }).length, 1);

  const duplicateFixture = await recoveryFixture(t, { segmentCount: 12 });
  const preflight = data(
    await duplicateFixture.service.execute(
      'preflight_render_checkpoint_fork',
      duplicateFixture.preflightArgs
    )
  );
  const first = data(
    await duplicateFixture.service.execute('create_render_checkpoint_fork', {
      ...duplicateFixture.preflightArgs,
      preflight_digest: preflight.preflight_digest,
      idempotency_key: 'first-render-fork-key',
      confirm: 'CREATE_RENDER_CHECKPOINT_FORK',
    })
  );
  assert.equal(first.reused, false);
  const duplicate = await duplicateFixture.service.execute(
    'create_render_checkpoint_fork',
    {
      ...duplicateFixture.preflightArgs,
      preflight_digest: preflight.preflight_digest,
      idempotency_key: 'different-render-fork-key',
      confirm: 'CREATE_RENDER_CHECKPOINT_FORK',
    }
  );
  assert.equal(duplicate.isError, true);
  assert.equal(duplicate.value.error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(duplicateFixture.store.listJobs({ limit: 100 }).length, 2);
});

test('preflight refuses ambiguous evidence that the render checkpoint never started', async t => {
  const fixture = await recoveryFixture(t, { segmentCount: 12 });
  fixture.store.mutateJob(
    fixture.sourceJobId,
    job => {
      const renderStage = job.stages.find(
        stage => stage.id === 'render_outputs'
      );
      renderStage.status = 'running';
      renderStage.attempts = 0;
      renderStage.operation_id = null;
      renderStage.started_at = null;
      renderStage.error = null;
      return job;
    },
    { eventType: 'synthetic_ambiguous_render_state' }
  );
  const changesBefore = fixture.store.totalChanges();

  const preflight = data(
    await fixture.service.execute(
      'preflight_render_checkpoint_fork',
      fixture.preflightArgs
    )
  );
  assert.equal(preflight.eligible, false);
  assert.ok(
    preflight.blockers.some(
      blocker => blocker.code === 'RENDER_CHECKPOINT_ALREADY_ATTEMPTED'
    )
  );
  assert.equal(preflight.mutation_proof.writes, 0);
  assert.equal(fixture.store.totalChanges(), changesBefore);
  assert.equal(fixture.store.listJobs({ limit: 100 }).length, 1);
});

test('terminal cancellation recovery fails closed on artifacts or incomplete terminal evidence', async t => {
  const artifactFixture = await recoveryFixture(t, {
    segmentCount: 12,
    legacyRenderSpec: true,
    terminalCancelledRender: true,
  });
  artifactFixture.store.mutateJob(
    artifactFixture.sourceJobId,
    job => {
      job.artifacts.push({
        path: path.join(artifactFixture.outputDirectory, 'partial-render.mp4'),
        stage: 'render_outputs',
        kind: 'video',
        partial: true,
      });
      return job;
    },
    { eventType: 'synthetic_partial_render_artifact' }
  );
  const artifactBlocked = data(
    await artifactFixture.service.execute(
      'preflight_render_checkpoint_fork',
      artifactFixture.preflightArgs
    )
  );
  assert.equal(artifactBlocked.eligible, false);
  assert.ok(
    artifactBlocked.blockers.some(
      blocker => blocker.code === 'RENDER_CHECKPOINT_ALREADY_ATTEMPTED'
    )
  );
  assert.equal(artifactBlocked.mutation_proof.writes, 0);

  const unfinishedFixture = await recoveryFixture(t, {
    segmentCount: 12,
    legacyRenderSpec: true,
    terminalCancelledRender: true,
  });
  unfinishedFixture.store.mutateJob(
    unfinishedFixture.sourceJobId,
    job => {
      const renderStage = job.stages.find(
        stage => stage.id === 'render_outputs'
      );
      renderStage.finished_at = null;
      return job;
    },
    { eventType: 'synthetic_incomplete_render_cancellation' }
  );
  const unfinishedBlocked = data(
    await unfinishedFixture.service.execute(
      'preflight_render_checkpoint_fork',
      unfinishedFixture.preflightArgs
    )
  );
  assert.equal(unfinishedBlocked.eligible, false);
  assert.ok(
    unfinishedBlocked.blockers.some(
      blocker => blocker.code === 'RENDER_CHECKPOINT_ALREADY_ATTEMPTED'
    )
  );
  assert.equal(unfinishedBlocked.mutation_proof.writes, 0);
});

test('terminal cancellation recovery fails closed while source work is active', async t => {
  const fixture = await recoveryFixture(t, {
    segmentCount: 12,
    legacyRenderSpec: true,
    terminalCancelledRender: true,
  });
  const activityToken = '11111111-1111-4111-8111-111111111111';
  const owner = {
    protocol_version: 1,
    endpoint: 'test-active-recovery-owner',
    token: 'b'.repeat(64),
    pid: process.pid,
  };
  assert.equal(
    fixture.store.claimJobActivity(
      fixture.sourceJobId,
      'render_outputs',
      activityToken,
      owner
    ).claimed,
    true
  );
  const changesBefore = fixture.store.totalChanges();

  const blocked = data(
    await fixture.service.execute(
      'preflight_render_checkpoint_fork',
      fixture.preflightArgs
    )
  );
  assert.equal(blocked.eligible, false);
  assert.ok(
    blocked.blockers.some(
      blocker => blocker.code === 'SOURCE_JOB_ACTIVITY_PRESENT'
    )
  );
  assert.equal(blocked.mutation_proof.writes, 0);
  assert.equal(fixture.store.totalChanges(), changesBefore);
  assert.equal(fixture.store.listJobs({ limit: 100 }).length, 1);
});

test('legacy render spec synthesis refuses missing or ambiguous persisted fields', async t => {
  const missingHeight = await recoveryFixture(t, {
    segmentCount: 12,
    legacyRenderSpec: true,
    terminalCancelledRender: true,
    sourceMetadataOverrides: { height: null, display_height: null },
  });
  const heightBlocked = data(
    await missingHeight.service.execute(
      'preflight_render_checkpoint_fork',
      missingHeight.preflightArgs
    )
  );
  assert.equal(heightBlocked.eligible, false);
  assert.ok(
    heightBlocked.blockers.some(
      blocker =>
        blocker.code === 'CANDIDATE_FORK_INVALID' &&
        /video_height_px/.test(blocker.message)
    )
  );
  assert.equal(heightBlocked.mutation_proof.writes, 0);

  const missingDisplayMode = await recoveryFixture(t, {
    segmentCount: 12,
    legacyRenderSpec: true,
    terminalCancelledRender: true,
    subtitleDisplayMode: null,
  });
  const displayModeBlocked = data(
    await missingDisplayMode.service.execute(
      'preflight_render_checkpoint_fork',
      missingDisplayMode.preflightArgs
    )
  );
  assert.equal(displayModeBlocked.eligible, false);
  assert.ok(
    displayModeBlocked.blockers.some(
      blocker =>
        blocker.code === 'CANDIDATE_FORK_INVALID' &&
        /display mode/.test(blocker.message)
    )
  );
  assert.equal(displayModeBlocked.mutation_proof.writes, 0);
});

test('atomic fork creation rejects an unbound source path and non-render plan drift', async t => {
  const fixture = await recoveryFixture(t, { segmentCount: 12 });
  const evaluated = await fixture.service.evaluateRenderCheckpointFork(
    fixture.preflightArgs
  );
  assert.equal(evaluated.receipt.eligible, true);
  const request = {
    ...fixture.preflightArgs,
    preflight_digest: evaluated.receipt.preflight_digest,
  };
  const storeArgs = {
    sourceJobId: fixture.sourceJobId,
    sourceJobSha256: evaluated.receipt.source_job.job_sha256,
    translationSessionSha256: evaluated.receipt.translations.session_sha256,
    validationSha256: evaluated.receipt.validation.checkpoint_sha256,
    creditLedgerSha256: evaluated.receipt.credits.source_ledger_sha256,
    preflightDigest: evaluated.receipt.preflight_digest,
    request,
  };
  const foreignPath = path.join(
    path.dirname(fixture.sourcePath),
    'foreign.mp4'
  );
  await fs.copyFile(fixture.sourcePath, foreignPath);
  const foreignCheckpoint = {
    ...evaluated.sourceCheckpoint,
    path: foreignPath,
  };
  const foreignPlan = JSON.parse(JSON.stringify(evaluated.candidatePlan));
  foreignPlan.recovery.source_checkpoint = foreignCheckpoint;
  assert.throws(
    () =>
      fixture.store.createRenderCheckpointFork({
        ...storeArgs,
        idempotencyKey: 'forged-recovery-source-path',
        plan: foreignPlan,
        sourceCheckpoint: foreignCheckpoint,
      }),
    /not bound to the canceled source job/
  );

  const driftedPlan = JSON.parse(JSON.stringify(evaluated.candidatePlan));
  driftedPlan.outputs.base_name = 'unapproved-output-name';
  assert.throws(
    () =>
      fixture.store.createRenderCheckpointFork({
        ...storeArgs,
        idempotencyKey: 'forged-recovery-plan-drift',
        plan: driftedPlan,
        sourceCheckpoint: evaluated.sourceCheckpoint,
      }),
    /not the deterministic render-only derivative/
  );
  assert.equal(fixture.store.listJobs({ limit: 100 }).length, 1);
});
