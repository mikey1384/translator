import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeZeroDurationSubtitleSegments,
  normalizeSubtitleSegments,
} from '../services/subtitle-processing/pipeline/finalize-pass.js';

test('final subtitle normalization merges duplicate-start zero-duration cues without losing text', () => {
  const normalized = normalizeSubtitleSegments([
    {
      id: 'first',
      index: 1,
      start: 10,
      end: 12,
      original: 'First fragment.',
      translation: '',
    },
    {
      id: 'second',
      index: 2,
      start: 10,
      end: 12.5,
      original: 'Second fragment.',
      translation: '',
    },
    {
      id: 'survivor',
      index: 3,
      start: 10,
      end: 14,
      original: 'Final fragment.',
      translation: '',
    },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, 'survivor');
  assert.equal(
    normalized[0].original,
    'First fragment. Second fragment. Final fragment.'
  );
  assert.ok(normalized.every(segment => segment.end > segment.start));
});

test('zero-duration cleanup appends a trailing degenerate cue to its valid predecessor', () => {
  const merged = mergeZeroDurationSubtitleSegments([
    {
      id: 'valid',
      index: 1,
      start: 0,
      end: 2,
      original: 'Valid cue.',
      translation: '번역.',
    },
    {
      id: 'trailing',
      index: 2,
      start: 2,
      end: 2,
      original: 'Trailing fragment.',
      translation: '후행.',
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].original, 'Valid cue. Trailing fragment.');
  assert.equal(merged[0].translation, '번역. 후행.');
  assert.deepEqual(merged[0].words, []);
});
