import { useTranslation } from 'react-i18next';
import { useUIStore, useVideoStore, useTaskStore } from '../state';
import { useUrlStore } from '../state/url-store';

import FindBar from '../components/FindBar';
import SettingsPage from '../containers/SettingsPage';
import VideoPlayer from '../containers/VideoPlayer';
import MainPanels from './MainPanels';
import Header from './Header';

import ProgressArea from '../components/ProgressAreas/ProgressArea';
import MergingProgressArea from '../components/ProgressAreas/MergingProgressArea';
import TranslationProgressArea from '../components/ProgressAreas/TranslationProgressArea';
import BackToTopButton from '../components/BackToTopButton';

import { pageWrapperStyles, containerStyles, colors } from '../styles';

export default function AppContent() {
  const { t } = useTranslation();
  const { showSettings } = useUIStore();
  const { cancellingDownload, setCancellingDownload, setDownload } =
    useUrlStore();
  const { url: videoUrl } = useVideoStore();
  const { merge, translation } = useTaskStore();
  const download = useUrlStore(s => s.download);

  const handleCancelDownload = () => {
    if (!download.id) return;
    import('../ipc/operation').then(m => m.cancel(download.id!));
    setCancellingDownload(true);
  };

  return (
    <div className={pageWrapperStyles}>
      {!showSettings && videoUrl && (
        <div style={{ height: 'calc(35vh + 2rem)' }} />
      )}

      <FindBar />

      <div className={containerStyles}>
        <Header />

        {showSettings ? (
          <SettingsPage />
        ) : (
          <>
            {videoUrl && <VideoPlayer />}

            <MainPanels />

            <ProgressArea
              isVisible={
                download.inProgress &&
                !download.stage.toLowerCase().includes('error')
              }
              title={t('dialogs.downloadInProgress')}
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
                setDownload({
                  inProgress: false,
                  percent: 100,
                  stage: 'Completed',
                  id: null,
                })
              }
            />

            {merge.inProgress && <MergingProgressArea />}

            {translation.inProgress && <TranslationProgressArea />}

            <BackToTopButton />
          </>
        )}
      </div>
    </div>
  );
}
