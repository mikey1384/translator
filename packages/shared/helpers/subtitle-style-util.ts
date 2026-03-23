import { css } from '@emotion/css';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../constants/subtitle-styles.js';
import {
  BASELINE_FONT_SIZE,
  MIN_SUBTITLE_FONT_SIZE,
} from '../constants/index.js';

const DEFAULT_FONT_STACK = [
  'Noto Sans',
  'Inter',
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'PingFang SC',
  'Microsoft YaHei',
  'Noto Sans SC',
  'sans-serif',
].join(', ');

const SHORT_FORM_FONT_STACK = [
  "'Pretendard Variable'",
  "'Pretendard'",
  "'SUIT Variable'",
  "'SUIT'",
  "'Apple SD Gothic Neo'",
  "'Malgun Gothic'",
  "'Noto Sans KR'",
  "'Noto Sans'",
  "'Inter'",
  '-apple-system',
  'BlinkMacSystemFont',
  "'Segoe UI'",
  "'Roboto'",
  "'PingFang SC'",
  "'Microsoft YaHei'",
  "'Noto Sans SC'",
  'sans-serif',
].join(', ');

type ShortFormTuning = {
  backgroundColor?: string;
  borderRadiusPx: number;
  bottomMultiLine: string;
  bottomSingleLine: string;
  boxShadow?: string;
  containerPadding: string;
  fontScale: number;
  fontWeight: number;
  horizontalInset: string;
  letterSpacing: string;
  lineBoxBackgroundColor?: string;
  lineBoxBorderRadiusPx: number;
  lineBoxBoxShadow: string;
  lineBoxPadding: string;
  lineHeight: number;
  maxWidth: string;
  outlineMultiplier: number;
  softShadowBlurPx: number;
  softShadowColor: string;
  softShadowOffsetYPx: number;
};

export type SubtitleRenderTheme = {
  backgroundColor: string;
  borderRadiusPx: number;
  bottom: string;
  boxShadow: string;
  containerPadding: string;
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number | string;
  horizontalInset: string;
  isShortFormPortrait: boolean;
  letterSpacing: string;
  lineBoxBackgroundColor: string;
  lineBoxBorderRadiusPx: number;
  lineBoxBoxShadow: string;
  lineBoxPadding: string;
  lineHeight: number;
  margin: string;
  maxWidth: string;
  textShadow: string;
  textStrokeColor: string;
  textStrokeWidthPx: number;
  width: string;
};

