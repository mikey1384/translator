import { buildSrt, parseSrt } from '../../shared/helpers';
import {
  BASELINE_HEIGHT,
  CHECKOUT_ALREADY_PENDING,
  CREDIT_PACKS,
  MIN_SUBTITLE_FONT_SIZE,
  fontScale,
} from '../../shared/constants';
import { SUBTITLE_STYLE_PRESETS } from '../../shared/constants/subtitle-styles';
import type {
  SrtSegment,
  RenderSubtitlesOptions,
  SubtitleDisplayMode,
  SummaryEffortLevel,
  VideoQuality,
  VideoSuggestionChatResult,
  VideoSuggestionDownloadHistoryItem,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import { sanitizeVideoSuggestionHistoryPath } from '../../shared/helpers/video-suggestion-sanitize';
import { resolvePreferredLanguageName } from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-helpers';
import {
  readLocalVideoSuggestionPrefs,
  syncAuthoritativeVideoSuggestionHistory,
  writeLocalVideoSuggestionPrefs,
} from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-local-storage';
import * as OperationIPC from '../ipc/operation';
import * as SystemIPC from '../ipc/system';
import {
  generateTranscriptSummary,
  onTranscriptSummaryProgress,
  transcribeOneLine,
  translateOneLine,
} from '../ipc/subtitles';
import { suggestVideos } from '../ipc/video-suggestions';
import {
  executeDubGeneration,
  executeSrtTranslation,
  executeSubtitleGeneration,
} from '../containers/GenerateSubtitles/utils/subtitleGeneration';
import { ensureSubtitlesTranslatedForDubbing } from '../utils/runFullTranslation';
import {
  didSaveSubtitleFile,
  saveCurrentSubtitles,
  saveSubtitleFilesToPath,
} from '../utils/saveSubtitles';
import { unmountCurrentSubtitles } from '../utils/subtitle-library';
import { acquireProvisionalUrlDownloadLibraryPath } from './mounted-download-leases';
import subtitleRendererClient from '../clients/subtitle-renderer-client';
import { useAiStore } from '../state/ai-store';
import { useSubStore } from '../state/subtitle-store';
import { useTaskStore } from '../state/task-store';
import { useUIStore } from '../state/ui-store';
import { useUrlStore } from '../state/url-store';
import { useVideoStore } from '../state/video-store';
import {
  ensureVideoSuggestionStoreRuntime,
  useVideoSuggestionStore,
} from '../state/video-suggestion-store';

const DISPLAY_MODES = new Set<SubtitleDisplayMode>([
  'original',
  'translation',
  'dual',
]);
const DOWNLOAD_QUALITIES = new Set<VideoQuality>([
  'high',
  'mid',
  'low',
  '4320p',
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '480p',
  '360p',
  '240p',
]);
const DUB_VOICES = new Set([
  'rachel',
  'adam',
  'josh',
  'sarah',
  'charlie',
  'emily',
  'matilda',
  'brian',
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
]);

type Provider = 'openai' | 'anthropic' | 'elevenlabs';

const APP_DESTINATIONS = [
  'home',
  'create',
  'video-search',
  'downloads',
  'channels',
  'editor',
  'settings',
  'settings-credits',
  'settings-quality',
  'settings-provider',
  'settings-byo',
  'settings-api-keys',
] as const;

type AppDestination = (typeof APP_DESTINATIONS)[number];
type CreditPackId = keyof typeof CREDIT_PACKS;

type VideoSearchInput = {
  prompt?: string;
  preferredLanguage?: string;
  targetCountry?: string;
  recency?: VideoSuggestionRecency;
  includeDownloadHistory?: boolean;
  includeWatchedChannels?: boolean;
};

type VideoSearchContext = {
  preferredLanguage: string;
  targetCountry: string;
  recency: VideoSuggestionRecency;
  includeDownloadHistory: boolean;
  includeWatchedChannels: boolean;
};

type BatchDownloadStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'completed-with-errors'
  | 'cancelled'
  | 'needs-cookies';

type BatchDownloadEntry = {
  id: string;
  title: string;
};

type AgentBatchDownloadState = {
  batchId: string | null;
  status: BatchDownloadStatus;
  quality: VideoQuality | null;
  queued: BatchDownloadEntry[];
  current: BatchDownloadEntry | null;
  completed: BatchDownloadEntry[];
  failures: Array<BatchDownloadEntry & { error: string }>;
  cancelRequested: boolean;
  startedAtIso: string | null;
  finishedAtIso: string | null;
};

type AgentProcessingKind =
  | 'transcription'
  | 'translation'
  | 'dubbing'
  | 'summary'
  | 'merge'
  | 'cue-transcription'
  | 'cue-translation'
  | 'media-workflow';
type AgentProcessingStatus =
  | 'idle'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';
type MountedSubtitleStrategy = 'fail' | 'discard' | 'save';

const MOUNTED_SUBTITLE_STRATEGIES = new Set<MountedSubtitleStrategy>([
  'fail',
  'discard',
  'save',
]);
const SUMMARY_EFFORT_LEVELS = new Set<SummaryEffortLevel>(['standard', 'high']);

type AgentProcessingState = {
  id: string | null;
  kind: AgentProcessingKind | null;
  status: AgentProcessingStatus;
  stage: string;
  cancelRequested: boolean;
  startedAtIso: string | null;
  finishedAtIso: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
};

let lastVideoSearchContext: VideoSearchContext | null = null;
let agentBatchDownloadState: AgentBatchDownloadState = {
  batchId: null,
  status: 'idle',
  quality: null,
  queued: [],
  current: null,
  completed: [],
  failures: [],
  cancelRequested: false,
  startedAtIso: null,
  finishedAtIso: null,
};

let agentProcessingState: AgentProcessingState = {
  id: null,
  kind: null,
  status: 'idle',
  stage: '',
  cancelRequested: false,
  startedAtIso: null,
  finishedAtIso: null,
  result: null,
  error: null,
};

function waitForRenderedDestination(): Promise<void> {
  return new Promise(resolve => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

async function navigateToDestination(
  destination: AppDestination
): Promise<Record<string, unknown>> {
  if (!APP_DESTINATIONS.includes(destination)) {
    throw new Error('Unsupported Translator destination.');
  }
  const ui = useUIStore.getState();
  const settingsDestination = destination.startsWith('settings');
  ui.toggleSettings(settingsDestination);

  if (!settingsDestination) {
    if (
      ['create', 'video-search', 'downloads', 'channels'].includes(destination)
    ) {
      ui.setGeneratePanelOpen(true);
    }
    if (destination === 'editor') ui.setEditPanelOpen(true);
    if (destination === 'downloads') {
      ui.setGenerateSubtitlesWorkspaceTab('history');
    } else if (destination === 'channels') {
      ui.setGenerateSubtitlesWorkspaceTab('channels');
    } else if (destination === 'create' || destination === 'video-search') {
      ui.setGenerateSubtitlesWorkspaceTab('main');
    }
  }

  await waitForRenderedDestination();
  const selector = `[data-translator-destination="${destination}"]`;
  const target = document.querySelector<HTMLElement>(selector);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  } else if (destination === 'home') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return {
    destination,
    opened: Boolean(target) || destination === 'home',
    settingsOpen: useUIStore.getState().showSettings,
    workspaceTab: useUIStore.getState().generateSubtitlesWorkspaceTab,
    note: target
      ? 'The requested Translator destination is visible and focused.'
      : 'This destination is not currently rendered, usually because the related entitlement, media, or admin state is unavailable.',
  };
}

function navigationSnapshot(): Record<string, unknown> {
  return {
    destinations: APP_DESTINATIONS.map(destination => ({
      destination,
      currentlyRendered: Boolean(
        document.querySelector(`[data-translator-destination="${destination}"]`)
      ),
    })),
    externalPages:
      'Use app_open_web_page for an explicit http/https URL. No credentials, cookies, or form values are transferred by the tool.',
    checkout:
      'Use app_open_credit_checkout to open a selected Stage5 credit pack in Stripe. The user must enter and submit payment details manually.',
  };
}

async function openExternalWebPage(input?: {
  url?: string;
}): Promise<Record<string, unknown>> {
  const rawUrl = String(input?.url || '').trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('A valid http or https page URL is required.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https pages can be opened.');
  }
  await window.appShell.openExternal(url.toString());
  return {
    opened: true,
    url: url.toString(),
    note: 'The page was opened for the user. Translator did not send credentials or interact with the page.',
  };
}

async function openCreditCheckout(input?: {
  pack?: CreditPackId;
}): Promise<Record<string, unknown>> {
  const packId = input?.pack;
  if (!packId || !Object.hasOwn(CREDIT_PACKS, packId)) {
    throw new Error('Credit pack must be MICRO, STARTER, STANDARD, or PRO.');
  }
  await navigateToDestination('settings-credits');
  const checkoutSessionId = await SystemIPC.createCheckoutSession(packId);
  if (checkoutSessionId === CHECKOUT_ALREADY_PENDING) {
    return {
      opened: true,
      alreadyPending: true,
      pack: CREDIT_PACKS[packId],
      note: 'A credit checkout is already open. The user must complete or cancel it in the browser.',
    };
  }
  if (!checkoutSessionId) {
    throw new Error('Translator could not open the secure credit checkout.');
  }
  return {
    opened: true,
    alreadyPending: false,
    pack: CREDIT_PACKS[packId],
    note: 'Stripe checkout is open in the browser. The agent cannot read, enter, or submit card or payment details.',
  };
}

type SettingsUpdate = {
  qualityTranslation?: boolean;
  qualityTranscription?: boolean;
  reviewProvider?: 'openai' | 'anthropic';
  summaryQuality?: 'standard' | 'high';
  summaryProvider?: 'openai' | 'anthropic';
  stage5DubbingTtsProvider?: 'openai' | 'elevenlabs';
  stage5VideoSuggestionMode?: 'standard' | 'high';
  dubVoice?: string;
  dubAmbientMix?: number;
  apiKeyMode?: boolean;
  translationDraftProvider?: 'openai' | 'anthropic';
  byoVideoSuggestionModel?:
    | 'gpt-5.1'
    | 'gpt-5.5'
    | 'claude-sonnet-5'
    | 'claude-opus-4-8';
  transcriptionProvider?: 'stage5' | 'openai' | 'elevenlabs';
  dubbingProvider?: 'stage5' | 'openai' | 'elevenlabs';
  openAiEnabled?: boolean;
  anthropicEnabled?: boolean;
  elevenLabsEnabled?: boolean;
};

function requirePath(input?: { path?: string }): string {
  const value = String(input?.path || '').trim();
  if (!value) throw new Error('A local file path is required.');
  return value;
}

function requireHistoryId(input?: { id?: string }): string {
  const value = String(input?.id || '').trim();
  if (!value) throw new Error('A Downloads library entry ID is required.');
  return value;
}

function sortDownloadHistory(
  items: VideoSuggestionDownloadHistoryItem[]
): VideoSuggestionDownloadHistoryItem[] {
  return [...items].sort((a, b) => {
    const aTimestamp = Date.parse(a.downloadedAtIso);
    const bTimestamp = Date.parse(b.downloadedAtIso);
    return (
      (Number.isFinite(bTimestamp) ? bTimestamp : 0) -
      (Number.isFinite(aTimestamp) ? aTimestamp : 0)
    );
  });
}

async function getDownloadHistory(): Promise<
  VideoSuggestionDownloadHistoryItem[]
> {
  return sortDownloadHistory(await syncAuthoritativeVideoSuggestionHistory());
}

async function requireDownloadHistoryItem(input?: {
  id?: string;
}): Promise<VideoSuggestionDownloadHistoryItem> {
  const id = requireHistoryId(input);
  const item = (await getDownloadHistory()).find(entry => entry.id === id);
  if (!item) {
    throw new Error(
      `Downloads library entry was not found: ${id}. List the library again to get current IDs.`
    );
  }
  return item;
}

async function downloadHistorySnapshot(input?: {
  query?: string;
  availability?: 'all' | 'local' | 'missing';
  limit?: number;
}): Promise<Record<string, unknown>> {
  const query = String(input?.query || '')
    .trim()
    .toLocaleLowerCase();
  const availability = input?.availability || 'all';
  const limit = Math.min(100, Math.max(1, Math.floor(input?.limit || 30)));
  const items = await getDownloadHistory();
  const inspected = await Promise.all(
    items.map(async item => {
      const localPath = sanitizeVideoSuggestionHistoryPath(item.localPath);
      const localAvailable = localPath
        ? await window.fileApi.fileExists(localPath).catch(() => false)
        : false;
      const fileName = localPath?.split(/[\\/]/).pop();
      return {
        id: item.id,
        title: item.title,
        sourceUrl: item.sourceUrl,
        channel: item.channel,
        durationSec: item.durationSec,
        uploadedAt: item.uploadedAt,
        downloadedAtIso: item.downloadedAtIso,
        localAvailable,
        fileName,
      };
    })
  );
  const filtered = inspected.filter(item => {
    if (availability === 'local' && !item.localAvailable) return false;
    if (availability === 'missing' && item.localAvailable) return false;
    if (!query) return true;
    return [item.title, item.channel, item.sourceUrl, item.fileName]
      .filter(Boolean)
      .some(value => String(value).toLocaleLowerCase().includes(query));
  });
  return {
    total: items.length,
    matched: filtered.length,
    returned: Math.min(filtered.length, limit),
    availability,
    query: query || null,
    items: filtered.slice(0, limit),
    note: 'Use the stable entry ID to open an available file or re-download its saved source URL.',
  };
}

async function openDownloadHistoryItem(input?: {
  id?: string;
  replaceSubtitles?: MountedSubtitleStrategy;
}): Promise<Record<string, unknown>> {
  if (hasActiveAppProcessing()) {
    throw new Error('Translator already has an active processing operation.');
  }
  const item = await requireDownloadHistoryItem(input);
  const localPath = sanitizeVideoSuggestionHistoryPath(item.localPath);
  if (!localPath) {
    throw new Error(
      'This Downloads entry has no local file. Use app_downloads_redownload with its ID.'
    );
  }

  let releaseLease: (() => Promise<void>) | null = null;
  try {
    releaseLease = await acquireProvisionalUrlDownloadLibraryPath(localPath);
    if (!(await window.fileApi.fileExists(localPath))) {
      throw new Error(
        'This Downloads entry points to a file that is no longer present. Use app_downloads_redownload with its ID.'
      );
    }
    const fallbackName =
      localPath.split(/[\\/]/).pop() || item.title || 'downloaded-video';
    await prepareMountedSubtitles(
      requireMountedSubtitleStrategy(input?.replaceSubtitles, 'fail')
    );
    await useVideoStore.getState().setFile({
      name: fallbackName,
      path: localPath,
      sourceUrl: item.sourceUrl,
    });
    const ui = useUIStore.getState();
    ui.setInputMode('file');
    ui.setGeneratePanelOpen(true);
    ui.setGenerateSubtitlesWorkspaceTab('main');
    return {
      openedEntryId: item.id,
      openedTitle: item.title,
      ...(await currentStatus()),
    };
  } finally {
    if (releaseLease) await releaseLease().catch(() => undefined);
  }
}

async function redownloadHistoryItem(input?: {
  id?: string;
  quality?: VideoQuality;
  replaceSubtitles?: MountedSubtitleStrategy;
}): Promise<Record<string, unknown>> {
  const item = await requireDownloadHistoryItem(input);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(item.sourceUrl);
  } catch {
    throw new Error(
      'The saved source URL for this Downloads entry is invalid.'
    );
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only saved http and https source URLs can be downloaded.');
  }
  const quality = (input?.quality || '1080p') as VideoQuality;
  if (!DOWNLOAD_QUALITIES.has(quality)) {
    throw new Error('Unsupported video quality.');
  }
  const urlState = useUrlStore.getState();
  if (urlState.download.inProgress) {
    throw new Error('A video download is already in progress.');
  }
  if (hasActiveAppProcessing()) {
    throw new Error('Translator already has an active processing operation.');
  }
  const replacementStrategy = requireMountedSubtitleStrategy(
    input?.replaceSubtitles,
    'fail'
  );
  assertMountedSubtitleReplacementAllowed(replacementStrategy);
  const ui = useUIStore.getState();
  ui.setGeneratePanelOpen(true);
  ui.setGenerateSubtitlesWorkspaceTab('main');
  urlState.setUrlInput(parsedUrl.toString());
  urlState.setDownloadQuality(quality);
  void downloadAndMountAgentSource({
    url: parsedUrl.toString(),
    quality,
    strategy: replacementStrategy,
  }).catch(error => {
    useUrlStore
      .getState()
      .setOperationError(
        error instanceof Error ? error.message : String(error)
      );
  });
  return {
    redownloadingEntryId: item.id,
    redownloadingTitle: item.title,
    ...(await currentStatus()),
  };
}

