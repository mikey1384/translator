import React, { useRef, useState, useEffect } from 'react';
import {
  assColorToRgba,
  getSubtitleStyles,
} from '../../shared/helpers/subtitle-style-util.js';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../../shared/constants/subtitle-styles.js';

interface BaseSubtitleDisplayProps {
  text: string;
  isVisible: boolean;
  displayFontSize?: number;
  isFullScreen?: boolean;
  stylePreset?: SubtitleStylePresetKey;
}

export default function BaseSubtitleDisplay({
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
    if (element && text) {
      const hasExplicitNewline = text.includes('\n');
      let hasWrapped = false;
      try {
        const containerWidth = element.clientWidth;
        const computedStyle = window.getComputedStyle(element);
        const fontSize = computedStyle.fontSize;
        const fontFamily = computedStyle.fontFamily;
        const fontWeight = computedStyle.fontWeight;
        const letterSpacing = computedStyle.letterSpacing;

        if (containerWidth > 0 && fontSize && fontFamily) {
          const tempSpan = document.createElement('span');

          tempSpan.style.fontFamily = fontFamily;
          tempSpan.style.fontSize = fontSize;
          tempSpan.style.fontWeight = fontWeight;
          tempSpan.style.letterSpacing = letterSpacing;
          tempSpan.style.whiteSpace = 'nowrap';
          tempSpan.style.visibility = 'hidden';
          tempSpan.style.position = 'absolute';

          tempSpan.textContent = text.replace(/\n/g, ' ');

          document.body.appendChild(tempSpan);
          const textIntrinsicWidth = tempSpan.scrollWidth;
          document.body.removeChild(tempSpan);

          hasWrapped = textIntrinsicWidth > containerWidth + 1;
        }
      } catch (e) {
        console.error(
          '[BaseSubtitleDisplay Effect] Error during width measurement:',
          e
        );
      } finally {
        const finalIsMultiLine = hasExplicitNewline || hasWrapped;
        setIsMultiLine(finalIsMultiLine);
      }
    } else if (!text) {
      setIsMultiLine(false);
    }
  }, [text, displayFontSize, isFullScreen, stylePreset]);

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

  if (!text && !isVisible) {
    return <></>;
  }

  return (
    <div ref={subtitleRef} className={combinedClassName}>
      {stylePreset === 'LineBox'
        ? text.split('\n').map((line, index, arr) => (
            <React.Fragment key={index}>
              <span
                style={{
                  backgroundColor: lineBoxBgColor,
                  padding: '1px 6px',
                  display: 'inline',
                  boxDecorationBreak: 'clone',
                  WebkitBoxDecorationBreak: 'clone',
                  lineHeight: '1.35',
                }}
              >
                {line}
              </span>
              {index < arr.length - 1 && <br />}
            </React.Fragment>
          ))
        : text}
    </div>
  );
}
