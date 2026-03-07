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
import { useUIStore, useVideoStore } from '../../../../state';
import { useAiStore } from '../../../../state/ai-store';
import {
  isVideoSuggestionRecency,
  sanitizeVideoSuggestionCountry,
  sanitizeVideoSuggestionHistoryPath,
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
  rightTabButtonActiveStyles,
  rightTabButtonStyles,
  rightTabsStyles,
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
import VideoSuggestionChannelsTab from './VideoSuggestionChannelsTab.js';
import VideoSuggestionChatColumn from './VideoSuggestionChatColumn.js';
import VideoSuggestionHistoryTab from './VideoSuggestionHistoryTab.js';
import VideoSuggestionLiveActivity from './VideoSuggestionLiveActivity.js';
import VideoSuggestionPreferencesForm from './VideoSuggestionPreferencesForm.js';
import VideoSuggestionResultsTab from './VideoSuggestionResultsTab.js';
import useVideoSuggestionFlow from './useVideoSuggestionFlow.js';
import {
  MAX_HISTORY_ITEMS,
  readLocalVideoSuggestionActiveTab,
  readLocalVideoSuggestionHiddenChannels,
  readLocalVideoSuggestionHistory,
  readLocalVideoSuggestionPrefs,
  writeLocalVideoSuggestionActiveTab,
  writeLocalVideoSuggestionHiddenChannels,
  writeLocalVideoSuggestionHistory,
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
  SuggestionViewTab,
  VideoSuggestionDownloadHistoryItem,
} from './VideoSuggestionPanel.types.js';
import type {
  ProcessUrlResult,
  VideoSuggestionPreferenceSlots,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';

interface VideoSuggestionPanelProps {
  disabled: boolean;
  hideToggle?: boolean;
  initialOpen?: boolean;
  isDownloadInProgress: boolean;
  localPrimaryActionLabel?: string;
  onDownload: (
    item: VideoSuggestionResultItem
  ) => Promise<ProcessUrlResult | void> | ProcessUrlResult | void;
  onOpenDownloadedVideo?: (
    item: VideoSuggestionDownloadHistoryItem
  ) => Promise<void> | void;
  primaryActionLabel?: string;
}

const VIDEO_SUGGESTION_SOURCE_LABEL = 'YouTube';

export default function VideoSuggestionPanel({
  disabled,
  hideToggle = false,
  initialOpen = false,
  isDownloadInProgress,
  localPrimaryActionLabel,
  onDownload,
  onOpenDownloadedVideo,
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
  const [downloadHistory, setDownloadHistory] = useState<
    VideoSuggestionDownloadHistoryItem[]
  >(() => readLocalVideoSuggestionHistory());
  const [hiddenChannelKeys, setHiddenChannelKeys] = useState<string[]>(() =>
    readLocalVideoSuggestionHiddenChannels()
  );
  const [playablePathMap, setPlayablePathMap] = useState<
    Record<string, boolean>
  >({});
  const [activeRightTab, setActiveRightTab] = useState<SuggestionViewTab>(() =>
    readLocalVideoSuggestionActiveTab()
  );
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const composingRef = useRef(false);
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
    onResultsReady: () => {
      setActiveRightTab('results');
    },
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
  const resolvedLocalPrimaryActionLabel =
    localPrimaryActionLabel || t('input.videoSuggestion.playLocal', 'Play');
  const recentDownloadedChannels = useMemo(
    () =>
      downloadHistory
        .filter(item => Boolean(item.channelUrl) || Boolean(item.channel))
        .reduce<
          Array<{
            key: string;
            name: string;
            channelUrl?: string;
            downloadedAtIso: string;
          }>
        >((acc, item) => {
          const channelUrl = sanitizeVideoSuggestionWebUrl(item.channelUrl);
          const fallbackName = String(item.channel || '').trim();
          const key = (channelUrl || fallbackName.toLowerCase()).trim();
          if (!key) return acc;
          if (hiddenChannelKeys.includes(key.toLowerCase())) return acc;
          if (acc.some(existing => existing.key === key)) return acc;
          acc.push({
            key,
            name:
              fallbackName ||
              t('input.videoSuggestion.unknownChannel', 'Unknown channel'),
            channelUrl: channelUrl || undefined,
            downloadedAtIso: item.downloadedAtIso,
          });
          return acc;
        }, [])
        .slice(0, 8),
    [downloadHistory, hiddenChannelKeys, t]
  );
  const rightTabs = useMemo(
    () =>
      [
        {
          key: 'results' as const,
          label: t('input.videoSuggestion.tabResults', 'Results'),
        },
        {
          key: 'history' as const,
          label: t('input.videoSuggestion.tabHistory', 'Download history'),
        },
        {
          key: 'channels' as const,
          label: t('input.videoSuggestion.tabChannels', 'Channels'),
        },
      ] satisfies Array<{ key: SuggestionViewTab; label: string }>,
    [t]
  );
  const showLiveActivityPanel = showLiveActivity;
  const liveActivityHidden = activeRightTab !== 'results';
  const isIdleWorkspace = useMemo(
    () =>
      !loading &&
      activeRightTab === 'results' &&
      results.length === 0 &&
      !searchQuery.trim() &&
      messages.length <= 1 &&
      !showLiveActivityPanel,
    [
      activeRightTab,
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
  const savedDownloadsLabel = useMemo(
    () =>
      downloadHistory.length > 0
        ? t(
            'input.videoSuggestion.savedDownloadsCount',
            '{{count}} saved downloads',
            {
              count: downloadHistory.length,
            }
          )
        : null,
    [downloadHistory.length, t]
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

  useEffect(() => {
    writeLocalVideoSuggestionHistory(downloadHistory);
  }, [downloadHistory]);

  useEffect(() => {
    writeLocalVideoSuggestionActiveTab(activeRightTab);
  }, [activeRightTab]);

  useEffect(() => {
    writeLocalVideoSuggestionHiddenChannels(hiddenChannelKeys);
  }, [hiddenChannelKeys]);

  useEffect(() => {
    let cancelled = false;
    const refreshPlayableState = async () => {
      const itemsWithPath = downloadHistory.filter(item =>
        Boolean(item.localPath)
      );
      if (itemsWithPath.length === 0) {
        if (!cancelled) {
          setPlayablePathMap({});
        }
        return;
      }
      const checks = await Promise.all(
        itemsWithPath.map(async item => {
          const path = item.localPath || '';
          try {
            const exists = await window.fileApi.fileExists(path);
            return [item.id, Boolean(exists)] as const;
          } catch {
            return [item.id, false] as const;
          }
        })
      );
      if (cancelled) return;
      const nextMap: Record<string, boolean> = {};
      for (const [id, exists] of checks) {
        nextMap[id] = exists;
      }
      setPlayablePathMap(nextMap);
    };
    void refreshPlayableState();
    return () => {
      cancelled = true;
    };
  }, [downloadHistory]);

  const normalizePreferenceSelection = (value: string): string => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return sanitizeVideoSuggestionPreference(normalized);
  };

  const buildYouTubeSearchUrl = useCallback((query: string): string => {
    const encoded = encodeURIComponent(query);
    return `https://www.youtube.com/results?search_query=${encoded}`;
  }, []);

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
      direct || (fallbackChannel ? buildYouTubeSearchUrl(fallbackChannel) : '');
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

  const extractDownloadedPath = (
    result: ProcessUrlResult | void
  ): string | null => {
    if (!result) return null;
    const videoPath =
      typeof result.videoPath === 'string' ? result.videoPath.trim() : '';
    if (videoPath) return sanitizeVideoSuggestionHistoryPath(videoPath);
    const filePath =
      typeof result.filePath === 'string' ? result.filePath.trim() : '';
    if (filePath) return sanitizeVideoSuggestionHistoryPath(filePath);
    return null;
  };

  const appendDownloadHistory = (
    item: VideoSuggestionResultItem,
    localPath: string
  ) => {
    const nextItem: VideoSuggestionDownloadHistoryItem = {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceUrl: item.url,
      title: (item.title || item.url).trim(),
      thumbnailUrl: item.thumbnailUrl || undefined,
      channel: item.channel || undefined,
      channelUrl: sanitizeVideoSuggestionWebUrl(item.channelUrl) || undefined,
      durationSec: item.durationSec,
      uploadedAt: item.uploadedAt || undefined,
      downloadedAtIso: new Date().toISOString(),
      localPath,
    };
    setDownloadHistory(prev => {
      const filtered = prev.filter(
        entry =>
          entry.sourceUrl !== nextItem.sourceUrl &&
          (!nextItem.localPath || entry.localPath !== nextItem.localPath)
      );
      return [nextItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
    });
  };

  const downloadFromSuggestion = async (item: VideoSuggestionResultItem) => {
    try {
      const result = await onDownload(item);
      if (result?.cancelled || !result?.success) return;
      const localPath = extractDownloadedPath(result);
      if (!localPath) return;
      appendDownloadHistory(item, localPath);
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

  const openDownloadedVideo = async (
    item: VideoSuggestionDownloadHistoryItem
  ) => {
    if (onOpenDownloadedVideo) {
      await onOpenDownloadedVideo(item);
      return;
    }
    const filePath = sanitizeVideoSuggestionHistoryPath(item.localPath);
    if (!filePath) {
      setError(
        t(
          'input.videoSuggestion.missingLocalFile',
          'Local file path is missing for this history item.'
        )
      );
      return;
    }
    try {
      const exists = await window.fileApi.fileExists(filePath);
      setPlayablePathMap(prev => ({
        ...prev,
        [item.id]: exists,
      }));
      if (!exists) {
        setError(
          t(
            'input.videoSuggestion.downloadedFileMissing',
            'The local file is no longer available at its saved path.'
          )
        );
        return;
      }
      const fallbackName =
        filePath.split(/[\\/]/).pop() || item.title || 'video';
      await useVideoStore
        .getState()
        .setFile({ name: fallbackName, path: filePath });
      useUIStore.getState().setInputMode('file');
    } catch (err: any) {
      setError(
        resolveErrorText(
          err?.message,
          t(
            'input.videoSuggestion.cannotOpenDownloadedFile',
            'Could not open downloaded file.'
          ),
          t
        )
      );
    }
  };

  const redownloadHistoryItem = async (
    historyItem: VideoSuggestionDownloadHistoryItem
  ) => {
    const asSuggestion: VideoSuggestionResultItem = {
      id: historyItem.id,
      url: historyItem.sourceUrl,
      title: historyItem.title,
      thumbnailUrl: historyItem.thumbnailUrl,
      channel: historyItem.channel,
      channelUrl: historyItem.channelUrl,
      durationSec: historyItem.durationSec,
      uploadedAt: historyItem.uploadedAt,
    };
    await downloadFromSuggestion(asSuggestion);
  };

  const removeHistoryItem = useCallback((id: string) => {
    setDownloadHistory(prev => prev.filter(item => item.id !== id));
    setPlayablePathMap(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const removeChannelHistoryItem = useCallback((key: string) => {
    const normalized = String(key || '')
      .trim()
      .toLowerCase();
    if (!normalized) return;
    setHiddenChannelKeys(prev => {
      if (prev.includes(normalized)) return prev;
      return [normalized, ...prev].slice(0, 80);
    });
  }, []);

  const formatHistoryTimestamp = (iso: string): string => {
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return '';
    return new Intl.DateTimeFormat(preferredLanguage || 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(parsed));
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

  return (
    <div className={wrapperStyles}>
      {!hideToggle ? (
        <button
          type="button"
          className={toggleButtonStyles}
          onClick={() => setOpen(v => !v)}
          disabled={disabled}
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
                {savedDownloadsLabel ? (
                  <div className={toggleMetaPillStyles}>
                    {savedDownloadsLabel}
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
                <div className={technicalDetailsRowStyles}>
                  {t('input.videoSuggestion.savedDownloads', 'Saved downloads')}
                  : {downloadHistory.length}
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
              <div className={rightTabsStyles}>
                {rightTabs.map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`${rightTabButtonStyles} ${
                      activeRightTab === tab.key
                        ? rightTabButtonActiveStyles
                        : ''
                    }`}
                    onClick={() => setActiveRightTab(tab.key)}
                    disabled={disabled}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className={rightTabBodyStyles}>
                {showLiveActivityPanel ? (
                  <VideoSuggestionLiveActivity
                    activeTraceLines={activeTraceLines}
                    clearedStageCount={clearedStageCount}
                    hidden={liveActivityHidden}
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

                {activeRightTab === 'channels' ? (
                  <VideoSuggestionChannelsTab
                    disabled={disabled}
                    recentDownloadedChannels={recentDownloadedChannels}
                    t={t}
                    onOpenChannelExternally={(channelUrl, channelName) => {
                      void openChannelExternally(channelUrl, channelName);
                    }}
                    onRemoveChannelItem={key => {
                      removeChannelHistoryItem(key);
                    }}
                  />
                ) : null}

                {activeRightTab === 'history' ? (
                  <VideoSuggestionHistoryTab
                    disabled={disabled}
                    downloadHistory={downloadHistory}
                    isDownloadInProgress={isDownloadInProgress}
                    localPrimaryActionLabel={resolvedLocalPrimaryActionLabel}
                    playablePathMap={playablePathMap}
                    t={t}
                    buildVideoMetaDetails={getVideoMetaDetails}
                    formatHistoryTimestamp={formatHistoryTimestamp}
                    onOpenChannelExternally={(channelUrl, channelName) => {
                      void openChannelExternally(channelUrl, channelName);
                    }}
                    onOpenDownloadedVideo={item => {
                      void openDownloadedVideo(item);
                    }}
                    onOpenVideoExternally={url => {
                      void openVideoExternally(url);
                    }}
                    onRedownloadHistoryItem={item => {
                      void redownloadHistoryItem(item);
                    }}
                    onRemoveHistoryItem={id => {
                      removeHistoryItem(id);
                    }}
                  />
                ) : null}

                {activeRightTab === 'results' ? (
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
                ) : null}
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
