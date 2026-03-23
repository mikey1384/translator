import type {
  SrtSegment,
  StoredSubtitleKind,
  StoredSubtitleEntry,
} from '@shared-types/app';
import { parseSrt } from '../../shared/helpers';
import * as SubtitleLibraryIPC from '../ipc/subtitle-library';
import * as FileIPC from '../ipc/file';
import { useSubStore } from '../state/subtitle-store';
import { useUIStore } from '../state/ui-store';
import { useVideoStore } from '../state/video-store';
import { openUnsavedSrtConfirm } from '../state/modal-store';
import { didSaveSubtitleFile, saveCurrentSubtitles } from './saveSubtitles';

type StoredSubtitleLibraryMeta = {
  entryId: string | null;
  kind: StoredSubtitleKind | null;
  targetLanguage: string | null;
};

function normalizeComparablePath(
  value: string | null | undefined
): string | null {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  return normalized || null;
}

function pathsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizeComparablePath(a);
  const right = normalizeComparablePath(b);
  return Boolean(left && right && left === right);
}

function normalizeComparableSourceUrl(
  value: string | null | undefined
): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeComparableTargetLanguage(
  value: string | null | undefined
): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized || null;
}

function getPreferredSubtitleVariant(
  targetLanguage: string | null | undefined
): {
  subtitleKind: StoredSubtitleKind;
  targetLanguage?: string | null;
} {
  const normalizedTargetLanguage =
    normalizeComparableTargetLanguage(targetLanguage);
  if (!normalizedTargetLanguage || normalizedTargetLanguage === 'original') {
    return { subtitleKind: 'transcription' };
  }
  return {
    subtitleKind: 'translation',
    targetLanguage: normalizedTargetLanguage,
  };
}

function matchesCurrentVideoRequest(args: {
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
}): boolean {
  const state = useVideoStore.getState();
  const requestedPath = normalizeComparablePath(args.sourceVideoPath);
  const requestedSourceUrl = normalizeComparableSourceUrl(args.sourceUrl);

  if (
    requestedPath &&
    !pathsMatch(state.path, requestedPath) &&
    !pathsMatch(state.originalPath, requestedPath)
  ) {
    return false;
  }

  if (requestedSourceUrl) {
    const currentSourceUrl = normalizeComparableSourceUrl(state.sourceUrl);
    if (!currentSourceUrl || currentSourceUrl !== requestedSourceUrl) {
      return false;
    }
  }

  return true;
}

function restoreDocumentActiveFileTarget(
  document: import('@shared-types/app').SubtitleDocumentMeta | null | undefined
): void {
  const filePath = document?.activeLinkedFilePath ?? null;
  useSubStore.getState().setActiveFileTarget({
    filePath,
    mode: filePath ? (document?.activeLinkedFileMode ?? null) : null,
    role: filePath ? (document?.activeLinkedFileRole ?? null) : null,
  });
}

async function findStoredSubtitleEntryForVideo(args: {
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
}): Promise<StoredSubtitleEntry | null> {
  const result = await SubtitleLibraryIPC.findStoredSubtitleForVideo({
    ...args,
    targetLanguage: useUIStore.getState().targetLanguage || null,
  });
  if (!result.success) {
    throw new Error(result.error || 'Failed to look up subtitle history.');
  }
  return result.entry ?? null;
}

export async function storeGeneratedSubtitleArtifact(args: {
  content: string;
  segments?: SrtSegment[];
  kind: StoredSubtitleKind;
  targetLanguage?: string | null;
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
  titleHint?: string | null;
}): Promise<StoredSubtitleLibraryMeta> {
  const hasSourceVideoPath = Boolean(String(args.sourceVideoPath || '').trim());
  const hasSourceUrl = Boolean(String(args.sourceUrl || '').trim());
  if (!hasSourceVideoPath && !hasSourceUrl) {
    return {
      entryId: null,
      kind: null,
      targetLanguage: null,
    };
  }
  const result = await SubtitleLibraryIPC.saveStoredSubtitleArtifact(args);
  if (!result.success || !result.entry) {
    throw new Error(result.error || 'Failed to store subtitle history item.');
  }
  return {
    entryId: result.entry.id,
    kind: result.entry.kind,
    targetLanguage: result.entry.targetLanguage,
  };
}

