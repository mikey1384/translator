import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSubtitleLineBoxLineText,
  resolveSubtitleLineBoxStyle,
  resolveSubtitleRenderTheme,
  subtitleLineBoxStyleToCssText,
} from './subtitle-style-util.js';
import {
  parseSubtitleRenderSpec,
  resolveSubtitleRenderSpec,
  serializeSubtitleRenderSpec,
  subtitleRenderGeometry,
} from './subtitle-render-spec.js';

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
    assert.match(masterTheme.fontFamily, /^'Pretendard Variable'/);
    assert.match(masterTheme.fontFamily, /Noto Sans/);
    assert.equal(masterTheme.bottom, '8.5%');
    assert.equal(masterTheme.fontWeight, 600);
    assert.equal(masterTheme.lineBoxBackgroundColor, 'rgba(12, 14, 18, 0.78)');
    assert.equal(masterTheme.lineBoxPadding, '5.4px 24.6px 9px');
    assert.equal(masterTheme.lineBoxBorderRadiusPx, 15.6);
    assert.equal(masterTheme.textStrokeWidthPx, 0);
    assert.equal(masterTheme.textShadow, 'none');

    const lineBoxStyle = resolveSubtitleLineBoxStyle(masterTheme);
    assert.equal(lineBoxStyle.backgroundColor, 'rgba(12, 14, 18, 0.78)');
    assert.equal(lineBoxStyle.padding, '5.4px 24.6px 9px');
    assert.equal(lineBoxStyle.borderRadius, '15.6px');
    assert.equal(lineBoxStyle.boxDecorationBreak, 'clone');
    assert.equal(lineBoxStyle.WebkitBoxDecorationBreak, 'clone');
    assert.match(
      subtitleLineBoxStyleToCssText(lineBoxStyle),
      /background-color:rgba\(12, 14, 18, 0\.78\)/
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

test('landscape Default uses a font-relative outline and soft shadow', () => {
  const theme = resolveSubtitleRenderTheme({
    displayFontSize: 58,
    stylePreset: 'Default',
    isMultiLine: true,
    videoWidthPx: 1920,
    videoHeightPx: 1080,
  });

  assert.equal(theme.fontWeight, 600);
  assert.equal(theme.bottom, '8.5%');
  assert.equal(theme.textStrokeWidthPx, 6);
  assert.equal(theme.textStrokeColor, 'rgba(0, 0, 0, 0.92)');
  assert.equal(theme.textShadow, '0 2.9px 9.9px rgba(0, 0, 0, 0.55)');
});

test('portrait short-form tuning is untouched by landscape tuning', () => {
  const theme = resolveSubtitleRenderTheme({
    displayFontSize: 60,
    stylePreset: 'LineBox',
    isMultiLine: false,
    videoWidthPx: 1080,
    videoHeightPx: 1920,
  });

  assert.equal(theme.bottom, '18%');
  assert.equal(theme.lineBoxBackgroundColor, 'rgba(12, 14, 18, 0.88)');
  assert.equal(theme.lineBoxPadding, '4px 14px 5px 14px');
  assert.match(theme.fontFamily, /^'Pretendard Variable'/);
});

test('audio-only render geometry matches its own spec', () => {
  const spec = resolveSubtitleRenderSpec({
    displayMode: 'original',
    stylePreset: 'Default',
    baseFontSizePx: 32,
    videoWidthPx: 0,
    videoHeightPx: 0,
    isAudioOnly: true,
  });
  const geometry = subtitleRenderGeometry(spec);
  const parsed = parseSubtitleRenderSpec(serializeSubtitleRenderSpec(spec));
  assert.equal(geometry.videoWidth, parsed.videoWidthPx);
  assert.equal(geometry.videoHeight, parsed.videoHeightPx);
  assert.equal(geometry.displayWidth, parsed.displayWidthPx);
  assert.equal(geometry.displayHeight, parsed.displayHeightPx);
  assert.equal(geometry.fontSizePx, parsed.outputFontSizePx);
  assert.equal(geometry.overlayMode, 'blackVideo');
  assert.equal(geometry.displayWidth, 1280);
  assert.equal(geometry.displayHeight, 720);
});

test('portrait text is smaller than the raw height-scaled size', () => {
  const spec = resolveSubtitleRenderSpec({
    displayMode: 'dual',
    stylePreset: 'Cinema',
    baseFontSizePx: 38,
    videoWidthPx: 720,
    videoHeightPx: 1280,
  });
  const theme = resolveSubtitleRenderTheme({
    displayFontSize: spec.outputFontSizePx,
    stylePreset: 'Cinema',
    isMultiLine: true,
    videoWidthPx: 720,
    videoHeightPx: 1280,
  });
  assert.equal(spec.outputFontSizePx, 68);
  // 68 × 1.08 × 0.72 ≈ 53px on a 720px-wide frame (was 73px).
  assert.ok(Math.abs(theme.fontSizePx - 52.88) < 0.01, `${theme.fontSizePx}`);
});
