import { getSubtitleStyles } from '../shared/helpers/subtitle-style-util.js';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../shared/constants/subtitle-styles.js';

function applyPresetStyles(
  el: HTMLElement | null,
  { fontSizePx = 24, stylePreset = 'Default', isMultiLine = false } = {}
) {
  if (!el) return;
  const dynamicClass = getSubtitleStyles({
    displayFontSize: fontSizePx,
    isFullScreen: false, // renderer is always full-res canvas
    stylePreset,
    isMultiLine,
  });
  el.className = dynamicClass;
}

// ─────────────────────────────────────────────────────────────────────
// The rest is unchanged; your existing export functions remain the same
// ─────────────────────────────────────────────────────────────────────

export function applySubtitlePreset(preset: SubtitleStylePresetKey) {
  console.log('[applySubtitlePreset] Applying preset:', preset);
  if (SUBTITLE_STYLE_PRESETS[preset]) {
    const el = document.getElementById('subtitle');
    const currentFont =
      Number(
        getComputedStyle(document.documentElement)
          .getPropertyValue('--subtitle-font-size')
          .replace('px', '')
      ) || 24;

    applyPresetStyles(el, {
      fontSizePx: currentFont,
      stylePreset: preset,
      isMultiLine: el?.innerText.includes('\n') ?? false,
    });
  } else {
    console.warn(`Preset key "${preset}" not found.`);
  }
}

function initializeSubtitleDisplay() {
  console.log('[initializeSubtitleDisplay] Initializing...');
  document.body.style.backgroundColor = 'transparent';

  const rootElement = document.getElementById('render-host-root');
  if (rootElement) {
    rootElement.style.backgroundColor = 'transparent';
    let subtitleEl = document.getElementById('subtitle');
    if (!subtitleEl) {
      console.warn(
        '#subtitle element not found in DOM. Creating one inside #render-host-root.'
      );
      subtitleEl = document.createElement('div');
      subtitleEl.id = 'subtitle';
      subtitleEl.style.position = 'absolute';
      subtitleEl.style.bottom = '10px';
      subtitleEl.style.left = '50%';
      subtitleEl.style.transform = 'translateX(-50%)';
      subtitleEl.style.textAlign = 'center';
      subtitleEl.style.width = '90%';
      rootElement.appendChild(subtitleEl);
    }
    // Apply default preset styles
    applyPresetStyles(subtitleEl);
  } else {
    console.error('Could not find root element #render-host-root.');
    let subtitleEl = document.getElementById('subtitle');
    if (!subtitleEl) {
      console.warn('#subtitle element not found in body. Creating one.');
      subtitleEl = document.createElement('div');
      subtitleEl.id = 'subtitle';
      subtitleEl.style.position = 'absolute';
      subtitleEl.style.bottom = '10px';
      subtitleEl.style.left = '50%';
      subtitleEl.style.transform = 'translateX(-50%)';
      subtitleEl.style.textAlign = 'center';
      subtitleEl.style.width = '90%';
      document.body.appendChild(subtitleEl);
    }
    applyPresetStyles(subtitleEl);
  }

  // Expose these functions globally if needed
  // @ts-ignore
  window.updateSubtitle = (text, opts = {}) => {
    const el = document.getElementById('subtitle');
    if (!el) return;
    el.innerText = text;
    const isMultiLine = text.includes('\n');
    applyPresetStyles(el, { ...opts, isMultiLine });
  };
  // @ts-ignore
  window.applySubtitlePreset = applySubtitlePreset;

  console.log(
    '[initializeSubtitleDisplay] Exposed functions on window: updateSubtitle, applySubtitlePreset'
  );
}

// Run initialization when the script loads
initializeSubtitleDisplay();
