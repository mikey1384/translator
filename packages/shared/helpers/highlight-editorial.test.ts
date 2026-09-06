import assert from 'node:assert/strict';
import test from 'node:test';
import type { HighlightEditorialPlan } from '@shared-types/app';
import {
  buildEditorialReframeGraph,
  editorialCaptionEvents,
  editorialCrop,
  editorialSourceSignature,
  validateHighlightEditorialPlan,
} from './highlight-editorial.js';
import { editorialCaptionHtml } from './editorial-caption-html.js';

const plan: HighlightEditorialPlan = {
  shots: [
    { start: 0, end: 1.5, centerX: 0.25, centerY: 0.5, zoom: 1 },
    { start: 1.5, end: 4, centerX: 0.75, centerY: 0.4, zoom: 1.3 },
  ],
  captions: [
    { start: 0, end: 1.5, text: '강력한 AI', emphasis: 'AI' },
    { start: 1.5, end: 4, text: '먼저 아이디어를', emphasis: '아이디어' },
  ],
  label: '폴 그레이엄',
};
test('camera shots cover the exact clip and reject missing, overlapping, unbounded or nonnumeric framing', () => {
  assert.deepEqual(validateHighlightEditorialPlan(plan, 4), plan);
  for (const change of [
    { start: 1.4 },
    { start: 1.6 },
    { end: 4.01 },
    { centerX: NaN },
    { centerY: -0.1 },
    { zoom: 3 },
  ])
    assert.throws(() =>
      validateHighlightEditorialPlan(
        { ...plan, shots: [plan.shots[0], { ...plan.shots[1], ...change }] },
        4
      )
    );
});
test('framing uses real portrait crop rectangles inside the source, including edge and portrait inputs', () => {
  for (const [width, height] of [
    [1920, 1080],
    [1080, 1920],
    [320, 240],
  ]) {
    for (const centerX of [0, 0.25, 1])
      for (const centerY of [0, 1]) {
        const r = editorialCrop(
          { ...plan.shots[1], centerX, centerY },
          width,
          height
        );
        assert.ok(
          r.x >= 0 &&
            r.y >= 0 &&
            r.x + r.width <= width &&
            r.y + r.height <= height
        );
        assert.ok(Math.abs(r.width / r.height - 9 / 16) < 0.02);
      }
  }
  const graph = buildEditorialReframeGraph(
    plan,
    1920,
    1080,
    '0:v',
    'out',
    'test'
  );
  assert.match(graph, /trim=start=1.5:end=4/);
  assert.match(graph, /concat=n=2:v=1:a=0\[out\]/);
  assert.doesNotMatch(graph, /pad=/);
});
test('caption emphasis is literal and cannot inject HTML; boundary events never blank a new phrase', () => {
  assert.throws(() =>
    validateHighlightEditorialPlan(
      { ...plan, captions: [{ ...plan.captions[0], emphasis: 'invented' }] },
      4
    )
  );
  assert.throws(() =>
    validateHighlightEditorialPlan(
      {
        ...plan,
        captions: [plan.captions[0], { ...plan.captions[1], start: 1.4 }],
      },
      4
    )
  );
  const events = editorialCaptionEvents(plan, 4);
  assert.equal(
    events.find(e => e.timeMs === 1500)?.state.text,
    '먼저 아이디어를'
  );
  assert.equal(new Set(events.map(e => e.timeMs)).size, events.length);
  assert.equal(events.at(-1)?.state.text, '');
  const html = editorialCaptionHtml(
    {
      mode: 'editorial',
      text: '<img src=x>',
      emphasis: '<img',
      label: '<script>',
    },
    1080
  );
  assert.ok(!html.includes('<img') && !html.includes('<script>'));
  assert.match(html, /&lt;img/);
});
test('saved editorial captions become stale after a source or translation edit, not after cue IDs reload', () => {
  const cue = {
    id: 'a',
    index: 1,
    start: 0,
    end: 4,
    original: 'An idea',
    translation: '아이디어',
  };
  const signature = editorialSourceSignature([cue], 0, 4);
  assert.equal(
    signature,
    editorialSourceSignature([{ ...cue, id: 'reopened' }], 0, 4)
  );
  assert.notEqual(
    signature,
    editorialSourceSignature([{ ...cue, translation: '다른 번역' }], 0, 4)
  );
});