function videoSearchSnapshot(): Record<string, unknown> {
  const search = useVideoSuggestionStore.getState();
  return {
    loading: search.loading,
    mode: search.loadingMode,
    cancelling: search.cancelling,
    elapsedSec: search.loadingElapsedSec,
    activeOperationId: search.activeOperationId,
    searchQuery: search.searchQuery,
    resolvedModel: search.resolvedModelRuntime,
    continuationAvailable: Boolean(
      search.continuationId || search.searchQuery.trim()
    ),
    progress: {
      status: search.streamingStatus,
      preview: search.streamingPreview,
      trace: search.loadingTrace.slice(-10),
      stages: search.pipelineStages,
    },
    error: search.error,
    results: search.results.map(item => ({
      id: item.id,
      title: item.title,
      url: item.url,
      channel: item.channel,
      channelUrl: item.channelUrl,
      durationSec: item.durationSec,
      uploadedAt: item.uploadedAt,
      viewCount: item.viewCount,
    })),
    billing:
      "A search uses the app's active Stage5-credit or BYO model configuration; listing results and downloading videos do not call the recommendation model.",
  };
}

function batchDownloadSnapshot(): Record<string, unknown> {
  const batch = agentBatchDownloadState;
  return {
    batchId: batch.batchId,
    status: batch.status,
    quality: batch.quality,
    total: batch.queued.length,
    current: batch.current,
    completed: batch.completed,
    failures: batch.failures,
    remaining: batch.queued.filter(
      queued =>
        !batch.completed.some(entry => entry.id === queued.id) &&
        !batch.failures.some(entry => entry.id === queued.id) &&
        queued.id !== batch.current?.id
    ),
    cancelRequested: batch.cancelRequested,
    startedAtIso: batch.startedAtIso,
    finishedAtIso: batch.finishedAtIso,
  };
}

