import type { FFmpegContext } from '../../ffmpeg-runner.js';
import { attachExtractAudio, AudioQualityMode } from '../audio-extractor.js';
import { GenerateProgressCallback } from '@shared-types/app';
import { Stage, scaleProgress } from './progress.js';
import { getActiveProviderForAudio } from '../../ai-provider.js';

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
    percent: Stage.START,
    stage: 'Starting subtitle generation',
  });

  attachExtractAudio(services.ffmpeg);

  // Use higher quality audio for ElevenLabs (better speaker diarization)
  const audioProvider = getActiveProviderForAudio();
  const qualityMode: AudioQualityMode =
    audioProvider === 'elevenlabs' ? 'elevenlabs' : 'whisper';

  const audioPath = await services.ffmpeg.extractAudio!({
    videoPath,
    operationId,
    signal,
    qualityMode,
    progress: ({ percent, stage }: { percent: number; stage?: string }) => {
      progressCallback?.({
        percent: scaleProgress(percent, Stage.START, Stage.TRANSCRIBE),
        stage: stage ?? '',
      });
    },
  });

  if (signal.aborted) throw new Error('Cancelled');
  return { audioPath };
}
