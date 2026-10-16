import './listeners';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './AppContent/index.js';
import { logSystem } from './utils/logger.js';
import initI18nPromise from './i18n.js';
import './highlight.css';
import { fonts } from './styles.js';

function ensureNotoSansLoaded(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('noto-sans-font')) return;

  const baseUrl =
    typeof window !== 'undefined' && window.location
      ? window.location.href
      : import.meta.url;
  const fontUrl = new URL(
    './assets/fonts/NotoSans-Regular.ttf',
    baseUrl
  ).toString();

  const pretendardUrl = new URL(
    './assets/fonts/PretendardVariable.woff2',
    baseUrl
  ).toString();

  const local = (file: string) =>
    new URL(`./assets/fonts/${file}`, baseUrl).toString();
  // Google Fonts subset ranges, so each file loads only when its glyphs appear.
  const LATIN =
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
  const LATIN_EXT =
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF';
  const VIETNAMESE =
    'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB';
  const face = (
    family: string,
    file: string,
    weight: string,
    range: string
  ) => `
    @font-face {
      font-family: '${family}';
      src: url('${local(file)}') format('woff2');
      font-weight: ${weight};
      font-style: normal;
      font-display: swap;
      unicode-range: ${range};
    }`;
  const brandFaces = [
    face(
      'Bricolage Grotesque',
      'BricolageGrotesque-latin.woff2',
      '200 800',
      LATIN
    ),
    face(
      'Bricolage Grotesque',
      'BricolageGrotesque-latin-ext.woff2',
      '200 800',
      LATIN_EXT
    ),
    face(
      'Bricolage Grotesque',
      'BricolageGrotesque-vietnamese.woff2',
      '200 800',
      VIETNAMESE
    ),
    face('Instrument Sans', 'InstrumentSans-latin.woff2', '400 700', LATIN),
    face(
      'Instrument Sans',
      'InstrumentSans-latin-ext.woff2',
      '400 700',
      LATIN_EXT
    ),
  ].join('');

  const style = document.createElement('style');
  style.id = 'noto-sans-font';
  style.textContent = `
    @font-face {
      font-family: 'Noto Sans';
      src: url('${fontUrl}') format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Noto Sans';
      src: url('${fontUrl}') format('truetype');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Pretendard Variable';
      src: url('${pretendardUrl}') format('woff2-variations');
      font-weight: 45 920;
      font-style: normal;
      font-display: swap;
    }
    ${brandFaces}
    body {
      font-family: ${fonts.body};
      -webkit-font-smoothing: antialiased;
    }
    button, input, select, textarea {
      font-family: inherit;
    }
    h1, h2, h3 {
      font-family: ${fonts.display};
      letter-spacing: -0.015em;
    }
  `;
  document.head.appendChild(style);
}

ensureNotoSansLoaded();

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
            const platform =
              (navigator as any).userAgentData?.platform || navigator.platform;
            logSystem({ platform, ua });
          }
        } catch {
          // ignore
        }
      })();
    } catch {
      // ignore
    }
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
