import { canonicalJsonHash } from './canonical-json.mjs';

export const RENDER_CHECKPOINT_FORK_VERSION = 1;
export const SUBTITLE_RENDER_SELECTION_BINDING_VERSION = 1;
export const RENDER_CHECKPOINT_FORK_STAGES = Object.freeze([
  Object.freeze({ id: 'render_outputs', label: 'Render planned outputs' }),
  Object.freeze({ id: 'verify_outputs', label: 'Verify rendered outputs' }),
  Object.freeze({ id: 'manifest', label: 'Write result manifest' }),
]);

const SUBTITLE_STYLE_PRESETS = new Set([
  'Default',
  'Classic',
  'Boxed',
  'LineBox',
]);
const SUBTITLE_DISPLAY_MODES = new Set(['original', 'translation', 'dual']);
const SUBTITLE_FONT_FAMILY = 'Noto Sans';
const SUBTITLE_FONT_ASSET = 'NotoSans-Regular.ttf';
const SUBTITLE_SCALE_RULE = 'height_ratio_720_clamped_0.5_2';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function plannedSubtitleOutputFontSize(baseFontSize, videoHeight) {
  const height = Number(videoHeight);
  if (!Number.isFinite(height) || height <= 0) return null;
  const scale = Math.min(Math.max(Math.max(height, 360) / 720, 0.5), 2);
  return Math.max(6, Math.round(baseFontSize * scale));
}

export function translationSessionCheckpoint(session) {
  if (!isObject(session) || !Array.isArray(session.segments)) {
    throw new TypeError('A persistent translation session is required.');
  }
  return {
    source_hash: String(session.source_hash || ''),
    source_language: String(session.source_language || ''),
    target_language: String(session.target_language || ''),
    project_profile: session.project_profile ?? null,
    glossary: clone(session.glossary || {}),
    media_duration_seconds: session.media_duration_seconds ?? null,
    segments: session.segments.map(segment => ({
      id: String(segment?.id || ''),
      index: Number(segment?.index),
      start: Number(segment?.start),
      end: Number(segment?.end),
      start_ms: Number(segment?.start_ms),
      end_ms: Number(segment?.end_ms),
      source: String(segment?.source || ''),
      translation: String(segment?.translation || ''),
      status: String(segment?.status || ''),
      revision_count: Number(segment?.revision_count || 0),
      speaker: segment?.speaker ?? null,
      topic: segment?.topic ?? null,
    })),
  };
}

export function translationSessionCheckpointSha256(session) {
  return canonicalJsonHash(translationSessionCheckpoint(session));
}

export function validationCheckpointSha256(validation) {
  return canonicalJsonHash(validation ?? null);
}

export function creditLedgerCheckpointSha256(creditUsage) {
  return canonicalJsonHash(creditUsage ?? null);
}

