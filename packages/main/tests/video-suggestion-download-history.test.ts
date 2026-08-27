import test from 'node:test';
import assert from 'node:assert/strict';
import type { VideoSuggestionDownloadHistoryItem } from '@shared-types/app';
import {
  VideoSuggestionDownloadHistoryManager,
  type PendingVideoSuggestionFileDeletionIntent,
} from '../services/video-suggestion-download-history.js';

function historyItem(
  id: string,
  localPath: string
): VideoSuggestionDownloadHistoryItem {
  return {
    id,
    sourceUrl: `https://example.com/${id}`,
    title: id,
    downloadedAtIso: new Date().toISOString(),
    localPath,
  };
}

function createHarness(
  options: {
    reclaimPaths?: (filePaths: string[]) => Promise<string[]>;
    onMaintenanceError?: (error: unknown) => void;
    initialPendingReclaims?: string[];
    loadPendingReclaims?: (stored: string[]) => unknown;
    initialPendingFileDeletions?: PendingVideoSuggestionFileDeletionIntent[];
    loadPendingFileDeletions?: (
      stored: PendingVideoSuggestionFileDeletionIntent[]
    ) => unknown;
    saveHistory?: (
      items: VideoSuggestionDownloadHistoryItem[],
      persist: (items: VideoSuggestionDownloadHistoryItem[]) => void
    ) => void;
    savePendingFileDeletions?: (
      intents: PendingVideoSuggestionFileDeletionIntent[],
      persist: (intents: PendingVideoSuggestionFileDeletionIntent[]) => void
    ) => void;
    deleteManagedFile?: (
      filePath: string
    ) => Promise<'deleted' | 'already_absent'>;
    commitGraceMs?: number;
  } = {}
) {
  let storedHistory: VideoSuggestionDownloadHistoryItem[] | null = null;
  let pendingReclaims: string[] = options.initialPendingReclaims ?? [];
  let pendingFileDeletions =
    options.initialPendingFileDeletions?.map(intent => ({ ...intent })) ?? [];
  const reclaimed: string[] = [];
  const persistHistory = (items: VideoSuggestionDownloadHistoryItem[]) => {
    storedHistory = structuredClone(items);
  };
  const persistFileDeletions = (
    intents: PendingVideoSuggestionFileDeletionIntent[]
  ) => {
    pendingFileDeletions = structuredClone(intents);
  };
  const createManager = () =>
    new VideoSuggestionDownloadHistoryManager({
      persistence: {
        loadHistory: () => storedHistory,
        saveHistory: items => {
          if (options.saveHistory) {
            options.saveHistory(items, persistHistory);
          } else {
            persistHistory(items);
          }
        },
        loadPendingReclaims: () =>
          options.loadPendingReclaims
            ? options.loadPendingReclaims(pendingReclaims)
            : pendingReclaims,
        savePendingReclaims: paths => {
          pendingReclaims = [...paths];
        },
        loadPendingFileDeletions: () =>
          options.loadPendingFileDeletions
            ? options.loadPendingFileDeletions(pendingFileDeletions)
            : pendingFileDeletions,
        savePendingFileDeletions: intents => {
          if (options.savePendingFileDeletions) {
            options.savePendingFileDeletions(intents, persistFileDeletions);
          } else {
            persistFileDeletions(intents);
          }
        },
      },
      isManagedLibraryPath: filePath => filePath.includes('/downloaded-media/'),
      reclaimPaths:
        options.reclaimPaths ??
        (async filePaths => {
          reclaimed.push(...filePaths);
          return filePaths;
        }),
      deleteManagedFile: options.deleteManagedFile,
      onMaintenanceError: options.onMaintenanceError,
      commitGraceMs: options.commitGraceMs,
    });
  const manager = createManager();
  return {
    manager,
    createManager,
    reclaimed,
    getStoredHistory: () => storedHistory,
    getPendingReclaims: () => pendingReclaims,
    getPendingFileDeletions: () => pendingFileDeletions,
  };
}

