import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSubtitleLineBoxLineText,
  resolveSubtitleLineBoxStyle,
  resolveSubtitleRenderTheme,
  subtitleCueHtml,
  subtitleLineBoxStyleToCssText,
} from './subtitle-style-util.js';
import {
  parseSubtitleRenderSpec,
  resolveSubtitleRenderFrame,
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

for (const [label, meta] of [
  ['no frame size', { width: undefined, height: undefined }],
  ['zero frame size', { width: 0, height: 0 }],
] as const) {
  test(`audio-only player overlay uses the export's frame (${label})`, () => {
    // The export request (EditSubtitles): the spec from the file's metadata.
    const exportSpec = resolveSubtitleRenderSpec({
      displayMode: 'original',
      stylePreset: 'Default',
      baseFontSizePx: 38,
      videoWidthPx: meta.width,
      videoHeightPx: meta.height,
      displayWidthPx: meta.width,
      displayHeightPx: meta.height,
      isAudioOnly: true,
    });
    const exportGeometry = subtitleRenderGeometry(exportSpec);
    // The player overlay (NativeVideoPlayer): the same metadata as props.
    const playerFrame = resolveSubtitleRenderFrame({
      baseFontSizePx: 38,
      videoWidthPx: meta.width ?? null,
      videoHeightPx: meta.height ?? null,
      displayWidthPx: meta.width ?? null,
      displayHeightPx: meta.height ?? null,
      isAudioOnly: true,
    });

    assert.equal(playerFrame.displayWidthPx, exportGeometry.displayWidth);
    assert.equal(playerFrame.displayHeightPx, exportGeometry.displayHeight);
    assert.equal(playerFrame.fontSizePx, exportGeometry.fontSizePx);
    assert.equal(playerFrame.displayWidthPx, 1280);
    assert.equal(playerFrame.displayHeightPx, 720);
    assert.equal(playerFrame.fontSizePx, 38);

    for (const isMultiLine of [false, true]) {
      const playerTheme = resolveSubtitleRenderTheme({
        displayFontSize: playerFrame.fontSizePx,
        stylePreset: 'Default',
        isMultiLine,
        videoWidthPx: playerFrame.displayWidthPx,
        videoHeightPx: playerFrame.displayHeightPx,
      });
      const exportTheme = resolveSubtitleRenderTheme({
        displayFontSize: exportGeometry.fontSizePx,
        stylePreset: exportGeometry.stylePreset,
        isMultiLine,
        videoWidthPx: exportGeometry.displayWidth,
        videoHeightPx: exportGeometry.displayHeight,
      });
      assert.deepEqual(playerTheme, exportTheme);
    }
  });
}

test('player and export frames agree for video, including display size', () => {
  const props = {
    videoWidthPx: 1920,
    videoHeightPx: 1080,
    displayWidthPx: 1080,
    displayHeightPx: 1920,
  };
  const spec = resolveSubtitleRenderSpec({
    displayMode: 'dual',
    stylePreset: 'Cinema',
    baseFontSizePx: 32,
    ...props,
  });
  const frame = resolveSubtitleRenderFrame({ baseFontSizePx: 32, ...props });
  const geometry = subtitleRenderGeometry(spec);
  assert.equal(frame.displayWidthPx, geometry.displayWidth);
  assert.equal(frame.displayHeightPx, geometry.displayHeight);
  assert.equal(frame.fontSizePx, geometry.fontSizePx);
});

test('cue markup gives every line its own reading direction', () => {
  const theme = resolveSubtitleRenderTheme({
    displayFontSize: 40,
    stylePreset: 'Default',
    isMultiLine: true,
    videoWidthPx: 1280,
    videoHeightPx: 720,
  });
  const html = subtitleCueHtml(
    'مرحبا بالعالم، هذا اختبار 123 مع English كلمات\nHello <b> & "you"',
    'Default',
    theme
  );
  assert.equal(
    html,
    '<span dir="auto">مرحبا بالعالم، هذا اختبار 123 مع English كلمات</span>' +
      '<br/><span dir="auto">Hello &lt;b&gt; &amp; &quot;you&quot;</span>'
  );
  assert.equal(subtitleCueHtml('   ', 'Default', theme), '');
});

test('LineBox cue markup keeps one box per line, each with dir="auto"', () => {
  const theme = resolveSubtitleRenderTheme({
    displayFontSize: 40,
    stylePreset: 'LineBox',
    isMultiLine: true,
    videoWidthPx: 1280,
    videoHeightPx: 720,
  });
  const css = subtitleLineBoxStyleToCssText(resolveSubtitleLineBoxStyle(theme));
  const html = subtitleCueHtml('  one  \n\nthree', 'LineBox', theme);
  assert.equal(
    html,
    [
      `<span dir="auto" style="${css}">one</span>`,
      `<span dir="auto" style="${css}">\u00a0</span>`,
      `<span dir="auto" style="${css}">three</span>`,
    ].join('<br/>')
  );
});
