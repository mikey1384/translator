import { FFmpegService } from '../../ffmpeg-service.js';
import { GenerateProgressCallback } from '@shared-types/app';
import { Stage, scaleProgress } from './progress.js';

export async function prepareAudio({
  videoPath,
  services,
  progressCallback,
  operationId,
  signal,
}: {
  videoPath: string;
  services: { ffmpegService: FFmpegService };
  progressCallback?: GenerateProgressCallback;
  operationId: string;
  signal: AbortSignal;
}): Promise<{ audioPath: string }> {
  progressCallback?.({
    percent: Stage.AUDIO,
    stage: 'Starting subtitle generation',
  });

  const audioPath = await services.ffmpegService.extractAudio({
    videoPath,
    progressCallback: extractionProgress => {
      const stagePercent = scaleProgress(
        extractionProgress.percent,
        Stage.AUDIO,
        Stage.TRANSCRIBE
      );
      progressCallback?.({
        percent: stagePercent,
        stage: extractionProgress.stage || '',
      });
    },
    operationId,
    signal,
  });

  if (signal.aborted) throw new Error('Cancelled');
  return { audioPath };
}