test('serialized concurrent upserts retain both newly downloaded files', async () => {
  const harness = createHarness();
  const first = historyItem('first', '/app/downloaded-media/first.mp4');
  const second = historyItem('second', '/app/downloaded-media/second.mp4');

  await Promise.all([
    harness.manager.mutate({
      rendererId: 1,
      mutation: { type: 'upsert', item: first },
      seedItems: [],
    }),
    harness.manager.mutate({
      rendererId: 2,
      mutation: { type: 'upsert', item: second },
      seedItems: [],
    }),
  ]);

  assert.deepEqual(
    harness.getStoredHistory()?.map(item => item.id),
    ['second', 'first']
  );
  assert.deepEqual(harness.reclaimed, []);
});

test('managed history preserves legal filesystem path characters', async () => {
  const harness = createHarness();
  const filePath =
    '/Users/name[work]/app/downloaded-media/My [finished] video.mp4';
  const item = historyItem('bracketed', filePath);

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });

  assert.equal(harness.getStoredHistory()?.[0]?.localPath, filePath);

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'remove', id: item.id },
  });

  assert.deepEqual(harness.reclaimed, [filePath]);
});

test('renderer-provided managed-file classification is never persisted', async () => {
  const harness = createHarness();
  const item = {
    ...historyItem('untrusted-provenance', '/Users/example/Videos/saved.mp4'),
    managedLocalFile: true,
  };

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });

  assert.equal(harness.getStoredHistory()?.[0]?.managedLocalFile, undefined);
});

test('explicit file deletion reclaims disk bytes while preserving history', async () => {
  const harness = createHarness();
  const filePath = '/app/downloaded-media/keep-history.mp4';
  const item = historyItem('keep-history', filePath);

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });
  const result = await harness.manager.mutateDetailed({
    rendererId: 1,
    mutation: {
      type: 'delete-file',
      id: item.id,
      expectedLocalPath: filePath,
    },
  });

  assert.deepEqual(harness.reclaimed, [filePath]);
  assert.deepEqual(harness.getPendingReclaims(), []);
  assert.deepEqual(harness.getPendingFileDeletions(), []);
  assert.deepEqual(result.deletion, {
    operation: 'delete-file',
    diskOutcome: 'deleted',
    historyOutcome: 'retained',
    recovered: false,
  });
  const items = result.items;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, item.id);
  assert.equal(items[0]?.sourceUrl, item.sourceUrl);
  assert.equal(items[0]?.localPath, undefined);
  assert.equal(harness.getStoredHistory()?.[0]?.localPath, undefined);
});

test('explicit file deletion rejects stale, saved, and mounted paths', async () => {
  const harness = createHarness();
  const filePath = '/app/downloaded-media/protected.mp4';
  const item = historyItem('protected', filePath);

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });

  await assert.rejects(
    harness.manager.mutate({
      rendererId: 1,
      mutation: {
        type: 'delete-file',
        id: item.id,
        expectedLocalPath: '/app/downloaded-media/replaced.mp4',
      },
    }),
    /deleteLocalFileUnavailable/
  );

  await harness.manager.setMountedPaths(2, [filePath]);
  await assert.rejects(
    harness.manager.mutate({
      rendererId: 1,
      mutation: {
        type: 'delete-file',
        id: item.id,
        expectedLocalPath: filePath,
      },
    }),
    /deleteLocalFileInUse/
  );
  await harness.manager.setMountedPaths(2, []);

  const savedPath = '/Users/example/Videos/saved.mp4';
  const savedItem = historyItem('saved', savedPath);
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item: savedItem },
  });
  await assert.rejects(
    harness.manager.mutate({
      rendererId: 1,
      mutation: {
        type: 'delete-file',
        id: savedItem.id,
        expectedLocalPath: savedPath,
      },
    }),
    /deleteLocalFileUnavailable/
  );

  assert.deepEqual(harness.reclaimed, []);
  assert.equal(
    harness.getStoredHistory()?.find(entry => entry.id === item.id)?.localPath,
    filePath
  );
  assert.equal(
    harness.getStoredHistory()?.find(entry => entry.id === savedItem.id)
      ?.localPath,
    savedPath
  );
});

test('failed explicit file deletion leaves history ownership intact', async () => {
  const harness = createHarness({
    reclaimPaths: async () => [],
  });
  const filePath = '/app/downloaded-media/busy-explicit.mp4';
  const item = historyItem('busy-explicit', filePath);

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });

  await assert.rejects(
    harness.manager.mutate({
      rendererId: 1,
      mutation: {
        type: 'delete-file',
        id: item.id,
        expectedLocalPath: filePath,
      },
    }),
    /deleteLocalFileFailed/
  );
  assert.equal(harness.getStoredHistory()?.[0]?.localPath, filePath);
  assert.deepEqual(harness.getPendingReclaims(), []);
});

