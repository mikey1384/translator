import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import StyledSubtitleDisplay from './components/StyledSubtitleDisplay.js';

declare global {
  interface Window {
    renderHostBridge: {
      // Matches the function exposed in preload-render-window.ts
      onUpdateSubtitle: (callback: (text: string) => void) => () => void;
    };
  }
}
// --- End Bridge Definition ---

// --- The React Component (Simplified for Debugging) ---
function RenderHostApp() {
  const [currentSubtitleText, setCurrentSubtitleText] = useState('');

  useEffect(() => {
    console.log('[RenderHostApp] Setting up bridge listener...');
    window.renderHostBridge?.onUpdateSubtitle((text: string) => {
      console.log(`[RenderHostApp] Received text update via bridge: "${text}"`);
      setCurrentSubtitleText(text);
    });
    console.log('[RenderHostApp] Bridge listener setup complete.');

    return () => {
      // Cleanup listener if needed, although window closes anyway
      console.log('[RenderHostApp] Cleaning up...');
    };
  }, []);

  // Render simple div with inline styles
  // Use bright green background and large white text for easy visibility in PNGs
  return (
    <StyledSubtitleDisplay
      text={currentSubtitleText}
      isVisible={!!currentSubtitleText}
    />
  );
}
// --- End React Component ---

// --- React Mounting Logic ---
const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    const root = createRoot(rootElement);
    root.render(<RenderHostApp />);
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
