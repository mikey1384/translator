import { useTaskStore } from '../../../state';
import * as FileIPC from '../../../ipc/file';
import * as SubtitlesIPC from '../../../ipc/subtitles';
import { parseSrt } from '../../../../shared/helpers';
import type { SrtSegment } from '@shared-types/app';
import { i18n } from '../../../i18n';
import { buildSrt } from '../../../../shared/helpers';
import {
  useSubStore,
  useUIStore,
  useVideoStore,
  useCreditStore,
} from '../../../state';
import { openUnsavedSrtConfirm } from '../../../state/modal-store';
import { saveCurrentSubtitles } from '../../../utils/saveSubtitles';
import { didSaveSubtitleFile } from '../../../utils/saveSubtitles';
import { useUrlStore } from '../../../state/url-store';
import * as SystemIPC from '../../../ipc/system';
import { getByoErrorMessage, isByoError } from '../../../utils/byoErrors';
import {
  getSourceVideoErrorMessage,
  getSourceVideoUnavailableMessage,
  isSourceVideoPathAccessible,
  isSourceVideoUnavailableError,
} from '../../../utils/sourceVideoErrors';
import {
  getTranslationFailureMessage,
  shouldSurfaceTranslationFailure,
} from '../../../utils/translationFailure';
import { logError } from '../../../utils/logger';
import {
  storeGeneratedSubtitleArtifact,
  unmountCurrentSubtitles,
} from '../../../utils/subtitle-library';
import { preserveWordTimingsOnTranslatedSegments } from '../../../utils/preserve-word-timings';
import { detachSourceLinkedSubtitleOwnership } from '../../../utils/source-linked-subtitle-ownership';

export interface GenerateSubtitlesParams {
  videoFile: File | null;
  videoFilePath: string | null;
  targetLanguage: string;
  operationId: string;
  workflowOwner?: 'default' | 'highlight';
}

export interface GenerateSubtitlesResult {
  success: boolean;
  cancelled?: boolean;
  subtitles?: string;
}

function buildGenerateSubtitlesDurableRecoverySeed({
  videoFile,
  sourceUrl,
}: {
  videoFile: File | null;
  sourceUrl: string | null;
}): string | null {
  const normalizedSourceUrl = String(sourceUrl || '').trim();
  if (normalizedSourceUrl) {
    return ['generate-subtitles-source-url-v1', normalizedSourceUrl].join('\n');
  }

  if (!videoFile) {
    return null;
  }

  return [
    'generate-subtitles-file-v1',
    String(videoFile.name || '').trim(),
    String(
      typeof videoFile.size === 'number' && Number.isFinite(videoFile.size)
        ? videoFile.size
        : ''
    ),
    String(
      typeof videoFile.lastModified === 'number' &&
        Number.isFinite(videoFile.lastModified)
        ? videoFile.lastModified
        : ''
    ),
    String(videoFile.type || '').trim(),
  ].join('\n');
}

function resolveTranslationSourceAssociation(): {
  sourceVideoPath: string | null;
  sourceUrl: string | null;
  titleHint: string | null;
} {
  const subtitleState = useSubStore.getState();
  const videoState = useVideoStore.getState();
  const mountedVideoPath = videoState.originalPath ?? videoState.path ?? null;
  const subtitlesBelongToCurrentVideo =
    Boolean(subtitleState.sourceVideoPath) &&
    Boolean(mountedVideoPath) &&
    subtitleState.sourceVideoPath === mountedVideoPath;

  return {
    sourceVideoPath: subtitleState.sourceVideoPath ?? null,
    sourceUrl: subtitlesBelongToCurrentVideo ? videoState.sourceUrl : null,
    titleHint: videoState.file?.name ?? null,
  };
}

