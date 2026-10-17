import assert from 'node:assert/strict';
import test from 'node:test';
import { scrollIntoViewWhenVisible } from './scrollWhenVisible.js';

function fakeClock() {
  let time = 0;
  let queue: Array<() => void> = [];
  return {
    deps: {
      requestFrame: (cb: () => void) => {
        queue.push(cb);
        return queue.length;
      },
      cancelFrame: () => {
        queue = [];
      },
      now: () => time,
    },
    // Runs one frame `ms` later than the previous one.
    tick(ms: number) {
      time += ms;
      const run = queue;
      queue = [];
      run.forEach(cb => cb());
    },
    pending: () => queue.length,
  };
}

function fakeElement() {
  const element = {
    visible: false,
    scrolls: 0,
    getClientRects: () => (element.visible ? [{}] : []),
    scrollIntoView: () => {
      element.scrolls += 1;
    },
  };
  return element;
}

test('scrolls once the element gets a layout box, even after many fast frames', () => {
  const clock = fakeClock();
  const element = fakeElement();
  scrollIntoViewWhenVisible(() => element as unknown as Element, {
    deps: clock.deps,
  });
  // 120 frames at 120 Hz (1 s) with the panel still hidden.
  for (let i = 0; i < 120; i += 1) clock.tick(1000 / 120);
  assert.equal(element.scrolls, 0);
  element.visible = true;
  clock.tick(1000 / 120);
  assert.equal(element.scrolls, 1);
  assert.equal(clock.pending(), 0);
});

test('gives up after the time budget and can be cancelled', () => {
  const clock = fakeClock();
  const element = fakeElement();
  scrollIntoViewWhenVisible(() => element as unknown as Element, {
    timeoutMs: 100,
    deps: clock.deps,
  });
  for (let i = 0; i < 20; i += 1) clock.tick(10);
  assert.equal(clock.pending(), 0);

  const cancel = scrollIntoViewWhenVisible(
    () => element as unknown as Element,
    { deps: clock.deps }
  );
  cancel();
  element.visible = true;
  clock.tick(10);
  assert.equal(element.scrolls, 0);
});
