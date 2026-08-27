import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MCP_SERVER_VERSION,
  WATCH_JOB_MAX_WAIT_MS,
} from '../src/mcp-v2-contract.mjs';
import { PersistentJobStore } from '../src/job-store.mjs';
import {
  bindAppObservationToPlan,
  buildAss,
  McpV2Service,
  legacyToolDescription,
  legacyToolBilling,
  maximumSegmentEnd,
  plannedAppSourceBinding,
  readStableBoundedTextFile,
  repairZeroDurationTranscriptSegments,
  resolvePlannedSubtitleRenderSpec,
  xWeightedTextLength,
} from '../src/mcp-v2-service.mjs';

test('subtitle render planning snapshots Translator preview preferences', () => {
  const spec = resolvePlannedSubtitleRenderSpec({
    planning: {
      subtitle_rendering: {
        display_mode: 'translation',
        style: 'LineBox',
        base_font_size_px: 40,
      },
    },
    translationProvider: 'agent',
    sourceMetadata: {
      width: 1920,
      height: 1080,
      display_width: 1920,
      display_height: 1080,
    },
  });

  assert.deepEqual(spec, {
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
    selection_binding_version: 1,
    field_sources: {
      display_mode: 'translator_preview',
      style: 'translator_preview',
      base_font_size_px: 'translator_preview',
    },
  });
});

test('explicit subtitle render options override preview preferences field by field', () => {
  const spec = resolvePlannedSubtitleRenderSpec({
    requestedOutputs: {
      subtitle_style: 'Classic',
    },
    planning: {
      subtitle_rendering: {
        display_mode: 'dual',
        style: 'LineBox',
        base_font_size_px: 40,
      },
    },
    sourceMetadata: { width: 1080, height: 1920 },
  });

  assert.equal(spec.display_mode, 'dual');
  assert.equal(spec.style, 'Classic');
  assert.equal(spec.base_font_size_px, 40);
  assert.equal(spec.output_font_size_px, 80);
  assert.equal(spec.field_sources.display_mode, 'translator_preview');
  assert.equal(spec.field_sources.style, 'request');
  assert.equal(spec.field_sources.base_font_size_px, 'translator_preview');
});

test('subtitle render planning fails closed for malformed preview and profile values', () => {
  assert.throws(
    () =>
      resolvePlannedSubtitleRenderSpec({
        planning: {
          subtitle_rendering: {
            display_mode: 'translation',
            style: 'LineBox',
            base_font_size_px: null,
          },
        },
      }),
    /invalid preview font size/i
  );
  assert.throws(
    () =>
      resolvePlannedSubtitleRenderSpec({
        profile: {
          subtitle_rendering: {
            display_mode: 'translation',
            style: 'Unsupported',
            font_size: 24,
          },
        },
      }),
    /resolved subtitle style is unsupported/i
  );
  assert.throws(
    () =>
      resolvePlannedSubtitleRenderSpec({
        profile: {
          subtitle_rendering: {
            display_mode: 'translation',
            style: 'Default',
            font_size: '24',
          },
        },
      }),
    /profile subtitle font size is invalid/i
  );
});

test('ASS exports keep canonical font size relative to the planned display canvas', () => {
  const ass = buildAss(
    [
      {
        id: 'cue-1',
        start: 0,
        end: 2,
        source: 'Source',
        translation: 'Translation',
      },
    ],
    {
      style: 'LineBox',
      fontSize: 36,
      playResX: 1280,
      playResY: 720,
    }
  );

  assert.match(ass, /PlayResX: 1280\nPlayResY: 720/);
  assert.match(ass, /Style: LineBox,Noto Sans,36,/);

  const maximum = buildAss([], { fontSize: 192 });
  assert.match(maximum, /Style: Default,Noto Sans,192,/);
});

test('maximum transcript duration supports the advertised 100,000-cue ceiling', () => {
  const segments = Array.from({ length: 100_000 }, (_, index) => ({
    end: index / 10,
  }));
  assert.equal(maximumSegmentEnd(segments), 9_999.9);
});

test('planned source binding redacts an unrelated app workspace until mount', () => {
  const plan = {
    source: { kind: 'url', source_key: 'media:sha256:planned-source' },
    source_metadata: { duration_seconds: 18_951 },
  };
  const stale = {
    id: 'mcp-v2:test:transcription',
    status: 'running',
    source: {
      videoPath: '/old/workspace.mp4',
      durationSeconds: 1_026,
    },
    subtitles: { cueCount: 331, translatedCueCount: 331 },
    outputs: { downloadedFilePath: '/old/workspace.mp4' },
  };

  const unverified = bindAppObservationToPlan(plan, stale);
  assert.equal(unverified.source_binding.state, 'unverified');
  assert.equal(unverified.source.videoPath, null);
  assert.equal(unverified.source.durationSeconds, 18_951);
  assert.equal(unverified.subtitles.cueCount, null);
  assert.equal(unverified.outputs.downloadedFilePath, null);

  const mounted = bindAppObservationToPlan(plan, {
    ...stale,
    source_binding: plannedAppSourceBinding(plan, 'mounted'),
  });
  assert.equal(mounted.source_binding.state, 'mounted');
  assert.equal(mounted.source.videoPath, '/old/workspace.mp4');
  assert.equal(mounted.subtitles.cueCount, 331);
});

test('zero-duration transcript repair preserves text in a same-start survivor', () => {
  const repaired = repairZeroDurationTranscriptSegments([
    {
      id: 'zero-a',
      index: 1,
      start: 5,
      end: 5,
      source: 'First fragment.',
    },
    {
      id: 'zero-b',
      index: 2,
      start: 5,
      end: 5,
      source: 'Second fragment.',
    },
    {
      id: 'survivor',
      index: 3,
      start: 5,
      end: 8,
      source: 'Final fragment.',
    },
  ]);

  assert.equal(repaired.original_segment_count, 3);
  assert.equal(repaired.repaired_segment_count, 2);
  assert.equal(repaired.persisted_segment_count, 1);
  assert.equal(repaired.segments[0].id, 'survivor');
  assert.equal(
    repaired.segments[0].source,
    'First fragment. Second fragment. Final fragment.'
  );
  assert.deepEqual(
    repaired.repairs.map(item => item.merged_into_segment_id),
    ['survivor', 'survivor']
  );
});

test('stable bounded controller reads reject path swaps and oversized content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-v2-text-read-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const textPath = path.join(root, 'manifest.json');
  const replacementPath = path.join(root, 'replacement.json');
  const displacedPath = path.join(root, 'displaced.json');
  await fs.writeFile(textPath, '{"stable":true}');
  await fs.writeFile(replacementPath, '{"replacement":true}');

  const originalLstat = fs.lstat;
  let swapped = false;
  fs.lstat = async (...args) => {
    const stat = await originalLstat(args[0], args[1]);
    if (!swapped && String(args[0]) === textPath) {
      swapped = true;
      await fs.rename(textPath, displacedPath);
      await fs.rename(replacementPath, textPath);
    }
    return stat;
  };
  try {
    await assert.rejects(
      () =>
        readStableBoundedTextFile(textPath, {
          maximumBytes: 1024,
          label: 'Test manifest',
        }),
      /not a stable regular file/i
    );
  } finally {
    fs.lstat = originalLstat;
  }

  assert.equal(swapped, true);
  assert.equal(
    (
      await readStableBoundedTextFile(textPath, {
        maximumBytes: 1024,
        label: 'Test manifest',
      })
    ).text,
    '{"replacement":true}'
  );
  await assert.rejects(
    () =>
      readStableBoundedTextFile(textPath, {
        maximumBytes: 4,
        label: 'Test manifest',
      }),
    /exceeds the 4-byte limit/i
  );
});

function fakeApp(options = {}) {
  const calls = [];
  let context = {
    app: { version: '1.16.28', platform: 'test', arch: 'arm64' },
    stage5: {
      account: { reference: 'device…1234', authenticated: true },
      credits: { balance: 123_456, authoritative: true },
    },
    providers: {
      transcription: { kind: 'stage5', provider: 'elevenlabs' },
      translation: { kind: 'stage5', provider: 'openai' },
      summary: { kind: 'stage5', provider: 'openai' },
      summary_high: { kind: 'stage5', provider: 'openai' },
      dubbing: { kind: 'stage5', provider: 'openai' },
      video_suggestions: { kind: 'stage5', provider: 'openai' },
    },
    planning: { credit_rates: {}, quality_translation: false },
    agent_control: { source_binding_protocol_version: 1 },
    ...(options.context || {}),
  };
  return {
    calls,
    setContext(next) {
      context = next;
    },
    getContext() {
      return context;
    },
    async call(method, params) {
      calls.push({ method, params });
      if (method === 'mcpContext') {
        if (options.handlers?.mcpContext) {
          return options.handlers.mcpContext(params, { calls, context });
        }
        return context;
      }
      if (method === 'probeSource' && params?.source?.mock === true) {
        if (!options.mockRoot) {
          throw new Error(
            'The fake app needs mockRoot to provision mock media.'
          );
        }
        const mockPath = path.join(options.mockRoot, 'mock-source.mp4');
        await fs
          .writeFile(mockPath, 'translator-mcp-mock-media-v1', {
            flag: 'wx',
          })
          .catch(error => {
            if (error?.code !== 'EEXIST') throw error;
          });
        return {
          source: { path: mockPath },
          metadata: {
            title: 'Translator MCP no-credit sample',
            duration_seconds: 12,
            width: 640,
            height: 360,
            frame_rate: 30,
            bytes: 28,
          },
          compatibility: [],
        };
      }
      if (options.handlers?.[method]) {
        return options.handlers[method](params, { calls, context });
      }
      if (method === 'probeSource' && params?.source?.path) {
        const stat = await fs.stat(params.source.path);
        return {
          source: { path: params.source.path },
          metadata: {
            title: path.basename(params.source.path),
            duration_seconds: 12,
            width: 640,
            height: 360,
            frame_rate: 30,
            bytes: stat.size,
          },
          compatibility: [],
        };
      }
      if (method === 'applyTranslationSession') {
        return { applied: params.segments.length };
      }
      if (method === 'mcpDoctor') {
        return { checks: [{ name: 'app', status: 'passed' }] };
      }
      if (method === 'processingStatus') {
        return { id: null, status: 'unknown', inProgress: false };
      }
      throw new Error(`Unexpected fake app method: ${method}`);
    },
  };
}

async function setup(t, environment = 'production', appOptions = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-mcp-v2-'));
  const store = new PersistentJobStore({ environment, root });
  const app = fakeApp({ ...appOptions, mockRoot: root });
  const ownerDescriptor = {
    protocol_version: 1,
    endpoint: `test-owner-${Math.random()}`,
    token: 'a'.repeat(64),
    pid: process.pid,
  };
  const ownerLease = {
    async start() {
      await appOptions.ownerLeaseHooks?.start?.();
    },
    descriptor: () => ownerDescriptor,
    async close() {
      await appOptions.ownerLeaseHooks?.close?.();
    },
  };
  const service = new McpV2Service({
    environment,
    store,
    callApp: app.call.bind(app),
    ownerLease,
    probeOwnerLease: async descriptor =>
      descriptor?.endpoint === ownerDescriptor.endpoint,
  });
  t.after(async () => {
    await service.close('test_cleanup');
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { store, app, service };
}

test('plan_job carries the live preview selection into its immutable outputs', async t => {
  const fixture = await setup(t, 'production', {
    context: {
      planning: {
        credit_rates: {},
        quality_translation: false,
        subtitle_rendering: {
          display_mode: 'translation',
          style: 'LineBox',
          base_font_size_px: 40,
        },
      },
    },
    handlers: {
      probeSource: async () => ({
        metadata: {
          title: 'Preview-bound source',
          duration_seconds: 60,
          width: 1920,
          height: 1080,
          display_width: 1920,
          display_height: 1080,
        },
        compatibility: [],
      }),
    },
  });
  const sourcePath = path.join(fixture.store.root, 'preview-bound.mp4');
  await fs.writeFile(sourcePath, 'fixture');

  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'none',
      translation_provider: 'agent',
      target_language: 'Korean',
    })
  );

  assert.equal(plan.outputs.subtitle_display_mode, 'translation');
  assert.equal(plan.outputs.subtitle_style, 'LineBox');
  assert.equal(plan.outputs.subtitle_font_size, 40);
  assert.deepEqual(plan.outputs.subtitle_render_spec, {
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
    selection_binding_version: 1,
    field_sources: {
      display_mode: 'translator_preview',
      style: 'translator_preview',
      base_font_size_px: 'translator_preview',
    },
  });
});

function data(execution) {
  assert.equal(execution.isError, false, JSON.stringify(execution.value.error));
  return execution.value.data;
}

function executionError(execution) {
  assert.equal(execution.isError, true, JSON.stringify(execution.value.data));
  return execution.value.error;
}

async function createRunningLocalJob(t, appHandlers = {}) {
  let activeOperationId = null;
  const handlers = {
    probeSource: async () => ({
      metadata: {
        title: 'Local fixture',
        duration_seconds: 60,
        width: 1280,
        height: 720,
        frame_rate: 30,
        bytes: 1024,
      },
      compatibility: [],
    }),
    startMediaWorkflow: async params => {
      activeOperationId = params.operationId;
      return {
        id: activeOperationId,
        status: 'running',
        inProgress: true,
        percent: 0,
      };
    },
    processingStatus: async () =>
      activeOperationId
        ? {
            id: activeOperationId,
            status: 'running',
            inProgress: true,
            percent: 10,
          }
        : { inProgress: false },
    cancelProcessing: async () => ({ accepted: true }),
    ...appHandlers,
  };
  const setupResult = await setup(t, 'production', { handlers });
  const sourcePath = path.join(setupResult.store.root, 'source.mp4');
  await fs.writeFile(sourcePath, 'fixture');
  const plan = data(
    await setupResult.service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'stage5',
      translation_provider: 'none',
    })
  );
  const created = data(
    await setupResult.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: `local-running-${Math.random()}`,
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  return {
    ...setupResult,
    sourcePath,
    plan,
    created,
    getActiveOperationId: () => activeOperationId,
  };
}

test('every v2 result names environment, versions, account, credits, and billing', async t => {
  const { service } = await setup(t, 'development');
  const execution = await service.execute('get_capabilities', {});
  assert.equal(execution.value.environment, 'development');
  assert.equal(execution.value.server.name, 'translator-development-mcp');
  assert.equal(execution.value.server.version, MCP_SERVER_VERSION);
  assert.equal(execution.value.server.protocol_version, '2.0.0');
  assert.notEqual(
    execution.value.server.version,
    execution.value.server.protocol_version
  );
  const packageMetadata = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  assert.equal(execution.value.server.version, packageMetadata.version);
  assert.equal(execution.value.app.version, '1.16.28');
  assert.equal(execution.value.stage5.account.reference, 'device…1234');
  assert.equal(execution.value.stage5.credits.balance, 123_456);
  assert.equal(execution.value.billing.will_consume_stage5_credits, false);
  assert.equal(execution.value.data.source_binding.protocol_version, 1);
  assert.equal(execution.value.data.source_binding.app_attested, true);
  assert.equal(execution.value.data.source_binding.safe_for_new_jobs, true);
});

test('job creation fails closed until the connected app attests source binding', async t => {
  const { service, store, app } = await setup(t, 'production', {
    context: { agent_control: null },
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'Old app fixture', duration_seconds: 60 },
        compatibility: [],
      }),
    },
  });
  const sourcePath = path.join(store.root, 'old-app-source.mp4');
  await fs.writeFile(sourcePath, 'fixture');
  const plan = data(
    await service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'stage5',
      translation_provider: 'none',
    })
  );

  const failure = executionError(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'old-app-source-binding-rejected',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  assert.equal(failure.code, 'APP_SOURCE_BINDING_PROTOCOL_REQUIRED');
  assert.equal(failure.required_protocol_version, 1);
  assert.equal(failure.observed_protocol_version, null);
  assert.equal(
    app.calls.some(call => call.method === 'startMediaWorkflow'),
    false
  );
});

test('a rejected paid start never claims that the failed request will consume credit', async t => {
  const { service, store } = await setup(t, 'production');
  const sourcePath = path.join(store.root, 'paid-billing-source.mp4');
  await fs.writeFile(sourcePath, 'paid billing source');
  const plan = data(
    await service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'stage5',
      translation_provider: 'none',
    })
  );
  assert.ok(plan.credit_usage.total_stage5_credits > 0);

  const rejected = await service.execute('create_job', {
    plan_hash: plan.plan_hash,
    idempotency_key: 'rejected-paid-start-billing',
  });
  assert.equal(rejected.isError, true);
  assert.equal(rejected.value.billing.may_consume_stage5_credits, true);
  assert.equal(rejected.value.billing.will_consume_stage5_credits, false);
  assert.equal(rejected.value.billing.request_succeeded, false);
  assert.equal(
    rejected.value.billing.failed_request_granted_new_authorization,
    false
  );
  assert.equal(
    rejected.value.billing.estimated_stage5_credits,
    plan.credit_usage.total_stage5_credits
  );
});

test('the service enforces its advertised tool schemas even without an MCP adapter', async t => {
  const { service } = await setup(t, 'development');
  const execution = await service.execute('get_server_info', {
    unexpected: true,
  });
  const error = executionError(execution);
  assert.match(error.message, /unexpected.*not allowed/);
});

test('doctor reports an unavailable app as a failed check instead of failing itself', async t => {
  const { service } = await setup(t, 'production', {
    handlers: {
      mcpDoctor: async () => {
        throw new Error('Translator is unavailable');
      },
    },
  });
  const report = data(await service.execute('doctor', {}));
  assert.equal(report.passed, false);
  assert.equal(report.checks[0].name, 'translator-app');
  assert.match(report.checks[0].error, /unavailable/i);
});

