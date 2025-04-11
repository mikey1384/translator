import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './AppContent/index.js';
// Import i18n configuration
import './i18n.js';

let root: ReturnType<typeof createRoot> | null = null;

const renderApp = () => {
  const container = document.getElementById('root');
  if (!container) return;

  const loadingElement = container.querySelector('.loading');
  if (loadingElement) {
    container.removeChild(loadingElement);
  }

  if (!root) {
    root = createRoot(container);
  }

  root.render(
    <React.StrictMode>
      <Suspense fallback={<div>Loading translations...</div>}>
        <App />
      </Suspense>
    </React.StrictMode>
  );
};

// Initial render
renderApp();
