import { useTaskStore } from '../../../state';
import * as SubtitlesIPC from '../../../ipc/subtitles';
import * as FileIPC from '../../../ipc/file';
import { parseSrt } from '../../../../shared/helpers';
import { i18n } from '../../../i18n';
import { buildSrt } from '../../../../shared/helpers';
import {
  useSubStore,
  useUIStore,
  useVideoStore,
  useCreditStore,
  useAiStore,
} from '../../../state';
import { openUnsavedSrtConfirm } from '../../../state/modal-store';
import { saveCurrentSubtitles } from '../../../utils/saveSubtitles';
import { useUrlStore } from '../../../state/url-store';
import * as SystemIPC from '../../../ipc/system';
import { getByoErrorMessage, isByoError } from '../../../utils/byoErrors';

// Voice cloning costs ~35,000 credits per minute (fetched from API, this is fallback)
const VOICE_CLONING_CREDITS_PER_MINUTE = 35_000;

// Maximum file size for voice cloning upload (matches server limit)
const MAX_VOICE_CLONING_FILE_SIZE = 200 * 1024 * 1024; // 200MB

export interface GenerateSubtitlesParams {
  videoFile: File | null;
  videoFilePath: string | null;
  targetLanguage: string;
  operationId: string;
}

export interface GenerateSubtitlesResult {
  success: boolean;
  cancelled?: boolean;
  subtitles?: string;
}

