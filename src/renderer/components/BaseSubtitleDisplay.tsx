import React, { useRef, useState, useEffect } from 'react';
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
  isMultiLine,
}: {
  displayFontSize?: number;
  isFullScreen?: boolean;
  stylePreset?: SubtitleStylePresetKey;
  isMultiLine: boolean;
}) {
  const style =
    SUBTITLE_STYLE_PRESETS[stylePreset] || SUBTITLE_STYLE_PRESETS.Default;

  const finalFontSize = Math.max(10, displayFontSize || 20);
  // --- DEFINE COLORS ---
  const primaryRgba = assColorToRgba(style.primaryColor);
  const outlineRgba = assColorToRgba(style.outlineColor);
  const shadowRgba = assColorToRgba(style.backColor); // BackColor used for shadow/box
  // --- END DEFINE COLORS ---

  // --- Positioning Variables ---
  const position: 'fixed' | 'absolute' = 'fixed';

  // --- Adjust Bottom Position ---
  let bottomValue: string;
  console.log('isMultiLine', isMultiLine);
  if (isMultiLine) {
    // Multi-line LineBox
    bottomValue = isFullScreen ? '5%' : '2.5%';
  } else {
    // Single-line LineBox
    bottomValue = isFullScreen ? '10%' : '5%';
  }
  // --- End Adjust Bottom Position ---

  const maxWidth = '100%';
  const right: string | number | undefined = isFullScreen ? '5%' : undefined; // Keep this conditional right
  // --- End Positioning Variables ---

  // --- DETAILED STYLE LOGIC ---
  let textShadow = 'none';
  let backgroundColor = 'transparent'; // Default to transparent
  let boxShadowValue = 'none'; // <-- Initialize box shadow variable
  let containerPadding = '10px 20px'; // Default padding

  if (stylePreset === 'LineBox') {
    // Specific logic for LineBox - container has no background/shadow/padding
    backgroundColor = 'transparent';
    boxShadowValue = 'none';
    containerPadding = '0 0 10px 0'; // Add 10px bottom padding ONLY
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

  // --- Define Transition ---
  let transitionValue = `
    opacity 0.2s ease-in-out,
    font-size 0.1s linear,
    color 0.2s linear,
    text-shadow 0.2s linear,
    background-color 0.2s linear,
    box-shadow 0.2s linear,
    left 0.3s ease-out,
    max-width 0.3s ease-out
  `; // Default transition including opacity

  if (stylePreset === 'LineBox') {
    // Remove opacity transition for LineBox
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
  // --- End Define Transition ---

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
  const subtitleRef = useRef<HTMLDivElement>(null);
  const [isMultiLine, setIsMultiLine] = useState(false);

  useEffect(() => {
    const element = subtitleRef.current;
    // Check if element exists and text is present
    if (element && text) {
      const hasExplicitNewline = text.includes('\n');
      let hasWrapped = false; // Default to false
      try {
        // 1. Get container's available width and computed styles
        const containerWidth = element.clientWidth;
        const computedStyle = window.getComputedStyle(element);
        const fontSize = computedStyle.fontSize;
        const fontFamily = computedStyle.fontFamily;
        const fontWeight = computedStyle.fontWeight;
        const letterSpacing = computedStyle.letterSpacing;

        // Ensure we have necessary info for measurement
        if (containerWidth > 0 && fontSize && fontFamily) {
          // 2. Create a temporary, invisible span for measurement
          const tempSpan = document.createElement('span');

          // 3. Apply the same font styles + force no wrapping
          tempSpan.style.fontFamily = fontFamily;
          tempSpan.style.fontSize = fontSize;
          tempSpan.style.fontWeight = fontWeight;
          tempSpan.style.letterSpacing = letterSpacing;
          tempSpan.style.whiteSpace = 'nowrap'; // Prevent wrapping in the temp span
          tempSpan.style.visibility = 'hidden'; // Make it invisible
          tempSpan.style.position = 'absolute'; // Don't affect layout

          // 4. Set its content to the subtitle text (replace newlines with spaces)
          tempSpan.textContent = text.replace(/\n/g, ' ');

          // 5. Add to DOM, measure width, remove immediately
          document.body.appendChild(tempSpan);
          const textIntrinsicWidth = tempSpan.scrollWidth;
          document.body.removeChild(tempSpan);

          // 6. Compare: does the text's natural width exceed the container's width?
          // Add a small tolerance (e.g., 1px) for rounding
          hasWrapped = textIntrinsicWidth > containerWidth + 1;
          // --- End Logs ---
        } else {
          // Log if container width isn't ready
          console.log(
            '[BaseSubtitleDisplay Effect] Container width or styles not ready for measurement.'
          );
        }
      } catch (e) {
        console.error(
          '[BaseSubtitleDisplay Effect] Error during width measurement:',
          e
        );
        // Keep hasWrapped false on error
      } finally {
        // 7. Update state if EITHER explicit newline OR wrapping occurred
        const finalIsMultiLine = hasExplicitNewline || hasWrapped;
        // Log the final decision
        console.log(
          `[BaseSubtitleDisplay Effect] HasExplicitNewline: ${hasExplicitNewline}, HasWrapped: ${hasWrapped}, Final isMultiLine: ${finalIsMultiLine}`
        );
        setIsMultiLine(finalIsMultiLine);
      }
    }
    // Always clear if no text or element
    else if (!text) {
      setIsMultiLine(false);
    }
  }, [text, displayFontSize, isFullScreen, stylePreset]); // Keep dependencies

  const dynamicStyles = getSubtitleStyles({
    displayFontSize,
    isFullScreen,
    stylePreset,
    isMultiLine,
  });
  const combinedClassName = `${dynamicStyles} ${isVisible ? 'visible' : ''}`;

  const style =
    SUBTITLE_STYLE_PRESETS[stylePreset || 'Default'] ||
    SUBTITLE_STYLE_PRESETS.Default;
  const lineBoxBgColor = assColorToRgba(style.backColor);

  // Basic check to avoid rendering empty divs, though CSS handles opacity
  if (!text && !isVisible) {
    return <></>; // Early return is now AFTER useEffect
  }

  return (
    <div ref={subtitleRef} className={combinedClassName}>
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
                    lineHeight: '1.35',
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
