import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useUIStore,
  useVideoStore,
  useTaskStore,
  useUpdateStore,
} from '../state';
import * as SystemIPC from '../ipc/system';
import * as SubtitlesIPC from '../ipc/subtitles';
import * as UpdateIPC from '../ipc/update';
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
import Button from '../components/Button';
import CreditWarningBanner from '../containers/GenerateSubtitles/components/CreditWarningBanner';
import ErrorBanner from '../components/ErrorBanner';
import { useCreditSystem } from '../containers/GenerateSubtitles/hooks/useCreditSystem';
import { useAiStore } from '../state';

import { css } from '@emotion/css';
import { pageWrapperStyles, containerStyles, colors } from '../styles';
import * as OperationIPC from '../ipc/operation';
import { logProgress, logButton, logError } from '../utils/logger';
import {
  isAbortLikeReason,
  isDisruptiveDownloadFailure,
  isDisruptiveGlobalError,
  isDisruptiveStage,
  shouldIgnoreGlobalBrowserError,
} from '../utils/disruptiveErrors';
import { useRef } from 'react';
import {
  openErrorReportPrompt,
  openRequiredUpdate,
  openUpdateNotes,
} from '../state/modal-store';

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

export default function AppContent() {
  const { t } = useTranslation();
  useEffect(() => {
    if (!window.env.isPackaged) return;

    let cancelled = false;
    void (async () => {
      try {
        const notice = await UpdateIPC.getPostInstallNotice();
        if (cancelled || !notice?.notes?.trim()) return;
        openUpdateNotes(notice);
      } catch (err) {
        console.warn('[AppContent] Failed to fetch post-install notes:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const surfaceRequiredUpdate = (payload: UpdateIPC.UpdateRequiredNotice) => {
      openRequiredUpdate(payload);
      if (window.env.isPackaged) {
        void useUpdateStore.getState().check();
      }
    };

    void (async () => {
      try {
        const notice = await UpdateIPC.getRequiredNotice();
        if (cancelled || !notice) return;
        surfaceRequiredUpdate(notice);
      } catch (err) {
        console.warn(
          '[AppContent] Failed to fetch required-update notice:',
          err
        );
      }
    })();

    const unsubscribe = UpdateIPC.onUpdateRequired(payload => {
      if (cancelled) return;
      surfaceRequiredUpdate(payload);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Initialize BYO/OpenAI state at app load so pills reflect "Using API Key"
  useEffect(() => {
    try {
      useAiStore.getState().initialize();
    } catch {
      // Ignore initialization errors
    }
  }, []);
  const showSettings = useUIStore(s => s.showSettings);
  const setDownload = useUrlStore(s => s.setDownload);
  const globalError = useUrlStore(s => s.error);
  const globalErrorKind = useUrlStore(s => s.errorKind);
  const clearGlobalError = useUrlStore(s => s.clearError);
  const videoUrl = useVideoStore(s => s.url);
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
  const transcriptionStage = useTaskStore(s => s.transcription.stage);
  const translationStage = useTaskStore(s => s.translation.stage);
  const dubbingStage = useTaskStore(s => s.dubbing.stage);
  const mergeStage = useTaskStore(s => s.merge.stage);
  const summaryStage = useTaskStore(s => s.summary.stage);
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

  // Auto-surface a report flow for disruptive failures.
  useEffect(() => {
    if (isDisruptiveGlobalError(globalError, globalErrorKind)) {
      openErrorReportPrompt();
    }
  }, [globalError, globalErrorKind]);

  useEffect(() => {
    if (isDisruptiveGlobalError(globalError, globalErrorKind)) return;
    if (
      isDisruptiveDownloadFailure({
        stage: download.stage,
        error: globalError,
        kind: globalErrorKind,
      })
    ) {
      openErrorReportPrompt();
    }
  }, [download.stage, globalError, globalErrorKind]);

  useEffect(() => {
    if (
      isDisruptiveStage(transcriptionStage) ||
      isDisruptiveStage(translationStage) ||
      isDisruptiveStage(dubbingStage) ||
      isDisruptiveStage(mergeStage) ||
      isDisruptiveStage(summaryStage)
    ) {
      openErrorReportPrompt();
    }
  }, [
    transcriptionStage,
    translationStage,
    dubbingStage,
    mergeStage,
    summaryStage,
  ]);

  useEffect(() => {
    const onError = (event: Event) => {
      if (shouldIgnoreGlobalBrowserError(event)) return;
      const errorEvent = event as ErrorEvent;
      logError('window.error', errorEvent.error || errorEvent.message, {
        filename: errorEvent.filename,
        lineno: errorEvent.lineno,
        colno: errorEvent.colno,
      });
      openErrorReportPrompt();
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      if (isAbortLikeReason((event as any)?.reason)) return;
      logError('window.unhandledrejection', (event as any)?.reason, {
        reasonType: typeof (event as any)?.reason,
      });
      openErrorReportPrompt();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandled);
    };
  }, []);

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
            <Button
              variant="secondary"
              size="sm"
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
            </Button>
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

        {globalError && (
          <div style={{ marginBottom: '12px' }}>
            <ErrorBanner
              message={globalError}
              onClose={() => clearGlobalError()}
            />
          </div>
        )}

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
          verticalOffsetPx={-13}
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
