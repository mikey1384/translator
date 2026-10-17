import * as FileIPC from '../ipc/file';
import { useSubStore } from '../state/subtitle-store';

function getMountedSegments() {
  const subtitleState = useSubStore.getState();
  return subtitleState.order
    .map(id => subtitleState.segments[id])
    .filter(Boolean)
    .map(segment => ({ ...segment }));
}

export async function saveMountedSubtitleDocument(): Promise<{
  success: boolean;
  documentId?: string;
  error?: string;
}> {
  const subtitleState = useSubStore.getState();
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
  });
  if (!result.success || !result.document) {
    return {
      success: false,
      error: result.error || 'Failed to save subtitle document.',
    };
  }

  useSubStore.getState().setDocumentMeta(result.document);
  return { success: true, documentId: result.document.id };
}

// Documents saved when the user left a video for home (logo), keyed by the
// video's path and link. Opening that video again in this session restores
// exactly what was on screen, whatever its kind or language.
const leftDocuments = new Map<string, string>();
const leftKeys = (source: { path?: string | null; url?: string | null }) =>
  [source.path, source.url].filter((key): key is string => Boolean(key));

export function rememberLeftDocument(
  source: { path?: string | null; url?: string | null },
  documentId: string
): void {
  for (const key of leftKeys(source)) leftDocuments.set(key, documentId);
}

export function takeLeftDocument(source: {
  path?: string | null;
  url?: string | null;
}): string | null {
  const keys = leftKeys(source);
  const documentId = keys.map(key => leftDocuments.get(key)).find(Boolean);
  if (!documentId) return null;
  for (const [key, id] of leftDocuments) {
    if (id === documentId) leftDocuments.delete(key);
  }
  return documentId;
}