test('status results expose authorized background spend and query the exact operation', async t => {
  const fixture = await createRunningLocalJob(t);
  const execution = await fixture.service.execute('get_job', {
    job_id: fixture.created.job.job_id,
  });

  assert.equal(execution.isError, false);
  assert.equal(
    execution.value.billing
      .authorized_background_job_may_consume_stage5_credits,
    true
  );
  assert.equal(
    execution.value.billing.authorized_background_job_is_in_paid_stage,
    true
  );
  assert.ok(execution.value.billing.remaining_estimated_stage5_credits > 0);
  const statusCall = fixture.app.calls.find(
    call => call.method === 'processingStatus'
  );
  assert.equal(statusCall?.params.operationId, fixture.getActiveOperationId());
  assert.equal(statusCall?.params.mcpJobId, fixture.created.job.job_id);
  const startCall = fixture.app.calls.find(
    call => call.method === 'startMediaWorkflow'
  );
  assert.equal(startCall?.params.mcpJobId, fixture.created.job.job_id);
});

test('persistent stage acknowledgements are bound to the immutable planned source', async t => {
  let activeOperationId = null;
  const staleWorkspace = {
    source: {
      videoPath: '/old/workspace.mp4',
      videoReady: true,
      durationSeconds: 1_026,
    },
    subtitles: { cueCount: 331, translatedCueCount: 331 },
    outputs: { downloadedFilePath: '/old/workspace.mp4' },
  };
  const fixture = await createRunningLocalJob(t, {
    startMediaWorkflow: async params => {
      activeOperationId = params.operationId;
      return {
        id: activeOperationId,
        status: 'running',
        inProgress: true,
        percent: 0,
        ...staleWorkspace,
      };
    },
    processingStatus: async () => ({
      id: activeOperationId,
      status: 'running',
      inProgress: true,
      percent: 1,
      ...staleWorkspace,
    }),
  });

  const startCall = fixture.app.calls.find(
    call => call.method === 'startMediaWorkflow'
  );
  assert.deepEqual(startCall?.params.sourceBinding, {
    source_key: fixture.plan.source.source_key,
    source_kind: 'local_file',
    planned_duration_seconds: 60,
    state: 'preparing',
  });

  const startedStage = fixture.created.job.stages.find(
    stage => stage.id === 'transcription'
  );
  assert.equal(startedStage.result.source_binding.state, 'unverified');
  assert.equal(startedStage.result.source.videoPath, null);
  assert.equal(startedStage.result.source.durationSeconds, 60);
  assert.equal(startedStage.result.subtitles.cueCount, null);

  const refreshed = data(
    await fixture.service.execute('get_job', {
      job_id: fixture.created.job.job_id,
    })
  );
  const refreshedStage = refreshed.job.stages.find(
    stage => stage.id === 'transcription'
  );
  assert.equal(refreshedStage.result.source.videoPath, null);
  assert.equal(refreshedStage.result.subtitles.cueCount, null);
});

test('a retained completed transcription recovers local zero timings without provider replay', async t => {
  let operationId = null;
  let providerStarts = 0;
  let appliedSegments = null;
  const fixture = await createRunningLocalJob(t, {
    startMediaWorkflow: async params => {
      providerStarts += 1;
      operationId = params.operationId;
      return {
        id: operationId,
        status: 'running',
        inProgress: true,
        source_binding: params.sourceBinding,
      };
    },
    processingStatus: async params => ({
      id: operationId,
      status: 'completed',
      inProgress: false,
      percent: 100,
      source_binding: { ...params.sourceBinding, state: 'mounted' },
      result: {
        videoPath: fixture.sourcePath,
        credit_usage: {
          stage5_credits_consumed: 17,
          before_balance: 100,
          after_balance: 83,
          balance_snapshots_authoritative: true,
        },
      },
    }),
    subtitlesBatch: async ({ offset = 0, limit = 50 }) => {
      const cues = [
        {
          id: 'zero-provider-cue',
          index: 1,
          start: 2,
          end: 2,
          original: 'Recovered fragment.',
          translation: '',
        },
        {
          id: 'valid-provider-cue',
          index: 2,
          start: 2,
          end: 5,
          original: 'Valid fragment.',
          translation: '',
        },
      ];
      const page = cues.slice(offset, offset + limit);
      return {
        offset,
        limit,
        total: cues.length,
        hasMore: offset + page.length < cues.length,
        cues: page,
      };
    },
    applyTranslationSession: async params => {
      appliedSegments = params.segments;
      return {
        applied: true,
        cueCount: params.segments.length,
        source_binding: params.sourceBinding,
      };
    },
  });

  fixture.store.mutateJob(fixture.created.job.job_id, job => {
    const stage = job.stages[job.stage_index];
    const failure = {
      code: 'STAGE_FAILED',
      stage: stage.id,
      message: 'Invalid timing for segment: zero-provider-cue',
      recoverable: true,
      credit_consumed: 17,
      suggested_action: 'retry_stage',
    };
    stage.status = 'failed';
    stage.error = failure;
    stage.result = {
      videoPath: fixture.sourcePath,
      credit_usage: { stage5_credits_consumed: 17 },
    };
    job.status = 'failed';
    job.error = failure;
    job.human_status = 'Failed: Transcribe source';
    return job;
  });

  const recovered = data(
    await fixture.service.execute('get_job', {
      job_id: fixture.created.job.job_id,
    })
  ).job;
  const transcription = recovered.stages[0];
  const session = fixture.store.getTranslationSession(recovered.job_id);

  assert.equal(providerStarts, 1);
  assert.equal(transcription.status, 'completed');
  assert.equal(
    transcription.result.transcript_checkpoint.provider_retried,
    false
  );
  assert.equal(
    transcription.result.transcript_checkpoint.zero_duration_segments_merged,
    1
  );
  assert.equal(recovered.credit_usage.consumed_stage5_credits, 17);
  assert.equal(appliedSegments.length, 1);
  assert.equal(appliedSegments[0].id, 'valid-provider-cue');
  assert.equal(
    appliedSegments[0].source,
    'Recovered fragment. Valid fragment.'
  );
  assert.equal(session.segments.length, 1);
  assert.equal(session.segments[0].source, appliedSegments[0].source);
});

test('unchanged app progress does not create false change-cursor events', async t => {
  const fixture = await createRunningLocalJob(t);
  const first = data(
    await fixture.service.execute('get_job', {
      job_id: fixture.created.job.job_id,
    })
  );
  const cursor = first.job.event_cursor;
  const second = data(
    await fixture.service.execute('get_job', {
      job_id: fixture.created.job.job_id,
      after_cursor: cursor,
    })
  );

  assert.equal(second.job.event_cursor, cursor);
  assert.equal(second.next_cursor, cursor);
  assert.deepEqual(second.events, []);
});

test('agent translation plans cannot silently fall back to Stage5 or charge translation credits', async t => {
  const { service } = await setup(t);
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      transcription_method: 'none',
      translation_provider: 'agent',
      target_language: 'Korean',
    })
  );
  assert.equal(plan.translation.provider, 'agent');
  assert.equal(plan.translation.stage5_fallback_allowed, false);
  assert.equal(plan.credit_usage.translation, 0);
  assert.equal(plan.credit_usage.total_stage5_credits, 0);
});

test('requesting highlights cannot silently omit the summary stage or its credit estimate', async t => {
  const { service } = await setup(t);
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      transcription_method: 'none',
      translation_provider: 'none',
      project_profile: 'stage5_korean',
      include_highlights: true,
    })
  );
  assert.equal(plan.options.include_summary, true);
  assert.ok(plan.stages.some(stage => stage.id === 'summary'));
  assert.ok(plan.credit_usage.summary > 0);
  assert.equal(
    plan.credit_usage.total_stage5_credits,
    plan.credit_usage.summary
  );
});

test('per-video glossary terms are bounded before an immutable plan is stored', async t => {
  const { service, store } = await setup(t);
  const execution = await service.execute('plan_job', {
    source: { mock: true },
    per_video_glossary: { [' '.repeat(2)]: '빈 항목' },
  });

  assert.match(executionError(execution).message, /printable, non-empty text/i);

  store.saveProfile('large-glossary', {
    target_language: 'Korean',
    glossary: Object.fromEntries(
      Array.from({ length: 600 }, (_, index) => [
        `profile-term-${index}`,
        `profile-translation-${index}`,
      ])
    ),
  });
  const mergedOverflow = await service.execute('plan_job', {
    source: { mock: true },
    project_profile: 'large-glossary',
    per_video_glossary: Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [
        `video-term-${index}`,
        `video-translation-${index}`,
      ])
    ),
  });
  assert.match(executionError(mergedOverflow).message, /more than 1000 terms/i);
});

test('a mock external-agent workflow persists, validates exact batches, and completes without credit', async t => {
  const { service, app } = await setup(t);
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      transcription_method: 'none',
      translation_provider: 'agent',
      target_language: 'Korean',
      project_profile: 'stage5_korean',
    })
  );
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'mock-agent-translation-001',
    })
  );
  assert.equal(created.job.status, 'waiting_for_agent');
  assert.equal(created.job.stage, 'translation_external');

  const batch = data(
    await service.execute('get_transcript_batch', {
      job_id: created.job.job_id,
      max_segments: 40,
    })
  );
  assert.equal(batch.segments.length, 3);
  const submitted = data(
    await service.execute('submit_translation_batch', {
      job_id: created.job.job_id,
      batch_id: batch.batch_id,
      translations: [
        {
          id: 'seg_00001',
          text: 'Translator MCP 샘플에 오신 것을 환영합니다.',
        },
        {
          id: 'seg_00002',
          text: '이 작업은 Stage5 크레딧을 사용하지 않습니다.',
        },
        { id: 'seg_00003', text: '모든 번역 구간에는 고정된 ID가 있습니다.' },
      ],
    })
  );
  assert.equal(submitted.job.status, 'completed');
  assert.equal(submitted.job.credit_usage.consumed_stage5_credits, 0);
  assert.equal(
    app.calls.filter(call => call.method === 'applyTranslationSession').length,
    1
  );
});

test('job creation is idempotent and many repeats retain one durable job', async t => {
  const { service, store } = await setup(t);
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      transcription_method: 'none',
      translation_provider: 'agent',
      target_language: 'Korean',
    })
  );
  const args = {
    plan_hash: plan.plan_hash,
    idempotency_key: 'repeat-safe-job-key',
  };
  const results = [];
  for (let index = 0; index < 20; index += 1) {
    results.push(data(await service.execute('create_job', args)));
  }
  assert.equal(new Set(results.map(result => result.job.job_id)).size, 1);
  assert.equal(store.listJobs().length, 1);
});

test('paid job creation rejects provider drift and a non-authoritative balance', async t => {
  const { service, app } = await setup(t);
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      translation_provider: 'stage5',
      target_language: 'Korean',
    })
  );
  const initial = app.getContext();
  app.setContext({
    ...initial,
    providers: {
      ...initial.providers,
      translation: { kind: 'stage5', provider: 'anthropic' },
    },
  });
  const drift = executionError(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'provider-drift-job',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  assert.match(drift.message, /provider changed after planning/i);

  app.setContext({
    ...initial,
    stage5: {
      ...initial.stage5,
      credits: { balance: 123_456, authoritative: false },
    },
  });
  const staleBalance = executionError(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'stale-balance-job',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  assert.match(
    staleBalance.message,
    /authoritative current Stage5 credit balance/i
  );
});

test('every later paid stage revalidates provider route before calling the app', async t => {
  let contextReads = 0;
  const { service, store, app } = await setup(t, 'production', {
    handlers: {
      mcpContext: async (_params, { context }) => {
        contextReads += 1;
        if (contextReads < 4) return context;
        return {
          ...context,
          providers: {
            ...context.providers,
            translation: {
              kind: 'stage5',
              provider: 'anthropic',
            },
          },
        };
      },
    },
  });
  const transcriptPath = path.join(store.root, 'provider-drift.srt');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:01:00,000\nProvider drift fixture.\n'
  );
  const plan = data(
    await service.execute('plan_job', {
      source: { transcript_path: transcriptPath },
      translation_provider: 'stage5',
      target_language: 'Korean',
    })
  );
  assert.ok(plan.credit_usage.translation > 0);
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'later-provider-drift',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  assert.equal(created.job.status, 'failed');
  assert.equal(created.job.stage, 'translation_app');
  assert.equal(created.job.error.code, 'PROVIDER_ROUTE_CHANGED');
  assert.equal(
    app.calls.filter(call => call.method === 'startTranslation').length,
    0
  );
});

test('every later paid stage rejects changed quality and pricing assumptions', async t => {
  let contextReads = 0;
  const { service, store, app } = await setup(t, 'production', {
    handlers: {
      mcpContext: async (_params, { context }) => {
        contextReads += 1;
        if (contextReads < 4) return context;
        return {
          ...context,
          planning: {
            ...context.planning,
            quality_translation: true,
          },
        };
      },
    },
  });
  const transcriptPath = path.join(store.root, 'planning-drift.srt');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:01:00,000\nPlanning drift fixture.\n'
  );
  const plan = data(
    await service.execute('plan_job', {
      source: { transcript_path: transcriptPath },
      translation_provider: 'stage5',
      target_language: 'Korean',
    })
  );
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'later-planning-drift',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  assert.equal(created.job.status, 'failed');
  assert.equal(created.job.stage, 'translation_app');
  assert.equal(created.job.error.code, 'PLANNING_ASSUMPTION_CHANGED');
  assert.equal(
    app.calls.filter(call => call.method === 'startTranslation').length,
    0
  );
});

test('every later paid stage requires a fresh authoritative sufficient balance', async t => {
  let contextReads = 0;
  const { service, store, app } = await setup(t, 'production', {
    handlers: {
      mcpContext: async (_params, { context }) => {
        contextReads += 1;
        if (contextReads < 4) return context;
        return {
          ...context,
          stage5: {
            ...context.stage5,
            credits: { balance: 0, authoritative: true },
          },
        };
      },
    },
  });
  const transcriptPath = path.join(store.root, 'low-balance.srt');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:01:00,000\nBalance fixture.\n'
  );
  const plan = data(
    await service.execute('plan_job', {
      source: { transcript_path: transcriptPath },
      translation_provider: 'stage5',
      target_language: 'Korean',
    })
  );
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'later-low-balance',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  assert.equal(created.job.status, 'failed');
  assert.equal(created.job.error.code, 'INSUFFICIENT_STAGE5_CREDITS');
  assert.equal(
    app.calls.filter(call => call.method === 'startTranslation').length,
    0
  );
});

test('cancellation during the final runtime gate suppresses the app start', async t => {
  let contextReads = 0;
  let releaseRuntimeGate;
  let runtimeGateReached;
  const runtimeGate = new Promise(resolve => {
    runtimeGateReached = resolve;
  });
  const runtimeRelease = new Promise(resolve => {
    releaseRuntimeGate = resolve;
  });
  const fixture = await setup(t, 'production', {
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'Cancellation fixture', duration_seconds: 60 },
        compatibility: [],
      }),
      mcpContext: async (_params, { context }) => {
        contextReads += 1;
        if (contextReads === 4) {
          runtimeGateReached();
          await runtimeRelease;
        }
        return context;
      },
      cancelProcessing: async () => ({ accepted: true }),
      startMediaWorkflow: async () => ({ status: 'running' }),
    },
  });
  const sourcePath = path.join(fixture.store.root, 'cancel-gate.mp4');
  await fs.writeFile(sourcePath, 'fixture');
  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'stage5',
      translation_provider: 'none',
    })
  );
  const creating = fixture.service.execute('create_job', {
    plan_hash: plan.plan_hash,
    idempotency_key: 'cancel-during-runtime-gate',
    credit_authorization: {
      confirm: 'AUTHORIZE_STAGE5_CREDITS',
      max_stage5_credits: plan.credit_usage.total_stage5_credits,
    },
  });
  await runtimeGate;
  const starting = fixture.store.listJobs()[0];
  await fixture.service.execute('cancel_job', { job_id: starting.job_id });
  releaseRuntimeGate();
  const result = data(await creating);
  assert.equal(result.job.status, 'cancelled');
  assert.equal(
    fixture.app.calls.filter(call => call.method === 'startMediaWorkflow')
      .length,
    0
  );
});

test('immutable plans retain their exact profile revision after the saved profile changes', async t => {
  const { service, store } = await setup(t);
  store.saveProfile('immutable-profile', {
    target_language: 'Korean',
    glossary: { OpenAI: '오픈AI' },
    translation_style: { max_characters_per_line: 30 },
  });
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      translation_provider: 'agent',
      project_profile: 'immutable-profile',
    })
  );
  store.saveProfile('immutable-profile', {
    target_language: 'Korean',
    glossary: { OpenAI: '변경된 표기' },
    translation_style: { max_characters_per_line: 80 },
  });
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'immutable-profile-plan',
    })
  );
  const batch = data(
    await service.execute('get_transcript_batch', {
      job_id: created.job.job_id,
    })
  );
  assert.equal(plan.profile_snapshot.glossary.OpenAI, '오픈AI');
  assert.equal(batch.glossary.OpenAI, '오픈AI');
  assert.equal(batch.project_profile, 'immutable-profile');
  assert.equal(batch.profile_revision, plan.profile_revision);
  assert.equal(batch.translation_guidance.target_language, 'Korean');
  assert.equal(batch.subtitle_constraints.maximum_characters_per_line, 30);
});

test('duplicate source detection uses media identity for URLs and content identity for local files', async t => {
  const { service, store, app } = await setup(t, 'production', {
    handlers: {
      probeSource: async input =>
        input.source.url
          ? {
              source: {
                canonical_url: input.source.url,
                extractor: 'Youtube',
                media_id: 'same-video-id',
              },
              metadata: { title: 'Same video', duration_seconds: 30 },
              compatibility: [],
            }
          : {
              metadata: { title: 'Local copy', duration_seconds: 30 },
              compatibility: [],
            },
    },
  });
  const firstUrl = data(
    await service.execute('probe_source', {
      source: { url: 'https://youtu.be/same-video-id' },
    })
  );
  const secondUrl = data(
    await service.execute('probe_source', {
      source: {
        url: 'https://www.youtube.com/watch?v=same-video-id&feature=share',
      },
    })
  );
  assert.match(firstUrl.source.source_key, /^media:sha256:[a-f0-9]{64}$/);
  assert.equal(secondUrl.source.source_key, firstUrl.source.source_key);

  const firstPath = path.join(store.root, 'first-copy.mp4');
  const secondPath = path.join(store.root, 'second-copy.mp4');
  await fs.writeFile(firstPath, 'identical-media-content');
  await fs.writeFile(secondPath, 'identical-media-content');
  const firstFile = data(
    await service.execute('probe_source', { source: { path: firstPath } })
  );
  const secondFile = data(
    await service.execute('probe_source', { source: { path: secondPath } })
  );
  assert.equal(firstFile.source.source_key, secondFile.source.source_key);
  assert.match(firstFile.source.source_key, /^file:sha256:[a-f0-9]{64}$/);
});

