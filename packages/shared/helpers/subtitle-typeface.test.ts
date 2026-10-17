import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findSubtitlePreviewSelectionDrift,
  parseSubtitleRenderSpec,
  resolveSubtitleRenderSpec,
  serializeSubtitleRenderSpec,
} from './subtitle-render-spec.js';
import { highlightCaptionSignature } from './highlight-clips.js';
import { resolveSubtitleRenderTheme } from './subtitle-style-util.js';

const base = {
  displayMode: 'translation' as const,
  stylePreset: 'Cinema' as const,
  baseFontSizePx: 38,
  videoWidthPx: 1920,
  videoHeightPx: 1080,
};

test('the default face is omitted, so older specs stay canonical', () => {
  const plain = serializeSubtitleRenderSpec(resolveSubtitleRenderSpec(base));
  assert.equal('typeface' in plain, false);
  assert.equal(parseSubtitleRenderSpec(plain).typeface, 'sans');
});

test('a chosen face round-trips through the render spec', () => {
  const spec = serializeSubtitleRenderSpec(
    resolveSubtitleRenderSpec({ ...base, typeface: 'serif' })
  );
  assert.equal(spec.typeface, 'serif');
  assert.equal(parseSubtitleRenderSpec(spec).typeface, 'serif');
  assert.throws(() => parseSubtitleRenderSpec({ ...spec, typeface: 'comic' }));
});

test('changing the face after planning is caught', () => {
  const planned = {
    ...serializeSubtitleRenderSpec(
      resolveSubtitleRenderSpec({ ...base, typeface: 'serif' })
    ),
    selection_binding_version: 1,
    field_sources: {
      display_mode: 'translator_preview',
      style: 'translator_preview',
      base_font_size_px: 'translator_preview',
      typeface: 'translator_preview',
    },
  };
  assert.deepEqual(
    findSubtitlePreviewSelectionDrift(planned, { ...base, typeface: 'serif' }),
    []
  );
  assert.deepEqual(
    findSubtitlePreviewSelectionDrift(planned, {
      ...base,
      typeface: 'display',
    }),
    ['typeface']
  );
});

test('clips rendered in another face are not current', () => {
  const segments: never[] = [];
  const sans = highlightCaptionSignature(segments, 'dual', 'Cinema', 38);
  assert.equal(
    highlightCaptionSignature(segments, 'dual', 'Cinema', 38, 'sans'),
    sans
  );
  assert.notEqual(
    highlightCaptionSignature(segments, 'dual', 'Cinema', 38, 'serif'),
    sans
  );
});

test('each face resolves to its own font stack', () => {
  const stack = (typeface: 'sans' | 'classic' | 'serif' | 'display') =>
    resolveSubtitleRenderTheme({ ...base, typeface, isMultiLine: false })
      .fontFamily;
  assert.match(stack('sans'), /^'Pretendard Variable'/);
  assert.match(stack('classic'), /Helvetica/);
  assert.match(stack('serif'), /^Georgia/);
  assert.match(stack('display'), /^'Bricolage Grotesque'/);
});
