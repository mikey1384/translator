import test from 'node:test';
import assert from 'node:assert/strict';
import { useSubStore } from '../state/subtitle-store';
import {
  withTranslationReview,
  translationReviewStatus,
} from '../../shared/helpers/translation-review';
import {
  beginTranslationDocumentScope,
  translationDocumentIsCurrent,
  translationProgressIsCurrent,
  queueTranslationCheckpoint,
  flushTranslationCheckpoints,
  applyTranslationCheckpoint,
} from './translation-document-scope';
import { saveMountedSubtitleDocument } from './subtitle-documents';
import { classifyTerminalProgress } from './progress-terminal';
const cue = {
  id: 'a',
  index: 1,
  start: 0,
  end: 4,
  original: 'Label',
  translation: 'Etiqueta',
};
test('an unchanged reviewed translation still updates the durable checkpoint by stable ID', () => {
  useSubStore
    .getState()
    .load([withTranslationReview(cue, 'Spanish', 'pending')]);
  useSubStore
    .getState()
    .applyTranslations([withTranslationReview(cue, 'Spanish', 'complete')], {
      matchByIndex: false,
      markDirty: true,
    });
  assert.equal(
    translationReviewStatus(useSubStore.getState().segments.a, 'Spanish'),
    'complete'
  );
  assert.equal(useSubStore.getState().dirty, true);
});
test('document replacement or a user edit rejects late operation updates', () => {
  useSubStore.getState().load([cue]);
  const end = beginTranslationDocumentScope('scope');
  assert.equal(translationDocumentIsCurrent('scope'), true);
  useSubStore.getState().update('a', { translation: 'Edited' });
  assert.equal(translationDocumentIsCurrent('scope'), false);
  end();
  const end2 = beginTranslationDocumentScope('scope2');
  useSubStore.getState().load([{ ...cue, id: 'other' }]);
  assert.equal(translationDocumentIsCurrent('scope2'), false);
  end2();
});
test('review incomplete is a terminal incomplete result even at100 percent', () => {
  assert.equal(
    classifyTerminalProgress({
      stage: '__i18n__:translationReview.incomplete',
      percent: 100,
    }),
    'incomplete'
  );
});

test('closed and ended operations cannot apply late progress to an edited or replaced document', async () => {
  useSubStore.getState().load([cue]);
  const end = beginTranslationDocumentScope('late');
  await flushTranslationCheckpoints('late');
  assert.equal(translationProgressIsCurrent('late'), false);
  assert.equal(translationDocumentIsCurrent('late'), true);
  end();
  useSubStore.getState().update('a', { translation: 'My edit' });
  assert.equal(translationProgressIsCurrent('late'), false);
  useSubStore.getState().load([{ ...cue, id: 'replacement' }]);
  assert.equal(translationDocumentIsCurrent('late'), false);
});

