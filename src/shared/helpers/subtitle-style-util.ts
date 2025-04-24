import { css } from '@emotion/css';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../constants/subtitle-styles.js';

/* ---------- small helpers ---------- */
export function assColorToRgba(ass: string): string {
  // This matches the logic from your snippet
  if (!ass?.startsWith('&H')) return 'rgba(255,255,255,1)';
  const hex = ass.substring(2).padStart(8, '0'); // e.g. AABBGGRR
  const a = 255 - parseInt(hex.slice(0, 2), 16); // invert alpha
  const b = parseInt(hex.slice(2, 4), 16);
  const g = parseInt(hex.slice(4, 6), 16);
  const r = parseInt(hex.slice(6, 8), 16);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}

/* ---------- the style factory (copied from BaseSubtitleDisplay) ---------- */
export function getSubtitleStyles(opts: {
  displayFontSize?: number;
  isFullScreen?: boolean;
  stylePreset: SubtitleStylePresetKey;
  isMultiLine: boolean;
}): string {
  const {
    displayFontSize = 20,
    isFullScreen = false,
    stylePreset = 'Default',
    isMultiLine,
  } = opts;

  const style =
    SUBTITLE_STYLE_PRESETS[stylePreset] || SUBTITLE_STYLE_PRESETS.Default;

  // Ensure a minimum font size
  const finalFontSize = Math.max(10, displayFontSize);

  // Convert the ASS colors to rgba
  const primaryRgba = assColorToRgba(style.primaryColor);
  const outlineRgba = assColorToRgba(style.outlineColor);
  const shadowRgba = assColorToRgba(style.backColor); // used for shadow/box

  // Decide position
  const position: 'fixed' | 'absolute' = 'fixed';

  // Tweak vertical positioning depending on multi-line vs single line
  let bottomValue: string;
  if (isMultiLine) {
    bottomValue = isFullScreen ? '5%' : '2.5%';
  } else {
    bottomValue = isFullScreen ? '10%' : '5%';
  }

  // You can also set a right or left offset if you want
  const maxWidth = '100%';
  const right: string | number | undefined = isFullScreen ? '5%' : undefined;

  // Start building text shadow & box style
  let textShadow = 'none';
  let backgroundColor = 'transparent';
  let boxShadowValue = 'none';
  let containerPadding = '10px 20px';

  if (stylePreset === 'LineBox') {
    // For "LineBox", we typically have no shadow/box around each line
    backgroundColor = 'transparent';
    boxShadowValue = 'none';
    containerPadding = '0 0 10px 0';
    textShadow = 'none';
  } else if (style.borderStyle === 1) {
    // Outline + Shadow style
    backgroundColor = 'transparent';
    boxShadowValue = 'none';
    const outlineSize = Math.max(0.1, style.outlineSize);
    // 8-direction outline
    textShadow = `
      ${outlineSize}px ${outlineSize}px 0 ${outlineRgba},
      -${outlineSize}px ${outlineSize}px 0 ${outlineRgba},
      ${outlineSize}px -${outlineSize}px 0 ${outlineRgba},
      -${outlineSize}px -${outlineSize}px 0 ${outlineRgba},
      ${outlineSize}px 0px 0 ${outlineRgba},
      -${outlineSize}px 0px 0 ${outlineRgba},
      0px ${outlineSize}px 0 ${outlineRgba},
      0px -${outlineSize}px 0 ${outlineRgba}
    `;
  } else if (style.borderStyle === 3 || style.borderStyle === 4) {
    // Boxed styles
    backgroundColor = shadowRgba;
    boxShadowValue = '0 4px 16px rgba(0, 0, 0, 0.4)';
    // If borderStyle=4, add a subtle glow outline
    if (style.borderStyle === 4 && style.outlineSize > 0) {
      textShadow = `0 0 ${style.outlineSize}px ${outlineRgba}`;
    }
  }

  // Add transitions for smooth changes
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
    // If you don't want fade-ins for linebox
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
    position: ${position};
    bottom: ${bottomValue};
    left: ${isFullScreen ? '5%' : '50%'};
    right: ${right};
    padding: ${containerPadding};
    background-color: ${backgroundColor};
    color: ${primaryRgba};
    font-family:
      'Noto Sans',
      'Inter',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Roboto,
      'PingFang SC',
      'Microsoft YaHei',
      'Noto Sans SC',
      sans-serif;
    font-size: ${finalFontSize}px;
    font-weight: ${style.isBold ? 'bold' : '500'};
    text-shadow: ${textShadow};
    text-align: center;
    border-radius: 5px;
    opacity: 0;
    transition: ${transitionValue};
    max-width: ${maxWidth};
    pointer-events: none;
    white-space: pre-wrap;
    z-index: 1000;
    ${!isFullScreen ? 'transform: translateX(-50%);' : ''}
    ${isFullScreen ? 'margin: 0 auto;' : ''}

    &.visible {
      opacity: 1;
    }

    line-height: 1.35;
    letter-spacing: 0.01em;
    user-select: none;
    box-shadow: ${boxShadowValue};
    border: none;
  `;
}

export type SubtitleStyleOpts = Parameters<typeof getSubtitleStyles>[0];
