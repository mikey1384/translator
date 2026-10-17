import test from 'node:test';
import assert from 'node:assert/strict';

function installGlobals() {
  const previousWindow = (globalThis as any).window;
  const previousLocalStorage = (globalThis as any).localStorage;
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  };
  (globalThis as any).window = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    electron: {},
  };
  return () => {
    (globalThis as any).window = previousWindow;
    (globalThis as any).localStorage = previousLocalStorage;
  };
}

const cues = () => [
  { id: 'a', index: 1, start: 0, end: 1, original: 'one', translation: '' },
  { id: 'b', index: 2, start: 1, end: 2, original: 'two', translation: '' },
  { id: 'c', index: 3, start: 2, end: 3, original: 'three', translation: '' },
];

test('edits mark the subtitles dirty; load and a matching save clear it', async () => {
  const restore = installGlobals();
  try {
    const { useSubStore } = await import('./subtitle-store');
    const store = useSubStore.getState();
    store.load(cues() as any);
    assert.equal(useSubStore.getState().dirty, false);

    // Transient UI fields are not edits.
    store.update('a', { _oldText: 'x' } as any);
    assert.equal(useSubStore.getState().dirty, false);

    store.update('a', { original: 'uno' });
    assert.equal(useSubStore.getState().dirty, true);

    // A save that started before a later edit must not clear that edit.
    const revisionAtSave = useSubStore.getState().editRevision;
    store.update('b', { original: 'dos' });
    store.markSaved(revisionAtSave);
    assert.equal(useSubStore.getState().dirty, true);

    store.markSaved(useSubStore.getState().editRevision);
    assert.equal(useSubStore.getState().dirty, false);

    store.remove('c');
    assert.equal(useSubStore.getState().dirty, true);
    store.load(cues() as any);
    assert.equal(useSubStore.getState().dirty, false);
  } finally {
    restore();
  }
});

test('undo restores a deleted line, a replace-all and a shift', async () => {
  const restore = installGlobals();
  try {
    const { useSubStore } = await import('./subtitle-store');
    const store = useSubStore.getState();
    store.load(cues() as any);
    assert.equal(useSubStore.getState().undoDepth, 0);

    store.remove('b');
    assert.deepEqual(useSubStore.getState().order, ['a', 'c']);
    assert.equal(useSubStore.getState().lastUndoable?.kind, 'remove');

    store.replaceAll('one', '1');
    assert.equal(useSubStore.getState().segments.a.original, '1');

    store.shiftAll(5);
    assert.equal(useSubStore.getState().segments.a.start, 5);
    assert.equal(useSubStore.getState().undoDepth, 3);

    assert.equal(useSubStore.getState().undo(), true);
    assert.equal(useSubStore.getState().segments.a.start, 0);
    assert.equal(useSubStore.getState().undo(), true);
    assert.equal(useSubStore.getState().segments.a.original, 'one');
    assert.equal(useSubStore.getState().undo(), true);
    assert.deepEqual(useSubStore.getState().order, ['a', 'b', 'c']);
    assert.equal(useSubStore.getState().segments.b.index, 2);
    assert.equal(useSubStore.getState().undo(), false);

    // Loading another document forgets the previous one's history.
    store.remove('a');
    store.load(cues() as any);
    assert.equal(useSubStore.getState().undo(), false);
  } finally {
    restore();
  }
});
