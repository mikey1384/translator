import test from 'node:test';
import assert from 'node:assert/strict';
import { isStructuralUndoKey } from './structural-undo';

test('Cmd/Ctrl+Z is the structural undo key; redo and Alt are not', () => {
  assert.equal(isStructuralUndoKey({ key: 'z', metaKey: true }), true);
  assert.equal(isStructuralUndoKey({ key: 'Z', ctrlKey: true }), true);
  assert.equal(
    isStructuralUndoKey({ key: 'z', metaKey: true, shiftKey: true }),
    false
  );
  assert.equal(
    isStructuralUndoKey({ key: 'z', altKey: true, ctrlKey: true }),
    false
  );
  assert.equal(isStructuralUndoKey({ key: 'z' }), false);
  assert.equal(
    isStructuralUndoKey({ key: 'z', metaKey: true, defaultPrevented: true }),
    false
  );
});