test('URL source identities never retain embedded credentials', async t => {
  const { service, app } = await setup(t, 'production', {
    handlers: {
      probeSource: async ({ source }) => ({
        source: {
          canonical_url: 'https://user:secret@cdn.example.com/video',
          extractor: { name: 'Youtube' },
          media_id: 'x'.repeat(2_000),
        },
        metadata: { title: 'Credential-free source', duration_seconds: 30 },
        compatibility: [],
      }),
    },
  });

  const rejected = await service.execute('probe_source', {
    source: { url: 'https://user:secret@example.com/video' },
  });
  assert.match(
    executionError(rejected).message,
    /cannot contain embedded credentials/i
  );
  assert.equal(
    app.calls.some(call => call.method === 'probeSource'),
    false,
    'credential-bearing input must be rejected before app delivery'
  );

  const probed = data(
    await service.execute('probe_source', {
      source: { url: 'https://example.com/video' },
    })
  );
  assert.equal(probed.source.url, 'https://example.com/video');
  assert.equal(probed.source.canonical_url, 'https://example.com/video');
  assert.equal(probed.source.extractor, null);
  assert.equal(probed.source.media_id, null);
  assert.match(probed.source.source_key, /^url:sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(probed), /user:secret/);
});

test('local probing cannot bind metadata from different source bytes', async t => {
  let sourcePath = '';
  const { service, store } = await setup(t, 'production', {
    handlers: {
      probeSource: async () => {
        await fs.writeFile(sourcePath, 'replacement');
        return {
          metadata: { title: 'stale metadata', duration_seconds: 60 },
          compatibility: [],
        };
      },
    },
  });
  sourcePath = path.join(store.root, 'changing-source.mp4');
  await fs.writeFile(sourcePath, 'original');

  const execution = await service.execute('plan_job', {
    source: { path: sourcePath },
    translation_provider: 'none',
    transcription_method: 'none',
  });
  assert.match(
    executionError(execution).message,
    /changed while Translator inspected its metadata/i
  );
});

test('reusing a transcription never silently reuses an old translation', async t => {
  const { service, store } = await setup(t, 'production', {
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'Reuse source', duration_seconds: 30 },
        compatibility: [],
      }),
    },
  });
  const sourcePath = path.join(store.root, 'reuse-source.mp4');
  await fs.writeFile(sourcePath, 'reusable media');
  const sourceKey = `file:sha256:${createHash('sha256')
    .update('reusable media')
    .digest('hex')}`;
  const priorPlan = store.putPlan({
    request: { source: { path: sourcePath } },
    plan: {
      source: { kind: 'local_file', path: sourcePath, source_key: sourceKey },
      credit_usage: { total_stage5_credits: 0 },
      stages: [],
    },
  });
  const priorJob = store.createJob({
    planHash: priorPlan.plan_hash,
    idempotencyKey: 'prior-translated-source',
    request: {},
  }).job;
  store.initializeTranslationSession(priorJob.job_id, {
    targetLanguage: 'Korean',
    segments: [
      {
        id: 'seg_00001',
        start: 0,
        end: 2,
        source: 'Original text',
        translation: '오래된 번역',
        status: 'reviewed',
      },
    ],
  });
  store.recordSource(priorJob.job_id, sourceKey, { status: 'completed' });

  const plan = data(
    await service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'reuse',
      translation_provider: 'agent',
      target_language: 'Korean',
    })
  );
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'reuse-transcript-not-translation',
    })
  );
  const session = store.getTranslationSession(created.job.job_id);

  assert.equal(created.job.status, 'waiting_for_agent');
  assert.equal(session.segments[0].source, 'Original text');
  assert.equal(session.segments[0].translation, '');
  assert.equal(session.segments[0].status, 'pending');
});

test('an idempotent replay survives later provider changes without starting work twice', async t => {
  const { service, app, store } = await setup(t);
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      transcription_method: 'none',
      translation_provider: 'agent',
      target_language: 'Korean',
    })
  );
  const args = {
    plan_hash: plan.plan_hash,
    idempotency_key: 'provider-independent-replay',
  };
  const first = data(await service.execute('create_job', args));
  const initial = app.getContext();
  app.setContext({
    ...initial,
    providers: {
      ...initial.providers,
      translation: { kind: 'byo', provider: 'anthropic' },
    },
  });
  const replay = data(await service.execute('create_job', args));
  assert.equal(replay.reused, true);
  assert.equal(replay.job.job_id, first.job.job_id);
  assert.equal(store.listJobs().length, 1);
});

test('concurrent paid create requests claim and send one app start', async t => {
  const fixture = await createRunningLocalJob(t);
  const startCallsBefore = fixture.app.calls.filter(
    call => call.method === 'startMediaWorkflow'
  ).length;
  const args = {
    plan_hash: fixture.plan.plan_hash,
    idempotency_key: fixture.created.job.idempotency_key,
    credit_authorization: {
      confirm: 'AUTHORIZE_STAGE5_CREDITS',
      max_stage5_credits: fixture.plan.credit_usage.total_stage5_credits,
    },
  };
  const replays = await Promise.all(
    Array.from({ length: 20 }, () =>
      fixture.service.execute('create_job', args)
    )
  );
  assert.ok(replays.every(result => result.isError === false));
  assert.equal(
    fixture.app.calls.filter(call => call.method === 'startMediaWorkflow')
      .length,
    startCallsBefore
  );
  assert.equal(fixture.store.listJobs().length, 1);
  assert.equal(JSON.stringify(replays).includes('claim_owner'), false);
  assert.equal(JSON.stringify(replays).includes('test-owner-'), false);
});

test('ambiguous start delivery is never restarted without an explicit retry', async t => {
  let starts = 0;
  const fixture = await createRunningLocalJob(t, {
    startMediaWorkflow: async () => {
      starts += 1;
      const error = new Error('response acknowledgement was lost');
      error.deliveryState = 'unknown';
      throw error;
    },
    processingStatus: async () => ({ inProgress: false }),
  });
  assert.equal(starts, 1);
  assert.equal(fixture.created.job.status, 'running');
  const replay = data(
    await fixture.service.execute('create_job', {
      plan_hash: fixture.plan.plan_hash,
      idempotency_key: fixture.created.job.idempotency_key,
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: fixture.plan.credit_usage.total_stage5_credits,
      },
    })
  );
  assert.equal(replay.job.status, 'blocked');
  assert.equal(replay.job.error.code, 'APP_DELIVERY_REMAINS_UNKNOWN');
  assert.equal(starts, 1);

  const refusedRetry = executionError(
    await fixture.service.execute('retry_stage', {
      job_id: replay.job.job_id,
      stage: replay.job.stages[replay.job.stage_index].id,
    })
  );
  assert.equal(refusedRetry.code, 'PAID_STAGE_RETRY_CONFIRMATION_REQUIRED');
  assert.equal(starts, 1);

  data(
    await fixture.service.execute('retry_stage', {
      job_id: replay.job.job_id,
      stage: replay.job.stages[replay.job.stage_index].id,
      confirm_paid_retry: 'RETRY_PAID_STAGE',
    })
  );
  assert.equal(
    starts,
    2,
    'only an explicit retry may resend the same operation'
  );
});

test('BYO inference retries require the same explicit paid-stage confirmation', async t => {
  let operationId = null;
  let observable = true;
  let starts = 0;
  const fixture = await setup(t, 'production', {
    context: {
      providers: {
        transcription: { kind: 'byo', provider: 'openai' },
        translation: { kind: 'byo', provider: 'openai' },
        summary: { kind: 'byo', provider: 'openai' },
        summary_high: { kind: 'byo', provider: 'openai' },
        dubbing: { kind: 'byo', provider: 'elevenlabs' },
        video_suggestions: { kind: 'byo', provider: 'openai' },
      },
    },
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'BYO retry', duration_seconds: 60 },
        compatibility: [],
      }),
      startMediaWorkflow: async params => {
        starts += 1;
        operationId = params.operationId;
        return { id: operationId, status: 'running', inProgress: true };
      },
      processingStatus: async () =>
        observable
          ? { id: operationId, status: 'running', inProgress: true }
          : { id: null, status: 'unknown', inProgress: false },
    },
  });
  const sourcePath = path.join(fixture.store.root, 'byo-retry.mp4');
  await fs.writeFile(sourcePath, 'BYO source');
  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'byo',
      translation_provider: 'none',
    })
  );
  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'byo-paid-retry-confirmation',
    })
  );
  assert.equal(created.job.status, 'running');
  assert.equal(plan.credit_usage.total_stage5_credits, 0);

  observable = false;
  const reconciled = data(
    await fixture.service.execute('get_job', { job_id: created.job.job_id })
  );
  assert.equal(reconciled.job.status, 'blocked');
  const refused = executionError(
    await fixture.service.execute('retry_stage', {
      job_id: created.job.job_id,
      stage: 'transcription',
    })
  );
  assert.equal(refused.code, 'PAID_STAGE_RETRY_CONFIRMATION_REQUIRED');
  assert.equal(refused.provider_kind, 'byo');
  assert.equal(starts, 1);

  const retried = data(
    await fixture.service.execute('retry_stage', {
      job_id: created.job.job_id,
      stage: 'transcription',
      confirm_paid_retry: 'RETRY_PAID_STAGE',
    })
  );
  assert.equal(retried.status, 'running');
  assert.equal(starts, 2);
});

test('many cancellation triggers issue one exact cancellation request', async t => {
  const fixture = await createRunningLocalJob(t);
  const jobId = fixture.created.job.job_id;
  const results = await Promise.all(
    Array.from({ length: 30 }, () =>
      fixture.service.execute('cancel_job', { job_id: jobId })
    )
  );
  assert.ok(results.every(result => result.isError === false));
  await new Promise(resolve => setImmediate(resolve));
  const cancellationCalls = fixture.app.calls.filter(
    call => call.method === 'cancelProcessing'
  );
  assert.equal(cancellationCalls.length, 1);
  assert.equal(
    cancellationCalls[0].params.operationId,
    fixture.getActiveOperationId()
  );
});

test('a failed cancel acknowledgement can be explicitly retried without concurrent duplication', async t => {
  let cancellationAttempts = 0;
  const fixture = await createRunningLocalJob(t, {
    cancelProcessing: async () => {
      cancellationAttempts += 1;
      if (cancellationAttempts === 1) {
        return {
          cancellation: { accepted: false, reason: 'operation_mismatch' },
        };
      }
      return { cancellation: { accepted: true } };
    },
  });
  const jobId = fixture.created.job.job_id;

  assert.equal(
    (await fixture.service.execute('cancel_job', { job_id: jobId })).isError,
    true
  );
  const retry = await fixture.service.execute('cancel_job', { job_id: jobId });
  assert.equal(retry.isError, false);
  assert.equal(cancellationAttempts, 2);
});

test('empty subtitle pagination cannot silently truncate a persistent session', async t => {
  const { service } = await setup(t, 'production', {
    handlers: {
      subtitlesBatch: async () => ({ cues: [], hasMore: true }),
    },
  });
  await assert.rejects(
    () => service.readAllAppSubtitles(null, 'pagination-stall-job'),
    /reported more cues but returned an empty page/i
  );
});

test('cancel takes precedence over a previously requested checkpoint pause', async t => {
  const fixture = await createRunningLocalJob(t);
  const jobId = fixture.created.job.job_id;
  fixture.service.pauseJob(jobId);
  await fixture.service.cancelJob(jobId);
  const completed = fixture.service.completeStage(jobId, {
    status: 'completed',
  });
  assert.equal(completed.status, 'cancelled');
  assert.equal(completed.stage, 'cancelled');
});

test('pausing a blocked job preserves the retry-required checkpoint', async t => {
  const fixture = await createRunningLocalJob(t);
  const jobId = fixture.created.job.job_id;
  const current = fixture.store.requireJob(jobId);
  fixture.service.blockStage(
    jobId,
    {
      code: 'REVIEW_REQUIRED',
      message: 'Review this checkpoint before retrying.',
      suggested_action: 'retry_stage',
    },
    current.stages[current.stage_index]
  );

  const paused = fixture.service.pauseJob(jobId);
  assert.equal(paused.status, 'blocked');
  assert.equal(paused.stages[paused.stage_index].status, 'blocked');
  assert.equal(paused.error.code, 'REVIEW_REQUIRED');
  assert.equal(paused.pause_requested, false);
});

test('planning exposes limits and blocks ambiguous or destinationless outputs', async t => {
  const { service } = await setup(t, 'production', {
    handlers: {
      probeSource: async () => ({
        source: { canonical_url: 'https://example.com/video' },
        metadata: {
          title: 'Very long source',
          duration_seconds: 13 * 60 * 60,
          caption_tracks: [],
        },
        compatibility: [],
      }),
    },
  });
  const duplicateError = executionError(
    await service.execute('plan_job', {
      source: { url: 'https://example.com/video' },
      transcription_method: 'none',
      translation_provider: 'none',
      outputs: {
        presets: ['youtube_1080p', 'youtube_1080p'],
        subtitle_formats: ['srt', 'srt'],
      },
    })
  );
  assert.match(duplicateError.message, /must contain unique items/);

  const plan = data(
    await service.execute('plan_job', {
      source: { url: 'https://example.com/video' },
      transcription_method: 'none',
      translation_provider: 'none',
      outputs: {
        presets: ['youtube_1080p'],
        subtitle_formats: ['srt'],
      },
    })
  );
  const codes = new Set(plan.compatibility.map(item => item.code));
  assert.ok(codes.has('output_directory_required'));
  assert.ok(codes.has('youtube_duration_limit_exceeded'));

  const capabilities = data(await service.execute('get_capabilities', {}));
  assert.equal(
    capabilities.platform_limits.youtube.maximum_duration_seconds,
    43_200
  );
  assert.equal(capabilities.limits.translation_batch_segments, 40);
  assert.equal(capabilities.active_provider_routes.translation.kind, 'stage5');
});

test('planning distinguishes an inline manifest from default subtitle outputs', async t => {
  const { service, store } = await setup(t);
  const transcriptPath = path.join(store.root, 'manifest-source.srt');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:02,000\nSource.\n'
  );

  const inlinePlan = data(
    await service.execute('plan_job', {
      source: { transcript_path: transcriptPath },
      translation_provider: 'none',
    })
  );
  assert.deepEqual(inlinePlan.outputs.subtitle_formats, []);
  assert.deepEqual(inlinePlan.expected_outputs, ['manifest_inline']);

  const outputPlan = data(
    await service.execute('plan_job', {
      source: { transcript_path: transcriptPath },
      translation_provider: 'none',
      outputs: { output_directory: store.root },
    })
  );
  assert.deepEqual(outputPlan.outputs.subtitle_formats, ['srt']);
  assert.ok(outputPlan.expected_outputs.includes('source_subtitles_srt'));
  assert.ok(outputPlan.expected_outputs.includes('manifest_json'));

  const mediaPath = path.join(store.root, 'manifest-source.mp4');
  await fs.writeFile(mediaPath, 'media fixture');
  const noTranscript = data(
    await service.execute('plan_job', {
      source: { path: mediaPath },
      transcription_method: 'none',
      translation_provider: 'none',
      outputs: { output_directory: store.root },
    })
  );
  assert.ok(
    noTranscript.compatibility.some(
      finding => finding.code === 'subtitle_source_required'
    )
  );
});

test('transcript-only sources cannot plan a dubbing stage without media', async t => {
  const { service, store } = await setup(t);
  const transcriptPath = path.join(store.root, 'dubbing-source.srt');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:02,000\nTranscript only.\n'
  );
  const plan = data(
    await service.execute('plan_job', {
      source: { transcript_path: transcriptPath },
      translation_provider: 'agent',
      include_dubbing: true,
    })
  );
  assert.ok(
    plan.compatibility.some(
      finding => finding.code === 'media_source_required_for_dubbing'
    )
  );
  const error = executionError(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'transcript-only-dubbing',
    })
  );
  assert.match(error.message, /dubbing requires a media source/i);
});

test('publishing preparation requires a verified platform-specific artifact', async t => {
  const { service, store } = await setup(t, 'production', {
    handlers: {
      inspectMedia: async input => ({
        path: input.path,
        expected_preset: input.expectedPreset,
        expected_operation_id: input.expectedOperationId,
        passed: true,
        operation_receipt_valid: true,
        operation_receipt: { sha256: 'b'.repeat(64), bytes: 8 },
        findings: [],
      }),
    },
  });
  store.saveProfile('publishing-profile', {
    target_language: 'Korean',
    publishing: {
      youtube: {
        account: 'stage5-owner',
        channel: 'Stage5',
        visibility: 'unlisted',
        made_for_kids: false,
      },
      x: { account: '@stage5' },
    },
  });
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:publishing' },
      project_profile: 'publishing-profile',
      credit_usage: { total_stage5_credits: 0 },
      outputs: {
        output_directory: null,
        presets: ['x_long_video_720p'],
      },
      stages: [{ id: 'render_outputs', label: 'Render outputs' }],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'publishing-manifest-job',
    request: { source: { mock: true } },
  }).job;
  const xOnlyPath = path.join(store.root, 'x-only.mp4');
  await fs.writeFile(xOnlyPath, 'verified x artifact');
  const xOnlySha256 = createHash('sha256')
    .update('verified x artifact')
    .digest('hex');
  store.mutateJob(job.job_id, next => {
    next.artifacts = [
      {
        path: xOnlyPath,
        stage: 'render_outputs',
        preset: 'x_long_video_720p',
        verified: true,
      },
    ];
    next.manifest = {
      job_id: job.job_id,
      artifacts: [
        {
          path: xOnlyPath,
          preset: 'x_long_video_720p',
          exists: true,
          verified: true,
          sha256: xOnlySha256,
        },
      ],
    };
    return next;
  });
  await assert.rejects(
    () =>
      service.prepareYoutubeUpload({
        job_id: job.job_id,
        title: 'Platform-safe draft',
      }),
    /verified youtube_1080p or youtube_4k artifact/i
  );
  const xDraft = await service.prepareXPost({
    job_id: job.job_id,
    text: 'Draft',
  });
  assert.equal(xDraft.account, '@stage5');
  assert.equal(xDraft.account_tier, 'standard');
  assert.equal(xDraft.attached_preset, 'x_long_video_720p');
  assert.equal(xDraft.public_action_performed, false);
  await assert.rejects(
    () =>
      service.prepareXPost({
        job_id: job.job_id,
        text: 'x'.repeat(281),
      }),
    /standard account limit of 280/i
  );
});