const SHORT_FORM_TUNING: Record<SubtitleStylePresetKey, ShortFormTuning> = {
  Default: {
    borderRadiusPx: 10,
    bottomMultiLine: '29.5%',
    bottomSingleLine: '23.5%',
    containerPadding: '10px 22px',
    fontScale: 1.08,
    fontWeight: 800,
    horizontalInset: '5.5%',
    letterSpacing: '0',
    lineBoxBorderRadiusPx: 0,
    lineBoxBoxShadow: 'none',
    lineBoxPadding: '1px 6px',
    lineHeight: 1.22,
    maxWidth: '89%',
    outlineMultiplier: 2.05,
    softShadowBlurPx: 18,
    softShadowColor: 'rgba(0, 0, 0, 0.62)',
    softShadowOffsetYPx: 6,
  },
  Classic: {
    borderRadiusPx: 10,
    bottomMultiLine: '29.5%',
    bottomSingleLine: '23.5%',
    containerPadding: '10px 22px',
    fontScale: 1.08,
    fontWeight: 900,
    horizontalInset: '5.5%',
    letterSpacing: '-0.01em',
    lineBoxBorderRadiusPx: 0,
    lineBoxBoxShadow: 'none',
    lineBoxPadding: '1px 6px',
    lineHeight: 1.2,
    maxWidth: '89%',
    outlineMultiplier: 2.25,
    softShadowBlurPx: 20,
    softShadowColor: 'rgba(0, 0, 0, 0.68)',
    softShadowOffsetYPx: 7,
  },
  Boxed: {
    backgroundColor: 'rgba(8, 8, 10, 0.72)',
    borderRadiusPx: 18,
    bottomMultiLine: '30.5%',
    bottomSingleLine: '24.5%',
    boxShadow: '0 16px 32px rgba(0, 0, 0, 0.28)',
    containerPadding: '12px 22px',
    fontScale: 1.06,
    fontWeight: 800,
    horizontalInset: '7%',
    letterSpacing: '0',
    lineBoxBorderRadiusPx: 0,
    lineBoxBoxShadow: 'none',
    lineBoxPadding: '1px 6px',
    lineHeight: 1.18,
    maxWidth: '86%',
    outlineMultiplier: 1.4,
    softShadowBlurPx: 14,
    softShadowColor: 'rgba(0, 0, 0, 0.22)',
    softShadowOffsetYPx: 4,
  },
  LineBox: {
    borderRadiusPx: 0,
    bottomMultiLine: '31%',
    bottomSingleLine: '25%',
    containerPadding: '0 14px 12px 14px',
    fontScale: 1.06,
    fontWeight: 800,
    horizontalInset: '6%',
    letterSpacing: '0',
    lineBoxBackgroundColor: 'rgba(10, 10, 12, 0.82)',
    lineBoxBorderRadiusPx: 14,
    lineBoxBoxShadow: '0 10px 24px rgba(0, 0, 0, 0.24)',
    lineBoxPadding: '4px 12px 5px 12px',
    lineHeight: 1.24,
    maxWidth: '88%',
    outlineMultiplier: 1,
    softShadowBlurPx: 8,
    softShadowColor: 'rgba(0, 0, 0, 0.28)',
    softShadowOffsetYPx: 2,
  },
};

export function assColorToRgba(ass: string): string {
  if (!ass?.startsWith('&H')) return 'rgba(255,255,255,1)';
  const hex = ass.substring(2).padStart(8, '0');
  const a = 255 - parseInt(hex.slice(0, 2), 16);
  const b = parseInt(hex.slice(2, 4), 16);
  const g = parseInt(hex.slice(4, 6), 16);
  const r = parseInt(hex.slice(6, 8), 16);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}

export function isShortFormPortraitCanvas(
  videoWidthPx?: number,
  videoHeightPx?: number
): boolean {
  const SHORTS_RATIO_CUTOFF = 0.68; // ~9:16 portrait or taller
  const canvasWidth =
    videoWidthPx ??
    (typeof window !== 'undefined'
      ? window.innerWidth || undefined
      : undefined);
  const canvasHeight =
    videoHeightPx ??
    (typeof window !== 'undefined'
      ? window.innerHeight || undefined
      : undefined);

  return (
    !!canvasWidth &&
    !!canvasHeight &&
    canvasWidth < canvasHeight &&
    canvasWidth / canvasHeight <= SHORTS_RATIO_CUTOFF
  );
}

function buildSoftShadow(
  softShadowColor?: string,
  softShadowOffsetYPx?: number,
  softShadowBlurPx?: number
): string {
  if (
    !softShadowColor ||
    typeof softShadowOffsetYPx !== 'number' ||
    typeof softShadowBlurPx !== 'number'
  ) {
    return 'none';
  }

  return `0 ${softShadowOffsetYPx}px ${softShadowBlurPx}px ${softShadowColor}`;
}

