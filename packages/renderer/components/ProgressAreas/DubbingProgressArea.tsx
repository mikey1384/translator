import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProgressArea from './ProgressArea';
import Button from '../Button';
import Modal from '../Modal';
import { colors } from '../../styles';
import { useTaskStore } from '../../state';
import * as OperationIPC from '@ipc/operation';

export default function DubbingProgressArea() {
  const { t } = useTranslation();
  const dubbing = useTaskStore(s => s.dubbing);
  const setDubbing = useTaskStore(s => s.setDubbing);
  const { inProgress, percent, stage, id } = dubbing;
  // The app's own dialog, in the UI language: native confirm() buttons follow
  // the OS language and its "Cancel" meant "keep dubbing".
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  const handleCancel = useCallback(async () => {
    if (!id) {
      setDubbing({ inProgress: false });
      return;
    }
    setStopError(null);
    setConfirmOpen(true);
  }, [id, setDubbing]);

  const stopDubbing = useCallback(async () => {
    if (!id) return;
    setIsStopping(true);
    setStopError(null);
    try {
      await OperationIPC.cancel(id);
      // Only a confirmed cancel ends the job here; a failed one keeps going.
      setDubbing({ inProgress: false });
      setConfirmOpen(false);
    } catch (err: any) {
      console.error('[DubbingProgressArea] cancel failed', err);
      setStopError(
        t(
          'errors.cancelDubbingFailedPlain',
          "Couldn't stop dubbing. Try again."
        )
      );
    } finally {
      setIsStopping(false);
    }
  }, [id, setDubbing, t]);

  const handleClose = useCallback(() => {
    setDubbing({ inProgress: false });
  }, [setDubbing]);

  const progressBarColor = useMemo(() => {
    if (percent >= 100) return colors.success;
    return colors.progressDub;
  }, [percent]);

  if (!inProgress || !(id && id.startsWith('dub-'))) {
    return null;
  }

  return (
    <>
      <ProgressArea
        isVisible={inProgress}
        title={t('dialogs.dubbingInProgress', 'Generating dubbed audio')}
        progress={percent}
        stage={stage || t('dialogs.dubbingWorking', 'Processing...')}
        progressBarColor={progressBarColor}
        operationId={id}
        onCancel={handleCancel}
        onClose={handleClose}
        isCancelling={isStopping}
      />
      <Modal
        open={confirmOpen}
        title={t('dialogs.cancelDubbingTitle', 'Stop dubbing?')}
        titleId="confirm-cancel-dubbing-title"
        onClose={() => {
          if (!isStopping) setConfirmOpen(false);
        }}
        actions={
          <>
            <Button
              variant="text"
              onClick={() => setConfirmOpen(false)}
              disabled={isStopping}
            >
              {t('dialogs.keepDubbing', 'Keep dubbing')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void stopDubbing()}
              isLoading={isStopping}
            >
              {t('dialogs.stopDubbing', 'Stop dubbing')}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          {stopError ??
            t(
              'dialogs.cancelDubbingBody',
              'The dubbed audio made so far will be discarded.'
            )}
        </p>
      </Modal>
    </>
  );
}
