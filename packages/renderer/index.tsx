import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './AppContent/index.js';
import initI18nPromise from './i18n.js';
import './highlight.css';

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

initI18nPromise
  .then(() => {
    console.log('[index] i18n initialization complete, rendering app');
    renderApp();
  })
  .catch(error => {
    console.error('[index] Error initializing i18n:', error);
    renderApp();
  });

/* ------------------------------------------------------------------ */
/* 🔥  HMR – safe for both ESM (Vite) and CJS (Webpack) bundles        */
/* ------------------------------------------------------------------ */
const hot =
  (import.meta as any).hot ??
  (typeof module !== 'undefined' ? (module as any).hot : undefined);

if (hot) {
  hot.accept?.();
  hot.dispose?.(() => window.location.reload());
}
