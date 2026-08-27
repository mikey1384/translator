import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSubtitleLineBoxLineText,
  resolveSubtitleLineBoxStyle,
  resolveSubtitleRenderTheme,
  subtitleLineBoxStyleToCssText,
} from './subtitle-style-util.js';
import { resolveSubtitleRenderSpec } from './subtitle-render-spec.js';

for (const isMultiLine of [false, true]) {
  test(`preview and master share LineBox semantics (multiline=${isMultiLine})`, () => {
    const previewSpec = resolveSubtitleRenderSpec({
      displayMode: 'translation',
      stylePreset: 'LineBox',
      baseFontSizePx: 40,
      videoWidthPx: 1920,
      videoHeightPx: 1080,
      displayWidthPx: 1920,
      displayHeightPx: 1080,
    });
    const masterSpec = resolveSubtitleRenderSpec({
      displayMode: 'translation',
      stylePreset: 'LineBox',
      baseFontSizePx: 40,
      videoWidthPx: 1920,
      videoHeightPx: 1080,
      displayWidthPx: 1920,
      displayHeightPx: 1080,
    });
    const previewTheme = resolveSubtitleRenderTheme({
      displayFontSize: previewSpec.outputFontSizePx,
      stylePreset: previewSpec.stylePreset,
      isMultiLine,
      videoWidthPx: previewSpec.displayWidthPx,
      videoHeightPx: previewSpec.displayHeightPx,
    });
    const masterTheme = resolveSubtitleRenderTheme({
      displayFontSize: masterSpec.outputFontSizePx,
      stylePreset: masterSpec.stylePreset,
      isMultiLine,
      videoWidthPx: masterSpec.displayWidthPx,
      videoHeightPx: masterSpec.displayHeightPx,
    });

    assert.deepEqual(masterSpec, previewSpec);
    assert.deepEqual(masterTheme, previewTheme);
    assert.equal(masterTheme.fontSizePx, 60);
    assert.match(masterTheme.fontFamily, /Noto Sans/);
    assert.equal(masterTheme.lineBoxBackgroundColor, 'rgba(0,0,0,0.80)');
    assert.equal(masterTheme.lineBoxPadding, '1px 6px');
    assert.equal(masterTheme.textStrokeWidthPx, 0);
    assert.equal(masterTheme.textShadow, 'none');

    const lineBoxStyle = resolveSubtitleLineBoxStyle(masterTheme);
    assert.equal(lineBoxStyle.backgroundColor, 'rgba(0,0,0,0.80)');
    assert.equal(lineBoxStyle.padding, '1px 6px');
    assert.equal(lineBoxStyle.boxDecorationBreak, 'clone');
    assert.equal(lineBoxStyle.WebkitBoxDecorationBreak, 'clone');
    assert.match(
      subtitleLineBoxStyleToCssText(lineBoxStyle),
      /background-color:rgba\(0,0,0,0\.80\)/
    );
  });
}

test('preview and master normalize LineBox edge whitespace identically', () => {
  assert.equal(
    normalizeSubtitleLineBoxLineText('  translated line  '),
    'translated line'
  );
  assert.equal(normalizeSubtitleLineBoxLineText('   '), '\u00a0');
});
