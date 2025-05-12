import type { FFmpegContext } from '../../ffmpeg-runner.js';
import { attachExtractAudio } from '../audio-extractor.js';
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
  services: { ffmpeg: FFmpegContext };
  progressCallback?: GenerateProgressCallback;
  operationId: string;
  signal: AbortSignal;
}): Promise<{ audioPath: string }> {
  progressCallback?.({
    percent: Stage.AUDIO,
    stage: 'Starting subtitle generation',
  });

  attachExtractAudio(services.ffmpeg);

  const audioPath = await services.ffmpeg.extractAudio!({
    videoPath,
    operationId,
    signal,
    progress: ({ percent, stage }: { percent: number; stage?: string }) => {
      progressCallback?.({
        percent: scaleProgress(percent, Stage.AUDIO, Stage.TRANSCRIBE),
        stage: stage ?? '',
      });
    },
  });

  if (signal.aborted) throw new Error('Cancelled');
  return { audioPath };
}
