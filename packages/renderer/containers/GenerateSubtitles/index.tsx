import { useEffect } from 'react';
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

export default function GenerateSubtitles() {
  const { t } = useTranslation();

  const { balance, loading: creditLoading, refresh } = useCreditStore();

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
          disabledKey={(balance ?? 0) <= 0}
        />
      )}
    </Section>
  );

  async function handleGenerateSubtitles() {
    if (!videoFile && !videoFilePath) {
      useUrlStore.getState().setError('Please select a video');
      return;
    }

    // —— Credits guard ——
    const needed = 0.25; // TODO: real duration-based formula
    const { balance } = useCreditStore.getState();
    if ((balance ?? 0) < needed) {
      await SystemIPC.showMessage('Not enough credits for this video.');
      return;
    }
    // Optimistic UI deduction
    useCreditStore.setState(s => ({
      balance: Math.max(0, (s.balance ?? 0) - needed),
    }));
    // Persist on disk
    await SystemIPC.spendCredits(needed);
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
        // SUCCESS ➜ keep the deduction (removed incorrect refund from here)
      } else {
        // FAILURE / CANCELLATION ➜ refund
        useCreditStore.setState(s => ({ balance: (s.balance ?? 0) + needed }));
        await SystemIPC.refundCredits(needed); // Persisted refund

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
      // Refund credits on error
      useCreditStore.setState(s => ({ balance: (s.balance ?? 0) + needed }));
      await SystemIPC.refundCredits(needed); // Persisted refund
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