test('job event pagination is lossless and rejects impossible cursors', async t => {
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:event-pagination' },
      credit_usage: { total_stage5_credits: 0 },
      stages: [{ id: 'checkpoint', label: 'Checkpoint' }],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'lossless-event-pagination',
    request: {},
  }).job;
  store.mutateJob(created.job_id, next => {
    next.status = 'paused';
    next.human_status = 'Paused for pagination fixture';
    return next;
  });
  for (let index = 0; index < 105; index += 1) {
    store.mutateJob(
      created.job_id,
      next => {
        next.percent = index;
        return next;
      },
      { eventType: 'fixture_progress', eventData: { index } }
    );
  }

  const first = await service.getJob({
    job_id: created.job_id,
    after_cursor: 0,
  });
  assert.equal(first.events.length, 100);
  assert.equal(first.has_more_events, true);
  assert.equal(first.next_cursor, first.events.at(-1).cursor);
  const second = await service.getJob({
    job_id: created.job_id,
    after_cursor: first.next_cursor,
  });
  assert.equal(second.events.length, 7);
  assert.equal(second.has_more_events, false);
  assert.equal(second.next_cursor, second.job.event_cursor);
  await assert.rejects(
    () =>
      service.getJob({
        job_id: created.job_id,
        after_cursor: second.next_cursor + 1,
      }),
    /ahead of this job's current cursor/i
  );
});

test('watch_job ignores cursorless notifications until its unchanged timeout', async t => {
  assert.equal(WATCH_JOB_MAX_WAIT_MS, 50_000);
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:watch-timeout' },
      credit_usage: { total_stage5_credits: 0 },
      stages: [{ id: 'checkpoint', label: 'Checkpoint' }],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'watch-timeout-envelope',
    request: {},
  }).job;
  const paused = store.mutateJob(created.job_id, next => {
    next.status = 'paused';
    next.human_status = 'Paused for watch timeout fixture';
    return next;
  });

  const waitMs = 120;
  let cursorlessNotificationSent = false;
  const notification = setTimeout(() => {
    cursorlessNotificationSent = true;
    service.notify(created.job_id);
  }, 20);
  t.after(() => clearTimeout(notification));
  const startedAt = performance.now();
  const watched = data(
    await service.execute('watch_job', {
      job_id: created.job_id,
      after_cursor: paused.event_cursor,
      wait_ms: waitMs,
    })
  );
  const elapsedMs = performance.now() - startedAt;

  assert.equal(cursorlessNotificationSent, true);
  assert.ok(
    elapsedMs >= waitMs - 15,
    `watch returned after ${elapsedMs}ms instead of holding for ${waitMs}ms`
  );
  assert.equal(watched.changed, false);
  assert.equal(watched.unchanged, true);
  assert.equal(watched.timed_out, true);
  assert.equal(watched.wake_reason, 'timeout');
  assert.equal(watched.requested_wait_ms, waitMs);
  assert.equal(watched.effective_wait_ms, waitMs);
  assert.ok(watched.waited_ms >= waitMs - 15);
  assert.equal(watched.next_cursor, paused.event_cursor);
  assert.equal(watched.has_more_events, false);
  assert.deepEqual(watched.events, []);
});

test('controller shutdown interrupts and drains an outstanding job watch before store close', async t => {
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:shutdown-watch' },
      credit_usage: { total_stage5_credits: 0 },
      stages: [{ id: 'checkpoint', label: 'Checkpoint' }],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'shutdown-watch',
    request: {},
  }).job;
  const paused = store.mutateJob(created.job_id, next => {
    next.status = 'paused';
    next.human_status = 'Paused for watch shutdown fixture';
    return next;
  });

  const watching = service.watchJob({
    job_id: created.job_id,
    after_cursor: paused.event_cursor,
    wait_ms: 30_000,
  });
  while (service.pendingWatchInterrupts.size === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }

  const closing = service.close('test_transport_closed');
  const watched = await watching;
  await closing;

  assert.equal(watched.timed_out, false);
  assert.equal(watched.interrupted, true);
  assert.equal(watched.interruption_reason, 'test_transport_closed');
  assert.equal(service.pendingWatchInterrupts.size, 0);
  assert.equal(service.pendingWatchCompletions.size, 0);
  assert.equal(store.requireJob(created.job_id).status, 'paused');
});

test('controller shutdown drains every in-flight v2 execution before store close', async t => {
  let releaseDoctor;
  let doctorStarted;
  const started = new Promise(resolve => {
    doctorStarted = resolve;
  });
  const { service } = await setup(t, 'production', {
    handlers: {
      mcpDoctor: async () => {
        doctorStarted();
        await new Promise(resolve => {
          releaseDoctor = resolve;
        });
        return { checks: [{ name: 'held-check', status: 'passed' }] };
      },
    },
  });
  const execution = service.execute('doctor', {});
  await started;
  let closeSettled = false;
  const closing = service.close('execution-drain-test').then(() => {
    closeSettled = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closeSettled, false);

  releaseDoctor();
  assert.equal((await execution).isError, false);
  await closing;
  assert.equal(closeSettled, true);
});

test('controller shutdown rejects late v2 executions without reconnecting to the app', async t => {
  const { service, app } = await setup(t);
  await service.close('late-execution-test');
  const appCallCount = app.calls.length;

  const execution = await service.execute('doctor', {});

  assert.equal(execution.isError, true);
  assert.equal(execution.value.error.code, 'MCP_SHUTTING_DOWN');
  assert.equal(execution.value.app.connected, false);
  assert.equal(app.calls.length, appCallCount);
});

test('graceful shutdown retains the job-activity lease until in-flight work drains', async t => {
  let releaseActivity;
  let activityStarted;
  let leaseClosed = false;
  const started = new Promise(resolve => {
    activityStarted = resolve;
  });
  const { service, store } = await setup(t, 'production', {
    ownerLeaseHooks: {
      close: () => {
        leaseClosed = true;
      },
    },
  });
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:lease-drain' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: { presets: [] },
      stages: [{ id: 'verify_outputs', label: 'Verify outputs' }],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'lease-drain-activity',
    request: {},
  }).job;
  service.verifyOutputsOnce = async () => {
    activityStarted();
    await new Promise(resolve => {
      releaseActivity = resolve;
    });
    return { passed: true, results: [] };
  };

  const execution = service.execute('verify_outputs', { job_id: job.job_id });
  await started;
  const closing = service.close('lease-drain-test');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(leaseClosed, false);

  releaseActivity();
  assert.equal((await execution).isError, false);
  await closing;
  assert.equal(leaseClosed, true);
});

test('controller shutdown preserves an in-flight start as delivery-unknown', async t => {
  let rejectStart;
  let resolveStartInvoked;
  const startPromise = new Promise((_, reject) => {
    rejectStart = reject;
  });
  const startInvoked = new Promise(resolve => {
    resolveStartInvoked = resolve;
  });
  const { service, store } = await setup(t, 'production', {
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'Pending start', duration_seconds: 60 },
        compatibility: [],
      }),
      startMediaWorkflow: async () => {
        resolveStartInvoked();
        return startPromise;
      },
    },
  });
  const sourcePath = path.join(store.root, 'pending-source.mp4');
  await fs.writeFile(sourcePath, 'fixture');
  const plan = data(
    await service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'stage5',
      translation_provider: 'none',
    })
  );
  const creating = service.execute('create_job', {
    plan_hash: plan.plan_hash,
    idempotency_key: 'shutdown-during-start',
    credit_authorization: {
      confirm: 'AUTHORIZE_STAGE5_CREDITS',
      max_stage5_credits: plan.credit_usage.total_stage5_credits,
    },
  });
  await startInvoked;
  const starting = store.listJobs()[0];
  assert.equal(starting.status, 'starting');
  service.prepareForShutdown('test_disconnect');
  const preserved = store.requireJob(starting.job_id);
  assert.equal(preserved.status, 'running');
  assert.equal(
    preserved.stages[preserved.stage_index].delivery_state,
    'unknown'
  );

  const error = new Error('controller closed');
  error.deliveryState = 'unknown';
  rejectStart(error);
  const completedRequest = await creating;
  assert.equal(completedRequest.isError, false);
});

test('validation failures issue correction-only review batches', async t => {
  let renderStarts = 0;
  const { service, store } = await setup(t, 'production', {
    handlers: {
      inspectOutputDirectory: async input => ({
        path: input.path,
        writable: true,
        available_bytes: 1_000_000_000,
        existing_files: [],
      }),
      startPresetRender: async input => {
        renderStarts += 1;
        return {
          id: input.operationId,
          status: 'running',
          inProgress: true,
        };
      },
    },
  });
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      transcription_method: 'none',
      translation_provider: 'agent',
      target_language: 'Korean',
      outputs: {
        output_directory: store.root,
        presets: ['youtube_1080p'],
      },
    })
  );
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'correction-review-job',
    })
  );
  const prematureReview = await service.execute('get_transcript_batch', {
    job_id: created.job.job_id,
    mode: 'review',
  });
  assert.equal(prematureReview.isError, true);
  assert.match(
    prematureReview.value.error.message,
    /validation-blocked correction pass/i
  );
  const batch = data(
    await service.execute('get_transcript_batch', {
      job_id: created.job.job_id,
      max_segments: 40,
    })
  );
  const submitted = data(
    await service.execute('submit_translation_batch', {
      job_id: created.job.job_id,
      batch_id: batch.batch_id,
      translations: batch.segments.map((segment, index) => ({
        id: segment.id,
        text:
          index === 0
            ? '가'.repeat(200)
            : [
                '이 작업은 크레딧을 사용하지 않습니다.',
                '모든 구간에는 고정 아이디가 있습니다.',
              ][index - 1],
      })),
    })
  );
  assert.equal(submitted.job.status, 'blocked');
  assert.equal(submitted.job.error.code, 'TRANSLATION_VALIDATION_FAILED');

  const review = data(
    await service.execute('get_transcript_batch', {
      job_id: created.job.job_id,
      mode: 'review',
      max_segments: 40,
    })
  );
  assert.deepEqual(
    review.segments.map(segment => segment.id),
    ['seg_00001']
  );
  const corrected = data(
    await service.execute('submit_translation_batch', {
      job_id: created.job.job_id,
      batch_id: review.batch_id,
      translations: [{ id: 'seg_00001', text: 'Translator MCP 샘플입니다.' }],
    })
  );
  assert.equal(corrected.job.validation, null);
  const retried = data(
    await service.execute('retry_stage', {
      job_id: created.job.job_id,
      stage: 'translation_validation',
    })
  );
  assert.equal(retried.status, 'blocked', JSON.stringify(retried.error));
  assert.equal(retried.stage, 'render_outputs');
  assert.equal(retried.error.code, 'RENDER_AUTHORIZATION_REQUIRED');
  assert.equal(retried.validation.passed, true);

  const rendering = data(
    await service.execute('render_outputs', {
      job_id: created.job.job_id,
      allow_warnings: true,
    })
  );
  assert.equal(rendering.status, 'running');
  assert.equal(renderStarts, 1);
});

test('immutable timing failures direct callers to a corrected plan instead of an ineffective text review', async t => {
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:invalid-timing' },
      source_metadata: { duration_seconds: 5 },
      project_profile: 'stage5_korean',
      profile_revision: 0,
      profile_snapshot: {
        target_language: 'Korean',
        translation_style: {},
      },
      target_language: 'Korean',
      translation: { provider: 'agent' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: { output_directory: null, presets: [] },
      stages: [{ id: 'translation_validation', label: 'Validate subtitles' }],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'immutable-timing-validation',
    request: {},
  }).job;
  store.initializeTranslationSession(job.job_id, {
    targetLanguage: 'Korean',
    mediaDurationSeconds: 5,
    segments: [
      {
        id: 'seg_1',
        start: 0,
        end: 3,
        source: 'First.',
        translation: '첫 번째입니다.',
      },
      {
        id: 'seg_2',
        start: 2.5,
        end: 4,
        source: 'Second.',
        translation: '두 번째입니다.',
      },
    ],
  });

  const blocked = await service.advanceJob(job.job_id);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.error.code, 'IMMUTABLE_SUBTITLE_TIMING_INVALID');
  assert.equal(blocked.error.suggested_action, 'plan_job');
  const review = await service.execute('get_transcript_batch', {
    job_id: job.job_id,
    mode: 'review',
  });
  assert.equal(review.isError, true);
  assert.match(review.value.error.message, /validation-blocked correction/i);
});

test('validation retry preserves translations when excessive speed is timing-constrained', async t => {
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:timing-constrained-speed' },
      source_metadata: { duration_seconds: 0.05 },
      project_profile: 'stage5_korean',
      profile_revision: 0,
      profile_snapshot: {
        target_language: 'Korean',
        translation_style: {},
      },
      target_language: 'Korean',
      translation: { provider: 'agent' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: { output_directory: null, presets: [] },
      stages: [{ id: 'translation_validation', label: 'Validate subtitles' }],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'timing-constrained-validation-retry',
    request: {},
  }).job;
  store.initializeTranslationSession(job.job_id, {
    targetLanguage: 'Korean',
    mediaDurationSeconds: 0.05,
    segments: [
      {
        id: 'seg_1',
        start: 0,
        end: 0.05,
        source: 'Go.',
        translation: '가나다라마바',
      },
    ],
  });
  store.markTranslationSegmentsForCorrection(job.job_id, ['seg_1']);
  store.mutateJob(job.job_id, next => {
    next.status = 'blocked';
    next.stage = 'translation_validation';
    next.error = { code: 'TRANSLATION_VALIDATION_FAILED' };
    next.stages[0].status = 'blocked';
    return next;
  });
  const staleReview = data(
    await service.execute('get_transcript_batch', {
      job_id: job.job_id,
      mode: 'review',
    })
  );

  const retried = data(
    await service.execute('retry_stage', {
      job_id: job.job_id,
      stage: 'translation_validation',
    })
  );
  assert.equal(retried.status, 'completed');
  assert.equal(retried.validation.passed, true);
  assert.equal(
    retried.validation.warning_code_counts.reading_speed_timing_constrained,
    1
  );
  const session = store.getTranslationSession(job.job_id);
  assert.equal(session.segments[0].translation, '가나다라마바');
  assert.equal(session.segments[0].status, 'translated');
  assert.equal(retried.credit_usage.consumed_stage5_credits, 0);
  const rejectedStaleReview = await service.execute(
    'submit_translation_batch',
    {
      job_id: job.job_id,
      batch_id: staleReview.batch_id,
      translations: [{ id: 'seg_1', text: '다른 번역' }],
    }
  );
  assert.equal(rejectedStaleReview.isError, true);
  assert.equal(
    store.getTranslationSession(job.job_id).segments[0].translation,
    '가나다라마바'
  );
});

test('manifest retries reuse identical partial text outputs and complete only after the manifest write', async t => {
  const writes = [];
  const persistedText = new Map();
  const physicalWrites = [];
  let failVttOnce = true;
  const { service, store } = await setup(t, 'production', {
    handlers: {
      inspectOutputDirectory: async input => ({
        path: input.path,
        writable: true,
        available_bytes: 1_000_000_000,
        existing_files: [],
      }),
      writeAgentOutputText: async input => {
        writes.push({ ...input });
        if (String(input.path).endsWith('.vtt') && failVttOnce) {
          failVttOnce = false;
          throw new Error('simulated VTT write failure');
        }
        if (persistedText.has(input.path)) {
          if (persistedText.get(input.path) !== input.content) {
            throw new Error(`text output changed during retry: ${input.path}`);
          }
          return {
            path: input.path,
            bytes: Buffer.byteLength(input.content),
            reused: true,
            sha256: createHash('sha256').update(input.content).digest('hex'),
          };
        }
        persistedText.set(input.path, input.content);
        physicalWrites.push(input.path);
        await fs.writeFile(input.path, input.content, 'utf8');
        return {
          path: input.path,
          bytes: Buffer.byteLength(input.content),
          reused: false,
          sha256: createHash('sha256').update(input.content).digest('hex'),
        };
      },
    },
  });
  const transcriptPath = path.join(store.root, 'source.srt');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:03,000\nOne.\n\n2\n00:00:03,200 --> 00:00:07,000\nTwo.\n'
  );
  const plan = data(
    await service.execute('plan_job', {
      source: { transcript_path: transcriptPath },
      translation_provider: 'agent',
      target_language: 'Korean',
      outputs: {
        output_directory: store.root,
        base_name: 'manifest-retry',
        subtitle_formats: ['srt', 'vtt', 'ass'],
        subtitle_style: 'Classic',
        subtitle_font_size: 36,
      },
    })
  );
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'manifest-partial-retry',
    })
  );
  const batch = data(
    await service.execute('get_transcript_batch', {
      job_id: created.job.job_id,
      max_segments: 40,
    })
  );
  const submitted = data(
    await service.execute('submit_translation_batch', {
      job_id: created.job.job_id,
      batch_id: batch.batch_id,
      translations: [
        { id: batch.segments[0].id, text: '하나입니다.' },
        { id: batch.segments[1].id, text: '둘입니다.' },
      ],
    })
  );
  assert.equal(submitted.job.status, 'failed');
  assert.equal(submitted.job.stage, 'manifest');
  assert.equal(submitted.job.manifest, null);

  const retried = data(
    await service.execute('retry_stage', {
      job_id: created.job.job_id,
      stage: 'manifest',
    })
  );
  assert.equal(retried.status, 'completed', JSON.stringify(retried.error));
  assert.ok(retried.manifest?.manifest_path?.endsWith('manifest.json'));
  const srtWrites = writes.filter(write => write.path.endsWith('.srt'));
  assert.equal(srtWrites.length, 4);
  for (const outputPath of new Set(srtWrites.map(write => write.path))) {
    const attempts = srtWrites.filter(write => write.path === outputPath);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].content, attempts[1].content);
  }
  assert.equal(
    physicalWrites.filter(outputPath => outputPath.endsWith('.srt')).length,
    2,
    'an exact partial output is reused instead of overwritten'
  );
  const sourceWrite = writes.find(write =>
    write.path.endsWith('manifest-retry-source.srt')
  );
  const translatedWrite = writes.find(write =>
    write.path.endsWith('manifest-retry.srt')
  );
  assert.match(sourceWrite.content, /One\./);
  assert.doesNotMatch(sourceWrite.content, /하나입니다/);
  assert.match(translatedWrite.content, /하나입니다/);
  assert.doesNotMatch(translatedWrite.content, /One\./);
  assert.ok(
    retried.manifest.artifacts.some(
      artifact => artifact.kind === 'source_transcript_srt'
    )
  );
  assert.ok(
    retried.manifest.artifacts.some(
      artifact => artifact.kind === 'translated_subtitles_srt'
    )
  );
  const assWrite = writes.find(write => write.path.endsWith('.ass'));
  assert.match(assWrite.content, /Style: Classic,Noto Sans,36,&H0000FFFF/);
  assert.match(assWrite.content, /Dialogue: .*?,Classic,,/);
  assert.equal(
    writes.filter(write => write.path.endsWith('manifest.json')).length,
    1
  );
  const manifestWrite = writes.find(write =>
    write.path.endsWith('manifest.json')
  );
  assert.equal(manifestWrite.content.includes('claim_owner'), false);
  assert.equal(manifestWrite.content.includes('a'.repeat(64)), false);
});

