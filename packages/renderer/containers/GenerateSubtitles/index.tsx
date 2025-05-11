import { useEffect } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import ApiKeyLock from './ApiKeyLock.js';
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
  useSettingsStore,
} from '../../state';
import { STARTING_STAGE } from '../../../shared/constants';
import { useUrlStore } from '../../state/url-store';
import * as SubtitlesIPC from '../../ipc/subtitles';
import { parseSrt } from '../../../shared/helpers';
import * as FileIPC from '../../ipc/file';
import * as SystemIPC from '../../ipc/system';

export default function GenerateSubtitles() {
  const { t } = useTranslation();

  const { loading: loadingKeyStatus, keySet, fetchStatus } = useSettingsStore();

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
    if (keySet === undefined) fetchStatus();
  }, [keySet, fetchStatus]);

  return (
    <Section title={t('subtitles.generate')}>
      <ApiKeyLock
        apiKeyStatus={{ openai: !!keySet }}
        isLoadingKeyStatus={loadingKeyStatus}
        onNavigateToSettings={show =>
          useUIStore.getState().toggleSettings(show)
        }
      />

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
          disabledKey={!keySet}
        />
      )}
    </Section>
  );

  async function handleGenerateSubtitles() {
    if (!videoFile && !videoFilePath) {
      useUrlStore.getState().setError('Please select a video');
      return;
    }
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
      } else {
        if (!result.cancelled) {
          setTranslation({
            id: operationId,
            stage: 'Error',
            percent: 100,
            inProgress: false,
          });
        }
      }
    } catch (err: any) {
      console.error('Error generating subtitles:', err);
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
