import {
  BASELINE_HEIGHT,
  MAX_FONT_SCALE,
  MIN_SUBTITLE_FONT_SIZE,
  fontScale,
} from '../constants/runtime-config.js';
import {
  SUBTITLE_STYLE_PRESETS,
  type SubtitleStylePresetKey,
} from '../constants/subtitle-styles.js';

export const SUBTITLE_RENDER_SPEC_VERSION = 1 as const;
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
};

export type SubtitleRenderSelectionField =
  | 'display_mode'
  | 'style'
  | 'base_font_size_px';

export type ResolvedSubtitleRenderSpec = SubtitleRenderSelection & {
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

export function resolveSubtitleRenderSpec({
  displayMode,
  stylePreset,
  baseFontSizePx,
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

  const height = finitePositive(videoHeightPx, BASELINE_HEIGHT);
  const width = finitePositive(videoWidthPx, Math.round((height * 16) / 9));
  const resolvedDisplayHeight = finitePositive(displayHeightPx, height);
  const resolvedDisplayWidth = finitePositive(displayWidthPx, width);
  const base = normalizeSubtitleBaseFontSize(baseFontSizePx);

  return {
    schemaVersion: SUBTITLE_RENDER_SPEC_VERSION,
    displayMode,
    stylePreset,
    baseFontSizePx: base,
    outputFontSizePx: resolveSubtitleOutputFontSize({
      baseFontSizePx: base,
      videoHeightPx: height,
      isAudioOnly,
    }),
    videoWidthPx: width,
    videoHeightPx: height,
    displayWidthPx: resolvedDisplayWidth,
    displayHeightPx: resolvedDisplayHeight,
    isAudioOnly,
    fontFamily: SUBTITLE_FONT_FAMILY,
    fontAsset: SUBTITLE_FONT_ASSET,
    scaleRule: 'height_ratio_720_clamped_0.5_2',
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
  };

  return (Object.keys(expected) as SubtitleRenderSelectionField[]).filter(
    field =>
      sources[field] === 'translator_preview' &&
      plannedSpec[field] !== expected[field]
  );
}
