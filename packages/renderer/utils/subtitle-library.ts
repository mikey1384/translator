import type {
  StoredSubtitleKind,
  StoredSubtitleEntry,
} from '@shared-types/app';
import { parseSrt } from '../../shared/helpers';
import * as SubtitleLibraryIPC from '../ipc/subtitle-library';
import { useSubStore } from '../state/subtitle-store';
import { useUIStore } from '../state/ui-store';
import { useVideoStore } from '../state/video-store';
import { openUnsavedSrtConfirm } from '../state/modal-store';
import { saveCurrentSubtitles } from './saveSubtitles';

type StoredSubtitleLibraryMeta = {
  entryId: string | null;
  kind: StoredSubtitleKind | null;
};

function normalizeComparablePath(value: string | null | undefined): string | null {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  return normalized || null;
}

function pathsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
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

export async function storeGeneratedSubtitleArtifact(args: {
  content: string;
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
    };
  }
  const result = await SubtitleLibraryIPC.saveStoredSubtitleArtifact(args);
  if (!result.success || !result.entry) {
    throw new Error(result.error || 'Failed to store subtitle history item.');
  }
  return {
    entryId: result.entry.id,
    kind: result.entry.kind,
  };
}

export async function maybeAutoMountStoredSubtitleForVideo(args: {
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
  if (!result.entry || !result.content?.trim()) {
    return null;
  }
  if (!matchesCurrentVideoRequest(args)) {
    return null;
  }

  const sourceVideoPath =
    typeof args.sourceVideoPath === 'string' && args.sourceVideoPath.trim()
      ? args.sourceVideoPath
      : null;
  if (
    sourceVideoPath &&
    !result.entry.sourceVideoPaths.some(path => pathsMatch(path, sourceVideoPath))
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

  useSubStore.getState().load(
    parseSrt(result.content),
    null,
    'fresh',
    sourceVideoPath,
    null,
    {
      entryId: result.entry.id,
      kind: result.entry.kind,
    }
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
    originalPath: null,
    origin: null,
    sourceVideoPath: null,
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
  const hasMountedSubtitles = subtitleState.order.length > 0;
  if (hasMountedSubtitles) {
    const choice = await openUnsavedSrtConfirm();
    if (choice === 'cancel') {
      return false;
    }
    if (choice === 'save') {
      const saved = await saveCurrentSubtitles();
      if (!saved) {
        return false;
      }
    }
  }
  const result = await SubtitleLibraryIPC.deleteStoredSubtitleEntry(
    libraryEntryId
  );
  if (!result.success) {
    throw new Error(result.error || 'Failed to delete stored subtitle.');
  }
  if (result.removed) {
    unmountCurrentSubtitles();
  }
  return Boolean(result.removed);
}