test('a persisted manifest checkpoint completes after a pre-advance crash without rewriting', async t => {
  let manifestWrites = 0;
  const { service, store } = await setup(t, 'production', {
    handlers: {
      writeAgentOutputText: async input => {
        manifestWrites += 1;
        await fs.writeFile(input.path, input.content, 'utf8');
        return {
          path: input.path,
          bytes: Buffer.byteLength(input.content),
          sha256: createHash('sha256').update(input.content).digest('hex'),
          reused: false,
        };
      },
    },
  });
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:manifest-checkpoint' },
      outputs: {
        output_directory: store.root,
        base_name: 'checkpoint',
        subtitle_formats: [],
        presets: [],
        overwrite: false,
      },
      credit_usage: { total_stage5_credits: 0 },
      stages: [{ id: 'manifest', label: 'Manifest' }],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'persisted-manifest-checkpoint',
    request: { source: { mock: true } },
  }).job;
  const claimed = store.claimCurrentStage(
    created.job_id,
    `mcp-v2:${created.job_id}:manifest`
  ).job;
  const projected = await service.buildManifest(created.job_id, {
    write: false,
    projectManifestCompletion: true,
  });
  const written = await service.writeManifest(created.job_id, projected);
  store.mutateJob(created.job_id, next => {
    next.manifest = written;
    next.stages[next.stage_index].status = 'failed';
    next.status = 'failed';
    next.error = { message: 'simulated crash before stage advance' };
    return next;
  });

  const retried = data(
    await service.execute('retry_stage', {
      job_id: created.job_id,
      stage: claimed.stage,
    })
  );
  assert.equal(retried.status, 'completed', JSON.stringify(retried.error));
  assert.equal(manifestWrites, 1);
  assert.equal(retried.stages[0].result.reused_persisted_checkpoint, true);
});

test('credit observations replace the same operation ledger entry instead of accumulating', async t => {
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:credit-ledger' },
      credit_usage: { total_stage5_credits: 100 },
      stages: [{ id: 'transcription', label: 'Transcribe' }],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'credit-ledger-replacement',
    request: { source: { mock: true } },
    creditAuthorization: { max_stage5_credits: 100 },
  }).job;
  store.claimCurrentStage(created.job_id, 'credit-operation');
  service.markStageRunning(created.job_id, {
    credit_usage: { stage5_credits_consumed: 10 },
  });
  const updated = service.markStageRunning(created.job_id, {
    credit_usage: { stage5_credits_consumed: 12 },
  });
  assert.equal(updated.credit_usage.consumed_stage5_credits, 12);
  assert.equal(updated.credit_usage.entries.length, 1);
});

test('internal output receipt sidecars never become public job artifacts', async t => {
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:receipt-sidecar' },
      credit_usage: { total_stage5_credits: 0 },
      stages: [{ id: 'render_outputs', label: 'Render outputs' }],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'receipt-sidecar-artifact-filter',
    request: {},
  }).job;
  const outputPath = '/tmp/translated-output.mp4';
  const receiptPath = '/tmp/.translated-output.mp4.receipt.json';
  const completed = service.completeStage(job.job_id, {
    outputs: [
      {
        path: outputPath,
        preset: 'youtube_1080p',
        metadata: {
          path: outputPath,
          operation_receipt: { receipt_path: receiptPath },
        },
      },
    ],
  });
  assert.deepEqual(
    completed.artifacts.map(artifact => artifact.path),
    [outputPath]
  );
  assert.equal(JSON.stringify(completed).includes(receiptPath), true);
  assert.equal(
    completed.artifacts.some(artifact => artifact.path === receiptPath),
    false
  );
  const publicJob = data(
    await service.execute('get_job', { job_id: completed.job_id })
  );
  assert.equal(JSON.stringify(publicJob).includes(receiptPath), false);
});

test('late callbacks from an earlier stage attempt cannot mutate a newer generation', async t => {
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:stage-fence' },
      credit_usage: { total_stage5_credits: 0 },
      stages: [
        { id: 'local_checkpoint', label: 'Local checkpoint' },
        { id: 'successor', label: 'Successor' },
      ],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'stage-attempt-generation-fence',
    request: {},
  }).job;
  const firstClaim = store.claimCurrentStage(
    created.job_id,
    `mcp-v2:${created.job_id}:local_checkpoint`
  ).job;
  const staleStage = structuredClone(firstClaim.stages[0]);
  store.mutateJob(firstClaim.job_id, next => {
    next.stages[0].status = 'retrying';
    next.status = 'queued';
    return next;
  });
  const secondClaim = store.claimCurrentStage(
    created.job_id,
    staleStage.operation_id
  ).job;
  assert.equal(secondClaim.stages[0].attempts, 2);

  service.completeStage(created.job_id, { stale: true }, staleStage);
  service.failStage(created.job_id, new Error('stale failure'), staleStage);
  service.markStageRunning(created.job_id, { stale: true }, staleStage);
  const stillCurrent = store.requireJob(created.job_id);
  assert.equal(stillCurrent.stage_index, 0);
  assert.equal(stillCurrent.status, 'starting');
  assert.equal(stillCurrent.stages[0].attempts, 2);
  assert.equal(stillCurrent.stages[0].result, null);

  service.completeStage(
    created.job_id,
    { current: true },
    secondClaim.stages[0]
  );
  const advanced = store.requireJob(created.job_id);
  assert.equal(advanced.stage_index, 1);
  assert.equal(advanced.stage, 'successor');
});

test('an abandoned app start becomes delivery-unknown and is never replayed implicitly', async t => {
  const { service, store, app } = await setup(t, 'production', {
    handlers: {
      processingStatus: async () => ({ inProgress: false }),
    },
  });
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:abandoned-start' },
      credit_usage: { total_stage5_credits: 0 },
      stages: [{ id: 'transcription', label: 'Transcription' }],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'abandoned-app-start-recovery',
    request: {},
  }).job;
  store.claimCurrentStage(
    created.job_id,
    `mcp-v2:${created.job_id}:transcription`
  );

  const reconciled = await service.getJob({ job_id: created.job_id });
  assert.equal(reconciled.job.status, 'blocked');
  assert.equal(reconciled.job.error.code, 'APP_DELIVERY_REMAINS_UNKNOWN');
  assert.equal(
    app.calls.filter(call => call.method === 'processingStatus').length,
    1
  );
  assert.equal(
    app.calls.filter(call => call.method === 'startMediaWorkflow').length,
    0
  );
});

test('an abandoned local start blocks behind its fenced retry checkpoint', async t => {
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:abandoned-local-start' },
      credit_usage: { total_stage5_credits: 0 },
      stages: [{ id: 'manifest', label: 'Manifest' }],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'abandoned-local-start-recovery',
    request: {},
  }).job;
  store.claimCurrentStage(created.job_id, `mcp-v2:${created.job_id}:manifest`);

  const reconciled = await service.getJob({ job_id: created.job_id });
  assert.equal(reconciled.job.status, 'blocked');
  assert.equal(reconciled.job.error.code, 'LOCAL_STAGE_OWNERSHIP_UNKNOWN');
  assert.equal(reconciled.job.recoverability.resume_from_stage, 'manifest');
});

test('a foreign status request preserves a live exact stage owner and recovers after lease loss', async t => {
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:live-stage-owner' },
      credit_usage: { total_stage5_credits: 0 },
      stages: [{ id: 'manifest', label: 'Manifest' }],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'live-stage-owner-reconciliation',
    request: {},
  }).job;
  const descriptor = await service.ensureOwnerLease();
  store.claimCurrentStage(
    created.job_id,
    `mcp-v2:${created.job_id}:manifest`,
    descriptor
  );

  const live = await service.getJob({ job_id: created.job_id });
  assert.equal(live.job.status, 'starting');
  assert.equal(live.job.stages[0].status, 'starting');

  service.probeOwnerLease = async () => false;
  const abandoned = await service.getJob({ job_id: created.job_id });
  assert.equal(abandoned.job.status, 'blocked');
  assert.equal(abandoned.job.error.code, 'LOCAL_STAGE_OWNERSHIP_UNKNOWN');
});

test('a batch cancelled before submission cannot mutate its translation session', async t => {
  const { service, store } = await setup(t);
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      translation_provider: 'agent',
      target_language: 'Korean',
    })
  );
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'cancelled-translation-batch',
    })
  );
  const batch = data(
    await service.execute('get_transcript_batch', {
      job_id: created.job.job_id,
    })
  );
  const before = store.getTranslationSession(created.job.job_id);
  await service.execute('cancel_job', { job_id: created.job.job_id });
  const rejected = executionError(
    await service.execute('submit_translation_batch', {
      job_id: created.job.job_id,
      batch_id: batch.batch_id,
      translations: batch.segments.map(segment => ({
        id: segment.id,
        text: '취소 후에는 저장되지 않습니다.',
      })),
    })
  );
  assert.match(rejected.message, /no longer accepts this translation batch/i);
  assert.deepEqual(
    store.getTranslationSession(created.job.job_id).segments,
    before.segments
  );
});

test('missing planned output artifacts cannot pass verification', async t => {
  const { service, store } = await setup(t);
  const plan = store.putPlan({
    request: { source: { path: '/tmp/source.mp4' } },
    plan: {
      source: { kind: 'local_file', path: '/tmp/source.mp4' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: { presets: ['youtube_1080p', 'x_long_video_720p'] },
      stages: [{ id: 'verify_outputs', label: 'Verify outputs' }],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'missing-output-verification',
    request: {},
  }).job;
  const verification = await service.inspectJobArtifacts(job.job_id);
  assert.equal(verification.passed, false);
  assert.equal(verification.expected_artifact_count, 2);
  assert.equal(verification.artifact_count, 0);
  assert.ok(
    verification.results.every(result =>
      result.findings.some(finding => finding.code === 'planned_output_missing')
    )
  );
});

test('repeated render authorization cannot reclaim a starting render stage', async t => {
  const { service, store, app } = await setup(t);
  const plan = store.putPlan({
    request: { source: { path: '/tmp/source.mp4' } },
    plan: {
      source: { kind: 'local_file', path: '/tmp/source.mp4' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: { presets: ['youtube_1080p'] },
      stages: [{ id: 'render_outputs', label: 'Render outputs' }],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'starting-render-replay',
    request: {},
  }).job;
  const claimed = store.claimCurrentStage(
    job.job_id,
    `mcp-v2:${job.job_id}:render_outputs`,
    { endpoint: 'owner', token: 'secret' }
  ).job;
  const starting = store.mutateJob(job.job_id, next => {
    next.validation = { passed: true, warning_count: 0, issues: [] };
    return next;
  });
  const callsBefore = app.calls.length;

  const replayed = await service.renderOutputs(job.job_id, false);

  assert.equal(claimed.stages[0].status, 'starting');
  assert.equal(replayed.stages[0].status, 'starting');
  assert.equal(replayed.stages[0].attempts, 1);
  assert.equal(store.requireJob(job.job_id).revision, starting.revision);
  assert.equal(app.calls.length, callsBefore);
});

test('failed and cancelled compound renders preserve each completed output checkpoint', async t => {
  for (const terminalStatus of ['failed', 'cancelled']) {
    await t.test(terminalStatus, async subtest => {
      let operationId = null;
      let completedPath = null;
      let missingPath = null;
      const { service, store } = await setup(subtest, 'production', {
        handlers: {
          processingStatus: async () => ({
            id: operationId,
            status: terminalStatus,
            inProgress: false,
            error:
              terminalStatus === 'failed'
                ? 'The second preset encoder failed.'
                : null,
            result: {
              operationId,
              incomplete: true,
              outputs: [
                {
                  preset: 'youtube_1080p',
                  path: completedPath,
                  metadata: { operation_receipt_valid: true },
                },
                {
                  preset: 'x_long_video_720p',
                  path: missingPath,
                  metadata: { operation_receipt_valid: false },
                },
              ],
            },
          }),
        },
      });
      completedPath = path.join(store.root, `${terminalStatus}-youtube.mp4`);
      missingPath = path.join(store.root, `${terminalStatus}-missing-x.mp4`);
      await fs.writeFile(completedPath, `${terminalStatus} complete output`);
      const plan = store.putPlan({
        request: { source: { path: '/tmp/source.mp4' } },
        plan: {
          source: { kind: 'local_file', path: '/tmp/source.mp4' },
          credit_usage: { total_stage5_credits: 0 },
          outputs: {
            presets: ['youtube_1080p', 'x_long_video_720p'],
          },
          stages: [{ id: 'render_outputs', label: 'Render outputs' }],
        },
      });
      const created = store.createJob({
        planHash: plan.plan_hash,
        idempotencyKey: `partial-render-${terminalStatus}`,
        request: {},
      }).job;
      operationId = `mcp-v2:${created.job_id}:render_outputs`;
      store.mutateJob(created.job_id, job => {
        job.status = 'running';
        job.stage = 'render_outputs';
        job.stages[0].status = 'running';
        job.stages[0].operation_id = operationId;
        job.stages[0].delivery_state = 'acknowledged';
        return job;
      });

      const reconciled = data(
        await service.execute('get_job', { job_id: created.job_id })
      ).job;

      assert.equal(reconciled.status, terminalStatus);
      assert.equal(reconciled.stages[0].result.incomplete, true);
      assert.equal(reconciled.artifacts.length, 1);
      assert.equal(reconciled.artifacts[0].path, path.resolve(completedPath));
      assert.equal(reconciled.artifacts[0].stage, 'render_outputs');
      assert.equal(reconciled.artifacts[0].preset, 'youtube_1080p');
      assert.equal(reconciled.artifacts[0].partial, true);
      assert.equal(reconciled.artifacts[0].verified, false);
      assert.match(reconciled.artifacts[0].checkpoint_sha256, /^[a-f0-9]{64}$/);
      assert.equal(
        reconciled.artifacts[0].checkpoint_bytes,
        Buffer.byteLength(`${terminalStatus} complete output`)
      );
    });
  }
});

test('output verification requires the exact render operation receipt', async t => {
  const inspected = [];
  const { service, store } = await setup(t, 'production', {
    handlers: {
      inspectMedia: async params => {
        inspected.push(params);
        return {
          path: params.path,
          expected_preset: params.expectedPreset,
          expected_operation_id: params.expectedOperationId,
          operation_receipt_valid: false,
          passed: true,
          findings: [],
        };
      },
    },
  });
  const plan = store.putPlan({
    request: { source: { path: '/tmp/source.mp4' } },
    plan: {
      source: { kind: 'local_file', path: '/tmp/source.mp4' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: {
        presets: ['youtube_1080p'],
        x_account_tier: 'standard',
      },
      stages: [
        { id: 'render_outputs', label: 'Render outputs' },
        { id: 'verify_outputs', label: 'Verify outputs' },
      ],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'exact-output-receipt-verification',
    request: {},
  }).job;
  const renderOperationId = `mcp-v2:${job.job_id}:render_outputs`;
  store.mutateJob(
    job.job_id,
    next => {
      next.stages[0].status = 'completed';
      next.stages[0].operation_id = renderOperationId;
      next.stage_index = 1;
      next.stage = 'verify_outputs';
      next.artifacts = [
        {
          path: '/tmp/youtube.mp4',
          stage: 'render_outputs',
          preset: 'youtube_1080p',
          verified: false,
        },
      ];
      return next;
    },
    { eventType: 'test_render_completed' }
  );

  const verification = await service.inspectJobArtifacts(job.job_id);
  assert.equal(verification.passed, false);
  assert.ok(
    verification.results[0].findings.some(
      finding => finding.code === 'operation_receipt_integrity_failed'
    )
  );
  assert.equal(inspected.length, 1);
  assert.equal(
    inspected[0].expectedOperationId,
    `${renderOperationId}-encode-1`
  );
});

test('output verification persists hashed frames extracted from the finished render', async t => {
  const { service, store } = await setup(t, 'production', {
    handlers: {
      inspectMedia: async params => {
        assert.equal(params.representativeFrames.outputDirectory, store.root);
        const frameArtifacts = [];
        for (let index = 1; index <= 3; index += 1) {
          const framePath = path.join(
            params.representativeFrames.outputDirectory,
            `${params.representativeFrames.baseName}-${index}.png`
          );
          const content = `finished output frame ${index}`;
          await fs.writeFile(framePath, content);
          frameArtifacts.push({
            path: framePath,
            bytes: Buffer.byteLength(content),
            sha256: createHash('sha256').update(content).digest('hex'),
            operation_id: `${params.representativeFrames.operationId}-${index}`,
            kind: `verified_output_frame_${index}`,
          });
        }
        return {
          path: params.path,
          expected_preset: params.expectedPreset,
          expected_operation_id: params.expectedOperationId,
          passed: true,
          operation_receipt_valid: true,
          operation_receipt: {
            sha256: createHash('sha256')
              .update('finished rendered video')
              .digest('hex'),
            bytes: Buffer.byteLength('finished rendered video'),
          },
          findings: [],
          representative_frames: {
            frames: frameArtifacts.map(frame => frame.path),
            artifacts: frameArtifacts,
            positions_seconds: [1, 5, 9],
          },
        };
      },
    },
  });
  const outputPath = path.join(store.root, 'finished-youtube.mp4');
  await fs.writeFile(outputPath, 'finished rendered video');
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:finished-frame-check' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: {
        output_directory: store.root,
        base_name: 'finished',
        overwrite: false,
        presets: ['youtube_1080p'],
        x_account_tier: 'standard',
      },
      stages: [
        { id: 'render_outputs', label: 'Render outputs' },
        { id: 'verify_outputs', label: 'Verify outputs' },
      ],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'finished-output-frame-verification',
    request: {},
  }).job;
  const renderOperationId = `mcp-v2:${job.job_id}:render_outputs`;
  store.mutateJob(job.job_id, next => {
    next.stages[0].status = 'completed';
    next.stages[0].operation_id = renderOperationId;
    next.stage_index = 1;
    next.stage = 'verify_outputs';
    next.artifacts = [
      {
        path: outputPath,
        kind: 'video',
        stage: 'render_outputs',
        preset: 'youtube_1080p',
        verified: false,
      },
    ];
    return next;
  });

  const verification = await service.verifyOutputs(job.job_id);
  assert.equal(verification.passed, true);
  const persisted = store.requireJob(job.job_id);
  const frames = persisted.artifacts.filter(
    artifact => artifact.kind === 'verified_output_frame'
  );
  assert.equal(frames.length, 3);
  assert.ok(frames.every(frame => frame.verified === true));
  assert.ok(frames.every(frame => /^[a-f0-9]{64}$/.test(frame.sha256)));
});

test('concurrent output verification calls share one inspection and persistence pass', async t => {
  let inspectCalls = 0;
  let releaseInspection;
  let inspectionStarted;
  const started = new Promise(resolve => {
    inspectionStarted = resolve;
  });
  const { service, store } = await setup(t, 'production', {
    handlers: {
      inspectMedia: async params => {
        inspectCalls += 1;
        inspectionStarted();
        await new Promise(resolve => {
          releaseInspection = resolve;
        });
        return {
          path: params.path,
          expected_preset: params.expectedPreset,
          expected_operation_id: params.expectedOperationId,
          passed: true,
          operation_receipt_valid: true,
          operation_receipt: {
            sha256: createHash('sha256')
              .update('coalesced video')
              .digest('hex'),
            bytes: Buffer.byteLength('coalesced video'),
          },
          findings: [],
        };
      },
    },
  });
  const outputPath = path.join(store.root, 'coalesced-youtube.mp4');
  await fs.writeFile(outputPath, 'coalesced video');
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:coalesced-verification' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: {
        output_directory: null,
        presets: ['youtube_1080p'],
        x_account_tier: 'standard',
      },
      stages: [
        { id: 'render_outputs', label: 'Render outputs' },
        { id: 'verify_outputs', label: 'Verify outputs' },
      ],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'coalesced-output-verification',
    request: {},
  }).job;
  const renderOperationId = `mcp-v2:${job.job_id}:render_outputs`;
  store.mutateJob(job.job_id, next => {
    next.stages[0].status = 'completed';
    next.stages[0].operation_id = renderOperationId;
    next.stage_index = 1;
    next.stage = 'verify_outputs';
    next.artifacts = [
      {
        path: outputPath,
        kind: 'video',
        stage: 'render_outputs',
        preset: 'youtube_1080p',
        verified: false,
      },
    ];
    return next;
  });

  const first = service.verifyOutputs(job.job_id);
  await started;
  const second = service.verifyOutputs(job.job_id);
  assert.equal(inspectCalls, 1);
  releaseInspection();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(secondResult, firstResult);
  assert.equal(inspectCalls, 1);
  assert.equal(
    store
      .getEvents(job.job_id)
      .filter(event => event.type === 'outputs_verified').length,
    1
  );
});

