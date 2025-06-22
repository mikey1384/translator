import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore, useVideoStore, useTaskStore } from '../state';
import { useCreditStore } from '../state';

import FindBar from '../components/FindBar';
import SettingsPage from '../containers/SettingsPage';
import VideoPlayer from '../containers/VideoPlayer';
import MainPanels from './MainPanels';
import Header from './Header';

import ProgressArea from '../components/ProgressAreas/ProgressArea';
import DownloadProgressArea from '../components/ProgressAreas/DownloadProgressArea';
import MergingProgressArea from '../components/ProgressAreas/MergingProgressArea';
import TranslationProgressArea from '../components/ProgressAreas/TranslationProgressArea';
import FloatingActionButtons from '../components/FloatingActionButtons';

import { pageWrapperStyles, containerStyles, colors } from '../styles';

export default function AppContent() {
  const { t } = useTranslation();
  const { showSettings } = useUIStore();
  const { url: videoUrl } = useVideoStore();
  const { merge, translation } = useTaskStore();

  // Cleanup credit store listeners on unmount
  useEffect(() => {
    return () => {
      useCreditStore.getState().cleanup();
    };
  }, []);

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

            <DownloadProgressArea />

            {merge.inProgress && <MergingProgressArea />}

            {translation.inProgress && <TranslationProgressArea />}

            <FloatingActionButtons />
          </>
        )}
      </div>
    </div>
  );
}