async function runVideoSearch(
  input: VideoSearchInput | undefined,
  mode: 'search' | 'more'
): Promise<Record<string, unknown>> {
  ensureVideoSuggestionStoreRuntime();
  if (hasActiveAppProcessing()) {
    throw new Error('Translator already has an active processing operation.');
  }
  const search = useVideoSuggestionStore.getState();
  if (search.loading)
    throw new Error('A video recommendation search is running.');

  const prefs = readLocalVideoSuggestionPrefs();
  const prompt = String(input?.prompt || '').trim();
  if (mode === 'search' && !prompt) {
    throw new Error('A video search prompt is required.');
  }
  if (prompt.length > 2000) {
    throw new Error(
      'The video search prompt must be 2,000 characters or less.'
    );
  }

  const preferredLanguage = String(
    input?.preferredLanguage ||
      lastVideoSearchContext?.preferredLanguage ||
      (await SystemIPC.getLanguagePreference().catch(() => null)) ||
      'en'
  )
    .trim()
    .slice(0, 24);
  const context: VideoSearchContext = {
    preferredLanguage,
    targetCountry: String(
      input?.targetCountry ??
        lastVideoSearchContext?.targetCountry ??
        prefs.country ??
        ''
    )
      .trim()
      .slice(0, 100),
    recency:
      input?.recency ||
      lastVideoSearchContext?.recency ||
      prefs.recency ||
      'any',
    includeDownloadHistory:
      input?.includeDownloadHistory ??
      lastVideoSearchContext?.includeDownloadHistory ??
      Boolean(prefs.contextToggles.includeDownloadHistory),
    includeWatchedChannels:
      input?.includeWatchedChannels ??
      lastVideoSearchContext?.includeWatchedChannels ??
      Boolean(prefs.contextToggles.includeWatchedChannels),
  };
  lastVideoSearchContext = context;

  const downloadHistory = await getDownloadHistory();
  const messages =
    mode === 'more'
      ? search.messages
      : [{ role: 'user' as const, content: prompt }];
  if (mode === 'more' && !search.continuationId && !search.searchQuery.trim()) {
    throw new Error('There is no current video search to continue.');
  }

  const operationId = `agent-video-${mode}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  const creditsBefore = await SystemIPC.getCreditSnapshot().catch(() => null);
  const modelPreference = useAiStore.getState().videoSuggestionModelPreference;
  const resultsBeforeSearch = [...search.results];
  const searchQueryBeforeSearch = search.searchQuery;
  search.nextRequestId();
  search.setMessages(messages);
  search.setError(null);
  search.setLastRequestPreferences(prefs.preferences);
  if (mode === 'search') {
    search.setResults([]);
    search.setSearchQuery('');
    search.setContinuationId(null);
  }
  search.startOperation(operationId, mode === 'more' ? 'more' : 'chat');
  useUIStore.getState().setGeneratePanelOpen(true);
  useUIStore.getState().setGenerateSubtitlesWorkspaceTab('main');

  let response: VideoSuggestionChatResult;
  try {
    response = await suggestVideos({
      history: messages,
      modelPreference,
      preferredLanguage: context.preferredLanguage,
      preferredLanguageName: resolvePreferredLanguageName(
        context.preferredLanguage
      ),
      targetCountry: context.targetCountry,
      preferredRecency: context.recency,
      savedPreferences: prefs.preferences,
      contextToggles: {
        includeDownloadHistory: context.includeDownloadHistory,
        includeWatchedChannels: context.includeWatchedChannels,
      },
      recentDownloadTitles: downloadHistory
        .map(item => item.title.trim())
        .filter(Boolean)
        .slice(0, 8),
      recentChannelNames: downloadHistory
        .map(item => String(item.channel || '').trim())
        .filter(Boolean)
        .slice(0, 8),
      continuationId:
        mode === 'more' ? search.continuationId || undefined : undefined,
      searchQueryOverride:
        mode === 'more' ? search.searchQuery || undefined : undefined,
      excludeUrls:
        mode === 'more' ? search.results.map(item => item.url) : undefined,
      operationId,
    });

    const incoming = Array.isArray(response.results) ? response.results : [];
    search.setResults(() =>
      mode === 'more'
        ? [
            ...resultsBeforeSearch,
            ...incoming.filter(
              item =>
                !resultsBeforeSearch.some(existing => existing.url === item.url)
            ),
          ]
        : incoming
    );
    search.setSearchQuery(
      String(response.searchQuery || '').trim() ||
        (mode === 'more' ? searchQueryBeforeSearch : '')
    );
    search.setContinuationId(
      String(response.continuationId || '').trim() ||
        (mode === 'more' ? search.continuationId : null)
    );
    search.setYoutubeRegionCode(
      String(response.youtubeRegionCode || '').trim() || null
    );
    search.setYoutubeSearchLanguage(
      String(response.youtubeSearchLanguage || '').trim() || null
    );
    search.setResolvedModelRuntime(
      String(response.resolvedModel || '').trim() || null
    );
    if (response.assistantMessage?.trim()) {
      search.setMessages(current => [
        ...current,
        { role: 'assistant', content: response.assistantMessage.trim() },
      ]);
    }
    if (response.capturedPreferences?.topic) {
      writeLocalVideoSuggestionPrefs({
        preferences: { topic: response.capturedPreferences.topic },
        preferenceHistory: { topic: [response.capturedPreferences.topic] },
      });
    }
    search.setError(String(response.error || '').trim() || null);
  } catch (error) {
    search.setError(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    search.finishOperation(operationId);
  }

  const creditsAfter = await SystemIPC.getCreditSnapshot().catch(() => null);
  return {
    ...videoSearchSnapshot(),
    assistantMessage: response.assistantMessage,
    success: response.success,
    credits: {
      before: creditsBefore?.creditBalance ?? null,
      after: creditsAfter?.creditBalance ?? null,
      note: useAiStore.getState().useApiKeysMode
        ? 'BYO mode may incur provider charges that are not represented by the Stage5 credit balance.'
        : 'Stage5 credit balances are shown before and after the search.',
    },
  };
}

async function cancelVideoSearch(): Promise<Record<string, unknown>> {
  const search = useVideoSuggestionStore.getState();
  const operationId = search.activeOperationId;
  if (!operationId || !search.loading) return videoSearchSnapshot();
  if (search.cancelling) return videoSearchSnapshot();
  search.setCancellingOperation(operationId);
  try {
    const result = await OperationIPC.cancel(operationId);
    if (!result?.success) {
      throw new Error(
        result?.message || 'Translator could not cancel the search.'
      );
    }
    const current = useVideoSuggestionStore.getState();
    current.nextRequestId();
    current.clearActiveOperation(operationId);
    current.resetLiveActivityState();
    current.setError(null);
  } finally {
    useVideoSuggestionStore.getState().setCancellingOperation(null);
  }
  return videoSearchSnapshot();
}

async function runSuggestedVideoBatch(
  items: VideoSuggestionResultItem[],
  quality: VideoQuality
): Promise<void> {
  for (const item of items) {
    if (agentBatchDownloadState.cancelRequested) break;
    const entry = { id: item.id, title: item.title || item.url };
    agentBatchDownloadState = {
      ...agentBatchDownloadState,
      current: entry,
    };
    const urlState = useUrlStore.getState();
    urlState.setUrlInput(item.url);
    urlState.setDownloadQuality(quality);
    const result = await urlState.downloadMedia({
      url: item.url,
      preserveSubtitles: false,
      mountOnComplete: false,
    });
    const finalUrlState = useUrlStore.getState();
    if (
      result?.success &&
      finalUrlState.download.stage === 'Completed' &&
      !finalUrlState.error
    ) {
      agentBatchDownloadState = {
        ...agentBatchDownloadState,
        completed: [...agentBatchDownloadState.completed, entry],
        current: null,
      };
      continue;
    }
    const error =
      String(result?.error || finalUrlState.error || '').trim() ||
      (finalUrlState.needCookies
        ? 'The source requires browser cookies or manual verification.'
        : 'Download did not complete.');
    agentBatchDownloadState = {
      ...agentBatchDownloadState,
      failures: [...agentBatchDownloadState.failures, { ...entry, error }],
      current: null,
    };
    if (finalUrlState.needCookies) {
      agentBatchDownloadState = {
        ...agentBatchDownloadState,
        status: 'needs-cookies',
        finishedAtIso: new Date().toISOString(),
      };
      return;
    }
  }

  agentBatchDownloadState = {
    ...agentBatchDownloadState,
    current: null,
    status: agentBatchDownloadState.cancelRequested
      ? 'cancelled'
      : agentBatchDownloadState.failures.length > 0
        ? 'completed-with-errors'
        : 'completed',
    finishedAtIso: new Date().toISOString(),
  };
}

async function startSuggestedVideoBatch(input?: {
  ids?: string[];
  quality?: VideoQuality;
}): Promise<Record<string, unknown>> {
  if (hasActiveAppProcessing()) {
    throw new Error('Translator already has an active processing operation.');
  }
  if (agentBatchDownloadState.status === 'running') {
    throw new Error('A suggested-video batch download is already running.');
  }
  if (useUrlStore.getState().download.inProgress) {
    throw new Error('A video download is already in progress.');
  }
  const ids = Array.from(
    new Set(
      (input?.ids || []).map(id => String(id || '').trim()).filter(Boolean)
    )
  );
  if (ids.length === 0) throw new Error('Select at least one result ID.');
  if (ids.length > 8) {
    throw new Error(
      'A batch is limited to 8 videos to bound storage and network use.'
    );
  }
  const quality = (input?.quality || '1080p') as VideoQuality;
  if (!DOWNLOAD_QUALITIES.has(quality))
    throw new Error('Unsupported video quality.');
  const results = useVideoSuggestionStore.getState().results;
  const items = ids.map(id => {
    const item = results.find(result => result.id === id);
    if (!item) {
      throw new Error(
        `Current video recommendation result was not found: ${id}. Search again to get current IDs.`
      );
    }
    return item;
  });
  agentBatchDownloadState = {
    batchId: `agent-video-batch-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 9)}`,
    status: 'running',
    quality,
    queued: items.map(item => ({ id: item.id, title: item.title || item.url })),
    current: null,
    completed: [],
    failures: [],
    cancelRequested: false,
    startedAtIso: new Date().toISOString(),
    finishedAtIso: null,
  };
  useUIStore.getState().setGeneratePanelOpen(true);
  useUIStore.getState().setGenerateSubtitlesWorkspaceTab('main');
  void runSuggestedVideoBatch(items, quality).catch(error => {
    const current = agentBatchDownloadState.current;
    agentBatchDownloadState = {
      ...agentBatchDownloadState,
      current: null,
      status: 'completed-with-errors',
      failures: current
        ? [
            ...agentBatchDownloadState.failures,
            {
              ...current,
              error: error instanceof Error ? error.message : String(error),
            },
          ]
        : agentBatchDownloadState.failures,
      finishedAtIso: new Date().toISOString(),
    };
  });
  return batchDownloadSnapshot();
}

async function cancelSuggestedVideoBatch(): Promise<Record<string, unknown>> {
  if (agentBatchDownloadState.status !== 'running') {
    return batchDownloadSnapshot();
  }
  agentBatchDownloadState = {
    ...agentBatchDownloadState,
    cancelRequested: true,
  };
  const operationId = useUrlStore.getState().download.id;
  if (operationId)
    await OperationIPC.cancel(operationId).catch(() => undefined);
  return batchDownloadSnapshot();
}

function processingTaskSnapshot(task: Record<string, any>) {
  return {
    id: task.id ?? null,
    stage: task.stage || '',
    percent: Number(task.percent || 0),
    inProgress: Boolean(task.inProgress),
    isCompleted: Boolean(task.isCompleted),
    model: task.model || null,
    phaseKey: task.phaseKey || null,
    current: task.current ?? null,
    total: task.total ?? null,
    unit: task.unit || null,
    etaSeconds: task.etaSeconds ?? null,
  };
}

function agentProcessingSnapshot(): Record<string, unknown> {
  const tasks = useTaskStore.getState();
  const video = useVideoStore.getState();
  const subtitles = useSubStore.getState();
  const download = useUrlStore.getState();
  return {
    ...agentProcessingState,
    source: {
      videoPath: video.originalPath ?? video.path ?? null,
      videoReady: video.isReady,
      durationSeconds: video.meta?.duration ?? null,
    },
    subtitles: {
      cueCount: subtitles.order.length,
      translatedCueCount: subtitles.order.filter(id =>
        Boolean(subtitles.segments[id]?.translation?.trim())
      ).length,
      targetLanguage: subtitles.targetLanguage ?? null,
      kind: subtitles.subtitleKind ?? null,
      activeFilePath:
        subtitles.activeFilePath ??
        subtitles.exportPath ??
        subtitles.originalPath ??
        null,
    },
    outputs: {
      dubbedVideoPath: video.dubbedVideoPath ?? null,
      dubbedAudioPath: video.dubbedAudioPath ?? null,
      downloadedFilePath: download.download.completedFilePath ?? null,
    },
    tasks: {
      transcription: processingTaskSnapshot(tasks.transcription),
      translation: processingTaskSnapshot(tasks.translation),
      dubbing: processingTaskSnapshot(tasks.dubbing),
      summary: processingTaskSnapshot(tasks.summary),
      merge: processingTaskSnapshot(tasks.merge),
      download: {
        id: download.download.id,
        stage: download.download.stage,
        percent: download.download.percent,
        inProgress: download.download.inProgress,
        needCookies: download.needCookies,
        error: download.error,
      },
    },
  };
}

function hasActiveAppProcessing(): boolean {
  const tasks = useTaskStore.getState();
  return Boolean(
    agentProcessingState.status === 'running' ||
    agentProcessingState.status === 'cancelling' ||
    agentBatchDownloadState.status === 'running' ||
    useVideoSuggestionStore.getState().loading ||
    useUrlStore.getState().download.inProgress ||
    tasks.transcription.inProgress ||
    tasks.translation.inProgress ||
    tasks.dubbing.inProgress ||
    tasks.summary.inProgress ||
    tasks.merge.inProgress
  );
}

function beginAgentProcessing(
  kind: AgentProcessingKind,
  runner: (agentOperationId: string) => Promise<Record<string, unknown>>
): Record<string, unknown> {
  if (
    agentProcessingState.status === 'running' ||
    agentProcessingState.status === 'cancelling' ||
    hasActiveAppProcessing()
  ) {
    throw new Error(
      'Translator already has an active processing operation. Poll app_processing_status or cancel it before starting another.'
    );
  }
  const id = `agent-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  agentProcessingState = {
    id,
    kind,
    status: 'running',
    stage: 'starting',
    cancelRequested: false,
    startedAtIso: new Date().toISOString(),
    finishedAtIso: null,
    result: null,
    error: null,
  };
  void runner(id)
    .then(result => {
      if (agentProcessingState.id !== id) return;
      const cancelled = agentProcessingState.cancelRequested;
      agentProcessingState = {
        ...agentProcessingState,
        status: cancelled ? 'cancelled' : 'completed',
        stage: cancelled ? 'cancelled' : 'completed',
        finishedAtIso: new Date().toISOString(),
        result: cancelled ? null : result,
        error: null,
      };
    })
    .catch(error => {
      if (agentProcessingState.id !== id) return;
      const message = error instanceof Error ? error.message : String(error);
      const cancelled =
        agentProcessingState.cancelRequested || /cancel/i.test(message);
      agentProcessingState = {
        ...agentProcessingState,
        status: cancelled ? 'cancelled' : 'failed',
        stage: cancelled ? 'cancelled' : 'failed',
        finishedAtIso: new Date().toISOString(),
        result: null,
        error: cancelled ? null : message,
      };
    });
  return agentProcessingSnapshot();
}