test('durable deletion intent repairs history after disk deletion and a save failure', async () => {
  let failNextHistorySave = false;
  let filePresent = true;
  const diskAttempts: Array<'deleted' | 'already_absent'> = [];
  const harness = createHarness({
    saveHistory: (items, persist) => {
      if (failNextHistorySave) {
        failNextHistorySave = false;
        throw new Error('history store unavailable');
      }
      persist(items);
    },
    deleteManagedFile: async () => {
      const outcome = filePresent ? 'deleted' : 'already_absent';
      filePresent = false;
      diskAttempts.push(outcome);
      return outcome;
    },
  });
  const filePath = '/app/downloaded-media/recover-history.mp4';
  const item = historyItem('recover-history', filePath);

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });
  failNextHistorySave = true;
  const partial = await harness.manager.mutateDetailed({
    rendererId: 1,
    mutation: {
      type: 'delete-file',
      id: item.id,
      expectedLocalPath: filePath,
    },
  });

  assert.equal(partial.success, false);
  assert.deepEqual(partial.deletion, {
    operation: 'delete-file',
    diskOutcome: 'deleted',
    historyOutcome: 'pending',
    deferredReason: 'history_persistence_failed',
    recovered: false,
  });
  assert.equal(harness.getStoredHistory()?.[0]?.localPath, filePath);
  assert.equal(harness.getPendingFileDeletions().length, 1);

  const recovered = await harness.createManager().mutateDetailed({
    rendererId: 2,
    mutation: { type: 'get' },
  });

  assert.equal(recovered.success, true);
  assert.deepEqual(recovered.deletion, {
    operation: 'delete-file',
    diskOutcome: 'already_absent',
    historyOutcome: 'retained',
    recovered: true,
  });
  assert.deepEqual(diskAttempts, ['deleted', 'already_absent']);
  assert.equal(harness.getStoredHistory()?.[0]?.localPath, undefined);
  assert.deepEqual(harness.getPendingFileDeletions(), []);
});

test('a same-path promotion recovers deletion intent before publishing replacement ownership', async () => {
  let failNextHistorySave = false;
  let filePresent = true;
  const diskAttempts: Array<'deleted' | 'already_absent'> = [];
  const harness = createHarness({
    commitGraceMs: 60_000,
    saveHistory: (items, persist) => {
      if (failNextHistorySave) {
        failNextHistorySave = false;
        throw new Error('history store unavailable');
      }
      persist(items);
    },
    deleteManagedFile: async () => {
      const outcome = filePresent ? 'deleted' : 'already_absent';
      filePresent = false;
      diskAttempts.push(outcome);
      return outcome;
    },
  });
  const filePath = '/app/downloaded-media/reused-name.mp4';
  const item = historyItem('reused-name', filePath);
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });
  failNextHistorySave = true;
  const partial = await harness.manager.mutateDetailed({
    rendererId: 1,
    mutation: {
      type: 'delete-file',
      id: item.id,
      expectedLocalPath: filePath,
    },
  });
  assert.equal(partial.success, false);

  await harness.manager.trackPromotedFile(filePath);

  assert.deepEqual(diskAttempts, ['deleted', 'already_absent']);
  assert.equal(harness.getStoredHistory()?.[0]?.localPath, undefined);
  assert.deepEqual(harness.getPendingFileDeletions(), []);
  assert.deepEqual(harness.getPendingReclaims(), [filePath]);
});

test('a promotion fails closed while an older exact deletion intent is unresolved', async () => {
  let diskAttempts = 0;
  const harness = createHarness({
    deleteManagedFile: async () => {
      diskAttempts += 1;
      throw new Error('disk unavailable');
    },
  });
  const filePath = '/app/downloaded-media/blocked-replacement.mp4';
  const item = historyItem('blocked-replacement', filePath);
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });
  const partial = await harness.manager.mutateDetailed({
    rendererId: 1,
    mutation: {
      type: 'delete-file',
      id: item.id,
      expectedLocalPath: filePath,
    },
  });
  assert.equal(partial.success, false);

  await assert.rejects(
    harness.manager.trackPromotedFile(filePath),
    /deleteLocalFileFailed/
  );
  assert.equal(diskAttempts, 2);
  assert.deepEqual(harness.getPendingReclaims(), []);
  assert.equal(harness.getPendingFileDeletions().length, 1);
});

