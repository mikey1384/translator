import React, { useRef, useState, useEffect } from 'react';
import {
  assColorToRgba,
  getSubtitleStyles,
} from '../../shared/helpers/subtitle-style-util.js';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../../shared/constants/subtitle-styles.js';

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
    const element = subtitleRef?.current;
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
    stylePreset: stylePreset as SubtitleStylePresetKey,
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
