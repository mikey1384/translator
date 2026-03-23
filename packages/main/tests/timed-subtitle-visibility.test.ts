import assert from 'node:assert/strict';
import test from 'node:test';
import type { SubtitleRenderPart } from '@shared-types/app';

import {
  getVisibleTimedSubtitleParts,
  getVisibleTimedSubtitleText,
} from '../../renderer/timed-subtitle-visibility.ts';

test('timed subtitle visibility keeps only the active word', () => {
  const parts: SubtitleRenderPart[] = [
    { kind: 'word', text: 'hello', state: 'spoken' },
    { kind: 'whitespace', text: ' ' },
    { kind: 'word', text: 'world', state: 'active' },
    { kind: 'whitespace', text: ' ' },
    { kind: 'word', text: 'again', state: 'upcoming' },
  ];

  assert.deepEqual(getVisibleTimedSubtitleParts(parts), [
    { kind: 'word', text: 'world', state: 'active' },
  ]);
  assert.equal(getVisibleTimedSubtitleText(parts), 'world');
});

test('timed subtitle visibility keeps the previous word visible until the next word starts', () => {
  const parts: SubtitleRenderPart[] = [
    { kind: 'word', text: 'hello', state: 'spoken' },
    { kind: 'whitespace', text: ' ' },
    { kind: 'word', text: 'world', state: 'upcoming' },
  ];

  assert.deepEqual(getVisibleTimedSubtitleParts(parts), [
    { kind: 'word', text: 'hello', state: 'spoken' },
  ]);
  assert.equal(getVisibleTimedSubtitleText(parts), 'hello');
});

test('timed subtitle visibility hides the subtitle before the first word starts', () => {
  const parts: SubtitleRenderPart[] = [
    { kind: 'word', text: 'hello', state: 'upcoming' },
    { kind: 'whitespace', text: ' ' },
    { kind: 'word', text: 'world', state: 'upcoming' },
  ];

  assert.deepEqual(getVisibleTimedSubtitleParts(parts), []);
  assert.equal(getVisibleTimedSubtitleText(parts), '');
});

test('timed subtitle visibility hides the subtitle after the final word ends', () => {
  const parts: SubtitleRenderPart[] = [
    { kind: 'word', text: 'hello', state: 'spoken' },
    { kind: 'whitespace', text: ' ' },
    { kind: 'word', text: 'world', state: 'spoken' },
  ];

  assert.deepEqual(getVisibleTimedSubtitleParts(parts), []);
  assert.equal(getVisibleTimedSubtitleText(parts), '');
});