function throwIfAgentCancelled(): void {
  if (agentProcessingState.cancelRequested) {
    throw new Error('Operation cancelled.');
  }
}

async function prepareMountedSubtitles(
  strategy: MountedSubtitleStrategy
): Promise<void> {
  const mountedCount = useSubStore.getState().order.length;
  if (mountedCount === 0) return;
  if (strategy === 'fail') {
    throw new Error(
      'Subtitles are already mounted. Choose replace_subtitles=save or discard explicitly.'
    );
  }
  if (strategy === 'save') {
    const saved = await saveCurrentSubtitles();
    if (!didSaveSubtitleFile(saved)) {
      throw new Error(saved.error || 'Mounted subtitles could not be saved.');
    }
  }
  unmountCurrentSubtitles();
  useVideoStore.getState().clearDubbedMedia();
}

function assertMountedSubtitleReplacementAllowed(
  strategy: MountedSubtitleStrategy
): void {
  if (useSubStore.getState().order.length > 0 && strategy === 'fail') {
    throw new Error(
      'Subtitles are already mounted. Choose replace_subtitles=save or discard explicitly.'
    );
  }
}

function requireMountedSubtitleStrategy(
  value: unknown,
  fallback: MountedSubtitleStrategy = 'fail'
): MountedSubtitleStrategy {
  const strategy = String(value || fallback) as MountedSubtitleStrategy;
  if (!MOUNTED_SUBTITLE_STRATEGIES.has(strategy)) {
    throw new Error(
      'Unsupported subtitle replacement policy. Choose fail, save, or discard.'
    );
  }
  return strategy;
}

async function runAgentTranscription(
  agentOperationId: string,
  strategy: MountedSubtitleStrategy
): Promise<Record<string, unknown>> {
  const video = useVideoStore.getState();
  const videoPath =
    video.originalPath ??
    video.path ??
    (video.file as any)?.path ??
    (video.file as any)?._originalPath ??
    null;
  if (!videoPath)
    throw new Error('Open or download a video before transcribing.');
  if (!(await window.fileApi.fileExists(videoPath))) {
    throw new Error(`The mounted video is no longer available: ${videoPath}`);
  }
  await prepareMountedSubtitles(strategy);
  throwIfAgentCancelled();
  agentProcessingState = {
    ...agentProcessingState,
    stage: 'transcribing',
  };
  useUIStore.getState().setGeneratePanelOpen(true);
  useUIStore.getState().setEditPanelOpen(true);
  const operationId = `${agentOperationId}-transcribe`;
  const result = await executeSubtitleGeneration({
    videoFile: video.file,
    videoFilePath: videoPath,
    targetLanguage: 'original',
    operationId,
  });
  if (!result.success) {
    if (result.cancelled) throw new Error('Transcription cancelled.');
    throw new Error(
      useUrlStore.getState().error ||
        'Translator could not transcribe the video.'
    );
  }
  const subtitles = useSubStore.getState();
  return {
    operationId,
    videoPath,
    cueCount: subtitles.order.length,
    transcriptionEngine: subtitles.transcriptionEngine ?? null,
  };
}

async function runAgentTranslation(
  agentOperationId: string,
  targetLanguage: string
): Promise<Record<string, unknown>> {
  const language = String(targetLanguage || '').trim();
  if (!language) throw new Error('A target language is required.');
  const subtitles = useSubStore.getState();
  const segments = subtitles.order.map(id => subtitles.segments[id]);
  if (!segments.length) {
    throw new Error('Transcribe or mount subtitles before translating.');
  }
  throwIfAgentCancelled();
  agentProcessingState = {
    ...agentProcessingState,
    stage: 'translating',
  };
  useUIStore.getState().setTargetLanguage(language);
  const operationId = `${agentOperationId}-translate`;
  const result = await executeSrtTranslation({
    segments,
    targetLanguage: language,
    operationId,
  });
  if (!result.success) {
    if (result.cancelled) throw new Error('Translation cancelled.');
    throw new Error(
      result.error || 'Translator could not translate the subtitles.'
    );
  }
  const translated = useSubStore.getState();
  return {
    operationId,
    targetLanguage: language,
    cueCount: translated.order.length,
    translatedCueCount: translated.order.filter(id =>
      Boolean(translated.segments[id]?.translation?.trim())
    ).length,
  };
}

async function runAgentDubbing(
  agentOperationId: string,
  input: {
    targetLanguage?: string;
    voice?: string;
    translateIfNeeded?: boolean;
  }
): Promise<Record<string, unknown>> {
  const targetLanguage =
    String(input.targetLanguage || '').trim() ||
    useUIStore.getState().targetLanguage;
  if (!targetLanguage) throw new Error('A target language is required.');
  const voice =
    String(input.voice || '').trim() || useUIStore.getState().dubVoice;
  if (!DUB_VOICES.has(voice)) throw new Error('Unsupported dubbing voice.');
  throwIfAgentCancelled();
  useUIStore.getState().setTargetLanguage(targetLanguage);
  if (input.translateIfNeeded !== false) {
    agentProcessingState = {
      ...agentProcessingState,
      stage: 'preparing-dub-translation',
    };
    const ready = await ensureSubtitlesTranslatedForDubbing({
      operationPrefix: `${agentOperationId}-dub-translate`,
    });
    if (!ready.ok)
      throw new Error('Subtitles could not be prepared for dubbing.');
    throwIfAgentCancelled();
  }
  const subtitles = useSubStore.getState();
  const segments = subtitles.order.map(id => subtitles.segments[id]);
  if (!segments.length) throw new Error('Subtitles are required for dubbing.');
  if (
    input.translateIfNeeded === false &&
    segments.some(segment =>
      Boolean(segment.original?.trim() && !segment.translation?.trim())
    )
  ) {
    throw new Error(
      'Some cues have no translation. Enable translate_if_needed or translate first.'
    );
  }
  agentProcessingState = {
    ...agentProcessingState,
    stage: 'dubbing',
  };
  const video = useVideoStore.getState();
  const videoPath =
    video.originalPath ?? subtitles.sourceVideoPath ?? video.path ?? null;
  const operationId = `${agentOperationId}-dub`;
  const result = await executeDubGeneration({
    segments,
    operationId,
    videoPath,
    voice,
    targetLanguage,
    videoDurationSeconds: video.meta?.duration,
  });
  if (!result.success) {
    if (result.cancelled) throw new Error('Dubbing cancelled.');
    throw new Error('Translator could not generate the dubbed media.');
  }
  return {
    operationId,
    targetLanguage,
    voice,
    videoPath: result.videoPath ?? null,
    audioPath: result.audioPath ?? null,
  };
}

async function runAgentSummary(
  agentOperationId: string,
  input: {
    targetLanguage?: string;
    effortLevel?: SummaryEffortLevel;
    includeHighlights?: boolean;
  }
): Promise<Record<string, unknown>> {
  const subtitles = useSubStore.getState();
  const segments = subtitles.order
    .map(id => subtitles.segments[id])
    .filter((segment): segment is SrtSegment => Boolean(segment));
  if (!segments.length) {
    throw new Error(
      'Transcribe or mount subtitles before generating a summary.'
    );
  }
  throwIfAgentCancelled();
  const targetLanguage =
    String(input.targetLanguage || '').trim() ||
    useUIStore.getState().summaryLanguage;
  const effortLevel =
    input.effortLevel || useUIStore.getState().summaryEffortLevel;
  if (!SUMMARY_EFFORT_LEVELS.has(effortLevel)) {
    throw new Error('Unsupported summary quality. Choose standard or high.');
  }
  const operationId = `${agentOperationId}-summary`;
  const taskStore = useTaskStore.getState();
  if (!taskStore.tryStartSummary(operationId, 'Preparing summary')) {
    throw new Error('Translator could not start summary generation.');
  }
  agentProcessingState = {
    ...agentProcessingState,
    stage: 'summarizing',
  };
  const removeProgressListener = onTranscriptSummaryProgress(progress => {
    if (progress.operationId && progress.operationId !== operationId) return;
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    useTaskStore.getState().setSummary({
      id: operationId,
      stage: String(progress.stage || 'Generating summary'),
      percent,
      inProgress: percent < 100,
    });
  });
  try {
    const video = useVideoStore.getState();
    const result = await generateTranscriptSummary({
      segments: segments.map(segment => ({
        start: segment.start,
        end: segment.end,
        text: segment.original,
      })),
      targetLanguage,
      operationId,
      videoPath:
        video.originalPath ?? subtitles.sourceVideoPath ?? video.path ?? null,
      includeHighlights: input.includeHighlights !== false,
      effortLevel,
    });
    if (result.error) throw new Error(result.error);
    if (result.cancelled || result.success === false) {
      throw new Error('Summary generation cancelled.');
    }
    return {
      operationId,
      targetLanguage,
      effortLevel,
      summary: String(result.summary || '').trim(),
      sections: Array.isArray(result.sections) ? result.sections : [],
      highlights: Array.isArray(result.highlights) ? result.highlights : [],
      highlightStatus: result.highlightStatus ?? null,
    };
  } finally {
    removeProgressListener();
    useTaskStore.getState().setSummary({
      id: null,
      inProgress: false,
    });
  }
}

function requireMountedCue(idValue: unknown): SrtSegment {
  const id = String(idValue || '').trim();
  const cue = useSubStore.getState().segments[id];
  if (!cue)
    throw new Error(`Subtitle cue was not found: ${id || '(missing ID)'}`);
  return cue;
}