export async function maybeAutoMountStoredSubtitleForVideo(args: {
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
}): Promise<StoredSubtitleEntry | null> {
  const currentVideoState = useVideoStore.getState();
  const sourceVideoPath =
    typeof args.sourceVideoPath === 'string' && args.sourceVideoPath.trim()
      ? args.sourceVideoPath
      : null;
  const sourceVideoAssetIdentity =
    sourceVideoPath &&
    (pathsMatch(currentVideoState.path, sourceVideoPath) ||
      pathsMatch(currentVideoState.originalPath, sourceVideoPath))
      ? currentVideoState.sourceAssetIdentity
      : null;

  const preferredVariant = getPreferredSubtitleVariant(
    useUIStore.getState().targetLanguage || null
  );

  const documentResult = await FileIPC.findSubtitleDocumentForSource({
    sourceVideoPath,
    sourceVideoAssetIdentity,
    sourceUrl: args.sourceUrl ?? null,
    subtitleKind: preferredVariant.subtitleKind,
    targetLanguage: preferredVariant.targetLanguage ?? null,
  });
  if (
    documentResult.success &&
    documentResult.document &&
    Array.isArray(documentResult.segments) &&
    documentResult.segments.length > 0 &&
    matchesCurrentVideoRequest(args)
  ) {
    let libraryMeta: StoredSubtitleLibraryMeta | null = null;
    try {
      const entry = await findStoredSubtitleEntryForVideo(args);
      if (
        sourceVideoPath &&
        entry &&
        !entry.sourceVideoPaths.some(path => pathsMatch(path, sourceVideoPath))
      ) {
        try {
          await SubtitleLibraryIPC.rememberStoredSubtitleVideoPath(
            entry.id,
            sourceVideoPath
          );
        } catch (error) {
          console.error(
            '[subtitle-library] Failed to remember stored subtitle video path during document auto-mount:',
            error
          );
        }
      }
      libraryMeta = entry
        ? {
            entryId: entry.id,
            kind: entry.kind,
            targetLanguage: entry.targetLanguage,
          }
        : null;
    } catch (error) {
      console.error(
        '[subtitle-library] Failed to restore stored subtitle linkage for document auto-mount:',
        error
      );
    }
    useSubStore
      .getState()
      .load(
        documentResult.segments,
        documentResult.document.importFilePath ?? null,
        documentResult.document.importFilePath ? 'disk' : 'fresh',
        sourceVideoPath,
        documentResult.document.transcriptionEngine ?? null,
        libraryMeta,
        sourceVideoAssetIdentity,
        documentResult.document
      );
    restoreDocumentActiveFileTarget(documentResult.document);
    return null;
  }

  const result = await SubtitleLibraryIPC.findStoredSubtitleForVideo({
    ...args,
    targetLanguage: useUIStore.getState().targetLanguage || null,
  });
  if (!result.success) {
    throw new Error(result.error || 'Failed to look up subtitle history.');
  }
  if (
    !result.entry ||
    (!result.content?.trim() &&
      (!Array.isArray(result.segments) || result.segments.length === 0))
  ) {
    const fallbackDocumentResult = await FileIPC.findSubtitleDocumentForSource({
      sourceVideoPath,
      sourceVideoAssetIdentity,
      sourceUrl: args.sourceUrl ?? null,
      subtitleKind: preferredVariant.subtitleKind,
      targetLanguage: preferredVariant.targetLanguage ?? null,
    });
    if (
      fallbackDocumentResult.success &&
      fallbackDocumentResult.document &&
      Array.isArray(fallbackDocumentResult.segments) &&
      fallbackDocumentResult.segments.length > 0 &&
      matchesCurrentVideoRequest(args)
    ) {
      let libraryMeta: StoredSubtitleLibraryMeta | null = null;
      try {
        const entry = await findStoredSubtitleEntryForVideo(args);
        if (
          sourceVideoPath &&
          entry &&
          !entry.sourceVideoPaths.some(path =>
            pathsMatch(path, sourceVideoPath)
          )
        ) {
          try {
            await SubtitleLibraryIPC.rememberStoredSubtitleVideoPath(
              entry.id,
              sourceVideoPath
            );
          } catch (error) {
            console.error(
              '[subtitle-library] Failed to remember stored subtitle video path during fallback document auto-mount:',
              error
            );
          }
        }
        libraryMeta = entry
          ? {
              entryId: entry.id,
              kind: entry.kind,
              targetLanguage: entry.targetLanguage,
            }
          : null;
      } catch (error) {
        console.error(
          '[subtitle-library] Failed to restore stored subtitle linkage for fallback document auto-mount:',
          error
        );
      }
      useSubStore
        .getState()
        .load(
          fallbackDocumentResult.segments,
          fallbackDocumentResult.document.importFilePath ?? null,
          fallbackDocumentResult.document.importFilePath ? 'disk' : 'fresh',
          sourceVideoPath,
          fallbackDocumentResult.document.transcriptionEngine ?? null,
          libraryMeta,
          sourceVideoAssetIdentity,
          fallbackDocumentResult.document
        );
      restoreDocumentActiveFileTarget(fallbackDocumentResult.document);
    }
    return null;
  }
  if (!matchesCurrentVideoRequest(args)) {
    return null;
  }

  if (
    sourceVideoPath &&
    !result.entry.sourceVideoPaths.some(path =>
      pathsMatch(path, sourceVideoPath)
    )
  ) {
    try {
      await SubtitleLibraryIPC.rememberStoredSubtitleVideoPath(
        result.entry.id,
        sourceVideoPath
      );
    } catch (error) {
      console.error(
        '[subtitle-library] Failed to remember restored subtitle video path:',
        error
      );
    }
  }

  const mountedSegments =
    Array.isArray(result.segments) && result.segments.length > 0
      ? result.segments
      : parseSrt(result.content || '');
  let documentMeta = null;
  try {
    const documentSaveResult = await FileIPC.saveSubtitleDocumentRecord({
      segments: mountedSegments,
      title: result.entry.filePath.split(/[\\/]/).pop() || null,
      sourceVideoPath,
      sourceVideoAssetIdentity,
      sourceUrl: args.sourceUrl ?? null,
      subtitleKind: result.entry.kind,
      targetLanguage: result.entry.targetLanguage,
    });
    if (documentSaveResult.success && documentSaveResult.document) {
      documentMeta = documentSaveResult.document;
    }
  } catch (error) {
    console.error(
      '[subtitle-library] Failed to create document from stored subtitle:',
      error
    );
  }

  useSubStore.getState().load(
    mountedSegments,
    null,
    'fresh',
    sourceVideoPath,
    null,
    {
      entryId: result.entry.id,
      kind: result.entry.kind,
      targetLanguage: result.entry.targetLanguage,
    },
    sourceVideoAssetIdentity,
    documentMeta
  );
  return result.entry;
}

