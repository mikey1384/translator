import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCanonicalSubtitleSrt,
  buildSavedSubtitleSrt,
} from './canonical-subtitle-srt';

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

function installElectronMock(overrides: Record<string, unknown>) {
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    electron: {
      getLanguagePreference: async () => 'en',
      showMessage: async () => undefined,
      saveSubtitleDocument: async () => ({
        status: 'success',
      }),
      saveSubtitleDocumentRecord: async () => ({
        success: true,
      }),
      ...overrides,
    },
  };
  return () => {
    (globalThis as any).window = previousWindow;
  };
}

test('saved subtitle export respects original mode', () => {
  const content = buildSavedSubtitleSrt(
    [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 2,
        original: 'Hola',
        translation: 'Hello',
      },
    ],
    'original'
  );

  assert.equal(
    content,
    `1
00:00:00,000 --> 00:00:02,000
Hola`
  );
});

test('saved subtitle export respects translation mode', () => {
  const content = buildSavedSubtitleSrt(
    [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 2,
        original: 'Hola',
        translation: 'Hello',
      },
    ],
    'translation'
  );

  assert.equal(
    content,
    `1
00:00:00,000 --> 00:00:02,000
Hello`
  );
});

test('saved subtitle export respects dual mode', () => {
  const content = buildSavedSubtitleSrt(
    [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 2,
        original: 'Hola',
        translation: 'Hello',
      },
    ],
    'dual'
  );

  assert.equal(
    content,
    `1
00:00:00,000 --> 00:00:02,000
Hola
Hello`
  );
});

test('saved subtitle export preserves multiline subtitle text without wrapping', () => {
  const content = buildSavedSubtitleSrt(
    [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 2,
        original: 'line 1\nline 2',
        translation: 'translated 1\ntranslated 2',
      },
    ],
    'dual'
  );

  assert.equal(
    content,
    `1
00:00:00,000 --> 00:00:02,000
line 1
line 2
translated 1
translated 2`
  );
});

test('canonical subtitle serialization still preserves both original and translation for app metadata', () => {
  const content = buildCanonicalSubtitleSrt([
    {
      id: 'seg-1',
      index: 1,
      start: 0,
      end: 2,
      original: 'Hola',
      translation: 'Hello',
    },
  ]);

  assert.equal(
    content,
    `1
00:00:00,000 --> 00:00:02,000
Hola
Hello`
  );
});

test('manual Save writes the active file using its remembered mode', async () => {
  const restoreBrowserGlobals = installBrowserGlobals();
  let capturedOptions: any = null;
  const restoreWindow = installElectronMock({
    saveSubtitleDocument: async (options: any) => {
      capturedOptions = options;
      return {
        status: 'success',
        filePath: options.filePath,
        document: {
          id: 'doc-1',
          title: 'Mounted subtitles',
          importFilePath: options.importFilePath ?? null,
          lastExportPath: options.filePath,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      };
    },
  });

  try {
    const { saveCurrentSubtitles } = await import('./saveSubtitles');
    const { useSubStore } = await import('../state/subtitle-store');
    const { useUIStore } = await import('../state/ui-store');
    useUIStore.setState({ subtitleDisplayMode: 'original' } as any);
    useSubStore.getState().load(
      [
        {
          id: 'seg-1',
          index: 1,
          start: 0,
          end: 2,
          original: 'Hola',
          translation: 'Hello',
        },
      ],
      '/Users/test/Subtitles/input.srt',
      'disk'
    );
    useSubStore.getState().setActiveFileTarget({
      filePath: '/Users/test/Subtitles/input.srt',
      mode: 'translation',
      role: 'import',
    });

    const result = await saveCurrentSubtitles();

    assert.equal(result.status, 'success');
    assert.ok(capturedOptions);
    assert.equal(capturedOptions.filePath, '/Users/test/Subtitles/input.srt');
    assert.equal(capturedOptions.fileMode, 'translation');
    assert.equal(
      capturedOptions.importFilePath,
      '/Users/test/Subtitles/input.srt'
    );
    assert.equal(capturedOptions.importMode, 'translation');
    assert.equal(
      capturedOptions.srtContent,
      `1
00:00:00,000 --> 00:00:02,000
Hello`
    );

    const state = useSubStore.getState();
    assert.equal(state.activeFilePath, '/Users/test/Subtitles/input.srt');
    assert.equal(state.activeFileMode, 'translation');
    assert.equal(state.activeFileRole, 'import');
    assert.equal(state.exportPath, '/Users/test/Subtitles/input.srt');
  } finally {
    restoreWindow();
    restoreBrowserGlobals();
  }
});
