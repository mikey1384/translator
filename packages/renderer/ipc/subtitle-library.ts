import type {
  StoredSubtitleEntry,
  StoredSubtitleKind,
} from '@shared-types/app';

export function saveStoredSubtitleArtifact(options: {
  content: string;
  kind: StoredSubtitleKind;
  targetLanguage?: string | null;
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
  titleHint?: string | null;
}): Promise<{ success: boolean; entry?: StoredSubtitleEntry; error?: string }> {
  return window.electron.saveStoredSubtitleArtifact(options);
}

export function findStoredSubtitleForVideo(options: {
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
  targetLanguage?: string | null;
}): Promise<{
  success: boolean;
  entry?: StoredSubtitleEntry | null;
  content?: string;
  error?: string;
}> {
  return window.electron.findStoredSubtitleForVideo(options);
}

export function syncStoredSubtitleVideoPath(
  previousPath: string,
  savedPath: string
): Promise<{ success: boolean; updated?: boolean; error?: string }> {
  return window.electron.syncStoredSubtitleVideoPath(previousPath, savedPath);
}

export function rememberStoredSubtitleVideoPath(
  entryId: string,
  sourceVideoPath: string
): Promise<{ success: boolean; updated?: boolean; error?: string }> {
  return window.electron.rememberStoredSubtitleVideoPath(
    entryId,
    sourceVideoPath
  );
}

export function detachStoredSubtitleSource(options: {
  entryId: string;
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
}): Promise<{ success: boolean; updated?: boolean; error?: string }> {
  return window.electron.detachStoredSubtitleSource(options);
}

export function deleteStoredSubtitleEntry(
  entryId: string
): Promise<{ success: boolean; removed?: boolean; error?: string }> {
  return window.electron.deleteStoredSubtitleEntry(entryId);
}
