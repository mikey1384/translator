import {
  getSubtitleStyles,
  assColorToRgba,
} from '../shared/helpers/subtitle-style-util.js';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../shared/constants/subtitle-styles.js';

function applyPresetStyles(
  el: HTMLElement | null,
  {
    fontSizePx = 24,
    stylePreset = 'Default',
    isMultiLine = false,
  }: {
    fontSizePx?: number;
    stylePreset?: SubtitleStylePresetKey;
    isMultiLine?: boolean;
  } = {}
) {
  if (!el) return;
  const dynamicClass = getSubtitleStyles({
    displayFontSize: fontSizePx,
    isFullScreen: false, // your headless renderer might treat the canvas as always full-screen
    stylePreset,
    isMultiLine,
  });
  el.className = dynamicClass;
  el.style.fontSize = fontSizePx + 'px';
}

export function applySubtitlePreset(preset: SubtitleStylePresetKey) {
  console.log('[applySubtitlePreset] Applying preset:', preset);
  const el = document.getElementById('subtitle');
  if (el && SUBTITLE_STYLE_PRESETS[preset]) {
    // Forward the preset so we don't fall back to "Default"
    applyPresetStyles(el, { stylePreset: preset });
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
      // Minimal inline styles; the dynamic class will control layout
      subtitleEl.style.position = 'absolute';
      subtitleEl.style.bottom = '10px';
      subtitleEl.style.textAlign = 'center';
      subtitleEl.style.pointerEvents = 'none';
      rootElement.appendChild(subtitleEl);
    }
    // Apply default preset on init
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
      subtitleEl.style.textAlign = 'center';
      subtitleEl.style.pointerEvents = 'none';
      document.body.appendChild(subtitleEl);
    }
    applyPresetStyles(subtitleEl);
  }

  // @ts-expect-error...
  window.updateSubtitle = (
    text: string,
    opts: { stylePreset?: SubtitleStylePresetKey; fontSizePx?: number } = {}
  ) => {
    const el = document.getElementById('subtitle');
    if (!el) return;

    const { stylePreset = 'Default', fontSizePx } = opts;
    const isMultiLine = text.includes('\n');

    /* ---------- render text ---------- */
    if (stylePreset === 'LineBox') {
      // replicate the editor's per-line <span> backgrounds
      const bg = assColorToRgba(
        SUBTITLE_STYLE_PRESETS.LineBox.backColor || '&H00000000'
      );
      const esc = (s: string) =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .trim();

      if (text.trim()) {
        const html = text
          .split('\n')
          .map(line =>
            `<span style="background-color:${bg};padding:1px 6px;display:inline;line-height:1.5;white-space:pre-wrap;` +
            `overflow-wrap:anywhere;word-break:break-word;` +
            `box-decoration-break:clone;-webkit-box-decoration-break:clone;">` +
            `${esc(line)}` +
            `</span>`
          )
          .join('<br/>');
        el.innerHTML = html;
      } else {
        el.innerHTML = '';
      }
    } else {
      el.textContent = text;
    }

    applyPresetStyles(el, { fontSizePx, stylePreset, isMultiLine });

    if (text.trim()) {
      el.classList.add('visible'); // show subtitle if there's content
    } else {
      el.classList.remove('visible'); // hide if empty
    }
  };

  // @ts-expect-error...
  window.applySubtitlePreset = applySubtitlePreset;

  console.log(
    '[initializeSubtitleDisplay] Exposed functions on window: updateSubtitle, applySubtitlePreset'
  );
}

// Run initialization when the script loads
initializeSubtitleDisplay();
