import React from 'react';
import { css } from '@emotion/css'; // Or your preferred styling solution

// Basic styling - adjust as needed for capture
const subtitleStyles = css`
  position: fixed;
  bottom: 5%; // Example positioning
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  background-color: rgba(0, 0, 0, 0.7); // Semi-transparent background
  color: white;
  font-family: sans-serif;
  font-size: 24px; // Example size
  text-align: center;
  border-radius: 5px;
  opacity: 0; // Start hidden
  transition: opacity 0.2s ease-in-out;
  max-width: 80%; // Prevent subtitles from being too wide
  pointer-events: none; // Prevent interaction
  white-space: pre-wrap; // Handle multi-line text

  &.visible {
    opacity: 1;
  }
`;

// Define the props the component accepts
interface StyledSubtitleDisplayProps {
  text: string;
  isVisible: boolean;
  isFullyExpanded?: boolean; // Keep prop, even if unused for now
}

// Component using function declaration syntax
function StyledSubtitleDisplay({
  text,
  isVisible,
}: StyledSubtitleDisplayProps): React.ReactElement {
  // Add 'visible' class based on the isVisible prop
  const combinedClassName = `${subtitleStyles} ${isVisible ? 'visible' : ''}`;

  return (
    <div className={combinedClassName}>
      {text /* Display the subtitle text */}
    </div>
  );
}

// Export the component so it can be imported
export default StyledSubtitleDisplay;
