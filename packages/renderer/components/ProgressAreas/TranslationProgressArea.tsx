import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';
import ProgressArea from './ProgressArea';
import ProcessingBanner from '../ProcessingBanner';
import { useTaskStore } from '../../state';
import * as OperationIPC from '@ipc/operation';
import { css } from '@emotion/css';
// Remaining hours are computed and shown in ProgressArea header next to credits

/* ------------------------------------------------------------------ */
/* 📐  Constants & helpers                                             */
/* ------------------------------------------------------------------ */
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

// Function to translate backend i18n messages
function translateBackendMessage(
  stage: string,
  t: (key: string, options?: any) => string
): string {
  if (!stage.startsWith('__i18n__:')) {
    return stage; // Return original if not a special message
  }

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
    case 'beginning_review': {
      return t('progress.beginningReview');
    }
    default:
      return stage; // Fallback to original
  }
}

type TranslationSlice = {
  inProgress: boolean;
  percent: number;
  stage: string;
  id?: string;
};

export default function TranslationProgressArea({
  autoCloseDelay = 3_000,
}: { autoCloseDelay?: number } = {}) {
  const { t } = useTranslation();
  const {
    translation: { inProgress, percent, stage, id },
    setTranslation: patchTranslation,
  } = useTaskStore(s => ({
    translation: s.translation,
    setTranslation: s.setTranslation,
  })) as {
    translation: TranslationSlice;
    setTranslation: (p: Partial<TranslationSlice>) => void;
  };

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

  // Show banner if AI processing has been stuck for too long
  useEffect(() => {
    if (!inProgress || !lastProgressUpdate) {
      setShowSlowProgressBanner(false);
      return;
    }

    const timer = setTimeout(() => {
      const timeSinceLastUpdate = Date.now() - lastProgressUpdate;
      if (timeSinceLastUpdate > 60000) {
        setShowSlowProgressBanner(true);
      }
    }, 100000);

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
      alert(`Failed to cancel the operation: ${err.message || err}`);
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

  if (!inProgress) return null;

  return (
    <>
      <ProcessingBanner
        isVisible={showSlowProgressBanner}
        titleKey="dialogs.slowProcessingBanner.title"
        descriptionKey="dialogs.slowProcessingBanner.description"
        linkHref="https://status.openai.com"
        linkTextKey="dialogs.slowProcessingBanner.checkStatus"
        onClose={handleCloseBanner}
      />
      <div
        className={css`
          margin-top: ${showSlowProgressBanner
            ? '60px'
            : '0'}; /* Space for the banner above */
        `}
      >
        <ProgressArea
          isVisible={inProgress}
          title={t('dialogs.translationInProgress')}
          progress={percent}
          stage={translateBackendMessage(stage, t)}
          progressBarColor={progressBarColor}
          isCancelling={isCancelling}
          operationId={id ?? null}
          onCancel={handleCancel}
          onClose={handleClose}
          autoCloseDelay={
            percent >= 100 && !stage.toLowerCase().includes('error')
              ? autoCloseDelay
              : undefined
          }
        />
      </div>
    </>
  );
}
