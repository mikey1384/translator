import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalJsonHash } from './canonical-json.mjs';
import { buildSrt, parseSrtWithDiagnostics } from './srt.mjs';
import {
  DEFAULT_SUBTITLE_ISSUE_DETAIL_LIMIT,
  validateSubtitleSegments,
} from './subtitle-quality.mjs';
import { createJobOwnerLease, probeJobOwnerLease } from './job-owner-lease.mjs';
import {
  RENDER_CHECKPOINT_FORK_STAGES,
  RENDER_CHECKPOINT_FORK_VERSION,
  SUBTITLE_RENDER_SELECTION_BINDING_VERSION,
  buildRenderCheckpointForkPlan,
  creditLedgerCheckpointSha256,
  hasRecoverableRenderCheckpoint,
  persistentJobCheckpointSha256,
  renderCheckpointForkPreflightDigest,
  stablePlanForEnvironment,
  translationSessionCheckpointSha256,
  validationCheckpointSha256,
} from './render-checkpoint-recovery.mjs';
import { parseToolArguments } from './tool-schema-validator.mjs';
import {
  BUILTIN_PROJECT_PROFILES,
  ENCODING_PRESETS,
  JOB_STATUSES,
  MCP_SERVER_NAMES,
  MCP_SERVER_VERSION,
  MCP_V2_PROTOCOL_VERSION,
  MCP_V2_SCHEMA_VERSION,
  MCP_V2_TOOL_DEFINITIONS,
  MCP_V2_TOOL_NAMES,
  WATCH_JOB_DEFAULT_WAIT_MS,
  WATCH_JOB_MAX_WAIT_MS,
  getMcpToolBilling,
} from './mcp-v2-contract.mjs';

const DEFAULT_CREDIT_RATES = Object.freeze({
  transcription_per_hour: 28_000,
  translation_standard_per_hour: 18_912,
  translation_quality_per_hour: 94_560,
  summary_standard_per_hour: 7_695,
  summary_high_per_hour: 30_780,
  dubbing_openai_per_minute: 787.5,
  dubbing_elevenlabs_per_minute: 9_450,
});

const PLATFORM_LIMITS = Object.freeze({
  youtube: Object.freeze({
    maximum_bytes: 256_000_000_000,
    maximum_duration_seconds: 12 * 60 * 60,
  }),
  x_standard: Object.freeze({
    maximum_bytes: 512_000_000,
    maximum_duration_seconds: 140,
    maximum_width: 1920,
    maximum_height: 1200,
    maximum_portrait_width: 1200,
    maximum_portrait_height: 1900,
    maximum_frame_rate: 40,
    maximum_bit_rate: 25_000_000,
  }),
  x_premium: Object.freeze({
    maximum_bytes: 16_000_000_000,
    maximum_duration_seconds: 4 * 60 * 60,
    maximum_1080p_duration_seconds: 2 * 60 * 60,
    maximum_frame_rate: 40,
    maximum_bit_rate: 25_000_000,
  }),
});

const PRESET_ESTIMATES = Object.freeze({
  youtube_1080p: {
    width: 1920,
    height: 1080,
    megabits_per_second: 8.192,
    relative_encode_speed: 0.8,
  },
  youtube_4k: {
    width: 3840,
    height: 2160,
    megabits_per_second: 35.256,
    relative_encode_speed: 0.25,
  },
  x_long_video_720p: {
    width: 1280,
    height: 720,
    megabits_per_second: 5.128,
    relative_encode_speed: 1.1,
  },
  x_long_video_1080p: {
    width: 1920,
    height: 1080,
    megabits_per_second: 8.192,
    relative_encode_speed: 0.75,
  },
  archive_master: {
    width: null,
    height: null,
    megabits_per_second: 45.32,
    relative_encode_speed: 0.2,
  },
  preview_low_resolution: {
    width: 854,
    height: 480,
    megabits_per_second: 1.596,
    relative_encode_speed: 2.5,
  },
});

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_TRANSLATION_SESSION_SEGMENTS = 100_000;
const MOCK_SOURCE_VERSION = 1;
const SOURCE_BINDING_PROTOCOL_VERSION = 1;
const ACTIVE_APP_STAGE_IDS = new Set([
  'download_source',
  'transcription',
  'translation_app',
  'summary',
  'dubbing',
  'render_outputs',
]);
const AMBIGUOUS_INFERENCE_STAGE_IDS = new Set([
  'transcription',
  'translation_app',
  'summary',
  'dubbing',
]);
const IMMUTABLE_TIMING_VALIDATION_CODES = new Set([
  'invalid_timing',
  'timestamp_overlap',
  'subtitle_exceeds_media_duration',
]);
const WINDOWS_RESERVED_BASENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_OUTPUT_BASE_NAME_UTF8_BYTES = 160;
const SUBTITLE_DISPLAY_MODES = new Set(['original', 'translation', 'dual']);
const SUBTITLE_STYLE_PRESETS = new Set([
  'Default',
  'Classic',
  'Boxed',
  'LineBox',
]);
const SUBTITLE_RENDER_SPEC_VERSION = 1;
const SUBTITLE_FONT_FAMILY = 'Noto Sans';
const SUBTITLE_FONT_ASSET = 'NotoSans-Regular.ttf';
const MIN_SUBTITLE_OUTPUT_FONT_SIZE = 6;
const MAX_SUBTITLE_OUTPUT_FONT_SIZE = 192;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function finiteSubtitleBaseFontSize(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(6, Math.min(96, value))
    : null;
}

function plannedSubtitleOutputFontSize(baseFontSize, videoHeight) {
  const height = Number(videoHeight);
  if (!Number.isFinite(height) || height <= 0) return null;
  const scale = Math.min(Math.max(Math.max(height, 360) / 720, 0.5), 2);
  return Math.max(6, Math.round(baseFontSize * scale));
}

export function resolvePlannedSubtitleRenderSpec({
  requestedOutputs = {},
  profile = {},
  planning = {},
  translationProvider = 'agent',
  sourceMetadata = {},
} = {}) {
  const preview = isObject(planning?.subtitle_rendering)
    ? planning.subtitle_rendering
    : {};
  if (
    preview.display_mode !== undefined &&
    !SUBTITLE_DISPLAY_MODES.has(preview.display_mode)
  ) {
    throw new Error('Translator returned an invalid preview display mode.');
  }
  if (
    preview.style !== undefined &&
    !SUBTITLE_STYLE_PRESETS.has(preview.style)
  ) {
    throw new Error('Translator returned an invalid preview subtitle style.');
  }
  const previewFontSize =
    preview.base_font_size_px === undefined
      ? null
      : finiteSubtitleBaseFontSize(preview.base_font_size_px);
  if (preview.base_font_size_px !== undefined && previewFontSize === null) {
    throw new Error('Translator returned an invalid preview font size.');
  }

  const profileRendering = isObject(profile?.subtitle_rendering)
    ? profile.subtitle_rendering
    : {};
  const requestedDisplayMode = requestedOutputs.subtitle_display_mode;
  const requestedStyle = requestedOutputs.subtitle_style;
  const requestedFontSize =
    requestedOutputs.subtitle_font_size === undefined
      ? null
      : finiteSubtitleBaseFontSize(requestedOutputs.subtitle_font_size);
  if (
    requestedOutputs.subtitle_font_size !== undefined &&
    requestedFontSize === null
  ) {
    throw new Error('The requested subtitle font size is invalid.');
  }
  const displayMode =
    translationProvider === 'none'
      ? 'original'
      : requestedDisplayMode ||
        preview.display_mode ||
        profileRendering.display_mode ||
        'translation';
  const style =
    requestedStyle || preview.style || profileRendering.style || 'Default';
  const profileFontSize = finiteSubtitleBaseFontSize(
    profileRendering.font_size
  );
  if (profileRendering.font_size !== undefined && profileFontSize === null) {
    throw new Error('The saved project profile subtitle font size is invalid.');
  }
  const baseFontSize =
    requestedFontSize ?? previewFontSize ?? profileFontSize ?? 24;
  if (!SUBTITLE_DISPLAY_MODES.has(displayMode)) {
    throw new Error('The resolved subtitle display mode is unsupported.');
  }
  if (!SUBTITLE_STYLE_PRESETS.has(style)) {
    throw new Error('The resolved subtitle style is unsupported.');
  }
  const width = Number(sourceMetadata?.width);
  const height = Number(sourceMetadata?.height);
  const displayWidth = Number(sourceMetadata?.display_width);
  const displayHeight = Number(sourceMetadata?.display_height);

  return {
    display_mode: displayMode,
    style,
    base_font_size_px: baseFontSize,
    output_font_size_px: plannedSubtitleOutputFontSize(baseFontSize, height),
    video_width_px: Number.isFinite(width) && width > 0 ? width : null,
    video_height_px: Number.isFinite(height) && height > 0 ? height : null,
    display_width_px:
      Number.isFinite(displayWidth) && displayWidth > 0
        ? displayWidth
        : Number.isFinite(width) && width > 0
          ? width
          : null,
    display_height_px:
      Number.isFinite(displayHeight) && displayHeight > 0
        ? displayHeight
        : Number.isFinite(height) && height > 0
          ? height
          : null,
    font_family: SUBTITLE_FONT_FAMILY,
    font_asset: SUBTITLE_FONT_ASSET,
    scale_rule: 'height_ratio_720_clamped_0.5_2',
    schema_version: SUBTITLE_RENDER_SPEC_VERSION,
    selection_binding_version: SUBTITLE_RENDER_SELECTION_BINDING_VERSION,
    field_sources: {
      display_mode:
        translationProvider === 'none'
          ? 'workflow'
          : requestedDisplayMode
            ? 'request'
            : preview.display_mode
              ? 'translator_preview'
              : profileRendering.display_mode
                ? 'project_profile'
                : 'default',
      style: requestedStyle
        ? 'request'
        : preview.style
          ? 'translator_preview'
          : profileRendering.style
            ? 'project_profile'
            : 'default',
      base_font_size_px:
        requestedFontSize !== null
          ? 'request'
          : previewFontSize !== null
            ? 'translator_preview'
            : profileFontSize !== null
              ? 'project_profile'
              : 'default',
    },
  };
}

export function plannedAppSourceBinding(plan, state = 'preparing') {
  if (!['preparing', 'mounted'].includes(state)) {
    throw new TypeError('Source binding state must be preparing or mounted.');
  }
  const sourceKind = String(plan?.source?.kind || '').trim();
  if (!sourceKind) {
    throw new Error('The immutable plan is missing its source kind.');
  }
  const explicitSourceKey = String(plan?.source?.source_key || '').trim();
  // Plans written by early v2 development builds may predate source_key.
  // Bind them to the immutable stored source snapshot without exposing paths
  // or URLs, while current plans continue to use their content/media key.
  const sourceKey =
    explicitSourceKey ||
    `legacy-plan:sha256:${createHash('sha256')
      .update(canonicalJson(plan.source))
      .digest('hex')}`;
  const duration = Number(plan?.source_metadata?.duration_seconds);
  return {
    source_key: sourceKey,
    source_kind: sourceKind,
    planned_duration_seconds:
      Number.isFinite(duration) && duration >= 0 ? duration : null,
    state,
  };
}

export function bindAppObservationToPlan(plan, observation) {
  if (!isObject(observation)) return observation;
  const expected = plannedAppSourceBinding(plan);
  const observedBinding = isObject(observation.source_binding)
    ? observation.source_binding
    : null;
  const bindingMatches =
    observedBinding?.source_key === expected.source_key &&
    observedBinding?.source_kind === expected.source_kind &&
    (observedBinding?.planned_duration_seconds ?? null) ===
      expected.planned_duration_seconds;
  const observedState = String(observedBinding?.state || '');
  const state =
    bindingMatches && ['preparing', 'mounted'].includes(observedState)
      ? observedState
      : 'unverified';
  const bound = {
    ...clone(observation),
    source_binding: { ...expected, state },
  };
  if (state === 'mounted') return bound;

  // The app tab may already contain unrelated media. Until it attests that
  // the immutable planned source is mounted, never persist or return that
  // workspace as evidence for this job. Nested operation results remain
  // intact so completed artifacts can still be fingerprinted and recovered.
  bound.source = {
    videoPath: null,
    videoReady: false,
    durationSeconds: expected.planned_duration_seconds,
  };
  bound.subtitles = {
    cueCount: null,
    translatedCueCount: null,
    targetLanguage: null,
    kind: null,
    activeFilePath: null,
  };
  bound.outputs = {
    dubbedVideoPath: null,
    dubbedAudioPath: null,
    downloadedFilePath: null,
  };
  return bound;
}

function joinTranscriptCueText(values) {
  return values
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

export function repairZeroDurationTranscriptSegments(segments) {
  if (!Array.isArray(segments)) {
    throw new TypeError('Transcript segments must be an array.');
  }
  const candidates = clone(segments);
  const repaired = [];
  const repairs = [];

  const mergeGroup = (target, group, strategy) => {
    const groupSource = group.map(
      segment => segment?.source ?? segment?.original ?? ''
    );
    const targetSource = target?.source ?? target?.original ?? '';
    const source =
      strategy === 'prepend'
        ? joinTranscriptCueText([...groupSource, targetSource])
        : joinTranscriptCueText([targetSource, ...groupSource]);
    target.source = source;
    if (Object.hasOwn(target, 'original')) target.original = source;

    const groupTranslations = group.map(segment => segment?.translation || '');
    const targetTranslation = target?.translation || '';
    const translation =
      strategy === 'prepend'
        ? joinTranscriptCueText([...groupTranslations, targetTranslation])
        : joinTranscriptCueText([targetTranslation, ...groupTranslations]);
    if (translation || Object.hasOwn(target, 'translation')) {
      target.translation = translation;
    }

    for (const segment of group) {
      repairs.push({
        removed_segment_id: String(segment?.id || ''),
        merged_into_segment_id: String(target?.id || ''),
        timestamp_seconds: Number(segment?.start),
        strategy,
      });
    }
  };

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const start = Number(candidate?.start);
    const end = Number(candidate?.end);
    const repairable =
      Number.isFinite(start) &&
      start >= 0 &&
      Number.isFinite(end) &&
      end === start;
    if (!repairable) {
      repaired.push(candidate);
      continue;
    }

    const group = [candidate];
    while (index + 1 < candidates.length) {
      const next = candidates[index + 1];
      const nextStart = Number(next?.start);
      const nextEnd = Number(next?.end);
      if (
        !Number.isFinite(nextStart) ||
        !Number.isFinite(nextEnd) ||
        nextStart !== start ||
        nextEnd !== nextStart
      ) {
        break;
      }
      group.push(next);
      index += 1;
    }

    const next = candidates[index + 1];
    const nextStart = Number(next?.start);
    const nextEnd = Number(next?.end);
    if (
      next &&
      Number.isFinite(nextStart) &&
      Number.isFinite(nextEnd) &&
      nextStart === start &&
      nextEnd > nextStart
    ) {
      const survivor = clone(next);
      mergeGroup(survivor, group, 'prepend');
      repaired.push(survivor);
      index += 1;
      continue;
    }

    const previous = repaired.at(-1);
    if (previous) {
      mergeGroup(previous, group, 'append');
      continue;
    }

    // With no positive-duration neighbour, retain the invalid group so the
    // durable session validator fails closed instead of discarding content.
    repaired.push(...group);
  }

  repaired.forEach((segment, index) => {
    segment.index = index + 1;
  });
  return {
    segments: repaired,
    original_segment_count: candidates.length,
    repaired_segment_count: repairs.length,
    persisted_segment_count: repaired.length,
    repairs,
  };
}

function publicToolData(value) {
  if (Array.isArray(value)) return value.map(publicToolData);
  if (!isObject(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'claim_owner' ||
      key === 'pending_manifest' ||
      key === 'receipt_path'
    ) {
      continue;
    }
    result[key] = publicToolData(child);
  }
  return result;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function cleanEnvironment(value) {
  if (!['development', 'production'].includes(value)) {
    throw new TypeError('environment must be development or production.');
  }
  return value;
}

function cleanBaseName(value, fallback = 'translator-output') {
  let cleaned = String(value || fallback)
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  cleaned = cleaned || fallback;
  if (WINDOWS_RESERVED_BASENAME.test(cleaned)) cleaned = `_${cleaned}`;
  const segments = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  }).segment(cleaned);
  let result = '';
  let bytes = 0;
  for (const { segment } of segments) {
    const segmentBytes = Buffer.byteLength(segment);
    if (bytes + segmentBytes > MAX_OUTPUT_BASE_NAME_UTF8_BYTES) break;
    result += segment;
    bytes += segmentBytes;
  }
  return result || 'translator-output';
}

function normalizedPathIdentity(value) {
  const resolved = path.normalize(path.resolve(String(value || '')));
  return process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved;
}

async function pathsReferenceSameFile(leftValue, rightValue) {
  const left = String(leftValue || '').trim();
  const right = String(rightValue || '').trim();
  if (!left || !right) return false;
  if (normalizedPathIdentity(left) === normalizedPathIdentity(right)) {
    return true;
  }
  let realLeft;
  let realRight;
  try {
    [realLeft, realRight] = await Promise.all([
      fs.realpath(left),
      fs.realpath(right),
    ]);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (normalizedPathIdentity(realLeft) === normalizedPathIdentity(realRight)) {
    return true;
  }
  const [leftStat, rightStat] = await Promise.all([
    fs.stat(realLeft, { bigint: true }),
    fs.stat(realRight, { bigint: true }),
  ]);
  return (
    leftStat.ino !== 0n &&
    rightStat.ino !== 0n &&
    leftStat.dev === rightStat.dev &&
    leftStat.ino === rightStat.ino
  );
}

async function findOutputInputOverlaps(outputPaths, inputPaths) {
  const outputs = [...new Set((outputPaths || []).filter(Boolean))];
  const inputs = [...new Set((inputPaths || []).filter(Boolean))];
  const overlaps = [];
  for (const outputPath of outputs) {
    for (const inputPath of inputs) {
      if (await pathsReferenceSameFile(outputPath, inputPath)) {
        overlaps.push(path.resolve(outputPath));
        break;
      }
    }
  }
  return overlaps;
}

function plannedInputPaths(plan, additionalPaths = []) {
  return [
    plan?.source?.path,
    plan?.source?.transcript_path,
    plan?.transcription?.imported_transcript?.path,
    ...additionalPaths,
  ].filter(Boolean);
}

function plannedOutputPaths(plan) {
  const outputDirectory = String(plan?.outputs?.output_directory || '').trim();
  if (!outputDirectory) return [];
  const baseName = String(plan?.outputs?.base_name || 'translator-output');
  const presets = plan?.outputs?.presets || [];
  return [
    ...(plan?.translation?.provider !== 'none'
      ? [path.join(outputDirectory, `${baseName}-source.srt`)]
      : []),
    ...(plan?.outputs?.subtitle_formats || []).map(format =>
      path.join(outputDirectory, `${baseName}.${format}`)
    ),
    ...presets.map(preset =>
      path.join(outputDirectory, `${baseName}-${preset}.mp4`)
    ),
    ...(presets.length
      ? [1, 2, 3].map(index =>
          path.join(outputDirectory, `${baseName}-preview-${index}.png`)
        )
      : []),
    ...presets.flatMap(preset =>
      [1, 2, 3].map(index =>
        path.join(
          outputDirectory,
          `${baseName}-${preset}-verified-${index}.png`
        )
      )
    ),
    path.join(outputDirectory, `${baseName}-manifest.json`),
  ];
}

async function assertPlannedOutputIsolation(plan, additionalInputPaths = []) {
  const overlaps = await findOutputInputOverlaps(
    plannedOutputPaths(plan),
    plannedInputPaths(plan, additionalInputPaths)
  );
  if (overlaps.length > 0) {
    const error = new Error(
      `A planned output now references workflow input and will not be overwritten: ${overlaps.join(', ')}`
    );
    error.code = 'OUTPUT_OVERLAPS_INPUT';
    error.suggestedAction = 'plan_job';
    throw error;
  }
}

function subtitleSourceSha256(segments) {
  const sourceSnapshot = (Array.isArray(segments) ? segments : []).map(
    segment => ({
      id: String(segment?.id || ''),
      start: Number(segment?.start),
      end: Number(segment?.end),
      source: String(segment?.source ?? segment?.original ?? ''),
    })
  );
  return createHash('sha256')
    .update(canonicalJson(sourceSnapshot))
    .digest('hex');
}

export function maximumSegmentEnd(segments) {
  return (Array.isArray(segments) ? segments : []).reduce(
    (maximum, segment) => {
      const end = Number(segment?.end);
      return Number.isFinite(end) ? Math.max(maximum, end) : maximum;
    },
    0
  );
}

const X_SINGLE_WEIGHT_RANGES = Object.freeze([
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
]);

function xPlainTextWeight(value) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let total = 0;
  for (const { segment } of segmenter.segment(value)) {
    if (/\p{Extended_Pictographic}/u.test(segment)) {
      total += 2;
      continue;
    }
    for (const character of segment) {
      const codePoint = character.codePointAt(0);
      total += X_SINGLE_WEIGHT_RANGES.some(
        ([minimum, maximum]) => codePoint >= minimum && codePoint <= maximum
      )
        ? 1
        : 2;
    }
  }
  return total;
}

