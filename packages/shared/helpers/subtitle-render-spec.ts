import {
  BASELINE_HEIGHT,
  MAX_FONT_SCALE,
  MIN_SUBTITLE_FONT_SIZE,
  fontScale,
} from '../constants/runtime-config.js';
import {
  DEFAULT_SUBTITLE_TYPEFACE,
  SUBTITLE_STYLE_PRESETS,
  isSubtitleTypeface,
  type SubtitleStylePresetKey,
  type SubtitleTypeface,
} from '../constants/subtitle-styles.js';

export const SUBTITLE_RENDER_SPEC_VERSION = 1 as const;
export const SUBTITLE_RENDER_SELECTION_BINDING_VERSION = 1 as const;
export const SUBTITLE_FONT_FAMILY = 'Noto Sans' as const;
export const SUBTITLE_FONT_ASSET = 'NotoSans-Regular.ttf' as const;
export const MAX_SUBTITLE_BASE_FONT_SIZE = 96;
export const MAX_SUBTITLE_OUTPUT_FONT_SIZE =
  MAX_SUBTITLE_BASE_FONT_SIZE * MAX_FONT_SCALE;

export type SubtitleRenderDisplayMode = 'original' | 'translation' | 'dual';

export type SubtitleRenderSelection = {
  displayMode: SubtitleRenderDisplayMode;
  stylePreset: SubtitleStylePresetKey;
  baseFontSizePx: number;
  /** Omitted means the default face, so older specs stay valid. */
  typeface?: SubtitleTypeface;
};

export type SubtitleRenderSelectionField =
  | 'display_mode'
  | 'style'
  | 'base_font_size_px'
  | 'typeface';

export type ResolvedSubtitleRenderSpec = SubtitleRenderSelection & {
  typeface: SubtitleTypeface;
  schemaVersion: typeof SUBTITLE_RENDER_SPEC_VERSION;
  outputFontSizePx: number;
  videoWidthPx: number;
  videoHeightPx: number;
  displayWidthPx: number;
  displayHeightPx: number;
  isAudioOnly: boolean;
  fontFamily: typeof SUBTITLE_FONT_FAMILY;
  fontAsset: typeof SUBTITLE_FONT_ASSET;
  scaleRule: 'height_ratio_720_clamped_0.5_2';
};

const DISPLAY_MODES = new Set<SubtitleRenderDisplayMode>([
  'original',
  'translation',
  'dual',
]);

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

export function normalizeSubtitleBaseFontSize(value: number): number {
  const finite = Number.isFinite(value)
    ? Number(value)
    : MIN_SUBTITLE_FONT_SIZE;
  return Math.max(
    MIN_SUBTITLE_FONT_SIZE,
    Math.min(MAX_SUBTITLE_BASE_FONT_SIZE, finite)
  );
}

export function resolveSubtitleOutputFontSize({
  baseFontSizePx,
  videoHeightPx,
  isAudioOnly = false,
}: {
  baseFontSizePx: number;
  videoHeightPx?: number;
  isAudioOnly?: boolean;
}): number {
  const base = normalizeSubtitleBaseFontSize(baseFontSizePx);
  if (isAudioOnly) return Math.round(base);
  const height = finitePositive(videoHeightPx, BASELINE_HEIGHT);
  return Math.max(MIN_SUBTITLE_FONT_SIZE, Math.round(base * fontScale(height)));
}

/**
 * The frame subtitles are laid out on, and their font size there. The export
 * draws on this frame, and the player lays its overlay out on the same frame
 * and scales it to the picture. Without a frame size (an audio-only file),
 * both use 1280x720.
 */