export async function executeSrtTranslation({
  segments,
  targetLanguage,
  operationId,
}: {
  segments: any[];
  targetLanguage: string;
  operationId: string;
}): Promise<{
  success: boolean;
  subtitles?: string;
  cancelled?: boolean;
  error?: string;
}> {
  // Atomically check and start translation (prevents race condition)
  const started = useTaskStore
    .getState()
    .tryStartTranslation(
      operationId,
      i18n.t('generateSubtitles.status.starting')
    );
  if (!started) {
    return { success: false };
  }

  // Clear stale errors so users only see current run failures.
  useUrlStore.getState().clearError();

  // Refresh credits at start of translation for accurate progress display
  try {
    useCreditStore.getState().refresh();
  } catch {
    // Non-blocking; continue even if refresh fails
  }

  const srtContent = buildSrt({ segments, mode: 'dual' });

  try {
    const { qualityTranslation } = useUIStore.getState();
    const res = await SubtitlesIPC.translateSubtitles({
      subtitles: srtContent,
      targetLanguage,
      operationId,
      qualityTranslation,
    });
    if (res?.success && res?.translatedSubtitles) {
      const translatedSegments = parseSrt(res.translatedSubtitles);
      const finalSegments = preserveWordTimingsOnTranslatedSegments(
        segments,
        translatedSegments
      );
      const { sourceVideoPath, sourceUrl, titleHint } =
        resolveTranslationSourceAssociation();
      let documentMeta = null;
      try {
        const documentSaveResult = await FileIPC.saveSubtitleDocumentRecord({
          segments: finalSegments,
          title: titleHint,
          sourceVideoPath: sourceVideoPath ?? null,
          sourceVideoAssetIdentity:
            useVideoStore.getState().sourceAssetIdentity ?? null,
          sourceUrl,
          subtitleKind: 'translation',
          targetLanguage,
        });
        if (documentSaveResult.success && documentSaveResult.document) {
          documentMeta = documentSaveResult.document;
        }
      } catch (documentError) {
        console.error(
          '[subtitleGeneration] Failed to create translation subtitle document:',
          documentError
        );
      }
      let libraryMeta = null;
      try {
        libraryMeta = await storeGeneratedSubtitleArtifact({
          content: res.translatedSubtitles,
          segments: finalSegments,
          kind: 'translation',
          targetLanguage,
          sourceVideoPath: sourceVideoPath ?? null,
          sourceUrl,
          titleHint,
        });
      } catch (storeErr) {
        console.error(
          '[subtitleGeneration] Failed to store translated subtitle history:',
          storeErr
        );
      }
      // Preserve linkage to the source video, but translated documents should
      // not retain transcription-review provenance from the source transcript.
      useSubStore
        .getState()
        .load(
          finalSegments,
          null,
          'fresh',
          sourceVideoPath ?? null,
          null,
          libraryMeta,
          undefined,
          documentMeta
        );
      useUrlStore.getState().clearError();
      useTaskStore.getState().setTranslation({
        stage: i18n.t('generateSubtitles.status.completed'),
        percent: 100,
        inProgress: false,
      });
      return { success: true, subtitles: res.translatedSubtitles };
    }

    const cancelled = Boolean(res?.cancelled);
    const friendlyError = getTranslationFailureMessage({
      error: res?.error,
      cancelled,
    });

    useTaskStore.getState().setTranslation({
      stage: friendlyError,
      percent: 100,
      inProgress: false,
    });

    if (!cancelled) {
      logError('translate_full', res?.error || friendlyError, {
        operationId,
        targetLanguage,
        segmentCount: Array.isArray(segments) ? segments.length : 0,
      });
    }

    if (shouldSurfaceTranslationFailure({ error: res?.error, cancelled })) {
      useUrlStore.getState().setOperationError(friendlyError);
    }

    return { success: false, cancelled, error: res?.error };
  } catch (err: any) {
    logError('translate_full', err, {
      operationId,
      targetLanguage,
      segmentCount: Array.isArray(segments) ? segments.length : 0,
    });
    const errorMsg = err?.message || String(err);
    const cancelled =
      /operation cancelled/i.test(errorMsg) ||
      /process cancelled/i.test(errorMsg);
    const userFriendlyMsg = getTranslationFailureMessage({
      error: errorMsg,
      cancelled,
    });

    useTaskStore.getState().setTranslation({
      stage: userFriendlyMsg,
      percent: 100,
      inProgress: false,
    });

    if (shouldSurfaceTranslationFailure({ error: errorMsg, cancelled })) {
      useUrlStore.getState().setOperationError(userFriendlyMsg);
    }

    return { success: false, cancelled, error: errorMsg };
  }
}