export function resolveSubtitleRenderTheme(opts: {
  displayFontSize?: number;
  isFullScreen?: boolean;
  stylePreset: SubtitleStylePresetKey;
  isMultiLine: boolean;
  videoWidthPx?: number;
  videoHeightPx?: number;
}): SubtitleRenderTheme {
  const {
    displayFontSize = BASELINE_FONT_SIZE,
    isFullScreen = false,
    stylePreset = 'Default',
    isMultiLine,
    videoWidthPx,
    videoHeightPx,
  } = opts;

  const style =
    SUBTITLE_STYLE_PRESETS[stylePreset] || SUBTITLE_STYLE_PRESETS.Default;

  const isShortFormPortrait = isShortFormPortraitCanvas(
    videoWidthPx,
    videoHeightPx
  );
  const shortFormTuning = isShortFormPortrait
    ? SHORT_FORM_TUNING[stylePreset]
    : null;
  const finalFontSize = Math.max(
    MIN_SUBTITLE_FONT_SIZE,
    displayFontSize * (shortFormTuning?.fontScale ?? 1)
  );

  const outlineRgba = assColorToRgba(style.outlineColor);
  const shadowRgba = assColorToRgba(style.backColor);

  let bottomValue: string;
  if (isShortFormPortrait) {
    bottomValue = isMultiLine
      ? shortFormTuning?.bottomMultiLine || '30%'
      : shortFormTuning?.bottomSingleLine || '24%';
  } else if (isMultiLine) {
    bottomValue = isFullScreen ? '5%' : '2.5%';
  } else {
    bottomValue = isFullScreen ? '10%' : '5%';
  }

  let textShadow = 'none';
  let textStrokeColor = 'transparent';
  let textStrokeWidthPx = 0;
  let backgroundColor = 'transparent';
  let boxShadowValue = 'none';
  let containerPadding = shortFormTuning?.containerPadding || '10px 20px';

  if (stylePreset === 'LineBox') {
    backgroundColor = 'transparent';
    boxShadowValue = 'none';
    containerPadding = shortFormTuning?.containerPadding || '0 12px 10px 12px';
    textShadow = isShortFormPortrait
      ? `0 ${shortFormTuning?.softShadowOffsetYPx || 2}px ${
          shortFormTuning?.softShadowBlurPx || 8
        }px ${shortFormTuning?.softShadowColor || 'rgba(0, 0, 0, 0.28)'}`
      : 'none';
  } else if (style.borderStyle === 1) {
    backgroundColor = 'transparent';
    boxShadowValue = 'none';
    const outlineSize = Math.max(
      0.1,
      style.outlineSize * (shortFormTuning?.outlineMultiplier ?? 1)
    );
    textStrokeColor = outlineRgba;
    textStrokeWidthPx = outlineSize;
    textShadow = buildSoftShadow(
      shortFormTuning?.softShadowColor || shadowRgba,
      shortFormTuning?.softShadowOffsetYPx ?? Math.max(1, style.shadowDepth),
      shortFormTuning?.softShadowBlurPx ??
        Math.max(2, Math.round(style.shadowDepth * 3))
    );
  } else if (style.borderStyle === 3 || style.borderStyle === 4) {
    backgroundColor = shortFormTuning?.backgroundColor || shadowRgba;
    boxShadowValue =
      shortFormTuning?.boxShadow || '0 4px 16px rgba(0, 0, 0, 0.4)';
    if (style.borderStyle === 4 && style.outlineSize > 0) {
      const outlineSize = style.outlineSize * (shortFormTuning?.outlineMultiplier ?? 1);
      textStrokeColor = outlineRgba;
      textStrokeWidthPx = outlineSize;
      textShadow = buildSoftShadow(
        shortFormTuning?.softShadowColor || shadowRgba,
        shortFormTuning?.softShadowOffsetYPx ?? Math.max(1, style.shadowDepth),
        shortFormTuning?.softShadowBlurPx ??
          Math.max(2, Math.round(style.shadowDepth * 3))
      );
    }
  }

  const horizontalInset = isShortFormPortrait
    ? shortFormTuning?.horizontalInset || '5.5%'
    : isFullScreen
      ? '5%'
      : '0';
  const width = isShortFormPortrait || isFullScreen ? 'auto' : '100%';
  const maxWidth = isShortFormPortrait
    ? shortFormTuning?.maxWidth || '89%'
    : '100%';
  const margin = isShortFormPortrait || isFullScreen ? '0 auto' : '0';

  return {
    backgroundColor,
    borderRadiusPx: shortFormTuning?.borderRadiusPx ?? 5,
    bottom: bottomValue,
    boxShadow: boxShadowValue,
    containerPadding,
    fontFamily: isShortFormPortrait
      ? SHORT_FORM_FONT_STACK
      : DEFAULT_FONT_STACK,
    fontSizePx: finalFontSize,
    fontWeight: shortFormTuning?.fontWeight ?? (style.isBold ? 700 : 500),
    horizontalInset,
    isShortFormPortrait,
    letterSpacing: shortFormTuning?.letterSpacing ?? '0.01em',
    lineBoxBackgroundColor:
      shortFormTuning?.lineBoxBackgroundColor || shadowRgba,
    lineBoxBorderRadiusPx: shortFormTuning?.lineBoxBorderRadiusPx ?? 0,
    lineBoxBoxShadow: shortFormTuning?.lineBoxBoxShadow ?? 'none',
    lineBoxPadding: shortFormTuning?.lineBoxPadding ?? '1px 6px',
    lineHeight: shortFormTuning?.lineHeight ?? 1.35,
    margin,
    maxWidth,
    textShadow,
    textStrokeColor,
    textStrokeWidthPx,
    width,
  };
}

