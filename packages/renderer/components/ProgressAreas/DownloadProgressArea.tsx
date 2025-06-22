import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';
import ProgressArea from './ProgressArea';
import ProcessingBanner from '../ProcessingBanner';
import { useUrlStore } from '../../state/url-store';
import * as OperationIPC from '@ipc/operation';
import { css } from '@emotion/css';

/* ------------------------------------------------------------------ */
/* 📐  Constants & helpers                                             */
/* ------------------------------------------------------------------ */
const DOWNLOAD_PROGRESS_COLOR = colors.progressDownload;

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

type DownloadSlice = {
  inProgress: boolean;
  percent: number;
  stage: string;
  id: string | null;
};

export default function DownloadProgressArea({
  autoCloseDelay = 3_000,
}: { autoCloseDelay?: number } = {}) {
  const { t } = useTranslation();
  
  /* -------------------------------------------------------------- */
  /* 1 ️⃣  read from zustand                                        */
  /* -------------------------------------------------------------- */
  const {
    download: { inProgress, percent, stage, id },
    setDownload: patchDownload,
  } = useUrlStore(s => ({
    download: s.download,
    setDownload: s.setDownload,
  })) as {
    download: DownloadSlice;
    setDownload: (p: Partial<DownloadSlice>) => void;
  };

  /* -------------------------------------------------------------- */
  /* 2 ️⃣  local UI state                                           */
  /* -------------------------------------------------------------- */
  const [isCancelling, setIsCancelling] = useState(false);
  const [showStallBanner, setShowStallBanner] = useState(false);
  const [lastProgressUpdate, setLastProgressUpdate] = useState<number | null>(null);

  // Track progress updates to detect when download is stalled
  useEffect(() => {
    if (inProgress && stage !== 'Starting download...' && percent > 10) {
      setLastProgressUpdate(Date.now());
      setShowStallBanner(false);
    }
  }, [percent, stage, inProgress]);

  // Show banner if download has been stalled for too long
  useEffect(() => {
    if (!inProgress || !lastProgressUpdate || stage === 'Starting download...' || percent <= 10) {
      setShowStallBanner(false);
      return;
    }

    const timer = setTimeout(() => {
      const timeSinceLastUpdate = Date.now() - lastProgressUpdate;
      if (timeSinceLastUpdate > 30000) { // 30 seconds
        setShowStallBanner(true);
      }
    }, 30000);

    return () => clearTimeout(timer);
  }, [lastProgressUpdate, inProgress, stage, percent]);

  useEffect(() => {
    devLog('[DownloadPA] op id →', id);
  }, [id]);

  /* -------------------------------------------------------------- */
  /* 3 ️⃣  handlers                                                */
  /* -------------------------------------------------------------- */
  const handleCancel = useCallback(async () => {
    if (!id) {
      console.warn('[DownloadPA] no operation id – nothing to cancel');
      patchDownload({ inProgress: false });
      return;
    }

    setIsCancelling(true);

    try {
      devLog('[DownloadPA] cancelling', id);
      await OperationIPC.cancel(id);
    } catch (err: any) {
      devError('[DownloadPA] cancel failed', err);
      alert(`Failed to cancel the operation: ${err.message || err}`);
    } finally {
      setIsCancelling(false);
      patchDownload({ inProgress: false });
    }
  }, [id, patchDownload]);

  const handleClose = useCallback(() => {
    patchDownload({ 
      inProgress: false,
      percent: 100,
      stage: 'Completed',
      id: null,
    });
  }, [patchDownload]);

  const progressBarColor = useMemo(() => {
    if (isCancelling) return colors.danger;
    if (percent >= 100) return colors.success;
    if (stage.toLowerCase().includes('error')) return colors.danger;
    return DOWNLOAD_PROGRESS_COLOR;
  }, [isCancelling, percent, stage]);

  if (!inProgress || stage.toLowerCase().includes('error')) return null;

  return (
    <>
      <ProcessingBanner
        isVisible={showStallBanner}
        titleKey="dialogs.slowDownloadBanner.title"
        descriptionKey="dialogs.slowDownloadBanner.description"
        onClose={handleClose}
      />
      <div
        className={css`
          margin-top: ${showStallBanner
            ? '60px'
            : '0'}; /* Space for the banner above */
        `}
      >
        <ProgressArea
          isVisible={true}
          title={t('dialogs.downloadInProgress')}
          progress={percent}
          stage={stage}
          progressBarColor={progressBarColor}
          isCancelling={isCancelling}
          operationId={id}
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