export async function executeDubGeneration({
  segments,
  operationId,
  videoPath,
  voice,
  targetLanguage,
  videoDurationSeconds,
  sourceLanguage,
}: {
  segments: any[];
  operationId: string;
  videoPath?: string | null;
  voice?: string;
  targetLanguage?: string;
  videoDurationSeconds?: number;
  sourceLanguage?: string;
}): Promise<{
  success: boolean;
  videoPath?: string;
  audioPath?: string;
  cancelled?: boolean;
}> {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { success: false };
  }

  if (videoPath && !(await isSourceVideoPathAccessible(videoPath))) {
    const message = getSourceVideoUnavailableMessage();
    try {
      useUrlStore.getState().setOperationError(message);
    } catch {
      // ignore
    }
    return { success: false };
  }

  // Atomically check and start dubbing (prevents race condition)
  const started = useTaskStore
    .getState()
    .tryStartDubbing(operationId, i18n.t('generateSubtitles.status.starting'));
  if (!started) {
    return { success: false };
  }

  const payloadSegments = segments.map((seg: any, idx: number) => ({
    start: Number(seg?.start ?? 0),
    end: Number(seg?.end ?? 0),
    original: String(seg?.original ?? ''),
    translation: String(seg?.translation ?? ''),
    index: typeof seg?.index === 'number' ? seg.index : idx + 1,
    targetDuration:
      typeof seg?.start === 'number' &&
      typeof seg?.end === 'number' &&
      Number.isFinite(seg.start) &&
      Number.isFinite(seg.end) &&
      seg.end > seg.start
        ? Number(seg.end) - Number(seg.start)
        : undefined,
  }));

  const { dubVoice, dubAmbientMix } = useUIStore.getState();
  const quality = 'standard';
  const selectedVoice = voice ?? dubVoice ?? 'alloy';

  try {
    const res = await SubtitlesIPC.dubSubtitles({
      segments: payloadSegments,
      voice: selectedVoice,
      operationId,
      videoPath: videoPath ?? null,
      quality,
      ambientMix: dubAmbientMix,
      targetLanguage,
      videoDurationSeconds,
      sourceLanguage,
    });

    if (res?.success) {
      useTaskStore.getState().setDubbing({
        stage: i18n.t('generateSubtitles.status.completed'),
        percent: 100,
        inProgress: false,
      });

      useVideoStore.getState().registerDubbedResult({
        videoPath: res.videoPath ?? null,
        audioPath: res.audioPath ?? null,
      });

      if (res.videoPath) {
        try {
          await useVideoStore.getState().setActiveTrack('dubbed');
        } catch (err) {
          console.error(
            '[executeDubGeneration] Failed to activate dubbed track:',
            err
          );
        }
      }

      return {
        success: true,
        videoPath: res.videoPath,
        audioPath: res.audioPath,
        cancelled: res.cancelled,
      };
    }

    const friendlyError = isSourceVideoUnavailableError(res?.error)
      ? getSourceVideoUnavailableMessage()
      : res?.error && isByoError(res.error)
        ? getByoErrorMessage(res.error)
        : res?.error;

    if (friendlyError) {
      if (!res?.cancelled) {
        logError('dub', friendlyError, {
          operationId,
          voice: selectedVoice,
          targetLanguage,
          segmentCount: payloadSegments.length,
          hasVideoPath: Boolean(videoPath),
        });
      }
      try {
        useUrlStore.getState().setOperationError(friendlyError);
      } catch {
        // ignore store errors
      }
    }
    const errorStage = res?.cancelled
      ? i18n.t('generateSubtitles.status.cancelled')
      : friendlyError || i18n.t('generateSubtitles.status.error');
    useTaskStore.getState().setDubbing({
      stage: errorStage,
      percent: 100,
      inProgress: false,
    });
    return { success: false, cancelled: res?.cancelled };
  } catch (error) {
    logError('dub', error, {
      operationId,
      voice: selectedVoice,
      targetLanguage,
      segmentCount: payloadSegments.length,
      hasVideoPath: Boolean(videoPath),
    });
    const errorMsg =
      error instanceof Error
        ? error.message
        : 'Failed to generate dubbed audio.';
    const friendlyError = isSourceVideoUnavailableError(errorMsg)
      ? getSourceVideoUnavailableMessage()
      : isByoError(errorMsg)
        ? getByoErrorMessage(errorMsg)
        : errorMsg;
    try {
      useUrlStore.getState().setOperationError(friendlyError);
    } catch {
      // ignore
    }
    useTaskStore.getState().setDubbing({
      stage: friendlyError,
      percent: 100,
      inProgress: false,
    });
    return { success: false };
  }
}