export function persistentJobCheckpointSha256(job) {
  return canonicalJsonHash(job ?? null);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasRecoverableRenderCheckpoint(job) {
  const renderStages = Array.isArray(job?.stages)
    ? job.stages.filter(stage => stage?.id === 'render_outputs')
    : [];
  if (
    renderStages.length !== 1 ||
    (job?.artifacts || []).some(
      artifact => artifact?.stage === 'render_outputs'
    )
  ) {
    return false;
  }
  const stage = renderStages[0];
  const attempts = Number(stage.attempts || 0);
  if (!Number.isSafeInteger(attempts) || attempts < 0) return false;

  const neverStarted =
    job?.render_authorized !== true &&
    stage.result == null &&
    stage.finished_at == null;
  if (neverStarted && attempts === 0) {
    return (
      ['pending', 'cancelled'].includes(stage.status) &&
      stage.started_at == null &&
      stage.operation_id == null
    );
  }
  if (
    neverStarted &&
    attempts === 1 &&
    ['blocked', 'cancelled'].includes(stage.status) &&
    stage.error?.code === 'RENDER_AUTHORIZATION_REQUIRED'
  ) {
    return true;
  }

  // A render that was explicitly authorized and then durably cancelled is a
  // valid recovery source even though encoding began. Both callers separately
  // require the source job to have no active-work claim, while the artifact
  // check above and output-collision preflight prevent reuse of produced media.
  return Boolean(
    job?.status === 'cancelled' &&
    job?.stage === 'cancelled' &&
    job?.render_authorized === true &&
    hasText(job?.finished_at) &&
    stage.status === 'cancelled' &&
    attempts >= 1 &&
    hasText(stage.started_at) &&
    hasText(stage.finished_at) &&
    hasText(stage.operation_id) &&
    stage.error == null
  );
}

// Kept as an internal compatibility alias for callers compiled against the
// first recovery-tool release.
export const hasUnstartedRenderCheckpoint = hasRecoverableRenderCheckpoint;

export function stablePlanForEnvironment(plan, environment, schemaVersion) {
  if (!isObject(plan)) throw new TypeError('A candidate plan is required.');
  const stable = {
    ...clone(plan),
    schema_version: schemaVersion,
    environment,
  };
  delete stable.plan_hash;
  const planHash = canonicalJsonHash(stable);
  return { ...stable, plan_hash: planHash };
}

function assertOriginalRenderSpec(originalSpec) {
  if (!isObject(originalSpec) || originalSpec.schema_version !== 1) {
    throw new Error(
      'The source plan has no supported immutable subtitle render spec.'
    );
  }
  if (
    !['original', 'translation', 'dual'].includes(originalSpec.display_mode)
  ) {
    throw new Error('The source plan subtitle display mode is unsupported.');
  }
  if (!SUBTITLE_STYLE_PRESETS.has(originalSpec.style)) {
    throw new Error('The source plan subtitle style is unsupported.');
  }
  for (const field of [
    'base_font_size_px',
    'video_width_px',
    'video_height_px',
    'display_width_px',
    'display_height_px',
  ]) {
    if (
      !Number.isFinite(Number(originalSpec[field])) ||
      Number(originalSpec[field]) <= 0
    ) {
      throw new Error(
        `The source plan subtitle render spec ${field} is invalid.`
      );
    }
  }
}

function positivePlanNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `The legacy source plan cannot derive subtitle render spec ${field}.`
    );
  }
  return parsed;
}

function resolveSourceRenderSpec(sourcePlan, style, baseFontSize) {
  const outputs = sourcePlan.outputs;
  const storedSpec = outputs.subtitle_render_spec;
  if (storedSpec !== undefined && storedSpec !== null) {
    assertOriginalRenderSpec(storedSpec);
    return clone(storedSpec);
  }

  const displayMode = String(outputs.subtitle_display_mode || '');
  if (!SUBTITLE_DISPLAY_MODES.has(displayMode)) {
    throw new Error(
      'The legacy source plan has no supported immutable subtitle display mode.'
    );
  }
  const metadata = sourcePlan.source_metadata;
  if (!isObject(metadata)) {
    throw new Error(
      'The legacy source plan has no immutable source metadata for subtitle rendering.'
    );
  }
  const videoWidth = positivePlanNumber(metadata.width, 'video_width_px');
  const videoHeight = positivePlanNumber(metadata.height, 'video_height_px');
  const displayWidth =
    metadata.display_width === undefined || metadata.display_width === null
      ? videoWidth
      : positivePlanNumber(metadata.display_width, 'display_width_px');
  const displayHeight =
    metadata.display_height === undefined || metadata.display_height === null
      ? videoHeight
      : positivePlanNumber(metadata.display_height, 'display_height_px');

  return {
    display_mode: displayMode,
    style,
    base_font_size_px: baseFontSize,
    output_font_size_px: plannedSubtitleOutputFontSize(
      baseFontSize,
      videoHeight
    ),
    video_width_px: videoWidth,
    video_height_px: videoHeight,
    display_width_px: displayWidth,
    display_height_px: displayHeight,
    font_family: SUBTITLE_FONT_FAMILY,
    font_asset: SUBTITLE_FONT_ASSET,
    scale_rule: SUBTITLE_SCALE_RULE,
    schema_version: 1,
    field_sources: {
      display_mode: 'legacy_plan_outputs',
      style: 'render_checkpoint_fork',
      base_font_size_px: 'render_checkpoint_fork',
    },
  };
}

