import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
// TODO: Ensure this component exists and path is correct
import StyledSubtitleDisplay from './components/StyledSubtitleDisplay.js';

// --- TypeScript Definition for the Exposed Bridge ---
// This tells TypeScript what functions are available on window.renderHostBridge
declare global {
  interface Window {
    renderHostBridge: {
      // Matches the function exposed in preload-render-window.ts
      onUpdateSubtitle: (callback: (text: string) => void) => () => void;
    };
  }
}
// --- End Bridge Definition ---

// --- The React Component ---
function RenderHostApp() {
  const [subtitleText, setSubtitleText] = useState('');
  const [isVisible, setIsVisible] = useState(false); // Controls visibility based on text

  useEffect(() => {
    console.log(
      '[RenderHostApp] Component mounted. Subscribing to subtitle updates via bridge...'
    );

    // Use the bridge function exposed by the preload script to set up the listener
    const cleanupListener = window.renderHostBridge.onUpdateSubtitle(
      newText => {
        // This callback runs whenever the main process sends an update via the preload script
        // console.debug(`[RenderHostApp] Received text update via bridge: ${newText.substring(0, 30)}`); // Optional
        setSubtitleText(newText);
        setIsVisible(!!newText); // Show component only if there's text
      }
    );

    console.log(
      '[RenderHostApp] Subscription to subtitle updates established.'
    );

    // Return the cleanup function provided by the bridge
    // This will be called when the component unmounts
    return () => {
      console.log(
        '[RenderHostApp] Component unmounting. Cleaning up subtitle update listener.'
      );
      cleanupListener();
    };
  }, []); // Empty dependency array means this effect runs only once on mount

  // Render the subtitle display component
  // isFullyExpanded={false} is likely desired for consistent capture size
  return (
    <StyledSubtitleDisplay
      text={subtitleText}
      isVisible={isVisible}
      isFullyExpanded={false}
    />
  );
}
// --- End React Component ---

// --- React Mounting Logic ---
const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    const root = createRoot(rootElement);
    root.render(
      // <React.StrictMode> // StrictMode can sometimes cause double renders in dev, consider removing if causing issues here
      <RenderHostApp />
      // </React.StrictMode>
    );
    console.log('[RenderHostApp] RenderHostApp mounted successfully to #root.');
  } catch (error) {
    console.error('[RenderHostApp] Failed to render React component:', error);
  }
} else {
  console.error(
    '[RenderHostApp] Root element #root not found in render-host.html.'
  );
}
// --- End Mounting Logic ---
