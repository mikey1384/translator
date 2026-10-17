import { css } from '@emotion/css';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
  subtitleStyleUsesLineBox,
  DEFAULT_SUBTITLE_TYPEFACE,
  isSubtitleTypeface,
  type SubtitleTypeface,
} from '../constants/subtitle-styles.js';
import {
  BASELINE_FONT_SIZE,
  MIN_SUBTITLE_FONT_SIZE,
} from '../constants/index.js';

// Landscape burns lead with the bundled Pretendard so Korean never falls back
// to whatever the host system happens to have. Noto Sans stays in the stack
// for scripts Pretendard does not cover.
const LANDSCAPE_FONT_STACK = [
  "'Pretendard Variable'",
  "'Pretendard'",
  "'Noto Sans'",
  "'Inter'",
  '-apple-system',
  'BlinkMacSystemFont',
  "'Segoe UI'",
  "'Roboto'",
  "'Apple SD Gothic Neo'",
  "'Malgun Gothic'",
  "'Noto Sans KR'",
  "'PingFang SC'",
  "'Microsoft YaHei'",
  "'Noto Sans SC'",
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

// Script fallbacks after a typeface's Latin face: Korean, Japanese, Chinese,
// then the system's own font for everything else (Arabic, Devanagari, Thai…).
const SANS_SCRIPT_FALLBACKS = [
  "'Pretendard Variable'",
  "'Apple SD Gothic Neo'",
  "'Malgun Gothic'",
  "'Hiragino Sans'",
  "'Yu Gothic'",
  "'PingFang SC'",
  "'Microsoft YaHei'",
  "'Noto Sans'",
  'sans-serif',
];

const TYPEFACE_FONT_STACKS: Record<
  Exclude<SubtitleTypeface, 'sans'>,
  string
> = {
  // The familiar broadcast subtitle face.
  classic: [
    "'Helvetica Neue'",
    'Helvetica',
    'Arial',
    ...SANS_SCRIPT_FALLBACKS,
  ].join(', '),
  serif: [
    'Georgia',
    "'Times New Roman'",
    "'AppleMyungjo'",
    "'Nanum Myeongjo'",
    "'Batang'",
    "'Hiragino Mincho ProN'",
    "'Yu Mincho'",
    "'Songti SC'",
    "'SimSun'",
    "'Noto Serif'",
    'serif',
  ].join(', '),
  // Bundled, so it looks the same on every machine.
  display: ["'Bricolage Grotesque'", ...SANS_SCRIPT_FALLBACKS].join(', '),
};

export function subtitleTypefaceFontStack(
  typeface: SubtitleTypeface,
  isShortFormPortrait = false
): string {
  if (typeface !== 'sans') return TYPEFACE_FONT_STACKS[typeface];
  return isShortFormPortrait ? SHORT_FORM_FONT_STACK : LANDSCAPE_FONT_STACK;
}

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

export type SubtitleLineBoxStyle = {
  backgroundColor: string;
  borderRadius: string;
  boxDecorationBreak: 'clone';
  boxShadow: string;
  display: 'inline';
  lineHeight: string;
  overflowWrap: 'anywhere';
  padding: string;
  WebkitBoxDecorationBreak: 'clone';
  whiteSpace: 'pre-wrap';
  wordBreak: 'break-word' | 'keep-all';
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
  Cinema: {
    borderRadiusPx: 10,
    bottomMultiLine: '29.5%',
    bottomSingleLine: '23.5%',
    containerPadding: '10px 22px',
    fontScale: 1.08,
    fontWeight: 800,
    horizontalInset: '5.5%',
    letterSpacing: '-0.01em',
    lineBoxBorderRadiusPx: 0,
    lineBoxBoxShadow: 'none',
    lineBoxPadding: '1px 6px',
    lineHeight: 1.2,
    maxWidth: '89%',
    outlineMultiplier: 2.1,
    softShadowBlurPx: 18,
    softShadowColor: 'rgba(0, 0, 0, 0.6)',
    softShadowOffsetYPx: 6,
  },
  Clean: {
    borderRadiusPx: 10,
    bottomMultiLine: '29.5%',
    bottomSingleLine: '23.5%',
    containerPadding: '10px 22px',
    fontScale: 1.08,
    fontWeight: 800,
    horizontalInset: '5.5%',
    letterSpacing: '-0.01em',
    lineBoxBorderRadiusPx: 0,
    lineBoxBoxShadow: 'none',
    lineBoxPadding: '1px 6px',
    lineHeight: 1.22,
    maxWidth: '89%',
    outlineMultiplier: 0,
    softShadowBlurPx: 16,
    softShadowColor: 'rgba(0, 0, 0, 0.78)',
    softShadowOffsetYPx: 3,
  },
  Highlight: {
    borderRadiusPx: 0,
    bottomMultiLine: '18%',
    bottomSingleLine: '18%',
    containerPadding: '0 14px 12px 14px',
    fontScale: 1.08,
    fontWeight: 800,
    horizontalInset: '7%',
    letterSpacing: '-0.02em',
    lineBoxBackgroundColor: 'rgba(255, 216, 77, 1)',
    lineBoxBorderRadiusPx: 10,
    lineBoxBoxShadow: '0 8px 20px rgba(0, 0, 0, 0.28)',
    lineBoxPadding: '3px 12px 4px 12px',
    lineHeight: 1.3,
    maxWidth: '86%',
    outlineMultiplier: 0,
    softShadowBlurPx: 0,
    softShadowColor: 'transparent',
    softShadowOffsetYPx: 0,
  },
  LineBox: {
    borderRadiusPx: 0,
    // Keep one stable reading position above social-app controls. Moving
    // multi-line captions upward covered faces and demos in Shorts Fit.
    bottomMultiLine: '18%',
    bottomSingleLine: '18%',
    containerPadding: '0 14px 12px 14px',
    fontScale: 1.08,
    fontWeight: 800,
    horizontalInset: '7%',
    letterSpacing: '-0.02em',
    lineBoxBackgroundColor: 'rgba(12, 14, 18, 0.88)',
    lineBoxBorderRadiusPx: 12,
    lineBoxBoxShadow: '0 10px 24px rgba(0, 0, 0, 0.24)',
    lineBoxPadding: '4px 14px 5px 14px',
    lineHeight: 1.28,
    maxWidth: '86%',
    outlineMultiplier: 1,
    softShadowBlurPx: 8,
    softShadowColor: 'rgba(0, 0, 0, 0.28)',
    softShadowOffsetYPx: 2,
  },
};

// Landscape (16:9 and similar) tuning. Every length is a ratio of the output
// font size so the look holds at 720p, 1080p and 4K alike.
type LandscapeTuning = {
  fontWeight: number;
  letterSpacing: string;
  lineHeight: number;
  // Outline presets (outlineEm 0 = no stroke)
  outlineColor?: string;
  outlineEm?: number;
  // Layered shadows, each [offsetYEm, blurEm, color]; replaces the single one.
  shadowLayersEm?: Array<[number, number, string]>;
  shadowBlurEm?: number;
  shadowColor?: string;
  shadowOffsetYEm?: number;
  // LineBox preset
  lineBoxBackgroundColor?: string;
  lineBoxPaddingEm?: [number, number, number];
  lineBoxRadiusEm?: number;
};

// One stable reading position, clear of player chrome and lower-third banners.
const LANDSCAPE_BOTTOM = '8.5%';

const LANDSCAPE_TUNING: Partial<
  Record<SubtitleStylePresetKey, LandscapeTuning>
> = {
  Default: {
    fontWeight: 600,
    letterSpacing: '-0.01em',
    lineHeight: 1.28,
    outlineColor: 'rgba(0, 0, 0, 0.92)',
    outlineEm: 0.103,
    shadowBlurEm: 0.17,
    shadowColor: 'rgba(0, 0, 0, 0.55)',
    shadowOffsetYEm: 0.05,
  },
  Cinema: {
    fontWeight: 650,
    letterSpacing: '-0.005em',
    lineHeight: 1.26,
    outlineColor: 'rgba(10, 9, 12, 0.88)',
    outlineEm: 0.08,
    shadowBlurEm: 0.22,
    shadowColor: 'rgba(0, 0, 0, 0.6)',
    shadowOffsetYEm: 0.04,
  },
  Clean: {
    fontWeight: 600,
    letterSpacing: '-0.005em',
    lineHeight: 1.28,
    outlineEm: 0,
    shadowLayersEm: [
      [0.02, 0.06, 'rgba(0, 0, 0, 0.6)'],
      [0.05, 0.3, 'rgba(0, 0, 0, 0.55)'],
    ],
  },
  Highlight: {
    fontWeight: 650,
    letterSpacing: '-0.01em',
    lineHeight: 1.5,
    lineBoxBackgroundColor: 'rgba(255, 216, 77, 1)',
    lineBoxPaddingEm: [0.06, 0.34, 0.12],
    lineBoxRadiusEm: 0.18,
  },
  LineBox: {
    fontWeight: 600,
    letterSpacing: '-0.01em',
    lineHeight: 1.48,
    lineBoxBackgroundColor: 'rgba(12, 14, 18, 0.78)',
    lineBoxPaddingEm: [0.09, 0.41, 0.15],
    lineBoxRadiusEm: 0.26,
  },
};

function emToPx(fontSizePx: number, em: number): number {
  return Math.round(fontSizePx * em * 10) / 10;
}

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
  typeface?: SubtitleTypeface;
}): SubtitleRenderTheme {
  const {
    displayFontSize = BASELINE_FONT_SIZE,
    stylePreset = 'Default',
    isMultiLine,
    videoWidthPx,
    videoHeightPx,
    typeface = DEFAULT_SUBTITLE_TYPEFACE,
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
  const landscapeTuning = isShortFormPortrait
    ? null
    : (LANDSCAPE_TUNING[stylePreset] ?? null);
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
  } else {
    bottomValue = LANDSCAPE_BOTTOM;
  }

  let textShadow = 'none';
  let textStrokeColor = 'transparent';
  let textStrokeWidthPx = 0;
  let backgroundColor = 'transparent';
  let boxShadowValue = 'none';
  let containerPadding = shortFormTuning?.containerPadding || '10px 20px';

  if (subtitleStyleUsesLineBox(stylePreset)) {
    backgroundColor = 'transparent';
    boxShadowValue = 'none';
    containerPadding = shortFormTuning?.containerPadding || '0 12px 10px 12px';
    textShadow =
      isShortFormPortrait && shortFormTuning?.softShadowBlurPx !== 0
        ? `0 ${shortFormTuning?.softShadowOffsetYPx || 2}px ${
            shortFormTuning?.softShadowBlurPx || 8
          }px ${shortFormTuning?.softShadowColor || 'rgba(0, 0, 0, 0.28)'}`
        : 'none';
  } else if (style.borderStyle === 1) {
    backgroundColor = 'transparent';
    boxShadowValue = 'none';
    if (typeof landscapeTuning?.outlineEm === 'number') {
      if (landscapeTuning.outlineEm > 0) {
        textStrokeColor = landscapeTuning.outlineColor || outlineRgba;
        textStrokeWidthPx = Math.max(
          1.5,
          emToPx(finalFontSize, landscapeTuning.outlineEm)
        );
      }
      textShadow = landscapeTuning.shadowLayersEm
        ? landscapeTuning.shadowLayersEm
            .map(([offsetEm, blurEm, color]) =>
              buildSoftShadow(
                color,
                emToPx(finalFontSize, offsetEm),
                emToPx(finalFontSize, blurEm)
              )
            )
            .join(', ')
        : buildSoftShadow(
            landscapeTuning.shadowColor || shadowRgba,
            emToPx(finalFontSize, landscapeTuning.shadowOffsetYEm ?? 0.05),
            emToPx(finalFontSize, landscapeTuning.shadowBlurEm ?? 0.17)
          );
    } else if (shortFormTuning?.outlineMultiplier === 0) {
      textShadow = buildSoftShadow(
        shortFormTuning.softShadowColor,
        shortFormTuning.softShadowOffsetYPx,
        shortFormTuning.softShadowBlurPx
      );
    } else {
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
    }
  } else if (style.borderStyle === 3 || style.borderStyle === 4) {
    backgroundColor = shortFormTuning?.backgroundColor || shadowRgba;
    boxShadowValue =
      shortFormTuning?.boxShadow || '0 4px 16px rgba(0, 0, 0, 0.4)';
    if (style.borderStyle === 4 && style.outlineSize > 0) {
      const outlineSize =
        style.outlineSize * (shortFormTuning?.outlineMultiplier ?? 1);
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

  // One geometry for the player, full screen and the export: lines wrap
  // inside the same 5% side insets everywhere.
  const horizontalInset = isShortFormPortrait
    ? shortFormTuning?.horizontalInset || '5.5%'
    : '5%';
  const width = 'auto';
  const maxWidth = isShortFormPortrait
    ? shortFormTuning?.maxWidth || '89%'
    : '100%';
  const margin = '0 auto';

  const landscapeLineBoxPadding = landscapeTuning?.lineBoxPaddingEm
    ? landscapeTuning.lineBoxPaddingEm
        .map(em => `${emToPx(finalFontSize, em)}px`)
        .join(' ')
    : undefined;
  const landscapeLineBoxRadiusPx =
    typeof landscapeTuning?.lineBoxRadiusEm === 'number'
      ? emToPx(finalFontSize, landscapeTuning.lineBoxRadiusEm)
      : undefined;

  return {
    backgroundColor,
    borderRadiusPx: shortFormTuning?.borderRadiusPx ?? 5,
    bottom: bottomValue,
    boxShadow: boxShadowValue,
    containerPadding,
    fontFamily: subtitleTypefaceFontStack(
      isSubtitleTypeface(typeface) ? typeface : DEFAULT_SUBTITLE_TYPEFACE,
      isShortFormPortrait
    ),
    fontSizePx: finalFontSize,
    fontWeight:
      typeface === 'display'
        ? 800
        : (shortFormTuning?.fontWeight ??
          landscapeTuning?.fontWeight ??
          (style.isBold ? 700 : 500)),
    horizontalInset,
    isShortFormPortrait,
    letterSpacing:
      shortFormTuning?.letterSpacing ??
      landscapeTuning?.letterSpacing ??
      '0.01em',
    lineBoxBackgroundColor:
      shortFormTuning?.lineBoxBackgroundColor ||
      landscapeTuning?.lineBoxBackgroundColor ||
      shadowRgba,
    lineBoxBorderRadiusPx:
      shortFormTuning?.lineBoxBorderRadiusPx ?? landscapeLineBoxRadiusPx ?? 0,
    lineBoxBoxShadow: shortFormTuning?.lineBoxBoxShadow ?? 'none',
    lineBoxPadding:
      shortFormTuning?.lineBoxPadding ?? landscapeLineBoxPadding ?? '1px 6px',
    lineHeight:
      shortFormTuning?.lineHeight ?? landscapeTuning?.lineHeight ?? 1.35,
    margin,
    maxWidth,
    textShadow,
    textStrokeColor,
    textStrokeWidthPx,
    width,
  };
}

export function resolveSubtitleLineBoxStyle(
  theme: SubtitleRenderTheme
): SubtitleLineBoxStyle {
  return {
    backgroundColor: theme.lineBoxBackgroundColor,
    padding: theme.lineBoxPadding,
    display: 'inline',
    lineHeight: String(theme.lineHeight),
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: theme.isShortFormPortrait ? 'keep-all' : 'break-word',
    borderRadius: `${theme.lineBoxBorderRadiusPx}px`,
    boxShadow: theme.lineBoxBoxShadow,
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  };
}

export function normalizeSubtitleLineBoxLineText(value: string): string {
  return String(value || '').trim() || '\u00a0';
}

export function subtitleTextUsesMultipleLines(
  element: HTMLElement,
  text: string
): boolean {
  if (text.includes('\n')) return true;
  if (!text) return false;

  const containerWidth = element.clientWidth;
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view || containerWidth <= 0) return false;

  const computedStyle = view.getComputedStyle(element);
  if (!computedStyle.fontSize || !computedStyle.fontFamily) return false;

  const probe = document.createElement('span');
  probe.style.fontFamily = computedStyle.fontFamily;
  probe.style.fontSize = computedStyle.fontSize;
  probe.style.fontWeight = computedStyle.fontWeight;
  probe.style.letterSpacing = computedStyle.letterSpacing;
  probe.style.whiteSpace = 'nowrap';
  probe.style.visibility = 'hidden';
  probe.style.position = 'absolute';
  probe.textContent = text.replace(/\n/g, ' ');

  try {
    document.body.appendChild(probe);
    return probe.scrollWidth > containerWidth + 1;
  } finally {
    probe.remove();
  }
}

export function subtitleLineBoxStyleToCssText(
  style: SubtitleLineBoxStyle
): string {
  return [
    `background-color:${style.backgroundColor}`,
    `padding:${style.padding}`,
    `display:${style.display}`,
    `line-height:${style.lineHeight}`,
    `white-space:${style.whiteSpace}`,
    `overflow-wrap:${style.overflowWrap}`,
    `word-break:${style.wordBreak}`,
    `border-radius:${style.borderRadius}`,
    `box-shadow:${style.boxShadow}`,
    `box-decoration-break:${style.boxDecorationBreak}`,
    `-webkit-box-decoration-break:${style.WebkitBoxDecorationBreak}`,
  ].join(';');
}

export function getSubtitleStyles(opts: {
  displayFontSize?: number;
  isFullScreen?: boolean;
  stylePreset: SubtitleStylePresetKey;
  isMultiLine: boolean;
  videoWidthPx?: number;
  videoHeightPx?: number;
  typeface?: SubtitleTypeface;
}): string {
  const { isFullScreen = false, stylePreset = 'Default' } = opts;
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

  if (subtitleStyleUsesLineBox(stylePreset)) {
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
    word-break: ${theme.isShortFormPortrait ? 'keep-all' : 'break-word'};
    text-wrap: ${theme.isShortFormPortrait ? 'balance' : 'wrap'};
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
