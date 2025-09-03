import './listeners';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './AppContent/index.js';
import { logSystem } from './utils/logger.js';
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
      <App />
    </React.StrictMode>
  );
};

initI18nPromise
  .then(() => {
    console.log('[index] i18n initialization complete, rendering app');
    try {
      (async () => {
        try {
          const info = await (window as any).electron.getSystemInfo?.();
          if (info) logSystem(info);
          else {
            const ua = navigator.userAgent;
            const platform = (navigator as any).userAgentData?.platform || navigator.platform;
            logSystem({ platform, ua });
          }
        } catch (e) {
          // ignore
        }
      })();
    } catch {}
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