export function xWeightedTextLength(value) {
  const text = String(value || '').normalize('NFC');
  const urlPattern = /https?:\/\/[^\s]+/giu;
  let total = 0;
  let cursor = 0;
  for (const match of text.matchAll(urlPattern)) {
    const start = match.index ?? cursor;
    total += xPlainTextWeight(text.slice(cursor, start));
    let candidate = match[0];
    const trailing = candidate.match(/[.,!?;:'"\])}]+$/u)?.[0] || '';
    if (trailing) candidate = candidate.slice(0, -trailing.length);
    try {
      new URL(candidate);
      total += 23;
      total += xPlainTextWeight(trailing);
    } catch {
      total += xPlainTextWeight(match[0]);
    }
    cursor = start + match[0].length;
  }
  return total + xPlainTextWeight(text.slice(cursor));
}

function sourceKind(source) {
  if (source?.mock === true) return 'mock';
  if (source?.url) return 'url';
  if (source?.path) return 'local_file';
  if (source?.history_id) return 'library_item';
  if (source?.transcript_path) return 'transcript';
  throw new TypeError('Select exactly one source.');
}

function hashedSourceIdentityKey(kind, identity) {
  return `${kind}:sha256:${createHash('sha256')
    .update(String(identity || ''))
    .digest('hex')}`;
}

function cleanOpaqueSourceIdentity(value, maximumCharacters) {
  if (
    typeof value !== 'string' &&
    !(typeof value === 'number' && Number.isFinite(value))
  ) {
    return null;
  }
  const rawIdentity = String(value);
  if (rawIdentity.length > maximumCharacters * 2) return null;
  const identity = rawIdentity.trim();
  if (!identity) return null;
  let characters = 0;
  for (const character of identity) {
    if (/[\p{Cc}]/u.test(character)) return null;
    characters += character.length > 0 ? 1 : 0;
    if (characters > maximumCharacters) return null;
  }
  return identity;
}

function assertExactlyOneSource(source) {
  if (!isObject(source)) throw new TypeError('source must be an object.');
  const choices = [
    source.mock === true,
    Boolean(String(source.url || '').trim()),
    Boolean(String(source.path || '').trim()),
    Boolean(String(source.history_id || '').trim()),
    Boolean(String(source.transcript_path || '').trim()),
  ].filter(Boolean).length;
  if (choices !== 1) throw new TypeError('Select exactly one source.');
}

function chooseCaptionTrack(tracks, kind, requestedLanguage) {
  const eligible = (Array.isArray(tracks) ? tracks : []).filter(
    track => track?.kind === kind && String(track?.language || '').trim()
  );
  if (!eligible.length) return null;
  const requested = String(requestedLanguage || '')
    .trim()
    .toLowerCase();
  if (requested) {
    return (
      eligible.find(
        track => String(track.language).trim().toLowerCase() === requested
      ) || null
    );
  }
  return (
    eligible.find(track => /^en(?:[-_]|$)/i.test(String(track.language))) ||
    eligible[0]
  );
}

function assertPlanGlossary(glossary) {
  if (glossary === undefined) return;
  if (!isObject(glossary)) {
    throw new TypeError('per_video_glossary must be an object.');
  }
  const entries = Object.entries(glossary);
  if (entries.length > 1000) {
    throw new TypeError(
      'per_video_glossary cannot contain more than 1000 terms.'
    );
  }
  for (const [source, translation] of entries) {
    if (
      !source.trim() ||
      source.length > 500 ||
      /[\p{Cc}]/u.test(source) ||
      typeof translation !== 'string' ||
      !translation.trim() ||
      translation.length > 500 ||
      /[\p{Cc}]/u.test(translation)
    ) {
      throw new TypeError(
        'per_video_glossary terms and translations must be printable, non-empty text up to 500 characters.'
      );
    }
  }
  if (Buffer.byteLength(canonicalJson(glossary)) > 256 * 1024) {
    throw new TypeError('per_video_glossary cannot exceed 256 KiB.');
  }
}

function operationId(job, stage) {
  const historyId = String(job.request?.source?.history_id || '').trim();
  if (historyId && stage.id === 'transcription') {
    return stage.operation_id || `agent-history:transcription:${job.job_id}`;
  }
  return stage.operation_id || `mcp-v2:${job.job_id}:${stage.id}`;
}

function usesLibraryHistoryStage(plan, stage) {
  return plan?.source?.kind === 'library_item' && stage?.id === 'transcription';
}

function appSourceBindingStateForStage(plan, stage) {
  if (stage?.id === 'transcription') {
    return plan?.source?.kind === 'library_item' ? 'mounted' : 'preparing';
  }
  return stage?.id === 'download_source' ? 'preparing' : 'mounted';
}

function appSourceBindingProtocolVersion(context) {
  const value = Number(context?.agent_control?.source_binding_protocol_version);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function isVideoArtifact(artifact) {
  return /\.(?:mp4|mov|mkv|webm|avi)$/i.test(String(artifact?.path || ''));
}

function isAudioArtifact(artifact) {
  return /\.(?:mp3|m4a|aac|wav|flac|opus|ogg)$/i.test(
    String(artifact?.path || '')
  );
}

function plannedVideoPath(job, plan, { preferDubbed = false } = {}) {
  const artifacts = Array.isArray(job?.artifacts) ? job.artifacts : [];
  if (preferDubbed) {
    const dubbed = [...artifacts]
      .reverse()
      .find(
        artifact => artifact?.stage === 'dubbing' && isVideoArtifact(artifact)
      );
    if (!dubbed) {
      throw new Error(
        'This plan requires dubbed media, but the completed dubbing stage has no durable video artifact.'
      );
    }
    return dubbed.path;
  }
  const prepared = [...artifacts]
    .reverse()
    .find(
      artifact =>
        ['download_source', 'transcription'].includes(artifact?.stage) &&
        isVideoArtifact(artifact)
    );
  return prepared?.path || plan?.source?.path || null;
}

function plannedRenderSourceCheckpoint(job, plan) {
  const selectedPath = plannedVideoPath(job, plan, {
    preferDubbed: plan?.options?.include_dubbing === true,
  });
  if (!selectedPath) {
    throw new Error(
      'The canceled job has no durable video checkpoint for render recovery.'
    );
  }
  const resolvedPath = path.resolve(selectedPath);
  const identity = normalizedPathIdentity(resolvedPath);
  const artifact = (job?.artifacts || []).find(
    candidate =>
      normalizedPathIdentity(String(candidate?.path || '')) === identity
  );
  const plannedSourcePath = String(plan?.source?.path || '').trim();
  const isPlannedSource =
    plannedSourcePath && normalizedPathIdentity(plannedSourcePath) === identity;
  const sha256 = String(
    artifact?.checkpoint_sha256 ||
      artifact?.sha256 ||
      (isPlannedSource ? plan?.source?.sha256 : '') ||
      ''
  );
  const bytes = Number(
    artifact?.checkpoint_bytes ??
      artifact?.bytes ??
      (isPlannedSource ? plan?.source?.bytes : NaN)
  );
  if (
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0
  ) {
    throw new Error(
      'The canceled job render source has no complete SHA-256/byte checkpoint.'
    );
  }
  return {
    path: resolvedPath,
    stage: artifact?.stage || 'recovery_source',
    kind: artifact?.kind || 'video',
    sha256,
    bytes,
    checkpoint_captured_at: artifact?.checkpoint_captured_at || null,
  };
}

function translationAcceptanceSummary(session) {
  const segments = Array.isArray(session?.segments) ? session.segments : [];
  const accepted = segments.filter(
    segment =>
      String(segment?.translation || '').trim() &&
      ['translated', 'reviewed'].includes(String(segment?.status || ''))
  ).length;
  const needsCorrection = segments.filter(
    segment => segment?.status === 'needs_correction'
  ).length;
  return {
    total_segments: segments.length,
    accepted_segments: accepted,
    pending_segments: segments.length - accepted - needsCorrection,
    needs_correction_segments: needsCorrection,
  };
}

function renderRecoveryStateSnapshot(store, jobId) {
  const job = store.requireJob(jobId);
  const plan = store.getPlan(job.plan_hash);
  const session = store.getTranslationSession(jobId);
  return {
    job,
    plan,
    session,
    total_changes: store.totalChanges(),
    job_sha256: persistentJobCheckpointSha256(job),
    plan_sha256: canonicalJsonHash(plan),
    session_sha256: session
      ? translationSessionCheckpointSha256(session)
      : null,
    session_row_sha256: canonicalJsonHash(session),
    validation_sha256: validationCheckpointSha256(job.validation),
    credit_ledger_sha256: creditLedgerCheckpointSha256(job.credit_usage),
  };
}

function renderInvariantOutputSnapshot(
  outputs,
  { omitSynthesizedRenderSpec = false } = {}
) {
  const stable = clone(outputs || {});
  delete stable.subtitle_style;
  delete stable.subtitle_font_size;
  if (omitSynthesizedRenderSpec) {
    delete stable.subtitle_render_spec;
    return stable;
  }
  if (isObject(stable.subtitle_render_spec)) {
    delete stable.subtitle_render_spec.style;
    delete stable.subtitle_render_spec.base_font_size_px;
    delete stable.subtitle_render_spec.output_font_size_px;
    delete stable.subtitle_render_spec.selection_binding_version;
    if (isObject(stable.subtitle_render_spec.field_sources)) {
      delete stable.subtitle_render_spec.field_sources.style;
      delete stable.subtitle_render_spec.field_sources.base_font_size_px;
    }
  }
  return stable;
}

async function inspectRenderCheckpointForkOutputs(plan, renderSourcePath) {
  const outputDirectory = String(plan?.outputs?.output_directory || '').trim();
  if (!outputDirectory) {
    throw new Error('The recovery plan has no output directory.');
  }
  const resolvedDirectory = await fs.realpath(outputDirectory);
  const directoryStat = await fs.stat(resolvedDirectory);
  if (!directoryStat.isDirectory()) {
    throw new Error('The recovery output destination is not a directory.');
  }
  await fs.access(resolvedDirectory, fsConstants.W_OK);
  const overlaps = await findOutputInputOverlaps(
    plannedOutputPaths(plan),
    plannedInputPaths(plan, [renderSourcePath])
  );
  const existingFiles = [];
  const existingPreviewFiles = [];
  for (const plannedPath of plannedOutputPaths(plan)) {
    try {
      const stat = await fs.lstat(plannedPath);
      if (stat) {
        if (/-preview-[123]\.png$/i.test(plannedPath)) {
          existingPreviewFiles.push(path.resolve(plannedPath));
        } else {
          existingFiles.push(path.resolve(plannedPath));
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  let availableBytes = null;
  try {
    const filesystem = await fs.statfs(resolvedDirectory);
    availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  } catch {
    // Some supported filesystems do not expose statfs. The preflight reports
    // that disk capacity is unverified rather than manufacturing a value.
  }
  const requiredBytes = Number(
    plan?.estimated_disk_usage?.peak_additional_bytes || 0
  );
  const normalizedAvailableBytes =
    Number.isFinite(availableBytes) && availableBytes >= 0
      ? availableBytes
      : null;
  const normalizedRequiredBytes =
    Number.isFinite(requiredBytes) && requiredBytes > 0
      ? Math.ceil(requiredBytes * 1.2)
      : null;
  return {
    directory: resolvedDirectory,
    overwrite: plan?.outputs?.overwrite === true,
    planned_file_count: plannedOutputPaths(plan).length,
    existing_files: existingFiles,
    existing_preview_files: existingPreviewFiles,
    input_overlaps: overlaps,
    available_bytes: normalizedAvailableBytes,
    required_bytes: normalizedRequiredBytes,
    capacity_sufficient:
      normalizedAvailableBytes !== null &&
      (normalizedRequiredBytes === null ||
        normalizedAvailableBytes >= normalizedRequiredBytes),
  };
}

function stageFence(stage) {
  return stage
    ? {
        id: stage.id,
        operation_id: stage.operation_id,
        attempts: Number(stage.attempts || 0),
        status: stage.status,
      }
    : null;
}

function stagePercent(job, currentPercent = 0) {
  const total = Math.max(1, job.stages.length);
  const completed = job.stages.filter(
    stage => stage.status === 'completed'
  ).length;
  return Math.min(
    100,
    Math.max(0, ((completed + currentPercent / 100) / total) * 100)
  );
}

function appResultStatus(result) {
  const status = String(result?.status || '').toLowerCase();
  if (
    ['completed', 'failed', 'cancelled', 'running', 'cancelling'].includes(
      status
    )
  ) {
    return status;
  }
  if (result?.inProgress === true) return 'running';
  if (result?.inProgress === false && result?.error) return 'failed';
  return 'unknown';
}

function collectArtifactPaths(value, found = new Set(), key = '') {
  if (key === 'operation_receipt' || key === 'receipt_path') return found;
  if (typeof value === 'string') {
    if (/(?:path|file)$/i.test(key) && path.isAbsolute(value)) found.add(value);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectArtifactPaths(item, found, key));
    return found;
  }
  if (isObject(value)) {
    for (const [childKey, child] of Object.entries(value)) {
      collectArtifactPaths(child, found, childKey);
    }
  }
  return found;
}

function isDeliveryUnknownError(error) {
  return (
    error?.deliveryState === 'unknown' || error?.code === 'APP_DELIVERY_UNKNOWN'
  );
}

function providerRouteKey(descriptor) {
  if (!isObject(descriptor)) return 'unavailable::';
  return [
    descriptor.kind || 'unavailable',
    descriptor.provider || '',
    descriptor.model || '',
  ].join(':');
}

async function readBoundedSrtTranscript(transcriptPath) {
  const requested = path.resolve(String(transcriptPath || ''));
  const resolved = await fs.realpath(requested);
  if (path.extname(resolved).toLowerCase() !== '.srt') {
    throw new Error('Imported transcript paths must use the .srt format.');
  }
  const file = await readStableBoundedTextFile(resolved, {
    maximumBytes: MAX_TRANSCRIPT_BYTES,
    label: 'Transcript',
  });
  return {
    path: file.path,
    stat: {
      size: file.bytes,
      modified_time_ms: file.modified_time_ms,
    },
    text: file.text,
  };
}

function transcriptTimingFindings(
  segments,
  {
    mediaDurationSeconds = null,
    label = 'Transcript',
    codePrefix = 'transcript',
  } = {}
) {
  let invalidCount = 0;
  let overlapCount = 0;
  let firstInvalidId = null;
  let firstOverlapId = null;
  let previous = null;
  let lastEnd = 0;
  for (const segment of Array.isArray(segments) ? segments : []) {
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    const valid =
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start;
    if (!valid) {
      invalidCount += 1;
      firstInvalidId ||= String(segment?.id || 'unknown');
      continue;
    }
    if (previous && start < previous.end - 0.001) {
      overlapCount += 1;
      firstOverlapId ||= String(segment?.id || 'unknown');
    }
    previous = { end };
    lastEnd = Math.max(lastEnd, end);
  }

  const findings = [];
  if (invalidCount > 0) {
    findings.push({
      severity: 'blocking',
      code: `${codePrefix}_invalid_timing`,
      message: `${label} contains ${invalidCount} cue(s) with invalid timing; the first is ${firstInvalidId}. Fix the source SRT and plan again because translation submissions cannot change timestamps.`,
    });
  }
  if (overlapCount > 0) {
    findings.push({
      severity: 'blocking',
      code: `${codePrefix}_timestamp_overlap`,
      message: `${label} contains ${overlapCount} overlapping cue(s); the first is ${firstOverlapId}. Fix the source SRT and plan again because translation submissions cannot change timestamps.`,
    });
  }
  const mediaDuration = Number(mediaDurationSeconds);
  if (
    Number.isFinite(mediaDuration) &&
    mediaDuration > 0 &&
    lastEnd > mediaDuration + 1
  ) {
    findings.push({
      severity: 'blocking',
      code: `${codePrefix}_exceeds_source_duration`,
      message: `${label} ends at ${lastEnd.toFixed(3)} seconds, beyond the source duration of ${mediaDuration.toFixed(3)} seconds.`,
    });
  }
  return findings;
}

function transcriptStructureFindings(
  analysis,
  { label = 'Transcript', codePrefix = 'transcript' } = {}
) {
  if (!analysis || Number(analysis.invalidBlockCount || 0) === 0) return [];
  const first = analysis.diagnostics?.[0];
  const firstDetail = first
    ? ` The first issue is block ${first.block}: ${first.message}`
    : '';
  return [
    {
      severity: 'blocking',
      code: `${codePrefix}_malformed_cues`,
      message: `${label} contains ${analysis.invalidBlockCount} malformed cue block(s).${firstDetail} Fix the source SRT and plan again; malformed cues are never dropped silently.`,
    },
  ];
}

function requireReadableSrt(text, label) {
  const analysis = parseSrtWithDiagnostics(text);
  if (!analysis.segments.length) {
    throw new Error(`${label} contains no readable SRT cues.`);
  }
  if (analysis.invalidBlockCount > 0) {
    const [finding] = transcriptStructureFindings(analysis, { label });
    throw new Error(finding.message);
  }
  return analysis.segments;
}

function extractStageCreditUsage(value) {
  const usage = value?.credit_usage || value?.result?.credit_usage || null;
  if (!isObject(usage)) return null;
  const consumed = Number(
    usage.stage5_credits_consumed ?? usage.observed_stage5_credit_delta
  );
  if (!Number.isFinite(consumed) || consumed < 0) return null;
  return {
    stage5_credits_consumed: consumed,
    before_balance: Number.isFinite(Number(usage.before_balance))
      ? Number(usage.before_balance)
      : null,
    after_balance: Number.isFinite(
      Number(usage.after_balance ?? usage.current_balance)
    )
      ? Number(usage.after_balance ?? usage.current_balance)
      : null,
    authoritative: usage.authoritative === true,
    balance_snapshots_authoritative:
      usage.balance_snapshots_authoritative === true,
    attribution_scope:
      String(usage.attribution_scope || '').trim() || 'account_balance_delta',
    measurement:
      String(usage.measurement || '').trim() ||
      'observed_account_balance_delta',
  };
}

function applyStageCreditUsage(job, stage, value) {
  const usage = extractStageCreditUsage(value);
  if (!usage) return;
  const operationIdValue = stage.operation_id || null;
  const entry = {
    stage: stage.id,
    operation_id: operationIdValue,
    ...usage,
  };
  const entries = Array.isArray(job.credit_usage?.entries)
    ? job.credit_usage.entries.filter(
        existing =>
          !(
            existing.stage === stage.id &&
            existing.operation_id === operationIdValue
          )
      )
    : [];
  entries.push(entry);
  job.credit_usage = {
    ...(job.credit_usage || {}),
    consumed_stage5_credits: entries.reduce(
      (total, item) => total + (Number(item.stage5_credits_consumed) || 0),
      0
    ),
    consumption_attribution_authoritative:
      entries.length > 0
        ? entries.every(item => item.authoritative === true)
        : null,
    entries,
  };
}

function stageError(error, stage, creditConsumed = null) {
  return {
    code: error?.code || 'STAGE_FAILED',
    stage,
    message: error instanceof Error ? error.message : String(error),
    recoverable: true,
    credit_consumed: creditConsumed,
    credit_will_not_be_recharged: null,
    suggested_action: error?.suggestedAction || 'retry_stage',
  };
}

function srtToVtt(srt) {
  return `WEBVTT\n\n${String(srt)
    .replace(/^\d+\s*$/gm, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/\n{3,}/g, '\n\n')}`;
}

function escapeAssText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\N')
    .replace(/[{}]/g, match => `\\${match}`);
}

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.round(Number(seconds || 0) * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const secs = Math.floor((centiseconds % 6_000) / 100);
  const cs = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

const ASS_STYLE_PRESETS = Object.freeze({
  Default: Object.freeze({
    primary: '&H00FFFFFF',
    outline: '&H00000000',
    back: '&H80000000',
    border: 1,
    outlineSize: 1.5,
    shadow: 0.5,
  }),
  Classic: Object.freeze({
    primary: '&H0000FFFF',
    outline: '&H00000000',
    back: '&H80000000',
    border: 1,
    outlineSize: 2,
    shadow: 1,
  }),
  Boxed: Object.freeze({
    primary: '&H00FFFFFF',
    outline: '&H00000000',
    back: '&H33000000',
    border: 3,
    outlineSize: 1,
    shadow: 0,
  }),
  LineBox: Object.freeze({
    primary: '&H00FFFFFF',
    outline: '&H00FFFFFF',
    back: '&H33000000',
    border: 3,
    outlineSize: 0,
    shadow: 0,
  }),
});

function boundedAssPlayResolution(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(16, Math.min(32_768, Math.round(parsed)))
    : fallback;
}

export function buildAss(
  segments,
  {
    style = 'Default',
    fontSize = 24,
    mode = 'translation',
    playResX = 1920,
    playResY = 1080,
  } = {}
) {
  const styleName = Object.hasOwn(ASS_STYLE_PRESETS, style) ? style : 'Default';
  const preset = ASS_STYLE_PRESETS[styleName];
  const boundedFontSize = Math.max(
    MIN_SUBTITLE_OUTPUT_FONT_SIZE,
    Math.min(MAX_SUBTITLE_OUTPUT_FONT_SIZE, Number(fontSize) || 24)
  );
  const boundedPlayResX = boundedAssPlayResolution(playResX, 1920);
  const boundedPlayResY = boundedAssPlayResolution(playResY, 1080);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${boundedPlayResX}\nPlayResY: ${boundedPlayResY}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: ${styleName},Noto Sans,${boundedFontSize},${preset.primary},&H000000FF,${preset.outline},${preset.back},-1,0,0,0,100,100,0,0,${preset.border},${preset.outlineSize},${preset.shadow},2,10,10,15,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return (
    header +
    segments
      .map(segment => {
        const text =
          mode === 'source'
            ? segment.source
            : segment.translation || segment.source;
        return `Dialogue: 0,${assTime(segment.start)},${assTime(segment.end)},${styleName},,0,0,0,,${escapeAssText(text)}`;
      })
      .join('\n') +
    '\n'
  );
}

function stableFileSnapshot(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(
    value => String(value)
  );
}

function sameFileSnapshot(left, right) {
  const leftSnapshot = stableFileSnapshot(left);
  const rightSnapshot = stableFileSnapshot(right);
  return leftSnapshot.every((value, index) => value === rightSnapshot[index]);
}

async function fingerprintRegularFile(
  filePath,
  { expectedSnapshot = null } = {}
) {
  const resolved = path.resolve(String(filePath || ''));
  if (!String(filePath || '').trim()) {
    throw new Error('A file path is required for integrity verification.');
  }
  const pathBefore = await fs.lstat(resolved, { bigint: true });
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    throw new Error(`Integrity target is not a regular file: ${resolved}`);
  }
  const flags =
    fsConstants.O_RDONLY |
    (process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0));
  const handle = await fs.open(resolved, flags);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFileSnapshot(pathBefore, before)) {
      throw new Error(`Integrity target is not a regular file: ${resolved}`);
    }
    if (expectedSnapshot && !sameFileSnapshot(expectedSnapshot, before)) {
      throw new Error(
        `File changed between metadata inspection and integrity verification: ${resolved}`
      );
    }
    const sha256 = await new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = handle.createReadStream({ autoClose: false });
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(resolved, { bigint: true });
    if (
      !after.isFile() ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      !sameFileSnapshot(before, after) ||
      !sameFileSnapshot(after, pathAfter)
    ) {
      throw new Error(
        `File changed while its integrity was being verified: ${resolved}`
      );
    }
    const bytes = Number(after.size);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(
        `Integrity target size exceeds the supported integer range: ${resolved}`
      );
    }
    return {
      path: resolved,
      bytes,
      modified_time_ms: Number(after.mtimeNs) / 1_000_000,
      sha256,
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function readStableBoundedTextFile(
  filePath,
  { maximumBytes, label = 'File' }
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new Error(`${label} requires a non-negative byte limit.`);
  }
  const resolved = path.resolve(String(filePath || ''));
  if (!String(filePath || '').trim()) {
    throw new Error(`${label} path is required.`);
  }
  const pathBefore = await fs.lstat(resolved, { bigint: true });
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file: ${resolved}`);
  }
  if (pathBefore.size > BigInt(maximumBytes)) {
    throw new Error(`${label} exceeds the ${maximumBytes}-byte limit.`);
  }
  const flags =
    fsConstants.O_RDONLY |
    (process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0));
  const handle = await fs.open(resolved, flags);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFileSnapshot(pathBefore, before)) {
      throw new Error(`${label} is not a stable regular file: ${resolved}`);
    }
    if (before.size > BigInt(maximumBytes)) {
      throw new Error(`${label} exceeds the ${maximumBytes}-byte limit.`);
    }
    const bytes = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(resolved, { bigint: true });
    if (
      offset > maximumBytes ||
      !after.isFile() ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      !sameFileSnapshot(before, after) ||
      !sameFileSnapshot(after, pathAfter)
    ) {
      throw new Error(`${label} changed while it was being read: ${resolved}`);
    }
    const content = bytes.subarray(0, offset);
    return {
      path: resolved,
      bytes: offset,
      modified_time_ms: Number(after.mtimeNs) / 1_000_000,
      sha256: createHash('sha256').update(content).digest('hex'),
      text: content.toString('utf8'),
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export class McpV2Service {
  constructor({
    environment,
    store,
    callApp,
    serverVersion = MCP_SERVER_VERSION,
    now = () => new Date(),
    ownerLease = createJobOwnerLease(),
    probeOwnerLease = probeJobOwnerLease,
  }) {
    this.environment = cleanEnvironment(environment);
    this.store = store;
    this.callApp = callApp;
    this.serverVersion = serverVersion;
    this.now = now;
    this.events = new EventEmitter();
    this.events.setMaxListeners(200);
    this.pendingWatchInterrupts = new Set();
    this.pendingWatchCompletions = new Set();
    this.pendingExecutions = new Set();
    this.shutdownReason = null;
    this.activeStageClaims = new Map();
    this.activePreviewRenders = new Map();
    this.activeOutputVerifications = new Map();
    this.ownerLease = ownerLease;
    this.probeOwnerLease = probeOwnerLease;
    this.ownerLeaseStartPromise = null;
    this.ownerLeaseClosePromise = null;
  }

  async ensureOwnerLease() {
    if (!this.ownerLeaseStartPromise) {
      this.ownerLeaseStartPromise = Promise.resolve(
        this.ownerLease.start()
      ).then(() => this.ownerLease.descriptor());
    }
    return this.ownerLeaseStartPromise;
  }

  closeOwnerLease() {
    if (!this.ownerLeaseClosePromise) {
      this.ownerLeaseClosePromise = Promise.resolve().then(() =>
        this.ownerLease.close()
      );
    }
    return this.ownerLeaseClosePromise;
  }

  async acquireJobActivity(jobId, activityKind) {
    const owner = await this.ensureOwnerLease();
    const activityToken = randomUUID();
    const claim = this.store.claimJobActivity(
      jobId,
      activityKind,
      activityToken,
      owner
    );
    if (claim.claimed) return { owner, activityToken };
    if (claim.owner && (await this.probeOwnerLease(claim.owner))) {
      const error = new Error(
        `Persistent job activity ${claim.activity_kind} is still owned by another live helper.`
      );
      error.code = 'JOB_ACTIVITY_ACTIVE';
      error.details = { activity_kind: claim.activity_kind };
      throw error;
    }
    if (
      claim.owner &&
      claim.activity_kind &&
      claim.activity_token &&
      this.store.replaceJobActivityClaim(
        jobId,
        claim.activity_kind,
        claim.activity_token,
        claim.owner,
        activityKind,
        activityToken,
        owner
      )
    ) {
      return { owner, activityToken };
    }
    const error = new Error(
      'Another helper acquired this persistent job activity concurrently.'
    );
    error.code = 'JOB_ACTIVITY_ACTIVE';
    error.details = {
      activity_kind:
        this.store.getJobActivityClaim(jobId)?.activity_kind || null,
    };
    throw error;
  }

  async withJobActivity(jobId, activityKind, callback) {
    const { owner, activityToken } = await this.acquireJobActivity(
      jobId,
      activityKind
    );
    try {
      return await callback();
    } finally {
      this.store.releaseJobActivity(jobId, activityKind, activityToken, owner);
    }
  }

  async execute(toolName, args = {}) {
    let resolveCompletion;
    const completion = new Promise(resolve => {
      resolveCompletion = resolve;
    });
    this.pendingExecutions.add(completion);
    try {
      if (this.shutdownReason) {
        return {
          isError: true,
          value: await this.envelope(
            toolName,
            null,
            {
              code: 'MCP_SHUTTING_DOWN',
              message: `The MCP controller is shutting down (${this.shutdownReason}).`,
              recoverable: false,
            },
            args || {},
            {
              connected: false,
              version: null,
              platform: process.platform,
              arch: process.arch,
              stage5: { account: null, credits: null },
              providers: {},
              planning: {},
              agent_control: null,
              connection_error: 'MCP controller shutdown is in progress.',
            }
          ),
        };
      }
      if (!MCP_V2_TOOL_NAMES.includes(toolName)) {
        return {
          isError: true,
          value: await this.envelope(toolName, null, {
            code: 'UNKNOWN_TOOL',
            message: `Unknown MCP v2 tool: ${toolName}`,
            recoverable: false,
          }),
        };
      }
      const parsedArgs = parseToolArguments(
        MCP_V2_TOOL_DEFINITIONS[toolName].inputSchema,
        args
      );
      const sharedContext = ['get_server_info', 'get_capabilities'].includes(
        toolName
      )
        ? await this.appContext()
        : null;
      const data = await this.dispatch(toolName, parsedArgs, sharedContext);
      return {
        isError: false,
        value: await this.envelope(
          toolName,
          data,
          null,
          parsedArgs,
          sharedContext
        ),
      };
    } catch (error) {
      return {
        isError: true,
        value: await this.envelope(
          toolName,
          null,
          {
            code: error?.code || 'MCP_V2_ERROR',
            message: error instanceof Error ? error.message : String(error),
            recoverable: error?.recoverable !== false,
            ...(isObject(error?.details) ? error.details : {}),
          },
          args || {}
        ),
      };
    } finally {
      this.pendingExecutions.delete(completion);
      resolveCompletion();
    }
  }

  async appContext() {
    try {
      const value = await this.callApp('mcpContext', {});
      return {
        connected: true,
        version: value?.app?.version || value?.appVersion || null,
        platform: value?.app?.platform || value?.platform || null,
        arch: value?.app?.arch || value?.arch || null,
        stage5: {
          account: value?.stage5?.account || null,
          credits: value?.stage5?.credits || null,
        },
        providers: value?.providers || {},
        planning: value?.planning || {},
        agent_control: value?.agent_control || null,
      };
    } catch (error) {
      return {
        connected: false,
        version: null,
        platform: process.platform,
        arch: process.arch,
        stage5: { account: null, credits: null },
        providers: {},
        planning: {},
        agent_control: null,
        connection_error:
          error instanceof Error ? error.message : String(error),
      };
    }
  }

  executionBilling(toolName, args, data, context, error = null) {
    const base = getMcpToolBilling(toolName, args, context);
    if (!['create_job', 'resume_job', 'retry_stage'].includes(toolName)) {
      const observedJob =
        data?.job ||
        (data?.job_id && Array.isArray(data?.stages) ? data : null);
      if (
        observedJob &&
        Array.isArray(observedJob.stages) &&
        !TERMINAL.has(observedJob.status)
      ) {
        let plan = null;
        try {
          plan = this.store.getPlan(observedJob.plan_hash);
        } catch {
          // Return the base tool policy if a stale job cannot resolve its plan.
        }
        const stageIndex = Math.max(0, Number(observedJob.stage_index) || 0);
        const remainingStage5Credits = plan
          ? observedJob.stages
              .slice(stageIndex)
              .reduce(
                (total, stage) =>
                  total +
                  Math.max(
                    0,
                    Number(
                      this.stageRuntimeRequirement(plan, stage)
                        ?.estimated_stage5_credits || 0
                    )
                  ),
                0
              )
          : 0;
        if (remainingStage5Credits <= 0) return base;
        const currentStage = observedJob.stages[stageIndex] || null;
        const currentStageCredits = Math.max(
          0,
          Number(
            this.stageRuntimeRequirement(plan, currentStage)
              ?.estimated_stage5_credits || 0
          )
        );
        return {
          ...base,
          authorized_background_job_may_consume_stage5_credits: true,
          authorized_background_job_is_in_paid_stage:
            currentStageCredits > 0 &&
            [
              'starting',
              'running',
              'cancel_requested',
              'pause_requested',
            ].includes(observedJob.status),
          remaining_estimated_stage5_credits: remainingStage5Credits,
          authorization_source: 'persisted_job_credit_authorization',
          authorized_stage5_credits:
            Number(observedJob.credit_usage?.authorized_stage5_credits || 0) ||
            0,
          consumed_stage5_credits:
            Number(observedJob.credit_usage?.consumed_stage5_credits || 0) || 0,
          consumption_attribution_authoritative:
            observedJob.credit_usage?.consumption_attribution_authoritative ??
            null,
          authorization_is_hard_cap: false,
          authorization_scope: 'preflight_estimate_gate',
        };
      }
      return base;
    }

    let job = data?.job || null;
    let plan = null;
    try {
      if (!job && args?.job_id) job = this.store.getJob(args.job_id);
      if (!job && toolName === 'create_job' && args?.idempotency_key) {
        job = this.store.getJobByIdempotencyKey(args.idempotency_key);
      }
      const planHash = job?.plan_hash || args?.plan_hash;
      if (planHash) plan = this.store.getPlan(planHash);
    } catch {
      // Preserve the original tool result when billing metadata cannot be
      // reconstructed (for example, an invalid job or plan identifier).
    }
    const estimated = Number(
      job?.credit_usage?.estimated_stage5_credits ??
        plan?.credit_usage?.total_stage5_credits
    );
    const active = !job || !TERMINAL.has(job.status);
    const requestSucceeded = !error;
    return {
      ...base,
      will_consume_stage5_credits: Number.isFinite(estimated)
        ? requestSucceeded && active && estimated > 0
        : requestSucceeded
          ? null
          : false,
      estimated_stage5_credits: Number.isFinite(estimated) ? estimated : null,
      authorized_stage5_credits: job
        ? Number(job.credit_usage?.authorized_stage5_credits || 0) || 0
        : Number(args?.credit_authorization?.max_stage5_credits || 0) || 0,
      consumed_stage5_credits: job
        ? Number(job.credit_usage?.consumed_stage5_credits || 0) || 0
        : 0,
      consumption_attribution_authoritative: job
        ? (job.credit_usage?.consumption_attribution_authoritative ?? null)
        : null,
      authorization_source: job
        ? 'persisted_job_credit_authorization'
        : 'requested_credit_authorization',
      request_succeeded: requestSucceeded,
      failed_request_granted_new_authorization: error ? false : null,
      ...(error && job && active && Number.isFinite(estimated) && estimated > 0
        ? {
            authorized_background_job_may_consume_stage5_credits: true,
            authorized_background_job_is_in_paid_stage: [
              'starting',
              'running',
              'cancel_requested',
              'pause_requested',
            ].includes(job.status),
          }
        : {}),
      authorization_is_hard_cap: false,
      authorization_scope: 'preflight_estimate_gate',
      authorization_note:
        'The authorization prevents starting a plan whose estimate exceeds the accepted amount. Provider settlement can differ from the estimate, so this is not an absolute backend spend cap.',
    };
  }

  async envelope(
    toolName,
    data,
    error = null,
    args = {},
    sharedContext = null
  ) {
    const context = sharedContext || (await this.appContext());
    return {
      ok: !error,
      schema_version: MCP_V2_SCHEMA_VERSION,
      environment: this.environment,
      server: {
        name: MCP_SERVER_NAMES[this.environment],
        version: this.serverVersion,
        protocol_version: MCP_V2_PROTOCOL_VERSION,
      },
      app: {
        connected: context.connected,
        version: context.version,
        platform: context.platform,
        arch: context.arch,
      },
      stage5: context.stage5,
      billing: this.executionBilling(toolName, args, data, context, error),
      ...(error ? { error } : { data: publicToolData(data) }),
    };
  }

  async dispatch(toolName, args, sharedContext = null) {
    switch (toolName) {
      case 'get_server_info':
        return this.getServerInfo(sharedContext);
      case 'get_capabilities':
        return this.getCapabilities(sharedContext);
      case 'doctor':
        return this.doctor(args);
      case 'probe_source':
        return this.probeSource(args.source);
      case 'plan_job':
        return this.planJob(args);
      case 'preflight_render_checkpoint_fork':
        return this.preflightRenderCheckpointFork(args);
      case 'create_render_checkpoint_fork':
        return this.createRenderCheckpointFork(args);
      case 'create_job':
        return this.createJob(args);
      case 'get_job':
        return this.getJob(args);
      case 'list_jobs':
        return this.listJobs(args);
      case 'watch_job':
        return this.watchJob(args);
      case 'pause_job':
        return this.pauseJob(args.job_id);
      case 'resume_job':
        return this.resumeJob(args.job_id);
      case 'cancel_job':
        return this.cancelJob(args.job_id);
      case 'retry_stage':
        return this.retryStage(
          args.job_id,
          args.stage,
          args.confirm_paid_retry
        );
      case 'get_transcript_batch':
        return this.getTranscriptBatch(args);
      case 'submit_translation_batch':
        return this.submitTranslationBatch(args);
      case 'validate_translation':
        return this.validateTranslation(args.job_id);
      case 'get_project_profile':
        return this.getProjectProfile(args.name);
      case 'save_project_profile':
        return this.store.saveProfile(args.name, args.profile);
      case 'render_preview':
        return this.renderPreview(args.job_id);
      case 'render_outputs':
        return this.renderOutputs(args.job_id, args.allow_warnings === true);
      case 'verify_outputs':
        return this.verifyOutputs(args.job_id);
      case 'get_job_manifest':
        return this.getJobManifest(args.job_id);
      case 'prepare_youtube_upload':
        return this.prepareYoutubeUpload(args);
      case 'prepare_x_post':
        return this.prepareXPost(args);
      default:
        throw new Error(`Unhandled MCP v2 tool: ${toolName}`);
    }
  }

  async getServerInfo(sharedContext = null) {
    const context = sharedContext || (await this.appContext());
    return {
      environment: this.environment,
      server_name: MCP_SERVER_NAMES[this.environment],
      server_version: this.serverVersion,
      protocol_version: MCP_V2_PROTOCOL_VERSION,
      app: context,
      invariant:
        'Every response repeats environment, versions, masked Stage5 identity, the current credit snapshot and authority flag, and tool billing.',
    };
  }

  async getCapabilities(sharedContext = null) {
    const context = sharedContext || (await this.appContext());
    const appBindingProtocol = appSourceBindingProtocolVersion(context);
    return {
      schema_version: MCP_V2_SCHEMA_VERSION,
      tools: MCP_V2_TOOL_NAMES,
      legacy_tools_preserved: true,
      legacy_tool_safety: {
        durable_job_guarantees: false,
        preflight_cost_estimate: false,
        idempotency_key: false,
        guidance:
          'Legacy paid-inference tools remain for compatibility and are labeled as low-level. Use plan_job/create_job for durable, estimated, idempotent work.',
      },
      job_persistence: {
        storage: 'transactional_sqlite',
        survives_mcp_disconnect: true,
        survives_agent_context_reset: true,
        survives_app_restart: true,
        costly_stage_automatic_replay_after_app_restart: false,
        ambiguous_inference_policy:
          'block_for_explicit_review_instead_of_risking_duplicate_credit_spend',
        event_cursor: true,
      },
      source_binding: {
        protocol_version: SOURCE_BINDING_PROTOCOL_VERSION,
        app_protocol_version: appBindingProtocol,
        app_attested: appBindingProtocol === SOURCE_BINDING_PROTOCOL_VERSION,
        safe_for_new_jobs:
          context.connected === true &&
          appBindingProtocol === SOURCE_BINDING_PROTOCOL_VERSION,
        start_states: ['preparing', 'mounted'],
        unverified_workspace_redaction: true,
      },
      render_checkpoint_recovery: {
        schema_version: RENDER_CHECKPOINT_FORK_VERSION,
        pure_preflight: true,
        preflight_persists_state: false,
        fork_starts_rendering: false,
        fork_requires_explicit_render_outputs: true,
        preserves_translation_checkpoint: true,
        preserves_validation_checkpoint: true,
        paid_stage_replay_allowed: false,
        allowed_stages: RENDER_CHECKPOINT_FORK_STAGES.map(stage => stage.id),
      },
      source_types: ['url', 'local_file', 'library_item', 'transcript', 'mock'],
      languages: {
        source: 'automatic detection or provider-supported language code',
        target:
          'any non-empty Translator language name supported by the active model',
        fixed_enumeration: false,
      },
      active_provider_routes: clone(context.providers || {}),
      transcription_methods: [
        'stage5',
        'byo',
        'creator_captions',
        'youtube_auto_captions',
        'imported_transcript',
        'reuse',
        'none',
      ],
      translation_providers: ['agent', 'stage5', 'byo', 'none'],
      subtitle_formats: ['srt', 'vtt', 'ass'],
      encoding_presets: ENCODING_PRESETS,
      platform_limits: PLATFORM_LIMITS,
      limits: {
        transcript_bytes: MAX_TRANSCRIPT_BYTES,
        translation_session_text_characters: 32 * 1024 * 1024,
        translation_batch_segments: 40,
        validation_issue_details: DEFAULT_SUBTITLE_ISSUE_DETAIL_LIMIT,
        project_glossary_terms: 1000,
      },
      external_translation: {
        stable_segment_ids: true,
        semantic_batches: true,
        overlapping_read_only_context: true,
        exact_submission_binding: true,
        resumable: true,
      },
      publishing: {
        preparation_available: true,
        direct_upload_available: false,
        public_action_is_separate: true,
      },
      mock_mode: {
        consumes_stage5_credits: false,
        durable_generated_media: true,
        end_to_end_rendering: true,
      },
    };
  }

  async doctor({ check_network: checkNetwork = true } = {}) {
    try {
      const app = await this.callApp('mcpDoctor', { checkNetwork });
      const checks = Array.isArray(app?.checks) ? app.checks : [];
      return {
        passed:
          checks.length > 0 && checks.every(check => check.status !== 'failed'),
        checked_at: this.now().toISOString(),
        checks,
        app,
      };
    } catch (error) {
      return {
        passed: false,
        checked_at: this.now().toISOString(),
        checks: [
          {
            name: 'translator-app',
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          },
        ],
        app: null,
      };
    }
  }

  async probeSource(source) {
    assertExactlyOneSource(source);
    const kind = sourceKind(source);
    if (kind === 'mock') {
      const provisioned = await this.callApp('probeSource', {
        source: { mock: true },
      });
      const mockPath = path.resolve(
        String(provisioned?.source?.path || '').trim()
      );
      if (!String(provisioned?.source?.path || '').trim()) {
        throw new Error(
          'Translator did not return a durable media path for the mock workflow.'
        );
      }
      // Re-probe between exact filesystem snapshots after provisioning. This
      // binds the metadata and content hash to the same durable sample bytes.
      const { appProbe, fingerprint } =
        await this.probeStableLocalFile(mockPath);
      const sourceKey = `mock:v${MOCK_SOURCE_VERSION}:sha256:${fingerprint.sha256}`;
      return {
        ...appProbe,
        source: {
          kind,
          version: MOCK_SOURCE_VERSION,
          path: fingerprint.path,
          bytes: fingerprint.bytes,
          modified_time_ms: fingerprint.modified_time_ms,
          sha256: fingerprint.sha256,
          source_key: sourceKey,
        },
        metadata: {
          ...(appProbe?.metadata || {}),
          title: 'Translator MCP no-credit sample',
          authentication_required: false,
        },
        compatibility: appProbe?.compatibility || [],
        prior_jobs: this.store.findSourceRecords(sourceKey),
        consumes_stage5_credits: false,
      };
    }
    if (kind === 'transcript') {
      const {
        path: transcriptPath,
        text,
        stat,
      } = await readBoundedSrtTranscript(source.transcript_path);
      const analysis = parseSrtWithDiagnostics(text);
      const { segments } = analysis;
      if (!segments.length)
        throw new Error('Transcript contains no readable SRT cues.');
      const sourceKey = `transcript:sha256:${createHash('sha256').update(text).digest('hex')}`;
      return {
        source: {
          kind,
          transcript_path: transcriptPath,
          source_key: sourceKey,
        },
        metadata: {
          title: path.basename(transcriptPath),
          duration_seconds: maximumSegmentEnd(segments),
          subtitle_cue_count: segments.length,
          bytes: stat.size,
        },
        compatibility: [
          ...transcriptStructureFindings(analysis),
          ...transcriptTimingFindings(segments),
        ],
        prior_jobs: this.store.findSourceRecords(sourceKey),
        consumes_stage5_credits: false,
      };
    }
    if (kind === 'local_file') {
      const localPath = path.resolve(String(source.path));
      const { appProbe, fingerprint } =
        await this.probeStableLocalFile(localPath);
      const sourceKey = `file:sha256:${fingerprint.sha256}`;
      return {
        ...appProbe,
        source: {
          kind,
          path: fingerprint.path,
          bytes: fingerprint.bytes,
          modified_time_ms: fingerprint.modified_time_ms,
          sha256: fingerprint.sha256,
          source_key: sourceKey,
        },
        prior_jobs: this.store.findSourceRecords(sourceKey),
        consumes_stage5_credits: false,
      };
    }
    if (kind === 'url') {
      const parsed = new URL(String(source.url));
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http and https source URLs are supported.');
      }
      if (parsed.username || parsed.password) {
        throw new Error('Source URLs cannot contain embedded credentials.');
      }
      parsed.hash = '';
      const appProbe = await this.callApp('probeSource', {
        source: { url: parsed.toString() },
      });
      let canonicalUrl = String(
        appProbe?.source?.canonical_url || parsed.toString()
      );
      try {
        const canonical = new URL(canonicalUrl);
        if (!['http:', 'https:'].includes(canonical.protocol)) {
          throw new Error('unsupported protocol');
        }
        if (canonical.username || canonical.password) {
          throw new Error('embedded credentials');
        }
        canonical.hash = '';
        canonicalUrl = canonical.toString();
      } catch {
        canonicalUrl = parsed.toString();
      }
      if (canonicalUrl.length > 32_768) {
        throw new Error('Canonical source URL exceeds 32,768 characters.');
      }
      const extractor = cleanOpaqueSourceIdentity(
        appProbe?.source?.extractor,
        256
      );
      const mediaId = cleanOpaqueSourceIdentity(
        appProbe?.source?.media_id,
        1024
      );
      const sourceKey =
        extractor && mediaId
          ? hashedSourceIdentityKey(
              'media',
              `${extractor.toLowerCase()}\u0000${mediaId}`
            )
          : hashedSourceIdentityKey('url', canonicalUrl);
      return {
        ...appProbe,
        source: {
          kind,
          url: parsed.toString(),
          canonical_url: canonicalUrl,
          extractor,
          media_id: mediaId,
          source_key: sourceKey,
        },
        prior_jobs: this.store.findSourceRecords(sourceKey),
        consumes_stage5_credits: false,
      };
    }
    const historyId = String(source.history_id).trim();
    const status = await this.callApp('status', { historyId });
    const localPath = path.resolve(String(status?.videoPath || ''));
    if (!String(status?.videoPath || '').trim()) {
      throw new Error(`Library item has no readable video path: ${historyId}`);
    }
    const [{ appProbe, fingerprint }, segments] = await Promise.all([
      this.probeStableLocalFile(localPath),
      this.readAllAppSubtitles({ kind: 'library_item', history_id: historyId }),
    ]);
    const sourceKey = `file:sha256:${fingerprint.sha256}`;
    const subtitleSha256 = segments.length
      ? subtitleSourceSha256(segments)
      : null;
    return {
      ...appProbe,
      source: {
        kind,
        history_id: historyId,
        path: fingerprint.path,
        bytes: fingerprint.bytes,
        modified_time_ms: fingerprint.modified_time_ms,
        sha256: fingerprint.sha256,
        source_key: sourceKey,
      },
      metadata: {
        ...(appProbe?.metadata || {}),
        title: status?.historyTitle || historyId,
        subtitle_cue_count: segments.length,
        subtitle_source_sha256: subtitleSha256,
      },
      compatibility: appProbe?.compatibility || [],
      prior_jobs: this.store.findSourceRecords(sourceKey),
      consumes_stage5_credits: false,
    };
  }

  async probeStableLocalFile(localPath) {
    const canonicalPath = await fs.realpath(localPath);
    const before = await fs.stat(canonicalPath, { bigint: true });
    if (!before.isFile()) {
      throw new Error(`Source is not a regular file: ${localPath}`);
    }
    const appProbe = await this.callApp('probeSource', {
      source: { path: canonicalPath },
    });
    const after = await fs.stat(canonicalPath, { bigint: true });
    if (!after.isFile() || !sameFileSnapshot(before, after)) {
      throw new Error(
        `Source changed while Translator inspected its metadata: ${canonicalPath}`
      );
    }
    const fingerprint = await fingerprintRegularFile(canonicalPath, {
      expectedSnapshot: after,
    });
    return { appProbe, fingerprint };
  }

  async planJob(request) {
    assertPlanGlossary(request.per_video_glossary);
    const probe = await this.probeSource(request.source);
    const context = await this.appContext();
    const profileName = request.project_profile || 'stage5_korean';
    const profile = this.store.getProfile(profileName);
    if (!profile) throw new Error(`Project profile not found: ${profileName}`);
    assertPlanGlossary({
      ...(profile.glossary || {}),
      ...(request.per_video_glossary || {}),
    });
    const durationSeconds = Number(probe.metadata?.duration_seconds);
    const durationKnown =
      Number.isFinite(durationSeconds) && durationSeconds > 0;
    const durationHours = durationKnown ? durationSeconds / 3600 : null;
    const transcriptionMethod = ['transcript', 'mock'].includes(
      probe.source.kind
    )
      ? 'imported_transcript'
      : request.transcription_method || 'stage5';
    const translationProvider = request.translation_provider || 'agent';
    const targetLanguage =
      request.target_language || profile.target_language || null;
    const rates = { ...DEFAULT_CREDIT_RATES };
    for (const rateName of Object.keys(DEFAULT_CREDIT_RATES)) {
      const configured = context.planning?.credit_rates?.[rateName];
      if (configured === undefined) continue;
      const parsed = Number(configured);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(
          `Translator returned an invalid ${rateName} planning rate.`
        );
      }
      rates[rateName] = parsed;
    }
    const qualityTranslation = context.planning?.quality_translation === true;
    const includeSummary =
      request.include_summary === true || request.include_highlights === true;
    const summaryEffort = request.summary_effort_level || 'standard';
    const summaryDescriptor =
      summaryEffort === 'high'
        ? context.providers?.summary_high
        : context.providers?.summary;
    const dubbingDescriptor = context.providers?.dubbing || {};
    const dubbingRoute = `${dubbingDescriptor.provider || ''}:${dubbingDescriptor.model || ''}`;
    const dubbingRate = /eleven/i.test(dubbingRoute)
      ? rates.dubbing_elevenlabs_per_minute
      : rates.dubbing_openai_per_minute;
    const creditUsage = {
      transcription:
        transcriptionMethod === 'stage5' && durationKnown
          ? Math.ceil(durationHours * rates.transcription_per_hour)
          : 0,
      translation:
        translationProvider === 'stage5' && durationKnown
          ? Math.ceil(
              durationHours *
                (qualityTranslation
                  ? rates.translation_quality_per_hour
                  : rates.translation_standard_per_hour)
            )
          : 0,
      summary:
        includeSummary && summaryDescriptor?.kind === 'stage5' && durationKnown
          ? Math.ceil(
              durationHours *
                (summaryEffort === 'high'
                  ? rates.summary_high_per_hour
                  : rates.summary_standard_per_hour)
            )
          : 0,
      rendering: 0,
      dubbing:
        request.include_dubbing &&
        context.providers?.dubbing?.kind === 'stage5' &&
        durationKnown
          ? Math.ceil((durationSeconds / 60) * dubbingRate)
          : 0,
    };
    creditUsage.total_stage5_credits = Object.values(creditUsage).reduce(
      (total, value) => total + (Number(value) || 0),
      0
    );
    creditUsage.estimate = true;
    creditUsage.methodology =
      "Duration-based preflight estimate using the app's current authoritative provider routes and pricing constants. Settled usage is recorded separately per stage.";
    creditUsage.authorization = {
      kind: 'preflight_estimate_gate',
      backend_enforced_hard_cap: false,
      note: 'The accepted maximum gates job start against this estimate. Provider settlement can differ after work begins.',
    };

    const compatibility = [...(probe.compatibility || [])];
    let importedTranscript = null;
    if (transcriptionMethod === 'imported_transcript') {
      if (probe.source.kind === 'transcript') {
        if (request.imported_transcript_path) {
          compatibility.push({
            severity: 'blocking',
            code: 'duplicate_imported_transcript_source',
            message:
              'Use either source.transcript_path or imported_transcript_path, not both.',
          });
        }
        importedTranscript = {
          path: probe.source.transcript_path,
          source_key: probe.source.source_key,
          cue_count: probe.metadata?.subtitle_cue_count || 0,
          duration_seconds: probe.metadata?.duration_seconds || null,
        };
      } else if (request.imported_transcript_path) {
        try {
          const imported = await readBoundedSrtTranscript(
            request.imported_transcript_path
          );
          const analysis = parseSrtWithDiagnostics(imported.text);
          const { segments } = analysis;
          if (!segments.length) {
            throw new Error(
              'Imported transcript contains no readable SRT cues.'
            );
          }
          importedTranscript = {
            path: imported.path,
            source_key: `transcript:sha256:${createHash('sha256').update(imported.text).digest('hex')}`,
            cue_count: segments.length,
            duration_seconds: maximumSegmentEnd(segments),
          };
          const sourceDuration = Number(probe.metadata?.duration_seconds);
          compatibility.push(
            ...transcriptStructureFindings(analysis, {
              label: 'The imported transcript',
              codePrefix: 'imported_transcript',
            }),
            ...transcriptTimingFindings(segments, {
              mediaDurationSeconds: sourceDuration,
              label: 'The imported transcript',
              codePrefix: 'imported_transcript',
            })
          );
        } catch (error) {
          compatibility.push({
            severity: 'blocking',
            code: 'imported_transcript_unavailable',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (probe.source.kind === 'library_item') {
        if (!probe.metadata?.subtitle_source_sha256) {
          compatibility.push({
            severity: 'blocking',
            code: 'library_transcript_unavailable',
            message:
              'The selected library item has no stored subtitles to import.',
          });
        }
      } else if (probe.source.kind === 'mock') {
        // Mock mode owns a bundled, immutable transcript and never reads app state.
      } else {
        compatibility.push({
          severity: 'blocking',
          code: 'imported_transcript_path_required',
          message:
            'This video source requires imported_transcript_path when transcription_method=imported_transcript.',
        });
      }
    } else if (request.imported_transcript_path) {
      compatibility.push({
        severity: 'blocking',
        code: 'unused_imported_transcript_path',
        message:
          'imported_transcript_path is valid only with transcription_method=imported_transcript.',
      });
    }
    if (
      !String(targetLanguage || '').trim() &&
      (translationProvider !== 'none' ||
        includeSummary ||
        request.include_dubbing === true)
    ) {
      compatibility.push({
        severity: 'blocking',
        code: 'target_language_required',
        message:
          'A target language is required by this workflow. Set target_language or select a project profile that defines one.',
      });
    }
    const captionKind =
      transcriptionMethod === 'creator_captions'
        ? 'creator'
        : transcriptionMethod === 'youtube_auto_captions'
          ? 'automatic'
          : null;
    const captionTrack = captionKind
      ? chooseCaptionTrack(
          probe.metadata?.caption_tracks,
          captionKind,
          request.caption_language
        )
      : null;
    if (captionKind && probe.source.kind !== 'url') {
      compatibility.push({
        severity: 'blocking',
        code: 'caption_source_must_be_url',
        message: 'Creator and automatic caption imports require a URL source.',
      });
    } else if (captionKind && !captionTrack) {
      compatibility.push({
        severity: 'blocking',
        code: 'caption_track_unavailable',
        message: request.caption_language
          ? `No ${captionKind} caption track matches ${request.caption_language}.`
          : `This source exposes no ${captionKind} caption track.`,
      });
    }
    let reuseSourceJobId = null;
    if (transcriptionMethod === 'reuse') {
      for (const record of probe.prior_jobs || []) {
        try {
          if (this.store.getTranslationSession(record.job_id)) {
            reuseSourceJobId = record.job_id;
            break;
          }
        } catch {
          // Ignore stale source-record rows and continue to the next candidate.
        }
      }
      if (!reuseSourceJobId) {
        compatibility.push({
          severity: 'blocking',
          code: 'reusable_transcript_unavailable',
          message:
            'No prior persistent job has a reusable transcript for this exact source.',
        });
      }
    }
    const paidSelection =
      transcriptionMethod === 'stage5' ||
      translationProvider === 'stage5' ||
      (includeSummary && summaryDescriptor?.kind === 'stage5') ||
      (request.include_dubbing &&
        context.providers?.dubbing?.kind === 'stage5');
    if (paidSelection && !durationKnown) {
      compatibility.push({
        severity: 'blocking',
        code: 'duration_required_for_credit_authorization',
        message:
          'Source duration must be known before a paid Stage5 job can be authorized.',
      });
    }
    if (translationProvider === 'agent') {
      compatibility.push({
        severity: 'info',
        code: 'external_agent_translation_locked',
        message:
          'Agent translation consumes zero Stage5 translation credits and cannot fall back to Stage5.',
      });
    }
    if ((probe.prior_jobs || []).length > 0) {
      compatibility.push({
        severity: 'info',
        code: 'prior_exact_source_jobs_available',
        message:
          'Persistent jobs already exist for this exact source. Inspect prior_jobs and choose transcription_method=reuse when an existing transcript is suitable.',
        prior_job_ids: probe.prior_jobs.map(record => record.job_id),
      });
    }
    if (
      transcriptionMethod === 'stage5' &&
      context.providers?.transcription?.kind !== 'stage5'
    ) {
      compatibility.push({
        severity: 'blocking',
        code: 'stage5_transcription_not_active',
        message:
          "transcription_method=stage5 does not match the app's active transcription route.",
      });
    }
    if (
      transcriptionMethod === 'byo' &&
      context.providers?.transcription?.kind !== 'byo'
    ) {
      compatibility.push({
        severity: 'blocking',
        code: 'byo_transcription_not_active',
        message:
          'The app is not currently configured with an active BYO transcription provider.',
      });
    }
    if (
      translationProvider === 'stage5' &&
      context.providers?.translation?.kind !== 'stage5'
    ) {
      compatibility.push({
        severity: 'blocking',
        code: 'stage5_translation_not_active',
        message:
          "translation_provider=stage5 does not match the app's active translation route.",
      });
    }
    if (
      translationProvider === 'byo' &&
      context.providers?.translation?.kind !== 'byo'
    ) {
      compatibility.push({
        severity: 'blocking',
        code: 'byo_translation_not_active',
        message:
          'The app is not currently configured with an active BYO translation provider.',
      });
    }
    for (const [enabled, providerName, descriptor] of [
      [includeSummary, 'summary', summaryDescriptor],
      [request.include_dubbing === true, 'dubbing', context.providers?.dubbing],
    ]) {
      if (enabled && !['stage5', 'byo'].includes(descriptor?.kind)) {
        compatibility.push({
          severity: 'blocking',
          code: `${providerName}_provider_unavailable`,
          message: `The app has no usable ${providerName} provider for this plan.`,
        });
      }
    }
    if (request.include_dubbing && translationProvider === 'none') {
      compatibility.push({
        severity: 'blocking',
        code: 'dubbing_translation_required',
        message:
          'Dubbing requires translated cues; choose agent, Stage5, or BYO translation.',
      });
    }

    const outputsRequested = isObject(request.outputs);
    const requestedOutputs = request.outputs || {};
    const presets = requestedOutputs.presets || [];
    const subtitleFormats = outputsRequested
      ? requestedOutputs.subtitle_formats || ['srt']
      : [];
    const xTier = requestedOutputs.x_account_tier || 'standard';
    if (new Set(presets).size !== presets.length) {
      compatibility.push({
        severity: 'blocking',
        code: 'duplicate_encoding_presets',
        message: 'Encoding presets must be unique.',
      });
    }
    if (new Set(subtitleFormats).size !== subtitleFormats.length) {
      compatibility.push({
        severity: 'blocking',
        code: 'duplicate_subtitle_formats',
        message: 'Subtitle output formats must be unique.',
      });
    }
    if (
      (presets.length || subtitleFormats.length) &&
      !requestedOutputs.output_directory
    ) {
      compatibility.push({
        severity: 'blocking',
        code: 'output_directory_required',
        message:
          'Video presets and subtitle exports require an explicit existing output directory.',
      });
    }
    if (presets.length && probe.source.kind === 'transcript') {
      compatibility.push({
        severity: 'blocking',
        code: 'video_source_required_for_rendering',
        message:
          'Rendered video presets require a video source, not a transcript-only source.',
      });
    }
    if (request.include_dubbing && probe.source.kind === 'transcript') {
      compatibility.push({
        severity: 'blocking',
        code: 'media_source_required_for_dubbing',
        message:
          'Dubbing requires a media source with audio, not a transcript-only source.',
      });
    }
    const needsSubtitleDocument =
      translationProvider !== 'none' ||
      includeSummary ||
      request.include_dubbing === true ||
      presets.length > 0 ||
      subtitleFormats.length > 0;
    if (transcriptionMethod === 'none' && needsSubtitleDocument) {
      compatibility.push({
        severity: 'blocking',
        code: 'subtitle_source_required',
        message:
          'transcription_method=none cannot be combined with translation, summary, dubbing, rendered outputs, or subtitle exports.',
      });
    }
    const estimatedOutputBytes = durationKnown
      ? presets.reduce((total, preset) => {
          const bits =
            durationSeconds *
            (PRESET_ESTIMATES[preset]?.megabits_per_second || 8) *
            1_000_000;
          return total + bits / 8;
        }, 0)
      : null;
    const estimatedRepresentativeFrameBytes = presets.length
      ? (3 + presets.length * 3) * 5 * 1024 * 1024
      : 0;
    const sourceBytes = Math.max(0, Number(probe.metadata?.bytes || 0));
    const intermediateMasterBytes =
      durationKnown &&
      presets.length > 0 &&
      requestedOutputs.burn_subtitles !== false
        ? Math.max(sourceBytes, durationSeconds * 1_000_000)
        : 0;
    const urlMediaDownloadRequired =
      probe.source.kind === 'url' &&
      (['stage5', 'byo'].includes(transcriptionMethod) ||
        presets.length > 0 ||
        request.include_dubbing === true);
    const estimatedSourceDownloadBytes = urlMediaDownloadRequired
      ? sourceBytes || null
      : 0;
    for (const preset of presets.filter(value =>
      value.startsWith('youtube_')
    )) {
      const estimatedPresetBytes = durationKnown
        ? (durationSeconds *
            (PRESET_ESTIMATES[preset]?.megabits_per_second || 8) *
            1_000_000) /
          8
        : null;
      if (
        durationKnown &&
        durationSeconds > PLATFORM_LIMITS.youtube.maximum_duration_seconds
      ) {
        compatibility.push({
          severity: 'blocking',
          code: 'youtube_duration_limit_exceeded',
          message: `${preset} exceeds YouTube's 12-hour upload limit.`,
        });
      }
      if (
        estimatedPresetBytes !== null &&
        estimatedPresetBytes > PLATFORM_LIMITS.youtube.maximum_bytes
      ) {
        compatibility.push({
          severity: 'blocking',
          code: 'youtube_estimated_size_limit_exceeded',
          message: `${preset} is estimated at ${Math.ceil(estimatedPresetBytes)} bytes, above YouTube's 256 GB upload limit.`,
        });
      }
    }
    for (const preset of presets.filter(value => value.startsWith('x_'))) {
      const estimatedPresetBytes = durationKnown
        ? (durationSeconds *
            (PRESET_ESTIMATES[preset]?.megabits_per_second || 8) *
            1_000_000) /
          8
        : null;
      const limits =
        xTier === 'premium'
          ? PLATFORM_LIMITS.x_premium
          : PLATFORM_LIMITS.x_standard;
      if (durationKnown && durationSeconds > limits.maximum_duration_seconds) {
        compatibility.push({
          severity: 'blocking',
          code: 'x_duration_limit_exceeded',
          message: `${preset} exceeds the selected X ${xTier} account duration limit of ${limits.maximum_duration_seconds} seconds.`,
        });
      }
      if (
        estimatedPresetBytes !== null &&
        estimatedPresetBytes > limits.maximum_bytes
      ) {
        compatibility.push({
          severity: 'blocking',
          code: 'x_estimated_size_limit_exceeded',
          message: `${preset} is estimated at ${Math.ceil(estimatedPresetBytes)} bytes, above the selected X ${xTier} account limit of ${limits.maximum_bytes} bytes.`,
        });
      }
      if (
        xTier === 'premium' &&
        preset === 'x_long_video_1080p' &&
        durationKnown &&
        durationSeconds >
          PLATFORM_LIMITS.x_premium.maximum_1080p_duration_seconds
      ) {
        compatibility.push({
          severity: 'blocking',
          code: 'x_1080p_duration_limit_exceeded',
          message:
            'X Premium videos longer than two hours must use the 720p preset.',
        });
      }
    }
    let outputDirectoryInspection = null;
    if (requestedOutputs.output_directory) {
      const baseName = cleanBaseName(
        requestedOutputs.base_name,
        probe.metadata?.title || 'translator-output'
      );
      const plannedFileNames = [
        ...(translationProvider !== 'none' ? [`${baseName}-source.srt`] : []),
        ...subtitleFormats.map(format => `${baseName}.${format}`),
        ...presets.map(preset => `${baseName}-${preset}.mp4`),
        ...(presets.length
          ? [1, 2, 3].map(index => `${baseName}-preview-${index}.png`)
          : []),
        ...presets.flatMap(preset =>
          [1, 2, 3].map(index => `${baseName}-${preset}-verified-${index}.png`)
        ),
        `${baseName}-manifest.json`,
      ];
      try {
        outputDirectoryInspection = await this.callApp(
          'inspectOutputDirectory',
          {
            path: requestedOutputs.output_directory,
            fileNames: plannedFileNames,
          }
        );
        if (
          requestedOutputs.overwrite !== true &&
          outputDirectoryInspection.existing_files?.length
        ) {
          compatibility.push({
            severity: 'blocking',
            code: 'planned_output_exists',
            message: `Planned outputs already exist and overwrite is false: ${outputDirectoryInspection.existing_files.join(', ')}`,
          });
        }
        const protectedInputs = [
          probe.source?.path,
          probe.source?.transcript_path,
          importedTranscript?.path,
        ].filter(Boolean);
        const inspectedPlannedFiles = Array.isArray(
          outputDirectoryInspection.planned_files
        )
          ? outputDirectoryInspection.planned_files
          : plannedFileNames.map(fileName =>
              path.join(outputDirectoryInspection.path, fileName)
            );
        const overlappingInputs = await findOutputInputOverlaps(
          inspectedPlannedFiles,
          protectedInputs
        );
        if (overlappingInputs.length > 0) {
          compatibility.push({
            severity: 'blocking',
            code: 'output_overlaps_input',
            message: `A planned output would overwrite workflow input: ${overlappingInputs.join(', ')}`,
          });
        }
        const workingBytes =
          (estimatedOutputBytes || 0) +
          intermediateMasterBytes +
          estimatedRepresentativeFrameBytes;
        if (
          workingBytes > 0 &&
          Number(outputDirectoryInspection.available_bytes) <
            Math.ceil(workingBytes * 1.2)
        ) {
          compatibility.push({
            severity: 'blocking',
            code: 'insufficient_output_disk_space',
            message: `The output filesystem has ${outputDirectoryInspection.available_bytes} bytes available; this plan requires approximately ${Math.ceil(workingBytes * 1.2)} bytes including working space.`,
          });
        }
      } catch (error) {
        compatibility.push({
          severity: 'blocking',
          code: 'output_directory_unavailable',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const encodeSeconds = durationKnown
      ? presets.reduce(
          (total, preset) =>
            total +
            durationSeconds /
              (PRESET_ESTIMATES[preset]?.relative_encode_speed || 0.5),
          0
        )
      : 0;

    const stages = [];
    if (
      [
        'creator_captions',
        'youtube_auto_captions',
        'imported_transcript',
        'reuse',
        'none',
      ].includes(transcriptionMethod)
    ) {
      stages.push({ id: 'load_transcript', label: 'Load existing transcript' });
    } else {
      stages.push({
        id: 'transcription',
        label: 'Prepare media and transcribe',
      });
    }
    if (
      probe.source.kind === 'url' &&
      !['stage5', 'byo'].includes(transcriptionMethod) &&
      (presets.length > 0 || request.include_dubbing === true)
    ) {
      stages.splice(1, 0, {
        id: 'download_source',
        label: 'Download source media',
      });
    }
    if (translationProvider === 'agent') {
      stages.push({
        id: 'translation_external',
        label: 'External-agent translation',
      });
    } else if (translationProvider !== 'none') {
      stages.push({ id: 'translation_app', label: 'Translate subtitles' });
    }
    if (translationProvider !== 'none') {
      stages.push({
        id: 'translation_validation',
        label: 'Validate subtitles',
      });
    }
    if (includeSummary)
      stages.push({ id: 'summary', label: 'Generate metadata summary' });
    if (request.include_dubbing)
      stages.push({ id: 'dubbing', label: 'Generate dubbed master' });
    if (presets.length) {
      stages.push({ id: 'render_outputs', label: 'Render planned outputs' });
      stages.push({ id: 'verify_outputs', label: 'Verify rendered outputs' });
    }
    stages.push({ id: 'manifest', label: 'Write result manifest' });

    const subtitleRenderSpec = resolvePlannedSubtitleRenderSpec({
      requestedOutputs,
      profile,
      planning: context.planning,
      translationProvider,
      sourceMetadata: probe.metadata,
    });

    const plan = {
      source: probe.source,
      source_metadata: probe.metadata,
      source_probe: probe,
      project_profile: profileName,
      profile_revision: profile.revision || 0,
      profile_snapshot: clone(profile),
      target_language: targetLanguage,
      transcription: {
        method: transcriptionMethod,
        caption_track: captionTrack,
        reuse_source_job_id: reuseSourceJobId,
        subtitle_source_sha256: probe.metadata?.subtitle_source_sha256 || null,
        imported_transcript: importedTranscript,
        provider:
          transcriptionMethod === 'stage5'
            ? 'stage5'
            : transcriptionMethod === 'byo'
              ? context.providers?.transcription || { kind: 'byo' }
              : transcriptionMethod,
      },
      translation: {
        provider: translationProvider,
        stage5_fallback_allowed: false,
      },
      provider_snapshot: {
        ...clone(context.providers || {}),
        summary: clone(summaryDescriptor || null),
      },
      planning_snapshot: {
        quality_translation: context.planning?.quality_translation === true,
        quality_transcription: context.planning?.quality_transcription === true,
        credit_rates: clone(rates),
      },
      runtime_snapshot: {
        app_version: context.version || null,
        platform: context.platform || null,
        arch: context.arch || null,
      },
      options: clone({ ...request, include_summary: includeSummary }),
      outputs: {
        output_directory: outputDirectoryInspection?.path || null,
        base_name: cleanBaseName(
          requestedOutputs.base_name,
          probe.metadata?.title || 'translator-output'
        ),
        presets,
        subtitle_formats: subtitleFormats,
        burn_subtitles: requestedOutputs.burn_subtitles !== false,
        subtitle_display_mode: subtitleRenderSpec.display_mode,
        subtitle_style: subtitleRenderSpec.style,
        subtitle_font_size: subtitleRenderSpec.base_font_size_px,
        subtitle_render_spec: subtitleRenderSpec,
        x_account_tier: xTier,
        overwrite: requestedOutputs.overwrite === true,
      },
      platform_limits: PLATFORM_LIMITS,
      credit_usage: creditUsage,
      estimated_processing_time: {
        likely_seconds: durationKnown
          ? Math.ceil(durationSeconds * 0.4 + encodeSeconds)
          : null,
        range_seconds: durationKnown
          ? [
              Math.ceil(durationSeconds * 0.2),
              Math.ceil(durationSeconds * 1.2 + encodeSeconds * 1.5),
            ]
          : null,
      },
      estimated_disk_usage: {
        final_output_bytes:
          estimatedOutputBytes == null ? null : Math.ceil(estimatedOutputBytes),
        temporary_output_filesystem_bytes: Math.ceil(intermediateMasterBytes),
        representative_frame_bytes: estimatedRepresentativeFrameBytes,
        persistent_source_download_bytes:
          estimatedSourceDownloadBytes == null
            ? null
            : Math.ceil(estimatedSourceDownloadBytes),
        source_download_size_known:
          !urlMediaDownloadRequired || estimatedSourceDownloadBytes !== null,
        peak_additional_bytes:
          estimatedOutputBytes == null ||
          (urlMediaDownloadRequired && estimatedSourceDownloadBytes === null)
            ? null
            : Math.ceil(
                estimatedOutputBytes +
                  intermediateMasterBytes +
                  estimatedRepresentativeFrameBytes +
                  estimatedSourceDownloadBytes
              ),
        output_directory: outputDirectoryInspection,
      },
      compatibility,
      stages,
      expected_outputs: [
        ...(requestedOutputs.output_directory && translationProvider !== 'none'
          ? ['source_transcript_srt']
          : []),
        ...(requestedOutputs.output_directory
          ? subtitleFormats.map(format =>
              translationProvider === 'none'
                ? `source_subtitles_${format}`
                : `translated_subtitles_${format}`
            )
          : []),
        ...presets,
        ...(presets.length
          ? ['pre_encode_preview_frames', 'verified_output_frames']
          : []),
        requestedOutputs.output_directory ? 'manifest_json' : 'manifest_inline',
      ],
      no_cost_plan: true,
    };
    return this.store.putPlan({ request, plan });
  }

  async evaluateRenderCheckpointFork(args) {
    const expected = args.expected || {};
    const blockers = [];
    const block = (code, message) => blockers.push({ code, message });
    const before = renderRecoveryStateSnapshot(this.store, args.source_job_id);
    const sourceJob = before.job;
    const sourcePlan = before.plan;
    const sourceSession = before.session;
    const sourceKey = String(sourcePlan?.source?.source_key || '');
    const acceptance = translationAcceptanceSummary(sourceSession);
    const validationStage = sourceJob.stages?.find(
      stage => stage.id === 'translation_validation'
    );
    const renderStage = sourceJob.stages?.find(
      stage => stage.id === 'render_outputs'
    );
    const activeClaim = this.store.getJobActivityClaim(sourceJob.job_id);

    if (sourceJob.status !== 'cancelled') {
      block(
        'SOURCE_JOB_NOT_CANCELLED',
        'Render recovery requires an immutable canceled source job.'
      );
    }
    if (activeClaim) {
      block(
        'SOURCE_JOB_ACTIVITY_PRESENT',
        'The canceled source job still has an activity claim.'
      );
    }
    if (!sourcePlan) {
      block('SOURCE_PLAN_UNAVAILABLE', 'The source job plan is unavailable.');
    }
    if (!sourceSession) {
      block(
        'TRANSLATION_CHECKPOINT_UNAVAILABLE',
        'The source job has no persistent translation checkpoint.'
      );
    }
    if (
      !validationStage ||
      validationStage.status !== 'completed' ||
      sourceJob.validation?.passed !== true ||
      validationCheckpointSha256(validationStage?.result) !==
        before.validation_sha256
    ) {
      block(
        'VALIDATION_CHECKPOINT_INCOMPLETE',
        'The source job has no completed passing translation validation checkpoint.'
      );
    }
    if (!renderStage) {
      block(
        'RENDER_CHECKPOINT_UNAVAILABLE',
        'The source job has no planned render_outputs checkpoint.'
      );
    } else if (!hasRecoverableRenderCheckpoint(sourceJob)) {
      block(
        'RENDER_CHECKPOINT_ALREADY_ATTEMPTED',
        'The source render checkpoint is neither unstarted nor a clean terminal cancellation without rendered artifacts.'
      );
    }
    if (
      acceptance.accepted_segments !== acceptance.total_segments ||
      acceptance.pending_segments !== 0 ||
      acceptance.needs_correction_segments !== 0
    ) {
      block(
        'TRANSLATIONS_NOT_FULLY_ACCEPTED',
        'Every source checkpoint segment must have an accepted translation with no correction marker.'
      );
    }

    if (sourceKey !== expected.source_key) {
      block(
        'SOURCE_KEY_MISMATCH',
        'The source key does not match the expected immutable source.'
      );
    }
    if (before.session_sha256 !== expected.translation_session_sha256) {
      block(
        'TRANSLATION_SESSION_MISMATCH',
        'The translation session digest does not match the expected checkpoint.'
      );
    }
    if (
      acceptance.accepted_segments !== Number(expected.accepted_segment_count)
    ) {
      block(
        'ACCEPTED_SEGMENT_COUNT_MISMATCH',
        'The accepted translation count does not match the expected checkpoint.'
      );
    }
    if (
      String(sourceSession?.target_language || '') !==
      String(expected.target_language || '')
    ) {
      block(
        'TARGET_LANGUAGE_MISMATCH',
        'The translation checkpoint target language does not match.'
      );
    }
    if (before.validation_sha256 !== expected.validation_sha256) {
      block(
        'VALIDATION_DIGEST_MISMATCH',
        'The completed validation digest does not match the expected checkpoint.'
      );
    }
    if (before.credit_ledger_sha256 !== expected.credit_ledger_sha256) {
      block(
        'CREDIT_LEDGER_DIGEST_MISMATCH',
        'The credit ledger digest does not match the expected checkpoint.'
      );
    }
    const ledgerField = String(expected.credit_ledger_value_field || '');
    const ledgerValue = Number(sourceJob.credit_usage?.[ledgerField]);
    if (
      !Number.isSafeInteger(ledgerValue) ||
      ledgerValue !== Number(expected.credit_ledger_value)
    ) {
      block(
        'CREDIT_LEDGER_VALUE_MISMATCH',
        'The named credit ledger value does not match the expected checkpoint.'
      );
    }

    let sourceCheckpoint = null;
    let observedSourceFingerprint = null;
    try {
      sourceCheckpoint = plannedRenderSourceCheckpoint(sourceJob, sourcePlan);
      observedSourceFingerprint = await fingerprintRegularFile(
        sourceCheckpoint.path
      );
      if (
        sourceCheckpoint.sha256 !== observedSourceFingerprint.sha256 ||
        sourceCheckpoint.bytes !== observedSourceFingerprint.bytes
      ) {
        block(
          'SOURCE_CHECKPOINT_CHANGED',
          'The render source bytes no longer match the canceled job checkpoint.'
        );
      }
      if (
        sourceCheckpoint.sha256 !== expected.source_checkpoint_sha256 ||
        sourceCheckpoint.bytes !== Number(expected.source_checkpoint_bytes)
      ) {
        block(
          'EXPECTED_SOURCE_CHECKPOINT_MISMATCH',
          'The render source checkpoint does not match the expected SHA-256 and byte count.'
        );
      }
    } catch (error) {
      block(
        'SOURCE_CHECKPOINT_UNAVAILABLE',
        error instanceof Error ? error.message : String(error)
      );
    }

    let recomputedValidation = null;
    let recomputedValidationSha256 = null;
    if (sourcePlan && sourceSession) {
      try {
        recomputedValidation = await this.runValidation(sourceJob.job_id);
        recomputedValidationSha256 =
          validationCheckpointSha256(recomputedValidation);
        if (
          recomputedValidation.passed !== true ||
          recomputedValidationSha256 !== before.validation_sha256
        ) {
          block(
            'VALIDATION_RECOMPUTATION_MISMATCH',
            'Current deterministic validation no longer reproduces the completed validation receipt.'
          );
        }
      } catch (error) {
        block(
          'VALIDATION_RECOMPUTATION_FAILED',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    let candidatePlan = null;
    let outputInspection = null;
    if (sourcePlan && sourceCheckpoint) {
      try {
        const candidate = buildRenderCheckpointForkPlan({
          sourcePlan,
          sourceJobId: sourceJob.job_id,
          sourceJobSha256: before.job_sha256,
          sourceCheckpoint,
          translationSessionSha256: before.session_sha256,
          validationSha256: before.validation_sha256,
          creditLedgerSha256: before.credit_ledger_sha256,
          renderOverride: args.render_override,
        });
        candidatePlan = stablePlanForEnvironment(
          candidate,
          this.environment,
          MCP_V2_SCHEMA_VERSION
        );
        const sourceHasRenderSpec = isObject(
          sourcePlan.outputs?.subtitle_render_spec
        );
        const sourceOutputInvariantSha256 = canonicalJsonHash(
          renderInvariantOutputSnapshot(sourcePlan.outputs, {
            omitSynthesizedRenderSpec: !sourceHasRenderSpec,
          })
        );
        const candidateOutputInvariantSha256 = canonicalJsonHash(
          renderInvariantOutputSnapshot(candidatePlan.outputs, {
            omitSynthesizedRenderSpec: !sourceHasRenderSpec,
          })
        );
        if (sourceOutputInvariantSha256 !== candidateOutputInvariantSha256) {
          block(
            'NON_RENDER_OUTPUT_DRIFT',
            'The candidate fork changed an output field outside the subtitle style/font override.'
          );
        }
        const stageIds = candidatePlan.stages.map(stage => stage.id);
        if (
          canonicalJson(stageIds) !==
            canonicalJson(
              RENDER_CHECKPOINT_FORK_STAGES.map(stage => stage.id)
            ) ||
          stageIds.some(stageId =>
            [
              'load_transcript',
              'transcription',
              'translation_external',
              'translation_app',
              'translation_validation',
              'summary',
              'dubbing',
            ].includes(stageId)
          ) ||
          Number(candidatePlan.credit_usage?.total_stage5_credits) !== 0
        ) {
          block(
            'UNSAFE_FORK_STAGE_GRAPH',
            'The candidate fork contains a disallowed or credit-bearing stage.'
          );
        }
        outputInspection = await inspectRenderCheckpointForkOutputs(
          candidatePlan,
          sourceCheckpoint.path
        );
        if (outputInspection.overwrite) {
          block(
            'OUTPUT_OVERWRITE_ENABLED',
            'Render recovery never inherits overwrite=true.'
          );
        }
        if (outputInspection.existing_files.length > 0) {
          block(
            'PLANNED_OUTPUT_EXISTS',
            'One or more non-preview recovery outputs already exist.'
          );
        }
        if (outputInspection.input_overlaps.length > 0) {
          block(
            'OUTPUT_OVERLAPS_INPUT',
            'A planned recovery output overlaps an immutable workflow input.'
          );
        }
        if (outputInspection.available_bytes === null) {
          block(
            'OUTPUT_CAPACITY_UNVERIFIED',
            'The output filesystem did not expose available capacity.'
          );
        } else if (
          outputInspection.required_bytes !== null &&
          outputInspection.available_bytes < outputInspection.required_bytes
        ) {
          block(
            'INSUFFICIENT_OUTPUT_DISK_SPACE',
            'The output filesystem lacks the planned recovery working space.'
          );
        }
      } catch (error) {
        block(
          'CANDIDATE_FORK_INVALID',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    const after = renderRecoveryStateSnapshot(this.store, args.source_job_id);
    const targetStateUnchanged =
      after.job_sha256 === before.job_sha256 &&
      after.plan_sha256 === before.plan_sha256 &&
      after.session_sha256 === before.session_sha256 &&
      after.session_row_sha256 === before.session_row_sha256 &&
      after.validation_sha256 === before.validation_sha256 &&
      after.credit_ledger_sha256 === before.credit_ledger_sha256;
    const writes = after.total_changes - before.total_changes;
    if (!targetStateUnchanged || writes !== 0) {
      block(
        'STORE_CHANGED_DURING_PREFLIGHT',
        'Persistent state changed while the read-only recovery preflight was running.'
      );
    }

    const previousRenderSpec = clone(
      sourcePlan?.outputs?.subtitle_render_spec || null
    );
    const resolvedRenderSpec = clone(
      candidatePlan?.outputs?.subtitle_render_spec || null
    );
    const receipt = {
      schema_version: RENDER_CHECKPOINT_FORK_VERSION,
      eligible: blockers.length === 0,
      blockers,
      source_job: {
        job_id: sourceJob.job_id,
        status: sourceJob.status,
        job_sha256: before.job_sha256,
        plan_sha256: before.plan_sha256,
        render_stage_attempts: Number(renderStage?.attempts || 0),
      },
      source_checkpoint: sourceCheckpoint
        ? {
            source_key: sourceKey,
            sha256: sourceCheckpoint.sha256,
            bytes: sourceCheckpoint.bytes,
            observed_sha256: observedSourceFingerprint?.sha256 || null,
            observed_bytes: observedSourceFingerprint?.bytes ?? null,
            matches: Boolean(
              observedSourceFingerprint &&
              observedSourceFingerprint.sha256 === sourceCheckpoint.sha256 &&
              observedSourceFingerprint.bytes === sourceCheckpoint.bytes
            ),
          }
        : null,
      translations: {
        ...acceptance,
        target_language: sourceSession?.target_language || null,
        session_sha256: before.session_sha256,
        preserved_by_reference: true,
      },
      validation: {
        passed: sourceJob.validation?.passed === true,
        checkpoint_sha256: before.validation_sha256,
        recomputed_sha256: recomputedValidationSha256,
        recomputed_matches:
          recomputedValidationSha256 === before.validation_sha256,
      },
      credits: {
        source_ledger_sha256: before.credit_ledger_sha256,
        source_ledger: clone(sourceJob.credit_usage || {}),
        expected_value_field: ledgerField,
        expected_value: Number(expected.credit_ledger_value),
        observed_value: Number.isFinite(ledgerValue) ? ledgerValue : null,
        projected_delta: {
          estimated: 0,
          authorized: 0,
          reserved: 0,
          charged: 0,
        },
        paid_stage_decisions: {
          transcription: 'skip_exact_checkpoint',
          translation: 'skip_exact_checkpoint',
        },
        projected_ledger_sha256: before.credit_ledger_sha256,
      },
      render: {
        previous_spec: previousRenderSpec,
        resolved_spec: resolvedRenderSpec,
        requested_override: clone(args.render_override),
        display_mode_preserved:
          previousRenderSpec?.display_mode === resolvedRenderSpec?.display_mode,
        output_invariants_sha256: candidatePlan
          ? canonicalJsonHash(
              renderInvariantOutputSnapshot(candidatePlan.outputs)
            )
          : null,
      },
      output_preflight: outputInspection,
      candidate: candidatePlan
        ? {
            plan_hash: candidatePlan.plan_hash,
            stages: candidatePlan.stages.map(stage => stage.id),
            persisted: false,
            job_id_allocated: false,
            render_authorized: false,
          }
        : null,
      mutation_proof: {
        store_total_changes_before: before.total_changes,
        store_total_changes_after: after.total_changes,
        writes,
        target_job_revision_before: sourceJob.revision,
        target_job_revision_after: after.job.revision,
        target_job_sha256_before: before.job_sha256,
        target_job_sha256_after: after.job_sha256,
        translation_session_sha256_before: before.session_sha256,
        translation_session_sha256_after: after.session_sha256,
        credit_ledger_sha256_before: before.credit_ledger_sha256,
        credit_ledger_sha256_after: after.credit_ledger_sha256,
        app_mutations: 0,
        provider_calls: 0,
        ids_allocated: 0,
      },
    };
    receipt.preflight_digest = renderCheckpointForkPreflightDigest(receipt);
    return { receipt, candidatePlan, sourceCheckpoint };
  }

  async preflightRenderCheckpointFork(args) {
    const { receipt } = await this.evaluateRenderCheckpointFork(args);
    return receipt;
  }

  async createRenderCheckpointFork(args) {
    const preflightArgs = {
      source_job_id: args.source_job_id,
      expected: args.expected,
      render_override: args.render_override,
    };
    const { receipt, candidatePlan, sourceCheckpoint } =
      await this.evaluateRenderCheckpointFork(preflightArgs);
    if (!receipt.eligible || !candidatePlan || !sourceCheckpoint) {
      const error = new Error(
        'The render-checkpoint fork preflight is not eligible; no fork was created.'
      );
      error.code = 'RENDER_CHECKPOINT_FORK_INELIGIBLE';
      error.details = { blockers: receipt.blockers };
      throw error;
    }
    if (receipt.preflight_digest !== args.preflight_digest) {
      const error = new Error(
        'The render-checkpoint fork preflight digest is stale or does not match this request.'
      );
      error.code = 'RENDER_CHECKPOINT_PREFLIGHT_MISMATCH';
      error.details = {
        expected_preflight_digest: receipt.preflight_digest,
      };
      throw error;
    }
    const created = this.store.createRenderCheckpointFork({
      sourceJobId: args.source_job_id,
      sourceJobSha256: receipt.source_job.job_sha256,
      translationSessionSha256: receipt.translations.session_sha256,
      validationSha256: receipt.validation.checkpoint_sha256,
      creditLedgerSha256: receipt.credits.source_ledger_sha256,
      preflightDigest: receipt.preflight_digest,
      idempotencyKey: args.idempotency_key,
      request: {
        ...preflightArgs,
        preflight_digest: receipt.preflight_digest,
      },
      plan: candidatePlan,
      sourceCheckpoint,
    });
    const persistedSource = this.store.requireJob(args.source_job_id);
    const persistedSession = this.store.getTranslationSession(
      created.job.job_id
    );
    const persistedPlan = this.store.getPlan(created.job.plan_hash);
    if (
      persistentJobCheckpointSha256(persistedSource) !==
        receipt.source_job.job_sha256 ||
      translationSessionCheckpointSha256(persistedSession) !==
        receipt.translations.session_sha256 ||
      created.job.status !== 'blocked' ||
      created.job.stage !== 'render_outputs' ||
      created.job.render_authorized !== false ||
      Number(created.job.credit_usage?.consumed_stage5_credits) !== 0 ||
      canonicalJson(persistedPlan?.stages?.map(stage => stage.id)) !==
        canonicalJson(RENDER_CHECKPOINT_FORK_STAGES.map(stage => stage.id))
    ) {
      throw new Error(
        'The persisted render-checkpoint fork failed its post-commit invariant check.'
      );
    }
    this.notify(created.job.job_id);
    return {
      reused: created.reused,
      job: created.job,
      plan: created.plan,
      preflight_digest: receipt.preflight_digest,
      render_started: false,
      stage5_credits_consumed: 0,
    };
  }

  async createJob({
    plan_hash: planHash,
    idempotency_key: idempotencyKey,
    credit_authorization: creditAuthorization,
  }) {
    const plan = this.store.getPlan(planHash);
    if (!plan) throw new Error(`Unknown plan_hash: ${planHash}`);
    const storedRequest = this.store.getPlanRequest(planHash);
    if (this.store.getJobByIdempotencyKey(idempotencyKey)) {
      const existing = this.store.createJob({
        planHash,
        idempotencyKey,
        request: storedRequest,
        creditAuthorization: creditAuthorization || null,
      });
      return {
        reused: true,
        job: await this.reconcileJob(existing.job.job_id),
      };
    }
    const blocking = (plan.compatibility || []).filter(
      item => item.severity === 'blocking'
    );
    if (blocking.length) {
      throw new Error(
        `Plan has blocking compatibility findings: ${blocking.map(item => item.message).join(' ')}`
      );
    }
    const estimated = Number(plan.credit_usage?.total_stage5_credits || 0);
    if (
      plan.source?.kind === 'local_file' ||
      plan.source?.kind === 'library_item' ||
      plan.source?.kind === 'url' ||
      plan.source?.kind === 'transcript' ||
      plan.source?.kind === 'mock'
    ) {
      const currentProbe = await this.probeSource(
        plan.source.kind === 'local_file'
          ? { path: plan.source.path }
          : plan.source.kind === 'library_item'
            ? { history_id: plan.source.history_id }
            : plan.source.kind === 'url'
              ? { url: plan.source.url }
              : plan.source.kind === 'transcript'
                ? { transcript_path: plan.source.transcript_path }
                : { mock: true }
      );
      if (currentProbe.source?.source_key !== plan.source.source_key) {
        throw new Error(
          'The source changed after planning. Run plan_job again.'
        );
      }
      if (
        plan.source.kind === 'url' &&
        Math.abs(
          Number(currentProbe.metadata?.duration_seconds || 0) -
            Number(plan.source_metadata?.duration_seconds || 0)
        ) > 1
      ) {
        throw new Error(
          'The source duration changed after planning. Run plan_job again before authorizing work.'
        );
      }
      if (
        plan.source.kind === 'library_item' &&
        plan.transcription?.method === 'imported_transcript' &&
        currentProbe.metadata?.subtitle_source_sha256 !==
          plan.transcription?.subtitle_source_sha256
      ) {
        throw new Error(
          'The library subtitles changed after planning. Run plan_job again.'
        );
      }
    }
    if (plan.transcription?.imported_transcript?.path) {
      const imported = await readBoundedSrtTranscript(
        plan.transcription.imported_transcript.path
      );
      const currentImportedKey = `transcript:sha256:${createHash('sha256').update(imported.text).digest('hex')}`;
      if (
        currentImportedKey !== plan.transcription.imported_transcript.source_key
      ) {
        throw new Error(
          'The imported transcript changed after planning. Run plan_job again.'
        );
      }
    }
    const context = await this.appContext();
    if (!context.connected) {
      throw new Error(
        'Translator must be connected when a job starts so provider and credit state can be revalidated.'
      );
    }
    const appBindingProtocol = appSourceBindingProtocolVersion(context);
    if (appBindingProtocol !== SOURCE_BINDING_PROTOCOL_VERSION) {
      const error = new Error(
        'The connected Translator app does not support the required planned-source binding protocol. Install and restart the updated packaged app before creating a new job.'
      );
      error.code = 'APP_SOURCE_BINDING_PROTOCOL_REQUIRED';
      error.details = {
        required_protocol_version: SOURCE_BINDING_PROTOCOL_VERSION,
        observed_protocol_version: appBindingProtocol,
        suggested_action: 'install and restart the updated Translator package',
      };
      throw error;
    }
    const providerChecks = [
      [['stage5', 'byo'].includes(plan.transcription?.method), 'transcription'],
      [['stage5', 'byo'].includes(plan.translation?.provider), 'translation'],
      [plan.options?.include_summary === true, 'summary'],
      [plan.options?.include_dubbing === true, 'dubbing'],
    ];
    for (const [required, providerName] of providerChecks) {
      if (!required) continue;
      const plannedRoute = providerRouteKey(
        plan.provider_snapshot?.[providerName]
      );
      const currentDescriptor =
        providerName === 'summary' &&
        plan.options?.summary_effort_level === 'high'
          ? context.providers?.summary_high
          : context.providers?.[providerName];
      const currentRoute = providerRouteKey(currentDescriptor);
      if (plannedRoute !== currentRoute) {
        throw new Error(
          `The active ${providerName} provider changed after planning (${plannedRoute} → ${currentRoute}). Run plan_job again before authorizing work.`
        );
      }
    }
    if (estimated > 0) {
      if (
        creditAuthorization?.confirm !== 'AUTHORIZE_STAGE5_CREDITS' ||
        Number(creditAuthorization?.max_stage5_credits) < estimated
      ) {
        throw new Error(
          `This plan estimates ${estimated} Stage5 credits. Explicitly authorize at least that amount.`
        );
      }
      const balance = Number(context.stage5?.credits?.balance);
      if (
        !Number.isFinite(balance) ||
        context.stage5?.credits?.authoritative !== true
      ) {
        throw new Error(
          'An authoritative current Stage5 credit balance is required before paid work can start.'
        );
      }
      if (balance < estimated) {
        throw new Error(
          `The current Stage5 balance is ${balance}, below this plan's ${estimated}-credit estimate.`
        );
      }
    }
    const created = this.store.createJob({
      planHash,
      idempotencyKey,
      request: storedRequest,
      creditAuthorization: creditAuthorization || null,
    });
    if (!created.reused) {
      this.store.recordSource(created.job.job_id, plan.source.source_key, {
        plan_hash: planHash,
        status: created.job.status,
      });
    }
    const job = await this.advanceJob(created.job.job_id);
    return { reused: created.reused, job };
  }

  stageRuntimeRequirement(plan, stage) {
    if (
      stage?.id === 'transcription' &&
      ['stage5', 'byo'].includes(plan.transcription?.method)
    ) {
      return {
        provider_name: 'transcription',
        planned_descriptor: plan.provider_snapshot?.transcription,
        estimated_stage5_credits: Number(plan.credit_usage?.transcription || 0),
        planning_expectations: {
          ...(Object.hasOwn(
            plan.planning_snapshot || {},
            'quality_transcription'
          )
            ? {
                quality_transcription:
                  plan.planning_snapshot.quality_transcription === true,
              }
            : {}),
          ...(plan.transcription?.method === 'stage5'
            ? {
                transcription_per_hour:
                  plan.planning_snapshot?.credit_rates?.transcription_per_hour,
              }
            : {}),
        },
      };
    }
    if (
      stage?.id === 'translation_app' &&
      ['stage5', 'byo'].includes(plan.translation?.provider)
    ) {
      return {
        provider_name: 'translation',
        planned_descriptor: plan.provider_snapshot?.translation,
        estimated_stage5_credits: Number(plan.credit_usage?.translation || 0),
        planning_expectations: {
          ...(Object.hasOwn(plan.planning_snapshot || {}, 'quality_translation')
            ? {
                quality_translation:
                  plan.planning_snapshot.quality_translation === true,
              }
            : {}),
          ...(plan.translation?.provider === 'stage5'
            ? {
                [plan.planning_snapshot?.quality_translation
                  ? 'translation_quality_per_hour'
                  : 'translation_standard_per_hour']:
                  plan.planning_snapshot?.credit_rates?.[
                    plan.planning_snapshot?.quality_translation
                      ? 'translation_quality_per_hour'
                      : 'translation_standard_per_hour'
                  ],
              }
            : {}),
        },
      };
    }
    if (stage?.id === 'summary') {
      return {
        provider_name: 'summary',
        provider_slot:
          plan.options?.summary_effort_level === 'high'
            ? 'summary_high'
            : 'summary',
        planned_descriptor: plan.provider_snapshot?.summary,
        estimated_stage5_credits: Number(plan.credit_usage?.summary || 0),
        planning_expectations:
          Number(plan.credit_usage?.summary || 0) > 0
            ? {
                [plan.options?.summary_effort_level === 'high'
                  ? 'summary_high_per_hour'
                  : 'summary_standard_per_hour']:
                  plan.planning_snapshot?.credit_rates?.[
                    plan.options?.summary_effort_level === 'high'
                      ? 'summary_high_per_hour'
                      : 'summary_standard_per_hour'
                  ],
              }
            : {},
      };
    }
    if (stage?.id === 'dubbing') {
      return {
        provider_name: 'dubbing',
        planned_descriptor: plan.provider_snapshot?.dubbing,
        estimated_stage5_credits: Number(plan.credit_usage?.dubbing || 0),
        planning_expectations:
          Number(plan.credit_usage?.dubbing || 0) > 0
            ? {
                [/eleven/i.test(
                  `${plan.provider_snapshot?.dubbing?.provider || ''}:${plan.provider_snapshot?.dubbing?.model || ''}`
                )
                  ? 'dubbing_elevenlabs_per_minute'
                  : 'dubbing_openai_per_minute']:
                  plan.planning_snapshot?.credit_rates?.[
                    /eleven/i.test(
                      `${plan.provider_snapshot?.dubbing?.provider || ''}:${plan.provider_snapshot?.dubbing?.model || ''}`
                    )
                      ? 'dubbing_elevenlabs_per_minute'
                      : 'dubbing_openai_per_minute'
                  ],
              }
            : {},
      };
    }
    return null;
  }

  async validateStageRuntime(job, stage, plan) {
    const requirement = this.stageRuntimeRequirement(plan, stage);
    if (!requirement) return null;
    const context = await this.appContext();
    if (!context.connected) {
      const error = new Error(
        `Translator disconnected before ${stage.label} could revalidate its provider and credit state.`
      );
      error.code = 'APP_NOT_CONNECTED';
      throw error;
    }
    const providerSlot = requirement.provider_slot || requirement.provider_name;
    const currentDescriptor = context.providers?.[providerSlot];
    const plannedRoute = providerRouteKey(requirement.planned_descriptor);
    const currentRoute = providerRouteKey(currentDescriptor);
    if (plannedRoute !== currentRoute) {
      const error = new Error(
        `The active ${requirement.provider_name} provider changed after planning (${plannedRoute} → ${currentRoute}). Create a new plan or restore the planned provider before retrying.`
      );
      error.code = 'PROVIDER_ROUTE_CHANGED';
      error.suggestedAction = 'plan_job';
      throw error;
    }
    for (const [name, expectedValue] of Object.entries(
      requirement.planning_expectations || {}
    )) {
      if (expectedValue === undefined) continue;
      const currentValue = name.startsWith('quality_')
        ? context.planning?.[name] === true
        : Number(
            context.planning?.credit_rates?.[name] ?? DEFAULT_CREDIT_RATES[name]
          );
      if (currentValue !== expectedValue) {
        const error = new Error(
          `The ${name} planning assumption changed after planning (${String(expectedValue)} → ${String(currentValue)}). Create a new plan before retrying.`
        );
        error.code = 'PLANNING_ASSUMPTION_CHANGED';
        error.suggestedAction = 'plan_job';
        throw error;
      }
    }
    const estimatedStageCredits = Math.max(
      0,
      requirement.estimated_stage5_credits
    );
    if (estimatedStageCredits > 0) {
      const authorized = Number(
        job.credit_usage?.authorized_stage5_credits || 0
      );
      const plannedTotal = Number(plan.credit_usage?.total_stage5_credits || 0);
      if (!Number.isFinite(authorized) || authorized < plannedTotal) {
        const error = new Error(
          'The persisted Stage5 credit authorization no longer covers this job plan.'
        );
        error.code = 'CREDIT_AUTHORIZATION_INVALID';
        error.suggestedAction = 'create_job';
        throw error;
      }
      const balance = Number(context.stage5?.credits?.balance);
      if (
        !Number.isFinite(balance) ||
        context.stage5?.credits?.authoritative !== true
      ) {
        const error = new Error(
          `An authoritative current Stage5 credit balance is required immediately before ${stage.label}.`
        );
        error.code = 'CREDIT_BALANCE_NOT_AUTHORITATIVE';
        throw error;
      }
      if (balance < estimatedStageCredits) {
        const error = new Error(
          `The current Stage5 balance is ${balance}, below the ${estimatedStageCredits}-credit estimate for ${stage.label}.`
        );
        error.code = 'INSUFFICIENT_STAGE5_CREDITS';
        throw error;
      }
    }
    return {
      provider_name: requirement.provider_name,
      provider_slot: providerSlot,
      expected_route: plannedRoute,
      minimum_stage5_credits: estimatedStageCredits,
      planning_expectations: clone(requirement.planning_expectations || {}),
    };
  }

  async requireCurrentPlannedVideo(job, plan, options = {}) {
    const selectedPath = plannedVideoPath(job, plan, options);
    if (!selectedPath) {
      const error = new Error(
        'The planned workflow has no durable source video for this stage.'
      );
      error.code = 'PLANNED_VIDEO_UNAVAILABLE';
      error.suggestedAction = 'plan_job';
      throw error;
    }
    const resolved = path.resolve(selectedPath);
    const resolvedIdentity = normalizedPathIdentity(resolved);
    const artifact = (job.artifacts || []).find(
      candidate =>
        normalizedPathIdentity(String(candidate?.path || '')) ===
        resolvedIdentity
    );
    const plannedSourcePath = String(plan.source?.path || '').trim();
    const isPlannedSource =
      plannedSourcePath &&
      normalizedPathIdentity(plannedSourcePath) === resolvedIdentity;
    const expectedSha256 = String(
      artifact?.checkpoint_sha256 ||
        artifact?.sha256 ||
        (isPlannedSource ? plan.source?.sha256 : '') ||
        ''
    );
    const expectedBytes = Number(
      artifact?.checkpoint_bytes ??
        artifact?.bytes ??
        (isPlannedSource ? plan.source?.bytes : NaN)
    );
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
      const error = new Error(
        `The selected video has no durable integrity checkpoint: ${resolved}. Create a new job so the producing stage can bind its exact bytes.`
      );
      error.code = 'VIDEO_INTEGRITY_CHECKPOINT_MISSING';
      error.suggestedAction = 'plan_job';
      throw error;
    }
    const current = await fingerprintRegularFile(resolved);
    if (
      current.sha256 !== expectedSha256 ||
      (Number.isFinite(expectedBytes) && current.bytes !== expectedBytes)
    ) {
      const error = new Error(
        `The planned video changed after its integrity checkpoint: ${resolved}. Do not consume or render it; create a new plan or rerun the producing stage.`
      );
      error.code = 'VIDEO_INTEGRITY_CHANGED';
      error.suggestedAction = isPlannedSource ? 'plan_job' : 'retry_stage';
      throw error;
    }
    return current.path;
  }

  async fingerprintStageArtifacts(result) {
    const fingerprints = [];
    for (const artifactPath of collectArtifactPaths(result)) {
      try {
        fingerprints.push(await fingerprintRegularFile(artifactPath));
      } catch (error) {
        const wrapped = new Error(
          `A completed app stage returned an artifact that could not be integrity-bound: ${artifactPath}. ${error instanceof Error ? error.message : String(error)}`
        );
        wrapped.code = 'STAGE_ARTIFACT_INTEGRITY_FAILED';
        wrapped.suggestedAction = 'retry_stage';
        throw wrapped;
      }
    }
    return fingerprints;
  }

  async fingerprintAvailableStageArtifacts(result) {
    const fingerprints = [];
    if (!isObject(result)) return fingerprints;
    for (const artifactPath of collectArtifactPaths(result)) {
      try {
        fingerprints.push(await fingerprintRegularFile(artifactPath));
      } catch {
        // A failed compound stage may mention both completed and incomplete
        // children. Preserve every file that can still be integrity-bound
        // without replacing the stage's real failure with a secondary error.
      }
    }
    return fingerprints;
  }

  recordFingerprintedStageArtifacts(
    job,
    stage,
    result,
    artifactFingerprints,
    { partial = false } = {}
  ) {
    const capturedAt = this.now().toISOString();
    const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
    for (const fingerprint of artifactFingerprints) {
      const identity = normalizedPathIdentity(fingerprint.path);
      let artifact = job.artifacts.find(
        candidate => normalizedPathIdentity(candidate.path) === identity
      );
      if (!artifact) {
        artifact = {
          path: fingerprint.path,
          stage: stage.id,
          verified: false,
        };
        job.artifacts.push(artifact);
      }
      artifact.path = fingerprint.path;
      artifact.stage = stage.id;
      artifact.verified = false;
      delete artifact.verification;
      delete artifact.verified_sha256;
      artifact.checkpoint_sha256 = fingerprint.sha256;
      artifact.checkpoint_bytes = fingerprint.bytes;
      artifact.checkpoint_captured_at = capturedAt;
      if (partial) artifact.partial = true;
      else delete artifact.partial;

      if (stage.id !== 'render_outputs') continue;
      const output = outputs.find(
        candidate =>
          candidate?.path && normalizedPathIdentity(candidate.path) === identity
      );
      if (!output) continue;
      artifact.kind = 'video';
      artifact.preset = output.preset || null;
      artifact.media = clone(output.metadata || null);
    }
  }

  notify(jobId) {
    this.events.emit(jobId);
  }

  mutateJob(jobId, mutate, options) {
    const job = this.store.mutateJob(jobId, mutate, options);
    if (options?.eventType !== 'stage_progress' && job.source?.source_key) {
      try {
        this.store.recordSource(job.job_id, job.source.source_key, {
          plan_hash: job.plan_hash,
          status: job.status,
          stage: job.stage,
          finished_at: job.finished_at || null,
        });
      } catch {
        // The state transition is already committed. A secondary source-index
        // update must never relabel the newly active stage as failed or replay
        // a completed paid operation.
      }
    }
    this.notify(jobId);
    return job;
  }

  isCurrentStage(jobId, expectedStage) {
    const job = this.store.requireJob(jobId);
    const current = job.stages[job.stage_index];
    const expected = stageFence(expectedStage);
    return Boolean(
      current &&
      expected &&
      current.id === expected.id &&
      current.operation_id === expected.operation_id &&
      Number(current.attempts || 0) === expected.attempts &&
      current.status === expected.status
    );
  }

  isStageStartAllowed(jobId, expectedStage) {
    const job = this.store.requireJob(jobId);
    const current = job.stages[job.stage_index];
    const expected = stageFence(expectedStage);
    return Boolean(
      current &&
      expected &&
      current.id === expected.id &&
      current.operation_id === expected.operation_id &&
      Number(current.attempts || 0) === expected.attempts &&
      expected.status === 'starting' &&
      current.status === 'starting' &&
      job.status === 'starting' &&
      job.cancel_requested !== true &&
      job.pause_requested !== true
    );
  }

  settleSuppressedStageStart(jobId, expectedStage) {
    return this.mutateJob(
      jobId,
      job => {
        const stage = job.stages[job.stage_index];
        if (job.cancel_requested) {
          stage.status = 'cancelled';
          stage.finished_at = this.now().toISOString();
          job.status = 'cancelled';
          job.stage = 'cancelled';
          job.human_status = 'Cancelled before operation start';
          job.error = null;
        } else if (job.pause_requested) {
          stage.status = 'interrupted';
          job.status = 'paused';
          job.human_status = `Paused before ${stage.label} started`;
          job.recoverability = {
            recoverable: true,
            status: 'paused',
            resume_from_stage: stage.id,
          };
        }
        return job;
      },
      {
        eventType: job =>
          job.status === 'cancelled'
            ? 'job_cancelled'
            : job.status === 'paused'
              ? 'job_paused_before_start'
              : 'stage_start_suppressed',
        expectedStage: stageFence(expectedStage),
      }
    );
  }

  async advanceJob(jobId) {
    for (let guard = 0; guard < 20; guard += 1) {
      let job = this.store.requireJob(jobId);
      if (
        TERMINAL.has(job.status) ||
        ['paused', 'cancel_requested', 'blocked'].includes(job.status)
      ) {
        return job;
      }
      const stage = job.stages[job.stage_index];
      if (!stage) return job;
      if (stage.status === 'running' || stage.status === 'waiting_for_agent')
        return job;
      const claimOwner = await this.ensureOwnerLease();
      const claimed = this.store.claimCurrentStage(
        jobId,
        operationId(job, stage),
        claimOwner
      );
      if (!claimed.claimed) return claimed.job;
      this.notify(jobId);
      job = claimed.job;
      const claimedStage = job.stages[job.stage_index];
      this.activeStageClaims.set(jobId, {
        stage_id: claimedStage.id,
        operation_id: claimedStage.operation_id,
        attempts: Number(claimedStage.attempts || 0),
      });
      let outcome;
      try {
        outcome = await this.startClaimedStage(job, claimedStage);
      } finally {
        const activeClaim = this.activeStageClaims.get(jobId);
        if (
          activeClaim?.stage_id === claimedStage.id &&
          activeClaim?.operation_id === claimedStage.operation_id &&
          activeClaim?.attempts === Number(claimedStage.attempts || 0)
        ) {
          this.activeStageClaims.delete(jobId);
        }
      }
      if (
        outcome === 'async' ||
        outcome === 'waiting' ||
        outcome === 'blocked'
      ) {
        return this.store.requireJob(jobId);
      }
    }
    throw new Error(
      'Job stage machine exceeded its deterministic transition bound.'
    );
  }

  prepareForShutdown(reason = 'mcp_transport_closed') {
    this.shutdownReason ||= reason;
    for (const [jobId, claim] of this.activeStageClaims) {
      let job;
      try {
        job = this.store.requireJob(jobId);
      } catch {
        continue;
      }
      const stage = job.stages[job.stage_index];
      if (
        stage?.status !== 'starting' ||
        stage.id !== claim.stage_id ||
        stage.operation_id !== claim.operation_id ||
        Number(stage.attempts || 0) !== claim.attempts
      ) {
        continue;
      }
      if (ACTIVE_APP_STAGE_IDS.has(stage.id)) {
        this.markStageDeliveryUnknown(
          jobId,
          new Error(
            `The MCP controller closed while ${stage.label} start delivery was pending (${reason}).`
          ),
          stage
        );
      } else {
        this.mutateJob(
          jobId,
          next => {
            const current = next.stages[next.stage_index];
            current.status = 'interrupted';
            current.error = null;
            next.status = 'queued';
            next.human_status = `Recovering ${current.label} after MCP controller shutdown`;
            next.recoverability = {
              recoverable: true,
              status: 'ready',
              resume_from_stage: current.id,
            };
            return next;
          },
          {
            eventType: 'stage_interrupted',
            eventData: { reason, automatic_restart: true },
            expectedStage: stageFence(stage),
          }
        );
      }
    }
    this.activeStageClaims.clear();
    for (const interrupt of [...this.pendingWatchInterrupts]) interrupt();
  }

  async close(reason = 'mcp_transport_closed') {
    this.prepareForShutdown(reason);
    await Promise.allSettled([
      ...this.pendingWatchCompletions,
      ...this.pendingExecutions,
    ]);
    await this.closeOwnerLease();
  }

  async startClaimedStage(job, stage) {
    const plan = this.store.getPlan(job.plan_hash);
    try {
      if (!plan) throw new Error(`Unknown plan_hash: ${job.plan_hash}`);
      const runtimeGuard = await this.validateStageRuntime(job, stage, plan);
      if (!this.isStageStartAllowed(job.job_id, stage)) {
        this.settleSuppressedStageStart(job.job_id, stage);
        return 'blocked';
      }
      if (stage.id === 'load_transcript') {
        await this.loadTranscriptStage(job, plan, stage);
        if (!this.isStageStartAllowed(job.job_id, stage)) {
          this.settleSuppressedStageStart(job.job_id, stage);
          return 'blocked';
        }
        this.completeStage(
          job.job_id,
          { source: 'existing_transcript' },
          stage
        );
        return 'complete';
      }
      if (stage.id === 'transcription') {
        const sourceVideoPath = ['local_file', 'library_item'].includes(
          plan.source.kind
        )
          ? await this.requireCurrentPlannedVideo(job, plan)
          : null;
        const params = {
          operationId: operationId(job, stage),
          quality: plan.options?.quality || '1080p',
          runTo: 'transcribe',
          replaceSubtitles: 'discard',
          ...(plan.source.kind === 'url' ? { url: plan.source.url } : {}),
          ...(plan.source.kind === 'local_file'
            ? { path: sourceVideoPath }
            : {}),
          ...(runtimeGuard ? { runtimeGuard } : {}),
        };
        return this.startAppStage(
          job,
          stage,
          plan.source.kind === 'library_item'
            ? 'startTranscription'
            : 'startMediaWorkflow',
          plan.source.kind === 'library_item'
            ? {
                historyId: plan.source.history_id,
                operationId: operationId(job, stage),
                sourceVideoPath,
                ...(runtimeGuard ? { runtimeGuard } : {}),
              }
            : params
        );
      }
      if (stage.id === 'download_source') {
        return this.startAppStage(job, stage, 'startMediaWorkflow', {
          operationId: operationId(job, stage),
          quality: plan.options?.quality || '1080p',
          runTo: 'download',
          replaceSubtitles: 'discard',
          url: plan.source.url,
        });
      }
      if (stage.id === 'translation_external') {
        await this.ensureTranslationSession(job, plan, stage);
        if (!this.isStageStartAllowed(job.job_id, stage)) {
          this.settleSuppressedStageStart(job.job_id, stage);
          return 'blocked';
        }
        this.mutateJob(
          job.job_id,
          next => {
            const current = next.stages[next.stage_index];
            current.status = 'waiting_for_agent';
            next.status = 'waiting_for_agent';
            next.human_status =
              'Waiting for external-agent translation batches';
            next.recoverability = {
              recoverable: true,
              status: 'waiting_for_translation',
              resume_from_stage: current.id,
            };
            return next;
          },
          {
            eventType: 'translation_ready',
            expectedStage: stageFence(stage),
          }
        );
        return 'waiting';
      }
      if (stage.id === 'translation_app') {
        await this.applySessionToApp(job, plan, stage);
        if (!this.isStageStartAllowed(job.job_id, stage)) {
          this.settleSuppressedStageStart(job.job_id, stage);
          return 'blocked';
        }
        return this.startAppStage(job, stage, 'startTranslation', {
          targetLanguage: plan.target_language,
          operationId: operationId(job, stage),
          ...(runtimeGuard ? { runtimeGuard } : {}),
        });
      }
      if (stage.id === 'translation_validation') {
        const validation = await this.runValidation(job.job_id);
        if (!this.isStageStartAllowed(job.job_id, stage)) {
          this.settleSuppressedStageStart(job.job_id, stage);
          return 'blocked';
        }
        if (!validation.passed) {
          const immutableTimingErrorCount = Object.entries(
            validation.error_code_counts || {}
          ).reduce(
            (total, [code, count]) =>
              total +
              (IMMUTABLE_TIMING_VALIDATION_CODES.has(code)
                ? Number(count) || 0
                : 0),
            0
          );
          if (immutableTimingErrorCount > 0) {
            this.blockStage(
              job.job_id,
              {
                code: 'IMMUTABLE_SUBTITLE_TIMING_INVALID',
                message: `${immutableTimingErrorCount} subtitle timing error(s) cannot be corrected through translation batches because timestamps are immutable. Create a new plan with a corrected transcript or rerun transcription intentionally.`,
                validation,
                suggested_action: 'plan_job',
              },
              stage
            );
            return 'blocked';
          }
          this.store.markTranslationSegmentsForCorrection(
            job.job_id,
            validation.issues
              .filter(issue => issue.severity === 'error')
              .map(issue => issue.segment_id)
          );
          this.blockStage(
            job.job_id,
            {
              code: 'TRANSLATION_VALIDATION_FAILED',
              message: `${validation.error_count} subtitle validation error(s) must be corrected.`,
              validation,
              suggested_action:
                'get_transcript_batch mode=review, submit_translation_batch, then retry_stage',
            },
            stage
          );
          return 'blocked';
        }
        this.store.clearTranslationCorrectionMarkers(job.job_id);
        this.completeStage(job.job_id, validation, stage);
        return 'complete';
      }
      if (stage.id === 'summary') {
        const summaryVideoPath = ['local_file', 'library_item'].includes(
          plan.source.kind
        )
          ? await this.requireCurrentPlannedVideo(job, plan)
          : job.artifacts.some(
                artifact =>
                  ['download_source', 'transcription'].includes(
                    artifact?.stage
                  ) && isVideoArtifact(artifact)
              )
            ? await this.requireCurrentPlannedVideo(job, plan)
            : null;
        await this.applySessionToApp(job, plan, stage, {
          videoPath: summaryVideoPath,
        });
        if (!this.isStageStartAllowed(job.job_id, stage)) {
          this.settleSuppressedStageStart(job.job_id, stage);
          return 'blocked';
        }
        return this.startAppStage(job, stage, 'startSummary', {
          operationId: operationId(job, stage),
          targetLanguage: plan.target_language,
          effortLevel: plan.options?.summary_effort_level || 'standard',
          includeHighlights: plan.options?.include_highlights === true,
          sourceVideoPath: summaryVideoPath,
          ...(runtimeGuard ? { runtimeGuard } : {}),
        });
      }
      if (stage.id === 'dubbing') {
        const dubbingVideoPath = await this.requireCurrentPlannedVideo(
          job,
          plan
        );
        await this.applySessionToApp(job, plan, stage, {
          videoPath: dubbingVideoPath,
        });
        if (!this.isStageStartAllowed(job.job_id, stage)) {
          this.settleSuppressedStageStart(job.job_id, stage);
          return 'blocked';
        }
        return this.startAppStage(job, stage, 'startDubbing', {
          operationId: operationId(job, stage),
          targetLanguage: plan.target_language,
          voice: plan.options?.voice,
          translateIfNeeded: false,
          sourceVideoPath: dubbingVideoPath,
          ...(runtimeGuard ? { runtimeGuard } : {}),
        });
      }
      if (stage.id === 'render_outputs') {
        const renderVideoPath = await this.requireCurrentPlannedVideo(
          job,
          plan,
          {
            preferDubbed: plan.options?.include_dubbing === true,
          }
        );
        await assertPlannedOutputIsolation(plan, [renderVideoPath]);
        const validation = await this.runValidation(job.job_id);
        if (job.render_authorized !== true) {
          this.blockStage(
            job.job_id,
            {
              code: 'RENDER_AUTHORIZATION_REQUIRED',
              message:
                'Translation validation passed. Inspect the validation result, optionally render preview frames, then explicitly call render_outputs to start the full encode.',
              validation,
              suggested_action: 'render_preview, then render_outputs',
            },
            stage
          );
          return 'blocked';
        }
        if (
          validation.warning_count &&
          job.render_warnings_authorized !== true
        ) {
          this.blockStage(
            job.job_id,
            {
              code: 'RENDER_WARNINGS_REQUIRE_ACKNOWLEDGEMENT',
              message: `Subtitle validation has ${validation.warning_count} warning(s). Inspect them, optionally render a preview, then call render_outputs with allow_warnings=true.`,
              validation,
              suggested_action: 'render_preview, then render_outputs',
            },
            stage
          );
          return 'blocked';
        }
        await this.applySessionToApp(job, plan, stage, {
          videoPath: renderVideoPath,
        });
        if (!this.isStageStartAllowed(job.job_id, stage)) {
          this.settleSuppressedStageStart(job.job_id, stage);
          return 'blocked';
        }
        return this.startAppStage(job, stage, 'startPresetRender', {
          operationId: operationId(job, stage),
          outputs: plan.outputs,
          source: plan.source,
          sourceVideoPath: renderVideoPath,
          protectedInputPaths: plannedInputPaths(plan, [renderVideoPath]),
        });
      }
      if (stage.id === 'verify_outputs') {
        const verification = await this.inspectJobArtifacts(job.job_id);
        this.recordOutputVerification(job.job_id, verification, stage);
        if (!verification.passed) {
          this.blockStage(
            job.job_id,
            {
              code: 'OUTPUT_VERIFICATION_FAILED',
              message:
                'One or more rendered outputs failed compatibility verification.',
              verification,
              suggested_action: 'retry_stage',
            },
            stage
          );
          return 'blocked';
        }
        this.completeStage(job.job_id, verification, stage);
        return 'complete';
      }
      if (stage.id === 'manifest') {
        if (job.manifest) {
          const manifest = await this.getJobManifest(job.job_id);
          if (!this.isStageStartAllowed(job.job_id, stage)) {
            this.settleSuppressedStageStart(job.job_id, stage);
            return 'blocked';
          }
          this.completeStage(
            job.job_id,
            {
              manifest_ready: true,
              manifest_path: manifest.manifest_path,
              reused_persisted_checkpoint: true,
            },
            stage
          );
          return 'complete';
        }
        let manifest = job.pending_manifest || null;
        if (!manifest) {
          manifest = await this.buildManifest(job.job_id, {
            write: false,
            projectManifestCompletion: true,
          });
          if (!this.isStageStartAllowed(job.job_id, stage)) {
            this.settleSuppressedStageStart(job.job_id, stage);
            return 'blocked';
          }
          this.mutateJob(
            job.job_id,
            next => {
              next.pending_manifest = manifest;
              return next;
            },
            {
              eventType: 'manifest_prepared',
              expectedStage: stageFence(stage),
            }
          );
        }
        if (!this.isStageStartAllowed(job.job_id, stage)) {
          this.settleSuppressedStageStart(job.job_id, stage);
          return 'blocked';
        }
        manifest = await this.writeManifest(job.job_id, manifest);
        this.mutateJob(
          job.job_id,
          next => {
            next.manifest = manifest;
            delete next.pending_manifest;
            return next;
          },
          {
            eventType: 'manifest_written',
            eventData: { path: manifest.manifest_path },
            expectedStage: stageFence(stage),
          }
        );
        this.completeStage(
          job.job_id,
          {
            manifest_ready: true,
            manifest_path: manifest.manifest_path,
          },
          stage
        );
        return 'complete';
      }
      throw new Error(`Unsupported job stage: ${stage.id}`);
    } catch (error) {
      this.failStage(job.job_id, error, stage);
      return 'blocked';
    }
  }

  async startAppStage(job, stage, method, params) {
    if (!this.isStageStartAllowed(job.job_id, stage)) {
      this.settleSuppressedStageStart(job.job_id, stage);
      return 'blocked';
    }
    try {
      const plan = this.store.getPlan(job.plan_hash);
      const rawResult = await this.callApp(method, {
        ...params,
        mcpJobId: job.job_id,
        sourceBinding: plannedAppSourceBinding(
          plan,
          appSourceBindingStateForStage(plan, stage)
        ),
      });
      const result = bindAppObservationToPlan(plan, rawResult);
      const updated = this.markStageRunning(job.job_id, result, stage);
      if (updated.cancel_requested) {
        const updatedStage = updated.stages[updated.stage_index];
        void this.callApp('cancelProcessing', {
          mcpJobId: job.job_id,
          operationId: operationId(updated, updatedStage),
          ...(usesLibraryHistoryStage(plan, updatedStage)
            ? { historyId: plan.source.history_id }
            : {}),
        }).catch(() => null);
      }
      return 'async';
    } catch (error) {
      if (!isDeliveryUnknownError(error)) throw error;
      this.markStageDeliveryUnknown(job.job_id, error, stage);
      return 'async';
    }
  }

  markStageDeliveryUnknown(jobId, error, expectedStage = null) {
    const currentJob = expectedStage ? null : this.store.requireJob(jobId);
    const expected = stageFence(
      expectedStage || currentJob.stages[currentJob.stage_index]
    );
    return this.mutateJob(
      jobId,
      job => {
        const stage = job.stages[job.stage_index];
        stage.status = 'running';
        stage.delivery_state = 'unknown';
        stage.error = {
          code: 'APP_DELIVERY_UNKNOWN',
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
          suggested_action: 'get_job',
        };
        job.status = job.cancel_requested
          ? 'cancel_requested'
          : job.pause_requested
            ? 'pause_requested'
            : 'running';
        job.human_status = job.cancel_requested
          ? `Cancelling ${stage.label}`
          : job.pause_requested
            ? `Pause requested; ${stage.label} will finish first`
            : `Reconciling ${stage.label}; the start acknowledgement was lost`;
        job.recoverability = {
          recoverable: true,
          status: 'delivery_unknown',
          resume_from_stage: stage.id,
        };
        return job;
      },
      {
        eventType: 'stage_delivery_unknown',
        eventData: { retry_suppressed: true },
        expectedStage: expected,
      }
    );
  }

  markStageRunning(jobId, appResult, expectedStage = null) {
    const currentJob = expectedStage ? null : this.store.requireJob(jobId);
    const expected = stageFence(
      expectedStage || currentJob.stages[currentJob.stage_index]
    );
    return this.mutateJob(
      jobId,
      job => {
        const stage = job.stages[job.stage_index];
        stage.status = 'running';
        stage.delivery_state = 'acknowledged';
        stage.result = clone(appResult || null);
        applyStageCreditUsage(job, stage, appResult);
        job.status = job.cancel_requested
          ? 'cancel_requested'
          : job.pause_requested
            ? 'pause_requested'
            : 'running';
        job.human_status = job.cancel_requested
          ? `Cancelling ${stage.label}`
          : job.pause_requested
            ? `Pause requested; ${stage.label} will finish first`
            : appResult?.stage || `Running ${stage.label}`;
        job.percent = stagePercent(job, Number(appResult?.percent || 0));
        return job;
      },
      {
        eventType: 'stage_started',
        eventData: { app: appResult || null },
        expectedStage: expected,
      }
    );
  }

  completeStage(
    jobId,
    result,
    expectedStage = null,
    artifactFingerprints = []
  ) {
    const currentJob = expectedStage ? null : this.store.requireJob(jobId);
    const expected = stageFence(
      expectedStage || currentJob.stages[currentJob.stage_index]
    );
    return this.mutateJob(
      jobId,
      job => {
        const stage = job.stages[job.stage_index];
        stage.status = 'completed';
        stage.percent = 100;
        stage.finished_at = this.now().toISOString();
        stage.result = clone(result || null);
        stage.error = null;
        if (stage.id === 'translation_validation') {
          job.validation = clone(result || null);
        }
        applyStageCreditUsage(job, stage, result);
        this.recordFingerprintedStageArtifacts(
          job,
          stage,
          result,
          artifactFingerprints
        );
        for (const artifactPath of collectArtifactPaths(result)) {
          const resolvedArtifactPath = path.resolve(artifactPath);
          if (
            !job.artifacts.some(
              artifact =>
                normalizedPathIdentity(artifact.path) ===
                normalizedPathIdentity(resolvedArtifactPath)
            )
          ) {
            job.artifacts.push({
              path: resolvedArtifactPath,
              stage: stage.id,
              verified: false,
            });
          }
        }
        job.stage_index += 1;
        const next = job.stages[job.stage_index];
        if (!next) {
          job.status = 'completed';
          job.stage = 'completed';
          job.percent = 100;
          job.human_status = 'Completed';
          job.recoverability = {
            recoverable: true,
            status: 'complete',
            resume_from_stage: null,
          };
        } else if (job.cancel_requested) {
          job.status = 'cancelled';
          job.stage = 'cancelled';
          job.human_status = 'Cancelled';
        } else if (job.pause_requested) {
          next.status = 'pending';
          job.status = 'paused';
          job.stage = next.id;
          job.human_status = `Paused before ${next.label}`;
          job.recoverability = {
            recoverable: true,
            status: 'paused',
            resume_from_stage: next.id,
          };
        } else {
          job.status = 'queued';
          job.stage = next.id;
          job.percent = stagePercent(job, 0);
          job.human_status = `Queued: ${next.label}`;
          job.recoverability = {
            recoverable: true,
            status: 'ready',
            resume_from_stage: next.id,
          };
        }
        return job;
      },
      {
        eventType: 'stage_completed',
        eventData: { result: result || null },
        expectedStage: expected,
      }
    );
  }

  failStage(
    jobId,
    error,
    expectedStage = null,
    observation = null,
    artifactFingerprints = []
  ) {
    const initial = this.store.requireJob(jobId);
    const expected = stageFence(
      expectedStage || initial.stages[initial.stage_index]
    );
    if (initial.cancel_requested) {
      return this.mutateJob(
        jobId,
        job => {
          const stage = job.stages[job.stage_index];
          applyStageCreditUsage(job, stage, observation);
          this.recordFingerprintedStageArtifacts(
            job,
            stage,
            observation?.result,
            artifactFingerprints,
            { partial: true }
          );
          stage.status = 'cancelled';
          stage.finished_at = this.now().toISOString();
          stage.result = clone(observation?.result || observation || null);
          stage.error = null;
          job.status = 'cancelled';
          job.stage = 'cancelled';
          job.human_status = 'Cancelled';
          job.error = null;
          return job;
        },
        { eventType: 'job_cancelled', expectedStage: expected }
      );
    }
    return this.mutateJob(
      jobId,
      job => {
        const stage = job.stages[job.stage_index];
        applyStageCreditUsage(job, stage, observation);
        this.recordFingerprintedStageArtifacts(
          job,
          stage,
          observation?.result,
          artifactFingerprints,
          { partial: true }
        );
        const consumed =
          extractStageCreditUsage(observation)?.stage5_credits_consumed;
        const details = stageError(
          error,
          stage.id,
          Number.isFinite(consumed) ? consumed : null
        );
        stage.status = 'failed';
        stage.error = details;
        stage.finished_at = this.now().toISOString();
        stage.result = clone(observation?.result || observation || null);
        job.status = 'failed';
        job.human_status = `Failed: ${stage.label}`;
        job.error = details;
        job.recoverability = {
          recoverable: true,
          status: 'failed',
          resume_from_stage: stage.id,
        };
        return job;
      },
      {
        eventType: 'stage_failed',
        eventData: stageError(
          error,
          expected?.id || initial.stage,
          extractStageCreditUsage(observation)?.stage5_credits_consumed ?? null
        ),
        expectedStage: expected,
      }
    );
  }

  blockStage(jobId, details, expectedStage = null) {
    const currentJob = expectedStage ? null : this.store.requireJob(jobId);
    const expected = stageFence(
      expectedStage || currentJob.stages[currentJob.stage_index]
    );
    return this.mutateJob(
      jobId,
      job => {
        const stage = job.stages[job.stage_index];
        stage.status = 'blocked';
        stage.error = clone(details);
        job.status = 'blocked';
        job.error = clone(details);
        job.human_status = details.message || `Blocked: ${stage.label}`;
        job.validation = details.validation || job.validation;
        job.recoverability = {
          recoverable: true,
          status: 'blocked',
          resume_from_stage: stage.id,
        };
        return job;
      },
      {
        eventType: 'stage_blocked',
        eventData: details,
        expectedStage: expected,
      }
    );
  }

  async recoverCompletedTranscription(job) {
    const stage = job?.stages?.[Number(job?.stage_index)];
    if (
      job?.status !== 'failed' ||
      stage?.id !== 'transcription' ||
      stage?.status !== 'failed' ||
      !/invalid timing for segment/i.test(String(stage?.error?.message || ''))
    ) {
      return null;
    }

    const plan = this.store.getPlan(job.plan_hash);
    let appStatus;
    try {
      const rawAppStatus = await this.callApp('processingStatus', {
        mcpJobId: job.job_id,
        operationId: operationId(job, stage),
        sourceBinding: plannedAppSourceBinding(
          plan,
          appSourceBindingStateForStage(plan, stage)
        ),
        ...(usesLibraryHistoryStage(plan, stage)
          ? { historyId: plan.source.history_id }
          : {}),
      });
      appStatus = bindAppObservationToPlan(plan, rawAppStatus);
    } catch {
      return null;
    }

    if (
      (appStatus?.id || appStatus?.operationId || null) !==
        operationId(job, stage) ||
      appResultStatus(appStatus) !== 'completed' ||
      appStatus?.source_binding?.state !== 'mounted'
    ) {
      return null;
    }

    let artifactFingerprints;
    try {
      artifactFingerprints = await this.captureCompletedAppStage(
        job,
        stage,
        appStatus
      );
    } catch {
      return null;
    }
    if (
      artifactFingerprints === null ||
      !isObject(appStatus?.result?.transcript_checkpoint)
    ) {
      return null;
    }

    const completionResult = appStatus.result || appStatus;
    const recovering = this.mutateJob(
      job.job_id,
      next => {
        const current = next.stages[next.stage_index];
        current.status = 'running';
        current.error = null;
        current.result = clone(completionResult);
        applyStageCreditUsage(next, current, completionResult);
        next.status = 'running';
        next.error = null;
        next.human_status = 'Recovering completed transcription locally';
        next.recoverability = {
          recoverable: true,
          status: 'local_recovery',
          resume_from_stage: current.id,
        };
        return next;
      },
      {
        eventType: 'stage_local_recovery_started',
        eventData: {
          stage: stage.id,
          operation_id: stage.operation_id,
          provider_retried: false,
          transcript_checkpoint: clone(appStatus.result.transcript_checkpoint),
        },
        expectedStage: stageFence(stage),
        allowFailedExpectedStage: true,
      }
    );
    const recoveringStage = recovering.stages[recovering.stage_index];
    this.completeStage(
      job.job_id,
      completionResult,
      recoveringStage,
      artifactFingerprints
    );
    return this.advanceJob(job.job_id);
  }

  async reconcileJob(jobId) {
    let job = this.store.requireJob(jobId);
    if (TERMINAL.has(job.status)) {
      const recovered = await this.recoverCompletedTranscription(job);
      return recovered || job;
    }
    let stage = job.stages[job.stage_index];
    if (!stage) return job;

    if (stage.status === 'starting') {
      const activeClaim = this.activeStageClaims.get(jobId);
      if (
        activeClaim?.stage_id === stage.id &&
        activeClaim?.operation_id === stage.operation_id &&
        activeClaim?.attempts === Number(stage.attempts || 0)
      ) {
        return job;
      }
      if (
        stage.claim_owner &&
        (await this.probeOwnerLease(stage.claim_owner))
      ) {
        return job;
      }
      if (ACTIVE_APP_STAGE_IDS.has(stage.id)) {
        this.markStageDeliveryUnknown(
          jobId,
          new Error(
            `The helper that claimed ${stage.label} did not persist its start acknowledgement.`
          ),
          stage
        );
        job = this.store.requireJob(jobId);
        stage = job.stages[job.stage_index];
      } else {
        this.blockStage(
          jobId,
          {
            code: 'LOCAL_STAGE_OWNERSHIP_UNKNOWN',
            message:
              'A helper stopped while this local checkpoint was starting. The stage generation is fenced against stale completion; after the earlier helper is gone, retry this exact stage.',
            suggested_action: 'retry_stage',
          },
          stage
        );
        return this.store.requireJob(jobId);
      }
    }

    if (
      stage.id === 'translation_external' &&
      stage.status === 'waiting_for_agent'
    ) {
      const session = this.store.getTranslationSession(jobId);
      if (session) {
        const summary = this.store.summarizeTranslationSession(session);
        if (summary.pending_segments === 0) {
          const plan = this.store.getPlan(job.plan_hash);
          await this.applySessionToApp(job, plan);
          this.completeStage(jobId, summary, stage);
          job = await this.advanceJob(jobId);
        }
      }
      return job;
    }

    if (!ACTIVE_APP_STAGE_IDS.has(stage.id) || stage.status !== 'running') {
      if (job.status === 'queued') return this.advanceJob(jobId);
      return job;
    }

    const plan = this.store.getPlan(job.plan_hash);
    let appStatus;
    try {
      const rawAppStatus = await this.callApp('processingStatus', {
        mcpJobId: jobId,
        operationId: operationId(job, stage),
        sourceBinding: plannedAppSourceBinding(
          plan,
          appSourceBindingStateForStage(plan, stage)
        ),
        ...(usesLibraryHistoryStage(plan, stage)
          ? { historyId: plan.source.history_id }
          : {}),
      });
      appStatus = bindAppObservationToPlan(plan, rawAppStatus);
    } catch {
      return job;
    }
    const expectedOperation = operationId(job, stage);
    const observedOperation = appStatus?.id || appStatus?.operationId || null;
    const expectedOperationObserved = observedOperation === expectedOperation;
    const status = appResultStatus(appStatus);
    if (
      observedOperation &&
      observedOperation !== expectedOperation &&
      status === 'running'
    ) {
      this.blockStage(
        jobId,
        {
          code: 'APP_BUSY_WITH_ANOTHER_OPERATION',
          message:
            'Translator is running a different operation; this job was not duplicated.',
          observed_operation_id: observedOperation,
          suggested_action: 'resume_job after the other operation finishes',
        },
        stage
      );
      return this.store.requireJob(jobId);
    }
    if (
      expectedOperationObserved &&
      ['running', 'cancelling'].includes(status)
    ) {
      const observedPercent = Math.max(
        0,
        Math.min(100, Number(appStatus.percent || 0))
      );
      const observedHumanStatus = String(appStatus.stage || stage.label);
      const observedEta = appStatus.etaSeconds ?? null;
      if (
        Number(stage.percent || 0) === observedPercent &&
        String(job.human_status || '') === observedHumanStatus &&
        (job.estimated_remaining_seconds ?? null) === observedEta &&
        canonicalJson(stage.result ?? null) === canonicalJson(appStatus ?? null)
      ) {
        return job;
      }
      return this.mutateJob(
        jobId,
        next => {
          const current = next.stages[next.stage_index];
          current.percent = observedPercent;
          current.result = clone(appStatus);
          applyStageCreditUsage(next, current, appStatus);
          next.percent = stagePercent(next, current.percent);
          next.human_status = observedHumanStatus;
          next.estimated_remaining_seconds = observedEta;
          return next;
        },
        {
          eventType: 'stage_progress',
          eventData: {
            percent: appStatus.percent || 0,
            stage: appStatus.stage || null,
          },
          expectedStage: stageFence(stage),
        }
      );
    }
    if (expectedOperationObserved && status === 'failed') {
      const artifactFingerprints =
        await this.fingerprintAvailableStageArtifacts(appStatus?.result);
      this.failStage(
        jobId,
        new Error(appStatus.error || 'Translator operation failed.'),
        stage,
        appStatus,
        artifactFingerprints
      );
      return this.store.requireJob(jobId);
    }
    if (expectedOperationObserved && status === 'cancelled') {
      const artifactFingerprints =
        await this.fingerprintAvailableStageArtifacts(appStatus?.result);
      return this.mutateJob(
        jobId,
        next => {
          const current = next.stages[next.stage_index];
          applyStageCreditUsage(next, current, appStatus);
          this.recordFingerprintedStageArtifacts(
            next,
            current,
            appStatus?.result,
            artifactFingerprints,
            { partial: true }
          );
          current.status = 'cancelled';
          current.finished_at = this.now().toISOString();
          current.result = clone(appStatus.result || appStatus);
          next.status = 'cancelled';
          next.stage = 'cancelled';
          next.human_status = 'Cancelled';
          return next;
        },
        { eventType: 'job_cancelled', expectedStage: stageFence(stage) }
      );
    }
    if (expectedOperationObserved && status === 'completed') {
      let artifactFingerprints;
      try {
        artifactFingerprints = await this.captureCompletedAppStage(
          job,
          stage,
          appStatus
        );
      } catch (error) {
        this.failStage(jobId, error, stage, appStatus);
        return this.store.requireJob(jobId);
      }
      if (artifactFingerprints === null) {
        return this.store.requireJob(jobId);
      }
      this.completeStage(
        jobId,
        appStatus.result || appStatus,
        stage,
        artifactFingerprints
      );
      return this.advanceJob(jobId);
    }

    if (!expectedOperationObserved && job.cancel_requested) {
      return this.mutateJob(
        jobId,
        next => {
          next.stages[next.stage_index].status = 'cancelled';
          next.status = 'cancelled';
          next.stage = 'cancelled';
          next.human_status = 'Cancelled';
          next.error = null;
          return next;
        },
        { eventType: 'job_cancelled', expectedStage: stageFence(stage) }
      );
    }
    if (!expectedOperationObserved && job.pause_requested) {
      return this.mutateJob(
        jobId,
        next => {
          next.stages[next.stage_index].status = 'interrupted';
          next.status = 'paused';
          next.human_status = `Paused before recovering ${next.stages[next.stage_index].label}`;
          next.recoverability = {
            recoverable: true,
            status: 'paused',
            resume_from_stage: next.stages[next.stage_index].id,
          };
          return next;
        },
        {
          eventType: 'job_paused_after_disconnect',
          expectedStage: stageFence(stage),
        }
      );
    }

    if (!expectedOperationObserved && stage.delivery_state === 'unknown') {
      this.blockStage(
        jobId,
        {
          code: 'APP_DELIVERY_REMAINS_UNKNOWN',
          message:
            'Translator no longer reports the operation whose start acknowledgement was lost. It will not be started again automatically; retry this exact stage explicitly to reuse its stable operation identity.',
          suggested_action: 'retry_stage',
        },
        stage
      );
      return this.store.requireJob(jobId);
    }

    if (
      !expectedOperationObserved &&
      AMBIGUOUS_INFERENCE_STAGE_IDS.has(stage.id)
    ) {
      this.blockStage(
        jobId,
        {
          code: 'INFERENCE_RESULT_NOT_OBSERVABLE_AFTER_APP_RESTART',
          message:
            'Translator no longer reports this exact inference operation. It will not be replayed automatically because the earlier provider request may already have consumed credit even though its result is no longer observable.',
          credit_will_not_be_recharged: null,
          suggested_action:
            'Inspect account usage and artifacts, then explicitly call retry_stage only if rerunning this stage is acceptable.',
        },
        stage
      );
      return this.store.requireJob(jobId);
    }

    const restartCount = Number(stage.restart_count || 0);
    if (restartCount < 1 && !expectedOperationObserved) {
      this.mutateJob(
        jobId,
        next => {
          const current = next.stages[next.stage_index];
          current.status = 'interrupted';
          current.restart_count = restartCount + 1;
          next.status = 'queued';
          next.human_status = `Recovering ${current.label} after app restart`;
          return next;
        },
        {
          eventType: 'stage_interrupted',
          eventData: { automatic_restart: true },
          expectedStage: stageFence(stage),
        }
      );
      return this.advanceJob(jobId);
    }
    if (!expectedOperationObserved) {
      this.blockStage(
        jobId,
        {
          code: 'APP_OPERATION_NOT_OBSERVABLE_AFTER_RESTART',
          message:
            'Translator no longer reports this exact operation after one automatic same-ID recovery attempt. The job remains at this checkpoint and will not start again without an explicit retry.',
          suggested_action: 'retry_stage',
        },
        stage
      );
      return this.store.requireJob(jobId);
    }
    return job;
  }

  async captureCompletedAppStage(job, stage, appStatus) {
    if (!this.isCurrentStage(job.job_id, stage)) return null;
    if (['transcription', 'translation_app'].includes(stage.id)) {
      const plan = this.store.getPlan(job.plan_hash);
      let segments = await this.readAllAppSubtitles(
        usesLibraryHistoryStage(plan, stage) ? plan.source : null,
        job.job_id
      );
      if (!this.isCurrentStage(job.job_id, stage)) return null;
      if (!segments.length) {
        throw new Error(`Completed ${stage.id} returned no subtitle segments.`);
      }
      if (stage.id === 'transcription') {
        const repair = repairZeroDurationTranscriptSegments(segments);
        segments = repair.segments;
        if (repair.repaired_segment_count > 0) {
          const rawApplied = await this.callApp('applyTranslationSession', {
            mcpJobId: job.job_id,
            source: plan.source,
            sourceBinding: plannedAppSourceBinding(plan, 'mounted'),
            videoPath:
              String(appStatus?.result?.videoPath || '').trim() ||
              plannedVideoPath(job, plan),
            targetLanguage: plan.target_language || 'translation-not-requested',
            segments,
          });
          const applied = bindAppObservationToPlan(plan, rawApplied);
          if (applied?.source_binding?.state !== 'mounted') {
            throw new Error(
              'Translator did not attest the planned source after applying the locally repaired transcript.'
            );
          }
        }
        const initialized = this.store.initializeTranslationSession(
          job.job_id,
          {
            segments,
            targetLanguage: plan.target_language || 'translation-not-requested',
            sourceLanguage: appStatus?.result?.sourceLanguage || 'auto',
            profileName: plan.project_profile,
            glossary: this.mergedGlossary(plan),
            mediaDurationSeconds: plan.source_metadata?.duration_seconds,
          }
        );
        appStatus.result = {
          ...(isObject(appStatus.result) ? appStatus.result : {}),
          transcript_checkpoint: {
            kind: 'completed_provider_transcript',
            provider_retried: false,
            original_segment_count: repair.original_segment_count,
            persisted_segment_count: repair.persisted_segment_count,
            zero_duration_segments_merged: repair.repaired_segment_count,
            session_reused: initialized.reused === true,
            repairs: repair.repairs.slice(0, 200),
            repair_details_truncated: repair.repairs.length > 200,
          },
        };
      } else {
        this.store.synchronizeTranslationSession(job.job_id, segments);
      }
    }
    const fingerprints = await this.fingerprintStageArtifacts(
      appStatus.result || appStatus
    );
    return this.isCurrentStage(job.job_id, stage) ? fingerprints : null;
  }

  mergedGlossary(plan) {
    const profile = this.profileForPlan(plan);
    return {
      ...(profile.glossary || {}),
      ...(plan.options?.per_video_glossary || {}),
    };
  }

  profileForPlan(plan) {
    if (isObject(plan?.profile_snapshot)) return clone(plan.profile_snapshot);
    // Compatibility for plans created before profile snapshots were added.
    return this.store.getProfile(plan?.project_profile) || {};
  }

  async loadTranscriptStage(job, plan, expectedStage = null) {
    const canPersist = () =>
      !expectedStage || this.isStageStartAllowed(job.job_id, expectedStage);
    if (plan.source.kind === 'mock') {
      if (!canPersist()) return;
      this.store.initializeTranslationSession(job.job_id, {
        targetLanguage: plan.target_language || 'Korean',
        profileName: plan.project_profile,
        glossary: this.mergedGlossary(plan),
        mediaDurationSeconds: plan.source_metadata?.duration_seconds || 12,
        segments: [
          {
            id: 'seg_00001',
            start: 0,
            end: 3,
            source: 'Welcome to the Translator MCP sample.',
          },
          {
            id: 'seg_00002',
            start: 3.2,
            end: 7,
            source: 'This workflow never consumes Stage5 credits.',
          },
          {
            id: 'seg_00003',
            start: 7.2,
            end: 11,
            source: 'Every translation segment has a stable identity.',
          },
        ],
      });
      return;
    }
    if (
      ['creator_captions', 'youtube_auto_captions'].includes(
        plan.transcription?.method
      )
    ) {
      const track = plan.transcription.caption_track;
      if (!track) throw new Error('The planned caption track is unavailable.');
      const fetched = await this.callApp('fetchSourceCaptions', {
        mcpJobId: job.job_id,
        url: plan.source.url,
        kind:
          plan.transcription.method === 'creator_captions'
            ? 'creator'
            : 'automatic',
        language: track.language,
      });
      const segments = requireReadableSrt(
        String(fetched?.content || ''),
        'The selected source caption track'
      );
      if (!canPersist()) return;
      this.store.initializeTranslationSession(job.job_id, {
        segments,
        targetLanguage: plan.target_language || 'translation-not-requested',
        sourceLanguage: track.language,
        profileName: plan.project_profile,
        glossary: this.mergedGlossary(plan),
        mediaDurationSeconds: plan.source_metadata?.duration_seconds,
      });
      return;
    }
    if (plan.transcription?.method === 'reuse') {
      const sourceJobId = plan.transcription.reuse_source_job_id;
      const sourceSession = sourceJobId
        ? this.store.getTranslationSession(sourceJobId)
        : null;
      if (!sourceSession) {
        throw new Error(
          'The planned reusable transcript is no longer available.'
        );
      }
      if (!canPersist()) return;
      this.store.initializeTranslationSession(job.job_id, {
        segments: sourceSession.segments.map(segment => ({
          ...segment,
          // `reuse` is deliberately a transcription choice. Carrying an old
          // target-language result forward would silently skip this plan's
          // provider, glossary, profile, and requested review workflow.
          translation: '',
          status: 'pending',
          revision_count: 0,
        })),
        targetLanguage: plan.target_language || 'translation-not-requested',
        sourceLanguage: sourceSession.source_language,
        profileName: plan.project_profile,
        glossary: this.mergedGlossary(plan),
        mediaDurationSeconds: plan.source_metadata?.duration_seconds,
      });
      return;
    }
    if (plan.transcription?.method === 'none') return;
    if (plan.transcription?.imported_transcript?.path) {
      const { text } = await readBoundedSrtTranscript(
        plan.transcription.imported_transcript.path
      );
      const currentSourceKey = `transcript:sha256:${createHash('sha256').update(text).digest('hex')}`;
      if (
        currentSourceKey !== plan.transcription.imported_transcript.source_key
      ) {
        throw new Error(
          'The imported transcript changed after planning. Run plan_job again.'
        );
      }
      if (!canPersist()) return;
      this.store.initializeTranslationSession(job.job_id, {
        segments: requireReadableSrt(text, 'The imported transcript'),
        targetLanguage: plan.target_language || 'translation-not-requested',
        profileName: plan.project_profile,
        glossary: this.mergedGlossary(plan),
        mediaDurationSeconds: plan.source_metadata?.duration_seconds,
      });
      return;
    }
    if (plan.source.kind === 'transcript') {
      const { text } = await readBoundedSrtTranscript(
        plan.source.transcript_path
      );
      const currentSourceKey = `transcript:sha256:${createHash('sha256').update(text).digest('hex')}`;
      if (currentSourceKey !== plan.source.source_key) {
        throw new Error(
          'The imported transcript changed after planning. Run plan_job again.'
        );
      }
      if (!canPersist()) return;
      this.store.initializeTranslationSession(job.job_id, {
        segments: requireReadableSrt(text, 'The imported transcript'),
        targetLanguage: plan.target_language || 'translation-not-requested',
        profileName: plan.project_profile,
        glossary: this.mergedGlossary(plan),
        mediaDurationSeconds: plan.source_metadata?.duration_seconds,
      });
      return;
    }
    if (
      plan.transcription?.method === 'imported_transcript' &&
      plan.source.kind !== 'library_item'
    ) {
      throw new Error(
        'This legacy imported-transcript plan is not bound to an immutable transcript file. Run plan_job again with imported_transcript_path.'
      );
    }
    let segments = await this.readAllAppSubtitles(plan.source, job.job_id);
    if (!segments.length) {
      throw new Error(
        'The planned existing transcript contains no subtitle cues.'
      );
    }
    if (
      plan.source.kind === 'library_item' &&
      plan.transcription?.method === 'imported_transcript'
    ) {
      const currentSubtitleSha256 = subtitleSourceSha256(segments);
      if (
        currentSubtitleSha256 !== plan.transcription?.subtitle_source_sha256
      ) {
        throw new Error(
          'The library subtitles changed after planning. Run plan_job again.'
        );
      }
    }
    if (plan.translation?.provider !== 'none') {
      segments = segments.map(segment => ({
        ...segment,
        translation: '',
        status: 'pending',
        revision_count: 0,
      }));
    }
    if (!canPersist()) return;
    this.store.initializeTranslationSession(job.job_id, {
      segments,
      targetLanguage: plan.target_language || 'translation-not-requested',
      profileName: plan.project_profile,
      glossary: this.mergedGlossary(plan),
      mediaDurationSeconds: plan.source_metadata?.duration_seconds,
    });
  }

  async ensureTranslationSession(job, plan, expectedStage = null) {
    const existing = this.store.getTranslationSession(job.job_id);
    if (existing) return existing;
    await this.loadTranscriptStage(job, plan, expectedStage);
    return this.store.getTranslationSession(job.job_id);
  }

  async applySessionToApp(
    job,
    plan,
    expectedStage = null,
    { videoPath = null } = {}
  ) {
    const session = await this.ensureTranslationSession(
      job,
      plan,
      expectedStage
    );
    if (!session) {
      throw new Error('Persistent translation session is unavailable.');
    }
    if (expectedStage && !this.isStageStartAllowed(job.job_id, expectedStage)) {
      return null;
    }
    const result = await this.callApp('applyTranslationSession', {
      mcpJobId: job.job_id,
      source: plan.source,
      sourceBinding: plannedAppSourceBinding(plan, 'mounted'),
      videoPath: videoPath || plannedVideoPath(job, plan),
      targetLanguage: plan.target_language,
      segments: session.segments,
    });
    return result;
  }

  async readAllAppSubtitles(source, mcpJobId = null) {
    const segments = [];
    let moreRemain = false;
    for (
      let offset = 0;
      offset < MAX_TRANSLATION_SESSION_SEGMENTS;
      offset += 100
    ) {
      const page = await this.callApp('subtitlesBatch', {
        ...(mcpJobId ? { mcpJobId } : {}),
        offset,
        limit: 100,
        ...(source?.kind === 'library_item'
          ? { historyId: source.history_id }
          : {}),
      });
      const cues = Array.isArray(page?.cues) ? page.cues : [];
      segments.push(
        ...cues.map((cue, index) => ({
          id: cue.id || `seg_${String(offset + index + 1).padStart(5, '0')}`,
          index: offset + index + 1,
          start: Number(cue.start),
          end: Number(cue.end),
          source: String(cue.source ?? cue.original ?? ''),
          translation: String(cue.translation || ''),
          speaker: cue.speaker || null,
          topic: cue.topic || null,
        }))
      );
      if (page?.hasMore === true && cues.length === 0) {
        throw new Error(
          'Translator subtitle pagination reported more cues but returned an empty page; no truncated session was stored.'
        );
      }
      moreRemain = page?.hasMore === true;
      if (!moreRemain) return segments;
    }
    if (moreRemain) {
      throw new Error(
        `Mounted subtitles exceed the ${MAX_TRANSLATION_SESSION_SEGMENTS}-cue safety limit; no truncated session was stored.`
      );
    }
    return segments;
  }

  async getJob({ job_id: jobId, after_cursor: afterCursor = 0 }) {
    const job = this.shutdownReason
      ? this.store.requireJob(jobId)
      : await this.reconcileJob(jobId);
    const requestedCursor = Math.max(0, Number(afterCursor) || 0);
    if (requestedCursor > Number(job.event_cursor || 0)) {
      throw new Error(
        `after_cursor ${requestedCursor} is ahead of this job's current cursor ${job.event_cursor}.`
      );
    }
    const events = this.store.getEvents(jobId, requestedCursor);
    const nextCursor = events.length
      ? Number(events[events.length - 1].cursor)
      : requestedCursor;
    return {
      job,
      events,
      next_cursor: nextCursor,
      has_more_events: nextCursor < Number(job.event_cursor || 0),
    };
  }

  listJobs(args) {
    return {
      jobs: this.store.listJobs(args).map(job => ({
        job_id: job.job_id,
        status: job.status,
        stage: job.stage,
        percent: job.percent,
        human_status: job.human_status,
        updated_at: job.updated_at,
        credit_usage: job.credit_usage,
        recoverability: job.recoverability,
      })),
    };
  }

  async watchJob({
    job_id: jobId,
    after_cursor: afterCursor = 0,
    wait_ms: waitMs = WATCH_JOB_DEFAULT_WAIT_MS,
  }) {
    const numericWait = Number(waitMs);
    const effectiveWaitMs = Math.min(
      WATCH_JOB_MAX_WAIT_MS,
      Math.max(
        0,
        Number.isFinite(numericWait) ? numericWait : WATCH_JOB_DEFAULT_WAIT_MS
      )
    );
    const startedAt = performance.now();
    const deadline = startedAt + effectiveWaitMs;
    const decorate = (current, timedOut = false) => {
      const interrupted = Boolean(this.shutdownReason);
      const unchanged =
        current.events.length === 0 &&
        Number(current.next_cursor) === Number(afterCursor);
      const wakeReason = interrupted
        ? 'interrupted'
        : current.events.length > 0
          ? 'change'
          : TERMINAL.has(current.job.status)
            ? 'terminal'
            : effectiveWaitMs <= 0
              ? 'poll'
              : timedOut
                ? 'timeout'
                : 'unchanged';
      return {
        ...current,
        changed: !unchanged,
        unchanged,
        timed_out: timedOut,
        wake_reason: wakeReason,
        requested_wait_ms: numericWait,
        effective_wait_ms: effectiveWaitMs,
        waited_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        interrupted,
        ...(this.shutdownReason
          ? { interruption_reason: this.shutdownReason }
          : {}),
      };
    };
    let response = await this.getJob({
      job_id: jobId,
      after_cursor: afterCursor,
    });
    if (
      response.events.length ||
      TERMINAL.has(response.job.status) ||
      effectiveWaitMs <= 0 ||
      this.shutdownReason
    ) {
      return decorate(response);
    }
    let resolveCompletion;
    const completion = new Promise(resolve => {
      resolveCompletion = resolve;
    });
    this.pendingWatchCompletions.add(completion);
    try {
      while (performance.now() < deadline && !this.shutdownReason) {
        const remainingWaitMs = Math.max(0, deadline - performance.now());
        await new Promise(resolve => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            this.events.removeListener(jobId, finish);
            this.pendingWatchInterrupts.delete(finish);
            resolve();
          };
          const timer = setTimeout(finish, remainingWaitMs);
          this.pendingWatchInterrupts.add(finish);
          this.events.once(jobId, finish);
          // Close the registration race: a mutation can commit after the
          // preceding read but immediately before the listener is attached.
          if (
            Number(this.store.requireJob(jobId).event_cursor || 0) >
            Number(afterCursor || 0)
          ) {
            finish();
          }
        });
        response = await this.getJob({
          job_id: jobId,
          after_cursor: afterCursor,
        });
        if (
          response.events.length ||
          TERMINAL.has(response.job.status) ||
          this.shutdownReason
        ) {
          return decorate(response);
        }
        // EventEmitter notifications are advisory. A fenced no-op mutation
        // can wake a listener without advancing the persisted event cursor;
        // keep waiting until a real change, interruption, or the deadline.
      }
      if (!this.shutdownReason) {
        response = await this.getJob({
          job_id: jobId,
          after_cursor: afterCursor,
        });
        if (response.events.length || TERMINAL.has(response.job.status)) {
          return decorate(response);
        }
      }
      return decorate(response, !this.shutdownReason);
    } finally {
      this.pendingWatchCompletions.delete(completion);
      resolveCompletion();
    }
  }

  pauseJob(jobId) {
    const job = this.store.requireJob(jobId);
    if (
      TERMINAL.has(job.status) ||
      job.status === 'blocked' ||
      job.status === 'paused' ||
      job.status === 'pause_requested'
    ) {
      return job;
    }
    if (!this.store.claimControlRequest(jobId, 'pause')) {
      return this.store.requireJob(jobId);
    }
    return this.mutateJob(
      jobId,
      next => {
        if (TERMINAL.has(next.status)) return next;
        next.pause_requested = true;
        const stage = next.stages[next.stage_index];
        if (!stage || !['running', 'starting'].includes(stage.status)) {
          next.status = 'paused';
          next.human_status = `Paused at ${stage?.label || 'checkpoint'}`;
        } else {
          next.status = 'pause_requested';
          next.human_status = `Pause requested; ${stage.label} will finish first`;
        }
        return next;
      },
      { eventType: 'pause_requested' }
    );
  }

  async resumeJob(jobId) {
    const current = this.store.requireJob(jobId);
    if (TERMINAL.has(current.status)) return current;
    if (!['paused', 'pause_requested'].includes(current.status)) {
      return current;
    }
    if (
      !this.store.claimControlRequest(
        jobId,
        `resume:${current.stage}:${current.revision}`
      )
    ) {
      return this.store.requireJob(jobId);
    }
    this.mutateJob(
      jobId,
      job => {
        const stage = job.stages[job.stage_index];
        job.pause_requested = false;
        job.error = null;
        if (stage.status === 'waiting_for_agent') {
          job.status = 'waiting_for_agent';
          job.human_status = 'Waiting for external-agent translation batches';
        } else {
          job.status = stage.status === 'running' ? 'running' : 'queued';
          job.human_status = `Resuming ${stage.label}`;
        }
        return job;
      },
      {
        eventType: 'job_resumed',
        expectedStage: stageFence(current.stages[current.stage_index]),
        allowFailedExpectedStage: true,
      }
    );
    this.store.releaseControlRequest(jobId, 'pause');
    return this.advanceJob(jobId);
  }

  async cancelJob(jobId) {
    const current = this.store.requireJob(jobId);
    if (TERMINAL.has(current.status)) {
      return current;
    }
    if (!this.store.claimControlRequest(jobId, 'cancel')) {
      return this.store.requireJob(jobId);
    }
    const requested = this.mutateJob(
      jobId,
      job => {
        if (TERMINAL.has(job.status)) return job;
        const stage = job.stages[job.stage_index];
        if (
          ['running', 'starting'].includes(stage?.status) &&
          ACTIVE_APP_STAGE_IDS.has(stage.id)
        ) {
          job.cancel_requested = true;
          job.status = 'cancel_requested';
          job.human_status = `Cancelling ${stage.label}`;
          return job;
        }
        if (stage) stage.status = 'cancelled';
        job.cancel_requested = true;
        job.status = 'cancelled';
        job.stage = 'cancelled';
        job.human_status = 'Cancelled';
        return job;
      },
      {
        eventType: next =>
          next.status === 'cancelled' ? 'job_cancelled' : 'cancel_requested',
      }
    );
    if (requested.status === 'cancel_requested') {
      const stage = requested.stages[requested.stage_index];
      const plan = this.store.getPlan(requested.plan_hash);
      try {
        const acknowledgement = await this.callApp('cancelProcessing', {
          mcpJobId: jobId,
          operationId: operationId(requested, stage),
          ...(usesLibraryHistoryStage(plan, stage)
            ? { historyId: plan.source.history_id }
            : {}),
        });
        const accepted =
          acknowledgement?.accepted === true ||
          acknowledgement?.cancellation?.accepted === true;
        if (!accepted) {
          let reconciled = null;
          try {
            reconciled = await this.reconcileJob(jobId);
          } catch {
            // The explicit cancellation must remain retryable even when the
            // follow-up status read is itself unavailable.
          }
          if (reconciled && TERMINAL.has(reconciled.status)) {
            return reconciled;
          }
          const error = new Error(
            `Translator did not acknowledge cancellation for ${stage.label}; call cancel_job again to retry the exact operation-scoped request.`
          );
          error.code = 'CANCEL_NOT_ACKNOWLEDGED';
          throw error;
        }
      } catch (error) {
        // Cancellation is operation-scoped and idempotent. A later explicit
        // request may safely resend it when this acknowledgement did not
        // arrive, while concurrent callers remain coalesced by the claim.
        this.store.releaseControlRequest(jobId, 'cancel');
        throw error;
      }
    }
    return requested;
  }

  async retryStage(jobId, requestedStage, paidRetryConfirmation = null) {
    const current = this.store.requireJob(jobId);
    const stage = current.stages[current.stage_index];
    if (!stage) throw new Error('Job has no retryable stage.');
    if (requestedStage && requestedStage !== stage.id) {
      throw new Error(
        `Only the current failed stage can be retried: ${stage.id}`
      );
    }
    if (!['failed', 'blocked', 'interrupted'].includes(stage.status)) {
      throw new Error(`Stage is not retryable from status: ${stage.status}`);
    }
    const plan = this.store.getPlan(current.plan_hash);
    const runtimeRequirement = this.stageRuntimeRequirement(plan, stage);
    const estimatedStage5Credits = Math.max(
      0,
      Number(runtimeRequirement?.estimated_stage5_credits || 0)
    );
    const plannedProviderKind = String(
      runtimeRequirement?.planned_descriptor?.kind ||
        (runtimeRequirement
          ? estimatedStage5Credits > 0
            ? 'stage5'
            : 'provider'
          : '')
    );
    const mayConsumeProviderFunds =
      Boolean(runtimeRequirement) && plannedProviderKind !== 'unavailable';
    if (
      mayConsumeProviderFunds &&
      paidRetryConfirmation !== 'RETRY_PAID_STAGE'
    ) {
      const error = new Error(
        plannedProviderKind === 'stage5'
          ? `Retrying ${stage.label} may consume another ${estimatedStage5Credits} Stage5 credits because the prior attempt's provider settlement may be unknown. Repeat retry_stage with confirm_paid_retry=RETRY_PAID_STAGE after reviewing the job credit ledger.`
          : `Retrying ${stage.label} may create another charge with the configured BYO provider because the prior attempt's settlement may be unknown. Repeat retry_stage with confirm_paid_retry=RETRY_PAID_STAGE after reviewing the job audit trail.`
      );
      error.code = 'PAID_STAGE_RETRY_CONFIRMATION_REQUIRED';
      error.details = {
        stage: stage.id,
        provider_kind: plannedProviderKind,
        provider: clone(runtimeRequirement?.planned_descriptor || null),
        estimated_stage5_credits: estimatedStage5Credits,
        prior_credit_usage: clone(current.credit_usage || null),
      };
      throw error;
    }
    const retryControlKey = `retry:${stage.id}:${stage.attempts || 0}`;
    if (!this.store.claimControlRequest(jobId, retryControlKey)) {
      return this.store.requireJob(jobId);
    }
    this.mutateJob(
      jobId,
      job => {
        const retry = job.stages[job.stage_index];
        retry.status = 'retrying';
        retry.error = null;
        job.status = 'queued';
        job.error = null;
        job.human_status = `Retrying ${retry.label}`;
        return job;
      },
      {
        eventType: 'stage_retry_requested',
        eventData: {
          stage: stage.id,
          operation_id: stage.operation_id,
        },
        expectedStage: stageFence(stage),
        allowFailedExpectedStage: true,
      }
    );
    return this.advanceJob(jobId);
  }

  getTranscriptBatch({
    job_id: jobId,
    mode = 'translate',
    max_segments: maxSegments = 16,
  }) {
    const job = this.store.requireJob(jobId);
    const stage = job.stages[job.stage_index];
    const correctionReview =
      stage?.id === 'translation_validation' &&
      job.status === 'blocked' &&
      job.error?.code === 'TRANSLATION_VALIDATION_FAILED' &&
      mode === 'review';
    const initialTranslation =
      stage?.id === 'translation_external' &&
      job.status === 'waiting_for_agent' &&
      mode === 'translate';
    if (!initialTranslation && !correctionReview) {
      throw new Error(
        mode === 'review'
          ? 'Review batches are available only for a validation-blocked correction pass.'
          : 'This job is not waiting for external-agent translation.'
      );
    }
    if (job.status === 'paused')
      throw new Error('Resume the job before requesting a batch.');
    const plan = this.store.getPlan(job.plan_hash);
    const profile = this.profileForPlan(plan);
    const style = profile.translation_style || {};
    const batch = this.store.issueTranslationBatch(jobId, {
      mode,
      maxSegments,
    });
    return {
      ...batch,
      project_profile: plan.project_profile,
      profile_revision: plan.profile_revision || 0,
      translation_guidance: {
        target_language: plan.target_language,
        natural_not_literal: style.natural_not_literal === true,
        preserve_tone_and_intensity: style.preserve_tone_and_intensity === true,
        concise_subtitle_phrasing: style.concise_subtitle_phrasing === true,
        preserve_segment_ids_and_timestamps: true,
      },
      subtitle_constraints: {
        maximum_lines:
          style.max_lines || profile.subtitle_rendering?.max_lines || 2,
        maximum_characters_per_line: style.max_characters_per_line || 42,
        preferred_characters_per_second:
          style.preferred_characters_per_second || 20,
      },
    };
  }

  async submitTranslationBatch({
    job_id: jobId,
    batch_id: batchId,
    translations,
  }) {
    const accepted = this.store.submitTranslationBatch(
      jobId,
      batchId,
      translations
    );
    let job = this.store.requireJob(jobId);
    if (!accepted.reused) {
      const stage = job.stages[job.stage_index];
      const percent = Math.max(
        0,
        Math.min(100, Number(accepted.session.percent_translated || 0))
      );
      job = this.mutateJob(
        jobId,
        next => {
          const current = next.stages[next.stage_index];
          current.percent = percent;
          current.result = clone(accepted.session);
          next.validation = null;
          next.percent = stagePercent(next, percent);
          next.human_status =
            current.id === 'translation_external'
              ? `Waiting for external-agent translation (${accepted.session.translated_segments}/${accepted.session.total_segments})`
              : 'Translation corrections accepted; validation retry is ready';
          return next;
        },
        {
          eventType:
            stage?.id === 'translation_external'
              ? 'translation_batch_accepted'
              : 'translation_correction_batch_accepted',
          eventData: {
            batch_id: accepted.batch_id,
            accepted_segment_count: accepted.accepted_segment_ids.length,
            translated_segments: accepted.session.translated_segments,
            total_segments: accepted.session.total_segments,
          },
          expectedStage: stageFence(stage),
        }
      );
    }
    if (accepted.session.pending_segments === 0 && job.status !== 'paused') {
      await this.reconcileJob(jobId);
    }
    return { ...accepted, job: this.store.requireJob(jobId) };
  }

  async runValidation(jobId) {
    const job = this.store.requireJob(jobId);
    const plan = this.store.getPlan(job.plan_hash);
    const session = this.store.getTranslationSession(jobId);
    if (!session)
      throw new Error('No persistent translation session exists for this job.');
    const profile = this.profileForPlan(plan);
    const style = profile.translation_style || {};
    return validateSubtitleSegments(session.segments, {
      mode: plan.translation?.provider === 'none' ? 'source' : 'translation',
      targetLanguage: session.target_language,
      glossary: session.glossary,
      mediaDurationSeconds: session.media_duration_seconds,
      maxLines: style.max_lines || 2,
      maxCharactersPerLine: style.max_characters_per_line || 42,
      preferredCharactersPerSecond: style.preferred_characters_per_second || 20,
    });
  }

  async validateTranslation(jobId) {
    const validation = await this.runValidation(jobId);
    if (validation.passed) {
      this.store.clearTranslationCorrectionMarkers(jobId);
    }
    const currentJob = this.store.requireJob(jobId);
    if (['completed', 'cancelled'].includes(currentJob.status)) {
      return validation;
    }
    const currentStage = currentJob.stages[currentJob.stage_index];
    const updated = this.mutateJob(
      jobId,
      job => {
        job.validation = validation;
        return job;
      },
      {
        eventType: 'translation_validated',
        eventData: {
          passed: validation.passed,
          errors: validation.error_count,
        },
        ...(currentStage ? { expectedStage: stageFence(currentStage) } : {}),
      }
    );
    if (
      !validation.passed &&
      Number(updated.revision) > Number(currentJob.revision)
    ) {
      this.store.markTranslationSegmentsForCorrection(
        jobId,
        validation.issues
          .filter(issue => issue.severity === 'error')
          .map(issue => issue.segment_id)
      );
    }
    return validation;
  }

  getProjectProfile(name) {
    const profile = this.store.getProfile(name);
    if (!profile) throw new Error(`Project profile not found: ${name}`);
    return profile;
  }

  async renderPreview(jobId) {
    const existing = this.activePreviewRenders.get(jobId);
    if (existing) return existing;
    const render = this.withJobActivity(jobId, 'render_preview', () =>
      this.renderPreviewOnce(jobId)
    );
    this.activePreviewRenders.set(jobId, render);
    try {
      return await render;
    } finally {
      if (this.activePreviewRenders.get(jobId) === render) {
        this.activePreviewRenders.delete(jobId);
      }
    }
  }

  async renderPreviewOnce(jobId) {
    const job = this.store.requireJob(jobId);
    const stage = job.stages[job.stage_index];
    if (stage?.id !== 'render_outputs') {
      throw new Error(
        'Preview frames can be rendered only at the render_outputs checkpoint before the full encode starts.'
      );
    }
    if (!['blocked', 'failed'].includes(stage.status)) {
      throw new Error(
        'Preview rendering requires a blocked or failed render_outputs checkpoint with no encode running.'
      );
    }
    const plan = this.store.getPlan(job.plan_hash);
    if (!plan.outputs?.output_directory) {
      throw new Error('Preview rendering requires a planned output directory.');
    }
    const validation = await this.runValidation(jobId);
    if (!validation.passed) {
      throw new Error(
        'Subtitle validation errors must be corrected before rendering a preview.'
      );
    }
    const previewVideoPath = await this.requireCurrentPlannedVideo(job, plan, {
      preferDubbed: plan.options?.include_dubbing === true,
    });
    await this.applySessionToApp(job, plan, null, {
      videoPath: previewVideoPath,
    });
    const result = await this.callApp('renderPreview', {
      mcpJobId: jobId,
      operationId: `mcp-v2:${jobId}:preview`,
      source: plan.source,
      sourceVideoPath: previewVideoPath,
      protectedInputPaths: plannedInputPaths(plan, [previewVideoPath]),
      outputs: plan.outputs,
      sample_positions: ['beginning', 'middle', 'end'],
    });
    if (!this.isCurrentStage(jobId, stage)) {
      throw new Error(
        'The render checkpoint changed while preview frames were being created. The full encode was not started by this call.'
      );
    }
    const previewArtifacts = [];
    for (const framePath of Array.isArray(result?.frames)
      ? result.frames
      : []) {
      if (!String(framePath || '').trim()) {
        throw new Error('Preview renderer returned an empty frame path.');
      }
      const resolved = path.resolve(String(framePath));
      const fingerprint = await fingerprintRegularFile(resolved).catch(
        () => null
      );
      if (!fingerprint) {
        throw new Error(
          `Preview renderer returned a missing, changing, or non-regular frame: ${resolved}`
        );
      }
      previewArtifacts.push({
        path: fingerprint.path,
        kind: 'preview_frame',
        stage: 'render_preview',
        bytes: fingerprint.bytes,
        sha256: fingerprint.sha256,
        verified: true,
      });
    }
    if (!previewArtifacts.length) {
      throw new Error('Preview renderer returned no frame artifacts.');
    }
    const previewCheckpointId = randomUUID();
    const persisted = this.mutateJob(
      jobId,
      next => {
        for (const artifact of previewArtifacts) {
          const existingIndex = next.artifacts.findIndex(
            candidate =>
              normalizedPathIdentity(candidate.path) ===
              normalizedPathIdentity(artifact.path)
          );
          const persisted = {
            ...artifact,
            verified_sha256: artifact.sha256,
          };
          if (existingIndex === -1) next.artifacts.push(persisted);
          else next.artifacts[existingIndex] = persisted;
        }
        next.preview = {
          ...clone(result),
          artifacts: clone(previewArtifacts),
          rendered_at: this.now().toISOString(),
          checkpoint_id: previewCheckpointId,
        };
        return next;
      },
      {
        eventType: 'render_preview_completed',
        eventData: { frame_count: previewArtifacts.length },
        expectedStage: stageFence(stage),
      }
    );
    if (persisted.preview?.checkpoint_id !== previewCheckpointId) {
      throw new Error(
        'The render checkpoint changed while preview artifacts were being verified. The preview result was not attached to the job.'
      );
    }
    return { ...result, artifacts: previewArtifacts };
  }

  async renderOutputs(jobId, allowWarnings) {
    if (this.activePreviewRenders.has(jobId)) {
      throw new Error(
        'A preview render is still active for this job. Wait for it to finish before authorizing the full encode.'
      );
    }
    const job = this.store.requireJob(jobId);
    const stage = job.stages[job.stage_index];
    if (stage?.id !== 'render_outputs') {
      throw new Error('The current job stage is not render_outputs.');
    }
    // A second authorization can arrive while the first caller is between its
    // durable claim and app acknowledgement. Reusing that exact generation is
    // required; resetting `starting` to `retrying` would permit another claim.
    if (stage.status === 'starting' || stage.status === 'running') return job;
    return this.withJobActivity(jobId, 'render_authorization', async () => {
      const current = this.store.requireJob(jobId);
      const currentStage = current.stages[current.stage_index];
      if (currentStage?.id !== 'render_outputs') {
        throw new Error('The current job stage is not render_outputs.');
      }
      if (
        currentStage.status === 'starting' ||
        currentStage.status === 'running'
      ) {
        return current;
      }
      const previewOperationId = `mcp-v2:${jobId}:preview`;
      const previewStatus = await this.callApp('processingStatus', {
        mcpJobId: jobId,
        operationId: previewOperationId,
      });
      if (
        (previewStatus?.id === previewOperationId ||
          previewStatus?.operationId === previewOperationId) &&
        ['running', 'cancelling'].includes(appResultStatus(previewStatus))
      ) {
        throw new Error(
          'A preview render is still active for this job. Wait for it to finish before authorizing the full encode.'
        );
      }
      const validation = await this.runValidation(jobId);
      if (!validation.passed)
        throw new Error(
          'Subtitle validation errors must be corrected before rendering.'
        );
      if (validation.warning_count && !allowWarnings) {
        throw new Error(
          `Subtitle validation has ${validation.warning_count} warning(s). Set allow_warnings=true to acknowledge them.`
        );
      }
      this.mutateJob(
        jobId,
        next => {
          next.stages[next.stage_index].status = 'retrying';
          next.status = 'queued';
          next.render_authorized = true;
          next.render_warnings_authorized = allowWarnings;
          next.error = null;
          return next;
        },
        {
          eventType: 'render_authorized',
          eventData: { allow_warnings: allowWarnings },
          expectedStage: stageFence(currentStage),
        }
      );
      return this.advanceJob(jobId);
    });
  }

  async inspectJobArtifacts(jobId) {
    const job = this.store.requireJob(jobId);
    const plan = this.store.getPlan(job.plan_hash);
    const expectedPresets = plan.outputs?.presets || [];
    const renderStage = job.stages.find(stage => stage.id === 'render_outputs');
    const results = [];
    for (let index = 0; index < expectedPresets.length; index += 1) {
      const preset = expectedPresets[index];
      const artifact = job.artifacts.find(
        candidate =>
          candidate.preset === preset &&
          /\.(?:mp4|mov|mkv|webm)$/i.test(candidate.path)
      );
      if (!artifact) {
        results.push({
          path: null,
          expected_preset: preset,
          passed: false,
          findings: [
            {
              severity: 'error',
              code: 'planned_output_missing',
              message: `No rendered artifact was recorded for ${preset}.`,
            },
          ],
        });
        continue;
      }
      const representativeFrameRequest = plan.outputs?.output_directory
        ? {
            outputDirectory: plan.outputs.output_directory,
            baseName: `${plan.outputs.base_name || 'translator-output'}-${preset}-verified`,
            overwrite: plan.outputs.overwrite === true,
            operationId: renderStage
              ? `${operationId(job, renderStage)}-verify-${index + 1}`
              : `mcp-v2:${jobId}:verify-${index + 1}`,
            protectedPaths: plannedInputPaths(plan, [artifact.path]),
          }
        : null;
      const expectedOperationId = renderStage
        ? `${operationId(job, renderStage)}-encode-${index + 1}`
        : null;
      let inspected = await this.callApp('inspectMedia', {
        mcpJobId: jobId,
        path: artifact.path,
        expectedPreset: preset,
        expectedOperationId,
        xAccountTier: plan.outputs?.x_account_tier || 'standard',
        ...(representativeFrameRequest
          ? { representativeFrames: representativeFrameRequest }
          : {}),
      });
      if (inspected?.passed === true) {
        const receiptBytes = Number(inspected?.operation_receipt?.bytes);
        const receiptSha256 = String(
          inspected?.operation_receipt?.sha256 || ''
        );
        if (
          normalizedPathIdentity(inspected?.path) !==
            normalizedPathIdentity(artifact.path) ||
          inspected?.expected_preset !== preset ||
          inspected?.expected_operation_id !== expectedOperationId ||
          inspected?.operation_receipt_valid !== true ||
          !Number.isSafeInteger(receiptBytes) ||
          receiptBytes < 0 ||
          !/^[a-f0-9]{64}$/.test(receiptSha256)
        ) {
          inspected = {
            ...inspected,
            passed: false,
            findings: [
              ...(Array.isArray(inspected?.findings) ? inspected.findings : []),
              {
                severity: 'error',
                code: 'operation_receipt_integrity_failed',
                message:
                  'Translator did not bind this verification result to the exact planned artifact and render operation receipt.',
              },
            ],
          };
        }
      }
      if (inspected?.passed === true && representativeFrameRequest) {
        try {
          const frameArtifacts = Array.isArray(
            inspected?.representative_frames?.artifacts
          )
            ? inspected.representative_frames.artifacts
            : [];
          if (frameArtifacts.length !== 3) {
            throw new Error(
              `Expected 3 finished-output frames, received ${frameArtifacts.length}.`
            );
          }
          const verifiedFrames = [];
          for (
            let frameIndex = 0;
            frameIndex < frameArtifacts.length;
            frameIndex += 1
          ) {
            const frame = frameArtifacts[frameIndex];
            const expectedFramePath = path.join(
              representativeFrameRequest.outputDirectory,
              `${representativeFrameRequest.baseName}-${frameIndex + 1}.png`
            );
            const expectedFrameOperationId = `${representativeFrameRequest.operationId}-${frameIndex + 1}`;
            const expectedReceiptKind = `verified_output_frame_${frameIndex + 1}`;
            if (
              normalizedPathIdentity(frame?.path) !==
                normalizedPathIdentity(expectedFramePath) ||
              frame?.operation_id !== expectedFrameOperationId ||
              frame?.kind !== expectedReceiptKind
            ) {
              throw new Error(
                `Finished-output frame ${frameIndex + 1} was not bound to its planned path and operation.`
              );
            }
            const fingerprint = await fingerprintRegularFile(frame?.path);
            if (
              fingerprint.sha256 !== frame?.sha256 ||
              fingerprint.bytes !== Number(frame?.bytes)
            ) {
              throw new Error(
                `Finished-output frame changed before verification: ${fingerprint.path}`
              );
            }
            verifiedFrames.push({
              path: fingerprint.path,
              bytes: fingerprint.bytes,
              sha256: fingerprint.sha256,
              operation_id: frame?.operation_id || null,
              receipt_kind: frame?.kind || null,
            });
          }
          inspected = {
            ...inspected,
            representative_frames: {
              ...inspected.representative_frames,
              frames: verifiedFrames.map(frame => frame.path),
              artifacts: verifiedFrames,
            },
          };
        } catch (error) {
          inspected = {
            ...inspected,
            passed: false,
            findings: [
              ...(Array.isArray(inspected?.findings) ? inspected.findings : []),
              {
                severity: 'error',
                code: 'representative_frame_integrity_failed',
                message: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      }
      results.push(inspected);
    }
    return {
      passed:
        results.length === expectedPresets.length &&
        results.every(result => result?.passed === true),
      expected_artifact_count: expectedPresets.length,
      artifact_count: results.filter(result => result?.path).length,
      results,
    };
  }

  recordOutputVerification(jobId, verification, expectedStage = null) {
    return this.mutateJob(
      jobId,
      job => {
        job.output_verification = clone(verification);
        for (const artifact of job.artifacts) {
          const result = verification.results.find(
            candidate =>
              candidate?.path &&
              normalizedPathIdentity(candidate.path) ===
                normalizedPathIdentity(artifact.path)
          );
          if (!result) continue;
          artifact.verification = clone(result);
          artifact.verified = result.passed === true;
          artifact.verified_sha256 = result?.operation_receipt?.sha256 || null;
        }
        for (const result of verification.results) {
          const frameArtifacts = Array.isArray(
            result?.representative_frames?.artifacts
          )
            ? result.representative_frames.artifacts
            : [];
          for (const frame of frameArtifacts) {
            const persisted = {
              path: frame.path,
              kind: 'verified_output_frame',
              stage: 'verify_outputs',
              preset: result.expected_preset || null,
              bytes: frame.bytes,
              sha256: frame.sha256,
              operation_id: frame.operation_id || null,
              receipt_kind: frame.receipt_kind || null,
              verified: result.passed === true,
              verified_sha256: result.passed === true ? frame.sha256 : null,
            };
            const existingIndex = job.artifacts.findIndex(
              candidate =>
                normalizedPathIdentity(candidate.path) ===
                normalizedPathIdentity(frame.path)
            );
            if (existingIndex === -1) job.artifacts.push(persisted);
            else job.artifacts[existingIndex] = persisted;
          }
        }
        return job;
      },
      {
        eventType: 'outputs_verified',
        eventData: { passed: verification.passed },
        ...(expectedStage ? { expectedStage: stageFence(expectedStage) } : {}),
      }
    );
  }

  async verifyOutputs(jobId) {
    const existing = this.activeOutputVerifications.get(jobId);
    if (existing) return existing;
    const verification = this.withJobActivity(jobId, 'verify_outputs', () =>
      this.verifyOutputsOnce(jobId)
    );
    this.activeOutputVerifications.set(jobId, verification);
    try {
      return await verification;
    } finally {
      if (this.activeOutputVerifications.get(jobId) === verification) {
        this.activeOutputVerifications.delete(jobId);
      }
    }
  }

  async verifyOutputsOnce(jobId) {
    const current = this.store.requireJob(jobId);
    const plan = this.store.getPlan(current.plan_hash);
    if ((plan.outputs?.presets || []).length > 0) {
      const renderStage = current.stages.find(
        stage => stage.id === 'render_outputs'
      );
      if (renderStage?.status !== 'completed') {
        throw new Error(
          'Planned outputs can be verified only after render_outputs completes.'
        );
      }
    }
    const verification = await this.inspectJobArtifacts(jobId);
    const stage = current.stages[current.stage_index];
    this.recordOutputVerification(
      jobId,
      verification,
      stage?.id === 'verify_outputs' ? stage : null
    );
    return verification;
  }

  async buildManifest(
    jobId,
    { write = false, projectManifestCompletion = false } = {}
  ) {
    const job = this.store.requireJob(jobId);
    const plan = this.store.getPlan(job.plan_hash);
    const session = this.store.getTranslationSession(jobId);
    await assertPlannedOutputIsolation(plan, [plannedVideoPath(job, plan)]);
    const artifacts = [];
    for (const artifact of job.artifacts) {
      const fingerprint = await fingerprintRegularFile(artifact.path).catch(
        () => null
      );
      const currentSha256 = fingerprint?.sha256 || null;
      const verifiedSha256 = artifact.verified_sha256 || null;
      const verificationIntact =
        artifact.verified === true &&
        typeof verifiedSha256 === 'string' &&
        verifiedSha256.length === 64 &&
        currentSha256 === verifiedSha256;
      artifacts.push({
        ...publicToolData(artifact),
        exists: Boolean(fingerprint),
        bytes: fingerprint?.bytes ?? null,
        sha256: currentSha256,
        verified: verificationIntact,
      });
    }

    const plannedPresets = plan.outputs?.presets || [];
    const invalidRenderedArtifacts = plannedPresets.filter(
      preset =>
        !artifacts.some(
          artifact => artifact.preset === preset && artifact.verified === true
        )
    );
    if (invalidRenderedArtifacts.length > 0) {
      throw new Error(
        `Rendered output integrity changed after verification for: ${invalidRenderedArtifacts.join(', ')}. Run verify_outputs again before creating the manifest.`
      );
    }

    if (session && plan.outputs?.output_directory) {
      const writeSubtitleArtifact = async ({ outputPath, content, kind }) => {
        const expectedSha256 = createHash('sha256')
          .update(content)
          .digest('hex');
        const written = await this.callApp('writeAgentOutputText', {
          mcpJobId: jobId,
          path: outputPath,
          content,
          overwrite: plan.outputs.overwrite,
          protectedPaths: plannedInputPaths(plan, [
            plannedVideoPath(job, plan),
          ]),
        });
        if (
          normalizedPathIdentity(written?.path) !==
            normalizedPathIdentity(outputPath) ||
          written?.sha256 !== expectedSha256 ||
          Number(written?.bytes) !== Buffer.byteLength(content)
        ) {
          throw new Error(
            `Translator returned an invalid output receipt for ${outputPath}.`
          );
        }
        const fingerprint = await fingerprintRegularFile(outputPath);
        if (
          fingerprint.sha256 !== expectedSha256 ||
          fingerprint.bytes !== Buffer.byteLength(content)
        ) {
          throw new Error(
            `Subtitle output changed while its write was being verified: ${outputPath}`
          );
        }
        if (!artifacts.some(artifact => artifact.path === outputPath)) {
          artifacts.push({
            path: outputPath,
            kind,
            exists: true,
            bytes: fingerprint.bytes,
            sha256: fingerprint.sha256,
            verified: true,
            write_result: written,
          });
        }
      };
      const translated = plan.translation?.provider !== 'none';
      if (translated) {
        const sourcePath = path.join(
          plan.outputs.output_directory,
          `${plan.outputs.base_name}-source.srt`
        );
        await writeSubtitleArtifact({
          outputPath: sourcePath,
          content: buildSrt(session.segments, 'source'),
          kind: 'source_transcript_srt',
        });
      }
      const srtMode = translated ? 'translation' : 'source';
      const srt = buildSrt(session.segments, srtMode);
      for (const format of plan.outputs.subtitle_formats || ['srt']) {
        const outputPath = path.join(
          plan.outputs.output_directory,
          `${plan.outputs.base_name}.${format}`
        );
        const content =
          format === 'srt'
            ? srt
            : format === 'vtt'
              ? srtToVtt(srt)
              : buildAss(session.segments, {
                  style:
                    plan.outputs.subtitle_render_spec?.style ||
                    plan.outputs.subtitle_style,
                  fontSize:
                    plan.outputs.subtitle_render_spec?.output_font_size_px ||
                    plan.outputs.subtitle_font_size,
                  mode: srtMode,
                  playResX: plan.outputs.subtitle_render_spec?.display_width_px,
                  playResY:
                    plan.outputs.subtitle_render_spec?.display_height_px,
                });
        await writeSubtitleArtifact({
          outputPath,
          content,
          kind: translated
            ? `translated_subtitles_${format}`
            : `source_subtitles_${format}`,
        });
      }
    }
    const auditStages = publicToolData(clone(job.stages));
    if (projectManifestCompletion) {
      const projected = auditStages[job.stage_index];
      if (projected?.id === 'manifest') {
        projected.status = 'completed';
        projected.percent = 100;
        projected.finished_at = this.now().toISOString();
        projected.error = null;
      }
    }
    const summaryResult = job.stages.find(
      stage => stage.id === 'summary'
    )?.result;
    const originalVideoPath = plannedVideoPath(job, plan);
    const artifactPathsByKind = prefix =>
      artifacts
        .filter(artifact => String(artifact.kind || '').startsWith(prefix))
        .map(artifact => artifact.path);
    const dubbedArtifacts = artifacts.filter(
      artifact => artifact.stage === 'dubbing'
    );
    const manifest = {
      schema_version: MCP_V2_SCHEMA_VERSION,
      job_id: jobId,
      environment: this.environment,
      created_at: job.created_at,
      source: plan.source,
      original_source_url: plan.source.url || null,
      source_metadata: plan.source_metadata,
      project_profile: plan.project_profile,
      profile_revision: plan.profile_revision || 0,
      target_language: plan.target_language,
      artifacts,
      files: {
        original_video: originalVideoPath,
        original_audio:
          artifacts.find(
            artifact =>
              artifact.stage !== 'dubbing' && isAudioArtifact(artifact)
          )?.path || null,
        source_transcript:
          artifacts.find(artifact => artifact.kind === 'source_transcript_srt')
            ?.path || null,
        translated_subtitles: artifactPathsByKind('translated_subtitles_'),
        source_subtitles: artifactPathsByKind('source_subtitles_'),
        rendered_videos: artifacts
          .filter(artifact => artifact.kind === 'video')
          .map(artifact => artifact.path),
        preview_frames: artifacts
          .filter(artifact => artifact.kind === 'preview_frame')
          .map(artifact => artifact.path),
        verified_output_frames: artifacts
          .filter(artifact => artifact.kind === 'verified_output_frame')
          .map(artifact => artifact.path),
        dubbed_video:
          dubbedArtifacts.find(artifact => isVideoArtifact(artifact))?.path ||
          null,
        dubbed_audio:
          dubbedArtifacts.find(artifact => isAudioArtifact(artifact))?.path ||
          null,
      },
      metadata_inputs: {
        source: plan.source_metadata,
        summary: summaryResult?.summary || null,
        sections: Array.isArray(summaryResult?.sections)
          ? summaryResult.sections
          : [],
        highlights: Array.isArray(summaryResult?.highlights)
          ? summaryResult.highlights
          : [],
      },
      validation: job.validation,
      output_verification: publicToolData(job.output_verification || null),
      credit_usage: job.credit_usage,
      audit: {
        plan_hash: job.plan_hash,
        idempotency_key: job.idempotency_key,
        event_cursor_at_manifest_preparation: job.event_cursor,
        stages_at_manifest_preparation: auditStages,
        manifest_completion_projected: projectManifestCompletion,
      },
    };
    return write
      ? this.writeManifest(jobId, manifest)
      : { ...manifest, manifest_path: null };
  }

  async writeManifest(jobId, manifest) {
    const job = this.store.requireJob(jobId);
    const plan = this.store.getPlan(job.plan_hash);
    if (!plan.outputs?.output_directory) {
      return { ...manifest, manifest_path: null };
    }
    for (const artifact of manifest.artifacts || []) {
      if (artifact?.exists !== true) continue;
      const expectedSha256 = String(artifact.sha256 || '');
      if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
        throw new Error(
          `Manifest artifact has no valid integrity hash: ${artifact.path}`
        );
      }
      const fingerprint = await fingerprintRegularFile(artifact.path);
      if (
        fingerprint.sha256 !== expectedSha256 ||
        (artifact.bytes != null && fingerprint.bytes !== Number(artifact.bytes))
      ) {
        throw new Error(
          `Manifest artifact changed before checkpoint publication: ${artifact.path}`
        );
      }
    }
    const manifestPath = path.join(
      plan.outputs.output_directory,
      `${plan.outputs.base_name}-manifest.json`
    );
    const persisted = { ...manifest, manifest_path: manifestPath };
    const content = `${JSON.stringify(persisted, null, 2)}\n`;
    const expectedSha256 = createHash('sha256').update(content).digest('hex');
    const written = await this.callApp('writeAgentOutputText', {
      mcpJobId: jobId,
      path: manifestPath,
      content,
      overwrite: plan.outputs.overwrite,
      protectedPaths: plannedInputPaths(plan, [plannedVideoPath(job, plan)]),
    });
    if (
      normalizedPathIdentity(written?.path) !==
        normalizedPathIdentity(manifestPath) ||
      written?.sha256 !== expectedSha256 ||
      Number(written?.bytes) !== Buffer.byteLength(content)
    ) {
      throw new Error('Translator returned an invalid manifest write receipt.');
    }
    const persistedFile = await readStableBoundedTextFile(manifestPath, {
      maximumBytes: MAX_MANIFEST_BYTES,
      label: 'Persisted manifest',
    });
    let observed;
    try {
      observed = JSON.parse(persistedFile.text);
    } catch {
      throw new Error('Persisted manifest is not valid JSON.');
    }
    if (
      canonicalJson(observed) !== canonicalJson(persisted) ||
      persistedFile.sha256 !== expectedSha256
    ) {
      throw new Error(
        'Persisted manifest content does not match the completed job checkpoint.'
      );
    }
    return persisted;
  }

  async getJobManifest(jobId) {
    const job = this.store.requireJob(jobId);
    if (job.manifest) {
      for (const artifact of job.manifest.artifacts || []) {
        if (artifact?.exists !== true) continue;
        const expectedSha256 = String(artifact.sha256 || '');
        if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
          throw new Error(
            `Stored manifest has no valid integrity hash for: ${artifact.path}`
          );
        }
        const fingerprint = await fingerprintRegularFile(artifact.path).catch(
          () => null
        );
        if (!fingerprint) {
          throw new Error(
            `A completed job artifact is missing or no longer a regular file: ${artifact.path}`
          );
        }
        if (fingerprint.sha256 !== expectedSha256) {
          throw new Error(
            `A completed job artifact changed after manifest creation: ${artifact.path}`
          );
        }
      }
      if (job.manifest.manifest_path) {
        let persistedManifest = null;
        try {
          const persistedFile = await readStableBoundedTextFile(
            job.manifest.manifest_path,
            {
              maximumBytes: MAX_MANIFEST_BYTES,
              label: 'Persisted manifest',
            }
          );
          persistedManifest = JSON.parse(persistedFile.text);
        } catch {
          persistedManifest = null;
        }
        if (
          persistedManifest === null ||
          canonicalJson(persistedManifest) !== canonicalJson(job.manifest)
        ) {
          throw new Error(
            'The persisted manifest file changed after job completion.'
          );
        }
      }
      return clone(job.manifest);
    }
    if (job.status !== 'completed') {
      throw new Error(
        'The final manifest is available after the job completes.'
      );
    }
    return this.buildManifest(jobId, { write: true });
  }

  async prepareYoutubeUpload(args) {
    const manifest = await this.getJobManifest(args.job_id);
    const job = this.store.requireJob(args.job_id);
    const plan = this.store.getPlan(job.plan_hash);
    const currentVerification = await this.inspectJobArtifacts(args.job_id);
    const profile = this.profileForPlan(plan);
    const defaults = profile.publishing?.youtube || {};
    const title = String(args.title || '').trim();
    if (!title) throw new Error('A non-empty YouTube title is required.');
    const video = manifest.artifacts.find(
      artifact =>
        ['youtube_1080p', 'youtube_4k'].includes(artifact.preset) &&
        /\.mp4$/i.test(artifact.path)
    );
    if (!video || video.exists !== true || video.verified !== true) {
      throw new Error(
        'A verified youtube_1080p or youtube_4k artifact is required before preparing a YouTube upload.'
      );
    }
    const currentArtifact = currentVerification.results.find(
      result =>
        result?.path &&
        normalizedPathIdentity(result.path) ===
          normalizedPathIdentity(video.path) &&
        result?.expected_preset === video.preset
    );
    if (!currentVerification.passed || currentArtifact?.passed !== true) {
      throw new Error(
        'Rendered output integrity or compatibility changed after job completion. Re-verify the outputs before preparing an upload.'
      );
    }
    return {
      kind: 'youtube_upload_draft',
      public_action_performed: false,
      account: defaults.account || null,
      channel: defaults.channel || null,
      visibility: args.visibility || defaults.visibility || 'private',
      title,
      description: String(args.description || '').trim(),
      playlist: String(args.playlist || defaults.playlist || '').trim() || null,
      made_for_kids:
        args.made_for_kids === undefined
          ? defaults.made_for_kids === true
          : args.made_for_kids === true,
      attached_file: video.path,
      attached_preset: video.preset,
      ready: true,
      next_action:
        'Use a separate confirmed publishing integration; this MCP does not publish.',
    };
  }

  async prepareXPost(args) {
    const manifest = await this.getJobManifest(args.job_id);
    const job = this.store.requireJob(args.job_id);
    const plan = this.store.getPlan(job.plan_hash);
    const currentVerification = await this.inspectJobArtifacts(args.job_id);
    const profile = this.profileForPlan(plan);
    const defaults = profile.publishing?.x || {};
    const accountTier = plan.outputs?.x_account_tier || 'standard';
    const maximumTextCharacters = accountTier === 'premium' ? 25_000 : 280;
    const postText = String(args.text || '').trim();
    if (!postText) throw new Error('Non-empty X post text is required.');
    const textCharacters = xWeightedTextLength(postText);
    if (textCharacters > maximumTextCharacters) {
      throw new Error(
        `The prepared X post has ${textCharacters} characters, above the selected ${accountTier} account limit of ${maximumTextCharacters}.`
      );
    }
    const video = manifest.artifacts.find(
      artifact =>
        ['x_long_video_720p', 'x_long_video_1080p'].includes(artifact.preset) &&
        /\.mp4$/i.test(artifact.path)
    );
    if (!video || video.exists !== true || video.verified !== true) {
      throw new Error(
        'A verified x_long_video_720p or x_long_video_1080p artifact is required before preparing an X post.'
      );
    }
    const currentArtifact = currentVerification.results.find(
      result =>
        result?.path &&
        normalizedPathIdentity(result.path) ===
          normalizedPathIdentity(video.path) &&
        result?.expected_preset === video.preset
    );
    if (!currentVerification.passed || currentArtifact?.passed !== true) {
      throw new Error(
        'Rendered output integrity or compatibility changed after job completion. Re-verify the outputs before preparing a post.'
      );
    }
    return {
      kind: 'x_post_draft',
      public_action_performed: false,
      account: defaults.account || null,
      account_tier: accountTier,
      maximum_text_characters: maximumTextCharacters,
      weighted_text_characters: textCharacters,
      text_character_count_method: 'x_weighted_unicode_v3_with_tco_urls',
      text: postText,
      attached_file: video.path,
      attached_preset: video.preset,
      ready: true,
      next_action:
        'Use a separate confirmed publishing integration; this MCP does not publish.',
    };
  }
}

export function legacyResultContext(environment, context, toolName, billing) {
  return {
    environment,
    server: {
      name: MCP_SERVER_NAMES[environment],
      version: MCP_SERVER_VERSION,
      protocol_version: MCP_V2_PROTOCOL_VERSION,
    },
    app: {
      connected: context?.connected ?? null,
      version: context?.version ?? null,
    },
    stage5: context?.stage5 || { account: null, credits: null },
    billing: billing || getMcpToolBilling(toolName, {}, context),
  };
}

export function legacyToolBilling(toolName, args = {}, context = null) {
  const noCreditTools = new Set([
    'create_translation_session',
    'get_translation_batch',
    'submit_translation_batch',
    'translation_session_status',
    'export_translation_srt',
    'app_launch',
    'app_status',
    'app_navigation_list',
    'app_navigate',
    'app_open_web_page',
    'app_open_credit_checkout',
    'app_settings_show',
    'app_settings_get',
    'app_settings_update',
    'app_settings_store_provider_key',
    'app_settings_clear_provider_key',
    'app_open_video',
    'app_mount_subtitles',
    'app_set_subtitle_display',
    'app_set_subtitle_style',
    'app_show_download_history',
    'app_downloads_list',
    'app_downloads_open',
    'app_downloads_redownload',
    'app_video_search_status',
    'app_video_search_cancel',
    'app_video_batch_download',
    'app_video_batch_cancel',
    'app_video_batch_status',
    'app_start_video_download',
    'app_start_merge',
    'app_processing_status',
    'app_processing_cancel',
    'app_subtitles_get',
    'app_subtitles_update',
    'app_subtitles_mutate',
    'app_subtitles_export',
  ]);
  if (noCreditTools.has(toolName)) {
    return {
      may_consume_stage5_credits: false,
      will_consume_stage5_credits: false,
      reason:
        'This legacy tool does not perform Stage5 inference or a purchase.',
    };
  }
  if (
    toolName === 'app_start_media_workflow' &&
    (args?.run_to || args?.runTo) === 'download'
  ) {
    return {
      may_consume_stage5_credits: false,
      will_consume_stage5_credits: false,
      reason: 'The requested legacy media workflow stops after download.',
    };
  }
  let providerKey = 'translation';
  if (
    toolName === 'app_start_transcription' ||
    toolName === 'app_start_cue_transcription'
  ) {
    providerKey = 'transcription';
  } else if (toolName === 'app_start_dubbing') {
    providerKey = 'dubbing';
  } else if (toolName === 'app_start_summary') {
    providerKey = 'summary';
  } else if (
    toolName === 'app_video_search' ||
    toolName === 'app_video_search_more'
  ) {
    providerKey = 'video_suggestions';
  } else if (toolName === 'app_start_media_workflow') {
    const runTo = args?.run_to || args?.runTo || 'transcribe';
    providerKey =
      runTo === 'dub'
        ? 'dubbing'
        : runTo === 'summary'
          ? 'summary'
          : runTo === 'translate'
            ? 'translation'
            : 'transcription';
  }
  const provider = context?.providers?.[providerKey] || null;
  const kind = provider?.kind || null;
  return {
    may_consume_stage5_credits: true,
    will_consume_stage5_credits:
      kind === 'stage5' ? true : kind === 'byo' ? false : null,
    provider,
    reason:
      kind === 'stage5'
        ? `The active ${providerKey} route uses Stage5 credits.`
        : kind === 'byo'
          ? `The active ${providerKey} route uses the user's BYO provider and no Stage5 credits.`
          : 'The active provider could not be determined; inspect get_server_info before starting inference.',
  };
}

export function legacyToolDescription(toolName, description = '') {
  if (!legacyToolBilling(toolName).may_consume_stage5_credits) {
    return description;
  }
  return [
    'LEGACY LOW-LEVEL PAID-INFERENCE TOOL: this call is not protected by MCP v2 planning, durable job recovery, or an idempotency key. Do not retry an uncertain delivery; prefer plan_job/create_job whenever that workflow applies.',
    description,
  ]
    .filter(Boolean)
    .join(' ');
}