export async function syncStoredSubtitleVideoAssociationPath(args: {
  previousPath: string;
  savedPath: string;
}): Promise<boolean> {
  const result = await SubtitleLibraryIPC.syncStoredSubtitleVideoPath(
    args.previousPath,
    args.savedPath
  );
  if (!result.success) {
    throw new Error(result.error || 'Failed to sync subtitle history path.');
  }
  return Boolean(result.updated);
}

export async function rememberStoredSubtitleSourcePath(args: {
  entryId: string;
  sourceVideoPath: string;
}): Promise<boolean> {
  const result = await SubtitleLibraryIPC.rememberStoredSubtitleVideoPath(
    args.entryId,
    args.sourceVideoPath
  );
  if (!result.success) {
    throw new Error(
      result.error || 'Failed to remember stored subtitle source path.'
    );
  }
  return Boolean(result.updated);
}

export function unmountCurrentSubtitles(): void {
  const current = useSubStore.getState();
  current._abortPlayListener?.();
  useSubStore.setState({
    segments: {},
    order: [],
    activeId: null,
    playingId: null,
    _abortPlayListener: undefined,
    sourceId: useSubStore.getState().sourceId + 1,
    documentId: null,
    documentTitle: null,
    originalPath: null,
    activeFilePath: null,
    activeFileMode: null,
    activeFileRole: null,
    exportPath: null,
    origin: null,
    sourceVideoPath: null,
    sourceVideoAssetIdentity: null,
    sourceUrl: null,
    subtitleKind: null,
    targetLanguage: null,
    transcriptionEngine: null,
    gapsCache: [],
    lcRangesCache: [],
    libraryEntryId: null,
    libraryKind: null,
  } as any);
}

export async function deleteMountedStoredSubtitle(): Promise<boolean> {
  const { libraryEntryId } = useSubStore.getState();
  if (!libraryEntryId) return false;
  const subtitleState = useSubStore.getState();
  const mountedDocumentId = subtitleState.documentId;
  const hasMountedSubtitles = subtitleState.order.length > 0;
  if (hasMountedSubtitles) {
    const choice = await openUnsavedSrtConfirm();
    if (choice === 'cancel') {
      return false;
    }
    if (choice === 'save') {
      const saveResult = await saveCurrentSubtitles();
      if (!didSaveSubtitleFile(saveResult)) {
        return false;
      }
    }
  }
  if (mountedDocumentId) {
    const detachResult = await FileIPC.detachSubtitleDocumentSource({
      documentId: mountedDocumentId,
    });
    if (!detachResult.success) {
      throw new Error(
        detachResult.error || 'Failed to detach subtitle document source.'
      );
    }
  }
  const result =
    await SubtitleLibraryIPC.deleteStoredSubtitleEntry(libraryEntryId);
  if (!result.success) {
    throw new Error(result.error || 'Failed to delete stored subtitle.');
  }
  if (result.removed) {
    unmountCurrentSubtitles();
  }
  return Boolean(result.removed);
}