export async function executeSubtitleGeneration({
  videoFile,
  videoFilePath,
  targetLanguage,
  operationId,
  workflowOwner = 'default',
}: GenerateSubtitlesParams): Promise<GenerateSubtitlesResult> {
  const { setTranscription } = useTaskStore.getState();
  // Ensure translation slice is not considered active during transcription-only
  useTaskStore.getState().setTranslation({ inProgress: false });
  useUrlStore.getState().clearError();

  // Initialize progress tracking (transcription-only)
  setTranscription({
    id: operationId,
    stage: i18n.t('generateSubtitles.status.starting'),
    percent: 0,
    inProgress: true,
    workflowOwner,
  });

  try {
    // Prepare options for subtitle generation
    const opts: any = { targetLanguage, streamResults: true };
    const videoState = useVideoStore.getState();
    const sourceMediaPath =
      videoState.originalPath ??
      videoState.path ??
      videoFilePath ??
      (videoFile as any)?.path ??
      (videoFile as any)?._originalPath ??
      null;
    const durableRecoverySeed = buildGenerateSubtitlesDurableRecoverySeed({
      videoFile,
      sourceUrl: videoState.sourceUrl ?? null,
    });
    if (sourceMediaPath) {
      opts.sourceMediaPath = sourceMediaPath;
    }
    if (
      durableRecoverySeed &&
      (videoState.sourceUrl || !opts.sourceMediaPath)
    ) {
      opts.durableRecoverySeed = durableRecoverySeed;
    }
    if (videoFilePath) {
      opts.videoPath = videoFilePath;
    } else if (videoFile) {
      opts.videoFile = videoFile;
    }
    opts.operationId = operationId;
    // Quality vs speed toggle for transcription
    try {
      opts.qualityTranscription = useUIStore.getState().qualityTranscription;
    } catch {
      // do nothing
    }

    // Generate subtitles
    const result = await SubtitlesIPC.generate(opts);

    if (result.subtitles) {
      const finalSegments: SrtSegment[] =
        Array.isArray(result.segments) && result.segments.length > 0
          ? result.segments
          : parseSrt(result.subtitles);
      // Mark as freshly generated for the current video
      const { originalPath, path, sourceUrl, file } = useVideoStore.getState();
      const vpath = originalPath ?? path ?? videoFilePath ?? null;
      try {
        await detachSourceLinkedSubtitleOwnership({
          sourceVideoPath: vpath,
          sourceVideoAssetIdentity:
            useVideoStore.getState().sourceAssetIdentity ?? null,
          sourceUrl,
        });
      } catch (detachErr) {
        console.error(
          '[subtitleGeneration] Failed to detach old source-linked subtitles before saving fresh transcription:',
          detachErr
        );
      }
      let documentMeta = null;
      try {
        const documentSaveResult = await FileIPC.saveSubtitleDocumentRecord({
          segments: finalSegments,
          title: file?.name ?? null,
          sourceVideoPath: vpath,
          sourceVideoAssetIdentity:
            useVideoStore.getState().sourceAssetIdentity ?? null,
          sourceUrl,
          subtitleKind: 'transcription',
          transcriptionEngine: result.transcriptionEngine ?? null,
        });
        if (documentSaveResult.success && documentSaveResult.document) {
          documentMeta = documentSaveResult.document;
        }
      } catch (documentError) {
        console.error(
          '[subtitleGeneration] Failed to create subtitle document:',
          documentError
        );
      }
      let libraryMeta = null;
      try {
        libraryMeta = await storeGeneratedSubtitleArtifact({
          content: result.subtitles,
          segments: finalSegments,
          kind: 'transcription',
          sourceVideoPath: vpath,
          sourceUrl,
          titleHint: file?.name ?? null,
        });
      } catch (storeErr) {
        console.error(
          '[subtitleGeneration] Failed to store transcription history:',
          storeErr
        );
      }
      useSubStore
        .getState()
        .load(
          finalSegments,
          null,
          'fresh',
          vpath,
          result.transcriptionEngine ?? null,
          libraryMeta,
          undefined,
          documentMeta
        );

      setTranscription({
        id: operationId,
        stage: i18n.t('generateSubtitles.status.completed'),
        percent: 100,
        inProgress: false,
        workflowOwner,
      });

      return { success: true, subtitles: result.subtitles };
    } else {
      // Handle failure or cancellation
      const cancelled = Boolean(result.cancelled);
      const errorMsg =
        typeof result.error === 'string' ? result.error.trim() : '';
      const friendlyError = getSourceVideoErrorMessage(errorMsg);
      const stage = cancelled
        ? i18n.t('generateSubtitles.status.cancelled')
        : friendlyError
          ? friendlyError
          : errorMsg
            ? isByoError(errorMsg)
              ? getByoErrorMessage(errorMsg)
              : errorMsg
            : i18n.t('generateSubtitles.status.error');
      const percent = cancelled ? 0 : 100;

      if (!cancelled && errorMsg) {
        logError('transcribe', errorMsg, {
          operationId,
          targetLanguage,
          hasVideoFilePath: Boolean(videoFilePath),
          videoFileName: videoFile?.name,
        });
      }

      if (!cancelled && stage) {
        useUrlStore.getState().setOperationError(stage);
      }

      setTranscription({
        id: operationId,
        stage,
        percent,
        inProgress: false,
        workflowOwner,
      });

      return { success: false, cancelled };
    }
  } catch (error) {
    logError('transcribe', error, {
      operationId,
      targetLanguage,
      hasVideoFilePath: Boolean(videoFilePath),
      videoFileName: videoFile?.name,
    });
    const errorMsg = error instanceof Error ? error.message : String(error);
    const cancelled =
      /operation cancelled/i.test(errorMsg) ||
      /process cancelled/i.test(errorMsg);
    const friendlyError = isSourceVideoUnavailableError(errorMsg)
      ? getSourceVideoUnavailableMessage()
      : isByoError(errorMsg)
        ? getByoErrorMessage(errorMsg)
        : errorMsg || i18n.t('generateSubtitles.status.error');

    if (!cancelled) {
      useUrlStore.getState().setOperationError(friendlyError);
    }

    setTranscription({
      id: operationId,
      stage: friendlyError,
      percent: cancelled ? 0 : 100,
      inProgress: false,
      workflowOwner,
    });

    return { success: false, cancelled };
  }
}