test('delete file and history commits both boundaries with categorical output', async () => {
  const harness = createHarness();
  const filePath = '/app/downloaded-media/remove-both.mp4';
  const item = historyItem('remove-both', filePath);
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });

  const result = await harness.manager.mutateDetailed({
    rendererId: 1,
    mutation: {
      type: 'delete-file-and-history',
      id: item.id,
      expectedLocalPath: filePath,
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.deletion, {
    operation: 'delete-file-and-history',
    diskOutcome: 'deleted',
    historyOutcome: 'removed',
    recovered: false,
  });
  assert.equal(JSON.stringify(result.deletion).includes(filePath), false);
  assert.equal(JSON.stringify(result.deletion).includes(item.sourceUrl), false);
  assert.deepEqual(harness.getStoredHistory(), []);
  assert.deepEqual(harness.getPendingFileDeletions(), []);
});

test('delete file and history rejects stale, duplicate, shared, external, and mounted targets', async t => {
  await t.test('stale expected path', async () => {
    let diskCalls = 0;
    const harness = createHarness({
      deleteManagedFile: async () => {
        diskCalls += 1;
        return 'deleted';
      },
    });
    const item = historyItem(
      'stale-combined',
      '/app/downloaded-media/current.mp4'
    );
    await harness.manager.mutate({
      rendererId: 1,
      mutation: { type: 'upsert', item },
      seedItems: [],
    });
    const result = await harness.manager.mutateDetailed({
      rendererId: 1,
      mutation: {
        type: 'delete-file-and-history',
        id: item.id,
        expectedLocalPath: '/app/downloaded-media/stale.mp4',
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.deletion?.deferredReason, 'history_conflict');
    assert.equal(diskCalls, 0);
  });

  await t.test('duplicate id', async () => {
    let diskCalls = 0;
    const harness = createHarness({
      deleteManagedFile: async () => {
        diskCalls += 1;
        return 'deleted';
      },
    });
    const first = historyItem(
      'duplicate-combined',
      '/app/downloaded-media/first-duplicate.mp4'
    );
    const second = {
      ...historyItem(
        'duplicate-combined',
        '/app/downloaded-media/second-duplicate.mp4'
      ),
      sourceUrl: 'https://different.example/duplicate',
    };
    await harness.manager.mutate({
      rendererId: 1,
      mutation: { type: 'get' },
      seedItems: [first, second],
    });
    const result = await harness.manager.mutateDetailed({
      rendererId: 1,
      mutation: {
        type: 'delete-file-and-history',
        id: first.id,
        expectedLocalPath: first.localPath!,
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.deletion?.deferredReason, 'history_conflict');
    assert.equal(diskCalls, 0);
    assert.equal(harness.getStoredHistory()?.length, 2);
  });

  await t.test('shared path', async () => {
    let diskCalls = 0;
    const harness = createHarness({
      deleteManagedFile: async () => {
        diskCalls += 1;
        return 'deleted';
      },
    });
    const filePath = '/app/downloaded-media/shared-combined.mp4';
    const first = historyItem('shared-first', filePath);
    const second = historyItem('shared-second', filePath);
    await harness.manager.mutate({
      rendererId: 1,
      mutation: { type: 'get' },
      seedItems: [first, second],
    });
    const result = await harness.manager.mutateDetailed({
      rendererId: 1,
      mutation: {
        type: 'delete-file-and-history',
        id: first.id,
        expectedLocalPath: filePath,
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.deletion?.deferredReason, 'history_conflict');
    assert.equal(diskCalls, 0);
    assert.equal(harness.getStoredHistory()?.length, 2);
  });

  await t.test('external saved path', async () => {
    let diskCalls = 0;
    const harness = createHarness({
      deleteManagedFile: async () => {
        diskCalls += 1;
        return 'deleted';
      },
    });
    const filePath = '/Users/example/Videos/saved-combined.mp4';
    const item = historyItem('saved-combined', filePath);
    await harness.manager.mutate({
      rendererId: 1,
      mutation: { type: 'upsert', item },
      seedItems: [],
    });
    const result = await harness.manager.mutateDetailed({
      rendererId: 1,
      mutation: {
        type: 'delete-file-and-history',
        id: item.id,
        expectedLocalPath: filePath,
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.deletion?.deferredReason, 'history_conflict');
    assert.equal(diskCalls, 0);
    assert.equal(harness.getStoredHistory()?.length, 1);
  });

  await t.test('mounted path', async () => {
    let diskCalls = 0;
    const harness = createHarness({
      deleteManagedFile: async () => {
        diskCalls += 1;
        return 'deleted';
      },
    });
    const filePath = '/app/downloaded-media/mounted-combined.mp4';
    const item = historyItem('mounted-combined', filePath);
    await harness.manager.mutate({
      rendererId: 1,
      mutation: { type: 'upsert', item },
      seedItems: [],
    });
    await harness.manager.setMountedPaths(2, [filePath]);
    const result = await harness.manager.mutateDetailed({
      rendererId: 1,
      mutation: {
        type: 'delete-file-and-history',
        id: item.id,
        expectedLocalPath: filePath,
      },
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.deletion, {
      operation: 'delete-file-and-history',
      diskOutcome: 'deferred',
      historyOutcome: 'retained',
      deferredReason: 'mounted',
    });
    assert.equal(diskCalls, 0);
  });
});

test('delete file and history keeps durable intent when disk reclamation fails', async () => {
  const diskFailure = new Error('disk busy');
  const harness = createHarness({
    deleteManagedFile: async () => {
      throw diskFailure;
    },
  });
  const filePath = '/app/downloaded-media/failing-combined.mp4';
  const item = historyItem('failing-combined', filePath);
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });

  const result = await harness.manager.mutateDetailed({
    rendererId: 1,
    mutation: {
      type: 'delete-file-and-history',
      id: item.id,
      expectedLocalPath: filePath,
    },
  });

  assert.equal(result.success, false);
  assert.deepEqual(result.deletion, {
    operation: 'delete-file-and-history',
    diskOutcome: 'failed',
    historyOutcome: 'pending',
    deferredReason: 'disk_reclaim_failed',
    recovered: false,
  });
  assert.equal(harness.getStoredHistory()?.[0]?.localPath, filePath);
  assert.equal(harness.getPendingFileDeletions().length, 1);
});

test('delete file and history never touches disk without a verified durable intent', async () => {
  let diskCalls = 0;
  const harness = createHarness({
    savePendingFileDeletions: () => {
      throw new Error('intent store unavailable');
    },
    deleteManagedFile: async () => {
      diskCalls += 1;
      return 'deleted';
    },
  });
  const filePath = '/app/downloaded-media/unpersisted-combined.mp4';
  const item = historyItem('unpersisted-combined', filePath);
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });

  const result = await harness.manager.mutateDetailed({
    rendererId: 1,
    mutation: {
      type: 'delete-file-and-history',
      id: item.id,
      expectedLocalPath: filePath,
    },
  });

  assert.equal(result.success, false);
  assert.deepEqual(result.deletion, {
    operation: 'delete-file-and-history',
    diskOutcome: 'deferred',
    historyOutcome: 'retained',
    deferredReason: 'intent_persistence_failed',
  });
  assert.equal(diskCalls, 0);
  assert.equal(harness.getStoredHistory()?.[0]?.localPath, filePath);
  assert.deepEqual(harness.getPendingFileDeletions(), []);
});

test('delete file and history recovers removal after history persistence fails', async () => {
  let failNextHistorySave = false;
  let filePresent = true;
  const harness = createHarness({
    saveHistory: (items, persist) => {
      if (failNextHistorySave) {
        failNextHistorySave = false;
        throw new Error('history store unavailable');
      }
      persist(items);
    },
    deleteManagedFile: async () => {
      if (filePresent) {
        filePresent = false;
        return 'deleted';
      }
      return 'already_absent';
    },
  });
  const filePath = '/app/downloaded-media/recover-combined.mp4';
  const item = historyItem('recover-combined', filePath);
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });
  failNextHistorySave = true;

  const partial = await harness.manager.mutateDetailed({
    rendererId: 1,
    mutation: {
      type: 'delete-file-and-history',
      id: item.id,
      expectedLocalPath: filePath,
    },
  });
  assert.equal(partial.success, false);
  assert.equal(partial.deletion?.diskOutcome, 'deleted');
  assert.equal(partial.deletion?.historyOutcome, 'pending');
  assert.equal(harness.getStoredHistory()?.length, 1);
  assert.equal(harness.getPendingFileDeletions().length, 1);

  const recovered = await harness.createManager().mutateDetailed({
    rendererId: 2,
    mutation: { type: 'get' },
  });
  assert.equal(recovered.success, true);
  assert.deepEqual(recovered.items, []);
  assert.deepEqual(recovered.deletion, {
    operation: 'delete-file-and-history',
    diskOutcome: 'already_absent',
    historyOutcome: 'removed',
    recovered: true,
  });
  assert.deepEqual(harness.getPendingFileDeletions(), []);
});

test(
  'case-distinct managed paths retain independent ownership',
  { skip: process.platform === 'win32' },
  async () => {
    const harness = createHarness();
    const upperPath = '/app/downloaded-media/Foo.mp4';
    const lowerPath = '/app/downloaded-media/foo.mp4';
    const upperItem = historyItem('upper-case-path', upperPath);
    const lowerItem = historyItem('lower-case-path', lowerPath);

    await harness.manager.mutate({
      rendererId: 1,
      mutation: { type: 'upsert', item: upperItem },
      seedItems: [],
    });
    await harness.manager.mutate({
      rendererId: 1,
      mutation: { type: 'upsert', item: lowerItem },
    });

    assert.deepEqual(
      harness.getStoredHistory()?.map(item => item.id),
      ['lower-case-path', 'upper-case-path']
    );

    await harness.manager.mutate({
      rendererId: 1,
      mutation: { type: 'remove', id: lowerItem.id },
    });

    assert.deepEqual(harness.reclaimed, [lowerPath]);
    assert.equal(harness.getStoredHistory()?.[0]?.localPath, upperPath);
  }
);

test('history removal defers reclamation until every mounted lease releases', async () => {
  const harness = createHarness();
  const filePath = '/app/downloaded-media/mounted.mp4';
  const item = historyItem('mounted', filePath);

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });
  await harness.manager.setMountedPaths(2, [filePath]);
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'remove', id: item.id },
    mountedPaths: [],
  });

  assert.deepEqual(harness.reclaimed, []);
  assert.deepEqual(harness.getPendingReclaims(), [filePath]);

  await harness.manager.setMountedPaths(2, []);

  assert.deepEqual(harness.reclaimed, [filePath]);
  assert.deepEqual(harness.getPendingReclaims(), []);
});

