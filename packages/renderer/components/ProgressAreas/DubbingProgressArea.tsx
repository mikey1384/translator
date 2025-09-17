import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ProgressArea from './ProgressArea';
import { colors } from '../../styles';
import { useTaskStore } from '../../state';
import * as OperationIPC from '@ipc/operation';

export default function DubbingProgressArea() {
  const { t } = useTranslation();
  const {
    dubbing: { inProgress, percent, stage, id },
    setDubbing,
  } = useTaskStore(s => ({
    dubbing: s.dubbing,
    setDubbing: s.setDubbing,
  }));

  const handleCancel = useCallback(async () => {
    if (!id) {
      setDubbing({ inProgress: false });
      return;
    }

    const confirmed = window.confirm(
      t('dialogs.cancelDubbingConfirm', 'Cancel dubbing in progress?')
    );
    if (!confirmed) return;

    try {
      await OperationIPC.cancel(id);
    } catch (err: any) {
      console.error('[DubbingProgressArea] cancel failed', err);
      alert(`Failed to cancel dubbing: ${err?.message || err}`);
    } finally {
      setDubbing({ inProgress: false });
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
    <ProgressArea
      isVisible={inProgress}
      title={t('dialogs.dubbingInProgress', 'Generating dubbed audio')}
      progress={percent}
      stage={stage || t('dialogs.dubbingWorking', 'Processing...')}
      progressBarColor={progressBarColor}
      operationId={id}
      onCancel={handleCancel}
      onClose={handleClose}
    />
  );
}