test('manifest creation rejects a rendered artifact changed after verification', async t => {
  const { service, store } = await setup(t);
  const artifactPath = path.join(store.root, 'verified-output.mp4');
  await fs.writeFile(artifactPath, 'verified bytes');
  const verifiedSha256 = createHash('sha256')
    .update('verified bytes')
    .digest('hex');
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:tamper-check' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: {
        output_directory: null,
        presets: ['youtube_1080p'],
      },
      stages: [
        { id: 'render_outputs', label: 'Render outputs' },
        { id: 'verify_outputs', label: 'Verify outputs' },
        { id: 'manifest', label: 'Manifest' },
      ],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'artifact-tamper-before-manifest',
    request: {},
  }).job;
  store.mutateJob(job.job_id, next => {
    next.artifacts = [
      {
        path: artifactPath,
        stage: 'render_outputs',
        preset: 'youtube_1080p',
        verified: false,
      },
    ];
    return next;
  });
  service.recordOutputVerification(job.job_id, {
    passed: true,
    results: [
      {
        path: artifactPath,
        expected_preset: 'youtube_1080p',
        passed: true,
        operation_receipt: { sha256: verifiedSha256 },
      },
    ],
  });
  await fs.writeFile(artifactPath, 'changed after verification');
  await assert.rejects(
    () => service.buildManifest(job.job_id),
    /integrity changed after verification/i
  );
});

test('output verification uses platform-normalized artifact identity', async t => {
  const { service, store } = await setup(t);
  const artifactPath = `${store.root}${path.sep}unused${path.sep}..${path.sep}receipt.mp4`;
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:path-identity' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: { output_directory: null, presets: [] },
      stages: [{ id: 'verify_outputs', label: 'Verify outputs' }],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'platform-path-verification',
    request: {},
  }).job;
  store.mutateJob(job.job_id, next => {
    next.artifacts = [
      {
        path: artifactPath,
        stage: 'render_outputs',
        verified: false,
      },
    ];
    return next;
  });

  service.recordOutputVerification(job.job_id, {
    passed: true,
    results: [
      {
        path: path.resolve(artifactPath),
        passed: true,
        operation_receipt: { sha256: 'a'.repeat(64) },
      },
    ],
  });

  const recorded = store.requireJob(job.job_id).artifacts[0];
  assert.equal(recorded.verified, true);
  assert.equal(recorded.verified_sha256, 'a'.repeat(64));
});

test('manifest identifies original and dubbed audio artifacts independently', async t => {
  const { service, store } = await setup(t);
  const originalAudioPath = path.join(store.root, 'source-audio.wav');
  const dubbedAudioPath = path.join(store.root, 'dubbed-audio.m4a');
  await fs.writeFile(originalAudioPath, 'original audio');
  await fs.writeFile(dubbedAudioPath, 'dubbed audio');
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:audio-manifest' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: { output_directory: null, presets: [] },
      stages: [{ id: 'manifest', label: 'Manifest' }],
    },
  });
  const job = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'manifest-audio-artifacts',
    request: {},
  }).job;
  store.mutateJob(job.job_id, next => {
    next.artifacts = [
      {
        path: originalAudioPath,
        kind: 'audio',
        stage: 'transcription',
      },
      { path: dubbedAudioPath, kind: 'audio', stage: 'dubbing' },
    ];
    return next;
  });

  const manifest = await service.buildManifest(job.job_id);
  assert.equal(manifest.files.original_audio, originalAudioPath);
  assert.equal(manifest.files.dubbed_audio, dubbedAudioPath);
});

test('a cached completed manifest is rechecked before it is returned', async t => {
  const { service, store } = await setup(t);
  const artifactPath = path.join(store.root, 'completed-output.mp4');
  const manifestPath = path.join(store.root, 'manifest.json');
  await fs.writeFile(artifactPath, 'completed output');
  const artifactSha256 = createHash('sha256')
    .update('completed output')
    .digest('hex');
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:completed-manifest' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: { output_directory: store.root, presets: [] },
      stages: [{ id: 'manifest', label: 'Manifest' }],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'completed-manifest-integrity',
    request: {},
  }).job;
  const manifest = {
    job_id: created.job_id,
    manifest_path: manifestPath,
    artifacts: [
      {
        path: artifactPath,
        exists: true,
        bytes: Buffer.byteLength('completed output'),
        sha256: artifactSha256,
      },
    ],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  store.mutateJob(created.job_id, next => {
    next.status = 'completed';
    next.stage = 'completed';
    next.manifest = manifest;
    return next;
  });

  assert.deepEqual(await service.getJobManifest(created.job_id), manifest);
  await fs.writeFile(artifactPath, 'tampered output');
  await assert.rejects(
    () => service.getJobManifest(created.job_id),
    /artifact changed after manifest creation/i
  );
  await fs.writeFile(artifactPath, 'completed output');
  await fs.writeFile(manifestPath, 'tampered manifest');
  await assert.rejects(
    () => service.getJobManifest(created.job_id),
    /manifest file changed after job completion/i
  );
});

test('a cached manifest read is bounded before JSON parsing', async t => {
  const { service, store } = await setup(t);
  const manifestPath = path.join(store.root, 'oversized-manifest.json');
  await fs.writeFile(manifestPath, Buffer.alloc(32 * 1024 * 1024 + 1, 0x20));
  const plan = store.putPlan({
    request: { source: { mock: true } },
    plan: {
      source: { kind: 'mock', source_key: 'mock:oversized-manifest' },
      credit_usage: { total_stage5_credits: 0 },
      outputs: { output_directory: null, presets: [] },
      stages: [{ id: 'manifest', label: 'Manifest' }],
    },
  });
  const created = store.createJob({
    planHash: plan.plan_hash,
    idempotencyKey: 'oversized-cached-manifest',
    request: {},
  }).job;
  store.mutateJob(created.job_id, next => {
    next.status = 'completed';
    next.stage = 'completed';
    next.manifest = {
      schema_version: 1,
      job_id: created.job_id,
      manifest_path: manifestPath,
      artifacts: [],
    };
    return next;
  });

  await assert.rejects(
    () => service.getJobManifest(created.job_id),
    /manifest file changed after job completion/i
  );
});

test('library planning binds media bytes and imported cue content while profile supplies the target language', async t => {
  let sourcePath;
  const fixture = await setup(t, 'production', {
    handlers: {
      status: async () => ({
        historyTitle: 'Exact library source',
        videoPath: sourcePath,
      }),
      probeSource: async () => ({
        metadata: { duration_seconds: 90, width: 1920, height: 1080 },
        compatibility: [],
      }),
      subtitlesBatch: async ({ offset }) => ({
        cues:
          offset === 0
            ? [
                {
                  id: 'library-cue-1',
                  start: 0,
                  end: 2,
                  source: 'Exact source text',
                  translation: 'A stale translation',
                },
              ]
            : [],
        hasMore: false,
      }),
    },
  });
  sourcePath = path.join(fixture.store.root, 'library.mp4');
  await fs.writeFile(sourcePath, 'exact library media');

  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { history_id: 'history-exact-1' },
      transcription_method: 'imported_transcript',
      translation_provider: 'agent',
      project_profile: 'stage5_korean',
    })
  );
  assert.equal(plan.target_language, 'Korean');
  assert.equal(plan.source.kind, 'library_item');
  assert.match(plan.source.source_key, /^file:sha256:[a-f0-9]{64}$/);
  assert.equal(plan.source_metadata.duration_seconds, 90);
  assert.match(plan.transcription.subtitle_source_sha256, /^[a-f0-9]{64}$/);

  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'exact-library-source',
    })
  );
  const session = fixture.store.getTranslationSession(created.job.job_id);
  assert.equal(created.job.status, 'waiting_for_agent');
  assert.equal(session.segments[0].translation, '');
  assert.equal(session.segments[0].status, 'pending');

  await fs.writeFile(sourcePath, 'changed library media');
  const changed = executionError(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'changed-library-source',
    })
  );
  assert.match(changed.message, /source changed after planning/i);
});

test('library history routing is limited to transcription and never bypasses the mounted translation session', async t => {
  let sourcePath;
  let activeOperationId = null;
  const fixture = await setup(t, 'production', {
    handlers: {
      status: async () => ({
        historyTitle: 'Library translation source',
        videoPath: sourcePath,
      }),
      probeSource: async () => ({
        metadata: { duration_seconds: 60, width: 1280, height: 720 },
        compatibility: [],
      }),
      subtitlesBatch: async ({ offset }) => ({
        cues:
          offset === 0
            ? [
                {
                  id: 'library-translation-cue',
                  start: 0,
                  end: 2,
                  source: 'Translate this exact persistent cue.',
                },
              ]
            : [],
        hasMore: false,
      }),
      startTranslation: async ({ operationId }) => {
        activeOperationId = operationId;
        return { id: operationId, status: 'running', inProgress: true };
      },
      processingStatus: async () => ({
        id: activeOperationId,
        status: 'running',
        inProgress: true,
      }),
      cancelProcessing: async () => ({ accepted: true }),
    },
  });
  sourcePath = path.join(fixture.store.root, 'library-translation.mp4');
  await fs.writeFile(sourcePath, 'library translation media');

  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { history_id: 'history-translation-1' },
      transcription_method: 'imported_transcript',
      translation_provider: 'stage5',
      target_language: 'Korean',
    })
  );
  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'library-mounted-translation',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  assert.equal(created.job.stage, 'translation_app');

  const translationStart = fixture.app.calls.find(
    call => call.method === 'startTranslation'
  );
  assert.equal(translationStart.params.historyId, undefined);
  const mounted = fixture.app.calls.find(
    call => call.method === 'applyTranslationSession'
  );
  assert.equal(mounted.params.videoPath, await fs.realpath(sourcePath));
  assert.equal(
    mounted.params.segments[0].source,
    'Translate this exact persistent cue.'
  );

  await fixture.service.execute('get_job', { job_id: created.job.job_id });
  const statusCall = fixture.app.calls.find(
    call => call.method === 'processingStatus'
  );
  assert.equal(statusCall.params.historyId, undefined);

  await fixture.service.execute('cancel_job', { job_id: created.job.job_id });
  const cancelCall = fixture.app.calls.find(
    call => call.method === 'cancelProcessing'
  );
  assert.equal(cancelCall.params.historyId, undefined);
});

test('completed app translation synchronizes the mounted exact session without a history route', async t => {
  let activeOperationId = null;
  const { service, store, app } = await setup(t, 'production', {
    handlers: {
      startTranslation: async ({ operationId }) => {
        activeOperationId = operationId;
        return { id: operationId, status: 'running', inProgress: true };
      },
      processingStatus: async () => ({
        id: activeOperationId,
        status: 'completed',
        inProgress: false,
        result: { cueCount: 1 },
      }),
      subtitlesBatch: async ({ offset, historyId }) => ({
        cues:
          offset === 0
            ? [
                {
                  id: 'cue-1',
                  start: 0,
                  end: 3,
                  source: 'Synchronize this cue.',
                  translation: '이 자막을 동기화합니다.',
                },
              ]
            : [],
        hasMore: false,
        historyId,
      }),
    },
  });
  const transcriptPath = path.join(store.root, 'mounted-translation.srt');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:03,000\nSynchronize this cue.\n'
  );
  const plan = data(
    await service.execute('plan_job', {
      source: { transcript_path: transcriptPath },
      translation_provider: 'stage5',
      target_language: 'Korean',
    })
  );
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'mounted-translation-completion',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  const completed = data(
    await service.execute('get_job', { job_id: created.job.job_id })
  ).job;
  assert.equal(completed.status, 'completed');
  assert.equal(
    store.getTranslationSession(created.job.job_id).segments[0].translation,
    '이 자막을 동기화합니다.'
  );
  const capturedPage = app.calls.find(call => call.method === 'subtitlesBatch');
  assert.equal(capturedPage.params.historyId, undefined);
});

test('library transcription status and cancellation retain the exact history route', async t => {
  let sourcePath;
  let activeOperationId = null;
  const fixture = await setup(t, 'production', {
    handlers: {
      status: async () => ({
        historyTitle: 'Library transcription source',
        videoPath: sourcePath,
      }),
      probeSource: async () => ({
        metadata: { duration_seconds: 60, width: 1280, height: 720 },
        compatibility: [],
      }),
      subtitlesBatch: async () => ({ cues: [], hasMore: false }),
      startTranscription: async ({ operationId }) => {
        activeOperationId = operationId;
        return { id: operationId, status: 'running', inProgress: true };
      },
      processingStatus: async () => ({
        id: activeOperationId,
        status: 'running',
        inProgress: true,
      }),
      cancelProcessing: async () => ({ accepted: true }),
    },
  });
  sourcePath = path.join(fixture.store.root, 'library-transcription.mp4');
  await fs.writeFile(sourcePath, 'library transcription media');

  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { history_id: 'history-transcription-1' },
      transcription_method: 'stage5',
      translation_provider: 'none',
    })
  );
  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'library-history-transcription',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  const startCall = fixture.app.calls.find(
    call => call.method === 'startTranscription'
  );
  assert.equal(startCall.params.historyId, 'history-transcription-1');

  await fixture.service.execute('get_job', { job_id: created.job.job_id });
  const statusCall = fixture.app.calls.find(
    call => call.method === 'processingStatus'
  );
  assert.equal(statusCall.params.historyId, 'history-transcription-1');

  await fixture.service.execute('cancel_job', { job_id: created.job.job_id });
  const cancelCall = fixture.app.calls.find(
    call => call.method === 'cancelProcessing'
  );
  assert.equal(cancelCall.params.historyId, 'history-transcription-1');
});

