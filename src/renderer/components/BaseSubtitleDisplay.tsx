import React from 'react';
import { css } from '@emotion/css';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../../shared/constants/subtitle-styles.js';

// Helper to convert ASS &HAABBGGRR to rgba()
function assColorToRgba(assColor: string): string {
  if (!assColor || !assColor.startsWith('&H')) {
    return 'rgba(255, 255, 255, 1)'; // Default white
  }
  const hex = assColor.substring(2);
  // Ensure hex string has correct length (e.g., for &H000000)
  const paddedHex = hex.padStart(8, '0');
  const alpha = parseInt(paddedHex.substring(0, 2), 16);
  const blue = parseInt(paddedHex.substring(2, 4), 16);
  const green = parseInt(paddedHex.substring(4, 6), 16);
  const red = parseInt(paddedHex.substring(6, 8), 16);
  const cssAlpha = ((255 - alpha) / 255).toFixed(2);
  return `rgba(${red}, ${green}, ${blue}, ${cssAlpha})`;
}

// Define the shared styles here
function getSubtitleStyles({
  displayFontSize,
  isFullScreen,
  stylePreset = 'Default',
}: {
  displayFontSize?: number;
  isFullScreen?: boolean;
  stylePreset?: SubtitleStylePresetKey;
}) {
  const style =
    SUBTITLE_STYLE_PRESETS[stylePreset] || SUBTITLE_STYLE_PRESETS.Default;

  const finalFontSize = Math.max(10, displayFontSize || 20);
  // --- DEFINE COLORS ---
  const primaryRgba = assColorToRgba(style.primaryColor);
  const outlineRgba = assColorToRgba(style.outlineColor);
  const shadowRgba = assColorToRgba(style.backColor); // BackColor used for shadow/box
  // --- END DEFINE COLORS ---

  // --- DETAILED STYLE LOGIC ---
  let textShadow = 'none';
  let backgroundColor = 'transparent'; // Default to transparent

  if (style.borderStyle === 1) {
    // Outline + Shadow
    backgroundColor = 'transparent'; // Explicitly set transparent background
    // Simulate outline with tight shadow, then add actual shadow
    const outlineSize = Math.max(0.1, style.outlineSize); // Ensure outline isn't 0
    const shadowDepth = style.shadowDepth;
    textShadow = `
      ${outlineSize}px ${outlineSize}px 0 ${outlineRgba},
      -${outlineSize}px ${outlineSize}px 0 ${outlineRgba},
      ${outlineSize}px -${outlineSize}px 0 ${outlineRgba},
      -${outlineSize}px -${outlineSize}px 0 ${outlineRgba},
      ${outlineSize}px 0px 0 ${outlineRgba},
      -${outlineSize}px 0px 0 ${outlineRgba},
      0px ${outlineSize}px 0 ${outlineRgba},
      0px -${outlineSize}px 0 ${outlineRgba},
      ${shadowDepth}px ${shadowDepth}px 3px ${shadowRgba}
    `;
  } else if (style.borderStyle === 3 || style.borderStyle === 4) {
    // Boxed styles
    // Use backColor for the background box
    backgroundColor = shadowRgba; // Using shadow color for box background
    // Optionally add a subtle text-shadow for just outline if style 4?
    textShadow =
      style.borderStyle === 4 && style.outlineSize > 0
        ? `0 0 ${style.outlineSize}px ${outlineRgba}` // Simple glow outline for box style 4
        : 'none';
  }
  // --- END DETAILED LOGIC ---

  return css`
    position: fixed;
    bottom: ${isFullScreen ? '8%' : '5%'};
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    background-color: ${backgroundColor}; // <-- Use calculated background
    color: ${primaryRgba}; // <-- Use calculated color
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
    font-weight: ${style.isBold ? 'bold' : '500'}; // <-- Use bold flag
    text-shadow: ${textShadow}; // <-- Apply calculated text shadow
    text-align: center;
    border-radius: 5px;
    opacity: 0;
    transition:
      opacity 0.2s ease-in-out,
      bottom 0.3s ease-out,
      font-size 0.1s linear,
      color 0.2s linear,
      text-shadow 0.2s linear,
      background-color 0.2s linear;
    max-width: 80%;
    pointer-events: none;
    white-space: pre-wrap;
    z-index: 1000;

    &.visible {
      opacity: 1;
    }

    line-height: 1.6;
    letter-spacing: 0.01em;
    user-select: none;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    border: none;
  `;
}

// Props for the base component
interface BaseSubtitleDisplayProps {
  text: string;
  isVisible: boolean;
  displayFontSize?: number; // <-- Renamed and optional (or required)
  isFullScreen?: boolean;
  stylePreset?: SubtitleStylePresetKey; // <-- ADD
  // Add other style props if needed (e.g., fontSize, position)
}

function BaseSubtitleDisplay({
  text,
  isVisible,
  displayFontSize,
  isFullScreen,
  stylePreset,
}: BaseSubtitleDisplayProps): React.ReactElement {
  const dynamicStyles = getSubtitleStyles({
    displayFontSize,
    isFullScreen,
    stylePreset,
  });
  const combinedClassName = `${dynamicStyles} ${isVisible ? 'visible' : ''}`;

  // Basic check to avoid rendering empty divs, though CSS handles opacity
  if (!text && !isVisible) {
    return <></>; // Render nothing if no text and not forced visible
  }

  return <div className={combinedClassName}>{text}</div>;
}

export default BaseSubtitleDisplay;
