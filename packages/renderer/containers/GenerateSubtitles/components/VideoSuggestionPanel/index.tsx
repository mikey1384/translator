import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import ErrorBanner from '../../../../components/ErrorBanner.js';
import {
  AI_MODEL_DISPLAY_NAMES,
  AI_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  normalizeAiModelId,
} from '../../../../../shared/constants';
import {
  getVideoSuggestionRecency,
  getVideoSuggestionPreferenceCreator,
  getVideoSuggestionPreferenceSubtopic,
  getVideoSuggestionPreferenceTopic,
  getVideoSuggestionTargetCountry,
  setVideoSuggestionRecency,
  setVideoSuggestionPreferenceCreator,
  setVideoSuggestionPreferenceSubtopic,
  setVideoSuggestionPreferenceTopic,
  setVideoSuggestionTargetCountry,
} from '../../../../ipc/system.js';
import { useAiStore } from '../../../../state/ai-store';
import {
  isVideoSuggestionRecency,
  sanitizeVideoSuggestionCountry,
  sanitizeVideoSuggestionPreference,
  sanitizeVideoSuggestionWebUrl,
} from '../../../../../shared/helpers/video-suggestion-sanitize.js';
import {
  panelErrorStyles,
  panelIntroMainStyles,
  panelStyles,
  panelStandaloneStyles,
  panelIntroCopyStyles,
  panelIntroPillAccentStyles,
  panelIntroPillRowStyles,
  panelIntroPillStyles,
  panelIntroStyles,
  panelIntroTitleStyles,
  resultsColumnStyles,
  resultsColumnCompactStyles,
  rightTabBodyStyles,
  technicalDetailsBodyStyles,
  technicalDetailsRowStyles,
  technicalDetailsStyles,
  technicalDetailsSummaryStyles,
  toggleButtonInnerStyles,
  toggleButtonStyles,
  toggleCopyStyles,
  toggleDescriptionStyles,
  toggleEyebrowRowStyles,
  toggleEyebrowStyles,
  toggleMetaPillAccentStyles,
  toggleMetaPillStyles,
  toggleMetaRowStyles,
  toggleTitleStyles,
  workspaceStyles,
  workspaceCompactStyles,
  wrapperStyles,
} from './VideoSuggestionPanel.styles.js';
import VideoSuggestionChatColumn from './VideoSuggestionChatColumn.js';
import VideoSuggestionLiveActivity from './VideoSuggestionLiveActivity.js';
import VideoSuggestionPreferencesForm from './VideoSuggestionPreferencesForm.js';
import VideoSuggestionResultsTab from './VideoSuggestionResultsTab.js';
import useVideoSuggestionFlow from './useVideoSuggestionFlow.js';
import {
  readLocalVideoSuggestionPrefs,
  writeLocalVideoSuggestionPrefs,
} from './video-suggestion-local-storage.js';
import {
  buildVideoMetaDetails as buildVideoMetaDetailsFromHelper,
  pipelineStageLabel,
  resolveErrorText,
  resolveI18n,
  resolvePreferredLanguageName,
} from './video-suggestion-helpers.js';
import type {
  VideoSuggestionPreferenceSlots,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';

interface VideoSuggestionPanelProps {
  disabled: boolean;
  hideToggle?: boolean;
  initialOpen?: boolean;
  isDownloadInProgress: boolean;
  onDownload: (item: VideoSuggestionResultItem) => Promise<unknown> | unknown;
  primaryActionLabel?: string;
}

const VIDEO_SUGGESTION_SOURCE_LABEL = 'YouTube';

export default function VideoSuggestionPanel({
  disabled,
  hideToggle = false,
  initialOpen = false,
  isDownloadInProgress,
  onDownload,
  primaryActionLabel,
}: VideoSuggestionPanelProps) {
  const { t, i18n } = useTranslation();
  const modelPreference = useAiStore(s => s.videoSuggestionModelPreference);
  const [open, setOpen] = useState(() => hideToggle || initialOpen);
  const [targetCountry, setTargetCountry] = useState('');
  const [targetRecency, setTargetRecency] =
    useState<VideoSuggestionRecency>('any');
  const [savedPrefTopic, setSavedPrefTopic] = useState('');
  const [savedPrefCreator, setSavedPrefCreator] = useState('');
  const [savedPrefSubtopic, setSavedPrefSubtopic] = useState('');
  const [activePrefTopic, setActivePrefTopic] = useState('');
  const [activePrefCreator, setActivePrefCreator] = useState('');
  const [activePrefSubtopic, setActivePrefSubtopic] = useState('');
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const composingRef = useRef(false);
  const restoredSessionRef = useRef(false);
  const preferredLanguage = i18n.resolvedLanguage || i18n.language || 'en';
  const preferredLanguageName = useMemo(
    () => resolvePreferredLanguageName(preferredLanguage),
    [preferredLanguage]
  );

  const modelLabel = useMemo(() => {
    switch (modelPreference) {
      case AI_MODELS.GPT:
        return t('settings.byoPreferences.gpt', 'GPT-5.1');
      case STAGE5_REVIEW_TRANSLATION_MODEL:
        return t('settings.byoPreferences.gptHigh', 'GPT-5.4');
      case AI_MODELS.CLAUDE_SONNET:
        return t('settings.byoPreferences.claudeSonnet', 'Claude Sonnet');
      case AI_MODELS.CLAUDE_OPUS:
        return t('settings.byoPreferences.claudeOpus', 'Claude Opus');
      case 'quality':
        return t(
          'settings.performanceQuality.videoSuggestionModel.quality',
          'Quality (same as translation quality)'
        );
      default:
        return t(
          'settings.performanceQuality.videoSuggestionModel.default',
          'Default (same as translation default)'
        );
    }
  }, [modelPreference, t]);

  const preferredCountry = useMemo(
    () => sanitizeVideoSuggestionCountry(targetCountry),
    [targetCountry]
  );
  const savedTopic = useMemo(
    () => sanitizeVideoSuggestionPreference(savedPrefTopic),
    [savedPrefTopic]
  );
  const savedCreator = useMemo(
    () => sanitizeVideoSuggestionPreference(savedPrefCreator),
    [savedPrefCreator]
  );
  const savedSubtopic = useMemo(
    () => sanitizeVideoSuggestionPreference(savedPrefSubtopic),
    [savedPrefSubtopic]
  );
  const savedPreferenceSlots = useMemo<VideoSuggestionPreferenceSlots>(
    () => ({
      topic: savedTopic || undefined,
      creator: savedCreator || undefined,
      subtopic: savedSubtopic || undefined,
    }),
    [savedCreator, savedSubtopic, savedTopic]
  );
  const requestPreferenceSlots = useMemo<VideoSuggestionPreferenceSlots>(
    () => ({
      topic: sanitizeVideoSuggestionPreference(activePrefTopic) || undefined,
      creator:
        sanitizeVideoSuggestionPreference(activePrefCreator) || undefined,
      subtopic:
        sanitizeVideoSuggestionPreference(activePrefSubtopic) || undefined,
    }),
    [activePrefCreator, activePrefSubtopic, activePrefTopic]
  );
  const applyCapturedPreferences = useCallback(
    (captured: VideoSuggestionPreferenceSlots | undefined) => {
      if (!captured) return;
      const topic = sanitizeVideoSuggestionPreference(captured.topic);
      const creator = sanitizeVideoSuggestionPreference(captured.creator);
      const subtopic = sanitizeVideoSuggestionPreference(captured.subtopic);
      if (topic) {
        setSavedPrefTopic(topic);
        setActivePrefTopic(topic);
      }
      if (creator) {
        setSavedPrefCreator(creator);
        setActivePrefCreator(creator);
      }
      if (subtopic) {
        setSavedPrefSubtopic(subtopic);
        setActivePrefSubtopic(subtopic);
      }
    },
    []
  );
  const {
    activeTraceLines,
    cancelSearch,
    cancelling,
    clearedStageCount,
    error,
    input,
    loading,
    loadingElapsedSec,
    loadingMessage,
    loadingMode,
    messages,
    pipelineStages,
    resolvedModelRuntime,
    results,
    runningStage,
    showQuickStartAction,
    searchMore,
    searchQuery,
    resetChat,
    sendMessage,
    setError,
    setInput,
    showLiveActivity,
    streamingPreview,
    runQuickStartSearch,
  } = useVideoSuggestionFlow({
    modelPreference,
    onCapturePreferences: applyCapturedPreferences,
    onResultsReady: () => {},
    open,
    preferredCountry,
    preferredLanguage,
    preferredLanguageName,
    preferredRecency: targetRecency,
    prefsLoaded,
    requestPreferences: requestPreferenceSlots,
    savedPreferences: savedPreferenceSlots,
    t,
  });
  const resolvedModelRuntimeLabel = useMemo(() => {
    const runtimeModel = resolvedModelRuntime?.trim();
    if (!runtimeModel) return null;
    const normalized = normalizeAiModelId(runtimeModel);
    if (AI_MODEL_DISPLAY_NAMES[normalized]) {
      return AI_MODEL_DISPLAY_NAMES[normalized];
    }
    return runtimeModel;
  }, [resolvedModelRuntime]);
  const displayModelLabel = resolvedModelRuntimeLabel || modelLabel;
  const resolvedPrimaryActionLabel =
    primaryActionLabel ||
    t('input.videoSuggestion.downloadThis', 'Download this');
  const showLiveActivityPanel = showLiveActivity;
  const isIdleWorkspace = useMemo(
    () =>
      !loading &&
      results.length === 0 &&
      !searchQuery.trim() &&
      messages.length <= 1 &&
      !showLiveActivityPanel,
    [
      loading,
      messages.length,
      results.length,
      searchQuery,
      showLiveActivityPanel,
    ]
  );

  const buildPreferenceOverrideOptions = useCallback(
    (currentValue: string): Array<{ value: string; label: string }> => {
      const normalized = sanitizeVideoSuggestionPreference(currentValue);
      if (!normalized) return [];
      return [
        {
          value: '',
          label: t(
            'input.videoSuggestion.preference.noneForSearch',
            'No preference for this search'
          ),
        },
        {
          value: normalized,
          label: t(
            'input.videoSuggestion.preference.useSavedValue',
            'Use saved: {{value}}',
            {
              value: normalized,
            }
          ),
        },
      ];
    },
    [t]
  );

  const canRemoveSavedTopic = Boolean(savedTopic);
  const canRemoveSavedCreator = Boolean(savedCreator);
  const canRemoveSavedSubtopic = Boolean(savedSubtopic);

  const topicSelectOptions = useMemo(
    () => buildPreferenceOverrideOptions(savedTopic),
    [buildPreferenceOverrideOptions, savedTopic]
  );
  const creatorSelectOptions = useMemo(
    () => buildPreferenceOverrideOptions(savedCreator),
    [buildPreferenceOverrideOptions, savedCreator]
  );
  const subtopicSelectOptions = useMemo(
    () => buildPreferenceOverrideOptions(savedSubtopic),
    [buildPreferenceOverrideOptions, savedSubtopic]
  );

  const recencyOptions = useMemo(
    () =>
      [
        {
          value: 'any',
          label: t(
            'input.videoSuggestion.recencyAny',
            'Any time (including older videos)'
          ),
        },
        {
          value: 'day',
          label: t('input.videoSuggestion.recencyDay', 'Last 24 hours'),
        },
        {
          value: 'week',
          label: t('input.videoSuggestion.recencyWeek', 'Last 7 days'),
        },
        {
          value: 'month',
          label: t('input.videoSuggestion.recencyMonth', 'Last 30 days'),
        },
        {
          value: 'year',
          label: t('input.videoSuggestion.recencyYear', 'Last year'),
        },
      ] as Array<{ value: VideoSuggestionRecency; label: string }>,
    [t]
  );
  const selectedRecencyLabel = useMemo(
    () =>
      recencyOptions.find(option => option.value === targetRecency)?.label ||
      t(
        'input.videoSuggestion.recencyAny',
        'Any time (including older videos)'
      ),
    [recencyOptions, t, targetRecency]
  );
  const countryScopeLabel = useMemo(
    () =>
      preferredCountry
        ? t('input.videoSuggestion.countryScope', 'Country: {{country}}', {
            country: preferredCountry,
          })
        : t('input.videoSuggestion.countryGlobal', 'Global results'),
    [preferredCountry, t]
  );
  const savedPreferenceCount = useMemo(
    () => [savedTopic, savedCreator, savedSubtopic].filter(Boolean).length,
    [savedCreator, savedSubtopic, savedTopic]
  );
  const savedPreferenceLabel = useMemo(
    () =>
      savedPreferenceCount > 0
        ? t(
            'input.videoSuggestion.savedPreferencesCount',
            '{{count}} saved preferences',
            {
              count: savedPreferenceCount,
            }
          )
        : null,
    [savedPreferenceCount, t]
  );
  const resultsReadyLabel = useMemo(
    () =>
      results.length > 0
        ? t('input.videoSuggestion.resultsReadyCount', '{{count}} ready', {
            count: results.length,
          })
        : null,
    [results.length, t]
  );

  useEffect(() => {
    let cancelled = false;
    const localPrefs = readLocalVideoSuggestionPrefs();
    setTargetCountry(localPrefs.country);
    setTargetRecency(localPrefs.recency);
    const localTopic = sanitizeVideoSuggestionPreference(
      localPrefs.preferences.topic
    );
    const localCreator = sanitizeVideoSuggestionPreference(
      localPrefs.preferences.creator
    );
    const localSubtopic = sanitizeVideoSuggestionPreference(
      localPrefs.preferences.subtopic
    );
    setSavedPrefTopic(localTopic);
    setSavedPrefCreator(localCreator);
    setSavedPrefSubtopic(localSubtopic);
    setActivePrefTopic(localTopic);
    setActivePrefCreator(localCreator);
    setActivePrefSubtopic(localSubtopic);

    Promise.all([
      getVideoSuggestionTargetCountry(),
      getVideoSuggestionRecency(),
      getVideoSuggestionPreferenceTopic(),
      getVideoSuggestionPreferenceCreator(),
      getVideoSuggestionPreferenceSubtopic(),
    ])
      .then(([country, recency, topic, creator, subtopic]) => {
        if (cancelled) return;
        const safeCountry = sanitizeVideoSuggestionCountry(
          String(country || localPrefs.country || '')
        );
        const safeRecency = isVideoSuggestionRecency(recency)
          ? recency
          : localPrefs.recency;
        const safeTopic = sanitizeVideoSuggestionPreference(
          String(topic || localPrefs.preferences.topic || '')
        );
        const safeCreator = sanitizeVideoSuggestionPreference(
          String(creator || localPrefs.preferences.creator || '')
        );
        const safeSubtopic = sanitizeVideoSuggestionPreference(
          String(subtopic || localPrefs.preferences.subtopic || '')
        );
        setTargetCountry(safeCountry);
        setTargetRecency(safeRecency);
        setSavedPrefTopic(safeTopic);
        setSavedPrefCreator(safeCreator);
        setSavedPrefSubtopic(safeSubtopic);
        setActivePrefTopic(safeTopic);
        setActivePrefCreator(safeCreator);
        setActivePrefSubtopic(safeSubtopic);
      })
      .catch(() => {
        if (cancelled) return;
      })
      .finally(() => {
        if (cancelled) return;
        setPrefsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    const sanitized = sanitizeVideoSuggestionCountry(targetCountry);
    writeLocalVideoSuggestionPrefs({ country: sanitized });
    const timer = window.setTimeout(() => {
      void setVideoSuggestionTargetCountry(sanitized).catch(() => void 0);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [prefsLoaded, targetCountry]);

  useEffect(() => {
    if (!prefsLoaded) return;
    writeLocalVideoSuggestionPrefs({ recency: targetRecency });
    void setVideoSuggestionRecency(targetRecency).catch(() => void 0);
  }, [prefsLoaded, targetRecency]);

  useEffect(() => {
    if (!prefsLoaded) return;
    const topic = sanitizeVideoSuggestionPreference(savedPrefTopic);
    const creator = sanitizeVideoSuggestionPreference(savedPrefCreator);
    const subtopic = sanitizeVideoSuggestionPreference(savedPrefSubtopic);
    writeLocalVideoSuggestionPrefs({
      preferences: { topic, creator, subtopic },
    });
    void setVideoSuggestionPreferenceTopic(topic).catch(() => void 0);
    void setVideoSuggestionPreferenceCreator(creator).catch(() => void 0);
    void setVideoSuggestionPreferenceSubtopic(subtopic).catch(() => void 0);
  }, [prefsLoaded, savedPrefCreator, savedPrefSubtopic, savedPrefTopic]);

  const normalizePreferenceSelection = (value: string): string => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return sanitizeVideoSuggestionPreference(normalized);
  };

  const openVideoExternally = async (url: string) => {
    try {
      await window.appShell.openExternal(url);
    } catch (err: any) {
      setError(
        resolveErrorText(
          err?.message,
          t(
            'input.videoSuggestion.openFailed',
            'Failed to open YouTube video link'
          ),
          t
        )
      );
    }
  };

  const openChannelExternally = async (
    channelUrl?: string,
    channelName?: string
  ) => {
    const direct = sanitizeVideoSuggestionWebUrl(channelUrl);
    const fallbackChannel = String(channelName || '').trim();
    const targetUrl =
      direct ||
      (fallbackChannel
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(fallbackChannel)}`
        : '');
    if (!targetUrl) {
      setError(
        t(
          'input.videoSuggestion.channelUnavailable',
          'Channel link is not available for this item.'
        )
      );
      return;
    }
    try {
      await window.appShell.openExternal(targetUrl);
    } catch (err: any) {
      setError(
        resolveErrorText(
          err?.message,
          t(
            'input.videoSuggestion.openChannelFailed',
            'Failed to open YouTube channel'
          ),
          t
        )
      );
    }
  };

  const downloadFromSuggestion = async (item: VideoSuggestionResultItem) => {
    try {
      await onDownload(item);
    } catch (err: any) {
      setError(
        resolveErrorText(
          err?.message,
          t('input.videoSuggestion.downloadFailed', 'Download failed'),
          t
        )
      );
    }
  };

  const getVideoMetaDetails = useCallback(
    (item: VideoSuggestionResultItem): string[] =>
      buildVideoMetaDetailsFromHelper(item, preferredLanguage, t),
    [preferredLanguage, t]
  );

  const handleMessageInputKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>
  ) => {
    // Keep IME composition smooth (Korean/Japanese/Chinese):
    // Enter should confirm composition first, not submit.
    if (
      composingRef.current ||
      (event.nativeEvent as KeyboardEvent).isComposing ||
      event.keyCode === 229
    ) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const resetChatDisabled =
    !input.trim() &&
    !searchQuery.trim() &&
    messages.length === 0 &&
    results.length === 0;

  useEffect(() => {
    if (hideToggle) {
      setOpen(true);
    }
  }, [hideToggle]);

  useEffect(() => {
    if (hideToggle || restoredSessionRef.current) return;
    restoredSessionRef.current = true;

    const hasRestorableSession =
      loading ||
      searchQuery.trim().length > 0 ||
      results.length > 0 ||
      messages.length > 1 ||
      pipelineStages.some(
        stage => stage.state !== 'pending' || stage.outcome.trim().length > 0
      );

    if (hasRestorableSession) {
      setOpen(true);
    }
  }, [hideToggle, loading, messages.length, pipelineStages, results.length, searchQuery]);

  return (
    <div className={wrapperStyles}>
      {!hideToggle ? (
        <button
          type="button"
          className={toggleButtonStyles}
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
        >
          <div className={toggleButtonInnerStyles}>
            <div className={toggleEyebrowRowStyles}>
              <div className={toggleEyebrowStyles}>
                {t(
                  'input.videoSuggestion.aiVideoRecommendation',
                  'AI video recommendation'
                )}
              </div>
              <div className={toggleMetaRowStyles}>
                {resultsReadyLabel ? (
                  <div className={toggleMetaPillAccentStyles}>
                    {resultsReadyLabel}
                  </div>
                ) : null}
              </div>
            </div>
            <div className={toggleCopyStyles}>
              <div className={toggleTitleStyles}>
                {open
                  ? t('input.videoSuggestion.hide', 'Hide video suggestions')
                  : t('input.videoSuggestion.show', 'Suggest me a video')}
              </div>
              <p className={toggleDescriptionStyles}>
                {t(
                  'input.videoSuggestion.toggleCopy',
                  'Search YouTube for a source video without leaving the workflow.'
                )}
              </p>
            </div>
            <div className={toggleMetaRowStyles}>
              <div className={toggleMetaPillAccentStyles}>
                {VIDEO_SUGGESTION_SOURCE_LABEL}
              </div>
              <div className={toggleMetaPillStyles}>{displayModelLabel}</div>
              <div className={toggleMetaPillStyles}>{countryScopeLabel}</div>
              {targetRecency !== 'any' ? (
                <div className={toggleMetaPillStyles}>
                  {selectedRecencyLabel}
                </div>
              ) : null}
            </div>
          </div>
        </button>
      ) : null}

      {(hideToggle || open) && (
        <div className={cx(panelStyles, hideToggle && panelStandaloneStyles)}>
          <div className={panelIntroStyles}>
            <div className={panelIntroMainStyles}>
              <div className={panelIntroTitleStyles}>
                {t(
                  'input.videoSuggestion.introTitle',
                  'Describe the kind of video you want.'
                )}
              </div>
              <div className={panelIntroCopyStyles}>
                {t(
                  'input.videoSuggestion.introCopy',
                  'Start with a topic, mood, creator, or audience. Add country or recency only if it matters.'
                )}
              </div>
              <div className={panelIntroPillRowStyles}>
                <div className={panelIntroPillAccentStyles}>
                  {VIDEO_SUGGESTION_SOURCE_LABEL}
                </div>
                <div className={panelIntroPillStyles}>{displayModelLabel}</div>
                <div className={panelIntroPillStyles}>{countryScopeLabel}</div>
                {targetRecency !== 'any' ? (
                  <div className={panelIntroPillStyles}>
                    {selectedRecencyLabel}
                  </div>
                ) : null}
                {savedPreferenceLabel ? (
                  <div className={panelIntroPillStyles}>
                    {savedPreferenceLabel}
                  </div>
                ) : null}
              </div>
            </div>

            <details className={technicalDetailsStyles}>
              <summary className={technicalDetailsSummaryStyles}>
                {t('input.videoSuggestion.searchDetails', 'Search details')}
              </summary>
              <div className={technicalDetailsBodyStyles}>
                <div className={technicalDetailsRowStyles}>
                  {t('input.videoSuggestion.modelHint', 'Current model')}:{' '}
                  {displayModelLabel}
                </div>
                <div className={technicalDetailsRowStyles}>
                  {t('input.videoSuggestion.sourceHint', 'Search source')}:{' '}
                  {VIDEO_SUGGESTION_SOURCE_LABEL}
                </div>
                <div className={technicalDetailsRowStyles}>
                  {t('input.videoSuggestion.languageHint', 'Output language')}:{' '}
                  {preferredLanguageName}
                </div>
              </div>
            </details>
          </div>

          <VideoSuggestionPreferencesForm
            canRemoveSavedCreator={canRemoveSavedCreator}
            canRemoveSavedSubtopic={canRemoveSavedSubtopic}
            canRemoveSavedTopic={canRemoveSavedTopic}
            creatorSelectOptions={creatorSelectOptions}
            disabled={disabled}
            loading={loading}
            onCreatorChange={value => {
              setActivePrefCreator(normalizePreferenceSelection(value));
            }}
            onRemoveSavedCreator={() => {
              setSavedPrefCreator('');
              setActivePrefCreator('');
            }}
            onCountryBlur={value => {
              setTargetCountry(sanitizeVideoSuggestionCountry(value));
            }}
            onCountryChange={setTargetCountry}
            onRecencyChange={setTargetRecency}
            onRemoveSavedSubtopic={() => {
              setSavedPrefSubtopic('');
              setActivePrefSubtopic('');
            }}
            onRemoveSavedTopic={() => {
              setSavedPrefTopic('');
              setActivePrefTopic('');
            }}
            onSubtopicChange={value => {
              setActivePrefSubtopic(normalizePreferenceSelection(value));
            }}
            onTopicChange={value => {
              setActivePrefTopic(normalizePreferenceSelection(value));
            }}
            recencyOptions={recencyOptions}
            sanitizedCreator={
              sanitizeVideoSuggestionPreference(activePrefCreator) || ''
            }
            sanitizedSubtopic={
              sanitizeVideoSuggestionPreference(activePrefSubtopic) || ''
            }
            sanitizedTopic={
              sanitizeVideoSuggestionPreference(activePrefTopic) || ''
            }
            subtopicSelectOptions={subtopicSelectOptions}
            t={t}
            targetCountry={targetCountry}
            targetRecency={targetRecency}
            topicSelectOptions={topicSelectOptions}
          />

          <div
            className={cx(
              workspaceStyles,
              isIdleWorkspace && workspaceCompactStyles
            )}
          >
            <VideoSuggestionChatColumn
              cancelling={cancelling}
              compact={isIdleWorkspace}
              disabled={disabled}
              loading={loading}
              input={input}
              messages={messages}
              loadingElapsedSec={loadingElapsedSec}
              loadingMessage={loadingMessage}
              runningStage={runningStage}
              streamingPreview={streamingPreview}
              t={t}
              onInputChange={setInput}
              onInputCompositionStart={() => {
                composingRef.current = true;
              }}
              onInputCompositionEnd={() => {
                composingRef.current = false;
              }}
              onInputKeyDown={handleMessageInputKeyDown}
              onCancelSearch={() => {
                void cancelSearch();
              }}
              onResetChat={() => {
                resetChat();
              }}
              onSend={() => void sendMessage()}
              onUseQuickStart={() => {
                void runQuickStartSearch();
              }}
              resetDisabled={resetChatDisabled}
              showQuickStartAction={showQuickStartAction}
              resolveI18n={text => resolveI18n(text, t)}
              pipelineStageLabel={key => pipelineStageLabel(key, t)}
            />

            <div
              className={cx(
                resultsColumnStyles,
                isIdleWorkspace && resultsColumnCompactStyles
              )}
            >
              <div className={rightTabBodyStyles}>
                {showLiveActivityPanel ? (
                  <VideoSuggestionLiveActivity
                    activeTraceLines={activeTraceLines}
                    clearedStageCount={clearedStageCount}
                    hasResults={results.length > 0}
                    hidden={false}
                    loading={loading}
                    loadingElapsedSec={loadingElapsedSec}
                    loadingMessage={loadingMessage}
                    pipelineStages={pipelineStages}
                    runningStage={runningStage}
                    searchQuery={searchQuery}
                    t={t}
                    pipelineStageLabel={key => pipelineStageLabel(key, t)}
                  />
                ) : null}
                <VideoSuggestionResultsTab
                  disabled={disabled}
                  primaryActionLabel={resolvedPrimaryActionLabel}
                  isDownloadInProgress={isDownloadInProgress}
                  loading={loading}
                  loadingMode={loadingMode}
                  results={results}
                  searchQuery={searchQuery}
                  t={t}
                  buildVideoMetaDetails={getVideoMetaDetails}
                  onDownloadFromSuggestion={item => {
                    void downloadFromSuggestion(item);
                  }}
                  onOpenChannelExternally={(channelUrl, channelName) => {
                    void openChannelExternally(channelUrl, channelName);
                  }}
                  onOpenVideoExternally={url => {
                    void openVideoExternally(url);
                  }}
                  onSearchMore={() => {
                    void searchMore();
                  }}
                />
              </div>
            </div>
          </div>

          {error && (
            <div className={panelErrorStyles}>
              <ErrorBanner message={error} onClose={() => setError(null)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