export async function executeSrtTranslation({
  segments,
  targetLanguage,
  operationId,
}: {
  segments: any[];
  targetLanguage: string;
  operationId: string;
}): Promise<{ success: boolean; subtitles?: string; cancelled?: boolean }> {
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
    if (res?.translatedSubtitles) {
      const finalSegments = parseSrt(res.translatedSubtitles);
      // Preserve linkage to the source video if present; do not invent a new one
      const srcVideo = useSubStore.getState().sourceVideoPath ?? null;
      useSubStore.getState().load(finalSegments, null, 'fresh', srcVideo);
      useTaskStore.getState().setTranslation({
        stage: i18n.t('generateSubtitles.status.completed'),
        percent: 100,
        inProgress: false,
      });
      return { success: true, subtitles: res.translatedSubtitles };
    }
    useTaskStore.getState().setTranslation({ inProgress: false });
    return { success: false };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const userFriendlyMsg = isByoError(errorMsg)
      ? getByoErrorMessage(errorMsg)
      : i18n.t('generateSubtitles.status.error');
    useTaskStore.getState().setTranslation({
      stage: userFriendlyMsg,
      percent: 100,
      inProgress: false,
    });
    return { success: false };
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

  const { dubVoice, dubAmbientMix, dubUseVoiceCloning } = useUIStore.getState();
  const quality = 'standard';
  const selectedVoice = voice ?? dubVoice ?? 'alloy';

  // Determine if we should use voice cloning
  // Voice cloning is ONLY available for BYO ElevenLabs users (not Stage5 credits)
  // It's too expensive (~35k credits/min) and doesn't allow control over translation quality
  const {
    useByoMaster,
    useByoElevenLabs,
    elevenLabsKeyPresent,
    byoElevenLabsUnlocked,
  } = useAiStore.getState();
  const isByoElevenLabs =
    useByoMaster &&
    useByoElevenLabs &&
    elevenLabsKeyPresent &&
    byoElevenLabsUnlocked;
  const useVoiceCloning =
    isByoElevenLabs &&
    dubUseVoiceCloning &&
    !!targetLanguage &&
    targetLanguage !== 'original' &&
    (videoDurationSeconds ?? 0) > 0;

  // Pre-check credits for voice cloning before starting the upload
  if (useVoiceCloning && videoDurationSeconds) {
    const credits = useCreditStore.getState().credits;
    const durationMinutes = Math.ceil(videoDurationSeconds / 60);
    const requiredCredits = durationMinutes * VOICE_CLONING_CREDITS_PER_MINUTE;

    if (typeof credits === 'number' && credits < requiredCredits) {
      const affordableMinutes = Math.floor(
        credits / VOICE_CLONING_CREDITS_PER_MINUTE
      );
      useUrlStore
        .getState()
        .setError(
          i18n.t(
            'generateSubtitles.validation.insufficientCreditsForVoiceCloning',
            'Insufficient credits for voice cloning. Video is {{duration}} min but you can only afford {{affordable}} min. Please add credits or disable voice cloning.',
            { duration: durationMinutes, affordable: affordableMinutes }
          )
        );
      return { success: false };
    }
  }

  // Pre-check file size for voice cloning (must not exceed 200MB)
  if (useVoiceCloning && videoPath) {
    try {
      const sizeResult = await FileIPC.getFileSize(videoPath);
      if (sizeResult.success && sizeResult.sizeBytes) {
        if (sizeResult.sizeBytes > MAX_VOICE_CLONING_FILE_SIZE) {
          const sizeMB = Math.round(sizeResult.sizeBytes / (1024 * 1024));
          const maxMB = MAX_VOICE_CLONING_FILE_SIZE / (1024 * 1024);
          useUrlStore
            .getState()
            .setError(
              i18n.t(
                'generateSubtitles.validation.fileTooLargeForVoiceCloning',
                'Video file is too large for voice cloning ({{size}}MB). Maximum allowed is {{max}}MB. Please use a shorter video or disable voice cloning.',
                { size: sizeMB, max: maxMB }
              )
            );
          return { success: false };
        }
      }
    } catch {
      // File size check failed, proceed anyway and let server handle it
    }
  }

  try {
    const res = await SubtitlesIPC.dubSubtitles({
      segments: payloadSegments,
      voice: selectedVoice,
      operationId,
      videoPath: videoPath ?? null,
      quality,
      ambientMix: dubAmbientMix,
      targetLanguage,
      useVoiceCloning,
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

    if (res?.error) {
      try {
        const friendlyError = isByoError(res.error)
          ? getByoErrorMessage(res.error)
          : res.error;
        useUrlStore.getState().setError(friendlyError);
      } catch {
        // ignore store errors
      }
    }
    const errorStage = res?.cancelled
      ? i18n.t('generateSubtitles.status.cancelled')
      : res?.error && isByoError(res.error)
        ? getByoErrorMessage(res.error)
        : i18n.t('generateSubtitles.status.error');
    useTaskStore.getState().setDubbing({
      stage: errorStage,
      percent: 100,
      inProgress: false,
    });
    return { success: false, cancelled: res?.cancelled };
  } catch (error) {
    console.error('[executeDubGeneration] Error:', error);
    const errorMsg =
      error instanceof Error
        ? error.message
        : 'Failed to generate dubbed audio.';
    const friendlyError = isByoError(errorMsg)
      ? getByoErrorMessage(errorMsg)
      : errorMsg;
    try {
      useUrlStore.getState().setError(friendlyError);
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
}: GenerateSubtitlesParams): Promise<GenerateSubtitlesResult> {
  const { setTranscription } = useTaskStore.getState();
  // Ensure translation slice is not considered active during transcription-only
  useTaskStore.getState().setTranslation({ inProgress: false });

  // Initialize progress tracking (transcription-only)
  setTranscription({
    id: operationId,
    stage: i18n.t('generateSubtitles.status.starting'),
    percent: 0,
    inProgress: true,
  });

  try {
    // Prepare options for subtitle generation
    const opts: any = { targetLanguage, streamResults: true };
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
      // Success: Parse and load subtitles
      const finalSegments = parseSrt(result.subtitles);
      // Mark as freshly generated for the current video
      const vpath = videoFilePath ?? useVideoStore.getState().path ?? null;
      useSubStore.getState().load(finalSegments, null, 'fresh', vpath);

      setTranscription({
        id: operationId,
        stage: i18n.t('generateSubtitles.status.completed'),
        percent: 100,
        inProgress: false,
      });

      return { success: true, subtitles: result.subtitles };
    } else {
      // Handle failure or cancellation
      const stage = result.cancelled
        ? i18n.t('generateSubtitles.status.cancelled')
        : i18n.t('generateSubtitles.status.error');
      const percent = result.cancelled ? 0 : 100;

      setTranscription({
        id: operationId,
        stage,
        percent,
        inProgress: false,
      });

      return { success: false, cancelled: result.cancelled };
    }
  } catch (error) {
    console.error('Error generating subtitles:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    const friendlyError = isByoError(errorMsg)
      ? getByoErrorMessage(errorMsg)
      : i18n.t('generateSubtitles.status.error');

    setTranscription({
      id: operationId,
      stage: friendlyError,
      percent: 100,
      inProgress: false,
    });

    return { success: false };
  }
}

export async function startTranscriptionFlow({
  videoFile,
  videoFilePath,
  durationSecs,
  hoursNeeded,
  operationId,
  metadataStatus,
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
}): Promise<GenerateSubtitlesResult> {
  // Ensure the Edit panel is visible so users can see live updates
  try {
    const { setEditPanelOpen } = useUIStore.getState();
    setEditPanelOpen(true);
  } catch {
    // Do nothing
  }

  // If there are mounted subtitles, prompt to save/discard before proceeding
  const hasMounted = useSubStore.getState().order.length > 0;
  if (hasMounted) {
    const choice = await openUnsavedSrtConfirm();
    if (choice === 'cancel') return { success: false };
    if (choice === 'save') {
      const saved = await saveCurrentSubtitles();
      if (!saved) return { success: false };
    }
    clearMountedSrtShared();
    try {
      useVideoStore.getState().clearDubbedMedia();
    } catch {
      // Ignore inability to clear dubbed media
    }
  }

  // Validate inputs
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

  return executeSubtitleGeneration({
    videoFile,
    videoFilePath,
    targetLanguage: 'original',
    operationId,
  });
}

// Removed old inline save; centralized in utils/saveSubtitles.ts

function clearMountedSrtShared() {
  useSubStore.setState({
    segments: {},
    order: [],
    activeId: null,
    playingId: null,
    originalPath: null,
  } as any);
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
