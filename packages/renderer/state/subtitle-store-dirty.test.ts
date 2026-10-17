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

test('split and merge are undoable, and Undo keeps offering earlier steps', async () => {
  const restore = installGlobals();
  try {
    const { useSubStore } = await import('./subtitle-store');
    const store = useSubStore.getState();
    store.load([
      {
        id: 'a',
        index: 1,
        start: 0,
        end: 4,
        original: 'hello there friend',
        translation: 'hola amigo',
      },
      { id: 'b', index: 2, start: 4, end: 6, original: 'bye', translation: '' },
    ] as any);

    const newId = store.split('a', { field: 'original', caret: 6 });
    assert.ok(newId);
    let s = useSubStore.getState();
    assert.deepEqual(s.order, ['a', newId, 'b']);
    assert.equal(s.segments.a.original, 'hello');
    assert.equal(s.segments[newId!].original, 'there friend');
    assert.equal(s.segments.a.end, s.segments[newId!].start);
    assert.equal(s.segments[newId!].end, 4);
    assert.equal(s.segments.b.index, 3);
    assert.equal(s.lastUndoable?.kind, 'split');

    assert.equal(store.mergeWithNext(newId!), true);
    s = useSubStore.getState();
    assert.deepEqual(s.order, ['a', newId]);
    assert.equal(s.segments[newId!].original, 'there friend bye');
    assert.equal(s.segments[newId!].end, 6);
    assert.equal(store.mergeWithNext(newId!), false);

    // Undo the merge; the bar then offers the split.
    assert.equal(store.undo(), true);
    assert.equal(useSubStore.getState().order.length, 3);
    assert.equal(useSubStore.getState().lastUndoable?.kind, 'split');
    assert.equal(store.undo(), true);
    s = useSubStore.getState();
    assert.deepEqual(s.order, ['a', 'b']);
    assert.equal(s.segments.a.original, 'hello there friend');
    assert.equal(s.lastUndoable, null);
  } finally {
    restore();
  }
});
