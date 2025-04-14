import React from 'react';
import BaseSubtitleDisplay from './BaseSubtitleDisplay.js'; // Import the shared component

// Define the props the component accepts (can be simpler now)
interface StyledSubtitleDisplayProps {
  text: string;
  isVisible: boolean; // Keep isVisible prop
  // No need for isFullyExpanded here unless BaseSubtitleDisplay uses it
}

// This component now acts as a simple wrapper for the render-host context
function StyledSubtitleDisplay({
  text,
  isVisible,
}: StyledSubtitleDisplayProps): React.ReactElement {
  // Render the base component, passing the props through
  return <BaseSubtitleDisplay text={text} isVisible={isVisible} />;
}

// Export the component
export default StyledSubtitleDisplay;