test('a renderer mutation carries its current mount lease atomically', async () => {
  const harness = createHarness();
  const filePath = '/app/downloaded-media/current.mp4';
  const item = historyItem('current', filePath);

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'remove', id: item.id },
    mountedPaths: [filePath],
  });

  assert.deepEqual(harness.reclaimed, []);
  await harness.manager.releaseRenderer(1);
  assert.deepEqual(harness.reclaimed, [filePath]);
});

test('an initial empty lease report does not erase legacy renderer history', async () => {
  const harness = createHarness();
  const item = historyItem('legacy', '/app/downloaded-media/legacy.mp4');

  await harness.manager.setMountedPaths(1, []);
  const items = await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'get' },
    seedItems: [item],
  });

  assert.deepEqual(
    items.map(entry => entry.id),
    ['legacy']
  );
  assert.deepEqual(
    harness.getStoredHistory()?.map(entry => entry.id),
    ['legacy']
  );
  assert.deepEqual(harness.reclaimed, []);
});

test('failed reclamation remains persisted for a later retry', async () => {
  let attempts = 0;
  const reclaimed: string[] = [];
  const harness = createHarness({
    reclaimPaths: async filePaths => {
      attempts += 1;
      if (attempts === 1) return [];
      reclaimed.push(...filePaths);
      return filePaths;
    },
  });
  const filePath = '/app/downloaded-media/retry.mp4';
  const item = historyItem('retry', filePath);

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'remove', id: item.id },
  });

  assert.deepEqual(harness.getPendingReclaims(), [filePath]);
  assert.deepEqual(reclaimed, []);

  await harness.manager.setMountedPaths(1, []);
  assert.deepEqual(reclaimed, [filePath]);
  assert.deepEqual(harness.getPendingReclaims(), []);
});