async function runAgentCueTranslation(
  agentOperationId: string,
  input: { id?: string; targetLanguage?: string }
): Promise<Record<string, unknown>> {
  const cue = requireMountedCue(input.id);
  if (!cue.original?.trim())
    throw new Error('The subtitle cue has no source text.');
  const targetLanguage =
    String(input.targetLanguage || '').trim() ||
    useUIStore.getState().targetLanguage;
  if (!targetLanguage) throw new Error('A target language is required.');
  throwIfAgentCancelled();
  const operationId = `${agentOperationId}-translate-cue`;
  if (
    !useTaskStore
      .getState()
      .tryStartTranslation(operationId, 'Translating subtitle cue')
  ) {
    throw new Error('Translator could not start cue translation.');
  }
  agentProcessingState = {
    ...agentProcessingState,
    stage: 'translating-cue',
  };
  try {
    const store = useSubStore.getState();
    const cueIndex = store.order.indexOf(cue.id);
    const contextBefore = store.order
      .slice(Math.max(0, cueIndex - 2), cueIndex)
      .map(id => store.segments[id]);
    const contextAfter = store.order
      .slice(cueIndex + 1, cueIndex + 3)
      .map(id => store.segments[id]);
    const result = await translateOneLine({
      segment: cue,
      contextBefore,
      contextAfter,
      targetLanguage,
      operationId,
    });
    if (result.error) throw new Error(result.error);
    const translation = String(result.translation || '').trim();
    if (!translation) throw new Error('Cue translation returned no text.');
    useSubStore.getState().update(cue.id, { translation });
    return {
      operationId,
      id: cue.id,
      targetLanguage,
      translation,
    };
  } finally {
    useTaskStore.getState().setTranslation({
      id: null,
      inProgress: false,
    });
  }
}

async function runAgentCueTranscription(
  agentOperationId: string,
  input: { id?: string }
): Promise<Record<string, unknown>> {
  const cue = requireMountedCue(input.id);
  const video = useVideoStore.getState();
  const subtitles = useSubStore.getState();
  const videoPath =
    video.originalPath ?? subtitles.sourceVideoPath ?? video.path ?? null;
  if (!videoPath) throw new Error('A source video is required.');
  if (!(await window.fileApi.fileExists(videoPath))) {
    throw new Error(`The mounted video is no longer available: ${videoPath}`);
  }
  throwIfAgentCancelled();
  const operationId = `${agentOperationId}-transcribe-cue`;
  useTaskStore.getState().setTranscription({
    id: operationId,
    stage: 'Transcribing subtitle cue',
    percent: 0,
    inProgress: true,
  });
  agentProcessingState = {
    ...agentProcessingState,
    stage: 'transcribing-cue',
  };
  try {
    const cueIndex = subtitles.order.indexOf(cue.id);
    const promptContext = subtitles.order
      .slice(Math.max(0, cueIndex - 2), cueIndex)
      .map(id => subtitles.segments[id]?.original?.trim())
      .filter(Boolean)
      .join(' \n ');
    const result = await transcribeOneLine({
      videoPath,
      sourceUrl: video.sourceUrl ?? subtitles.sourceUrl ?? undefined,
      segment: { start: cue.start, end: cue.end },
      promptContext,
      operationId,
    });
    if (result.error) throw new Error(result.error);
    if (result.cancelled || result.success === false) {
      throw new Error('Cue transcription cancelled.');
    }
    if (Array.isArray(result.segments) && result.segments.length > 0) {
      const replacements = result.segments.map(segment => ({
        start: segment.start,
        end: segment.end,
        original: segment.original,
      }));
      useSubStore.getState().replaceWithSegments(cue.id, replacements);
      return {
        operationId,
        replacedId: cue.id,
        cueCount: replacements.length,
      };
    }
    const transcript = String(result.transcript || '').trim();
    if (!transcript) throw new Error('Cue transcription returned no text.');
    useSubStore.getState().update(cue.id, { original: transcript });
    return { operationId, id: cue.id, transcript };
  } finally {
    useTaskStore.getState().setTranscription({
      id: null,
      stage: '',
      percent: 0,
      inProgress: false,
    });
  }
}

async function runAgentMerge(
  agentOperationId: string,
  input: { outputPath?: string; overwrite?: boolean }
): Promise<Record<string, unknown>> {
  const outputPath = String(input.outputPath || '').trim();
  if (!outputPath) throw new Error('An explicit output path is required.');
  if (!/\.mp4$/i.test(outputPath)) {
    throw new Error('Merged video output path must end in .mp4.');
  }
  
  // In packaged mode, enforce allowlist
  if (window.env.isPackaged) {
    const allowed = await window.electron.checkAgentPathAllowed?.(outputPath);
    if (!allowed) {
      throw new Error(
        'Merge output path is outside the allowed directories. ' +
        'Configure allowed directories in Settings → Agent Control.'
      );
    }
  }
  
  const video = useVideoStore.getState();
  const subtitles = useSubStore.getState();
  const videoPath =
    video.originalPath ?? subtitles.sourceVideoPath ?? video.path ?? null;
  if (!videoPath) throw new Error('A source video is required for merging.');
  if (!(await window.fileApi.fileExists(videoPath))) {
    throw new Error(`The mounted video is no longer available: ${videoPath}`);
  }
  throwIfAgentCancelled();
  const segments = subtitles.order.map(id => subtitles.segments[id]);
  if (!segments.length) throw new Error('Mounted subtitles are required.');
  if (!video.isAudioOnly) {
    const missing = [
      video.meta?.duration ? null : 'duration',
      video.meta?.width ? null : 'width',
      video.meta?.height ? null : 'height',
      video.meta?.frameRate ? null : 'frame rate',
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(
        `Source video metadata is missing: ${missing.join(', ')}`
      );
    }
  }
  const operationId = `${agentOperationId}-merge`;
  const ui = useUIStore.getState();
  const targetHeight = video.meta?.height ?? BASELINE_HEIGHT;
  let fontSizePx = video.isAudioOnly
    ? Math.max(MIN_SUBTITLE_FONT_SIZE, ui.baseFontSize)
    : Math.max(
        MIN_SUBTITLE_FONT_SIZE,
        Math.round(ui.baseFontSize * fontScale(targetHeight))
      );
  if (
    !video.isAudioOnly &&
    ui.previewSubtitleFontPx > 0 &&
    ui.previewDisplayHeightPx > 0 &&
    ui.previewVideoHeightPx > 0
  ) {
    fontSizePx = Math.max(
      MIN_SUBTITLE_FONT_SIZE,
      Math.round(
        (ui.previewSubtitleFontPx * ui.previewVideoHeightPx) /
          ui.previewDisplayHeightPx
      )
    );
  }
  const options: RenderSubtitlesOptions = {
    operationId,
    srtContent: buildSrt({
      segments,
      mode: ui.subtitleDisplayMode,
      noWrap: true,
    }),
    subtitleSegments: segments,
    outputDir: '/placeholder/output/dir',
    outputSavePath: outputPath,
    outputOverwrite: input.overwrite === true,
    videoDuration: video.meta?.duration ?? 0,
    videoWidth: video.meta?.width ?? 1280,
    videoHeight: video.meta?.height ?? 720,
    displayWidth: video.meta?.displayWidth ?? video.meta?.width ?? 1280,
    displayHeight: video.meta?.displayHeight ?? video.meta?.height ?? 720,
    videoRotationDeg: video.meta?.rotation ?? 0,
    frameRate: Number(video.meta?.frameRate ?? 30),
    originalVideoPath: videoPath,
    fontSizePx,
    stylePreset: ui.subtitleStyle,
    outputMode: ui.subtitleDisplayMode,
    overlayMode: video.isAudioOnly ? 'blackVideo' : 'overlayOnVideo',
  };
  useTaskStore.getState().setMerge({
    id: operationId,
    stage: 'Starting merge',
    percent: 0,
    inProgress: true,
  });
  agentProcessingState = {
    ...agentProcessingState,
    stage: 'merging',
  };
  try {
    const result = await subtitleRendererClient.renderSubtitles(options);
    if (!result.success || !result.outputPath) {
      throw new Error(result.error || 'Translator could not merge subtitles.');
    }
    return {
      operationId,
      outputPath: result.outputPath,
      mode: ui.subtitleDisplayMode,
      style: ui.subtitleStyle,
    };
  } finally {
    useTaskStore.getState().setMerge({
      id: null,
      inProgress: false,
    });
  }
}

async function downloadAndMountAgentSource(input: {
  url: string;
  quality: VideoQuality;
  strategy: MountedSubtitleStrategy;
  checkCancellation?: boolean;
}): Promise<{
  videoPath: string | null;
  filename: string;
  captionRecovery?: {
    kind: 'youtube_automatic_captions';
    mediaFailure: 'http_403';
    languageCode?: string | null;
  };
}> {
  assertMountedSubtitleReplacementAllowed(input.strategy);
  const urlState = useUrlStore.getState();
  urlState.setDownloadQuality(input.quality);
  const result = await urlState.downloadMedia({
    url: input.url,
    preserveSubtitles: true,
    mountOnComplete: false,
  });
  const finalDownload = useUrlStore.getState();
  const captionRecovery =
    result?.success &&
    result.captionRecovery?.kind === 'youtube_automatic_captions' &&
    result.captionRecovery.mediaFailure === 'http_403'
      ? result.captionRecovery
      : null;
  if (captionRecovery) {
    const recoveredSegments = parseSrt(String(result.subtitles || ''));
    if (recoveredSegments.length === 0) {
      throw new Error(
        'Public automatic captions were found, but Translator could not read them.'
      );
    }
    if (input.checkCancellation) throwIfAgentCancelled();
    await prepareMountedSubtitles(input.strategy);
    if (input.checkCancellation) throwIfAgentCancelled();
    await useVideoStore.getState().setFile(null);
    useSubStore.getState().load(
      recoveredSegments,
      null,
      'fresh',
      null,
      null,
      null,
      null,
      {
        title:
          String(result.title || '').trim() || 'YouTube automatic captions',
        sourceVideoPath: null,
        sourceVideoAssetIdentity: null,
        sourceUrl: input.url,
        sourceProvenance: 'youtube_automatic_captions',
        subtitleKind: null,
        targetLanguage: null,
      }
    );
    useUIStore.getState().setEditPanelOpen(true);
    return {
      videoPath: null,
      filename:
        String(result.filename || result.title || '').trim() ||
        'YouTube automatic captions',
      captionRecovery,
    };
  }
  const videoPath = finalDownload.download.completedFilePath;
  if (!result?.success || !videoPath || finalDownload.error) {
    if (finalDownload.needCookies) {
      throw new Error(
        'The source requires the app-managed cookie connection or manual verification.'
      );
    }
    throw new Error(
      String(
        result?.error || finalDownload.error || 'Download did not complete.'
      )
    );
  }
  if (input.checkCancellation) throwIfAgentCancelled();
  await prepareMountedSubtitles(input.strategy);
  if (input.checkCancellation) throwIfAgentCancelled();
  const filename =
    String(result.filename || '').trim() ||
    videoPath.split(/[\\/]/).pop() ||
    'downloaded-video';
  await useVideoStore.getState().setFile(
    {
      name: filename,
      path: videoPath,
      sourceUrl: input.url,
    },
    { skipStoredSubtitleAutoMount: true }
  );
  useUIStore.getState().setInputMode('file');
  return { videoPath, filename };
}

