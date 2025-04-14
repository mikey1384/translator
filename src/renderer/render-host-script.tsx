import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import StyledSubtitleDisplay from './components/StyledSubtitleDisplay.js';

const RenderHostApp: React.FC = () => {
  const [subtitleText, setSubtitleText] = useState<string>('');

  useEffect(() => {
    console.log('[RenderHostApp] Exposing window.updateSubtitle function...');
    window.updateSubtitle = (newText: string) => {
      setSubtitleText(newText || '');
    };
    console.info('[RenderHostApp] window.updateSubtitle function exposed.');

    return () => {
      console.log(
        '[RenderHostApp] Cleaning up window.updateSubtitle function.'
      );
      delete window.updateSubtitle;
    };
  }, []);

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent';
    const rootElement = document.getElementById('render-host-root');
    if (rootElement) {
      rootElement.style.backgroundColor = 'transparent';
    }
  }, []);

  return (
    <div
      style={{ backgroundColor: 'transparent', width: '100%', height: '100%' }}
    >
      <StyledSubtitleDisplay
        text={subtitleText}
        isVisible={subtitleText !== ''}
      />
    </div>
  );
};

const container = document.getElementById('render-host-root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <RenderHostApp />
    </React.StrictMode>
  );
} else {
  console.error(
    'Could not find root element #render-host-root to mount React app.'
  );
}
