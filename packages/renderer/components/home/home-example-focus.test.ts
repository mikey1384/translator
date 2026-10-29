import assert from 'node:assert/strict';
import test from 'node:test';
import { focusExampleUrl } from './home-example-focus';

function fixture() {
  const callbacks: FrameRequestCallback[] = [];
  const button = {};
  const doc = {
    activeElement: button as unknown,
    defaultView: {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callbacks.push(callback);
      },
    },
  };
  const input = {
    ownerDocument: doc,
    isConnected: true,
    disabled: false,
    value: '',
    scrollLeft: 120,
    selections: 0,
    getClientRects: () => [{}],
    focus() {
      doc.activeElement = input;
    },
    select() {
      input.selections++;
    },
  };
  return {
    input,
    element: input as unknown as HTMLInputElement,
    doc,
    button,
    callbacks,
    flush: () => callbacks.splice(0).forEach(callback => callback(0)),
  };
}

const url = 'https://example.com/video';

test('pointer selection reveals the URL after the controlled input renders', () => {
  const f = fixture();
  focusExampleUrl(f.element, url, true);
  assert.equal(f.doc.activeElement, f.button);
  f.input.value = url;
  f.flush();
  assert.equal(f.doc.activeElement, f.input);
  assert.equal(f.input.selections, 1);
  assert.equal(f.input.scrollLeft, 0);
});

test('held Enter and assistive activation never transfer focus into the form', () => {
  const f = fixture();
  for (let repeat = 0; repeat < 5; repeat++) {
    focusExampleUrl(f.element, url, false);
  }
  assert.equal(f.callbacks.length, 0);
  f.flush();
  assert.equal(f.doc.activeElement, f.button);
  assert.equal(f.input.selections, 0);
});

test('a user moving focus before the next frame keeps their new focus', () => {
  const f = fixture();
  f.input.value = url;
  focusExampleUrl(f.element, url, true);
  const otherField = {};
  f.doc.activeElement = otherField;
  f.flush();
  assert.equal(f.doc.activeElement, otherField);
  assert.equal(f.input.selections, 0);
});

test('typing a different URL before the frame preserves the edit and caret', () => {
  const f = fixture();
  focusExampleUrl(f.element, url, true);
  f.input.value = 'https://example.com/my-own-video';
  f.flush();
  assert.equal(f.doc.activeElement, f.button);
  assert.equal(f.input.selections, 0);
});

for (const state of ['disabled', 'detached', 'hidden'] as const) {
  test(`a ${state} input cannot receive delayed example focus`, () => {
    const f = fixture();
    f.input.value = url;
    focusExampleUrl(f.element, url, true);
    if (state === 'disabled') f.input.disabled = true;
    if (state === 'detached') f.input.isConnected = false;
    if (state === 'hidden') f.input.getClientRects = () => [];
    f.flush();
    assert.equal(f.doc.activeElement, f.button);
    assert.equal(f.input.selections, 0);
  });
}

test('an unmounted home input is harmless', () => {
  assert.doesNotThrow(() => focusExampleUrl(null, url, true));
});