async function runAgentMediaWorkflow(
  agentOperationId: string,
  input: {
    url?: string;
    path?: string;
    quality?: VideoQuality;
    runTo?: 'download' | 'transcribe' | 'summary' | 'translate' | 'dub';
    targetLanguage?: string;
    summaryEffortLevel?: SummaryEffortLevel;
    includeHighlights?: boolean;
    voice?: string;
    replaceSubtitles?: MountedSubtitleStrategy;
  }
): Promise<Record<string, unknown>> {
  if (input.url && input.path) {
    throw new Error('Choose either a URL or a local path, not both.');
  }
  const runTo = input.runTo || 'transcribe';
  const strategy = input.replaceSubtitles || 'fail';
  let videoPath = String(input.path || '').trim() || null;
  const steps: Record<string, unknown> = {};
  if (input.url || videoPath) {
    assertMountedSubtitleReplacementAllowed(strategy);
  }
  if (input.url) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.url);
    } catch {
      throw new Error('A valid http or https video URL is required.');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http and https video URLs are supported.');
    }
    const quality = input.quality || '1080p';
    if (!DOWNLOAD_QUALITIES.has(quality))
      throw new Error('Unsupported quality.');
    const urlState = useUrlStore.getState();
    urlState.setUrlInput(parsedUrl.toString());
    urlState.setDownloadQuality(quality);
    agentProcessingState = {
      ...agentProcessingState,
      stage: 'downloading',
    };
    const downloaded = await downloadAndMountAgentSource({
      url: parsedUrl.toString(),
      quality,
      strategy,
      checkCancellation: true,
    });
    videoPath = downloaded.videoPath;
    steps.download = downloaded.captionRecovery
      ? {
          success: true,
          filePath: null,
          quality,
          captionRecovery: downloaded.captionRecovery,
          cueCount: useSubStore.getState().order.length,
        }
      : { success: true, filePath: videoPath, quality };
  }
  if (videoPath && !input.url) {
    if (!(await window.fileApi.fileExists(videoPath))) {
      throw new Error(`The source file does not exist: ${videoPath}`);
    }
    await prepareMountedSubtitles(strategy);
    throwIfAgentCancelled();
    await useVideoStore.getState().setFile(
      {
        name: videoPath.split(/[\\/]/).pop() || 'local-video',
        path: videoPath,
      },
      { skipStoredSubtitleAutoMount: true }
    );
    useUIStore.getState().setInputMode('file');
  }
  if (runTo === 'download') {
    if (
      !videoPath &&
      !(steps.download as { captionRecovery?: unknown } | undefined)
        ?.captionRecovery
    ) {
      throw new Error('Provide a URL or local path to open.');
    }
    return { runTo, videoPath, steps };
  }
  const captionOnly =
    Boolean(
      (steps.download as { captionRecovery?: unknown } | undefined)
        ?.captionRecovery
    ) && useSubStore.getState().order.length > 0;
  if (!videoPath && !useVideoStore.getState().path && !captionOnly) {
    throw new Error('Provide a URL or local path, or open a video first.');
  }
  throwIfAgentCancelled();
  if (captionOnly) {
    steps.transcription = {
      skipped: true,
      reason: 'youtube_automatic_captions',
      cueCount: useSubStore.getState().order.length,
    };
  } else {
    steps.transcription = await runAgentTranscription(
      agentOperationId,
      strategy
    );
  }
  throwIfAgentCancelled();
  if (runTo === 'transcribe') {
    return { runTo, videoPath, steps };
  }
  if (runTo === 'summary') {
    steps.summary = await runAgentSummary(agentOperationId, {
      targetLanguage: input.targetLanguage,
      effortLevel: input.summaryEffortLevel,
      includeHighlights: input.includeHighlights,
    });
    return { runTo, videoPath, steps };
  }
  const targetLanguage = String(input.targetLanguage || '').trim();
  if (!targetLanguage) {
    throw new Error(
      'target_language is required when run_to is translate or dub.'
    );
  }
  steps.translation = await runAgentTranslation(
    agentOperationId,
    targetLanguage
  );
  throwIfAgentCancelled();
  if (runTo === 'translate') {
    return { runTo, videoPath, targetLanguage, steps };
  }
  steps.dubbing = await runAgentDubbing(agentOperationId, {
    targetLanguage,
    voice: input.voice,
    translateIfNeeded: false,
  });
  return { runTo, videoPath, targetLanguage, steps };
}

async function cancelAgentProcessing(): Promise<Record<string, unknown>> {
  const tasks = useTaskStore.getState();
  const mergeOperationId = tasks.merge.id;
  if (mergeOperationId && tasks.merge.inProgress) {
    const cancellation =
      await subtitleRendererClient.cancelMerge(mergeOperationId);
    if (cancellation.accepted) {
      agentProcessingState = {
        ...agentProcessingState,
        status: 'cancelling',
        stage: 'cancelling',
        cancelRequested: true,
      };
    }
    return {
      ...agentProcessingSnapshot(),
      cancellation,
    };
  }
  const ids = new Set(
    [
      useUrlStore.getState().download.id,
      tasks.transcription.id,
      tasks.translation.id,
      tasks.dubbing.id,
      tasks.summary.id,
    ].filter((id): id is string => Boolean(id))
  );
  if (agentProcessingState.status === 'running') {
    agentProcessingState = {
      ...agentProcessingState,
      status: 'cancelling',
      stage: 'cancelling',
      cancelRequested: true,
    };
  }
  await Promise.all(
    [...ids].map(id => OperationIPC.cancel(id).catch(() => undefined))
  );
  return agentProcessingSnapshot();
}

function subtitleBatchSnapshot(input?: {
  offset?: number;
  limit?: number;
}): Record<string, unknown> {
  const subtitles = useSubStore.getState();
  const offset = Math.max(0, Math.floor(input?.offset || 0));
  const limit = Math.min(100, Math.max(1, Math.floor(input?.limit || 50)));
  const ids = subtitles.order.slice(offset, offset + limit);
  return {
    offset,
    limit,
    total: subtitles.order.length,
    hasMore: offset + ids.length < subtitles.order.length,
    cues: ids.map(id => {
      const cue = subtitles.segments[id];
      return {
        id: cue.id,
        index: cue.index,
        start: cue.start,
        end: cue.end,
        original: cue.original,
        translation: cue.translation || '',
      };
    }),
  };
}

function updateSubtitleBatch(input?: {
  updates?: Array<{
    id?: string;
    original?: string;
    translation?: string;
    start?: number;
    end?: number;
  }>;
}): Record<string, unknown> {
  if (hasActiveAppProcessing()) {
    throw new Error('Wait for active media processing before editing cues.');
  }
  const updates = input?.updates || [];
  if (!updates.length) throw new Error('Provide at least one subtitle update.');
  const store = useSubStore.getState();
  const validated = updates.map(update => {
    const id = String(update.id || '').trim();
    const current = store.segments[id];
    if (!current) throw new Error(`Subtitle cue was not found: ${id}`);
    const patch: Partial<SrtSegment> = {};
    if (update.original !== undefined) patch.original = update.original;
    if (update.translation !== undefined)
      patch.translation = update.translation;
    if (update.start !== undefined) patch.start = update.start;
    if (update.end !== undefined) patch.end = update.end;
    const nextStart = Number(patch.start ?? current.start);
    const nextEnd = Number(patch.end ?? current.end);
    if (
      !Number.isFinite(nextStart) ||
      !Number.isFinite(nextEnd) ||
      nextStart < 0
    ) {
      throw new Error(`Subtitle cue has invalid timing: ${id}`);
    }
    if (nextEnd <= nextStart) {
      throw new Error(`Subtitle cue end must be after start: ${id}`);
    }
    return { id, patch };
  });
  for (const { id, patch } of validated) {
    store.update(id, patch);
  }
  return {
    updated: updates.length,
    subtitles: subtitleBatchSnapshot({ offset: 0, limit: 1 }),
  };
}

function mutateMountedSubtitles(input?: {
  operation?: 'insert_after' | 'remove' | 'shift' | 'shift_all';
  id?: string;
  seconds?: number;
  confirm?: string;
}): Record<string, unknown> {
  if (hasActiveAppProcessing()) {
    throw new Error('Wait for active media processing before editing cues.');
  }
  const operation = input?.operation;
  const store = useSubStore.getState();
  if (!store.order.length) throw new Error('There are no mounted subtitles.');
  if (operation === 'shift_all') {
    const seconds = Number(input?.seconds);
    if (!Number.isFinite(seconds) || seconds === 0) {
      throw new Error('shift_all requires a finite, non-zero seconds value.');
    }
    store.shiftAll(seconds);
    return { operation, seconds, cueCount: store.order.length };
  }
  const cue = requireMountedCue(input?.id);
  if (operation === 'insert_after') {
    const insertedId = store.insertAfter(cue.id);
    if (!insertedId) throw new Error('Translator could not insert the cue.');
    return { operation, afterId: cue.id, insertedId };
  }
  if (operation === 'remove') {
    if (input?.confirm !== 'REMOVE') {
      throw new Error('Removing a cue requires confirm=REMOVE.');
    }
    store.remove(cue.id);
    return {
      operation,
      removedId: cue.id,
      cueCount: useSubStore.getState().order.length,
    };
  }
  if (operation === 'shift') {
    const seconds = Number(input?.seconds);
    if (!Number.isFinite(seconds) || seconds === 0) {
      throw new Error('shift requires a finite, non-zero seconds value.');
    }
    store.shift(cue.id, seconds);
    const shiftedCue = useSubStore.getState().segments[cue.id];
    return {
      operation,
      id: cue.id,
      seconds,
      start: shiftedCue.start,
      end: shiftedCue.end,
    };
  }
  throw new Error('Unsupported subtitle mutation operation.');
}

