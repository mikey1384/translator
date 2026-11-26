import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildDurableTranscriptionRequestIdempotencyKey } from '../utils/durable-transcription-idempotency.js';
import { PersistentJobStore } from '../../agent-server/src/job-store.mjs';
import {
  McpV2Service,
  resolvePlannedSubtitleRenderSpec,
} from '../../agent-server/src/mcp-v2-service.mjs';

test('explicit project_profile subtitle font_size and style take precedence over default app preview', () => {
  const spec = resolvePlannedSubtitleRenderSpec({
    requestedOutputs: {},
    preferProfileRendering: true,
    profile: {
      subtitle_rendering: {
        display_mode: 'dual',
        style: 'LineBox',
        font_size: 40,
      },
    },
    planning: {
      subtitle_rendering: {
        display_mode: 'translation',
        style: 'Default',
        base_font_size_px: 30,
      },
    },
    sourceMetadata: { width: 1920, height: 1080 },
  });

  assert.equal(spec.base_font_size_px, 40);
  assert.equal(spec.output_font_size_px, 60);
  assert.equal(spec.style, 'LineBox');
  assert.equal(spec.display_mode, 'dual');
  assert.equal(spec.field_sources.base_font_size_px, 'project_profile');
  assert.equal(spec.field_sources.style, 'project_profile');
  assert.equal(spec.field_sources.display_mode, 'project_profile');

  // Explicit request override still wins over project_profile
  const overridden = resolvePlannedSubtitleRenderSpec({
    requestedOutputs: { subtitle_font_size: 35 },
    preferProfileRendering: true,
    profile: { subtitle_rendering: { font_size: 40 } },
    planning: { subtitle_rendering: { base_font_size_px: 30 } },
    sourceMetadata: { width: 1920, height: 1080 },
  });
  assert.equal(overridden.base_font_size_px, 35);
  assert.equal(overridden.field_sources.base_font_size_px, 'request');
});

test('buildDurableTranscriptionRequestIdempotencyKey appends nonce when rotated', () => {
  const base = buildDurableTranscriptionRequestIdempotencyKey({
    recoveryKey: 'abc123',
  });
  const rotated = buildDurableTranscriptionRequestIdempotencyKey({
    recoveryKey: 'abc123',
    nonce: 'deadbeef1234',
  });
  assert.equal(base, 'durable-transcription-request-v1:abc123');
  assert.equal(rotated, 'durable-transcription-request-v1:abc123:deadbeef1234');
  assert.notEqual(base, rotated);
});

test('submit_translation_batch accepts translations_path for a full external translation session in one call', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-v2-file-batch-'));
  const store = new PersistentJobStore({
    environment: 'development',
    root: dir,
  });
  const service = new McpV2Service({
    environment: 'development',
    store,
    callApp: async () => ({}),
  });

  try {
    const plan = store.putPlan({
      request: { source: { path: path.join(dir, 'video.mp4') } },
      plan: {
        source: { kind: 'local', path: path.join(dir, 'video.mp4') },
        credit_usage: { total_stage5_credits: 0 },
        outputs: {
          directory: dir,
          base_name: 'out',
          formats: ['srt'],
        },
        stages: [{ id: 'translation_external', label: 'Translate' }],
      },
    });
    const created = store.createJob({
      planHash: plan.plan_hash,
      idempotencyKey: 'file-batch-test',
      request: {},
    }).job;
    const jobId = created.job_id;
    store.mutateJob(jobId, next => {
      next.status = 'waiting_for_agent';
      next.stage = 'translation_external';
      next.stages[0].status = 'waiting_for_agent';
      return next;
    });
    store.initializeTranslationSession(jobId, {
      targetLanguage: 'Korean',
      segments: [
        { id: 'seg-1', start: 0, end: 2, source: 'Hello world' },
        { id: 'seg-2', start: 2, end: 4, source: 'How are you?' },
      ],
    });

    // Reject missing pending ID
    const incompleteFile = path.join(dir, 'incomplete.json');
    await fs.writeFile(
      incompleteFile,
      JSON.stringify([{ id: 'seg-1', translation: '안녕하세요' }]),
      'utf8'
    );
    await assert.rejects(
      () =>
        service.submitTranslationBatch({
          job_id: jobId,
          translations_path: incompleteFile,
        }),
      /missing pending segment IDs/
    );

    // Accept complete file in one atomic call
    const completeFile = path.join(dir, 'complete.json');
    await fs.writeFile(
      completeFile,
      JSON.stringify([
        { id: 'seg-1', translation: '안녕하세요' },
        { id: 'seg-2', text: '잘 지내세요?' },
      ]),
      'utf8'
    );
    // Stub reconcileJob so we stay purely unit-level without app RPC
    service.reconcileJob = async () => store.requireJob(jobId);

    const res = await service.submitTranslationBatch({
      job_id: jobId,
      translations_path: completeFile,
    });
    assert.equal(res.batch_id, 'file');
    assert.deepEqual(res.accepted_segment_ids, ['seg-1', 'seg-2']);
    assert.equal(res.session.pending_segments, 0);
    assert.equal(res.session.translated_segments, 2);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
