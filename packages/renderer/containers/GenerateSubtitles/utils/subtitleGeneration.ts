import { useTaskStore } from '../../../state';
import * as SubtitlesIPC from '../../../ipc/subtitles';
import { parseSrt } from '../../../../shared/helpers';
import { i18n } from '../../../i18n';
import { buildSrt } from '../../../../shared/helpers';
import { useSubStore, useUIStore, useVideoStore } from '../../../state';
import { openUnsavedSrtConfirm } from '../../../state/modal-store';
import { saveCurrentSubtitles } from '../../../utils/saveSubtitles';
import { useUrlStore } from '../../../state/url-store';
import * as SystemIPC from '../../../ipc/system';

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
  // Prevent translation while transcription is in progress
  if (useTaskStore.getState().transcription.inProgress) {
    return { success: false };
  }
  const srtContent = buildSrt({ segments, mode: 'dual' });

  // Initialize translation task so progress-buffer accepts progress updates
  useTaskStore.getState().setTranslation({
    id: operationId,
    stage: i18n.t('generateSubtitles.status.starting'),
    percent: 0,
    inProgress: true,
  });

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
  } catch {
    useTaskStore.getState().setTranslation({
      stage: i18n.t('generateSubtitles.status.error'),
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
}: {
  segments: any[];
  operationId: string;
  videoPath?: string | null;
  voice?: string;
}): Promise<{
  success: boolean;
  videoPath?: string;
  audioPath?: string;
  cancelled?: boolean;
}> {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { success: false };
  }

  // Prevent dubbing while transcription is running to avoid overload
  if (useTaskStore.getState().transcription.inProgress) {
    return { success: false };
  }

  useTaskStore.getState().setDubbing({
    id: operationId,
    stage: i18n.t('generateSubtitles.status.starting'),
    percent: 0,
    inProgress: true,
  });

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

  const { dubVoice } = useUIStore.getState();
  const quality = 'standard';
  const selectedVoice = voice ?? dubVoice ?? 'alloy';

  try {
    const res = await SubtitlesIPC.dubSubtitles({
      segments: payloadSegments,
      voice: selectedVoice,
      operationId,
      videoPath: videoPath ?? null,
      quality,
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
        useUrlStore.getState().setError(res.error);
      } catch {
        // ignore store errors
      }
    }
    useTaskStore.getState().setDubbing({
      stage: res?.cancelled
        ? i18n.t('generateSubtitles.status.cancelled')
        : i18n.t('generateSubtitles.status.error'),
      percent: 100,
      inProgress: false,
    });
    return { success: false, cancelled: res?.cancelled };
  } catch (error) {
    console.error('[executeDubGeneration] Error:', error);
    try {
      useUrlStore
        .getState()
        .setError(
          error instanceof Error
            ? error.message
            : 'Failed to generate dubbed audio.'
        );
    } catch {
      // ignore
    }
    useTaskStore.getState().setDubbing({
      stage: i18n.t('generateSubtitles.status.error'),
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

    setTranscription({
      id: operationId,
      stage: i18n.t('generateSubtitles.status.error'),
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
}: {
  videoFile: File | null;
  videoFilePath: string | null;
  durationSecs: number | null;
  hoursNeeded: number | null;
  operationId: string;
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
    hoursNeeded
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
  hoursNeeded: number | null
): { isValid: boolean; errorMessage?: string } {
  if (!videoFile && !videoFilePath) {
    return {
      isValid: false,
      errorMessage: i18n.t('generateSubtitles.validation.pleaseSelectVideo'),
    };
  }

  if (durationSecs === null || durationSecs <= 0 || hoursNeeded === null) {
    return {
      isValid: false,
      errorMessage: i18n.t('generateSubtitles.validation.processingDuration'),
    };
  }

  return { isValid: true };
}