async function exportMountedSubtitles(input?: {
  path?: string;
  mode?: SubtitleDisplayMode;
  overwrite?: boolean;
}): Promise<Record<string, unknown>> {
  if (hasActiveAppProcessing()) {
    throw new Error('Wait for active media processing before exporting cues.');
  }
  const path = requirePath(input);
  const absolutePath =
    path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path);
  if (!absolutePath) {
    throw new Error('Subtitle export path must be absolute.');
  }
  if (!/\.srt$/i.test(path)) {
    throw new Error('Subtitle export path must end in .srt.');
  }
  
  // In packaged mode, enforce allowlist
  if (window.env.isPackaged) {
    const allowed = await window.electron.checkAgentPathAllowed?.(path);
    if (!allowed) {
      throw new Error(
        'Subtitle export directory is not in the agent allowed directories list. Configure allowed directories in Settings → Agent Control.'
      );
    }
  }
  
  if ((await window.fileApi.fileExists(path)) && input?.overwrite !== true) {
    throw new Error(
      'Subtitle export already exists. Confirm overwrite explicitly.'
    );
  }
  const subtitles = useSubStore.getState();
  const segments = subtitles.order.map(id => subtitles.segments[id]);
  if (!segments.length)
    throw new Error('There are no mounted subtitles to export.');
  const mode = input?.mode || useUIStore.getState().subtitleDisplayMode;
  if (!DISPLAY_MODES.has(mode))
    throw new Error('Unsupported subtitle export mode.');
  const result = await saveSubtitleFilesToPath(path, segments, mode);
  if (!didSaveSubtitleFile(result)) {
    throw new Error(
      result.error || 'Translator could not export the subtitles.'
    );
  }
  return {
    success: true,
    filePath: result.filePath || path,
    mode,
    cueCount: segments.length,
    warning: result.warning || null,
  };
}

function currentStatus(): Record<string, unknown> {
  const video = useVideoStore.getState();
  const subtitles = useSubStore.getState();
  const ui = useUIStore.getState();
  const url = useUrlStore.getState();
  return {
    ready: true,
    videoPath: video.path,
    videoReady: video.isReady,
    subtitlePath: subtitles.activeFilePath ?? subtitles.originalPath,
    subtitleCueCount: subtitles.order.length,
    translatedCueCount: subtitles.order.filter(id =>
      Boolean(subtitles.segments[id]?.translation?.trim())
    ).length,
    subtitleDisplayMode: ui.subtitleDisplayMode,
    subtitleStyle: ui.subtitleStyle,
    workspaceTab: ui.generateSubtitlesWorkspaceTab,
    generatePanelOpen: ui.showGeneratePanel,
    editPanelOpen: ui.showEditPanel,
    settingsOpen: ui.showSettings,
    download: {
      id: url.download.id,
      stage: url.download.stage,
      percent: url.download.percent,
      inProgress: url.download.inProgress,
      completedFilePath: url.download.completedFilePath,
      error: url.error,
      needCookies: url.needCookies,
    },
    videoSearch: videoSearchSnapshot(),
    videoBatchDownload: batchDownloadSnapshot(),
    processing: agentProcessingSnapshot(),
  };
}

function requireSuccess(
  label: string,
  result: { success: boolean; error?: string }
): void {
  if (!result.success) {
    throw new Error(`${label}: ${result.error || 'setting was rejected'}`);
  }
}

async function settingsSnapshot(): Promise<Record<string, unknown>> {
  const ui = useUIStore.getState();
  const ai = useAiStore.getState();
  const [creditSnapshot, appLanguage] = await Promise.all([
    SystemIPC.getCreditSnapshot().catch(() => null),
    SystemIPC.getLanguagePreference().catch(() => null),
  ]);
  return {
    open: ui.showSettings,
    appLanguage,
    credits: creditSnapshot
      ? {
          balance: creditSnapshot.creditBalance,
          hoursBalance: creditSnapshot.hoursBalance,
          creditsPerHour: creditSnapshot.creditsPerHour,
          authoritative: creditSnapshot.authoritative,
        }
      : null,
    performanceAndQuality: {
      qualityTranslation: ui.qualityTranslation,
      qualityTranscription: ui.qualityTranscription,
      reviewProvider: ai.preferClaudeReview ? 'anthropic' : 'openai',
      summaryQuality: ui.summaryEffortLevel,
      summaryProvider: ai.preferClaudeSummary ? 'anthropic' : 'openai',
      stage5DubbingTtsProvider: ai.stage5DubbingTtsProvider,
      stage5VideoSuggestionMode: ai.stage5VideoSuggestionMode,
      dubVoice: ui.dubVoice,
      dubAmbientMix: ui.dubAmbientMix,
    },
    byo: {
      apiKeyMode: ai.useApiKeysMode,
      encryptionAvailable: ai.encryptionAvailable,
      entitlementsHydrated: ai.entitlementsHydrated,
      entitlements: {
        openai: ai.byoUnlocked,
        anthropic: ai.byoAnthropicUnlocked,
        elevenlabs: ai.byoElevenLabsUnlocked,
      },
      keyPresent: {
        openai: ai.keyPresent,
        anthropic: ai.anthropicKeyPresent,
        elevenlabs: ai.elevenLabsKeyPresent,
      },
      enabled: {
        openai: ai.useByo,
        anthropic: ai.useByoAnthropic,
        elevenlabs: ai.useByoElevenLabs,
      },
      translationDraftProvider: ai.preferClaudeTranslation
        ? 'anthropic'
        : 'openai',
      reviewProvider: ai.preferClaudeReview ? 'anthropic' : 'openai',
      summaryProvider: ai.preferClaudeSummary ? 'anthropic' : 'openai',
      transcriptionProvider: ai.preferredTranscriptionProvider,
      dubbingProvider: ai.preferredDubbingProvider,
      videoSuggestionModel: ai.byoVideoSuggestionModel,
    },
    secrets: 'Stored provider keys are never returned; only presence is shown.',
    manualOnly: [
      'entering and submitting payment details',
      'completing credit or BYO purchases',
      'admin credit resets',
    ],
  };
}

async function updateSettings(
  input: SettingsUpdate
): Promise<Record<string, unknown>> {
  const ui = useUIStore.getState();
  const ai = useAiStore.getState();

  if (input.qualityTranslation !== undefined) {
    ui.setQualityTranslation(input.qualityTranslation);
  }
  if (input.qualityTranscription !== undefined) {
    ui.setQualityTranscription(input.qualityTranscription);
  }
  if (input.summaryQuality !== undefined) {
    ui.setSummaryEffortLevel(input.summaryQuality);
  }
  if (input.dubVoice !== undefined) {
    if (!DUB_VOICES.has(input.dubVoice)) {
      throw new Error('Unsupported dubbing voice.');
    }
    ui.setDubVoice(input.dubVoice);
  }
  if (input.dubAmbientMix !== undefined) {
    if (!Number.isFinite(input.dubAmbientMix)) {
      throw new Error('Dubbing ambient mix must be a finite number.');
    }
    ui.setDubAmbientMix(input.dubAmbientMix);
  }
  if (input.reviewProvider !== undefined) {
    requireSuccess(
      'Review provider',
      await ai.setPreferClaudeReview(input.reviewProvider === 'anthropic')
    );
  }
  if (input.summaryProvider !== undefined) {
    requireSuccess(
      'Summary provider',
      await ai.setPreferClaudeSummary(input.summaryProvider === 'anthropic')
    );
  }
  if (input.stage5DubbingTtsProvider !== undefined) {
    requireSuccess(
      'Stage5 dubbing provider',
      await ai.setStage5DubbingTtsProvider(input.stage5DubbingTtsProvider)
    );
  }
  if (input.stage5VideoSuggestionMode !== undefined) {
    requireSuccess(
      'Video recommendation quality',
      await ai.setStage5VideoSuggestionMode(input.stage5VideoSuggestionMode)
    );
  }
  if (input.translationDraftProvider !== undefined) {
    requireSuccess(
      'Translation draft provider',
      await ai.setPreferClaudeTranslation(
        input.translationDraftProvider === 'anthropic'
      )
    );
  }
  if (input.byoVideoSuggestionModel !== undefined) {
    requireSuccess(
      'BYO video recommendation model',
      await ai.setByoVideoSuggestionModel(input.byoVideoSuggestionModel)
    );
  }
  if (input.transcriptionProvider !== undefined) {
    requireSuccess(
      'Transcription provider',
      await ai.setPreferredTranscriptionProvider(input.transcriptionProvider)
    );
  }
  if (input.dubbingProvider !== undefined) {
    requireSuccess(
      'Dubbing provider',
      await ai.setPreferredDubbingProvider(input.dubbingProvider)
    );
  }
  if (input.openAiEnabled !== undefined) {
    requireSuccess(
      'OpenAI provider toggle',
      await ai.setUseByo(input.openAiEnabled)
    );
  }
  if (input.anthropicEnabled !== undefined) {
    requireSuccess(
      'Anthropic provider toggle',
      await ai.setUseByoAnthropic(input.anthropicEnabled)
    );
  }
  if (input.elevenLabsEnabled !== undefined) {
    requireSuccess(
      'ElevenLabs provider toggle',
      await ai.setUseByoElevenLabs(input.elevenLabsEnabled)
    );
  }
  if (input.apiKeyMode !== undefined) {
    requireSuccess(
      'API-key mode',
      await ai.setUseApiKeysMode(input.apiKeyMode)
    );
  }

  return settingsSnapshot();
}

async function storeProviderKey(input?: {
  provider?: Provider;
  apiKey?: string;
  validate?: boolean;
}): Promise<Record<string, unknown>> {
  const provider = input?.provider;
  const apiKey = String(input?.apiKey || '').trim();
  if (!provider || !['openai', 'anthropic', 'elevenlabs'].includes(provider)) {
    throw new Error('Provider must be openai, anthropic, or elevenlabs.');
  }
  if (!apiKey) throw new Error('A non-empty provider key is required.');

  const ai = useAiStore.getState();
  const config = {
    openai: {
      setValue: ai.setKeyValue,
      validate: ai.validateKey,
      save: ai.saveKey,
    },
    anthropic: {
      setValue: ai.setAnthropicKeyValue,
      validate: ai.validateAnthropicKey,
      save: ai.saveAnthropicKey,
    },
    elevenlabs: {
      setValue: ai.setElevenLabsKeyValue,
      validate: ai.validateElevenLabsKey,
      save: ai.saveElevenLabsKey,
    },
  }[provider];

  config.setValue(apiKey);
  try {
    if (input?.validate !== false) {
      const validation = await config.validate();
      if (!validation.ok) {
        throw new Error(validation.error || `${provider} rejected the key.`);
      }
    }
    requireSuccess('Store provider key', await config.save());
  } finally {
    config.setValue('');
  }
  return settingsSnapshot();
}

async function clearProviderKey(input?: {
  provider?: Provider;
  confirm?: string;
}): Promise<Record<string, unknown>> {
  const provider = input?.provider;
  if (!provider || !['openai', 'anthropic', 'elevenlabs'].includes(provider)) {
    throw new Error('Provider must be openai, anthropic, or elevenlabs.');
  }
  if (input?.confirm !== 'CLEAR') {
    throw new Error('Set confirm to CLEAR before deleting a stored key.');
  }
  const ai = useAiStore.getState();
  const clear = {
    openai: ai.clearKey,
    anthropic: ai.clearAnthropicKey,
    elevenlabs: ai.clearElevenLabsKey,
  }[provider];
  requireSuccess('Clear provider key', await clear());
  return settingsSnapshot();
}

