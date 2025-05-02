import React from 'react';
import BaseSubtitleDisplay from './BaseSubtitleDisplay.js'; // Import the shared component

// Define the props the component accepts (can be simpler now)
interface StyledSubtitleDisplayProps {
  text: string;
  isVisible: boolean; // Keep isVisible prop
  baseFontSize?: number; // <-- Renamed
  // No need for isFullyExpanded here unless BaseSubtitleDisplay uses it
}

// This component now acts as a simple wrapper for the render-host context
function StyledSubtitleDisplay({
  text,
  isVisible,
  baseFontSize,
}: StyledSubtitleDisplayProps): React.ReactElement {
  return (
    <BaseSubtitleDisplay
      text={text}
      isVisible={isVisible}
      displayFontSize={baseFontSize}
      isFullScreen={false}
    />
  );
}

// Export the component
export default StyledSubtitleDisplay;
