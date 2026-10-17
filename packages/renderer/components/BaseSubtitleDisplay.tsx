import React, { useRef, useState, useEffect } from 'react';
import {
  getSubtitleStyles,
  resolveSubtitleRenderTheme,
  subtitleCueHtml,
  subtitleTextUsesMultipleLines,
} from '../../shared/helpers/subtitle-style-util.js';
import {
  SubtitleStylePresetKey,
  type SubtitleTypeface,
} from '../../shared/constants/subtitle-styles.js';

interface BaseSubtitleDisplayProps {
  text: string;
  isVisible: boolean;
  displayFontSize?: number;
  isFullScreen?: boolean;
  stylePreset?: SubtitleStylePresetKey;
  videoWidthPx?: number;
  videoHeightPx?: number;
  typeface?: SubtitleTypeface;
}

export default function BaseSubtitleDisplay({
  text,
  isVisible,
  displayFontSize,
  isFullScreen,
  stylePreset,
  videoWidthPx,
  videoHeightPx,
  typeface,
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
    typeface,
  ]);

  const dynamicStyles = getSubtitleStyles({
    displayFontSize,
    isFullScreen,
    stylePreset: stylePreset as SubtitleStylePresetKey,
    isMultiLine,
    videoWidthPx,
    videoHeightPx,
    typeface,
  });
  const combinedClassName = `${dynamicStyles} ${isVisible ? 'visible' : ''}`;

  const renderTheme = resolveSubtitleRenderTheme({
    displayFontSize,
    isFullScreen,
    stylePreset: (stylePreset as SubtitleStylePresetKey) || 'Default',
    isMultiLine,
    videoWidthPx,
    videoHeightPx,
    typeface,
  });

  if (!text && !isVisible) {
    return <></>;
  }

  return (
    <div
      ref={subtitleRef}
      className={combinedClassName}
      // The export's markup, so line breaks, line boxes and each line's
      // reading direction match the burned-in video.
      dangerouslySetInnerHTML={{
        __html: subtitleCueHtml(text, stylePreset ?? 'Default', renderTheme),
      }}
    />
  );
}