test('rollback can reclaim a promoted path missing from history', async () => {
  const harness = createHarness();
  const filePath = '/app/downloaded-media/uncommitted.mp4';

  await harness.manager.mutate({
    rendererId: 1,
    mutation: {
      type: 'remove',
      id: 'missing-history-entry',
      reclaimPath: filePath,
    },
    seedItems: [],
  });

  assert.deepEqual(harness.reclaimed, [filePath]);
  assert.deepEqual(harness.getStoredHistory(), []);
});

test('cleanup maintenance failure does not misreport committed history', async () => {
  const maintenanceErrors: unknown[] = [];
  const reclaimError = new Error('file is busy');
  const harness = createHarness({
    reclaimPaths: async () => {
      throw reclaimError;
    },
    onMaintenanceError: error => maintenanceErrors.push(error),
  });
  const filePath = '/app/downloaded-media/busy.mp4';
  const item = historyItem('busy', filePath);

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item },
    seedItems: [],
  });
  const items = await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'remove', id: item.id },
  });

  assert.deepEqual(items, []);
  assert.deepEqual(maintenanceErrors, [reclaimError]);
  assert.deepEqual(harness.getPendingReclaims(), [filePath]);
});

test('trackPromotedFile shields the promoted file until its upsert commits', async () => {
  const harness = createHarness();
  const promotedPath = '/app/downloaded-media/promoted.mp4';

  await harness.manager.trackPromotedFile(promotedPath);
  // Ownership is durable immediately: the claim is persisted before the
  // accept handler replies to the renderer.
  assert.deepEqual(harness.getPendingReclaims(), [promotedPath]);

  // Another tab's mutation flushes reclaims before the promoting renderer
  // commits its history upsert — the commit grace period protects the file.
  await harness.manager.mutate({
    rendererId: 2,
    mutation: {
      type: 'upsert',
      item: historyItem('other', '/app/downloaded-media/other.mp4'),
    },
    seedItems: [],
  });
  assert.deepEqual(harness.reclaimed, []);

  // The promoting renderer's upsert commits: history now owns the path and
  // flush hygiene drops the reclaim claim.
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item: historyItem('promoted', promotedPath) },
  });
  assert.deepEqual(harness.reclaimed, []);
  assert.deepEqual(harness.getPendingReclaims(), []);
});

