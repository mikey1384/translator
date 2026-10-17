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

test('fallback lookup asks for the most recent document of any kind', async () => {
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

    useUIStore.setState({
      targetLanguage: 'spanish',
      homeRunRequest: null,
    } as any);
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
    // Nothing for Spanish: any document for this video, of any kind.
    assert.deepEqual(documentLookupCalls[1], {
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      sourceUrl: null,
    });
  } finally {
    restoreWindow();
    restoreBrowserGlobals();
  }
});

function fallbackDocument(overrides: Record<string, unknown>) {
  return {
    id: 'doc-fallback',
    title: 'clip.srt',
    subtitleKind: null,
    targetLanguage: null,
    sourceVideoPath: '/Users/test/Videos/clip.mp4',
    sourceVideoAssetIdentity: 'asset:clip',
    importFilePath: '/Users/test/Subtitles/clip.srt',
    lastExportPath: null,
    activeLinkedFilePath: null,
    activeLinkedFileMode: null,
    activeLinkedFileRole: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    transcriptionEngine: null,
    ...overrides,
  };
}

async function runFallbackScenario(args: {
  latest: Record<string, unknown>;
  homeRunRequest: unknown;
}) {
  const restoreBrowserGlobals = installBrowserGlobals();
  const calls: any[] = [];
  const restoreWindow = installElectronMock({
    findSubtitleDocumentForSource: async (options: any) => {
      calls.push(options);
      if (options.subtitleKind === 'translation') {
        return { success: true, found: false };
      }
      if (options.subtitleKind === 'transcription') {
        return {
          success: true,
          found: true,
          document: fallbackDocument({
            id: 'doc-transcript',
            subtitleKind: 'transcription',
            importFilePath: null,
          }),
          segments: [
            { id: 't1', index: 1, start: 0, end: 1, original: 'Hola' },
          ],
        };
      }
      return {
        success: true,
        found: true,
        document: fallbackDocument(args.latest),
        segments: [
          { id: 'l1', index: 1, start: 0, end: 1, original: 'Edited line' },
        ],
      };
    },
    findStoredSubtitleForVideo: async () => ({
      success: true,
      entry: null,
    }),
  });
  try {
    const { maybeAutoMountStoredSubtitleForVideo } =
      await import('./subtitle-library');
    const { useSubStore } = await import('../state/subtitle-store');
    const { useUIStore } = await import('../state/ui-store');
    const { useVideoStore } = await import('../state/video-store');
    useUIStore.setState({
      targetLanguage: 'english',
      homeRunRequest: args.homeRunRequest,
    } as any);
    useVideoStore.setState({
      path: '/Users/test/Videos/clip.mp4',
      originalPath: '/Users/test/Videos/clip.mp4',
      sourceAssetIdentity: 'asset:clip',
      sourceUrl: null,
    } as any);
    await maybeAutoMountStoredSubtitleForVideo({
      sourceVideoPath: '/Users/test/Videos/clip.mp4',
      sourceUrl: null,
    });
    return { calls, documentId: useSubStore.getState().documentId };
  } finally {
    restoreWindow();
    restoreBrowserGlobals();
  }
}

test('an edited imported .srt comes back when the video is reopened', async () => {
  const { documentId } = await runFallbackScenario({
    latest: { id: 'doc-imported' },
    homeRunRequest: null,
  });
  assert.equal(documentId, 'doc-imported');
});

test('another language comes back when nothing more specific exists', async () => {
  const { documentId } = await runFallbackScenario({
    latest: {
      id: 'doc-korean',
      subtitleKind: 'translation',
      targetLanguage: 'korean',
    },
    homeRunRequest: null,
  });
  assert.equal(documentId, 'doc-korean');
});

test('an explicit "Make it speak" target never gets another language mounted', async () => {
  const { documentId, calls } = await runFallbackScenario({
    latest: {
      id: 'doc-korean',
      subtitleKind: 'translation',
      targetLanguage: 'korean',
    },
    homeRunRequest: {
      id: 1,
      kind: 'mounted',
      path: '/Users/test/Videos/clip.mp4',
    },
  });
  assert.equal(documentId, 'doc-transcript');
  assert.equal(calls[calls.length - 1].subtitleKind, 'transcription');
});

test('a document left via the logo is remembered across tabs (localStorage)', async () => {
  const restoreBrowserGlobals = installBrowserGlobals();
  try {
    const { rememberLeftDocument, takeLeftDocument } =
      await import('./subtitle-documents');
    rememberLeftDocument({ path: '/v/a.mp4', url: 'https://x/a' }, 'doc-a');
    // A different module instance (new tab) reads the same storage.
    assert.match(
      String(localStorage.getItem('stage5.leftSubtitleDocuments.v1')),
      /doc-a/
    );
    assert.equal(takeLeftDocument({ url: 'https://x/a' }), 'doc-a');
    assert.equal(takeLeftDocument({ path: '/v/a.mp4' }), null);
  } finally {
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
