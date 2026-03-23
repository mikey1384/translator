import * as FileIPC from '../ipc/file';
import * as SubtitleLibraryIPC from '../ipc/subtitle-library';

export async function detachSourceLinkedSubtitleOwnership(args: {
  sourceVideoPath?: string | null;
  sourceVideoAssetIdentity?: string | null;
  sourceUrl?: string | null;
}): Promise<{
  detachedDocumentIds: string[];
  detachedLibraryEntryIds: string[];
}> {
  const sourceVideoPath = String(args.sourceVideoPath || '').trim() || null;
  const sourceVideoAssetIdentity =
    String(args.sourceVideoAssetIdentity || '').trim() || null;
  const sourceUrl = String(args.sourceUrl || '').trim() || null;

  if (!sourceVideoPath && !sourceUrl) {
    return {
      detachedDocumentIds: [],
      detachedLibraryEntryIds: [],
    };
  }

  const detachedDocumentIds: string[] = [];
  const seenDocumentIds = new Set<string>();
  while (true) {
    const result = await FileIPC.findSubtitleDocumentForSource({
      sourceVideoPath,
      sourceVideoAssetIdentity,
      sourceUrl,
    });
    if (!result.success) {
      throw new Error(
        result.error || 'Failed to find source-linked subtitle documents.'
      );
    }

    const documentId = result.document?.id ?? null;
    if (!documentId || seenDocumentIds.has(documentId)) {
      break;
    }
    seenDocumentIds.add(documentId);

    const detachResult = await FileIPC.detachSubtitleDocumentSource({
      documentId,
    });
    if (!detachResult.success) {
      throw new Error(
        detachResult.error || 'Failed to detach source-linked subtitle document.'
      );
    }

    if (!detachResult.updated) {
      break;
    }

    detachedDocumentIds.push(documentId);
  }

  const detachedLibraryEntryIds: string[] = [];
  const seenLibraryEntryIds = new Set<string>();
  while (true) {
    const result = await SubtitleLibraryIPC.findStoredSubtitleForVideo({
      sourceVideoPath,
      sourceUrl,
      targetLanguage: null,
    });
    if (!result.success) {
      throw new Error(
        result.error || 'Failed to find source-linked stored subtitles.'
      );
    }

    const entryId = result.entry?.id ?? null;
    if (!entryId || seenLibraryEntryIds.has(entryId)) {
      break;
    }
    seenLibraryEntryIds.add(entryId);

    const detachResult = await SubtitleLibraryIPC.detachStoredSubtitleSource({
      entryId,
      sourceVideoPath,
      sourceUrl,
    });
    if (!detachResult.success) {
      throw new Error(
        detachResult.error || 'Failed to detach source-linked stored subtitle.'
      );
    }

    if (!detachResult.updated) {
      break;
    }

    detachedLibraryEntryIds.push(entryId);
  }

  return {
    detachedDocumentIds,
    detachedLibraryEntryIds,
  };
}
