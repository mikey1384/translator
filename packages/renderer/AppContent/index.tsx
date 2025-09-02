import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore, useVideoStore, useTaskStore } from '../state';
import * as SystemIPC from '../ipc/system';
import * as SubtitlesIPC from '../ipc/subtitles';
import { useCreditStore } from '../state';
import { useUrlStore } from '../state/url-store';

import FindBar from '../components/FindBar';
import SettingsPage from '../containers/SettingsPage';
import VideoPlayer from '../containers/VideoPlayer';
import MainPanels from './MainPanels';
import Header from './Header';

import ProgressArea from '../components/ProgressAreas/ProgressArea';
import MergingProgressArea from '../components/ProgressAreas/MergingProgressArea';
import TranslationProgressArea from '../components/ProgressAreas/TranslationProgressArea';
import TranscriptionProgressArea from '../components/ProgressAreas/TranscriptionProgressArea';
import FloatingActionButtons from '../components/FloatingActionButtons';
import GlobalModals from '../components/GlobalModals';

import { pageWrapperStyles, containerStyles, colors } from '../styles';
import * as OperationIPC from '../ipc/operation';

export default function AppContent() {
  const { t } = useTranslation();
  const { showSettings } = useUIStore();
  const { setDownload } = useUrlStore();
  const { url: videoUrl } = useVideoStore();
  const { merge, translation, transcription } = useTaskStore();
  const isTranslating =
    !!translation.inProgress &&
    (translation.id?.startsWith('translate-') ?? false);
  const isTranscribing =
    !!transcription.inProgress &&
    (transcription.id?.startsWith('transcribe-') ?? false);
  const download = useUrlStore(s => s.download);

  // Cleanup credit store listeners on unmount
  useEffect(() => {
    return () => {
      useCreditStore.getState().cleanup();
    };
  }, []);

  // Initialize default target translation language from user preference (once)
  useEffect(() => {
    const current = useUIStore.getState().targetLanguage;
    if (current && current !== 'original') return; // user already chose

    const mapToTarget = (pref: string | null): string => {
      const p = (pref || '').toLowerCase();
      const m: Record<string, string> = {
        en: 'english',
        es: 'spanish',
        fr: 'french',
        de: 'german',
        it: 'italian',
        pt: 'portuguese',
        ru: 'russian',
        ja: 'japanese',
        ko: 'korean',
        zh: 'chinese_simplified',
        ar: 'arabic',
        hi: 'hindi',
        id: 'indonesian',
        vi: 'vietnamese',
        tr: 'turkish',
        nl: 'dutch',
        pl: 'polish',
        sv: 'swedish',
        no: 'norwegian',
        da: 'danish',
        fi: 'finnish',
        el: 'greek',
        cs: 'czech',
        hu: 'hungarian',
        ro: 'romanian',
        uk: 'ukrainian',
        he: 'hebrew',
        fa: 'farsi',
        th: 'thai',
        ms: 'malay',
        sw: 'swahili',
        af: 'afrikaans',
        bn: 'bengali',
        ta: 'tamil',
        te: 'telugu',
        mr: 'marathi',
        tl: 'tagalog',
        ur: 'urdu',
      };
      return m[p] || 'english';
    };

    (async () => {
      try {
        // Prefer a previously saved target language from main settings
        const saved = await SubtitlesIPC.getTargetLanguage();
        if (saved && saved !== 'original') {
          useUIStore.getState().setTargetLanguage(saved);
          return;
        }
        const pref = await SystemIPC.getLanguagePreference();
        const target = mapToTarget(pref);
        useUIStore.getState().setTargetLanguage(target);
        await SubtitlesIPC.setTargetLanguage(target);
      } catch {
        // Fallback to English if anything fails
        const target = 'english';
        useUIStore.getState().setTargetLanguage(target);
        try {
          await SubtitlesIPC.setTargetLanguage(target);
        } catch {
          // Do nothing
        }
      }
    })();
  }, []);

  const handleCancelDownload = () => {
    if (!download.id) return;
    OperationIPC.cancel(download.id!);
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

            {isTranscribing && <TranscriptionProgressArea />}

            {isTranslating && <TranslationProgressArea />}

            <FloatingActionButtons />
          </>
        )}
      </div>
      <GlobalModals />
    </div>
  );
}