test('a profile without a target language produces an explicit blocking plan finding', async t => {
  const { service, store } = await setup(t);
  store.saveProfile('missing-target', { glossary: { OpenAI: 'OpenAI' } });
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      translation_provider: 'agent',
      project_profile: 'missing-target',
    })
  );
  assert.ok(
    plan.compatibility.some(
      finding => finding.code === 'target_language_required'
    )
  );
});

test('video transcript import requires an explicit immutable SRT instead of mounted app state', async t => {
  let mountedSubtitleReads = 0;
  const { service, store } = await setup(t, 'production', {
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'Explicit transcript', duration_seconds: 20 },
        compatibility: [],
      }),
      subtitlesBatch: async () => {
        mountedSubtitleReads += 1;
        return { cues: [], hasMore: false };
      },
    },
  });
  const sourcePath = path.join(store.root, 'explicit-video.mp4');
  const transcriptPath = path.join(store.root, 'explicit-video.srt');
  await fs.writeFile(sourcePath, 'video');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:02,000\nBound transcript.\n'
  );

  const missing = data(
    await service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'imported_transcript',
      translation_provider: 'agent',
      project_profile: 'stage5_korean',
    })
  );
  assert.ok(
    missing.compatibility.some(
      finding => finding.code === 'imported_transcript_path_required'
    )
  );

  const plan = data(
    await service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'imported_transcript',
      imported_transcript_path: transcriptPath,
      translation_provider: 'agent',
      project_profile: 'stage5_korean',
    })
  );
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'explicit-imported-srt',
    })
  );
  assert.equal(created.job.status, 'waiting_for_agent');
  assert.equal(mountedSubtitleReads, 0);
  assert.equal(
    store.getTranslationSession(created.job.job_id).segments[0].source,
    'Bound transcript.'
  );

  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:25,000\nToo long.\n'
  );
  const tooLong = data(
    await service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'imported_transcript',
      imported_transcript_path: transcriptPath,
      translation_provider: 'agent',
      project_profile: 'stage5_korean',
    })
  );
  assert.ok(
    tooLong.compatibility.some(
      finding => finding.code === 'imported_transcript_exceeds_source_duration'
    )
  );

  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:04,000\nFirst.\n\n2\n00:00:03,500 --> 00:00:06,000\nOverlapping.\n'
  );
  const overlapping = data(
    await service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'imported_transcript',
      imported_transcript_path: transcriptPath,
      translation_provider: 'agent',
      project_profile: 'stage5_korean',
    })
  );
  assert.ok(
    overlapping.compatibility.some(
      finding => finding.code === 'imported_transcript_timestamp_overlap'
    )
  );

  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:02,000\nReadable.\n\n2\ninvalid --> timecode\nMust not disappear.\n'
  );
  const malformed = data(
    await service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'imported_transcript',
      imported_transcript_path: transcriptPath,
      translation_provider: 'agent',
      project_profile: 'stage5_korean',
    })
  );
  assert.ok(
    malformed.compatibility.some(
      finding => finding.code === 'imported_transcript_malformed_cues'
    )
  );
  assert.match(
    malformed.compatibility.find(
      finding => finding.code === 'imported_transcript_malformed_cues'
    ).message,
    /never dropped silently/i
  );
});

test('a transcript source cannot be combined with a second imported transcript path', async t => {
  const { service, store } = await setup(t);
  const firstPath = path.join(store.root, 'first.srt');
  const secondPath = path.join(store.root, 'second.srt');
  await fs.writeFile(firstPath, '1\n00:00:00,000 --> 00:00:02,000\nFirst.\n');
  await fs.writeFile(secondPath, '1\n00:00:00,000 --> 00:00:02,000\nSecond.\n');

  const plan = data(
    await service.execute('plan_job', {
      source: { transcript_path: firstPath },
      transcription_method: 'imported_transcript',
      imported_transcript_path: secondPath,
      translation_provider: 'agent',
      project_profile: 'stage5_korean',
    })
  );
  assert.ok(
    plan.compatibility.some(
      finding => finding.code === 'duplicate_imported_transcript_source'
    )
  );
});

test('URL caption/import workflows download media whenever dubbing or rendering needs it', async t => {
  const { service } = await setup(t, 'production', {
    handlers: {
      probeSource: async ({ source }) => ({
        source: {
          canonical_url: source.url,
          extractor: 'youtube',
          media_id: 'stage-graph-video',
        },
        metadata: {
          title: 'Stage graph',
          duration_seconds: 60,
          caption_tracks: [
            { kind: 'creator', language: 'en', name: 'English' },
          ],
        },
        compatibility: [],
      }),
      inspectOutputDirectory: async ({ path: outputPath }) => ({
        path: outputPath,
        existing_files: [],
        available_bytes: 10_000_000_000,
      }),
    },
  });
  const renderPlan = data(
    await service.execute('plan_job', {
      source: { url: 'https://example.com/video' },
      transcription_method: 'creator_captions',
      translation_provider: 'none',
      outputs: {
        output_directory: service.store.root,
        presets: ['youtube_1080p'],
      },
    })
  );
  assert.deepEqual(
    renderPlan.stages.slice(0, 2).map(stage => stage.id),
    ['load_transcript', 'download_source']
  );

  const dubPlan = data(
    await service.execute('plan_job', {
      source: { url: 'https://example.com/video' },
      transcription_method: 'creator_captions',
      translation_provider: 'agent',
      project_profile: 'stage5_korean',
      include_dubbing: true,
    })
  );
  assert.deepEqual(
    dubPlan.stages.slice(0, 2).map(stage => stage.id),
    ['load_transcript', 'download_source']
  );
});

test('dubbing receives the exact integrity-checked planned source after external translation', async t => {
  let dubbingInput = null;
  const fixture = await setup(t, 'production', {
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'Exact dub source', duration_seconds: 30 },
        compatibility: [],
      }),
      startDubbing: async input => {
        dubbingInput = input;
        return {
          id: input.operationId,
          status: 'running',
          inProgress: true,
        };
      },
    },
  });
  const sourcePath = path.join(fixture.store.root, 'exact-dub-source.mp4');
  const transcriptPath = path.join(fixture.store.root, 'exact-dub-source.srt');
  await fs.writeFile(sourcePath, 'exact source for dubbing');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:03,000\nDub this source.\n'
  );
  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'imported_transcript',
      imported_transcript_path: transcriptPath,
      translation_provider: 'agent',
      target_language: 'Korean',
      include_dubbing: true,
    })
  );
  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'exact-dubbing-source',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  const batch = data(
    await fixture.service.execute('get_transcript_batch', {
      job_id: created.job.job_id,
      max_segments: 40,
    })
  );
  const submitted = data(
    await fixture.service.execute('submit_translation_batch', {
      job_id: created.job.job_id,
      batch_id: batch.batch_id,
      translations: [
        { id: batch.segments[0].id, text: '이 소스를 더빙합니다.' },
      ],
    })
  );
  assert.equal(submitted.job.stage, 'dubbing');
  assert.equal(submitted.job.status, 'running');
  const canonicalSourcePath = await fs.realpath(sourcePath);
  assert.equal(dubbingInput.sourceVideoPath, canonicalSourcePath);
  const mount = fixture.app.calls.find(
    call =>
      call.method === 'applyTranslationSession' &&
      call.params.videoPath === canonicalSourcePath
  );
  assert.ok(mount);
});

test('full rendering requires explicit authorization and preview artifacts persist without duplication', async t => {
  let renderStarts = 0;
  const fixture = await setup(t, 'production', {
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'Render checkpoint', duration_seconds: 30 },
        compatibility: [],
      }),
      subtitlesBatch: async ({ offset }) => ({
        cues:
          offset === 0
            ? [
                {
                  id: 'render-cue-1',
                  start: 0,
                  end: 2,
                  source: 'Preview me.',
                },
              ]
            : [],
        hasMore: false,
      }),
      inspectOutputDirectory: async ({ path: outputPath }) => ({
        path: outputPath,
        existing_files: [],
        available_bytes: 10_000_000_000,
      }),
      renderPreview: async ({ outputs }) => {
        const frames = [1, 2, 3].map(index =>
          path.join(outputs.output_directory, `preview-${index}.png`)
        );
        await Promise.all(frames.map(frame => fs.writeFile(frame, 'frame')));
        return { frames, positions_seconds: [1, 15, 29] };
      },
      startPresetRender: async ({ operationId }) => {
        renderStarts += 1;
        return { id: operationId, status: 'running', inProgress: true };
      },
    },
  });
  const sourcePath = path.join(fixture.store.root, 'render-source.mp4');
  const transcriptPath = path.join(fixture.store.root, 'render-source.srt');
  await fs.writeFile(sourcePath, 'render source');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:02,000\nPreview me.\n'
  );
  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'imported_transcript',
      imported_transcript_path: transcriptPath,
      translation_provider: 'none',
      outputs: {
        output_directory: fixture.store.root,
        subtitle_formats: ['srt'],
        presets: ['youtube_1080p'],
      },
    })
  );
  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'explicit-render-checkpoint',
    })
  );
  assert.equal(created.job.status, 'blocked');
  assert.equal(created.job.error.code, 'RENDER_AUTHORIZATION_REQUIRED');
  assert.equal(renderStarts, 0);

  const firstPreview = data(
    await fixture.service.execute('render_preview', {
      job_id: created.job.job_id,
    })
  );
  assert.equal(firstPreview.artifacts.length, 3);
  await fixture.service.execute('render_preview', {
    job_id: created.job.job_id,
  });
  const afterPreview = fixture.store.requireJob(created.job.job_id);
  assert.equal(
    afterPreview.artifacts.filter(artifact => artifact.kind === 'preview_frame')
      .length,
    3
  );

  const authorized = data(
    await fixture.service.execute('render_outputs', {
      job_id: created.job.job_id,
      allow_warnings: true,
    })
  );
  assert.equal(authorized.status, 'running');
  assert.equal(renderStarts, 1);
});

test('preview and final rendering use the durable dubbed video artifact after restart', async t => {
  let previewInput = null;
  let renderInput = null;
  const { service, store, app } = await setup(t, 'production', {
    handlers: {
      renderPreview: async input => {
        previewInput = input;
        const frame = path.join(store.root, 'dubbed-preview.png');
        await fs.writeFile(frame, 'dubbed frame');
        return { frames: [frame], positions_seconds: [1] };
      },
      startPresetRender: async input => {
        renderInput = input;
        return {
          id: input.operationId,
          status: 'running',
          inProgress: true,
        };
      },
    },
  });
  const sourcePath = path.join(store.root, 'original-source.mp4');
  const dubbedPath = path.join(store.root, 'durable-dubbed-master.mp4');
  await fs.writeFile(sourcePath, 'original media');
  await fs.writeFile(dubbedPath, 'dubbed media');
  const planRecord = store.putPlan({
    request: { source: { path: sourcePath }, include_dubbing: true },
    plan: {
      source: {
        kind: 'local_file',
        path: sourcePath,
        source_key: `file:sha256:${createHash('sha256').update('original media').digest('hex')}`,
      },
      source_metadata: { duration_seconds: 30 },
      target_language: 'Korean',
      project_profile: null,
      profile_snapshot: {},
      translation: { provider: 'none' },
      options: { include_dubbing: true },
      outputs: {
        output_directory: store.root,
        base_name: 'dubbed-output',
        presets: ['youtube_1080p'],
      },
      credit_usage: { total_stage5_credits: 0 },
      stages: [{ id: 'render_outputs', label: 'Render planned outputs' }],
    },
  });
  const created = store.createJob({
    planHash: planRecord.plan_hash,
    idempotencyKey: 'durable-dubbed-render-source',
    request: {},
  }).job;
  store.initializeTranslationSession(created.job_id, {
    targetLanguage: 'translation-not-requested',
    mediaDurationSeconds: 30,
    segments: [
      { id: 'dubbed-cue', start: 0, end: 2, source: 'Dubbed render.' },
    ],
  });
  store.mutateJob(created.job_id, job => {
    job.status = 'blocked';
    job.stage = 'render_outputs';
    job.stages[0].status = 'blocked';
    job.artifacts.push({
      path: dubbedPath,
      stage: 'dubbing',
      kind: 'video',
      verified: false,
      checkpoint_sha256: createHash('sha256')
        .update('dubbed media')
        .digest('hex'),
      checkpoint_bytes: Buffer.byteLength('dubbed media'),
    });
    job.error = { code: 'RENDER_AUTHORIZATION_REQUIRED' };
    return job;
  });

  await service.execute('render_preview', { job_id: created.job_id });
  assert.equal(previewInput.sourceVideoPath, dubbedPath);
  const previewMount = app.calls.find(
    call =>
      call.method === 'applyTranslationSession' &&
      call.params.videoPath === dubbedPath
  );
  assert.ok(previewMount);
  assert.equal(
    service.store.requireJob(created.job_id).preview.artifacts.length,
    1
  );

  const rendered = data(
    await service.execute('render_outputs', {
      job_id: created.job_id,
      allow_warnings: true,
    })
  );
  assert.equal(rendered.status, 'running');
  assert.equal(renderInput.sourceVideoPath, dubbedPath);
});

test('source bytes changed after job creation are rejected before preview or full rendering', async t => {
  let previewCalls = 0;
  let renderStarts = 0;
  const fixture = await setup(t, 'production', {
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'Mutable source', duration_seconds: 30 },
        compatibility: [],
      }),
      inspectOutputDirectory: async ({ path: outputPath }) => ({
        path: outputPath,
        existing_files: [],
        available_bytes: 10_000_000_000,
      }),
      renderPreview: async () => {
        previewCalls += 1;
        return { frames: [] };
      },
      startPresetRender: async () => {
        renderStarts += 1;
        return { status: 'running', inProgress: true };
      },
    },
  });
  const sourcePath = path.join(fixture.store.root, 'mutable-source.mp4');
  const transcriptPath = path.join(fixture.store.root, 'mutable-source.srt');
  await fs.writeFile(sourcePath, 'planned source bytes');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:02,000\nIntegrity check.\n'
  );
  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'imported_transcript',
      imported_transcript_path: transcriptPath,
      translation_provider: 'none',
      outputs: {
        output_directory: fixture.store.root,
        presets: ['youtube_1080p'],
      },
    })
  );
  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'mutable-source-before-render',
    })
  );
  assert.equal(created.job.stage, 'render_outputs');
  await fs.writeFile(sourcePath, 'different source bytes');

  const previewError = executionError(
    await fixture.service.execute('render_preview', {
      job_id: created.job.job_id,
    })
  );
  assert.equal(previewError.code, 'VIDEO_INTEGRITY_CHANGED');
  assert.equal(previewCalls, 0);

  const rendered = data(
    await fixture.service.execute('render_outputs', {
      job_id: created.job.job_id,
      allow_warnings: true,
    })
  );
  assert.equal(rendered.status, 'failed');
  assert.equal(rendered.error.code, 'VIDEO_INTEGRITY_CHANGED');
  assert.equal(renderStarts, 0);
});

test('download checkpoints bind exact media bytes and reject a changed artifact after restart', async t => {
  let activeOperationId = null;
  let downloadedPath;
  let previewCalls = 0;
  const fixture = await setup(t, 'production', {
    handlers: {
      probeSource: async ({ source }) => ({
        source: {
          canonical_url: source.url,
          extractor: 'youtube',
          media_id: 'integrity-download',
        },
        metadata: {
          title: 'Downloaded integrity source',
          duration_seconds: 30,
          caption_tracks: [
            { kind: 'creator', language: 'en', name: 'English' },
          ],
        },
        compatibility: [],
      }),
      fetchSourceCaptions: async () => ({
        content: '1\n00:00:00,000 --> 00:00:02,000\nDownloaded source.\n',
      }),
      inspectOutputDirectory: async ({ path: outputPath }) => ({
        path: outputPath,
        existing_files: [],
        available_bytes: 10_000_000_000,
      }),
      startMediaWorkflow: async ({ operationId }) => {
        activeOperationId = operationId;
        return { id: operationId, status: 'running', inProgress: true };
      },
      processingStatus: async () => ({
        id: activeOperationId,
        status: 'completed',
        inProgress: false,
        result: { runTo: 'download', videoPath: downloadedPath },
      }),
      renderPreview: async () => {
        previewCalls += 1;
        return { frames: [] };
      },
    },
  });
  downloadedPath = path.join(fixture.store.root, 'downloaded-source.mp4');
  await fs.writeFile(downloadedPath, 'download checkpoint bytes');
  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { url: 'https://example.com/integrity-download' },
      transcription_method: 'creator_captions',
      translation_provider: 'none',
      outputs: {
        output_directory: fixture.store.root,
        presets: ['youtube_1080p'],
      },
    })
  );
  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'download-artifact-integrity',
    })
  );
  assert.equal(created.job.stage, 'download_source');
  const reconciled = data(
    await fixture.service.execute('get_job', { job_id: created.job.job_id })
  ).job;
  assert.equal(reconciled.stage, 'render_outputs');
  const artifact = reconciled.artifacts.find(
    candidate => candidate.path === downloadedPath
  );
  assert.match(artifact.checkpoint_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    artifact.checkpoint_bytes,
    Buffer.byteLength('download checkpoint bytes')
  );

  await fs.writeFile(downloadedPath, 'tampered after checkpoint');
  const previewError = executionError(
    await fixture.service.execute('render_preview', {
      job_id: created.job.job_id,
    })
  );
  assert.equal(previewError.code, 'VIDEO_INTEGRITY_CHANGED');
  assert.equal(previewCalls, 0);
});

