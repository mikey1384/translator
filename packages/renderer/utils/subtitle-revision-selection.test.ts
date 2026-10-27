import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSelectedSubtitleRevisionUnchanged,
  setAppliedSubtitleSelection,
  subtitleSelectionFingerprint,
} from './subtitle-revision-selection';
import { useSubStore } from '../state/subtitle-store';

test('Replace All and Undo keep edits bound to the selected persistent revision', () => {
  const cue = {
    id: 'a',
    index: 1,
    start: 0,
    end: 2,
    original: 'Source',
    translation: '번역',
  };
  useSubStore.getState().load([cue]);
  setAppliedSubtitleSelection({
    jobId: 'job',
    revisionId: 'revision',
    documentGeneration: useSubStore.getState().documentGeneration,
    fingerprint: subtitleSelectionFingerprint([cue]),
  });
  useSubStore.getState().replaceAll('Source', 'Revised');
  assert.throws(
    () => assertSelectedSubtitleRevisionUnchanged(useSubStore.getState()),
    /apply_subtitle_revision/
  );
  useSubStore.getState().shift('a', 0.1);
  useSubStore.getState().undo();
  assert.throws(
    () => assertSelectedSubtitleRevisionUnchanged(useSubStore.getState()),
    /apply_subtitle_revision/
  );
  useSubStore.getState().undo();
  assert.doesNotThrow(() =>
    assertSelectedSubtitleRevisionUnchanged(useSubStore.getState())
  );
  setAppliedSubtitleSelection(null);
});

test('UI and legacy MCP render cannot bypass the selected job revision after editor changes', () => {
  const cue = {
    id: 'a',
    index: 1,
    start: 0,
    end: 2,
    original: 'Source',
    translation: '번역',
    sourceCueIds: ['raw'],
  };
  setAppliedSubtitleSelection({
    jobId: 'job',
    revisionId: 'revision',
    documentGeneration: 1,
    fingerprint: subtitleSelectionFingerprint([cue]),
  });
  const document = {
    documentGeneration: 1,
    order: ['a'],
    segments: { a: cue },
  };
  assert.doesNotThrow(() => assertSelectedSubtitleRevisionUnchanged(document));
  assert.throws(
    () =>
      assertSelectedSubtitleRevisionUnchanged({
        ...document,
        segments: { a: { ...cue, end: 1.9 } },
      }),
    /apply_subtitle_revision/
  );
  assert.doesNotThrow(
    () =>
      assertSelectedSubtitleRevisionUnchanged({
        ...document,
        documentGeneration: 2,
        segments: { a: { ...cue, end: 1.9 } },
      }),
    'an explicitly opened local document is independent'
  );
  setAppliedSubtitleSelection(null);
});