export function resolveSubtitleRenderFrame({
  baseFontSizePx,
  videoWidthPx,
  videoHeightPx,
  displayWidthPx,
  displayHeightPx,
  isAudioOnly = false,
}: {
  baseFontSizePx: number;
  videoWidthPx?: number | null;
  videoHeightPx?: number | null;
  displayWidthPx?: number | null;
  displayHeightPx?: number | null;
  isAudioOnly?: boolean;
}): {
  videoWidthPx: number;
  videoHeightPx: number;
  displayWidthPx: number;
  displayHeightPx: number;
  fontSizePx: number;
} {
  const height = finitePositive(videoHeightPx ?? undefined, BASELINE_HEIGHT);
  const width = finitePositive(
    videoWidthPx ?? undefined,
    Math.round((height * 16) / 9)
  );
  return {
    videoWidthPx: width,
    videoHeightPx: height,
    displayWidthPx: finitePositive(displayWidthPx ?? undefined, width),
    displayHeightPx: finitePositive(displayHeightPx ?? undefined, height),
    fontSizePx: resolveSubtitleOutputFontSize({
      baseFontSizePx,
      videoHeightPx: height,
      isAudioOnly,
    }),
  };
}

export function resolveSubtitleRenderSpec({
  displayMode,
  stylePreset,
  baseFontSizePx,
  typeface = DEFAULT_SUBTITLE_TYPEFACE,
  videoWidthPx,
  videoHeightPx,
  displayWidthPx,
  displayHeightPx,
  isAudioOnly = false,
}: SubtitleRenderSelection & {
  videoWidthPx?: number;
  videoHeightPx?: number;
  displayWidthPx?: number;
  displayHeightPx?: number;
  isAudioOnly?: boolean;
}): ResolvedSubtitleRenderSpec {
  if (!DISPLAY_MODES.has(displayMode)) {
    throw new Error(`Unsupported subtitle display mode: ${displayMode}`);
  }
  if (!Object.hasOwn(SUBTITLE_STYLE_PRESETS, stylePreset)) {
    throw new Error(`Unsupported subtitle style preset: ${stylePreset}`);
  }
  if (!isSubtitleTypeface(typeface)) {
    throw new Error(`Unsupported subtitle typeface: ${typeface}`);
  }

  const frame = resolveSubtitleRenderFrame({
    baseFontSizePx,
    videoWidthPx,
    videoHeightPx,
    displayWidthPx,
    displayHeightPx,
    isAudioOnly,
  });

  return {
    schemaVersion: SUBTITLE_RENDER_SPEC_VERSION,
    displayMode,
    stylePreset,
    typeface,
    baseFontSizePx: normalizeSubtitleBaseFontSize(baseFontSizePx),
    outputFontSizePx: frame.fontSizePx,
    videoWidthPx: frame.videoWidthPx,
    videoHeightPx: frame.videoHeightPx,
    displayWidthPx: frame.displayWidthPx,
    displayHeightPx: frame.displayHeightPx,
    isAudioOnly,
    fontFamily: SUBTITLE_FONT_FAMILY,
    fontAsset: SUBTITLE_FONT_ASSET,
    scaleRule: 'height_ratio_720_clamped_0.5_2',
  };
}

/**
 * The render request's geometry, taken from the spec itself so the two can
 * never disagree (e.g. an audio-only file with no frame size).
 */
export function subtitleRenderGeometry(spec: ResolvedSubtitleRenderSpec): {
  videoWidth: number;
  videoHeight: number;
  displayWidth: number;
  displayHeight: number;
  fontSizePx: number;
  stylePreset: SubtitleStylePresetKey;
  outputMode: SubtitleRenderDisplayMode;
  overlayMode: 'overlayOnVideo' | 'blackVideo';
} {
  return {
    videoWidth: spec.videoWidthPx,
    videoHeight: spec.videoHeightPx,
    displayWidth: spec.displayWidthPx,
    displayHeight: spec.displayHeightPx,
    fontSizePx: spec.outputFontSizePx,
    stylePreset: spec.stylePreset,
    outputMode: spec.displayMode,
    overlayMode: spec.isAudioOnly ? 'blackVideo' : 'overlayOnVideo',
  };
}

