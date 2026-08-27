import React, { useRef, useState, useEffect } from 'react';
import {
  getSubtitleStyles,
  normalizeSubtitleLineBoxLineText,
  resolveSubtitleLineBoxStyle,
  resolveSubtitleRenderTheme,
  subtitleTextUsesMultipleLines,
} from '../../shared/helpers/subtitle-style-util.js';
import { SubtitleStylePresetKey } from '../../shared/constants/subtitle-styles.js';

interface BaseSubtitleDisplayProps {
  text: string;
  isVisible: boolean;
  displayFontSize?: number;
  isFullScreen?: boolean;
  stylePreset?: SubtitleStylePresetKey;
  videoWidthPx?: number;
  videoHeightPx?: number;
}

export default function BaseSubtitleDisplay({
  text,
  isVisible,
  displayFontSize,
  isFullScreen,
  stylePreset,
  videoWidthPx,
  videoHeightPx,
}: BaseSubtitleDisplayProps): React.ReactElement {
  const subtitleRef = useRef<HTMLDivElement>(null);
  const [isMultiLine, setIsMultiLine] = useState(false);

  useEffect(() => {
    const element = subtitleRef?.current;
    if (element && text) {
      try {
        setIsMultiLine(subtitleTextUsesMultipleLines(element, text));
      } catch (e) {
        console.error(
          '[BaseSubtitleDisplay Effect] Error during width measurement:',
          e
        );
        setIsMultiLine(text.includes('\n'));
      }
    } else if (!text) {
      setIsMultiLine(false);
    }
  }, [
    text,
    displayFontSize,
    isFullScreen,
    stylePreset,
    videoWidthPx,
    videoHeightPx,
  ]);

  const dynamicStyles = getSubtitleStyles({
    displayFontSize,
    isFullScreen,
    stylePreset: stylePreset as SubtitleStylePresetKey,
    isMultiLine,
    videoWidthPx,
    videoHeightPx,
  });
  const combinedClassName = `${dynamicStyles} ${isVisible ? 'visible' : ''}`;

  const renderTheme = resolveSubtitleRenderTheme({
    displayFontSize,
    isFullScreen,
    stylePreset: (stylePreset as SubtitleStylePresetKey) || 'Default',
    isMultiLine,
    videoWidthPx,
    videoHeightPx,
  });
  const lineBoxStyle = resolveSubtitleLineBoxStyle(renderTheme);

  if (!text && !isVisible) {
    return <></>;
  }

  return (
    <div ref={subtitleRef} className={combinedClassName}>
      {stylePreset === 'LineBox'
        ? text.split('\n').map((line, index, arr) => (
            <React.Fragment key={index}>
              <span style={lineBoxStyle}>
                {normalizeSubtitleLineBoxLineText(line)}
              </span>
              {index < arr.length - 1 && <br />}
            </React.Fragment>
          ))
        : text}
    </div>
  );
}
