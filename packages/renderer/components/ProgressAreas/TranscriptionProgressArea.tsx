import { useTranslation } from 'react-i18next';
import ProgressArea from './ProgressArea';
import { colors } from '../../styles';
import { useTaskStore } from '../../state';
import * as OperationIPC from '../../ipc/operation';
// Remaining hours are computed and shown in ProgressArea header next to credits

function translateBackendMessage(
  stage: string,
  t: (key: string, options?: any) => string
) {
  if (!stage.startsWith('__i18n__:')) return stage;

  const parts = stage.split(':');
  const messageType = parts[1];

  switch (messageType) {
    case 'transcribed_chunks': {
      const done = parseInt(parts[2], 10);
      const total = parseInt(parts[3], 10);
      return t('progress.transcribedChunks', { done, total });
    }
    case 'scrubbing_hallucinations': {
      const done = parseInt(parts[2], 10) || 0;
      const total = parseInt(parts[3], 10) || 0;
      return t('progress.scrubbingHallucinations', { done, total });
    }
    case 'translation_cleanup': {
      const done = parseInt(parts[2], 10) || 0;
      const total = parseInt(parts[3], 10) || 0;
      return t('progress.translationCleanup', { done, total });
    }
    case 'repairing_captions': {
      const iteration = parseInt(parts[2], 10);
      const maxIterations = parseInt(parts[3], 10);
      const done = parseInt(parts[4], 10);
      const total = parseInt(parts[5], 10);
      return t('progress.repairingCaptions', {
        iteration,
        maxIterations,
        done,
        total,
      });
    }
    case 'gap_repair': {
      const iteration = parseInt(parts[2], 10);
      const done = parseInt(parts[3], 10);
      const total = parseInt(parts[4], 10);
      return t('progress.gapRepair', { iteration, done, total });
    }
    case 'reviewing_range': {
      const start = parseInt(parts[2], 10) || 0;
      const end = parseInt(parts[3], 10) || start;
      const total = parseInt(parts[4], 10) || end;
      return t('progress.reviewingRange', { start, end, total });
    }
    case 'beginning_review':
      return t('progress.beginningReview');
    case 'starting':
      return t('progress.starting');
    case 'completed':
      return t('progress.completed');
    case 'process_cancelled':
      return t('progress.processCancelled');
    case 'extracting_audio':
      return t('progress.extractingAudio');
    case 'transcribing_of': {
      const done = parseInt(parts[2], 10) || 1;
      const total = parseInt(parts[3], 10) || 1;
      return t('progress.transcribingOf', { done, total });
    }
    case 'transcribing_elevenlabs': {
      const minutes = parseInt(parts[2], 10) || 1;
      return t('progress.transcribingElevenLabs', { minutes });
    }
    case 'transcribing_elevenlabs_hours': {
      const hours = parseInt(parts[2], 10) || 1;
      const minutes = parseInt(parts[3], 10) || 0;
      return t('progress.transcribingElevenLabsHours', { hours, minutes });
    }
    case 'transcribing_elevenlabs_finishing':
      return t('progress.transcribingElevenLabsFinishing');
    case 'transcription_fallback_whisper':
      return t('progress.transcriptionFallbackWhisper');
    case 'transcription_retry': {
      const attempt = parseInt(parts[2], 10) || 1;
      const maxAttempts = parseInt(parts[3], 10) || 3;
      return t('progress.transcriptionRetry', { attempt, maxAttempts });
    }
    case 'transcribing_r2_upload':
      return t('progress.transcribingR2Upload');
    case 'error':
      return t('progress.error');
    default:
      return stage;
  }
}

export default function TranscriptionProgressArea() {
  const { t } = useTranslation();
  const { transcription, setTranscription } = useTaskStore(s => ({
    transcription: s.transcription,
    setTranscription: s.setTranscription,
  }));

  const { inProgress, percent, stage, id } = transcription;
  if (!inProgress || !(id && id.startsWith('transcribe-'))) return null;

  const onCancel = async () => {
    if (!id) return;
    try {
      await OperationIPC.cancel(id);
    } catch (err) {
      console.error('[TranscriptionProgressArea] cancel failed', err);
    } finally {
      setTranscription({ inProgress: false });
    }
  };

  const onClose = () => setTranscription({ inProgress: false });

  return (
    <ProgressArea
      isVisible={true}
      title={t('dialogs.transcriptionInProgress', 'Transcription in progress')}
      progress={percent}
      stage={translateBackendMessage(stage, t)}
      progressBarColor={colors.info}
      operationId={id}
      onCancel={onCancel}
      onClose={onClose}
    />
  );
}
