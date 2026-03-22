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
