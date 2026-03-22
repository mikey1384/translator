import * as FileIPC from '../ipc/file';
import * as SystemIPC from '../ipc/system';
import type {
  SaveSubtitleDocumentResult,
  SrtSegment,
  SubtitleDisplayMode,
  SubtitleDocumentLinkedFileRole,
} from '@shared-types/app';
import { useSubStore } from '../state/subtitle-store';
import { useUIStore } from '../state/ui-store';
import { i18n } from '../i18n';
import { buildSavedSubtitleSrt } from './canonical-subtitle-srt';
import { saveMountedSubtitleDocument } from './subtitle-documents';

export type SubtitleSaveResult = {
  status: 'success' | 'warning' | 'cancelled' | 'error';
  filePath?: string;
  warning?: string;
  error?: string;
};

function getCurrentSubtitleExportMode(): SubtitleDisplayMode {
  return useUIStore.getState().subtitleDisplayMode;
}

export function didSaveSubtitleFile(result: SubtitleSaveResult): boolean {
  return result.status === 'success' || result.status === 'warning';
}

async function showSaveWarning(warning: string): Promise<void> {
  try {
    await SystemIPC.showMessage(warning);
  } catch (error) {
    console.error('[saveSubtitles] Failed to show save warning:', error);
  }
}

function getExportContext() {
  const subtitleState = useSubStore.getState();
  return {
    documentId: subtitleState.documentId,
    documentTitle: subtitleState.documentTitle,
    sourceVideoPath: subtitleState.sourceVideoPath ?? null,
    sourceVideoAssetIdentity: subtitleState.sourceVideoAssetIdentity ?? null,
    sourceUrl: subtitleState.sourceUrl ?? null,
    subtitleKind: subtitleState.subtitleKind ?? null,
    targetLanguage: subtitleState.targetLanguage ?? null,
    transcriptionEngine: subtitleState.transcriptionEngine ?? null,
  };
}

function applyExportResult(result: SaveSubtitleDocumentResult): void {
  if (result.document) {
    useSubStore.getState().setDocumentMeta(result.document);
  }
  const subtitleState = useSubStore.getState();
  if (result.filePath) {
    const currentRole: SubtitleDocumentLinkedFileRole =
      subtitleState.activeFileRole ??
      (subtitleState.originalPath &&
      subtitleState.activeFilePath === subtitleState.originalPath &&
      subtitleState.exportPath !== subtitleState.activeFilePath
        ? 'import'
        : 'export');
    useSubStore
      .getState()
      .setExportPath(
        result.filePath,
        subtitleState.activeFileMode ?? null,
        currentRole
      );
  }
}

function getCurrentSubtitleFileTarget(): {
  path: string;
  mode: SubtitleDisplayMode;
  role: SubtitleDocumentLinkedFileRole;
} | null {
  const subtitleState = useSubStore.getState();
  const path =
    subtitleState.activeFilePath ??
    subtitleState.exportPath ??
    subtitleState.originalPath ??
    null;
  if (!path) {
    return null;
  }

  const role =
    subtitleState.activeFileRole ??
    (subtitleState.originalPath &&
    subtitleState.originalPath === path &&
    subtitleState.exportPath !== path
      ? 'import'
      : 'export');

  return {
    path,
    mode: subtitleState.activeFileMode ?? getCurrentSubtitleExportMode(),
    role,
  };
}

export async function saveSubtitleFilesToPath(
  filePath: string,
  segments: SrtSegment[],
  mode: SubtitleDisplayMode,
  role: SubtitleDocumentLinkedFileRole = 'export'
): Promise<SubtitleSaveResult> {
  const content = buildSavedSubtitleSrt(segments, mode);
  const subtitleState = useSubStore.getState();
  const result = await FileIPC.saveSubtitleDocument({
    ...getExportContext(),
    filePath,
    segments,
    srtContent: content,
    fileMode: mode,
    activeLinkedFilePath: filePath,
    activeLinkedFileMode: mode,
    activeLinkedFileRole: role,
    importFilePath:
      role === 'import' ? filePath : (subtitleState.originalPath ?? null),
    importSrtContent: role === 'import' ? content : null,
    importMode: role === 'import' ? mode : null,
  });
  if (didSaveSubtitleFile(result)) {
    useSubStore.getState().setActiveFileTarget({
      filePath,
      mode,
      role,
    });
    applyExportResult(result);
  }
  if (result.status === 'warning' && result.warning) {
    await showSaveWarning(result.warning);
  }
  return result;
}

export async function exportSubtitlesToPath(
  path: string
): Promise<SubtitleSaveResult> {
  const store = useSubStore.getState();
  const segments = store.order.map(id => store.segments[id]);
  return saveSubtitleFilesToPath(
    path,
    segments,
    getCurrentSubtitleExportMode()
  );
}

export async function saveSubtitlesAs(): Promise<SubtitleSaveResult> {
  const store = useSubStore.getState();
  const segments = store.order.map(id => store.segments[id]);
  const content = buildSavedSubtitleSrt(
    segments,
    getCurrentSubtitleExportMode()
  );
  const saveMode = getCurrentSubtitleExportMode();
  const suggestion = getCurrentSubtitleFileTarget()?.path || 'subtitles.srt';
  const result = await FileIPC.saveSubtitleDocument({
    ...getExportContext(),
    segments,
    srtContent: content,
    fileMode: saveMode,
    activeLinkedFileMode: saveMode,
    activeLinkedFileRole: 'export',
    title: i18n.t('dialogs.saveSrtFileAs'),
    defaultPath: suggestion,
    filters: [
      { name: i18n.t('common.fileFilters.srtFiles'), extensions: ['srt'] },
    ],
  });
  if (didSaveSubtitleFile(result)) {
    useSubStore.getState().setActiveFileTarget({
      filePath: result.filePath ?? null,
      mode: saveMode,
      role: 'export',
    });
    applyExportResult(result);
  }
  if (result.status === 'warning' && result.warning) {
    await showSaveWarning(result.warning);
  }
  return result;
}

/**
 * Save the active subtitle file when one exists; otherwise persist the
 * canonical Stage5 subtitle document only.
 */
export async function saveCurrentSubtitles(): Promise<SubtitleSaveResult> {
  const subtitleState = useSubStore.getState();
  const segments = subtitleState.order.map(id => subtitleState.segments[id]);
  const activeFileTarget = getCurrentSubtitleFileTarget();
  if (activeFileTarget && segments.length > 0) {
    return saveSubtitleFilesToPath(
      activeFileTarget.path,
      segments,
      activeFileTarget.mode,
      activeFileTarget.role
    );
  }

  const result = await saveMountedSubtitleDocument();
  if (!result.success) {
    return {
      status: 'error',
      error: result.error || 'Failed to save subtitle document.',
    };
  }
  return {
    status: 'success',
  };
}
