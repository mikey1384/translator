import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

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
  const [subtitleText, setSubtitleText] = useState('[Waiting for text...]'); // Initial text

  useEffect(() => {
    console.log(
      '[RenderHostApp] Component mounted. Subscribing to subtitle updates via bridge...'
    );

    const cleanupListener = window.renderHostBridge.onUpdateSubtitle(
      newText => {
        console.log(`[RenderHostApp] Received text update: "${newText}"`); // Log received text
        setSubtitleText(newText);
      }
    );

    console.log(
      '[RenderHostApp] Subscription to subtitle updates established.'
    );

    return () => {
      console.log(
        '[RenderHostApp] Component unmounting. Cleaning up subtitle update listener.'
      );
      cleanupListener();
    };
  }, []);

  // Render simple div with inline styles
  // Use bright green background and large white text for easy visibility in PNGs
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '10%', // Position it somewhere
        left: 0,
        width: '100%',
        padding: '20px',
        backgroundColor: subtitleText ? 'rgba(0, 255, 0, 0.7)' : 'transparent', // Green background only if text exists
        color: 'white',
        fontSize: '40px', // Large font
        fontWeight: 'bold',
        textAlign: 'center',
        fontFamily: 'sans-serif',
        textShadow: '2px 2px 4px rgba(0,0,0,0.8)', // Text shadow for contrast
        visibility: subtitleText ? 'visible' : 'hidden', // Use visibility instead of opacity
        whiteSpace: 'pre-wrap', // Handle multiple lines
      }}
    >
      {subtitleText || '.'}{' '}
      {/* Render text or a dot if empty to ensure element exists */}
    </div>
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
