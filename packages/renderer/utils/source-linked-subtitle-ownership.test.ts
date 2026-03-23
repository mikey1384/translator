import test from 'node:test';
import assert from 'node:assert/strict';

function installElectronMock(overrides: Record<string, unknown>) {
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = {
    electron: {
      findSubtitleDocumentForSource: async () => ({
        success: true,
        found: false,
      }),
      detachSubtitleDocumentSource: async () => ({
        success: true,
        updated: true,
      }),
      findStoredSubtitleForVideo: async () => ({
        success: true,
        entry: null,
      }),
      detachStoredSubtitleSource: async () => ({
        success: true,
        updated: true,
      }),
      ...overrides,
    },
  };
  return () => {
    (globalThis as any).window = previousWindow;
  };
}

test('detachSourceLinkedSubtitleOwnership detaches every source-linked document and library entry', async () => {
  const detachedDocumentIds: string[] = [];
  const detachedLibraryEntryIds: string[] = [];
  const documentQueue = ['doc-1', 'doc-2', null] as Array<string | null>;
  const libraryQueue = ['lib-1', 'lib-2', null] as Array<string | null>;
  const restoreWindow = installElectronMock({
    findSubtitleDocumentForSource: async () => {
      const nextId = documentQueue.shift() ?? null;
      return {
        success: true,
        found: Boolean(nextId),
        document: nextId ? { id: nextId } : undefined,
      };
    },
    detachSubtitleDocumentSource: async (options: any) => {
      detachedDocumentIds.push(options.documentId);
      return {
        success: true,
        updated: true,
      };
    },
    findStoredSubtitleForVideo: async () => {
      const nextId = libraryQueue.shift() ?? null;
      return {
        success: true,
        entry: nextId ? { id: nextId } : null,
      };
    },
    detachStoredSubtitleSource: async (options: any) => {
      detachedLibraryEntryIds.push(options.entryId);
      return {
        success: true,
        updated: true,
      };
    },
  });

  try {
    const { detachSourceLinkedSubtitleOwnership } = await import(
      './source-linked-subtitle-ownership'
    );

    const result = await detachSourceLinkedSubtitleOwnership({
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
    });

    assert.deepEqual(result.detachedDocumentIds, ['doc-1', 'doc-2']);
    assert.deepEqual(result.detachedLibraryEntryIds, ['lib-1', 'lib-2']);
    assert.deepEqual(detachedDocumentIds, ['doc-1', 'doc-2']);
    assert.deepEqual(detachedLibraryEntryIds, ['lib-1', 'lib-2']);
  } finally {
    restoreWindow();
  }
});
