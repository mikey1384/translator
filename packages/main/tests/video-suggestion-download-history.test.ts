import test from 'node:test';
import assert from 'node:assert/strict';
import type { VideoSuggestionDownloadHistoryItem } from '@shared-types/app';
import { VideoSuggestionDownloadHistoryManager } from '../services/video-suggestion-download-history.js';

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
    commitGraceMs?: number;
  } = {}
) {
  let storedHistory: VideoSuggestionDownloadHistoryItem[] | null = null;
  let pendingReclaims: string[] = options.initialPendingReclaims ?? [];
  const reclaimed: string[] = [];
  const manager = new VideoSuggestionDownloadHistoryManager({
    persistence: {
      loadHistory: () => storedHistory,
      saveHistory: items => {
        storedHistory = structuredClone(items);
      },
      loadPendingReclaims: () =>
        options.loadPendingReclaims
          ? options.loadPendingReclaims(pendingReclaims)
          : pendingReclaims,
      savePendingReclaims: paths => {
        pendingReclaims = [...paths];
      },
    },
    isManagedLibraryPath: filePath => filePath.includes('/downloaded-media/'),
    reclaimPaths:
      options.reclaimPaths ??
      (async filePaths => {
        reclaimed.push(...filePaths);
        return filePaths;
      }),
    onMaintenanceError: options.onMaintenanceError,
    commitGraceMs: options.commitGraceMs,
  });
  return {
    manager,
    reclaimed,
    getStoredHistory: () => storedHistory,
    getPendingReclaims: () => pendingReclaims,
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