test('promotion ownership rollback cannot remove a newer same-path claim', async () => {
  const harness = createHarness();
  const promotedPath = '/app/downloaded-media/shared-promotion.mp4';

  const firstOwnership = await harness.manager.trackPromotedFile(promotedPath);
  const secondOwnership = await harness.manager.trackPromotedFile(promotedPath);
  await firstOwnership.rollback();
  assert.deepEqual(harness.getPendingReclaims(), [promotedPath]);

  // Rolling back the current owner restores the prior claim instead of
  // erasing ownership that this caller did not create.
  await secondOwnership.rollback();
  assert.deepEqual(harness.getPendingReclaims(), [promotedPath]);
  await firstOwnership.rollback();
  assert.deepEqual(harness.getPendingReclaims(), []);
});

test('restored reclaim entries carry no grace and are swept on the next flush', async () => {
  const orphanPath = '/app/downloaded-media/orphan.mp4';
  const harness = createHarness({ initialPendingReclaims: [orphanPath] });

  // Simulates the next session after a renderer died between promotion and
  // its history commit: the persisted claim is restored without a grace
  // delay and the orphaned file is reclaimed by the first flush.
  await harness.manager.mutate({
    rendererId: 1,
    mutation: {
      type: 'upsert',
      item: historyItem('fresh', '/app/downloaded-media/fresh.mp4'),
    },
    seedItems: [],
  });

  assert.deepEqual(harness.reclaimed, [orphanPath]);
  assert.deepEqual(harness.getPendingReclaims(), []);
});

