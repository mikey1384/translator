import { useTranslation } from 'react-i18next';
import ProgressArea from './ProgressArea';
import { colors } from '../../styles';
import { useHighlightWorkflowStore, useTaskStore } from '../../state';
import * as OperationIPC from '../../ipc/operation';
import { translateTranscriptionStageLabel } from './transcription-stage-label';
// ProgressArea renders a smart remaining-time estimate in the header.

export default function TranscriptionProgressArea() {
  const { t } = useTranslation();
  const transcription = useTaskStore(s => s.transcription);
  const setTranscription = useTaskStore(s => s.setTranscription);
  const cancelActiveHighlightWorkflow = useHighlightWorkflowStore(
    s => s.cancelActiveWorkflow
  );
  const isCancellingHighlightWorkflow = useHighlightWorkflowStore(
    s => s.isCancelling
  );

  const { inProgress, percent, stage, id, workflowOwner } = transcription;
  if (!inProgress || !(id && id.startsWith('transcribe-'))) {
    return null;
  }

  const isHighlightWorkflowTranscription = workflowOwner === 'highlight';

  const onCancel = async () => {
    if (isHighlightWorkflowTranscription) {
      await cancelActiveHighlightWorkflow();
      return;
    }

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
      stage={translateTranscriptionStageLabel(stage, t)}
      progressBarColor={colors.info}
      operationId={id}
      onCancel={onCancel}
      isCancelling={
        isHighlightWorkflowTranscription
          ? isCancellingHighlightWorkflow
          : undefined
      }
      onClose={onClose}
    />
  );
}