export function serializeSubtitleRenderSpec(
  spec: ResolvedSubtitleRenderSpec
): Record<string, unknown> {
  return {
    schema_version: spec.schemaVersion,
    display_mode: spec.displayMode,
    style: spec.stylePreset,
    base_font_size_px: spec.baseFontSizePx,
    output_font_size_px: spec.outputFontSizePx,
    video_width_px: spec.videoWidthPx,
    video_height_px: spec.videoHeightPx,
    display_width_px: spec.displayWidthPx,
    display_height_px: spec.displayHeightPx,
    audio_only: spec.isAudioOnly,
    font_family: spec.fontFamily,
    font_asset: spec.fontAsset,
    scale_rule: spec.scaleRule,
    ...(spec.typeface !== DEFAULT_SUBTITLE_TYPEFACE
      ? { typeface: spec.typeface }
      : {}),
  };
}

export function parseSubtitleRenderSpec(
  value: Record<string, unknown>
): ResolvedSubtitleRenderSpec {
  if (value.schema_version !== SUBTITLE_RENDER_SPEC_VERSION) {
    throw new Error('Unsupported subtitle render spec version.');
  }
  if (typeof value.audio_only !== 'boolean') {
    throw new Error('Subtitle render spec is missing its audio-only flag.');
  }
  const requiredNumber = (field: string): number => {
    const raw = value[field];
    const parsed = Number(raw);
    if (raw === null || raw === '' || !Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Subtitle render spec has an invalid ${field}.`);
    }
    return parsed;
  };
  const spec = resolveSubtitleRenderSpec({
    displayMode: value.display_mode as SubtitleRenderDisplayMode,
    stylePreset: value.style as SubtitleStylePresetKey,
    typeface: (value.typeface ?? DEFAULT_SUBTITLE_TYPEFACE) as SubtitleTypeface,
    baseFontSizePx: requiredNumber('base_font_size_px'),
    videoWidthPx: requiredNumber('video_width_px'),
    videoHeightPx: requiredNumber('video_height_px'),
    displayWidthPx: requiredNumber('display_width_px'),
    displayHeightPx: requiredNumber('display_height_px'),
    isAudioOnly: value.audio_only,
  });
  const canonical = serializeSubtitleRenderSpec(spec);
  for (const [field, expected] of Object.entries(canonical)) {
    if (value[field] !== expected) {
      throw new Error(
        `Subtitle render spec ${field} does not match its canonical value.`
      );
    }
  }
  return spec;
}

export function findSubtitlePreviewSelectionDrift(
  plannedSpec: Record<string, unknown>,
  current: SubtitleRenderSelection
): SubtitleRenderSelectionField[] {
  const sources =
    plannedSpec.field_sources &&
    typeof plannedSpec.field_sources === 'object' &&
    !Array.isArray(plannedSpec.field_sources)
      ? (plannedSpec.field_sources as Record<string, unknown>)
      : {};
  const expected: Record<SubtitleRenderSelectionField, string | number> = {
    display_mode: current.displayMode,
    style: current.stylePreset,
    base_font_size_px: normalizeSubtitleBaseFontSize(current.baseFontSizePx),
    typeface: current.typeface ?? DEFAULT_SUBTITLE_TYPEFACE,
  };
  // A planned spec omits the default face.
  const planned = (field: SubtitleRenderSelectionField) =>
    field === 'typeface'
      ? (plannedSpec.typeface ?? DEFAULT_SUBTITLE_TYPEFACE)
      : plannedSpec[field];
  const hasCurrentSelectionBinding =
    plannedSpec.selection_binding_version ===
    SUBTITLE_RENDER_SELECTION_BINDING_VERSION;

  return (Object.keys(expected) as SubtitleRenderSelectionField[]).filter(
    field =>
      (!hasCurrentSelectionBinding ||
        sources[field] === 'translator_preview') &&
      planned(field) !== expected[field]
  );
}
