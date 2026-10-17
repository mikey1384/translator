import { editorialCaptionHtml } from '../shared/helpers/editorial-caption-html.js';
import {
  getSubtitleStyles,
  normalizeSubtitleLineBoxLineText,
  resolveSubtitleLineBoxStyle,
  resolveSubtitleRenderTheme,
  subtitleLineBoxStyleToCssText,
  subtitleTextUsesMultipleLines,
} from '../shared/helpers/subtitle-style-util.js';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
  subtitleStyleUsesLineBox,
  type SubtitleTypeface,
} from '../shared/constants/subtitle-styles.js';
import type { SubtitleRenderState } from '@shared-types/app';

const renderTarget = {
  width: undefined as number | undefined,
  height: undefined as number | undefined,
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderLineBoxLineHtml(
  lineHtml: string,
  renderTheme: ReturnType<typeof resolveSubtitleRenderTheme>
): string {
  const style = subtitleLineBoxStyleToCssText(
    resolveSubtitleLineBoxStyle(renderTheme)
  );
  return `<span style="${style}">${lineHtml || '&nbsp;'}</span>`;
}

function renderPlainSubtitleHtml(
  text: string,
  stylePreset: SubtitleStylePresetKey,
  renderTheme: ReturnType<typeof resolveSubtitleRenderTheme>
): string {
  if (!text.trim()) {
    return '';
  }

  if (subtitleStyleUsesLineBox(stylePreset)) {
    return text
      .split('\n')
      .map(line =>
        renderLineBoxLineHtml(
          escapeHtml(normalizeSubtitleLineBoxLineText(line)),
          renderTheme
        )
      )
      .join('<br/>');
  }

  return escapeHtml(text);
}

function setSubtitleVisibility(el: HTMLElement, text: string) {
  if (text.trim()) {
    el.classList.add('visible');
  } else {
    el.classList.remove('visible');
  }
}

function applyPresetStyles(
  el: HTMLElement | null,
  {
    fontSizePx = 24,
    stylePreset = 'Default',
    isMultiLine = false,
    videoWidthPx = renderTarget.width,
    videoHeightPx = renderTarget.height,
    typeface,
  }: {
    fontSizePx?: number;
    stylePreset?: SubtitleStylePresetKey;
    isMultiLine?: boolean;
    videoWidthPx?: number;
    videoHeightPx?: number;
    typeface?: SubtitleTypeface;
  } = {}
) {
  if (!el) return;
  const theme = resolveSubtitleRenderTheme({
    displayFontSize: fontSizePx,
    isFullScreen: false,
    stylePreset,
    isMultiLine,
    videoWidthPx,
    videoHeightPx,
    typeface,
  });
  const dynamicClass = getSubtitleStyles({
    displayFontSize: fontSizePx,
    isFullScreen: false, // your headless renderer might treat the canvas as always full-screen
    stylePreset,
    isMultiLine,
    videoWidthPx,
    videoHeightPx,
    typeface,
  });
  el.className = dynamicClass;
  el.style.fontSize = theme.fontSizePx + 'px';
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
  renderTarget.width = window.innerWidth || undefined;
  renderTarget.height = window.innerHeight || undefined;

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
      subtitleEl.style.textAlign = 'center';
      subtitleEl.style.pointerEvents = 'none';
      document.body.appendChild(subtitleEl);
    }
    applyPresetStyles(subtitleEl);
  }

  const updateElementFromState = (
    state: SubtitleRenderState,
    opts: {
      stylePreset?: SubtitleStylePresetKey;
      fontSizePx?: number;
      videoWidthPx?: number;
      videoHeightPx?: number;
      typeface?: SubtitleTypeface;
    } = {}
  ) => {
    const el = document.getElementById('subtitle');
    if (!el) return;
    if (state.mode === 'editorial') {
      el.className = '';
      el.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;opacity:1;transform:none;margin:0;padding:0;max-width:none;';
      el.innerHTML = editorialCaptionHtml(
        state,
        opts.videoWidthPx ?? window.innerWidth
      );
      return;
    }
    el.style.cssText = '';

    const {
      stylePreset = 'Default',
      fontSizePx,
      videoWidthPx,
      videoHeightPx,
      typeface,
    } = opts;
    const renderWithLineState = (isMultiLine: boolean) => {
      const renderTheme = resolveSubtitleRenderTheme({
        displayFontSize: fontSizePx,
        isFullScreen: false,
        stylePreset,
        isMultiLine,
        videoWidthPx,
        videoHeightPx,
        typeface,
      });

      el.innerHTML = renderPlainSubtitleHtml(
        state.text,
        stylePreset,
        renderTheme
      );

      applyPresetStyles(el, {
        fontSizePx,
        stylePreset,
        isMultiLine,
        videoWidthPx,
        videoHeightPx,
        typeface,
      });
    };

    let isMultiLine = state.text.includes('\n');
    renderWithLineState(isMultiLine);
    if (!isMultiLine && subtitleTextUsesMultipleLines(el, state.text)) {
      isMultiLine = true;
      renderWithLineState(isMultiLine);
    }

    setSubtitleVisibility(el, state.text);
  };

  // @ts-expect-error...
  window.updateSubtitle = (
    text: string,
    opts: {
      stylePreset?: SubtitleStylePresetKey;
      fontSizePx?: number;
      videoWidthPx?: number;
      videoHeightPx?: number;
    } = {}
  ) => {
    updateElementFromState({ mode: 'plain', text }, opts);
  };

  // @ts-expect-error provided by this isolated render host
  window.updateEditorialSubtitle = updateElementFromState;

  // @ts-expect-error...
  window.applySubtitlePreset = applySubtitlePreset;

  console.log(
    '[initializeSubtitleDisplay] Exposed functions on window: updateSubtitle, applySubtitlePreset'
  );
}

// Run initialization when the script loads
initializeSubtitleDisplay();