test('a transient load failure does not permanently drop persisted reclaim work', async () => {
  const orphanPath = '/app/downloaded-media/orphan.mp4';
  let failNextLoad = true;
  const harness = createHarness({
    initialPendingReclaims: [orphanPath],
    loadPendingReclaims: stored => {
      if (failNextLoad) {
        failNextLoad = false;
        throw new Error('pending reclaims unavailable');
      }
      return stored;
    },
  });

  await assert.rejects(
    harness.manager.mutate({
      rendererId: 1,
      mutation: {
        type: 'upsert',
        item: historyItem('fresh', '/app/downloaded-media/fresh.mp4'),
      },
      seedItems: [],
    }),
    /pending reclaims unavailable/
  );
  assert.deepEqual(harness.reclaimed, []);

  // The manager must not have marked itself loaded — the retry reloads the
  // persisted queue and reclaims the orphan.
  await harness.manager.mutate({
    rendererId: 1,
    mutation: {
      type: 'upsert',
      item: historyItem('fresh', '/app/downloaded-media/fresh.mp4'),
    },
    seedItems: [],
  });
  assert.deepEqual(harness.reclaimed, [orphanPath]);
  assert.deepEqual(harness.getPendingReclaims(), []);
});

test('rolling back a stale upsert restores the entry it displaced', async () => {
  const harness = createHarness({ commitGraceMs: 60_000 });
  for (let i = 0; i < 40; i++) {
    await harness.manager.mutate({
      rendererId: 1,
      mutation: {
        type: 'upsert',
        item: historyItem(`item-${i}`, `/app/downloaded-media/item-${i}.mp4`),
      },
      seedItems: [],
    });
  }

  // The 41st upsert displaces the oldest entry past the size cap. The commit
  // grace keeps the displaced file on disk while the operation might still
  // be rolled back.
  const stalePath = '/app/downloaded-media/stale.mp4';
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item: historyItem('stale', stalePath) },
  });
  assert.equal(harness.getStoredHistory()?.length, 40);
  assert.ok(!harness.getStoredHistory()?.some(item => item.id === 'item-0'));
  assert.deepEqual(harness.reclaimed, []);

  // The operation turns out stale: rollback removes the new entry, restores
  // the displaced one, and reclaims only the stale promoted file.
  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'rollback-upsert', id: 'stale', reclaimPath: stalePath },
  });
  const ids = harness.getStoredHistory()?.map(item => item.id) ?? [];
  assert.equal(ids.length, 40);
  assert.ok(ids.includes('item-0'));
  assert.ok(!ids.includes('stale'));
  assert.deepEqual(harness.reclaimed, [stalePath]);
});

test('rolling back a stale upsert restores a deduplicated predecessor', async () => {
  const harness = createHarness({ commitGraceMs: 60_000 });
  const sourceUrl = 'https://example.com/same-source';
  const legacyItem: VideoSuggestionDownloadHistoryItem = {
    id: 'legacy-pathless',
    sourceUrl,
    title: 'Legacy pathless entry',
    downloadedAtIso: '2025-01-01T00:00:00.000Z',
  };
  const stalePath = '/app/downloaded-media/stale-redownload.mp4';
  const staleItem = {
    ...historyItem('stale-redownload', stalePath),
    sourceUrl,
  };

  await harness.manager.mutate({
    rendererId: 1,
    mutation: { type: 'upsert', item: staleItem },
    seedItems: [legacyItem],
  });
  assert.deepEqual(
    harness.getStoredHistory()?.map(item => item.id),
    ['stale-redownload']
  );

  await harness.manager.mutate({
    rendererId: 1,
    mutation: {
      type: 'rollback-upsert',
      id: staleItem.id,
      reclaimPath: stalePath,
    },
  });

  assert.deepEqual(harness.getStoredHistory(), [legacyItem]);
  assert.deepEqual(harness.reclaimed, [stalePath]);
});

test('an uncommitted promoted file is reclaimed once its grace expires', async () => {
  const harness = createHarness({ commitGraceMs: 60 });
  const promotedPath = '/app/downloaded-media/crashed.mp4';

  await harness.manager.trackPromotedFile(promotedPath);
  // The renderer crashes before committing its upsert; the release-triggered
  // flush lands inside the grace window and must skip the file.
  await harness.manager.releaseRenderer(1);
  assert.deepEqual(harness.reclaimed, []);

  // No further mutation arrives — the scheduled grace flush alone must
  // reclaim the orphan.
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(harness.reclaimed, [promotedPath]);
  assert.deepEqual(harness.getPendingReclaims(), []);
});
