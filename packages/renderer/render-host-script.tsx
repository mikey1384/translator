import {
  getSubtitleStyles,
  resolveSubtitleRenderTheme,
} from '../shared/helpers/subtitle-style-util.js';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../shared/constants/subtitle-styles.js';
import type {
  SubtitleRenderPart,
  SubtitleRenderState,
} from '@shared-types/app';
import {
  getVisibleTimedSubtitleParts,
  getVisibleTimedSubtitleText,
} from './timed-subtitle-visibility.js';

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

function splitTimedPartsIntoLines(
  parts: SubtitleRenderPart[]
): SubtitleRenderPart[][] {
  const lines: SubtitleRenderPart[][] = [[]];

  for (const part of parts) {
    if (part.kind === 'whitespace' && part.text.includes('\n')) {
      const pieces = part.text.split('\n');
      pieces.forEach((piece, index) => {
        if (piece) {
          lines.at(-1)!.push({ kind: 'whitespace', text: piece });
        }
        if (index < pieces.length - 1) {
          lines.push([]);
        }
      });
      continue;
    }

    lines.at(-1)!.push(part);
  }

  return lines;
}

function renderLineBoxLineHtml(
  lineHtml: string,
  renderTheme: ReturnType<typeof resolveSubtitleRenderTheme>
): string {
  return (
    `<span style="background-color:${renderTheme.lineBoxBackgroundColor};padding:${renderTheme.lineBoxPadding};display:inline;line-height:${renderTheme.lineHeight};white-space:pre-wrap;` +
    `overflow-wrap:anywhere;word-break:break-word;` +
    `border-radius:${renderTheme.lineBoxBorderRadiusPx}px;box-shadow:${renderTheme.lineBoxBoxShadow};` +
    `box-decoration-break:clone;-webkit-box-decoration-break:clone;">` +
    `${lineHtml || '&nbsp;'}` +
    `</span>`
  );
}

function renderPlainSubtitleHtml(
  text: string,
  stylePreset: SubtitleStylePresetKey,
  renderTheme: ReturnType<typeof resolveSubtitleRenderTheme>
): string {
  if (!text.trim()) {
    return '';
  }

  if (stylePreset === 'LineBox') {
    return text
      .split('\n')
      .map(line => renderLineBoxLineHtml(escapeHtml(line.trim()), renderTheme))
      .join('<br/>');
  }

  return escapeHtml(text);
}

function renderTimedPartHtml(part: SubtitleRenderPart): string {
  if (part.kind === 'whitespace') {
    return `<span style="white-space:pre-wrap;">${escapeHtml(part.text)}</span>`;
  }

  return `<span style="white-space:pre-wrap;font-weight:700;">${escapeHtml(part.text)}</span>`;
}

function renderTimedSubtitleHtml(
  state: Extract<SubtitleRenderState, { mode: 'timed' }>,
  stylePreset: SubtitleStylePresetKey,
  renderTheme: ReturnType<typeof resolveSubtitleRenderTheme>
): string {
  if (!state.text.trim()) {
    return '';
  }

  const visibleParts = getVisibleTimedSubtitleParts(state.parts);
  if (visibleParts.length === 0) {
    return '';
  }

  const lines = splitTimedPartsIntoLines(visibleParts);
  const renderedLines = lines.map(line =>
    line.map(part => renderTimedPartHtml(part)).join('')
  );

  if (stylePreset === 'LineBox') {
    return renderedLines
      .map(line => renderLineBoxLineHtml(line, renderTheme))
      .join('<br/>');
  }

  return renderedLines.join('<br/>');
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
  }: {
    fontSizePx?: number;
    stylePreset?: SubtitleStylePresetKey;
    isMultiLine?: boolean;
    videoWidthPx?: number;
    videoHeightPx?: number;
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
  });
  const dynamicClass = getSubtitleStyles({
    displayFontSize: fontSizePx,
    isFullScreen: false, // your headless renderer might treat the canvas as always full-screen
    stylePreset,
    isMultiLine,
    videoWidthPx,
    videoHeightPx,
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
    } = {}
  ) => {
    const el = document.getElementById('subtitle');
    if (!el) return;

    const {
      stylePreset = 'Default',
      fontSizePx,
      videoWidthPx,
      videoHeightPx,
    } = opts;
    const isMultiLine = state.text.includes('\n');
    const renderTheme = resolveSubtitleRenderTheme({
      displayFontSize: fontSizePx,
      isFullScreen: false,
      stylePreset,
      isMultiLine,
      videoWidthPx,
      videoHeightPx,
    });

    if (state.mode === 'timed') {
      el.innerHTML = renderTimedSubtitleHtml(state, stylePreset, renderTheme);
    } else {
      el.innerHTML = renderPlainSubtitleHtml(
        state.text,
        stylePreset,
        renderTheme
      );
    }

    applyPresetStyles(el, {
      fontSizePx,
      stylePreset,
      isMultiLine,
      videoWidthPx,
      videoHeightPx,
    });

    setSubtitleVisibility(
      el,
      state.mode === 'timed'
        ? getVisibleTimedSubtitleText(state.parts)
        : state.text
    );
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

  // @ts-expect-error...
  window.updateTimedSubtitle = (
    state: Extract<SubtitleRenderState, { mode: 'timed' }>,
    opts: {
      stylePreset?: SubtitleStylePresetKey;
      fontSizePx?: number;
      videoWidthPx?: number;
      videoHeightPx?: number;
    } = {}
  ) => {
    updateElementFromState(state, opts);
  };

  // @ts-expect-error...
  window.applySubtitlePreset = applySubtitlePreset;

  console.log(
    '[initializeSubtitleDisplay] Exposed functions on window: updateSubtitle, updateTimedSubtitle, applySubtitlePreset'
  );
}

// Run initialization when the script loads
initializeSubtitleDisplay();
