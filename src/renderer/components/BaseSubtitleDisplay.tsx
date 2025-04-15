import React from 'react';
import { css } from '@emotion/css';

// Define the shared styles here
function getSubtitleStyles({
  fontSize,
  isFullScreen,
}: {
  fontSize: number;
  isFullScreen: boolean;
}) {
  const baseSize = Math.max(10, fontSize || 24); // Ensure a minimum size, default to 24 if prop is 0/invalid
  const displayFontSize = isFullScreen ? Math.round(baseSize * 1.2) : baseSize; // Example: scale up by 20% in full screen

  return css`
    position: fixed;
    bottom: ${isFullScreen
      ? '8%'
      : '5%'}; // Adjust position slightly in fullscreen maybe
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
    font-size: ${displayFontSize}px; // <-- USE DYNAMIC FONT SIZE HERE
    text-align: center;
    border-radius: 5px;
    opacity: 0;
    transition:
      opacity 0.2s ease-in-out,
      bottom 0.3s ease-out,
      font-size 0.3s ease-out; // Added transition for font-size/bottom
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
  fontSize: number;
  isFullScreen: boolean;
  // Add other style props if needed (e.g., fontSize, position)
}

function BaseSubtitleDisplay({
  text,
  isVisible,
  fontSize,
  isFullScreen,
}: BaseSubtitleDisplayProps): React.ReactElement {
  const dynamicStyles = getSubtitleStyles({ fontSize, isFullScreen });
  const combinedClassName = `${dynamicStyles} ${isVisible ? 'visible' : ''}`;

  // Basic check to avoid rendering empty divs, though CSS handles opacity
  if (!text && !isVisible) {
    return <></>; // Render nothing if no text and not forced visible
  }

  return <div className={combinedClassName}>{text}</div>;
}

export default BaseSubtitleDisplay;
