import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SUBTITLE_STYLE_PRESET,
  SUBTITLE_STYLE_PRESETS,
  SUBTITLE_STYLE_PRESET_ORDER,
  subtitleStyleUsesLineBox,
} from '../constants/subtitle-styles.js';
import {
  assColorToRgba,
  resolveSubtitleRenderTheme,
} from './subtitle-style-util.js';
import { resolveSubtitleRenderSpec } from './subtitle-render-spec.js';

const landscape = { videoWidthPx: 1920, videoHeightPx: 1080 };
const portrait = { videoWidthPx: 1080, videoHeightPx: 1920 };

test('every preset is offered in the picker and accepted by the render spec', () => {
  assert.deepEqual(
    [...SUBTITLE_STYLE_PRESET_ORDER].sort(),
    Object.keys(SUBTITLE_STYLE_PRESETS).sort()
  );
  for (const stylePreset of SUBTITLE_STYLE_PRESET_ORDER) {
    const spec = resolveSubtitleRenderSpec({
      displayMode: 'translation',
      stylePreset,
      baseFontSizePx: 30,
    });
    assert.equal(spec.stylePreset, stylePreset);
  }
});

test('the default is subtitle yellow with a fine dark edge', () => {
  assert.equal(DEFAULT_SUBTITLE_STYLE_PRESET, 'Cinema');
  assert.equal(
    assColorToRgba(SUBTITLE_STYLE_PRESETS.Cinema.primaryColor),
    'rgba(255,216,77,1.00)'
  );
  const theme = resolveSubtitleRenderTheme({
    stylePreset: 'Cinema',
    isMultiLine: false,
    displayFontSize: 40,
    ...landscape,
  });
  assert.ok(theme.textStrokeWidthPx >= 1.5);
});

test('Clean draws no outline in landscape or portrait', () => {
  for (const canvas of [landscape, portrait]) {
    const theme = resolveSubtitleRenderTheme({
      stylePreset: 'Clean',
      isMultiLine: false,
      displayFontSize: 40,
      ...canvas,
    });
    assert.equal(theme.textStrokeWidthPx, 0);
    assert.notEqual(theme.textShadow, 'none');
  }
});

test('Highlight draws a yellow band per line with no text shadow', () => {
  assert.ok(subtitleStyleUsesLineBox('Highlight'));
  assert.ok(subtitleStyleUsesLineBox('LineBox'));
  assert.ok(!subtitleStyleUsesLineBox('Cinema'));
  for (const canvas of [landscape, portrait]) {
    const theme = resolveSubtitleRenderTheme({
      stylePreset: 'Highlight',
      isMultiLine: false,
      displayFontSize: 40,
      ...canvas,
    });
    assert.equal(theme.lineBoxBackgroundColor, 'rgba(255, 216, 77, 1)');
    assert.equal(theme.textShadow, 'none');
  }
});
