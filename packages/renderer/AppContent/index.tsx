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
import DubbingProgressArea from '../components/ProgressAreas/DubbingProgressArea';
import FloatingActionButtons from '../components/FloatingActionButtons';
import GlobalModals from '../components/GlobalModals';
import CreditWarningBanner from '../containers/GenerateSubtitles/components/CreditWarningBanner';
import { useCreditSystem } from '../containers/GenerateSubtitles/hooks/useCreditSystem';
import { useAiStore } from '../state';

import { css } from '@emotion/css';
import { pageWrapperStyles, containerStyles, colors } from '../styles';
import * as OperationIPC from '../ipc/operation';
import { logProgress, logButton } from '../utils/logger';
import { useRef } from 'react';

const settingsPageWrapper = css`
  position: fixed;
  inset: 0;
  background-color: ${colors.bg};
  overflow-y: auto;
  z-index: 50;
`;

const settingsHeader = css`
  position: sticky;
  top: 0;
  z-index: 100;
  background-color: ${colors.bg};
  padding: 1.5rem;
  border-bottom: 1px solid ${colors.border};
`;

const settingsBackButton = css`
  padding: 8px 15px;
  font-size: 0.9em;
  background-color: ${colors.grayLight};
  color: ${colors.text};
  border: 1px solid ${colors.border};
  border-radius: 4px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    background-color: ${colors.surface};
    border-color: ${colors.primary};
  }
`;

export default function AppContent() {
  const { t } = useTranslation();
  // Initialize BYO/OpenAI state at app load so pills reflect "Using API Key"
  useEffect(() => {
    try {
      useAiStore.getState().initialize();
    } catch {
      // Ignore initialization errors
    }
  }, []);
  const { showSettings } = useUIStore();
  const { setDownload } = useUrlStore();
  const { url: videoUrl } = useVideoStore();
  const isTranslating = useTaskStore(
    s =>
      !!s.translation.inProgress &&
      (s.translation.id?.startsWith('translate-') ?? false)
  );
  const isTranscribing = useTaskStore(
    s =>
      !!s.transcription.inProgress &&
      (s.transcription.id?.startsWith('transcribe-') ?? false)
  );
  const mergeInProgress = useTaskStore(s => s.merge.inProgress);
  const isDubbing = useTaskStore(
    s => !!s.dubbing.inProgress && (s.dubbing.id?.startsWith('dub-') ?? false)
  );
  const download = useUrlStore(s => s.download);
  const { showCreditWarning } = useCreditSystem();

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

  // Log progress area visibility transitions (avoid duplicates)
  const prevTranscribingRef = useRef<boolean>(false);
  const prevTranslatingRef = useRef<boolean>(false);
  const prevMergingRef = useRef<boolean>(false);

  useEffect(() => {
    const prev = prevTranscribingRef.current;
    if (prev !== isTranscribing) {
      logProgress(isTranscribing ? 'open' : 'close', 'transcription');
      prevTranscribingRef.current = isTranscribing;
    }
  }, [isTranscribing]);

  useEffect(() => {
    const prev = prevTranslatingRef.current;
    if (prev !== isTranslating) {
      logProgress(isTranslating ? 'open' : 'close', 'translation');
      prevTranslatingRef.current = isTranslating;
    }
  }, [isTranslating]);

  useEffect(() => {
    const now = !!mergeInProgress;
    const prev = prevMergingRef.current;
    if (prev !== now) {
      logProgress(now ? 'open' : 'close', 'merge');
      prevMergingRef.current = now;
    }
  }, [mergeInProgress]);

  const handleCancelDownload = () => {
    if (!download.id) return;
    try {
      // Mark as cancelled immediately
      useUrlStore.getState().setDownload({
        inProgress: false,
        percent: 100,
        stage: 'Cancelled',
      });
      // Remove any lingering error message
      useUrlStore.getState().clearError();
    } catch {
      // Do nothing
    }
    OperationIPC.cancel(download.id!);
  };

  // Settings page rendered as its own scroll container for proper sticky header
  if (showSettings) {
    return (
      <>
        <div className={settingsPageWrapper}>
          <div className={settingsHeader}>
            <button
              className={settingsBackButton}
              onClick={() => {
                try {
                  logButton('close_settings');
                } catch {
                  // Ignore logging errors
                }
                useUIStore.getState().toggleSettings(false);
              }}
            >
              {t('common.backToApp')}
            </button>
          </div>
          <div className={containerStyles}>
            <SettingsPage />
          </div>
        </div>
        <GlobalModals />
      </>
    );
  }

  return (
    <div className={pageWrapperStyles}>
      {videoUrl && <div style={{ height: 'calc(35vh + 2rem)' }} />}

      <FindBar />

      <div className={containerStyles}>
        <Header />

        {/* Top-level credit warning banner */}
        {showCreditWarning && (
          <div style={{ marginBottom: '12px' }}>
            <CreditWarningBanner
              onSettingsClick={() => useUIStore.getState().toggleSettings(true)}
            />
          </div>
        )}

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

        {mergeInProgress && <MergingProgressArea />}

        {isTranscribing && <TranscriptionProgressArea />}

        {isTranslating && <TranslationProgressArea />}

        {isDubbing && <DubbingProgressArea />}

        <FloatingActionButtons />
      </div>
      <GlobalModals />
    </div>
  );
}
