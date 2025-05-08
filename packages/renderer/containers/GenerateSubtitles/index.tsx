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
} from '../../state';
import * as UrlIPC from '../../ipc/url';
import * as SubtitlesIPC from '../../ipc/subtitles';
import { parseSrt } from '../../../shared/helpers';
import * as FileIPC from '../../ipc/file';
import * as SystemIPC from '../../ipc/system';

export default function GenerateSubtitles() {
  const { t } = useTranslation();

  const {
    inputMode,
    urlInput,
    downloadQuality,
    targetLanguage,
    showOriginalText,
    error,
    setInputMode,
    setUrlInput,
    setDownloadQuality,
    setTargetLanguage,
    setShowOriginalText,
    setError,
  } = useUIStore();

  const {
    file: videoFile,
    path: videoFilePath,
    setFile,
    openFileDialog,
  } = useVideoStore();

  const { download, translation, merge, setDownload, setTranslation } =
    useTaskStore();

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

  return (
    <Section title={t('subtitles.generate')}>
      <ApiKeyLock
        apiKeyStatus={{ openai: true }}
        isLoadingKeyStatus={false}
        onNavigateToSettings={show =>
          useUIStore.getState().toggleSettings(show)
        }
      />

      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

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
          <FileInputButton onClick={openFileDialog}>
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
            setError={setError}
            downloadQuality={downloadQuality}
            setDownloadQuality={setDownloadQuality}
            handleProcessUrl={handleProcessUrl}
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
        />
      )}
    </Section>
  );

  async function handleProcessUrl() {
    if (!urlInput.trim()) {
      setError('Please enter a valid URL');
      return;
    }
    const opId = `download-${Date.now()}`;
    setDownload({
      id: opId,
      stage: 'Starting',
      percent: 0,
      inProgress: true,
    });
    try {
      const res = await UrlIPC.process({
        url: urlInput,
        quality: downloadQuality,
        operationId: opId,
      });
      // Handle success/error logic here, updating stores as needed
      if (res.success && res.videoPath && res.filename) {
        await setFile({ path: res.videoPath, name: res.filename });
        setDownload({
          id: opId,
          stage: 'Completed',
          percent: 100,
          inProgress: false,
        });
        setUrlInput('');
        useSubStore.getState().load([]); // clear any stale subtitles
      } else {
        setError(res.error || 'Failed to process URL');
        setDownload({
          id: opId,
          stage: 'Error',
          percent: 100,
          inProgress: false,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Error processing URL');
      setDownload({
        id: opId,
        stage: 'Error',
        percent: 100,
        inProgress: false,
      });
    }
  }

  async function handleGenerateSubtitles() {
    if (!videoFile && !videoFilePath) {
      setError('Please select a video file first');
      return;
    }
    setError('');
    const operationId = `generate-${Date.now()}`;
    setTranslation({
      id: operationId,
      stage: 'Starting',
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
        setError('No subtitles were generated');
        setTranslation({
          id: operationId,
          stage: 'Error',
          percent: 100,
          inProgress: false,
        });
      }
    } catch (err: any) {
      setError(`Error generating subtitles: ${err.message || err}`);
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
      setError('No downloaded video found to save.');
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
        if (!error.includes('canceled')) setError(error);
        return;
      }
      if (!filePath) return; // user cancelled

      const copyRes = await FileIPC.copy(videoFilePath, filePath);
      if (copyRes.error) throw new Error(copyRes.error);

      // Tell the user
      SystemIPC.showMessage(`Video saved to:\n${filePath}`);
    } catch (err: any) {
      console.error('[GenerateSubtitles] save original video error:', err);
      setError(`Error saving video: ${err.message || String(err)}`);
    }
  }
}
