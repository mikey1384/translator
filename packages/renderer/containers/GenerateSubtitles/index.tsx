import { useEffect, useState, useMemo } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import FileInputButton from '../../components/FileInputButton.js';
import UrlInputSection from './UrlInputSection.js';
import InputModeToggle from './InputModeToggle.js';
import Section from '../../components/Section.js';
import { useTranslation } from 'react-i18next';
import GenerateSubtitlesPanel from './GenerateSubtitlesPanel.js';
import ProgressDisplay from './ProgressDisplay.js';
import ErrorBanner from '../../components/ErrorBanner.js';
import {
  useUIStore,
  useVideoStore,
  useTaskStore,
  useSubStore,
  useCreditStore,
} from '../../state';
import { STARTING_STAGE } from '../../../shared/constants';
import { useUrlStore } from '../../state/url-store';
import * as SubtitlesIPC from '../../ipc/subtitles';
import { parseSrt } from '../../../shared/helpers';
import * as FileIPC from '../../ipc/file';
import * as SystemIPC from '../../ipc/system';
import UrlCookieBanner from './UrlCookieBanner';

// Helper style for the cost hint (can be moved to a CSS file or styled component if preferred)
const hintStyle = css`
  font-size: 0.85em;
  color: ${colors.text};
  margin-top: 8px;
  margin-bottom: 0px;
  text-align: center;
`;