export function getSubtitleStyles(opts: {
  displayFontSize?: number;
  isFullScreen?: boolean;
  stylePreset: SubtitleStylePresetKey;
  isMultiLine: boolean;
  videoWidthPx?: number;
  videoHeightPx?: number;
}): string {
  const {
    isFullScreen = false,
    stylePreset = 'Default',
  } = opts;
  const style =
    SUBTITLE_STYLE_PRESETS[stylePreset] || SUBTITLE_STYLE_PRESETS.Default;
  const textColor = assColorToRgba(style.primaryColor);
  const theme = resolveSubtitleRenderTheme(opts);

  let transitionValue = `
    opacity 0.2s ease-in-out,
    font-size 0.1s linear,
    color 0.2s linear,
    text-shadow 0.2s linear,
    background-color 0.2s linear,
    box-shadow 0.2s linear,
    left 0.3s ease-out,
    max-width 0.3s ease-out
  `;

  if (stylePreset === 'LineBox') {
    transitionValue = `
      font-size 0.1s linear,
      color 0.2s linear,
      text-shadow 0.2s linear,
      background-color 0.2s linear,
      box-shadow 0.2s linear,
      left 0.3s ease-out,
      max-width 0.3s ease-out
    `;
  }

  return css`
    box-sizing: border-box;
    position: ${isFullScreen ? 'fixed' : 'absolute'};
    bottom: ${theme.bottom};
    left: ${theme.horizontalInset};
    right: ${theme.horizontalInset};
    padding: ${theme.containerPadding};
    background-color: ${theme.backgroundColor};
    color: ${textColor};
    font-family: ${theme.fontFamily};
    font-size: ${theme.fontSizePx}px;
    font-weight: ${theme.fontWeight};
    text-shadow: ${theme.textShadow};
    -webkit-text-stroke: ${theme.textStrokeWidthPx}px ${theme.textStrokeColor};
    paint-order: stroke fill;
    text-align: center;
    border-radius: ${theme.borderRadiusPx}px;
    opacity: 0;
    transition: ${transitionValue};
    max-width: ${theme.maxWidth};
    width: ${theme.width};
    /* Prevent long, unbroken words from overflowing and getting clipped */
    overflow-wrap: anywhere;
    word-break: break-word;
    pointer-events: none;
    white-space: pre-wrap;
    z-index: 1000;
    margin: ${theme.margin};
    text-rendering: geometricPrecision;
    -webkit-font-smoothing: antialiased;

    &.visible {
      opacity: 1;
    }

    line-height: ${theme.lineHeight};
    letter-spacing: ${theme.letterSpacing};
    user-select: none;
    box-shadow: ${theme.boxShadow};
    border: none;
  `;
}

export type SubtitleStyleOpts = Parameters<typeof getSubtitleStyles>[0];
