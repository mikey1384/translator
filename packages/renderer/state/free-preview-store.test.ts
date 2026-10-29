import test from 'node:test';
import assert from 'node:assert/strict';
import { useFreePreviewStore } from './free-preview-store.js';

test('clearing a source purges another tab’s disk record and preserves unrelated active previews', () => {
  const previous = globalThis.localStorage;
  let stored = JSON.stringify({
    private: { key: 'private', status: 'offer' },
    other: { key: 'other', status: 'resuming' },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    },
  });
  try {
    useFreePreviewStore.setState({ items: {} });
    useFreePreviewStore.getState().clear('private');
    assert.deepEqual(JSON.parse(stored), {
      other: { key: 'other', status: 'resuming' },
    });
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previous,
    });
  }
});