function installAgentBridge() {
  if (window.translatorAgent) {
    console.log('[agent-listener] Bridge already installed');
    return;
  }

  console.log('[agent-listener] Installing agent bridge');
  window.translatorAgent = {
    async status() {
      return currentStatus();
    },

    async navigationSnapshot() {
      return navigationSnapshot();
    },

    async navigate(input) {
      const destination = input?.destination as AppDestination;
      if (!destination || !APP_DESTINATIONS.includes(destination)) {
        throw new Error('Choose a supported Translator destination.');
      }
      return navigateToDestination(destination);
    },

    async openExternalWebPage(input) {
      return openExternalWebPage(input);
    },

    async openCreditCheckout(input) {
      return openCreditCheckout(input);
    },

    async showSettings(input) {
      useUIStore.getState().toggleSettings(input?.open !== false);
      return settingsSnapshot();
    },

    async settingsSnapshot() {
      return settingsSnapshot();
    },

    async updateSettings(input) {
      return updateSettings(input || {});
    },

    async storeProviderKey(input) {
      return storeProviderKey(input);
    },

    async clearProviderKey(input) {
      return clearProviderKey(input);
    },

    async openVideo(input) {
      const filePath = requirePath(input);
      if (hasActiveAppProcessing()) {
        throw new Error(
          'Translator already has an active processing operation.'
        );
      }
      if (!(await window.fileApi.fileExists(filePath))) {
        throw new Error(`Video file does not exist: ${filePath}`);
      }
      await prepareMountedSubtitles(
        requireMountedSubtitleStrategy(input?.replaceSubtitles, 'fail')
      );
      const result = await useVideoStore
        .getState()
        .openRecentLocalMedia(filePath, { preserveSubtitles: false });
      if (!result.opened) {
        throw new Error(
          result.missing
            ? `Video file does not exist: ${filePath}`
            : `Translator could not open video: ${filePath}`
        );
      }
      useUIStore.getState().setGeneratePanelOpen(true);
      return currentStatus();
    },

    async mountSubtitles(input) {
      const filePath = requirePath(input);
      if (hasActiveAppProcessing()) {
        throw new Error(
          'Translator already has an active processing operation.'
        );
      }
      if (!(await window.fileApi.fileExists(filePath))) {
        throw new Error(`Subtitle file does not exist: ${filePath}`);
      }
      const content = await window.fileApi.readText(filePath);
      const segments = parseSrt(content);
      if (!segments.length) {
        throw new Error(`Subtitle file contains no readable cues: ${filePath}`);
      }
      await prepareMountedSubtitles(
        requireMountedSubtitleStrategy(input?.replaceSubtitles, 'fail')
      );
      const sourceVideoPath = useVideoStore.getState().path;
      useSubStore
        .getState()
        .load(segments, filePath, 'disk', sourceVideoPath, null);
      useSubStore.getState().setActiveFileTarget({
        filePath,
        mode: null,
        role: 'import',
      });
      useUIStore.getState().setEditPanelOpen(true);
      return currentStatus();
    },

    async setDisplayMode(input) {
      const mode = input?.mode;
      if (!mode || !DISPLAY_MODES.has(mode)) {
        throw new Error('Display mode must be original, translation, or dual.');
      }
      useUIStore.getState().setSubtitleDisplayMode(mode);
      return currentStatus();
    },

    async setSubtitleStyle(input) {
      const style = String(input?.style || '').trim();
      if (!Object.hasOwn(SUBTITLE_STYLE_PRESETS, style)) {
        throw new Error(
          'Subtitle style must be Default, Classic, Boxed, or LineBox.'
        );
      }
      useUIStore.getState().setSubtitleStyle(style);
      return currentStatus();
    },

    async showDownloadHistory() {
      const ui = useUIStore.getState();
      ui.setGeneratePanelOpen(true);
      ui.setGenerateSubtitlesWorkspaceTab('history');
      return currentStatus();
    },

    async listDownloadHistory(input) {
      return downloadHistorySnapshot(input);
    },

    async openDownloadHistoryItem(input) {
      return openDownloadHistoryItem(input);
    },

    async redownloadHistoryItem(input) {
      return redownloadHistoryItem(input);
    },

    async searchVideos(input) {
      return runVideoSearch(input, 'search');
    },

    async searchMoreVideos() {
      return runVideoSearch(undefined, 'more');
    },

    async videoSearchStatus() {
      return videoSearchSnapshot();
    },

    async cancelVideoSearch() {
      return cancelVideoSearch();
    },

    async startSuggestedVideoBatch(input) {
      return startSuggestedVideoBatch(input);
    },

    async cancelSuggestedVideoBatch() {
      return cancelSuggestedVideoBatch();
    },

    async suggestedVideoBatchStatus() {
      return batchDownloadSnapshot();
    },

    async startVideoDownload(input) {
      const rawUrl = String(input?.url || '').trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl);
      } catch {
        throw new Error('A valid http or https video URL is required.');
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Only http and https video URLs are supported.');
      }
      const quality = (input?.quality || '1080p') as VideoQuality;
      if (!DOWNLOAD_QUALITIES.has(quality)) {
        throw new Error('Unsupported video quality.');
      }
      const urlState = useUrlStore.getState();
      if (urlState.download.inProgress) {
        throw new Error('A video download is already in progress.');
      }
      if (hasActiveAppProcessing()) {
        throw new Error(
          'Translator already has an active processing operation.'
        );
      }
      const replacementStrategy = requireMountedSubtitleStrategy(
        input?.replaceSubtitles,
        'fail'
      );
      assertMountedSubtitleReplacementAllowed(replacementStrategy);
      const ui = useUIStore.getState();
      ui.setGeneratePanelOpen(true);
      ui.setGenerateSubtitlesWorkspaceTab('main');
      urlState.setUrlInput(parsedUrl.toString());
      urlState.setDownloadQuality(quality);
      void downloadAndMountAgentSource({
        url: parsedUrl.toString(),
        quality,
        strategy: replacementStrategy,
      }).catch(error => {
        useUrlStore
          .getState()
          .setOperationError(
            error instanceof Error ? error.message : String(error)
          );
      });
      return currentStatus();
    },

    async startTranscription(input) {
      const strategy = requireMountedSubtitleStrategy(
        input?.replaceSubtitles,
        'fail'
      );
      return beginAgentProcessing('transcription', operationId =>
        runAgentTranscription(operationId, strategy)
      );
    },

    async startTranslation(input) {
      const targetLanguage = String(input?.targetLanguage || '').trim();
      return beginAgentProcessing('translation', operationId =>
        runAgentTranslation(operationId, targetLanguage)
      );
    },

    async startDubbing(input) {
      return beginAgentProcessing('dubbing', operationId =>
        runAgentDubbing(operationId, {
          targetLanguage: input?.targetLanguage,
          voice: input?.voice,
          translateIfNeeded: input?.translateIfNeeded,
        })
      );
    },

    async startSummary(input) {
      const effortLevel = (input?.effortLevel ||
        useUIStore.getState().summaryEffortLevel) as SummaryEffortLevel;
      return beginAgentProcessing('summary', operationId =>
        runAgentSummary(operationId, {
          targetLanguage: input?.targetLanguage,
          effortLevel,
          includeHighlights: input?.includeHighlights,
        })
      );
    },

    async startCueTranslation(input) {
      return beginAgentProcessing('cue-translation', operationId =>
        runAgentCueTranslation(operationId, {
          id: input?.id,
          targetLanguage: input?.targetLanguage,
        })
      );
    },

    async startCueTranscription(input) {
      return beginAgentProcessing('cue-transcription', operationId =>
        runAgentCueTranscription(operationId, { id: input?.id })
      );
    },

    async startMerge(input) {
      return beginAgentProcessing('merge', operationId =>
        runAgentMerge(operationId, {
          outputPath: input?.outputPath,
          overwrite: input?.overwrite,
        })
      );
    },

    async startMediaWorkflow(input) {
      const replaceSubtitles = requireMountedSubtitleStrategy(
        input?.replaceSubtitles,
        'fail'
      );
      return beginAgentProcessing('media-workflow', operationId =>
        runAgentMediaWorkflow(operationId, {
          url: input?.url,
          path: input?.path,
          quality: input?.quality,
          runTo: input?.runTo,
          targetLanguage: input?.targetLanguage,
          summaryEffortLevel: input?.summaryEffortLevel,
          includeHighlights: input?.includeHighlights,
          voice: input?.voice,
          replaceSubtitles,
        })
      );
    },

    async processingStatus() {
      return agentProcessingSnapshot();
    },

    async cancelProcessing() {
      return cancelAgentProcessing();
    },

    async subtitlesBatch(input) {
      return subtitleBatchSnapshot(input);
    },

    async updateSubtitles(input) {
      return updateSubtitleBatch(input);
    },

    async mutateSubtitles(input) {
      return mutateMountedSubtitles(input);
    },

    async exportSubtitles(input) {
      return exportMountedSubtitles(input);
    },
  };
}

function removeAgentBridge() {
  if (!window.translatorAgent) {
    return;
  }
  console.log('[agent-listener] Removing agent bridge');
  delete window.translatorAgent;
}

async function initializeAgentBridge() {
  // In development: check TRANSLATOR_AGENT_DEV flag (already set in window.env.agentMode)
  // In packaged mode: check if user has enabled agent control in Settings
  let agentEnabled = window.env.agentMode;

  if (window.env.isPackaged && !agentEnabled) {
    // Check if agent control is enabled in settings
    try {
      agentEnabled = await window.electron.getAgentControlEnabled();
    } catch (err) {
      console.warn('[agent-listener] Failed to check agent control setting:', err);
      agentEnabled = false;
    }
  }

  // Setup IPC bridge listener for packaged mode agent requests
  // This must be registered even when disabled so it can handle enable/disable toggles
  if (window.env.isPackaged) {
    window.electron.onAgentBridgeRequest?.((request: any) => {
      const { method, params, responseChannel } = request;
      
      (async () => {
        try {
          if (!window.translatorAgent || typeof window.translatorAgent[method] !== 'function') {
            throw new Error('Agent control is not enabled. Enable it in Settings → Agent Control.');
          }
          
          const result = await window.translatorAgent[method](params);
          window.electron.sendAgentBridgeResponse(responseChannel, { result });
        } catch (error: any) {
          window.electron.sendAgentBridgeResponse(responseChannel, {
            error: error?.message || String(error),
          });
        }
      })();
    });

    // Listen for agent control changes - install/remove bridge dynamically
    window.electron.onAgentControlChanged?.(({ enabled }) => {
      if (enabled) {
        // User enabled agent control - install bridge immediately (no reload)
        console.log('[agent-listener] Agent control enabled - installing bridge');
        installAgentBridge();
      } else {
        // User disabled agent control - remove bridge immediately
        console.log('[agent-listener] Agent control disabled - removing bridge');
        removeAgentBridge();
      }
    });
  }

  // Install bridge if currently enabled
  if (agentEnabled) {
    installAgentBridge();
  }
}

// Initialize agent bridge on load
void initializeAgentBridge();
