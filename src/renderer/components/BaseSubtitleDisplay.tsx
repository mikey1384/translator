import React from 'react';
import { css } from '@emotion/css';

// Define the shared styles here
const baseSubtitleStyles = css`
  position: fixed;
  bottom: 5%; // Or use props for dynamic positioning if needed later
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  background-color: rgba(0, 0, 0, 0.7); // Example shared style
  color: white; // Example shared style
  font-family: // Use the desired shared font stack
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
  font-size: 24px; // Example shared size
  text-align: center;
  border-radius: 5px;
  opacity: 0; // Start hidden
  transition: opacity 0.2s ease-in-out;
  max-width: 80%;
  pointer-events: none;
  white-space: pre-wrap;
  z-index: 1000; // Ensure it's above video controls potentially

  &.visible {
    opacity: 1;
  }

  /* Add any other shared styles */
  font-weight: 500;
  line-height: 1.6;
  letter-spacing: 0.01em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  user-select: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  /* backdrop-filter: blur(4px); // Optional blur */
  border: none;
`;

// Props for the base component
interface BaseSubtitleDisplayProps {
  text: string;
  isVisible: boolean;
  // Add other style props if needed (e.g., fontSize, position)
}

function BaseSubtitleDisplay({
  text,
  isVisible,
}: BaseSubtitleDisplayProps): React.ReactElement {
  const combinedClassName = `${baseSubtitleStyles} ${isVisible ? 'visible' : ''}`;

  // Basic check to avoid rendering empty divs, though CSS handles opacity
  if (!text && !isVisible) {
    return <></>; // Render nothing if no text and not forced visible
  }

  return <div className={combinedClassName}>{text}</div>;
}

export default BaseSubtitleDisplay;
