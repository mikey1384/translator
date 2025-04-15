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
  let boxShadowValue = 'none'; // <-- Initialize box shadow variable
  let containerPadding = '10px 20px'; // Default padding

  if (stylePreset === 'LineBox') {
    // Specific logic for LineBox - container has no background/shadow/padding
    backgroundColor = 'transparent';
    boxShadowValue = 'none';
    containerPadding = '0'; // No padding for the container itself
    textShadow = 'none'; // Keep text shadow none for LineBox
  } else if (style.borderStyle === 1) {
    // Outline + Shadow
    backgroundColor = 'transparent'; // Explicitly set transparent background
    boxShadowValue = 'none'; // <-- No box shadow for outline styles
    // Simulate outline with tight shadow, then add actual shadow
    const outlineSize = Math.max(0.1, style.outlineSize); // Ensure outline isn't 0
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
    // Use backColor for the background box
    backgroundColor = shadowRgba; // Using shadow color for box background
    boxShadowValue = '0 4px 16px rgba(0, 0, 0, 0.4)'; // <-- Apply box shadow for boxed styles
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
    padding: ${containerPadding}; // <-- Use dynamic padding
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
      background-color 0.2s linear,
      box-shadow 0.2s linear;
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
    box-shadow: ${boxShadowValue}; // <-- Use dynamic box shadow value
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

  // Get the style object to access colors for LineBox spans
  const style =
    SUBTITLE_STYLE_PRESETS[stylePreset || 'Default'] ||
    SUBTITLE_STYLE_PRESETS.Default;
  const lineBoxBgColor = assColorToRgba(style.backColor);

  // Basic check to avoid rendering empty divs, though CSS handles opacity
  if (!text && !isVisible) {
    return <></>; // Render nothing if no text and not forced visible
  }

  return (
    <div className={combinedClassName}>
      {
        stylePreset === 'LineBox'
          ? // --- Render for LineBox ---
            text.split('\n').map((line, index, arr) => (
              // Use React.Fragment to avoid extra divs and provide keys
              <React.Fragment key={index}>
                <span
                  style={{
                    backgroundColor: lineBoxBgColor, // Apply the background color
                    padding: '1px 6px', // Small padding around each line
                    // Crucial for applying background correctly to wrapped lines:
                    display: 'inline', // Ensures background wraps with text
                    boxDecorationBreak: 'clone', // Standard property
                    WebkitBoxDecorationBreak: 'clone', // For Safari compatibility
                    lineHeight: '1.8', // Slightly increase line-height for better spacing with background
                  }}
                >
                  {line /* Render the actual line of text */}
                </span>
                {/* Add a <br /> tag between lines, but not after the last one */}
                {index < arr.length - 1 && <br />}
              </React.Fragment>
            ))
          : // --- Render for other styles (Default, Boxed, Classic) ---
            text // Render text directly, newlines handled by `white-space: pre-wrap`
      }
    </div>
  );
}

export default BaseSubtitleDisplay;
