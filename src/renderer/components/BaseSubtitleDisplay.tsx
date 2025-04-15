import React from 'react';
import { css } from '@emotion/css';

// Define the shared styles here
function getSubtitleStyles({
  displayFontSize,
  isFullScreen,
}: {
  displayFontSize?: number;
  isFullScreen?: boolean;
}) {
  // Use the provided size directly, with a fallback/minimum
  const finalFontSize = Math.max(10, displayFontSize || 20); // Default to 20px if not provided

  return css`
    position: fixed;
    bottom: ${isFullScreen ? '8%' : '5%'};
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    background-color: rgba(0, 0, 0, 0.7);
    color: white;
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
    font-size: ${finalFontSize}px; // <-- Use finalFontSize directly
    text-align: center;
    border-radius: 5px;
    opacity: 0;
    transition:
      opacity 0.2s ease-in-out,
      bottom 0.3s ease-out,
      font-size 0.1s linear; // Adjust transition
    max-width: 80%;
    pointer-events: none;
    white-space: pre-wrap;
    z-index: 1000;

    &.visible {
      opacity: 1;
    }

    font-weight: 500;
    line-height: 1.6;
    letter-spacing: 0.01em;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
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
  // Add other style props if needed (e.g., fontSize, position)
}

function BaseSubtitleDisplay({
  text,
  isVisible,
  displayFontSize,
  isFullScreen,
}: BaseSubtitleDisplayProps): React.ReactElement {
  const dynamicStyles = getSubtitleStyles({ displayFontSize, isFullScreen });
  const combinedClassName = `${dynamicStyles} ${isVisible ? 'visible' : ''}`;

  // Basic check to avoid rendering empty divs, though CSS handles opacity
  if (!text && !isVisible) {
    return <></>; // Render nothing if no text and not forced visible
  }

  return <div className={combinedClassName}>{text}</div>;
}

export default BaseSubtitleDisplay;