test('initial job save and checkpoints share one document identity and persist canonical canceled results', async () => {
  const previous = (globalThis as any).window;
  const writes: any[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  (globalThis as any).window = {
    electron: {
      saveSubtitleDocumentRecord: async (input: any) => {
        writes.push(structuredClone(input));
        if (writes.length === 1) await gate;
        return {
          success: true,
          document: {
            id: input.documentId ?? 'one-document',
            title: 'Synthetic',
          },
        };
      },
    },
  };
  try {
    useSubStore
      .getState()
      .load([withTranslationReview(cue, 'Spanish', 'pending')]);
    const initial = saveMountedSubtitleDocument({ keepDirty: true });
    await Promise.resolve();
    const end = beginTranslationDocumentScope('checkpoint');
    queueTranslationCheckpoint('checkpoint');
    queueTranslationCheckpoint('checkpoint');
    release();
    await initial;
    await flushTranslationCheckpoints('checkpoint');
    assert.equal(writes.length, 2);
    assert.equal(writes[1].documentId, 'one-document');
    // No completed progress packet was sent. The invoke cancellation response
    // is the only source of this successfully reviewed cue.
    assert.equal(
      await applyTranslationCheckpoint('checkpoint', [
        withTranslationReview(cue, 'Spanish', 'complete'),
      ]),
      true
    );
    end();
    const saved = writes.at(-1);
    useSubStore.getState().load(saved.segments);
    assert.equal(
      translationReviewStatus(useSubStore.getState().segments.a, 'Spanish'),
      'complete'
    );
  } finally {
    (globalThis as any).window = previous;
  }
});

test('queued saves cannot attach a replacement document to the previous job', async () => {
  const previous = (globalThis as any).window;
  const writes: any[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  (globalThis as any).window = {
    electron: {
      saveSubtitleDocumentRecord: async (input: any) => {
        writes.push(input);
        await gate;
        return {
          success: true,
          document: { id: 'old-document', title: 'Old' },
        };
      },
    },
  };
  try {
    useSubStore.getState().load([cue]);
    const first = saveMountedSubtitleDocument({ keepDirty: true });
    await Promise.resolve();
    const queued = saveMountedSubtitleDocument({ keepDirty: true });
    useSubStore.getState().load([{ ...cue, id: 'new' }]);
    release();
    await first;
    assert.equal((await queued).success, false);
    assert.equal(writes.length, 1);
    assert.equal(useSubStore.getState().documentId, null);
  } finally {
    (globalThis as any).window = previous;
  }
});

test('a completed missing subset cannot mark earlier pending quality drafts complete', async () => {
  const { documentTranslationReview } = await import('./translationReview');
  const pending = withTranslationReview(cue, 'Spanish', 'pending');
  const complete = withTranslationReview(
    { ...cue, id: 'b' },
    'Spanish',
    'complete'
  );
  assert.deepEqual(documentTranslationReview([pending, complete], 'Spanish'), {
    status: 'incomplete',
    completed: 1,
    total: 2,
  });
});

test('late listener packets cannot change task state, overwrite cues, or open a failure dialog', async () => {
  const previousWindow = (globalThis as any).window;
  const previousDocument = (globalThis as any).document;
  const previousStorage = (globalThis as any).localStorage;
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
  let receive!: (packet: any) => void;
  let refreshes = 0;
  (globalThis as any).window = {
    addEventListener() {},
    removeEventListener() {},
    electron: {
      onGenerateSubtitlesProgress: (callback: any) => {
        receive = callback;
        return () => {};
      },
      onDubSubtitlesProgress: () => () => {},
      getLanguagePreference: async () => 'en',
      onEntitlementsUpdated: () => () => {},
      onApiKeysUpdated: () => () => {},
      refreshCreditSnapshot: async () => {
        refreshes++;
        return {};
      },
    },
  };
  const bridge = (globalThis as any).window.electron;
  (globalThis as any).window.electron = new Proxy(bridge, {
    get: (target, key) =>
      key in target
        ? target[key]
        : typeof key === 'string' && key.startsWith('on')
          ? () => () => {}
          : undefined,
  });
  (globalThis as any).document = { hidden: false, addEventListener() {} };
  try {
    const { useTaskStore } = await import('../state/task-store');
    const { useModalStore } = await import('../state/modal-store');
    await import('../listeners/progress-buffer');
    useSubStore.getState().load([cue]);
    const operationId = 'translate-late-listener';
    const end = beginTranslationDocumentScope(operationId);
    await flushTranslationCheckpoints(operationId);
    useTaskStore.setState({
      translation: {
        ...useTaskStore.getState().translation,
        id: operationId,
        stage: 'Canonical review incomplete',
        inProgress: false,
        isCompleted: false,
      },
    });
    useModalStore.setState({ creditRanOutOpen: false });
    const packet = {
      operationId,
      stage: 'error',
      error: 'insufficient-credits',
      percent: 100,
      partialSegments: [{ ...cue, translation: 'Late overwrite' }],
    };
    receive(packet);
    await Promise.resolve();
    assert.equal(
      useTaskStore.getState().translation.stage,
      'Canonical review incomplete'
    );
    assert.equal(
      useSubStore.getState().segments.a.translation,
      cue.translation
    );
    assert.equal(useModalStore.getState().creditRanOutOpen, false);
    assert.equal(
      refreshes,
      1,
      'settlement still refreshes authoritative credits'
    );
    end();
    useSubStore.getState().update('a', { translation: 'User edit' });
    receive({ ...packet, stage: 'Processing complete!', error: undefined });
    assert.equal(useSubStore.getState().segments.a.translation, 'User edit');
    assert.equal(useTaskStore.getState().translation.isCompleted, false);
  } finally {
    (globalThis as any).window = previousWindow;
    (globalThis as any).document = previousDocument;
    (globalThis as any).localStorage = previousStorage;
  }
});

test('single-cue consumers save paid drafts on incomplete review and cancellation', async () => {
  const previousWindow = (globalThis as any).window;
  const previousStorage = (globalThis as any).localStorage;
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
  const saved: any[] = [];
  const pending = withTranslationReview(
    { ...cue, translation: 'Paid single draft' },
    'Spanish',
    'pending'
  );
  (globalThis as any).window = {
    electron: {
      translateOneLine: async () => ({
        success: true,
        operationId: 'translate-cue-save',
        translation: pending.translation,
        translationReview: pending.translationReview,
        review: {
          status: 'incomplete',
          completed: 0,
          total: 1,
          reason: 'insufficient_credits',
        },
      }),
      saveSubtitleDocumentRecord: async (input: any) => {
        saved.push(structuredClone(input));
        return {
          success: true,
          document: { id: 'cue-document', title: 'Synthetic' },
        };
      },
    },
  };
  try {
    const { useTaskStore } = await import('../state/task-store');
    const { executeCueTranslation } = await import('./translateCue');
    for (const cancelled of [false, true]) {
      useSubStore.getState().load([cue]);
      useTaskStore.getState().setTranslation({ inProgress: false });
      (globalThis as any).window.electron.translateOneLine = async () => ({
        success: !cancelled,
        cancelled,
        operationId: 'translate-cue-save',
        translation: pending.translation,
        translationReview: pending.translationReview,
        review: { status: 'incomplete', completed: 0, total: 1 },
      });
      const result = await executeCueTranslation({
        segment: cue,
        targetLanguage: 'Spanish',
        operationId: 'translate-cue-save',
      });
      assert.equal(result.cancelled, cancelled);
      assert.equal(saved.at(-1).segments[0].translation, 'Paid single draft');
      assert.equal(
        saved.at(-1).segments[0].translationReview.status,
        'pending'
      );
      assert.equal(useTaskStore.getState().translation.isCompleted, false);
    }
  } finally {
    (globalThis as any).window = previousWindow;
    (globalThis as any).localStorage = previousStorage;
  }
});