export function buildRenderCheckpointForkPlan({
  sourcePlan,
  sourceJobId,
  sourceJobSha256,
  sourceCheckpoint,
  translationSessionSha256,
  validationSha256,
  creditLedgerSha256,
  renderOverride,
}) {
  if (!isObject(sourcePlan)) throw new TypeError('A source plan is required.');
  const originalOutputs = sourcePlan.outputs;
  if (
    !isObject(originalOutputs) ||
    !String(originalOutputs.output_directory || '').trim() ||
    !Array.isArray(originalOutputs.presets) ||
    originalOutputs.presets.length === 0
  ) {
    throw new Error(
      'The source plan must have an output directory and rendered-video preset.'
    );
  }
  if (originalOutputs.overwrite === true) {
    throw new Error(
      'A render-checkpoint fork cannot inherit overwrite=true; create a new ordinary plan instead.'
    );
  }
  if (sourcePlan.options?.include_dubbing === true) {
    throw new Error(
      'Render-checkpoint fork recovery for a dubbed render source is not supported.'
    );
  }
  const style = String(renderOverride?.style || '');
  const baseFontSize = Number(renderOverride?.base_font_size_px);
  if (!SUBTITLE_STYLE_PRESETS.has(style)) {
    throw new TypeError('The recovery subtitle style is unsupported.');
  }
  if (
    !Number.isFinite(baseFontSize) ||
    baseFontSize < 12 ||
    baseFontSize > 96
  ) {
    throw new TypeError(
      'The recovery subtitle base font size must be between 12 and 96.'
    );
  }
  const originalSpec = resolveSourceRenderSpec(sourcePlan, style, baseFontSize);
  const outputFontSize = plannedSubtitleOutputFontSize(
    baseFontSize,
    originalSpec.video_height_px
  );
  if (!outputFontSize) {
    throw new Error(
      'The recovery subtitle output font size cannot be derived from the source checkpoint.'
    );
  }

  const subtitleRenderSpec = {
    ...clone(originalSpec),
    style,
    base_font_size_px: baseFontSize,
    output_font_size_px: outputFontSize,
    selection_binding_version: SUBTITLE_RENDER_SELECTION_BINDING_VERSION,
    field_sources: {
      ...(isObject(originalSpec.field_sources)
        ? clone(originalSpec.field_sources)
        : {}),
      style: 'render_checkpoint_fork',
      base_font_size_px: 'render_checkpoint_fork',
    },
  };
  const outputs = {
    ...clone(originalOutputs),
    subtitle_style: style,
    subtitle_font_size: baseFontSize,
    subtitle_render_spec: subtitleRenderSpec,
  };
  const options = clone(sourcePlan.options || {});
  if (isObject(options.outputs)) {
    options.outputs = {
      ...options.outputs,
      subtitle_style: style,
      subtitle_font_size: baseFontSize,
    };
  }

  const inheritedCreditLedger = {
    source_job_id: sourceJobId,
    ledger_sha256: creditLedgerSha256,
  };
  const recovery = {
    schema_version: RENDER_CHECKPOINT_FORK_VERSION,
    kind: 'render_checkpoint_fork',
    source_job_id: sourceJobId,
    source_job_sha256: sourceJobSha256,
    source_checkpoint: clone(sourceCheckpoint),
    translation_session_sha256: translationSessionSha256,
    validation_sha256: validationSha256,
    inherited_credit_ledger: inheritedCreditLedger,
    paid_stage_policy: {
      transcription: 'skip_exact_checkpoint',
      translation: 'skip_exact_checkpoint',
    },
    allowed_stages: RENDER_CHECKPOINT_FORK_STAGES.map(stage => stage.id),
  };

  const candidate = {
    ...clone(sourcePlan),
    options,
    outputs,
    stages: clone(RENDER_CHECKPOINT_FORK_STAGES),
    credit_usage: {
      transcription: 0,
      translation: 0,
      summary: 0,
      dubbing: 0,
      rendering: 0,
      total_stage5_credits: 0,
      estimate: false,
      methodology:
        'Render-checkpoint fork reuses exact settled local checkpoints and has no credit-bearing stages.',
      inherited_ledger_reference: inheritedCreditLedger,
    },
    recovery,
    no_cost_plan: true,
  };
  delete candidate.plan_hash;
  return candidate;
}

export function renderCheckpointForkPreflightDigest(receipt) {
  const stable = clone(receipt || {});
  delete stable.preflight_digest;
  if (isObject(stable.output_preflight)) {
    delete stable.output_preflight.available_bytes;
  }
  if (isObject(stable.mutation_proof)) {
    delete stable.mutation_proof.store_total_changes_before;
    delete stable.mutation_proof.store_total_changes_after;
  }
  return canonicalJsonHash(stable);
}
