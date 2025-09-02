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