export async function startTranscriptionFlow({
  videoFile,
  videoFilePath,
  durationSecs,
  hoursNeeded,
  operationId,
  metadataStatus,
  workflowOwner = 'default',
  openEditPanelOnStart = true,
}: {
  videoFile: File | null;
  videoFilePath: string | null;
  durationSecs: number | null;
  hoursNeeded: number | null;
  operationId: string;
  metadataStatus?: {
    status?: 'idle' | 'fetching' | 'waiting' | 'success' | 'failed';
    code?: string;
    message?: string;
  };
  workflowOwner?: 'default' | 'highlight';
  openEditPanelOnStart?: boolean;
}): Promise<GenerateSubtitlesResult> {
  const videoState = useVideoStore.getState();
  const sourceVideoPath =
    videoFilePath ??
    videoState.originalPath ??
    videoState.path ??
    (videoFile as any)?.path ??
    (videoFile as any)?._originalPath ??
    null;

  if (
    sourceVideoPath &&
    !(await isSourceVideoPathAccessible(sourceVideoPath))
  ) {
    const message = getSourceVideoUnavailableMessage();
    useUrlStore.getState().setOperationError(message);
    await SystemIPC.showMessage(message);
    return { success: false };
  }

  // Validate inputs before prompting to replace the currently mounted subtitle.
  const validation = validateGenerationInputs(
    videoFile,
    videoFilePath,
    durationSecs,
    hoursNeeded,
    metadataStatus
  );

  if (!validation.isValid) {
    const msg =
      validation.errorMessage || i18n.t('generateSubtitles.calculatingCost');
    await SystemIPC.showMessage(msg);
    return { success: false };
  }

  // Some workflows want Edit visible immediately, even before any subtitles
  // have mounted. Highlight passes false so the blank editor stays hidden
  // until mounted subtitles trigger the shared auto-open rule.
  if (openEditPanelOnStart) {
    try {
      const { setEditPanelOpen } = useUIStore.getState();
      setEditPanelOpen(true);
    } catch {
      // Do nothing
    }
  }

  // If there are mounted subtitles, prompt to save/discard before proceeding
  const hasMounted = useSubStore.getState().order.length > 0;
  if (hasMounted) {
    const choice = await openUnsavedSrtConfirm();
    if (choice === 'cancel') return { success: false };
    if (choice === 'save') {
      const saveResult = await saveCurrentSubtitles();
      if (!didSaveSubtitleFile(saveResult)) return { success: false };
    }
    clearMountedSrtShared();
    try {
      useVideoStore.getState().clearDubbedMedia();
    } catch {
      // Ignore inability to clear dubbed media
    }
  }

  return executeSubtitleGeneration({
    videoFile,
    videoFilePath,
    targetLanguage: 'original',
    operationId,
    workflowOwner,
  });
}

