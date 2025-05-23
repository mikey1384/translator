import { useTaskStore, useSubStore } from '../../../state';
import * as SubtitlesIPC from '../../../ipc/subtitles';
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

export async function executeSubtitleGeneration({
  videoFile,
  videoFilePath,
  targetLanguage,
  operationId,
}: GenerateSubtitlesParams): Promise<GenerateSubtitlesResult> {
  const { setTranslation } = useTaskStore.getState();

  // Initialize progress tracking
  setTranslation({
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

      setTranslation({
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

      setTranslation({
        id: operationId,
        stage,
        percent,
        inProgress: false,
      });

      return { success: false, cancelled: result.cancelled };
    }
  } catch (error) {
    console.error('Error generating subtitles:', error);

    setTranslation({
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