export default function GenerateSubtitles() {
  const { t } = useTranslation();

  const { balance, loading: creditLoading, refresh } = useCreditStore();
  const [durationSecs, setDurationSecs] = useState<number | null>(null);

  const {
    inputMode,
    targetLanguage,
    showOriginalText,
    setInputMode,
    setTargetLanguage,
    setShowOriginalText,
  } = useUIStore();

  const {
    urlInput,
    downloadQuality,
    error,
    download,
    setUrlInput,
    setDownloadQuality,
    clearError,
    downloadMedia,
  } = useUrlStore();

  const {
    file: videoFile,
    path: videoFilePath,
    openFileDialog,
  } = useVideoStore();

  const { translation, merge, setTranslation } = useTaskStore();

  const toggleSettings = useUIStore(s => s.toggleSettings);

  const hoursNeeded = useMemo(() => {
    if (durationSecs !== null && durationSecs > 0) {
      // Minimum 15 min (1 block), then round UP to nearest 15 min (0.25 hour) block
      const blocks = Math.max(1, Math.ceil(durationSecs / 900)); // Changed Math.round to Math.ceil
      return blocks / 4; // each block is 0.25 hours
    }
    return null;
  }, [durationSecs]);

  const costStr = useMemo(() => hoursNeeded?.toFixed(2), [hoursNeeded]);

  useEffect(() => {
    if (videoFile) {
      const isLocalFileSelection =
        !(videoFile instanceof File) || !(videoFile as any)._originalPath;

      if (isLocalFileSelection) {
        setInputMode('file');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoFile]);

  useEffect(() => {
    if (videoFilePath) {
      SystemIPC.getVideoMetadata(videoFilePath).then(
        (res: import('@shared-types/app').VideoMetadataResult) => {
          if (res.success && res.metadata?.duration) {
            setDurationSecs(res.metadata.duration);
          } else {
            setDurationSecs(null); // Reset if metadata fetch fails or no duration
          }
        }
      );
    } else {
      setDurationSecs(null); // Reset if no video file path
    }
  }, [videoFilePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Section title={t('subtitles.generate')}>
      {(balance ?? 0) <= 0 && !creditLoading && (
        <div
          className={css`
            background-color: #fff3cd;
            border: 1px solid ${colors.warning};
            color: ${colors.warning};
            padding: 12px 16px;
            border-radius: 6px;
            margin-bottom: 16px;
            font-size: 0.9rem;
            p a {
              color: ${colors.primary};
              text-decoration: underline;
              cursor: pointer;
            }
          `}
        >
          <p>
            {t('generateSubtitles.noCredits')}{' '}
            <a onClick={() => toggleSettings(true)}>
              {t('generateSubtitles.rechargeLink')}
            </a>
          </p>
        </div>
      )}

      <UrlCookieBanner />

      {error && <ErrorBanner message={error} onClose={() => clearError()} />}

      <ProgressDisplay
        downloadComplete={!download.inProgress && download.percent === 100}
        downloadedVideoPath={videoFilePath}
        onSaveOriginalVideo={handleSaveOriginalVideo}
        inputMode={inputMode}
        didDownloadFromUrl={!!download.id}
      />

      <InputModeToggle
        inputMode={inputMode}
        onSetInputMode={setInputMode}
        isTranslationInProgress={translation.inProgress}
        isProcessingUrl={download.inProgress}
      />

      {inputMode === 'file' && (
        <div
          className={css`
            padding: 13px 20px;
            border: 1px solid ${colors.border};
            border-radius: 6px;
            background-color: ${colors.light};
          `}
        >
          <label
            style={{
              marginRight: '12px',
              display: 'inline-block',
              minWidth: '220px',
            }}
          >
            {t('input.selectVideoAudioFile')}:
          </label>
          <FileInputButton
            onClick={openFileDialog}
            disabled={download.inProgress || translation.inProgress}
          >
            {videoFile
              ? `${t('common.selected')}: ${videoFile.name}`
              : t('input.selectFile')}
          </FileInputButton>
        </div>
      )}

      {inputMode === 'url' && (
        <div
          className={css`
            padding: 20px;
            border: 1px solid ${colors.border};
            border-radius: 6px;
            background-color: ${colors.light};
          `}
        >
          <UrlInputSection
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            downloadQuality={downloadQuality}
            setDownloadQuality={setDownloadQuality}
            handleProcessUrl={downloadMedia}
            isProcessingUrl={download.inProgress}
            isTranslationInProgress={translation.inProgress}
          />
        </div>
      )}

      {videoFile && (
        <GenerateSubtitlesPanel
          targetLanguage={targetLanguage}
          setTargetLanguage={setTargetLanguage}
          isTranslationInProgress={translation.inProgress}
          showOriginalText={showOriginalText}
          onShowOriginalTextChange={setShowOriginalText}
          videoFile={videoFile}
          videoFilePath={videoFilePath}
          isProcessingUrl={download.inProgress}
          handleGenerateSubtitles={handleGenerateSubtitles}
          isMergingInProgress={merge.inProgress}
          disabledKey={(balance ?? 0) <= 0 || hoursNeeded == null}
        />
      )}
      {videoFile &&
        hoursNeeded !== null &&
        costStr &&
        durationSecs !== null &&
        durationSecs > 0 && (
          <p className={hintStyle}>
            {t('generateSubtitles.costHint', { hours: costStr })}
          </p>
        )}
    </Section>
  );

  async function handleGenerateSubtitles() {
    if (!videoFile && !videoFilePath) {
      useUrlStore.getState().setError('Please select a video');
      return;
    }

    if (durationSecs === null || durationSecs <= 0 || hoursNeeded === null) {
      SystemIPC.showMessage(
        t('generateSubtitles.calculatingCost') ||
          'Video duration is being processed. Please try again shortly.'
      );
      return;
    }

    // —— Credits guard (based on calculated hoursNeeded) ——
    const currentBalance = useCreditStore.getState().balance ?? 0;
    if (currentBalance < hoursNeeded) {
      await SystemIPC.showMessage(
        t('generateSubtitles.notEnoughCredits') ||
          'Not enough credits for this video.'
      );
      return;
    }

    // Try to reserve credits on disk via main process
    const reserve = await SystemIPC.reserveCredits(hoursNeeded);
    if (!reserve.success || typeof reserve.newBalanceHours !== 'number') {
      refresh(); // Refresh balance from store as it might have changed or an error occurred
      await SystemIPC.showMessage(
        reserve.error ||
          t('generateSubtitles.errorReservingCredits') ||
          'Error reserving credits. Please try again.'
      );
      return;
    }

    // Optimistic UI update with the new balance from the reservation
    useCreditStore.setState({ balance: reserve.newBalanceHours });
    // ————————————————

    const operationId = `generate-${Date.now()}`;
    setTranslation({
      id: operationId,
      stage: STARTING_STAGE,
      percent: 0,
      inProgress: true,
    });
    try {
      const opts: any = { targetLanguage, streamResults: true };
      if (videoFilePath) {
        opts.videoPath = videoFilePath;
      } else if (videoFile) {
        opts.videoFile = videoFile;
      }
      opts.operationId = operationId;
      const result = await SubtitlesIPC.generate(opts);
      if (result.subtitles) {
        const finalSegments = parseSrt(result.subtitles);
        useSubStore.getState().load(finalSegments);
        setTranslation({
          id: operationId,
          stage: 'Completed',
          percent: 100,
          inProgress: false,
        });
        // SUCCESS ➜ reservation is now the actual spend. No refund needed.
      } else {
        // FAILURE / CANCELLATION ➜ refund the reserved credits
        useCreditStore.setState(s => ({
          balance: (s.balance ?? 0) + hoursNeeded,
        })); // Optimistic UI refund
        await SystemIPC.refundCredits(hoursNeeded); // Persisted refund via main process

        if (!result.cancelled) {
          setTranslation({
            id: operationId,
            stage: 'Error',
            percent: 100,
            inProgress: false,
          });
        } else {
          // Handle cancellation state if necessary, or assume SubtitlesIPC does
          setTranslation({
            id: operationId,
            stage: 'Cancelled', // Assuming 'Cancelled' is a valid stage or needs to be handled
            percent: 0, // Or 100, depending on desired state representation
            inProgress: false,
          });
        }
      }
    } catch (err: any) {
      console.error('Error generating subtitles:', err);
      // Refund credits on error (if hoursNeeded was calculated and potentially reserved)
      if (hoursNeeded !== null) {
        useCreditStore.setState(s => ({
          balance: (s.balance ?? 0) + hoursNeeded,
        })); // Optimistic UI refund
        await SystemIPC.refundCredits(hoursNeeded); // Persisted refund via main process
      }
      setTranslation({
        id: operationId,
        stage: 'Error',
        percent: 100,
        inProgress: false,
      });
    }
  }

  async function handleSaveOriginalVideo() {
    if (!videoFilePath) {
      clearError();
      return;
    }

    const suggestName = (() => {
      const filename = videoFilePath.split(/[\\/]/).pop() || 'downloaded_video';
      return filename.startsWith('ytdl_') ? filename.slice(5) : filename;
    })();

    try {
      const { filePath, error } = await FileIPC.save({
        title: 'Save Downloaded Video As',
        defaultPath: suggestName,
        content: '',
        filters: [
          {
            name: 'Video Files',
            extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi'],
          },
        ],
      });

      if (error) {
        if (!error.includes('canceled')) clearError();
        return;
      }
      if (!filePath) return; // user cancelled

      const copyRes = await FileIPC.copy(videoFilePath, filePath);
      if (copyRes.error) throw new Error(copyRes.error);

      // Tell the user
      SystemIPC.showMessage(`Video saved to:\n${filePath}`);
    } catch (err: any) {
      console.error('[GenerateSubtitles] save original video error:', err);
      clearError();
    }
  }
}
