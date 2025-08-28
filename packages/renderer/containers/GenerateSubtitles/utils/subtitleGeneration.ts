import { useTaskStore, useSubStore } from '../../../state';
import * as SubtitlesIPC from '../../../ipc/subtitles';
import { buildSrt } from '../../../../shared/helpers';
import { parseSrt } from '../../../../shared/helpers';
import { i18n } from '../../../i18n';

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
  const srtContent = buildSrt({ segments, mode: 'dual' });

  // Initialize translation task so progress-buffer accepts progress updates
  useTaskStore.getState().setTranslation({
    id: operationId,
    stage: i18n.t('generateSubtitles.status.starting'),
    percent: 0,
    inProgress: true,
  });

  try {
    const res = await SubtitlesIPC.translateSubtitles({
      subtitles: srtContent,
      targetLanguage,
      operationId,
    });
    if (res?.translatedSubtitles) {
      const finalSegments = parseSrt(res.translatedSubtitles);
      useSubStore.getState().load(finalSegments);
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

    // Generate subtitles
    const result = await SubtitlesIPC.generate(opts);

    if (result.subtitles) {
      // Success: Parse and load subtitles
      const finalSegments = parseSrt(result.subtitles);
      useSubStore.getState().load(finalSegments);

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
