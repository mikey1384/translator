import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';
import ProgressArea from './ProgressArea';
import { useTaskStore } from '../../state';
import * as OperationIPC from '@ipc/operation';
import { css } from '@emotion/css';

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
  /* -------------------------------------------------------------- */
  /* 1 ️⃣  read from zustand                                        */
  /* -------------------------------------------------------------- */
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

  /* -------------------------------------------------------------- */
  /* 2 ️⃣  local UI state                                           */
  /* -------------------------------------------------------------- */
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

  /* -------------------------------------------------------------- */
  /* 3 ️⃣  handlers                                                */
  /* -------------------------------------------------------------- */
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

  const progressBarColor = useMemo(() => {
    if (isCancelling) return colors.danger;
    if (percent >= 100) return colors.success;
    return TRANSLATION_PROGRESS_COLOR;
  }, [isCancelling, percent]);

  if (!inProgress) return null;

  return (
    <>
      {showSlowProgressBanner && (
        <div
          className={css`
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 1200;
            background-color: #fff3cd;
            border-bottom: 1px solid #ffeaa7;
            color: #856404;
            padding: 12px 16px;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
          `}
        >
          <span
            className={css`
              font-size: 16px;
            `}
          >
            ⏳
          </span>
          <div>
            <strong>{t('dialogs.slowProcessingBanner.title')}</strong>
            <br />
            {t('dialogs.slowProcessingBanner.description')}{' '}
            <a
              href="https://status.openai.com"
              target="_blank"
              rel="noopener noreferrer"
              className={css`
                color: #856404;
                text-decoration: underline;
                cursor: pointer;
                &:hover {
                  text-decoration: none;
                }
              `}
            >
              {t('dialogs.slowProcessingBanner.checkStatus')}
            </a>
          </div>
        </div>
      )}
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
