import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planTranslationWindows,
  planPendingReviewWindows,
} from '../services/subtitle-processing/translation-batches.js';
import { withTranslationReview } from '../../shared/helpers/translation-review.js';
const cues = (
  count: number,
  text = 'A short caption that continues the conversation.'
) =>
  Array.from({ length: count }, (_, i) => ({
    id: String(i),
    index: i + 1,
    start: i * 3,
    end: i * 3 + 2,
    original: text,
    translation: '짧은 자막입니다.',
  }));

test('adaptive target windows cover every cue once and retain adjacent context', () => {
  const input = cues(2962);
  for (const phase of ['draft', 'review'] as const) {
    const plan = planTranslationWindows(input, phase);
    assert.equal(plan.length, 75);
    assert.deepEqual(
      plan.flatMap(w => input.slice(w.start, w.end).map(s => s.id)),
      input.map(s => s.id)
    );
    for (const w of plan) {
      assert.ok(w.end - w.start <= 40);
      assert.ok(w.contextStart <= w.start && w.contextEnd >= w.end);
    }
    const count = phase === 'draft' ? 12 : 15;
    assert.equal(plan[1].start - plan[1].contextStart, count);
    assert.equal(plan[1].contextEnd - plan[1].end, count);
  }
});
test('long CJK captions shrink windows by bytes and never split a cue', () => {
  const input = cues(91, '日'.repeat(200));
  for (const phase of ['draft', 'review'] as const) {
    const cap = phase === 'draft' ? 8000 : 12000;
    const bytes = (a: typeof input) =>
      a.reduce(
        (n, s) =>
          n +
          Buffer.byteLength(s.original) +
          (phase === 'review' ? Buffer.byteLength(s.translation) : 0),
        0
      );
    for (const w of planTranslationWindows(input, phase)) {
      assert.ok(bytes(input.slice(w.start, w.end)) <= cap);
      assert.ok(bytes(input.slice(w.contextStart, w.start)) <= cap / 2);
      assert.ok(bytes(input.slice(w.end, w.contextEnd)) <= cap / 2);
    }
  }
  const one = cues(1, 'a'.repeat(9000));
  assert.deepEqual(planTranslationWindows(one, 'draft'), [
    { start: 0, end: 1, contextStart: 0, contextEnd: 1 },
  ]);
  assert.deepEqual(planTranslationWindows([], 'draft'), []);
});

test('sparse pending review ranges obey their own cue and UTF-8 context bounds', () => {
  for (const text of ['Short source', '日'.repeat(900)]) {
    const input = cues(80, text).map((s, i) =>
      withTranslationReview(s, 'Spanish', i % 2 ? 'pending' : 'complete')
    );
    const windows = planPendingReviewWindows(input, 'Spanish');
    assert.deepEqual(
      windows.flatMap(w => input.slice(w.start, w.end).map(s => s.id)),
      input.filter((_, i) => i % 2).map(s => s.id)
    );
    const bytes = (start: number, end: number) =>
      input
        .slice(start, end)
        .reduce(
          (n, s) =>
            n +
            Buffer.byteLength(s.original) +
            Buffer.byteLength(s.translation || ''),
          0
        );
    for (const w of windows) {
      assert.equal(w.end - w.start, 1);
      assert(w.start - w.contextStart <= 15);
      assert(w.contextEnd - w.end <= 15);
      assert(bytes(w.contextStart, w.start) <= 6000);
      assert(bytes(w.end, w.contextEnd) <= 6000);
    }
  }
});
