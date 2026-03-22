import test from 'node:test';
import assert from 'node:assert/strict';

function installElectronMock(overrides: Record<string, unknown>) {
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    electron: {
      getLanguagePreference: async () => 'en',
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
      deleteStoredSubtitleEntry: async () => ({
        success: true,
        removed: true,
      }),
      ...overrides,
    },
  };
  return () => {
    (globalThis as any).window = previousWindow;
  };
}

function installBrowserGlobals() {
  const previousLocalStorage = (globalThis as any).localStorage;
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, String(value));
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };

  return () => {
    (globalThis as any).localStorage = previousLocalStorage;
  };
}

test('document auto-mount preserves stored-library linkage when matching history exists', async () => {
  const restoreBrowserGlobals = installBrowserGlobals();
  const restoreWindow = installElectronMock({
    findSubtitleDocumentForSource: async () => ({
      success: true,
      found: true,
      document: {
        id: 'doc-1',
        title: 'Transcript document',
        subtitleKind: 'transcription',
        targetLanguage: null,
        sourceVideoPath: '/Users/test/Videos/interview.mp4',
        sourceVideoAssetIdentity: 'asset:123',
        importFilePath: null,
        lastExportPath: null,
        activeLinkedFilePath: '/Users/test/Subtitles/translation-only.srt',
        activeLinkedFileMode: 'translation',
        activeLinkedFileRole: 'export',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        transcriptionEngine: 'whisper',
      },
      segments: [
        {
          id: 'seg-1',
          index: 1,
          start: 0,
          end: 2,
          original: 'Hello world',
        },
      ],
    }),
    findStoredSubtitleForVideo: async () => ({
      success: true,
      entry: {
        id: 'lib-1',
        kind: 'transcription',
        targetLanguage: null,
        filePath: '/Users/test/Subtitles/generated.srt',
        sourceVideoPaths: ['/Users/test/Videos/interview.mp4'],
        sourceVideoAssetIdentities: ['asset:123'],
        sourceUrls: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    }),
  });

  try {
    const { maybeAutoMountStoredSubtitleForVideo } =
      await import('./subtitle-library');
    const { useSubStore } = await import('../state/subtitle-store');
    const { useUIStore } = await import('../state/ui-store');
    const { useVideoStore } = await import('../state/video-store');
    useUIStore.setState({ targetLanguage: 'original' } as any);
    useVideoStore.setState({
      path: '/Users/test/Videos/interview.mp4',
      originalPath: '/Users/test/Videos/interview.mp4',
      sourceAssetIdentity: 'asset:123',
      sourceUrl: null,
    } as any);

    const mounted = await maybeAutoMountStoredSubtitleForVideo({
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceUrl: null,
    });

    assert.equal(mounted, null);

    const state = useSubStore.getState();
    assert.equal(state.documentId, 'doc-1');
    assert.equal(state.libraryEntryId, 'lib-1');
    assert.equal(state.libraryKind, 'transcription');
    assert.equal(
      state.activeFilePath,
      '/Users/test/Subtitles/translation-only.srt'
    );
    assert.equal(state.activeFileMode, 'translation');
    assert.equal(state.activeFileRole, 'export');
  } finally {
    restoreWindow();
    restoreBrowserGlobals();
  }
});

test('fallback document auto-mount keeps the requested subtitle variant filters', async () => {
  const restoreBrowserGlobals = installBrowserGlobals();
  const documentLookupCalls: any[] = [];
  const restoreWindow = installElectronMock({
    findSubtitleDocumentForSource: async (options: any) => {
      documentLookupCalls.push(options);
      return {
        success: true,
        found: false,
      };
    },
    findStoredSubtitleForVideo: async () => ({
      success: true,
      entry: null,
      content: '',
      segments: [],
    }),
  });

  try {
    const { maybeAutoMountStoredSubtitleForVideo } =
      await import('./subtitle-library');
    const { useUIStore } = await import('../state/ui-store');
    const { useVideoStore } = await import('../state/video-store');

    useUIStore.setState({ targetLanguage: 'spanish' } as any);
    useVideoStore.setState({
      path: '/Users/test/Videos/interview.mp4',
      originalPath: '/Users/test/Videos/interview.mp4',
      sourceAssetIdentity: 'asset:123',
      sourceUrl: null,
    } as any);

    await maybeAutoMountStoredSubtitleForVideo({
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceUrl: null,
    });

    assert.equal(documentLookupCalls.length, 2);
    assert.deepEqual(documentLookupCalls[0], {
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      sourceUrl: null,
      subtitleKind: 'translation',
      targetLanguage: 'spanish',
    });
    assert.deepEqual(documentLookupCalls[1], {
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      sourceUrl: null,
      subtitleKind: 'translation',
      targetLanguage: 'spanish',
    });
  } finally {
    restoreWindow();
    restoreBrowserGlobals();
  }
});

test('deleting a mounted stored subtitle detaches its document source before removing the library entry', async () => {
  const restoreBrowserGlobals = installBrowserGlobals();
  let detachedDocumentId: string | null = null;
  let deletedEntryId: string | null = null;
  const restoreWindow = installElectronMock({
    detachSubtitleDocumentSource: async (options: any) => {
      detachedDocumentId = options.documentId ?? null;
      return {
        success: true,
        updated: true,
      };
    },
    deleteStoredSubtitleEntry: async (entryId: string) => {
      deletedEntryId = entryId;
      return {
        success: true,
        removed: true,
      };
    },
  });

  try {
    const { deleteMountedStoredSubtitle } = await import('./subtitle-library');
    const { useSubStore } = await import('../state/subtitle-store');

    useSubStore.setState({
      documentId: 'doc-1',
      libraryEntryId: 'lib-1',
      order: [],
      segments: {},
    } as any);

    const removed = await deleteMountedStoredSubtitle();

    assert.equal(removed, true);
    assert.equal(detachedDocumentId, 'doc-1');
    assert.equal(deletedEntryId, 'lib-1');
  } finally {
    restoreWindow();
    restoreBrowserGlobals();
  }
});
