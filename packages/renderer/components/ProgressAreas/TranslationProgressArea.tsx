import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';
import ProgressArea from './ProgressArea';
import ProcessingBanner from '../ProcessingBanner';
import { useTaskStore } from '../../state';
import * as OperationIPC from '@ipc/operation';
import { translateTranslationStageLabel } from './translation-stage-label.js';

const TRANSLATION_PROGRESS_COLOR = colors.progressTranslate;

const devLog = (...a: any[]) => {
  if (!window.env.isPackaged) {
    console.log(...a);
  }
};
const devError = (...a: any[]) => {
  if (!window.env.isPackaged) {
    console.error(...a);
  }
};

type TranslationSlice = {
  inProgress: boolean;
  percent: number;
  stage: string;
  id?: string;
  model?: string;
  phaseKey?: string;
};

export default function TranslationProgressArea({
  autoCloseDelay = 3_000,
}: { autoCloseDelay?: number } = {}) {
  const { t } = useTranslation();
  const translation = useTaskStore(s => s.translation) as TranslationSlice;
  const patchTranslation = useTaskStore(s => s.setTranslation);
  const { inProgress, percent, stage, id, model, phaseKey } = translation;

  const [isCancelling, setIsCancelling] = useState(false);
  const [showSlowProgressBanner, setShowSlowProgressBanner] = useState(false);
  const [lastProgressUpdate, setLastProgressUpdate] = useState<number | null>(
    null
  );

  // Track progress updates to detect when AI processing is stalled
  useEffect(() => {
    if (inProgress) {
      setLastProgressUpdate(Date.now());
      setShowSlowProgressBanner(false);
    }
  }, [percent, stage, inProgress]);

  // Show banner if AI processing has been stuck for too long (review batches can take minutes)
  useEffect(() => {
    if (!inProgress || !lastProgressUpdate) {
      setShowSlowProgressBanner(false);
      return;
    }

    const STALE_MS = 180_000; // 3 minutes without progress
    const CHECK_DELAY_MS = 210_000; // check a bit after 3 minutes
    const timer = setTimeout(() => {
      const timeSinceLastUpdate = Date.now() - lastProgressUpdate;
      if (timeSinceLastUpdate > STALE_MS) {
        setShowSlowProgressBanner(true);
      }
    }, CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, [lastProgressUpdate, inProgress, stage]);

  useEffect(() => {
    devLog('[TransPA] op id →', id);
  }, [id]);

  const handleCancel = useCallback(async () => {
    if (!id) {
      console.warn('[TransPA] no operation id – nothing to cancel');
      patchTranslation({ inProgress: false });
      return;
    }

    if (!window.confirm(t('dialogs.cancelTranslationConfirm'))) return;

    setIsCancelling(true);

    try {
      devLog('[TransPA] cancelling', id);
      await OperationIPC.cancel(id);
    } catch (err: any) {
      devError('[TransPA] cancel failed', err);
      alert(
        t('errors.cancelTranslationFailed', {
          defaultValue: 'Failed to cancel translation: {{message}}',
          message: err?.message || String(err),
        })
      );
    } finally {
      setIsCancelling(false);
      patchTranslation({ inProgress: false });
    }
  }, [id, patchTranslation, t]);

  const handleClose = useCallback(() => {
    patchTranslation({ inProgress: false });
  }, [patchTranslation]);

  const handleCloseBanner = useCallback(() => {
    setShowSlowProgressBanner(false);
  }, []);

  const progressBarColor = useMemo(() => {
    if (isCancelling) return colors.danger;
    if (percent >= 100) return colors.success;
    return TRANSLATION_PROGRESS_COLOR;
  }, [isCancelling, percent]);

  // Combine stage message with model name when available (during review phase)
  const displayStage = useMemo(() => {
    const translatedStage = translateTranslationStageLabel(stage, t);
    if (model && phaseKey === 'review') {
      return `${translatedStage} (${model})`;
    }
    return translatedStage;
  }, [stage, model, phaseKey, t]);

  if (!inProgress) return null;

  return (
    <ProgressArea
      isVisible={inProgress}
      title={t('dialogs.translationInProgress')}
      progress={percent}
      stage={displayStage}
      progressBarColor={progressBarColor}
      isCancelling={isCancelling}
      operationId={id ?? null}
      onCancel={handleCancel}
      onClose={handleClose}
      notice={
        <ProcessingBanner
          isVisible={showSlowProgressBanner}
          titleKey="dialogs.slowProcessingBanner.title"
          descriptionKey="dialogs.slowProcessingBanner.description"
          linkHref="https://status.openai.com"
          linkTextKey="dialogs.slowProcessingBanner.checkStatus"
          onClose={handleCloseBanner}
        />
      }
      autoCloseDelay={
        percent >= 100 && !stage.toLowerCase().includes('error')
          ? autoCloseDelay
          : undefined
      }
    />
  );
}
