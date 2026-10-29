import * as FileIPC from '../ipc/file';
import { useSubStore } from '../state/subtitle-store';
import { flushPendingEdits } from './pending-edits';

function getMountedSegments() {
  const subtitleState = useSubStore.getState();
  return subtitleState.order
    .map(id => subtitleState.segments[id])
    .filter(Boolean)
    .map(segment => ({ ...segment }));
}

/**
 * Saves what is on screen as the app's subtitle document. `keepDirty` keeps
 * the unsaved-changes state (a background snapshot, not a user save).
 */
export async function saveMountedSubtitleDocument(
  options: { keepDirty?: boolean } = {}
): Promise<{
  success: boolean;
  documentId?: string;
  error?: string;
}> {
  flushPendingEdits();
  const subtitleState = useSubStore.getState();
  const savedRevision = subtitleState.editRevision;
  if (subtitleState.order.length === 0) {
    return { success: false, error: 'No mounted subtitles to save.' };
  }

  const segments = getMountedSegments();
  const result = await FileIPC.saveSubtitleDocumentRecord({
    documentId: subtitleState.documentId,
    title: subtitleState.documentTitle,
    segments,
    sourceVideoPath: subtitleState.sourceVideoPath ?? null,
    sourceVideoAssetIdentity: subtitleState.sourceVideoAssetIdentity ?? null,
    sourceUrl: subtitleState.sourceUrl ?? null,
    sourceProvenance: subtitleState.sourceProvenance ?? null,
    subtitleKind: subtitleState.subtitleKind ?? null,
    targetLanguage: subtitleState.targetLanguage ?? null,
    activeLinkedFilePath: subtitleState.activeFilePath ?? null,
    activeLinkedFileMode: subtitleState.activeFileMode ?? null,
    activeLinkedFileRole: subtitleState.activeFileRole ?? null,
    transcriptionEngine: subtitleState.transcriptionEngine ?? null,
    transcriptionCoverage: subtitleState.transcriptionCoverage,
  });
  if (!result.success || !result.document) {
    return {
      success: false,
      error: result.error || 'Failed to save subtitle document.',
    };
  }

  useSubStore.getState().setDocumentMeta(result.document);
  if (!options.keepDirty) useSubStore.getState().markSaved(savedRevision);
  return { success: true, documentId: result.document.id };
}

// Documents saved when the user left a video for home (logo), keyed by the
// video's path and link. Opening that video again restores exactly what was
// on screen, whatever its kind or language. Kept in localStorage, which every
// tab shares, so it also works in a new tab and after a restart.
const LEFT_DOCUMENTS_KEY = 'stage5.leftSubtitleDocuments.v1';
const LEFT_DOCUMENTS_LIMIT = 100;
const leftKeys = (source: { path?: string | null; url?: string | null }) =>
  [source.path, source.url].filter((key): key is string => Boolean(key));

function readLeftDocuments(): Map<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(LEFT_DOCUMENTS_KEY);
    const entries = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(entries)) return new Map();
    return new Map(
      entries.filter(
        (entry: unknown): entry is [string, string] =>
          Array.isArray(entry) &&
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'string'
      )
    );
  } catch {
    return new Map();
  }
}

function writeLeftDocuments(map: Map<string, string>): void {
  try {
    const entries = [...map.entries()].slice(-LEFT_DOCUMENTS_LIMIT);
    globalThis.localStorage?.setItem(
      LEFT_DOCUMENTS_KEY,
      JSON.stringify(entries)
    );
  } catch {
    // Storage unavailable: the restore then lasts for this session only.
  }
}

let memoryFallback: Map<string, string> | null = null;
function loadLeftDocuments(): Map<string, string> {
  if (!globalThis.localStorage) return (memoryFallback ??= new Map());
  return readLeftDocuments();
}
function saveLeftDocuments(map: Map<string, string>): void {
  if (!globalThis.localStorage) {
    memoryFallback = map;
    return;
  }
  writeLeftDocuments(map);
}

export function rememberLeftDocument(
  source: { path?: string | null; url?: string | null },
  documentId: string
): void {
  const leftDocuments = loadLeftDocuments();
  for (const key of leftKeys(source)) {
    // Re-insert so the most recent entries survive the size cap.
    leftDocuments.delete(key);
    leftDocuments.set(key, documentId);
  }
  saveLeftDocuments(leftDocuments);
}

export function takeLeftDocument(source: {
  path?: string | null;
  url?: string | null;
}): string | null {
  const leftDocuments = loadLeftDocuments();
  const keys = leftKeys(source);
  const documentId = keys.map(key => leftDocuments.get(key)).find(Boolean);
  if (!documentId) return null;
  for (const [key, id] of leftDocuments) {
    if (id === documentId) leftDocuments.delete(key);
  }
  saveLeftDocuments(leftDocuments);
  return documentId;
}