// Removed old inline save; centralized in utils/saveSubtitles.ts

function clearMountedSrtShared() {
  unmountCurrentSubtitles();
  useTaskStore.getState().setTranslation({
    id: null,
    stage: '',
    percent: 0,
    inProgress: false,
    batchStartIndex: undefined,
  });
  useTaskStore.getState().setTranscription({
    id: null,
    stage: '',
    percent: 0,
    inProgress: false,
  });
}

export function validateGenerationInputs(
  videoFile: File | null,
  videoFilePath: string | null,
  durationSecs: number | null,
  hoursNeeded: number | null,
  metadataStatus?: {
    status?: 'idle' | 'fetching' | 'waiting' | 'success' | 'failed';
    code?: string;
    message?: string;
  } | null
): { isValid: boolean; errorMessage?: string } {
  if (!videoFile && !videoFilePath) {
    return {
      isValid: false,
      errorMessage: i18n.t('generateSubtitles.validation.pleaseSelectVideo'),
    };
  }

  if (metadataStatus) {
    if (metadataStatus.code === 'icloud-placeholder') {
      return {
        isValid: false,
        errorMessage: i18n.t(
          'generateSubtitles.validation.icloudPlaceholder',
          'This file is stored in iCloud. In Finder, click “Download” and wait for the cloud icon to finish, then try again.'
        ),
      };
    }
    if (
      metadataStatus.status === 'fetching' ||
      metadataStatus.status === 'waiting'
    ) {
      return {
        isValid: false,
        errorMessage: i18n.t('generateSubtitles.validation.processingDuration'),
      };
    }
    if (
      metadataStatus.status === 'failed' &&
      metadataStatus.message &&
      metadataStatus.message.trim().length > 0
    ) {
      return {
        isValid: false,
        errorMessage: metadataStatus.message,
      };
    }
  }

  if (durationSecs === null || durationSecs <= 0 || hoursNeeded === null) {
    return {
      isValid: false,
      errorMessage: i18n.t('generateSubtitles.validation.processingDuration'),
    };
  }

  return { isValid: true };
}
