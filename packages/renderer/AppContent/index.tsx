/* packages/renderer/AppContent/index.tsx */
import { useUIStore, useVideoStore, useTaskStore, useSubStore } from '../state';
import LogoDisplay from '../components/LogoDisplay';
import LanguageSwitcher from '../components/LanguageSwitcher';
import SettingsPage from '../containers/SettingsPage';
import VideoPlayer from '../containers/VideoPlayer';
import GenerateSubtitles from '../containers/GenerateSubtitles';
import EditSubtitles from '../containers/EditSubtitles';
import ProgressArea from '../components/ProgressAreas/ProgressArea';
import MergingProgressArea from '../components/ProgressAreas/MergingProgressArea';
import TranslationProgressArea from '../components/ProgressAreas/TranslationProgressArea';
import BackToTopButton from '../components/BackToTopButton';
import FindBar from '../components/FindBar';
import { pageWrapperStyles, containerStyles, colors } from '../styles';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';

// Header Component
const headerStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  gap: 15px;
`;

const btn = css`
  padding: 8px 15px;
  font-size: 0.9em;
  background: #eee;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
`;

function Header() {
  const { t } = useTranslation();
  const { showSettings, toggleSettings } = useUIStore();

  return (
    <div className={headerStyles}>
      {showSettings ? (
        <button className={btn} onClick={() => toggleSettings(false)}>
          {t('common.backToApp')}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <LogoDisplay />
          <LanguageSwitcher />
        </div>
      )}

      {!showSettings && (
        <button className={btn} onClick={() => toggleSettings(true)}>
          {t('common.settings')}
        </button>
      )}
    </div>
  );
}

// MainPanels Component
function MainPanels() {
  const { url: _videoUrl } = useVideoStore();
  const { download: _download } = useTaskStore();
  const { showSettings: _showSettings } = useUIStore();

  return (
    <>
      <GenerateSubtitles />
      <EditSubtitles
        showOriginalText={true}
        isAudioOnly={false}
        videoFile={null}
        videoFilePath={null}
        subtitles={[]}
        videoPlayerRef={null}
        isMergingInProgress={false}
        setMergeStage={() => {}}
        editorRef={{
          current: {
            scrollToCurrentSubtitle: () => {},
            scrollToSubtitleIndex: () => {},
          },
        }}
        onSelectVideoClick={() => {}}
        onSetMergeOperationId={() => {}}
        onSetSubtitleSegments={() => {}}
        reviewedBatchStartIndex={0}
        canSaveDirectly={false}
        handleSaveSrt={() => Promise.resolve()}
        handleSaveEditedSrtAs={() => Promise.resolve()}
        onSrtFileLoaded={() => {}}
        saveError=""
        setSaveError={() => {}}
        searchText=""
        onStartPngRenderRequest={() => Promise.resolve({ success: false })}
        videoDuration={0}
        videoWidth={0}
        videoHeight={0}
        videoFrameRate={0}
        mergeFontSize={24}
        setMergeFontSize={() => {}}
        mergeStylePreset="Default"
        setMergeStylePreset={() => {}}
        isTranslationInProgress={false}
      />
    </>
  );
}

export default function AppContent() {
  const { showSettings, toggleSettings: _toggleSettings } = useUIStore(s => ({
    showSettings: s.showSettings,
    toggleSettings: s.toggleSettings,
  }));

  const {
    url: videoUrl,
    isAudioOnly: _isAudioOnly,
    isReady: _isVideoReady,
    togglePlay,
  } = useVideoStore(s => ({
    url: s.url,
    isAudioOnly: s.isAudioOnly,
    isReady: s.isReady,
    togglePlay: s.togglePlay,
  }));

  const {
    download,
    translation,
    merge,
    cancellingDownload,
    setCancellingDownload,
  } = useTaskStore(s => ({
    download: s.download,
    translation: s.translation,
    merge: s.merge,
    cancellingDownload: s.cancellingDownload,
    setCancellingDownload: s.setCancellingDownload,
  }));

  /* subtitles for player & editor */
  const liveSegments = useSubStore(s => s.order.map(id => s.segments[id]));

  /* ---------- handlers – call store actions or service fns ---------- */
  const handleCancelDownload = () => {
    if (download.id) {
      import('../ipc/operation').then(m => m.cancel(download.id!));
      setCancellingDownload(true);
    }
  };

  /* ---------- render ---------- */
  return (
    <div className={pageWrapperStyles}>
      {!showSettings && videoUrl && (
        <div style={{ height: 'calc(35vh + 2rem)' }} />
      )}
      <FindBar
        isVisible={false}
        searchText=""
        onSearchTextChange={() => {}}
        matchCount={0}
        activeMatchIndex={0}
        onFindNext={() => {}}
        onFindPrev={() => {}}
        onClose={() => {}}
        onReplaceAll={() => {}}
      />{' '}
      {/* now fully self-controlled via UI-store */}
      <div className={containerStyles}>
        <Header />

        {showSettings ? (
          <SettingsPage
            apiKeyStatus={{ openai: false }}
            isLoadingStatus={false}
          />
        ) : (
          <>
            {videoUrl && (
              <VideoPlayer
                videoUrl={videoUrl}
                subtitles={liveSegments}
                isTranslationInProgress={translation.inProgress}
                isMergingInProgress={merge.inProgress}
                isProcessingUrl={download.inProgress}
                onTogglePlay={togglePlay}
                isProgressBarVisible={
                  translation.inProgress ||
                  merge.inProgress ||
                  download.inProgress
                }
                videoRef={{ current: null }}
                onPlayerReady={() => {}}
                onSelectVideoClick={() => {}}
                onProcessUrl={() => {}}
                onScrollToCurrentSubtitle={() => {}}
                onShiftAllSubtitles={() => {}}
                onSetUrlInput={() => {}}
                onSetSubtitleSegments={() => {}}
                onSrtFileLoaded={() => {}}
                urlInput=""
                mergeFontSize={24}
                mergeStylePreset="Default"
                downloadQuality="mid"
                onSetDownloadQuality={() => {}}
                showOriginalText={true}
              />
            )}

            <MainPanels />

            <ProgressArea
              isVisible={
                download.inProgress &&
                !download.stage.toLowerCase().includes('error')
              }
              title="Download in Progress"
              progress={download.percent}
              stage={download.stage}
              progressBarColor={
                download.stage.toLowerCase().includes('error')
                  ? colors.danger
                  : colors.progressDownload
              }
              operationId={download.id}
              isCancelling={cancellingDownload}
              onCancel={handleCancelDownload}
              onClose={() =>
                useTaskStore.getState().setDownload({ inProgress: false })
              }
            />

            {merge.inProgress && (
              <MergingProgressArea
                mergeProgress={merge.percent}
                mergeStage={merge.stage}
                operationId={merge.id}
                onSetIsMergingInProgress={() => {}} // TODO: Implement proper handler
                isMergingInProgress={merge.inProgress}
              />
            )}

            <TranslationProgressArea
              isTranslationInProgress={translation.inProgress}
              translationProgress={translation.percent}
              translationStage={translation.stage}
              translationOperationId={translation.id}
              onSetIsTranslationInProgress={() => {}} // TODO: Implement proper handler
            />

            <BackToTopButton />
          </>
        )}
      </div>
    </div>
  );
}
