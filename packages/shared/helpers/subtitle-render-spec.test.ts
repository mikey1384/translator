import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SUBTITLE_OUTPUT_FONT_SIZE,
  findSubtitlePreviewSelectionDrift,
  parseSubtitleRenderSpec,
  resolveSubtitleOutputFontSize,
  resolveSubtitleRenderSpec,
  serializeSubtitleRenderSpec,
} from './subtitle-render-spec.js';

test('subtitle render spec resolves the approved LineBox preview at 1080p', () => {
  const spec = resolveSubtitleRenderSpec({
    displayMode: 'translation',
    stylePreset: 'LineBox',
    baseFontSizePx: 40,
    videoWidthPx: 1920,
    videoHeightPx: 1080,
    displayWidthPx: 1920,
    displayHeightPx: 1080,
  });

  assert.equal(spec.schemaVersion, 1);
  assert.equal(spec.displayMode, 'translation');
  assert.equal(spec.stylePreset, 'LineBox');
  assert.equal(spec.baseFontSizePx, 40);
  assert.equal(spec.outputFontSizePx, 60);
  assert.equal(spec.fontFamily, 'Noto Sans');
  assert.equal(spec.fontAsset, 'NotoSans-Regular.ttf');
  assert.deepEqual(serializeSubtitleRenderSpec(spec), {
    schema_version: 1,
    display_mode: 'translation',
    style: 'LineBox',
    base_font_size_px: 40,
    output_font_size_px: 60,
    video_width_px: 1920,
    video_height_px: 1080,
    display_width_px: 1920,
    display_height_px: 1080,
    audio_only: false,
    font_family: 'Noto Sans',
    font_asset: 'NotoSans-Regular.ttf',
    scale_rule: 'height_ratio_720_clamped_0.5_2',
  });
});

test('preview and master output sizes use the same height rule', () => {
  assert.equal(
    resolveSubtitleOutputFontSize({
      baseFontSizePx: 40,
      videoHeightPx: 1080,
    }),
    60
  );
  assert.equal(
    resolveSubtitleOutputFontSize({
      baseFontSizePx: 24,
      videoHeightPx: 1080,
    }),
    36
  );
  assert.equal(
    resolveSubtitleOutputFontSize({
      baseFontSizePx: 96,
      videoHeightPx: 2160,
    }),
    MAX_SUBTITLE_OUTPUT_FONT_SIZE
  );
});

test('subtitle render specs fail closed for unsupported styles', () => {
  assert.throws(
    () =>
      resolveSubtitleRenderSpec({
        displayMode: 'translation',
        stylePreset: 'Missing' as never,
        baseFontSizePx: 40,
        videoWidthPx: 1920,
        videoHeightPx: 1080,
      }),
    /Unsupported subtitle style preset/
  );
});

test('subtitle plans detect only preview-derived fields changed after planning', () => {
  assert.deepEqual(
    findSubtitlePreviewSelectionDrift(
      {
        display_mode: 'translation',
        style: 'LineBox',
        base_font_size_px: 40,
        selection_binding_version: 1,
        field_sources: {
          display_mode: 'translator_preview',
          style: 'request',
          base_font_size_px: 'translator_preview',
        },
      },
      {
        displayMode: 'dual',
        stylePreset: 'Default',
        baseFontSizePx: 42,
      }
    ),
    ['display_mode', 'base_font_size_px']
  );
});

test('legacy subtitle plans fail closed when any preview selection drifted', () => {
  assert.deepEqual(
    findSubtitlePreviewSelectionDrift(
      {
        display_mode: 'translation',
        style: 'Default',
        base_font_size_px: 24,
        field_sources: {
          display_mode: 'request',
          style: 'request',
          base_font_size_px: 'request',
        },
      },
      {
        displayMode: 'translation',
        stylePreset: 'LineBox',
        baseFontSizePx: 40,
      }
    ),
    ['style', 'base_font_size_px']
  );
});

test('versioned render-checkpoint overrides remain immutable plan intent', () => {
  assert.deepEqual(
    findSubtitlePreviewSelectionDrift(
      {
        display_mode: 'translation',
        style: 'LineBox',
        base_font_size_px: 40,
        selection_binding_version: 1,
        field_sources: {
          display_mode: 'request',
          style: 'render_checkpoint_fork',
          base_font_size_px: 'render_checkpoint_fork',
        },
      },
      {
        displayMode: 'dual',
        stylePreset: 'Default',
        baseFontSizePx: 24,
      }
    ),
    []
  );
});

test('serialized subtitle specs reject altered resolved sizes', () => {
  const spec = resolveSubtitleRenderSpec({
    displayMode: 'translation',
    stylePreset: 'LineBox',
    baseFontSizePx: 40,
    videoWidthPx: 1920,
    videoHeightPx: 1080,
  });
  const serialized = serializeSubtitleRenderSpec(spec);

  assert.throws(
    () =>
      parseSubtitleRenderSpec({
        ...serialized,
        output_font_size_px: 36,
      }),
    /output_font_size_px does not match/
  );
});