test('concurrent preview requests coalesce and block full-render authorization until completion', async t => {
  let releasePreview;
  let previewStarted;
  const previewGate = new Promise(resolve => {
    releasePreview = resolve;
  });
  const previewEntered = new Promise(resolve => {
    previewStarted = resolve;
  });
  let previewCalls = 0;
  let renderStarts = 0;
  const fixture = await setup(t, 'production', {
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'Preview lock', duration_seconds: 30 },
        compatibility: [],
      }),
      inspectOutputDirectory: async ({ path: outputPath }) => ({
        path: outputPath,
        existing_files: [],
        available_bytes: 10_000_000_000,
      }),
      renderPreview: async ({ outputs }) => {
        previewCalls += 1;
        previewStarted();
        await previewGate;
        const frame = path.join(outputs.output_directory, 'locked-preview.png');
        await fs.writeFile(frame, 'frame');
        return { frames: [frame], positions_seconds: [1] };
      },
      startPresetRender: async ({ operationId }) => {
        renderStarts += 1;
        return { id: operationId, status: 'running', inProgress: true };
      },
    },
  });
  const sourcePath = path.join(fixture.store.root, 'preview-lock.mp4');
  const transcriptPath = path.join(fixture.store.root, 'preview-lock.srt');
  await fs.writeFile(sourcePath, 'video');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:02,000\nLock me.\n'
  );
  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'imported_transcript',
      imported_transcript_path: transcriptPath,
      translation_provider: 'none',
      outputs: {
        output_directory: fixture.store.root,
        presets: ['youtube_1080p'],
      },
    })
  );
  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'preview-lock',
    })
  );

  const first = fixture.service.execute('render_preview', {
    job_id: created.job.job_id,
  });
  await previewEntered;
  const second = fixture.service.execute('render_preview', {
    job_id: created.job.job_id,
  });
  const premature = executionError(
    await fixture.service.execute('render_outputs', {
      job_id: created.job.job_id,
      allow_warnings: true,
    })
  );
  assert.match(premature.message, /preview render is still active/i);
  assert.equal(renderStarts, 0);

  releasePreview();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(data(firstResult).artifacts.length, 1);
  assert.equal(data(secondResult).artifacts.length, 1);
  assert.equal(previewCalls, 1);

  const authorized = data(
    await fixture.service.execute('render_outputs', {
      job_id: created.job.job_id,
      allow_warnings: true,
    })
  );
  assert.equal(authorized.status, 'running');
  assert.equal(renderStarts, 1);
});

test('a restarted helper observes the exact active preview before authorizing a full render', async t => {
  let previewStatusInput = null;
  let renderStarts = 0;
  const fixture = await setup(t, 'production', {
    handlers: {
      inspectOutputDirectory: async ({ path: outputPath }) => ({
        path: outputPath,
        existing_files: [],
        available_bytes: 10_000_000_000,
      }),
      processingStatus: async input => {
        previewStatusInput = input;
        return {
          id: input.operationId,
          operationId: input.operationId,
          kind: 'preview',
          status: 'running',
          inProgress: true,
        };
      },
      startPresetRender: async ({ operationId }) => {
        renderStarts += 1;
        return { id: operationId, status: 'running', inProgress: true };
      },
    },
  });
  const sourcePath = path.join(fixture.store.root, 'restarted-preview.mp4');
  const transcriptPath = path.join(fixture.store.root, 'restarted-preview.srt');
  await fs.writeFile(sourcePath, 'video');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:02,000\nStill previewing.\n'
  );
  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'imported_transcript',
      imported_transcript_path: transcriptPath,
      translation_provider: 'none',
      outputs: {
        output_directory: fixture.store.root,
        presets: ['youtube_1080p'],
      },
    })
  );
  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'restarted-helper-preview-lock',
    })
  );
  const before = fixture.store.requireJob(created.job.job_id);
  const refused = executionError(
    await fixture.service.execute('render_outputs', {
      job_id: created.job.job_id,
      allow_warnings: true,
    })
  );
  assert.match(refused.message, /preview render is still active/i);
  assert.equal(previewStatusInput.mcpJobId, created.job.job_id);
  assert.equal(
    previewStatusInput.operationId,
    `mcp-v2:${created.job.job_id}:preview`
  );
  assert.equal(renderStarts, 0);
  assert.equal(
    fixture.store.requireJob(created.job.job_id).revision,
    before.revision,
    'the blocked render checkpoint must not be mutated while preview ownership is observable'
  );
});

test('an unobservable inference operation is never replayed automatically after app restart', async t => {
  let activeOperationId = null;
  let observable = true;
  let startCount = 0;
  const fixture = await setup(t, 'production', {
    handlers: {
      probeSource: async () => ({
        metadata: { title: 'Ambiguous inference', duration_seconds: 60 },
        compatibility: [],
      }),
      startMediaWorkflow: async ({ operationId }) => {
        startCount += 1;
        activeOperationId = operationId;
        return { id: operationId, status: 'running', inProgress: true };
      },
      processingStatus: async () =>
        observable
          ? { id: activeOperationId, status: 'running', inProgress: true }
          : { id: null, status: 'unknown', inProgress: false },
    },
  });
  const sourcePath = path.join(fixture.store.root, 'ambiguous.mp4');
  await fs.writeFile(sourcePath, 'ambiguous source');
  const plan = data(
    await fixture.service.execute('plan_job', {
      source: { path: sourcePath },
      transcription_method: 'stage5',
      translation_provider: 'none',
    })
  );
  const created = data(
    await fixture.service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'ambiguous-no-replay',
      credit_authorization: {
        confirm: 'AUTHORIZE_STAGE5_CREDITS',
        max_stage5_credits: plan.credit_usage.total_stage5_credits,
      },
    })
  );
  assert.equal(created.job.status, 'running');
  observable = false;
  const reconciled = data(
    await fixture.service.execute('get_job', { job_id: created.job.job_id })
  );
  assert.equal(reconciled.job.status, 'blocked');
  assert.equal(
    reconciled.job.error.code,
    'INFERENCE_RESULT_NOT_OBSERVABLE_AFTER_APP_RESTART'
  );
  assert.equal(startCount, 1);

  const resumeAttempt = data(
    await fixture.service.execute('resume_job', {
      job_id: created.job.job_id,
    })
  );
  assert.equal(resumeAttempt.status, 'blocked');
  assert.equal(startCount, 1);

  const explicitRetry = data(
    await fixture.service.execute('retry_stage', {
      job_id: created.job.job_id,
      stage: 'transcription',
      confirm_paid_retry: 'RETRY_PAID_STAGE',
    })
  );
  assert.equal(explicitRetry.status, 'running');
  assert.equal(startCount, 2);
});

test('failed and cancelled app stages retain observed credit usage exactly once', async t => {
  for (const terminalStatus of ['failed', 'cancelled']) {
    let operationId = null;
    const fixture = await setup(t, 'production', {
      handlers: {
        probeSource: async () => ({
          metadata: { title: terminalStatus, duration_seconds: 60 },
          compatibility: [],
        }),
        startMediaWorkflow: async params => {
          operationId = params.operationId;
          return { id: operationId, status: 'running', inProgress: true };
        },
        processingStatus: async () => ({
          id: operationId,
          status: terminalStatus,
          inProgress: false,
          error: terminalStatus === 'failed' ? 'provider failed' : null,
          credit_usage: {
            stage5_credits_consumed: 17,
            before_balance: 100,
            after_balance: 83,
            authoritative: false,
          },
        }),
      },
    });
    const sourcePath = path.join(
      fixture.store.root,
      `${terminalStatus}-credits.mp4`
    );
    await fs.writeFile(sourcePath, terminalStatus);
    const plan = data(
      await fixture.service.execute('plan_job', {
        source: { path: sourcePath },
        transcription_method: 'stage5',
        translation_provider: 'none',
      })
    );
    const created = data(
      await fixture.service.execute('create_job', {
        plan_hash: plan.plan_hash,
        idempotency_key: `${terminalStatus}-credit-observation`,
        credit_authorization: {
          confirm: 'AUTHORIZE_STAGE5_CREDITS',
          max_stage5_credits: plan.credit_usage.total_stage5_credits,
        },
      })
    );
    const reconciled = data(
      await fixture.service.execute('get_job', { job_id: created.job.job_id })
    ).job;
    assert.equal(reconciled.status, terminalStatus);
    assert.equal(reconciled.credit_usage.consumed_stage5_credits, 17);
    assert.equal(reconciled.credit_usage.entries.length, 1);
  }
});

test('output base names are Unicode-safe and avoid reserved Windows devices', async t => {
  const { service } = await setup(t);
  const reserved = data(
    await service.execute('plan_job', {
      source: { mock: true },
      transcription_method: 'none',
      translation_provider: 'none',
      outputs: { base_name: 'CON' },
    })
  );
  assert.equal(reserved.outputs.base_name, '_CON');
  const emoji = '😀'.repeat(180);
  const unicode = data(
    await service.execute('plan_job', {
      source: { mock: true },
      transcription_method: 'none',
      translation_provider: 'none',
      outputs: { base_name: emoji },
    })
  );
  assert.ok(Buffer.byteLength(unicode.outputs.base_name) <= 160);
  assert.equal([...unicode.outputs.base_name].length, 40);
  assert.equal(unicode.outputs.base_name.endsWith('\ud83d'), false);

  const korean = data(
    await service.execute('plan_job', {
      source: { mock: true },
      transcription_method: 'none',
      translation_provider: 'none',
      outputs: { base_name: '한'.repeat(180) },
    })
  );
  assert.ok(Buffer.byteLength(korean.outputs.base_name) <= 160);
});

test('X character accounting weights Korean, emoji graphemes, and shortened URLs', () => {
  assert.equal(xWeightedTextLength('a'.repeat(280)), 280);
  assert.equal(xWeightedTextLength('한'.repeat(140)), 280);
  assert.equal(xWeightedTextLength('한'.repeat(141)), 282);
  assert.equal(xWeightedTextLength('👨‍👩‍👧‍👦'), 2);
  assert.equal(xWeightedTextLength('a https://example.com/long/path.'), 26);
});

test('long canonical URLs use bounded opaque source identities through durable job creation', async t => {
  const { service, store } = await setup(t, 'production', {
    handlers: {
      probeSource: async ({ source }) => ({
        source: { canonical_url: source.url },
        metadata: { title: 'Long URL', duration_seconds: 30 },
        compatibility: [],
      }),
    },
  });
  const longUrl = `https://example.com/video?token=${'a'.repeat(31_000)}`;
  const plan = data(
    await service.execute('plan_job', {
      source: { url: longUrl },
      transcription_method: 'none',
      translation_provider: 'none',
    })
  );
  assert.match(plan.source.source_key, /^url:sha256:[a-f0-9]{64}$/);
  assert.ok(plan.source.source_key.length < 100);
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'long-url-durable-source-key',
    })
  );
  assert.equal(created.job.status, 'completed');
  assert.equal(
    store.findSourceRecords(plan.source.source_key)[0].job_id,
    created.job.job_id
  );
});

test('mock mode provisions exact media and can plan a complete no-credit render workflow', async t => {
  let plannedNames = [];
  const { service, store } = await setup(t, 'production', {
    handlers: {
      inspectOutputDirectory: async ({ path: outputPath, fileNames }) => {
        plannedNames = fileNames;
        return {
          path: outputPath,
          planned_files: fileNames.map(fileName =>
            path.join(outputPath, fileName)
          ),
          existing_files: [],
          available_bytes: 10_000_000_000,
        };
      },
    },
  });
  const plan = data(
    await service.execute('plan_job', {
      source: { mock: true },
      translation_provider: 'agent',
      outputs: {
        output_directory: store.root,
        base_name: 'mock-render',
        presets: ['preview_low_resolution'],
        subtitle_formats: ['srt'],
      },
    })
  );
  assert.equal(plan.credit_usage.total_stage5_credits, 0);
  assert.match(plan.source.source_key, /^mock:v1:sha256:[a-f0-9]{64}$/);
  assert.equal((await fs.stat(plan.source.path)).isFile(), true);
  assert.ok(plan.stages.some(stage => stage.id === 'render_outputs'));
  assert.ok(plannedNames.includes('mock-render-preview-1.png'));
  assert.ok(
    plannedNames.includes('mock-render-preview_low_resolution-verified-3.png')
  );
  assert.ok(plan.expected_outputs.includes('verified_output_frames'));
  assert.ok(plan.estimated_disk_usage.representative_frame_bytes > 0);
  assert.equal(
    plan.compatibility.some(
      finding => finding.code === 'video_source_required_for_rendering'
    ),
    false
  );
});

test('overwrite authorization never permits a planned output to replace its own input', async t => {
  const { service, store } = await setup(t, 'production', {
    handlers: {
      inspectOutputDirectory: async ({ path: outputPath, fileNames }) => {
        const canonicalDirectory = await fs.realpath(outputPath);
        const plannedFiles = await Promise.all(
          fileNames.map(async fileName => {
            const candidate = path.join(canonicalDirectory, fileName);
            return fs.realpath(candidate).catch(() => candidate);
          })
        );
        return {
          path: canonicalDirectory,
          planned_files: plannedFiles,
          existing_files: plannedFiles.filter(candidate =>
            candidate.endsWith('input.srt')
          ),
          available_bytes: 10_000_000_000,
        };
      },
    },
  });
  const transcriptPath = path.join(store.root, 'input.srt');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:02,000\nDo not overwrite me.\n'
  );
  const plan = data(
    await service.execute('plan_job', {
      source: { transcript_path: transcriptPath },
      translation_provider: 'none',
      outputs: {
        output_directory: store.root,
        base_name: 'input',
        subtitle_formats: ['srt'],
        overwrite: true,
      },
    })
  );
  assert.ok(
    plan.compatibility.some(
      finding =>
        finding.severity === 'blocking' &&
        finding.code === 'output_overlaps_input'
    )
  );

  const hardlinkSource = path.join(store.root, 'hardlink-source.srt');
  const hardlinkOutput = path.join(store.root, 'hardlink-output.srt');
  await fs.writeFile(
    hardlinkSource,
    '1\n00:00:00,000 --> 00:00:02,000\nHard links count too.\n'
  );
  await fs.link(hardlinkSource, hardlinkOutput);
  const hardlinkPlan = data(
    await service.execute('plan_job', {
      source: { transcript_path: hardlinkSource },
      translation_provider: 'none',
      outputs: {
        output_directory: store.root,
        base_name: 'hardlink-output',
        subtitle_formats: ['srt'],
        overwrite: true,
      },
    })
  );
  assert.ok(
    hardlinkPlan.compatibility.some(
      finding => finding.code === 'output_overlaps_input'
    ),
    'filesystem aliases must be detected without blanket case folding'
  );
});

test('an input alias created after planning is rejected at the write checkpoint', async t => {
  const { service, store } = await setup(t, 'production', {
    handlers: {
      inspectOutputDirectory: async ({ path: outputPath, fileNames }) => ({
        path: await fs.realpath(outputPath),
        planned_files: fileNames.map(fileName =>
          path.join(outputPath, fileName)
        ),
        existing_files: [],
        available_bytes: 10_000_000_000,
      }),
    },
  });
  const transcriptPath = path.join(store.root, 'runtime-input.srt');
  const outputPath = path.join(store.root, 'runtime-output.srt');
  await fs.writeFile(
    transcriptPath,
    '1\n00:00:00,000 --> 00:00:02,000\nPreserve this input.\n'
  );
  const plan = data(
    await service.execute('plan_job', {
      source: { transcript_path: transcriptPath },
      translation_provider: 'none',
      outputs: {
        output_directory: store.root,
        base_name: 'runtime-output',
        subtitle_formats: ['srt'],
        overwrite: true,
      },
    })
  );
  assert.equal(
    plan.compatibility.some(
      finding => finding.code === 'output_overlaps_input'
    ),
    false
  );
  await fs.link(transcriptPath, outputPath);
  const created = data(
    await service.execute('create_job', {
      plan_hash: plan.plan_hash,
      idempotency_key: 'runtime-output-alias',
    })
  );
  assert.equal(created.job.status, 'failed');
  assert.equal(created.job.error.code, 'OUTPUT_OVERLAPS_INPUT');
  assert.equal(
    await fs.readFile(transcriptPath, 'utf8'),
    await fs.readFile(outputPath, 'utf8')
  );
});

test('a foreign terminal operation cannot complete or strand the exact active job', async t => {
  const fixture = await createRunningLocalJob(t, {
    processingStatus: async () => ({
      id: 'different-terminal-operation',
      status: 'completed',
      inProgress: false,
    }),
  });
  const first = data(
    await fixture.service.execute('get_job', {
      job_id: fixture.created.job.job_id,
    })
  );
  assert.equal(first.job.status, 'blocked');
  assert.equal(
    first.job.error.code,
    'INFERENCE_RESULT_NOT_OBSERVABLE_AFTER_APP_RESTART'
  );
  const second = data(
    await fixture.service.execute('get_job', {
      job_id: fixture.created.job.job_id,
    })
  );
  assert.equal(second.job.status, 'blocked');
  assert.equal(
    fixture.app.calls.filter(call => call.method === 'startMediaWorkflow')
      .length,
    1
  );
});

test('legacy video search billing follows the video-suggestion provider slot', () => {
  const stage5 = legacyToolBilling(
    'app_video_search',
    {},
    {
      providers: {
        translation: { kind: 'byo' },
        video_suggestions: { kind: 'stage5' },
      },
    }
  );
  const byo = legacyToolBilling(
    'app_video_search_more',
    {},
    {
      providers: {
        translation: { kind: 'stage5' },
        video_suggestions: { kind: 'byo' },
      },
    }
  );
  assert.equal(stage5.will_consume_stage5_credits, true);
  assert.equal(byo.will_consume_stage5_credits, false);
});

test('legacy paid tools are unmistakably labeled as lacking v2 safeguards', () => {
  assert.match(
    legacyToolDescription(
      'app_start_translation',
      'Translate mounted subtitles.'
    ),
    /not protected by MCP v2 planning.*idempotency key/i
  );
  assert.equal(
    legacyToolDescription('app_status', 'Read app status.'),
    'Read app status.'
  );
  assert.equal(
    legacyToolBilling('app_start_media_workflow', {
      run_to: 'download',
    }).will_consume_stage5_credits,
    false
  );
});
