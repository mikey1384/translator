import { buildSrt, parseSrt } from '../../shared/helpers';
import {
  CHECKOUT_ALREADY_PENDING,
  CREDIT_PACKS,
  CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR,
  SUMMARY_QUALITY_MULTIPLIER,
  TTS_CREDITS_PER_MINUTE,
} from '../../shared/constants';
import {
  SUBTITLE_STYLE_PRESETS,
  type SubtitleStylePresetKey,
} from '../../shared/constants/subtitle-styles';
import type {
  SrtSegment,
  GenerateSubtitlesOptions,
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
import { isExplicitCancellation } from '../../shared/cancelled-error';
import {
  SUBTITLE_RENDER_SPEC_VERSION,
  findSubtitlePreviewSelectionDrift,
  normalizeSubtitleBaseFontSize,
  resolveSubtitleRenderSpec,
  serializeSubtitleRenderSpec,
} from '../../shared/helpers/subtitle-render-spec';
import { classifyTerminalProgress } from '../utils/progress-terminal';
import { resolvePreferredLanguageName } from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-helpers';
import {
  readLocalVideoSuggestionPrefs,
  syncAuthoritativeVideoSuggestionHistory,
  writeLocalVideoSuggestionPrefs,
} from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-local-storage';
import * as OperationIPC from '../ipc/operation';
import * as SystemIPC from '../ipc/system';
import * as SubtitlesIPC from '../ipc/subtitles';
import * as SubtitleLibraryIPC from '../ipc/subtitle-library';
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
import {
  unmountCurrentSubtitles,
  storeGeneratedSubtitleArtifact,
} from '../utils/subtitle-library';
import { preserveWordTimingsOnTranslatedSegments } from '../utils/preserve-word-timings';
import {
  CREDITS_PER_SUMMARY_AUDIO_HOUR,
  estimateTranslationCreditsPerHour,
} from '../utils/creditEstimates';
import { acquireProvisionalUrlDownloadLibraryPath } from './mounted-download-leases';
import subtitleRendererClient from '../clients/subtitle-renderer-client';
import { useAiStore } from '../state/ai-store';
import { useCreditStore } from '../state/credit-store';
import { useSubStore } from '../state/subtitle-store';
import { useTaskStore } from '../state/task-store';
import { useUIStore } from '../state/ui-store';
import { useUrlStore } from '../state/url-store';
import { useVideoStore } from '../state/video-store';
import {
  ensureVideoSuggestionStoreRuntime,
  useVideoSuggestionStore,
} from '../state/video-suggestion-store';
import {
  agentBackgroundOperations,
  createAgentHistoryOperationId,
  isAgentHistoryOperationId,
} from './agent-background-operations';
import {
  AgentHistoryJobRegistry,
  AgentTerminalOperationRegistry,
  agentProgressTaskFor,
  createAgentSubtitleBatchSnapshot,
  shouldReuseAgentOperation,
  usesMainOperationCancellation,
  type AgentHistoryJob,
  type AgentHistoryJobKind,
} from './agent-history-jobs';
import {
  AGENT_SOURCE_BINDING_PROTOCOL_VERSION,
  agentSourceBindingIdentitiesMatch,
  agentSourceBindingsMatch,
  parseAgentSourceBinding,
  projectAgentWorkspaceSnapshot,
  serializeAgentSourceBinding,
  type AgentSourceBinding,
} from './agent-processing-source-binding';

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
const VIDEO_SEARCH_RECENCIES = new Set<VideoSuggestionRecency>([
  'any',
  'day',
  'week',
  'month',
  'year',
]);
const MEDIA_WORKFLOW_TARGETS = new Set([
  'download',
  'transcribe',
  'summary',
  'translate',
  'dub',
] as const);
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
const MAX_AGENT_HISTORY_ID_LENGTH = 512;

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
  | 'preset-render'
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

type AgentCreditUsage = {
  before_balance: number | null;
  current_balance: number | null;
  after_balance: number | null;
  observed_stage5_credit_delta: number;
  stage5_credits_consumed: number;
  authoritative: boolean;
  balance_snapshots_authoritative: boolean;
  attribution_scope: 'account_balance_delta';
  measurement: 'observed_account_balance_delta';
};

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
  creditUsage: AgentCreditUsage | null;
  progressDetails: Record<string, unknown> | null;
  sourceBinding: AgentSourceBinding | null;
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
  creditUsage: null,
  progressDetails: null,
  sourceBinding: null,
};
let mountedMcpWorkspaceBinding: {
  jobId: string;
  binding: AgentSourceBinding;
  videoPath: string | null;
  subtitleSourceId: number;
} | null = null;
let activeAgentPreview: {
  operationId: string;
  promise: Promise<Record<string, unknown>>;
} | null = null;
const terminalAgentOperations = new AgentTerminalOperationRegistry();

type CreditSnapshot = Awaited<ReturnType<typeof SystemIPC.getCreditSnapshot>>;

async function agentCreditSnapshot(refresh: boolean): Promise<CreditSnapshot> {
  if (!refresh) return SystemIPC.getCreditSnapshot();
  try {
    return await SystemIPC.refreshCreditSnapshot(true);
  } catch {
    const cached = await SystemIPC.getCreditSnapshot().catch(() => null);
    return cached ? { ...cached, authoritative: false } : cached;
  }
}

function creditBalance(snapshot: CreditSnapshot): number | null {
  return Number.isFinite(Number(snapshot?.creditBalance))
    ? Number(snapshot?.creditBalance)
    : null;
}

function buildAgentCreditUsage(
  before: CreditSnapshot,
  after: CreditSnapshot
): AgentCreditUsage {
  const beforeBalance = creditBalance(before);
  const afterBalance = creditBalance(after);
  const observed =
    beforeBalance !== null && afterBalance !== null
      ? Math.max(0, beforeBalance - afterBalance)
      : 0;
  return {
    before_balance: beforeBalance,
    current_balance: afterBalance,
    after_balance: afterBalance,
    observed_stage5_credit_delta: observed,
    stage5_credits_consumed: observed,
    // Both balance snapshots can be authoritative while attribution is not:
    // another app operation may settle between them. Never label this
    // account-wide delta as exact per-operation billing.
    authoritative: false,
    balance_snapshots_authoritative: Boolean(
      before?.authoritative && after?.authoritative
    ),
    attribution_scope: 'account_balance_delta',
    measurement: 'observed_account_balance_delta',
  };
}

function currentAgentCreditUsage(
  usage: AgentCreditUsage | null
): AgentCreditUsage | null {
  if (!usage) return null;
  const current = useCreditStore.getState();
  const currentBalance = Number.isFinite(Number(current.credits))
    ? Number(current.credits)
    : usage.current_balance;
  const observed =
    usage.before_balance !== null && currentBalance !== null
      ? Math.max(0, usage.before_balance - currentBalance)
      : usage.observed_stage5_credit_delta;
  return {
    ...usage,
    current_balance: currentBalance,
    observed_stage5_credit_delta: observed,
    stage5_credits_consumed: observed,
    authoritative: false,
    balance_snapshots_authoritative:
      usage.balance_snapshots_authoritative && current.authoritative,
  };
}

async function runWithStage5CreditObservation(
  operationId: string,
  runner: () => Promise<Record<string, unknown>>,
  onUsage?: (usage: AgentCreditUsage) => void
): Promise<Record<string, unknown>> {
  const before = await agentCreditSnapshot(true).catch(() => null);
  const initial = buildAgentCreditUsage(before, before);
  onUsage?.(initial);
  try {
    const result = await runner();
    const after = await agentCreditSnapshot(true).catch(() => null);
    const usage = buildAgentCreditUsage(before, after);
    onUsage?.(usage);
    return { ...result, operationId, credit_usage: usage };
  } catch (error) {
    const after = await agentCreditSnapshot(true).catch(() => null);
    onUsage?.(buildAgentCreditUsage(before, after));
    throw error;
  }
}

class AgentProcessingCancellationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentProcessingCancellationError';
  }
}

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

  // Track agent-initiated purchase (equivalent to button click)
  void SystemIPC.trackPurchaseEvent('credit_checkout_button_clicked', {
    packId,
    placement: 'agent',
  }).catch(() => {
    // Ignore tracking errors
  });

  await navigateToDestination('settings-credits');

  try {
    const checkoutSessionId = await SystemIPC.createCheckoutSession(packId);
    if (checkoutSessionId === CHECKOUT_ALREADY_PENDING) {
      // already_pending is not a failure, so no failed event
      return {
        opened: true,
        alreadyPending: true,
        pack: CREDIT_PACKS[packId],
        note: 'A credit checkout is already open. The user must complete or cancel it in the browser.',
      };
    }
    if (!checkoutSessionId) {
      // Track session creation failure
      void SystemIPC.trackPurchaseEvent('credit_checkout_failed', {
        packId,
        placement: 'agent',
        failureReason: 'api_error',
      }).catch(() => {
        // Ignore tracking errors
      });
      throw new Error('Translator could not open the secure credit checkout.');
    }
    return {
      opened: true,
      alreadyPending: false,
      pack: CREDIT_PACKS[packId],
      note: 'Stripe checkout is open in the browser. The agent cannot read, enter, or submit card or payment details.',
    };
  } catch (err) {
    // Track session creation failure if not already tracked
    if (err instanceof Error && !err.message.includes('could not open')) {
      const failureReason = String(err).includes('network')
        ? 'network_error'
        : 'api_error';
      void SystemIPC.trackPurchaseEvent('credit_checkout_failed', {
        packId,
        placement: 'agent',
        failureReason,
      }).catch(() => {
        // Ignore tracking errors
      });
    }
    throw err;
  }
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
  if (value.length > MAX_AGENT_HISTORY_ID_LENGTH) {
    throw new Error(
      `A Downloads library entry ID cannot exceed ${MAX_AGENT_HISTORY_ID_LENGTH} characters.`
    );
  }
  return value;
}

function getInternalHistoryRouteToken(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const token = (input as Record<string, unknown>).__agentHistoryRouteToken;
  return typeof token === 'string' && token ? token : undefined;
}

type InternalMcpJobRoute = {
  jobId: string;
  routeToken: string;
};

function getInternalMcpJobId(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const jobId = record.__agentMcpJobId ?? record.mcpJobId;
  return typeof jobId === 'string' && jobId.trim() ? jobId.trim() : null;
}

function getInternalMcpJobRoute(
  input: unknown
): InternalMcpJobRoute | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const jobId = record.__agentMcpJobId;
  const routeToken = record.__agentMcpJobRouteToken;
  return typeof jobId === 'string' &&
    jobId &&
    typeof routeToken === 'string' &&
    routeToken
    ? { jobId, routeToken }
    : undefined;
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
  if (
    input?.recency !== undefined &&
    !VIDEO_SEARCH_RECENCIES.has(input.recency)
  ) {
    throw new Error('Unsupported video search recency.');
  }
  if (
    input?.includeDownloadHistory !== undefined &&
    typeof input.includeDownloadHistory !== 'boolean'
  ) {
    throw new Error('include_download_history must be a boolean.');
  }
  if (
    input?.includeWatchedChannels !== undefined &&
    typeof input.includeWatchedChannels !== 'boolean'
  ) {
    throw new Error('include_watched_channels must be a boolean.');
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
  if (!Array.isArray(input?.ids)) {
    throw new Error('Suggested-video result IDs must be an array.');
  }
  const ids = Array.from(
    new Set(input.ids.map(id => String(id || '').trim()).filter(Boolean))
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
  const { sourceBinding, ...publicProcessingState } = agentProcessingState;
  const taskName = agentProgressTaskFor(
    agentProcessingState.kind,
    agentProcessingState.stage
  );
  const kindTask =
    taskName === 'download'
      ? download.download
      : taskName
        ? tasks[taskName]
        : null;
  const terminalComplete = agentProcessingState.status === 'completed';
  const taskEtaSeconds =
    kindTask && 'etaSeconds' in kindTask ? kindTask.etaSeconds : null;
  const preparingSource = sourceBinding?.state === 'preparing';
  const workspace = projectAgentWorkspaceSnapshot(sourceBinding, {
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
  });
  return {
    ...publicProcessingState,
    credit_usage: currentAgentCreditUsage(agentProcessingState.creditUsage),
    percent:
      preparingSource && agentProcessingState.stage === 'starting'
        ? 0
        : terminalComplete
          ? 100
          : (kindTask?.percent ?? download.download.percent ?? 0),
    etaSeconds:
      (agentProcessingState.progressDetails?.estimated_remaining_seconds as
        | number
        | null
        | undefined) ??
      taskEtaSeconds ??
      null,
    progress: agentProcessingState.progressDetails,
    ...workspace,
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

function retainTerminalAgentProcessingSnapshot(): void {
  if (
    !agentProcessingState.id ||
    !['completed', 'failed', 'cancelled'].includes(agentProcessingState.status)
  ) {
    return;
  }
  terminalAgentOperations.record(
    agentProcessingSnapshot() as {
      id: string;
      status: 'completed' | 'failed' | 'cancelled';
    }
  );
}

function hasActiveAppProcessing(): boolean {
  const tasks = useTaskStore.getState();
  return Boolean(
    agentProcessingState.status === 'running' ||
    agentProcessingState.status === 'cancelling' ||
    activeAgentPreview !== null ||
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
  runner: (agentOperationId: string) => Promise<Record<string, unknown>>,
  requestedOperationId?: unknown,
  mcpJobRoute?: InternalMcpJobRoute,
  sourceBindingInput?: unknown,
  mcpJobId?: string | null
): Record<string, unknown> {
  const requestedId = String(requestedOperationId || '').trim();
  const sourceBinding =
    sourceBindingInput === undefined
      ? null
      : parseAgentSourceBinding(sourceBindingInput);
  if (sourceBindingInput !== undefined && !sourceBinding) {
    throw new Error('Persistent MCP job source binding is invalid.');
  }
  if (mcpJobRoute && !sourceBinding) {
    throw new Error('Persistent MCP job start is missing its source binding.');
  }
  if (mcpJobRoute && mcpJobId && mcpJobRoute.jobId !== mcpJobId) {
    throw new Error('Persistent MCP job source binding has the wrong job ID.');
  }
  if (
    requestedId &&
    (requestedId.length > 200 || /[\p{Cc}]/u.test(requestedId))
  ) {
    throw new Error(
      'Agent operation ID must contain at most 200 printable characters.'
    );
  }
  if (
    requestedId &&
    agentProcessingState.id === requestedId &&
    shouldReuseAgentOperation(agentProcessingState.status)
  ) {
    if (
      !agentSourceBindingIdentitiesMatch(
        agentProcessingState.sourceBinding,
        sourceBinding
      )
    ) {
      throw new Error(
        'The idempotent operation ID is already bound to a different source.'
      );
    }
    // The MCP ledger may replay a start after an uncertain delivery. Return
    // the one already-running or terminal operation instead of charging or
    // rendering twice.
    return agentProcessingState.status === 'completed'
      ? terminalAgentOperations.get(requestedId) || agentProcessingSnapshot()
      : agentProcessingSnapshot();
  }
  const retained = requestedId
    ? terminalAgentOperations.get(requestedId)
    : null;
  if (retained && shouldReuseAgentOperation(retained.status)) {
    return {
      ...retained,
      sourceNote: 'Existing idempotent mounted operation result.',
    };
  }
  if (
    agentProcessingState.status === 'running' ||
    agentProcessingState.status === 'cancelling' ||
    hasActiveAppProcessing()
  ) {
    throw new Error(
      'Translator already has an active processing operation. Poll app_processing_status or cancel it before starting another.'
    );
  }
  if (sourceBinding?.state === 'mounted' && mcpJobId) {
    const mountedVideo = useVideoStore.getState();
    const mountedSubtitles = useSubStore.getState();
    const mountedVideoPath =
      mountedVideo.originalPath ?? mountedVideo.path ?? null;
    if (
      mountedMcpWorkspaceBinding?.jobId !== mcpJobId ||
      !agentSourceBindingsMatch(
        mountedMcpWorkspaceBinding.binding,
        sourceBinding
      ) ||
      mountedMcpWorkspaceBinding.videoPath !== mountedVideoPath ||
      mountedMcpWorkspaceBinding.subtitleSourceId !== mountedSubtitles.sourceId
    ) {
      throw new Error(
        'The planned source is not the workspace mounted for this persistent MCP job.'
      );
    }
  }
  if (sourceBinding?.state === 'preparing') {
    mountedMcpWorkspaceBinding = null;
  }
  const id =
    requestedId ||
    `agent-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  terminalAgentOperations.forget(id);
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
    creditUsage: null,
    progressDetails: null,
    sourceBinding,
  };
  void runWithStage5CreditObservation(
    id,
    () => runner(id),
    usage => {
      if (agentProcessingState.id !== id) return;
      agentProcessingState = { ...agentProcessingState, creditUsage: usage };
    }
  )
    .then(result => {
      if (agentProcessingState.id !== id) return;
      agentProcessingState = {
        ...agentProcessingState,
        // A resolved runner completed before cancellation took effect. Keep its
        // exact result; the persistent job can stop at the next checkpoint.
        status: 'completed',
        stage: 'completed',
        finishedAtIso: new Date().toISOString(),
        result,
        error: null,
      };
      retainTerminalAgentProcessingSnapshot();
    })
    .catch(error => {
      if (agentProcessingState.id !== id) return;
      const cancelled =
        agentProcessingState.cancelRequested ||
        error instanceof AgentProcessingCancellationError ||
        isExplicitCancellation(error);
      const message = error instanceof Error ? error.message : String(error);
      agentProcessingState = {
        ...agentProcessingState,
        status: cancelled ? 'cancelled' : 'failed',
        stage: cancelled ? 'cancelled' : 'failed',
        finishedAtIso: new Date().toISOString(),
        // Some compound operations publish independently verified artifacts
        // before a later child operation fails or is cancelled. Keep that
        // checkpoint visible to the persistent MCP job instead of discarding
        // valid work that can be reused by an exact-operation retry.
        result: agentProcessingState.result,
        error: cancelled ? null : message,
      };
      retainTerminalAgentProcessingSnapshot();
    })
    .finally(() => {
      if (mcpJobRoute) {
        reportMcpJobTerminal(mcpJobRoute, id);
      }
    });
  return agentProcessingSnapshot();
}

function markAgentSourceMounted(agentOperationId: string): void {
  if (
    agentProcessingState.id !== agentOperationId ||
    agentProcessingState.sourceBinding?.state !== 'preparing'
  ) {
    return;
  }
  agentProcessingState = {
    ...agentProcessingState,
    sourceBinding: {
      ...agentProcessingState.sourceBinding,
      state: 'mounted',
    },
  };
}

function throwIfAgentCancelled(): void {
  if (agentProcessingState.cancelRequested) {
    throw new AgentProcessingCancellationError('Operation cancelled.');
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

const historyJobs = new AgentHistoryJobRegistry();

function historyJobSnapshot(job: AgentHistoryJob): Record<string, unknown> {
  return { ...job, credit_usage: job.creditUsage };
}

function registerHistoryProgress(
  historyId: string,
  operationId: string
): () => void {
  return agentBackgroundOperations.register(operationId, progress => {
    const percent =
      typeof progress.percent === 'number' && Number.isFinite(progress.percent)
        ? progress.percent
        : undefined;
    const stage =
      typeof progress.stage === 'string' && progress.stage.trim()
        ? progress.stage
        : undefined;
    historyJobs.update(historyId, operationId, {
      ...(percent === undefined ? {} : { percent }),
      ...(stage === undefined ? {} : { stage }),
    });
  });
}

class AgentHistoryCancellationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentHistoryCancellationError';
  }
}

function finishHistoryJobWithError(
  historyId: string,
  operationId: string,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error);
  const current = historyJobs.get(historyId);
  const cancelled =
    current?.operationId === operationId && current.status === 'cancelling'
      ? true
      : error instanceof AgentHistoryCancellationError ||
        isExplicitCancellation(error);
  historyJobs.finish(historyId, operationId, {
    status: cancelled ? 'cancelled' : 'failed',
    error: cancelled ? null : message,
  });
}

function refreshCreditsAfterBackgroundAiJob(): void {
  try {
    void SystemIPC.refreshCreditSnapshot(true).catch(() => undefined);
  } catch {
    // The job result is already authoritative. Renderer teardown can make the
    // best-effort credit refresh throw synchronously, and must not rewrite it.
  }
}

function reportHistoryJobTerminal(
  historyId: string,
  operationId: string,
  routeToken: string
): void {
  try {
    SystemIPC.reportAgentHistoryJobTerminal({
      historyId,
      operationId,
      routeToken,
    });
  } catch {
    // Main also prunes destroyed renderers. A terminal acknowledgement sent
    // during renderer teardown is best effort and must not become an
    // unhandled rejection after the background job has already settled.
  }
}

function reportMcpJobTerminal(
  route: InternalMcpJobRoute,
  operationId: string
): void {
  try {
    SystemIPC.reportAgentMcpJobTerminal({
      jobId: route.jobId,
      operationId,
      routeToken: route.routeToken,
    });
  } catch {
    // Main independently prunes destroyed renderers. The exact terminal
    // acknowledgement is best effort during renderer teardown.
  }
}

function throwIfHistoryJobCancelled(
  historyId: string,
  operationId: string
): void {
  const job = historyJobs.get(historyId);
  if (
    job?.operationId === operationId &&
    (job.status === 'cancelling' || job.status === 'cancelled')
  ) {
    throw new AgentHistoryCancellationError('Operation cancelled.');
  }
}

function beginHistoryProcessing(
  kind: AgentHistoryJobKind,
  historyId: string,
  runner: (operationId: string) => Promise<Record<string, unknown>>,
  routeToken?: string,
  requestedOperationId?: unknown,
  mcpJobRoute?: InternalMcpJobRoute
): Record<string, unknown> {
  const normalizedHistoryId = String(historyId || '').trim();
  if (!normalizedHistoryId) throw new Error('A history ID is required.');
  if (normalizedHistoryId.length > MAX_AGENT_HISTORY_ID_LENGTH) {
    throw new Error(
      `A history ID cannot exceed ${MAX_AGENT_HISTORY_ID_LENGTH} characters.`
    );
  }

  const requestedId = String(requestedOperationId || '').trim();
  if (requestedId && !isAgentHistoryOperationId(requestedId)) {
    throw new Error(
      'Persistent history operation ID has an invalid structure.'
    );
  }
  const existing = historyJobs.get(normalizedHistoryId);
  if (
    existing?.operationId === requestedId &&
    requestedId &&
    shouldReuseAgentOperation(existing.status)
  ) {
    return {
      ...historyJobSnapshot(existing),
      sourceNote: 'Existing idempotent library job.',
    };
  }
  const retained = requestedId
    ? historyJobs.getByOperationId(requestedId)
    : null;
  if (
    retained?.historyId === normalizedHistoryId &&
    shouldReuseAgentOperation(retained.status)
  ) {
    return {
      ...historyJobSnapshot(retained),
      sourceNote: 'Existing idempotent library operation result.',
    };
  }
  if (existing?.inProgress) {
    throw new Error(
      `Library item already has an active ${existing.kind} operation.`
    );
  }
  const operationId = requestedId || createAgentHistoryOperationId(kind);
  const job = historyJobs.start({
    operationId,
    historyId: normalizedHistoryId,
    kind,
    stage: `preparing-${kind}`,
  });

  void runWithStage5CreditObservation(
    operationId,
    () => runner(operationId),
    usage => {
      historyJobs.update(normalizedHistoryId, operationId, {
        creditUsage: usage,
      });
    }
  )
    .then(result => {
      historyJobs.finish(normalizedHistoryId, operationId, {
        status: 'completed',
        result,
      });
    })
    .catch(error => {
      finishHistoryJobWithError(normalizedHistoryId, operationId, error);
    })
    .finally(() => {
      if (routeToken) {
        reportHistoryJobTerminal(normalizedHistoryId, operationId, routeToken);
      }
      if (mcpJobRoute) {
        reportMcpJobTerminal(mcpJobRoute, operationId);
      }
    });

  return {
    ...historyJobSnapshot(job),
    sourceNote: 'Job started for a library item.',
  };
}

async function runHistoryTranscription(
  operationId: string,
  historyId: string,
  expectedVideoPath?: string
): Promise<Record<string, unknown>> {
  const finishProgress = registerHistoryProgress(historyId, operationId);

  try {
    const { item, videoPath } = await requireHistoryVideo(historyId);
    if (
      expectedVideoPath &&
      String(expectedVideoPath).trim() !== String(videoPath).trim()
    ) {
      throw new Error(
        'The library item video changed after the persistent job integrity check.'
      );
    }
    throwIfHistoryJobCancelled(historyId, operationId);

    historyJobs.update(historyId, operationId, { stage: 'transcribing' });
    const opts: GenerateSubtitlesOptions = {
      targetLanguage: 'original',
      streamResults: true,
      videoPath,
      operationId,
      qualityTranscription: useUIStore.getState().qualityTranscription,
    };
    const result = await SubtitlesIPC.generate(opts);
    if (!result.success || !result.subtitles) {
      if (result.cancelled) {
        throw new AgentHistoryCancellationError('Transcription cancelled.');
      }
      throw new Error(result.error || 'Transcription failed.');
    }

    throwIfHistoryJobCancelled(historyId, operationId);
    const finalSegments =
      Array.isArray(result.segments) && result.segments.length > 0
        ? result.segments
        : parseSrt(result.subtitles);
    if (!finalSegments.length) {
      throw new Error('Transcription returned no subtitle cues.');
    }

    await storeGeneratedSubtitleArtifact({
      content: result.subtitles,
      segments: finalSegments,
      kind: 'transcription',
      sourceVideoPath: videoPath,
      sourceUrl: item.sourceUrl,
      titleHint: item.title,
    });

    const completed = {
      operationId,
      historyId,
      videoPath,
      cueCount: finalSegments.length,
      transcriptionEngine: result.transcriptionEngine ?? null,
      sourceNote: 'Transcription completed without remounting the active tab.',
    };
    return completed;
  } finally {
    finishProgress();
    refreshCreditsAfterBackgroundAiJob();
  }
}

async function runHistoryTranslation(
  operationId: string,
  historyId: string,
  targetLanguage: string
): Promise<Record<string, unknown>> {
  const language = String(targetLanguage || '').trim();
  if (!language) throw new Error('A target language is required.');
  const finishProgress = registerHistoryProgress(historyId, operationId);

  try {
    const loaded = await loadSubtitlesFromHistory(historyId);
    const segments = loaded.segments;
    throwIfHistoryJobCancelled(historyId, operationId);

    historyJobs.update(historyId, operationId, { stage: 'translating' });
    const srtContent = buildSrt({ segments, mode: 'dual' });
    const qualityTranslation = useUIStore.getState().qualityTranslation;
    const res = await SubtitlesIPC.translateSubtitles({
      subtitles: srtContent,
      targetLanguage: language,
      operationId,
      qualityTranslation,
    });
    if (!res?.success || !res.translatedSubtitles) {
      if (res?.cancelled) {
        throw new AgentHistoryCancellationError('Translation cancelled.');
      }
      throw new Error(res?.error || 'Translation failed.');
    }

    throwIfHistoryJobCancelled(historyId, operationId);
    const translatedSegments = parseSrt(res.translatedSubtitles);
    if (!translatedSegments.length) {
      throw new Error('Translation returned no subtitle cues.');
    }
    const finalSegments = preserveWordTimingsOnTranslatedSegments(
      segments,
      translatedSegments
    );
    await storeGeneratedSubtitleArtifact({
      content: res.translatedSubtitles,
      segments: finalSegments,
      kind: 'translation',
      targetLanguage: language,
      sourceVideoPath: loaded.videoPath,
      sourceUrl: loaded.item.sourceUrl,
      titleHint: loaded.item.title,
    });

    const completed = {
      operationId,
      historyId,
      targetLanguage: language,
      cueCount: finalSegments.length,
      translatedCueCount: finalSegments.filter(segment =>
        Boolean(segment.translation?.trim())
      ).length,
      sourceNote: 'Translation completed without remounting the active tab.',
    };
    return completed;
  } finally {
    finishProgress();
    refreshCreditsAfterBackgroundAiJob();
  }
}

async function runHistoryMerge(
  operationId: string,
  historyId: string,
  input: { outputPath?: string; overwrite?: boolean }
): Promise<Record<string, unknown>> {
  const outputPath = String(input.outputPath || '').trim();
  if (!outputPath) throw new Error('An explicit output path is required.');
  if (!/\.mp4$/i.test(outputPath)) {
    throw new Error('Merged video output path must end in .mp4.');
  }
  const finishProgress = registerHistoryProgress(historyId, operationId);

  try {
    if (
      window.env.isPackaged &&
      !(await SystemIPC.checkAgentPathAllowed(outputPath))
    ) {
      throw new Error(
        'Merge output path is outside the allowed directories. Configure allowed directories in Settings → Agent Control.'
      );
    }

    const loaded = await loadSubtitlesFromHistory(historyId);
    const { videoPath, segments } = loaded;
    throwIfHistoryJobCancelled(historyId, operationId);

    const ui = useUIStore.getState();
    const metadataResult = await SystemIPC.getVideoMetadata(videoPath);
    if (!metadataResult.success || !metadataResult.metadata) {
      throw new Error(
        metadataResult.error || 'Could not read video metadata for merge.'
      );
    }
    const videoMeta = metadataResult.metadata;
    const subtitleRenderSpec = resolveSubtitleRenderSpec({
      displayMode: ui.subtitleDisplayMode,
      stylePreset: ui.subtitleStyle,
      baseFontSizePx: ui.baseFontSize,
      videoWidthPx: videoMeta.width,
      videoHeightPx: videoMeta.height,
      displayWidthPx: videoMeta.displayWidth ?? videoMeta.width,
      displayHeightPx: videoMeta.displayHeight ?? videoMeta.height,
    });
    const fontSizePx = subtitleRenderSpec.outputFontSizePx;
    historyJobs.update(historyId, operationId, { stage: 'merging' });
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
      videoDuration: videoMeta.duration,
      videoWidth: videoMeta.width ?? 1280,
      videoHeight: videoMeta.height ?? 720,
      displayWidth: videoMeta.displayWidth ?? videoMeta.width ?? 1280,
      displayHeight: videoMeta.displayHeight ?? videoMeta.height ?? 720,
      videoRotationDeg: videoMeta.rotation ?? 0,
      frameRate: Number(videoMeta.frameRate ?? 30),
      originalVideoPath: videoPath,
      fontSizePx,
      stylePreset: ui.subtitleStyle,
      subtitleRenderSpec: serializeSubtitleRenderSpec(subtitleRenderSpec),
      outputMode: ui.subtitleDisplayMode,
      overlayMode: 'overlayOnVideo',
    };
    const result = await subtitleRendererClient.renderSubtitles(options);
    if (!result.success || !result.outputPath) {
      if (result.cancelled) {
        throw new AgentHistoryCancellationError('Merge cancelled.');
      }
      throw new Error(result.error || 'Merge failed.');
    }

    const completed = {
      operationId,
      historyId,
      outputPath: result.outputPath,
      videoPath,
      cueCount: segments.length,
      sourceNote: 'Merge completed without remounting the active tab.',
    };
    return completed;
  } finally {
    finishProgress();
  }
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
    if (result.cancelled) {
      throw new AgentProcessingCancellationError('Transcription cancelled.');
    }
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
    if (result.cancelled) {
      throw new AgentProcessingCancellationError('Translation cancelled.');
    }
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
    sourceVideoPath?: string;
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
    String(input.sourceVideoPath || '').trim() ||
    video.originalPath ||
    subtitles.sourceVideoPath ||
    video.path ||
    null;
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
    if (result.cancelled) {
      throw new AgentProcessingCancellationError('Dubbing cancelled.');
    }
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
    sourceVideoPath?: string;
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
    const terminalKind =
      percent >= 100
        ? classifyTerminalProgress({
            stage: progress.stage,
            percent,
            error: progress.error,
          })
        : null;
    useTaskStore.getState().setSummary({
      id: operationId,
      stage: String(progress.stage || 'Generating summary'),
      percent,
      inProgress: terminalKind === null,
      ...(terminalKind ? { isCompleted: terminalKind === 'completed' } : {}),
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
        String(input.sourceVideoPath || '').trim() ||
        video.originalPath ||
        subtitles.sourceVideoPath ||
        video.path ||
        null,
      includeHighlights: input.includeHighlights !== false,
      effortLevel,
    });
    if (result.cancelled) {
      throw new AgentProcessingCancellationError(
        'Summary generation cancelled.'
      );
    }
    if (result.error) throw new Error(result.error);
    if (result.success === false) {
      throw new Error('Summary generation failed.');
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
    if (result.cancelled) throw new Error('Operation cancelled');
    if (!result.success) {
      throw new Error(result.error || 'Cue translation failed.');
    }
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
    isCompleted: false,
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
    if (result.cancelled) {
      throw new AgentProcessingCancellationError(
        'Cue transcription cancelled.'
      );
    }
    if (result.error) throw new Error(result.error);
    if (result.success === false) {
      throw new Error('Cue transcription failed.');
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
      isCompleted: false,
    });
  }
}

function assertPlannedSubtitleRenderSpecCompatible(
  plannedSpec: Record<string, unknown> | undefined,
  resolvedSpec: ReturnType<typeof resolveSubtitleRenderSpec>
): void {
  if (!plannedSpec) return;
  if (plannedSpec.schema_version !== 1) {
    throw new Error('Unsupported planned subtitle render spec version.');
  }
  for (const [plannedKey, resolvedValue] of [
    ['base_font_size_px', resolvedSpec.baseFontSizePx],
    ['output_font_size_px', resolvedSpec.outputFontSizePx],
    ['video_width_px', resolvedSpec.videoWidthPx],
    ['video_height_px', resolvedSpec.videoHeightPx],
    ['display_width_px', resolvedSpec.displayWidthPx],
    ['display_height_px', resolvedSpec.displayHeightPx],
  ] as const) {
    const rawPlannedValue = plannedSpec[plannedKey];
    if (rawPlannedValue === null || rawPlannedValue === undefined) continue;
    const plannedValue = Number(rawPlannedValue);
    if (!Number.isFinite(plannedValue)) {
      throw new Error(`Planned subtitle render spec ${plannedKey} is invalid.`);
    }
    if (plannedValue !== resolvedValue) {
      throw new Error(
        `Planned subtitle render spec ${plannedKey} does not match the mounted video.`
      );
    }
  }
  if (plannedSpec.font_family !== resolvedSpec.fontFamily) {
    throw new Error('Planned subtitle render font family is unsupported.');
  }
  if (plannedSpec.font_asset !== resolvedSpec.fontAsset) {
    throw new Error('Planned subtitle render font asset is unsupported.');
  }
  if (plannedSpec.scale_rule !== resolvedSpec.scaleRule) {
    throw new Error('Planned subtitle render scale rule is unsupported.');
  }
}

async function runAgentMerge(
  agentOperationId: string,
  input: {
    outputPath?: string;
    overwrite?: boolean;
    sourceVideoPath?: string;
    subtitleDisplayMode?: SubtitleDisplayMode;
    subtitleStyle?: SubtitleStylePresetKey;
    subtitleFontSize?: number;
    subtitleRenderSpec?: Record<string, unknown>;
  }
): Promise<Record<string, unknown>> {
  const outputPath = String(input.outputPath || '').trim();
  if (!outputPath) throw new Error('An explicit output path is required.');
  if (!/\.mp4$/i.test(outputPath)) {
    throw new Error('Merged video output path must end in .mp4.');
  }

  // In packaged mode, enforce allowlist
  if (window.env.isPackaged) {
    const allowed = await SystemIPC.checkAgentPathAllowed(outputPath);
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
    String(input.sourceVideoPath || '').trim() ||
    video.originalPath ||
    subtitles.sourceVideoPath ||
    video.path ||
    null;
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
  const plannedSpec = input.subtitleRenderSpec;
  const displayMode =
    (plannedSpec?.display_mode as SubtitleDisplayMode | undefined) ||
    input.subtitleDisplayMode ||
    ui.subtitleDisplayMode;
  if (!DISPLAY_MODES.has(displayMode)) {
    throw new Error('Unsupported planned subtitle display mode.');
  }
  const subtitleStyle =
    (plannedSpec?.style as SubtitleStylePresetKey | undefined) ||
    input.subtitleStyle ||
    ui.subtitleStyle;
  if (!Object.hasOwn(SUBTITLE_STYLE_PRESETS, subtitleStyle)) {
    throw new Error('Unsupported planned subtitle style.');
  }
  const plannedBaseFontSize = Number(plannedSpec?.base_font_size_px);
  const legacyBaseFontSize = Number(input.subtitleFontSize);
  if (
    Number.isFinite(plannedBaseFontSize) &&
    Number.isFinite(legacyBaseFontSize) &&
    plannedBaseFontSize !== legacyBaseFontSize
  ) {
    throw new Error(
      'Planned subtitle render spec conflicts with the legacy font-size field.'
    );
  }
  if (
    plannedSpec?.style !== undefined &&
    input.subtitleStyle !== undefined &&
    plannedSpec.style !== input.subtitleStyle
  ) {
    throw new Error(
      'Planned subtitle render spec conflicts with the legacy style field.'
    );
  }
  if (
    plannedSpec?.display_mode !== undefined &&
    input.subtitleDisplayMode !== undefined &&
    plannedSpec.display_mode !== input.subtitleDisplayMode
  ) {
    throw new Error(
      'Planned subtitle render spec conflicts with the legacy display-mode field.'
    );
  }
  const baseFontSize = normalizeSubtitleBaseFontSize(
    Number.isFinite(plannedBaseFontSize)
      ? plannedBaseFontSize
      : Number.isFinite(legacyBaseFontSize)
        ? legacyBaseFontSize
        : ui.baseFontSize
  );
  if (plannedSpec) {
    const changedPreviewFields = findSubtitlePreviewSelectionDrift(
      plannedSpec,
      {
        displayMode: ui.subtitleDisplayMode,
        stylePreset: ui.subtitleStyle,
        baseFontSizePx: ui.baseFontSize,
      }
    );
    if (changedPreviewFields.length > 0) {
      throw new Error(
        `Translator preview subtitle settings changed after this render was planned (${changedPreviewFields.join(', ')}). Restore the planned preview settings or create a new plan before rendering.`
      );
    }
  }
  const subtitleRenderSpec = resolveSubtitleRenderSpec({
    displayMode,
    stylePreset: subtitleStyle,
    baseFontSizePx: baseFontSize,
    videoWidthPx: video.meta?.width,
    videoHeightPx: video.meta?.height,
    displayWidthPx: video.meta?.displayWidth ?? video.meta?.width,
    displayHeightPx: video.meta?.displayHeight ?? video.meta?.height,
    isAudioOnly: video.isAudioOnly,
  });
  assertPlannedSubtitleRenderSpecCompatible(plannedSpec, subtitleRenderSpec);
  const fontSizePx = subtitleRenderSpec.outputFontSizePx;
  const options: RenderSubtitlesOptions = {
    operationId,
    srtContent: buildSrt({
      segments,
      mode: displayMode,
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
    stylePreset: subtitleStyle,
    subtitleRenderSpec: serializeSubtitleRenderSpec(subtitleRenderSpec),
    outputMode: displayMode,
    overlayMode: video.isAudioOnly ? 'blackVideo' : 'overlayOnVideo',
  };
  useTaskStore.getState().setMerge({
    id: operationId,
    stage: 'Starting merge',
    percent: 0,
    inProgress: true,
    isCompleted: false,
  });
  agentProcessingState = {
    ...agentProcessingState,
    stage: 'merging',
  };
  try {
    const result = await subtitleRendererClient.renderSubtitles(options);
    if (!result.success || !result.outputPath) {
      if (result.cancelled) {
        throw new AgentProcessingCancellationError('Merge cancelled.');
      }
      throw new Error(result.error || 'Translator could not merge subtitles.');
    }
    return {
      operationId,
      outputPath: result.outputPath,
      mode: displayMode,
      style: subtitleStyle,
      fontSizePx,
      subtitle_render_spec: serializeSubtitleRenderSpec(subtitleRenderSpec),
    };
  } finally {
    useTaskStore.getState().setMerge({
      id: null,
      inProgress: false,
    });
  }
}

const AGENT_ENCODING_PRESETS = new Set([
  'youtube_1080p',
  'youtube_4k',
  'x_long_video_720p',
  'x_long_video_1080p',
  'archive_master',
  'preview_low_resolution',
]);
const WINDOWS_RESERVED_AGENT_BASENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_AGENT_OUTPUT_BASE_NAME_UTF8_BYTES = 160;

function cleanAgentOutputBaseName(value: unknown): string {
  let cleaned =
    String(value || 'translator-output')
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim() || 'translator-output';
  if (WINDOWS_RESERVED_AGENT_BASENAME.test(cleaned)) cleaned = `_${cleaned}`;
  const encoder = new TextEncoder();
  const segments = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  }).segment(cleaned);
  let result = '';
  let bytes = 0;
  for (const { segment } of segments) {
    const segmentBytes = encoder.encode(segment).byteLength;
    if (bytes + segmentBytes > MAX_AGENT_OUTPUT_BASE_NAME_UTF8_BYTES) break;
    result += segment;
    bytes += segmentBytes;
  }
  return result || 'translator-output';
}

function joinAgentOutputPath(directory: string, name: string): string {
  const separator = directory.includes('\\') ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/g, '')}${separator}${name}`;
}

async function stableAgentOperationSuffix(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

async function runAgentPresetRender(
  agentOperationId: string,
  input?: {
    sourceVideoPath?: string;
    protectedInputPaths?: string[];
    outputs?: {
      output_directory?: string;
      base_name?: string;
      presets?: string[];
      overwrite?: boolean;
      burn_subtitles?: boolean;
      subtitle_display_mode?: SubtitleDisplayMode;
      subtitle_style?: SubtitleStylePresetKey;
      subtitle_font_size?: number;
      subtitle_render_spec?: Record<string, unknown>;
      x_account_tier?: 'standard' | 'premium';
    };
  }
): Promise<Record<string, unknown>> {
  const outputs = input?.outputs || {};
  const outputDirectory = String(outputs.output_directory || '').trim();
  if (!outputDirectory)
    throw new Error('Planned video rendering requires an output directory.');
  const presets = Array.isArray(outputs.presets) ? outputs.presets : [];
  if (!presets.length)
    throw new Error('Planned video rendering requires at least one preset.');
  if (new Set(presets).size !== presets.length) {
    throw new Error('Encoding presets cannot be duplicated.');
  }
  for (const preset of presets) {
    if (!AGENT_ENCODING_PRESETS.has(preset)) {
      throw new Error(`Unsupported encoding preset: ${preset}`);
    }
  }
  const baseName = cleanAgentOutputBaseName(outputs.base_name);
  const stableSuffix = await stableAgentOperationSuffix(agentOperationId);
  const temporaryMaster = joinAgentOutputPath(
    outputDirectory,
    `${baseName}.mcp-master-${stableSuffix}.mp4`
  );
  const burnSubtitles = outputs.burn_subtitles !== false;
  const reusableOutputs = new Map<string, Record<string, unknown>>();
  const completedOutputs = (): Array<Record<string, unknown>> =>
    presets.flatMap(preset => {
      const output = reusableOutputs.get(preset);
      return output ? [output] : [];
    });
  const checkpointCompletedOutputs = (): void => {
    if (reusableOutputs.size === 0) return;
    agentProcessingState = {
      ...agentProcessingState,
      result: {
        operationId: agentOperationId,
        outputs: completedOutputs(),
        incomplete: true,
        completed_preset_count: reusableOutputs.size,
        preset_count: presets.length,
        burned_subtitles: burnSubtitles,
      },
    };
  };
  for (let index = 0; index < presets.length; index += 1) {
    const preset = presets[index];
    const outputPath = joinAgentOutputPath(
      outputDirectory,
      `${baseName}-${preset}.mp4`
    );
    if (!(await window.fileApi.fileExists(outputPath))) continue;
    const expectedOperationId = `${agentOperationId}-encode-${index + 1}`;
    const inspected = await SystemIPC.agentV2InspectMedia({
      path: outputPath,
      expectedPreset: preset,
      expectedOperationId,
      xAccountTier: outputs.x_account_tier || 'standard',
    }).catch(() => null);
    if (
      inspected?.passed === true &&
      inspected.operation_receipt_valid === true
    ) {
      reusableOutputs.set(preset, {
        preset,
        path: outputPath,
        metadata: inspected,
        reused: true,
      });
    }
  }
  checkpointCompletedOutputs();
  if (reusableOutputs.size === presets.length) {
    if (burnSubtitles) {
      await SystemIPC.agentV2DeleteTemporaryOutput({
        path: temporaryMaster,
        operationId: agentOperationId,
      });
    }
    return {
      operationId: agentOperationId,
      outputs: completedOutputs(),
      reused_intermediate_master: false,
      burned_subtitles: burnSubtitles,
      recovered_after_restart: true,
    };
  }
  let transcodeSource: string | null = null;
  let reusedIntermediateMaster = false;
  let renderError: unknown = null;
  let cleanupError: unknown = null;
  let renderResult: Record<string, unknown> | null = null;
  try {
    if (burnSubtitles) {
      if (await window.fileApi.fileExists(temporaryMaster)) {
        const inspectedMaster = await SystemIPC.agentV2InspectMedia({
          path: temporaryMaster,
          expectedOperationId: agentOperationId,
          expectedReceiptKind: 'temporary_master',
        }).catch(() => null);
        reusedIntermediateMaster =
          inspectedMaster?.passed === true &&
          inspectedMaster.operation_receipt_valid === true;
      }
      if (!reusedIntermediateMaster) {
        agentProcessingState = {
          ...agentProcessingState,
          stage: 'rendering subtitle master',
        };
        await SystemIPC.agentV2DeleteTemporaryOutput({
          path: temporaryMaster,
          operationId: agentOperationId,
        });
        await SystemIPC.agentV2ReserveTemporaryOutput({
          path: temporaryMaster,
          operationId: agentOperationId,
        });
        await runAgentMerge(agentOperationId, {
          outputPath: temporaryMaster,
          overwrite: false,
          sourceVideoPath: input?.sourceVideoPath,
          subtitleDisplayMode: outputs.subtitle_display_mode,
          subtitleStyle: outputs.subtitle_style,
          subtitleFontSize: outputs.subtitle_font_size,
          subtitleRenderSpec: outputs.subtitle_render_spec,
        });
        await SystemIPC.agentV2ClaimTemporaryOutput({
          path: temporaryMaster,
          operationId: agentOperationId,
        });
        throwIfAgentCancelled();
      }
      transcodeSource = temporaryMaster;
    } else {
      transcodeSource =
        String(input?.sourceVideoPath || '').trim() ||
        useVideoStore.getState().originalPath ||
        useSubStore.getState().sourceVideoPath ||
        useVideoStore.getState().path ||
        null;
      if (
        !transcodeSource ||
        !(await window.fileApi.fileExists(transcodeSource))
      ) {
        throw new Error(
          'The planned source video is unavailable for encoding.'
        );
      }
    }
    throwIfAgentCancelled();

    for (let index = 0; index < presets.length; index += 1) {
      const preset = presets[index];
      const outputPath = joinAgentOutputPath(
        outputDirectory,
        `${baseName}-${preset}.mp4`
      );
      const reusable = reusableOutputs.get(preset);
      if (reusable) {
        continue;
      }
      const transcodeOperationId = `${agentOperationId}-encode-${index + 1}`;
      agentProcessingState = {
        ...agentProcessingState,
        stage: `encoding ${preset} (${index + 1}/${presets.length})`,
      };
      useTaskStore.getState().setMerge({
        id: transcodeOperationId,
        stage: agentProcessingState.stage,
        percent: 0,
        inProgress: true,
        isCompleted: false,
      });
      const removeProgress = SystemIPC.onAgentV2TranscodeProgress(progress => {
        if (progress.operationId !== transcodeOperationId) return;
        const percent = Math.max(
          0,
          Math.min(100, Number(progress.percent || 0))
        );
        useTaskStore.getState().setMerge({
          percent,
          stage: `Encoding ${preset}: ${Math.round(percent)}%`,
          etaSeconds:
            typeof progress.estimated_remaining_seconds === 'number'
              ? progress.estimated_remaining_seconds
              : undefined,
          current:
            typeof progress.estimated_frames_processed === 'number'
              ? progress.estimated_frames_processed
              : undefined,
          unit: 'frames',
        });
        agentProcessingState = {
          ...agentProcessingState,
          progressDetails: {
            preset,
            preset_index: index + 1,
            preset_count: presets.length,
            frames_processed:
              typeof progress.estimated_frames_processed === 'number'
                ? progress.estimated_frames_processed
                : null,
            encoding_frames_per_second:
              typeof progress.encoding_frames_per_second === 'number'
                ? progress.encoding_frames_per_second
                : null,
            encoding_speed_realtime:
              typeof progress.encoding_speed_realtime === 'number'
                ? progress.encoding_speed_realtime
                : null,
            output_bytes:
              typeof progress.output_bytes === 'number'
                ? progress.output_bytes
                : null,
            estimated_final_bytes:
              typeof progress.estimated_final_bytes === 'number'
                ? progress.estimated_final_bytes
                : null,
            estimated_remaining_seconds:
              typeof progress.estimated_remaining_seconds === 'number'
                ? progress.estimated_remaining_seconds
                : null,
          },
        };
      });
      try {
        const metadata = await SystemIPC.agentV2TranscodeOutput({
          operationId: transcodeOperationId,
          sourcePath: transcodeSource,
          outputPath,
          preset,
          overwrite: outputs.overwrite === true,
          protectedPaths: input?.protectedInputPaths,
        });
        reusableOutputs.set(preset, {
          preset,
          path: outputPath,
          metadata,
          reused: false,
        });
        checkpointCompletedOutputs();
      } finally {
        removeProgress();
      }
      throwIfAgentCancelled();
    }
    renderResult = {
      operationId: agentOperationId,
      outputs: completedOutputs(),
      incomplete: false,
      reused_intermediate_master: reusedIntermediateMaster,
      shared_intermediate_master_across_presets:
        burnSubtitles && presets.length > 1,
      burned_subtitles: burnSubtitles,
    };
  } catch (error) {
    renderError = error;
  } finally {
    useTaskStore.getState().setMerge({ id: null, inProgress: false });
    if (burnSubtitles) {
      try {
        await SystemIPC.agentV2DeleteTemporaryOutput({
          path: temporaryMaster,
          operationId: agentOperationId,
        });
      } catch (error) {
        cleanupError = error;
      }
    }
  }
  if (renderError && cleanupError) {
    throw new AggregateError(
      [renderError, cleanupError],
      `Preset rendering failed and its temporary master could not be removed: ${temporaryMaster}`
    );
  }
  if (renderError) throw renderError;
  if (cleanupError) {
    throw new Error(
      `Preset outputs completed, but the temporary master could not be removed: ${temporaryMaster}`,
      { cause: cleanupError }
    );
  }
  if (!renderResult) {
    throw new Error('Preset rendering ended without a result.');
  }
  return renderResult;
}

type AgentPreviewInput = {
  operationId?: string;
  sourceVideoPath?: string;
  protectedInputPaths?: string[];
  outputs?: {
    output_directory?: string;
    base_name?: string;
    overwrite?: boolean;
    subtitle_display_mode?: SubtitleDisplayMode;
    subtitle_style?: SubtitleStylePresetKey;
    subtitle_font_size?: number;
    subtitle_render_spec?: Record<string, unknown>;
  };
};

async function performAgentPreview(
  input: AgentPreviewInput | undefined
): Promise<Record<string, unknown>> {
  const video = useVideoStore.getState();
  const subtitles = useSubStore.getState();
  const videoPath =
    String(input?.sourceVideoPath || '').trim() ||
    video.originalPath ||
    subtitles.sourceVideoPath ||
    video.path ||
    null;
  if (!videoPath) {
    throw new Error(
      'A mounted source video is required for preview rendering.'
    );
  }
  const segments = subtitles.order.map(id => subtitles.segments[id]);
  if (!segments.length) {
    throw new Error('Mounted subtitles are required for preview rendering.');
  }
  const outputDirectory = String(input?.outputs?.output_directory || '').trim();
  if (!outputDirectory)
    throw new Error('Preview rendering requires an output directory.');
  const representative = [0.1, 0.5, 0.9].map(ratio => {
    const index = Math.min(
      segments.length - 1,
      Math.floor((segments.length - 1) * ratio)
    );
    return segments[index].start;
  });
  const displayMode =
    (input?.outputs?.subtitle_render_spec?.display_mode as
      | SubtitleDisplayMode
      | undefined) ||
    input?.outputs?.subtitle_display_mode ||
    'translation';
  if (!DISPLAY_MODES.has(displayMode)) {
    throw new Error('Unsupported planned subtitle display mode.');
  }
  const stylePreset =
    (input?.outputs?.subtitle_render_spec?.style as
      | SubtitleStylePresetKey
      | undefined) ||
    input?.outputs?.subtitle_style ||
    'Default';
  const plannedSpec = input?.outputs?.subtitle_render_spec;
  const plannedBaseFontSize = Number(
    input?.outputs?.subtitle_render_spec?.base_font_size_px
  );
  const baseFontSize = normalizeSubtitleBaseFontSize(
    Number.isFinite(plannedBaseFontSize)
      ? plannedBaseFontSize
      : Number(input?.outputs?.subtitle_font_size) || 24
  );
  const metadataResult = await SystemIPC.getVideoMetadata(videoPath);
  if (!metadataResult.success || !metadataResult.metadata) {
    throw new Error(
      metadataResult.error || 'Could not read video metadata for preview.'
    );
  }
  const metadata = metadataResult.metadata;
  const subtitleRenderSpec = resolveSubtitleRenderSpec({
    displayMode,
    stylePreset,
    baseFontSizePx: baseFontSize,
    videoWidthPx: metadata.width,
    videoHeightPx: metadata.height,
    displayWidthPx: metadata.displayWidth ?? metadata.width,
    displayHeightPx: metadata.displayHeight ?? metadata.height,
    isAudioOnly: video.isAudioOnly,
  });
  assertPlannedSubtitleRenderSpecCompatible(plannedSpec, subtitleRenderSpec);
  const result = await SystemIPC.agentV2RenderPreview({
    operationId: input?.operationId,
    videoPath,
    srtContent: buildSrt({
      segments,
      mode: displayMode,
      noWrap: true,
    }),
    outputDirectory,
    baseName: `${cleanAgentOutputBaseName(input?.outputs?.base_name)}-preview`,
    overwrite: input?.outputs?.overwrite === true,
    positionsSeconds: representative,
    subtitleStyle: subtitleRenderSpec.stylePreset,
    subtitleFontSize: subtitleRenderSpec.outputFontSizePx,
    protectedPaths: input?.protectedInputPaths,
  });
  return {
    ...result,
    subtitle_render_spec: serializeSubtitleRenderSpec(subtitleRenderSpec),
  };
}

function renderAgentPreview(
  input?: AgentPreviewInput
): Promise<Record<string, unknown>> {
  const requestedOperationId = String(input?.operationId || '').trim();
  if (
    activeAgentPreview &&
    requestedOperationId &&
    activeAgentPreview.operationId === requestedOperationId
  ) {
    return activeAgentPreview.promise;
  }
  if (activeAgentPreview || hasActiveAppProcessing()) {
    return Promise.reject(
      new Error('Translator is busy with another processing operation.')
    );
  }
  const operationId =
    requestedOperationId ||
    `agent-preview-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const mcpJobRoute = getInternalMcpJobRoute(input);
  const previewPromise = performAgentPreview({ ...input, operationId }).finally(
    () => {
      if (activeAgentPreview?.promise === previewPromise) {
        activeAgentPreview = null;
      }
      if (mcpJobRoute) {
        reportMcpJobTerminal(mcpJobRoute, operationId);
      }
    }
  );
  activeAgentPreview = { operationId, promise: previewPromise };
  return previewPromise;
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
  const completedResult = result?.success ? result : null;
  const captionRecovery =
    completedResult?.captionRecovery?.kind === 'youtube_automatic_captions' &&
    completedResult.captionRecovery.mediaFailure === 'http_403'
      ? completedResult.captionRecovery
      : null;
  if (captionRecovery) {
    const recoveredSegments = parseSrt(
      String(completedResult?.subtitles || '')
    );
    if (recoveredSegments.length === 0) {
      throw new Error(
        'Public automatic captions were found, but Translator could not read them.'
      );
    }
    if (input.checkCancellation) throwIfAgentCancelled();
    await prepareMountedSubtitles(input.strategy);
    if (input.checkCancellation) throwIfAgentCancelled();
    await useVideoStore.getState().setFile(null);
    useSubStore
      .getState()
      .load(recoveredSegments, null, 'fresh', null, null, null, null, {
        title:
          String(completedResult?.title || '').trim() ||
          'YouTube automatic captions',
        sourceVideoPath: null,
        sourceVideoAssetIdentity: null,
        sourceUrl: input.url,
        sourceProvenance: 'youtube_automatic_captions',
        subtitleKind: null,
        targetLanguage: null,
      });
    useUIStore.getState().setEditPanelOpen(true);
    return {
      videoPath: null,
      filename:
        String(
          completedResult?.filename || completedResult?.title || ''
        ).trim() || 'YouTube automatic captions',
      captionRecovery,
    };
  }
  const videoPath = finalDownload.download.completedFilePath;
  if (!completedResult || !videoPath || finalDownload.error) {
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
    String(completedResult.filename || '').trim() ||
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
  if (!MEDIA_WORKFLOW_TARGETS.has(runTo)) {
    throw new Error('Unsupported media workflow target.');
  }
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
    markAgentSourceMounted(agentOperationId);
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
    markAgentSourceMounted(agentOperationId);
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

async function cancelHistoryProcessing(
  historyId: string,
  requestedOperationId?: string
): Promise<Record<string, unknown>> {
  const activeHistoryJob = historyJobs.get(historyId);
  if (!activeHistoryJob?.inProgress) {
    return {
      historyJob: activeHistoryJob,
      cancellation: { accepted: false, reason: 'not_active' },
    };
  }
  if (
    requestedOperationId &&
    activeHistoryJob.operationId !== requestedOperationId
  ) {
    return {
      historyJob: activeHistoryJob,
      cancellation: { accepted: false, reason: 'operation_mismatch' },
    };
  }

  const cancellation =
    activeHistoryJob.kind === 'merge'
      ? await subtitleRendererClient.cancelMerge(activeHistoryJob.operationId)
      : await OperationIPC.cancel(activeHistoryJob.operationId);
  const accepted =
    'accepted' in cancellation
      ? cancellation.accepted
      : cancellation.success === true;
  if (accepted) {
    historyJobs.markCancelling(
      activeHistoryJob.historyId,
      activeHistoryJob.operationId
    );
  }
  return {
    historyJob: historyJobs.get(activeHistoryJob.historyId),
    cancellation,
  };
}

async function cancelAgentProcessing(input?: {
  historyId?: string;
  operationId?: string;
}): Promise<Record<string, unknown>> {
  const requestedHistoryId = String(input?.historyId || '').trim();
  const requestedOperationId = String(input?.operationId || '').trim();
  if (requestedHistoryId) {
    return cancelHistoryProcessing(requestedHistoryId, requestedOperationId);
  }

  const tasks = useTaskStore.getState();
  if (
    requestedOperationId &&
    agentProcessingState.id !== requestedOperationId
  ) {
    return {
      ...agentProcessingSnapshot(),
      cancellation: { accepted: false, reason: 'operation_mismatch' },
    };
  }
  const mountedOperationActive =
    agentProcessingState.status === 'running' ||
    agentProcessingState.status === 'cancelling' ||
    Boolean(useUrlStore.getState().download.id) ||
    Boolean(tasks.transcription.id) ||
    Boolean(tasks.translation.id) ||
    Boolean(tasks.dubbing.id) ||
    Boolean(tasks.summary.id) ||
    Boolean(tasks.merge.id);

  if (!mountedOperationActive) {
    const activeHistoryJobs = historyJobs.active();
    if (activeHistoryJobs.length > 1) {
      throw new Error(
        'Multiple library jobs are active. Provide history_id to choose one.'
      );
    }
    const activeHistoryJob = activeHistoryJobs[0];
    if (activeHistoryJob) {
      return cancelHistoryProcessing(activeHistoryJob.historyId);
    }
  }

  const mergeOperationId = tasks.merge.id;
  if (mergeOperationId && tasks.merge.inProgress) {
    const cancellation = usesMainOperationCancellation(
      agentProcessingState.kind,
      agentProcessingState.stage
    )
      ? await OperationIPC.cancel(mergeOperationId).then(result => ({
          accepted: result.success,
          reason: result.success ? 'accepted' : 'not_found',
        }))
      : await subtitleRendererClient.cancelMerge(mergeOperationId);
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

async function subtitleBatchSnapshot(input?: {
  offset?: number;
  limit?: number;
  historyId?: string;
}): Promise<Record<string, unknown>> {
  if (input?.historyId) {
    const loaded = await loadSubtitlesFromHistory(input.historyId);
    return createAgentSubtitleBatchSnapshot(loaded.segments, {
      offset: input.offset,
      limit: input.limit,
      sourceNote: `Loaded from library item: ${loaded.item.title}`,
    });
  }

  const subtitles = useSubStore.getState();
  return createAgentSubtitleBatchSnapshot(
    subtitles.order.map(id => subtitles.segments[id]),
    {
      offset: input?.offset,
      limit: input?.limit,
      sourceNote: 'Loaded from currently mounted subtitles',
    }
  );
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
  const updates = input?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error('Provide at least one subtitle update.');
  }
  if (updates.length > 100) {
    throw new Error('A subtitle update batch is limited to 100 cues.');
  }
  const store = useSubStore.getState();
  const validated = updates.map(update => {
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      throw new Error('Each subtitle update must be an object.');
    }
    const id = String(update.id || '').trim();
    const current = store.segments[id];
    if (!current) throw new Error(`Subtitle cue was not found: ${id}`);
    const patch: Partial<SrtSegment> = {};
    if (update.original !== undefined) {
      if (typeof update.original !== 'string') {
        throw new Error(`Subtitle cue original text must be a string: ${id}`);
      }
      patch.original = update.original;
    }
    if (update.translation !== undefined) {
      if (typeof update.translation !== 'string') {
        throw new Error(
          `Subtitle cue translation text must be a string: ${id}`
        );
      }
      patch.translation = update.translation;
    }
    if (update.start !== undefined) {
      if (typeof update.start !== 'number') {
        throw new Error(`Subtitle cue start must be a number: ${id}`);
      }
      patch.start = update.start;
    }
    if (update.end !== undefined) {
      if (typeof update.end !== 'number') {
        throw new Error(`Subtitle cue end must be a number: ${id}`);
      }
      patch.end = update.end;
    }
    if (Object.keys(patch).length === 0) {
      throw new Error(`Subtitle cue update has no changed fields: ${id}`);
    }
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
    subtitles: createAgentSubtitleBatchSnapshot(
      store.order.map(id => store.segments[id]),
      { offset: 0, limit: 1 }
    ),
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
  historyId?: string;
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
    const allowed = await SystemIPC.checkAgentPathAllowed(path);
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

  let segments: SrtSegment[];
  let sourceNote: string;

  if (input?.historyId) {
    const loaded = await loadSubtitlesFromHistory(input.historyId);
    segments = loaded.segments;
    sourceNote = `Exported from library item: ${loaded.item.title}`;
  } else {
    const subtitles = useSubStore.getState();
    segments = subtitles.order.map(id => subtitles.segments[id]);
    if (!segments.length)
      throw new Error('There are no mounted subtitles to export.');
    sourceNote = 'Exported from currently mounted subtitles';
  }

  const mode = input?.mode || useUIStore.getState().subtitleDisplayMode;
  if (!DISPLAY_MODES.has(mode))
    throw new Error('Unsupported subtitle export mode.');
  const result = await saveSubtitleFilesToPath(path, segments, mode, 'export', {
    requireAgentPathAuthorization: true,
  });
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
    sourceNote,
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
    subtitleBaseFontSize: normalizeSubtitleBaseFontSize(ui.baseFontSize),
    subtitleRenderSelection: currentSubtitleRenderSelection(),
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

function currentSubtitleRenderSelection(): Record<string, unknown> {
  const ui = useUIStore.getState();
  return {
    schema_version: SUBTITLE_RENDER_SPEC_VERSION,
    display_mode: ui.subtitleDisplayMode,
    style: ui.subtitleStyle,
    base_font_size_px: normalizeSubtitleBaseFontSize(ui.baseFontSize),
    source: 'translator_preview_preferences',
  };
}

async function requireHistoryVideo(historyId: string): Promise<{
  item: VideoSuggestionDownloadHistoryItem;
  videoPath: string;
}> {
  const item = await requireDownloadHistoryItem({ id: historyId });
  const videoPath = sanitizeVideoSuggestionHistoryPath(item.localPath);
  if (!videoPath || !(await window.fileApi.fileExists(videoPath))) {
    throw new Error(
      `Library item video file not found: ${historyId}. File may have been moved or deleted.`
    );
  }
  return { item, videoPath };
}

async function findSubtitlesForHistory({
  item,
  videoPath,
}: {
  item: VideoSuggestionDownloadHistoryItem;
  videoPath: string;
}): Promise<SrtSegment[] | null> {
  const result = await SubtitleLibraryIPC.findStoredSubtitleForVideo({
    sourceVideoPath: videoPath,
    sourceUrl: item.sourceUrl,
  });
  if (!result.success) {
    throw new Error(result.error || 'Failed to look up stored subtitles.');
  }
  if (!result.entry) return null;

  const segments =
    Array.isArray(result.segments) && result.segments.length > 0
      ? result.segments
      : parseSrt(result.content || '');
  if (!segments.length) {
    throw new Error('Stored subtitle artifact is empty or unreadable.');
  }
  return segments;
}

async function loadSubtitlesFromHistory(historyId: string): Promise<{
  segments: SrtSegment[];
  item: VideoSuggestionDownloadHistoryItem;
  videoPath: string;
}> {
  const context = await requireHistoryVideo(historyId);
  const segments = await findSubtitlesForHistory(context);
  if (!segments) {
    throw new Error(
      `Library item has no stored subtitles: ${historyId}. Generate or import subtitles first.`
    );
  }

  return { ...context, segments };
}

function requireSuccess(
  label: string,
  result: { success: boolean; error?: string }
): void {
  if (!result.success) {
    throw new Error(`${label}: ${result.error || 'setting was rejected'}`);
  }
}

async function settingsSnapshot({
  refreshCredits = false,
}: {
  refreshCredits?: boolean;
} = {}): Promise<Record<string, unknown>> {
  const ui = useUIStore.getState();
  const ai = useAiStore.getState();
  const [creditSnapshot, appLanguage] = await Promise.all([
    agentCreditSnapshot(refreshCredits).catch(() => null),
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

function providerDescriptor(
  provider: string,
  byoActive: boolean,
  available = true
): Record<string, unknown> {
  if (!available) return { kind: 'unavailable', provider };
  return byoActive
    ? { kind: 'byo', provider, stage5_credits: false }
    : { kind: 'stage5', provider, stage5_credits: true };
}

async function mcpContext({
  refreshCredits = true,
}: {
  refreshCredits?: boolean;
} = {}): Promise<Record<string, unknown>> {
  const ai = useAiStore.getState();
  const ui = useUIStore.getState();
  const [runtime, settings, allowedDirectories, socketStatus] =
    await Promise.all([
      SystemIPC.getAgentRuntimeContext(),
      settingsSnapshot({ refreshCredits }),
      SystemIPC.getAgentAllowedDirectories().catch(() => []),
      SystemIPC.getAgentSocketStatus().catch(() => ({
        running: false,
        connectedClients: 0,
      })),
    ]);
  const openAiByo = Boolean(
    ai.useApiKeysMode && ai.useByo && ai.keyPresent && ai.byoUnlocked
  );
  const anthropicByo = Boolean(
    ai.useApiKeysMode &&
    ai.useByoAnthropic &&
    ai.anthropicKeyPresent &&
    ai.byoAnthropicUnlocked
  );
  const elevenLabsByo = Boolean(
    ai.useApiKeysMode &&
    ai.useByoElevenLabs &&
    ai.elevenLabsKeyPresent &&
    ai.byoElevenLabsUnlocked
  );
  const draftProvider = ai.preferClaudeTranslation ? 'anthropic' : 'openai';
  const summaryProvider = ai.preferClaudeSummary ? 'anthropic' : 'openai';
  const transcriptionProvider = ai.preferredTranscriptionProvider;
  const dubbingProvider = ai.preferredDubbingProvider;
  const videoSuggestionProvider = /claude|anthropic/i.test(
    String(ai.byoVideoSuggestionModel || '')
  )
    ? 'anthropic'
    : 'openai';
  const byoFor = (provider: string) =>
    provider === 'openai'
      ? openAiByo
      : provider === 'anthropic'
        ? anthropicByo
        : provider === 'elevenlabs'
          ? elevenLabsByo
          : false;
  const creditContext = (settings as any)?.credits || null;
  const runtimeAccount = (runtime as any)?.stage5?.account || null;
  const stage5ConnectionVerified = creditContext?.authoritative === true;

  return {
    ...runtime,
    stage5: {
      ...((runtime as any)?.stage5 || {}),
      account: runtimeAccount
        ? {
            ...runtimeAccount,
            identity_present: true,
            authenticated: stage5ConnectionVerified,
            connection_verified: stage5ConnectionVerified,
          }
        : null,
      credits: creditContext,
    },
    providers: (runtime as any)?.providers || {
      transcription:
        transcriptionProvider === 'stage5'
          ? providerDescriptor('elevenlabs-scribe', false)
          : providerDescriptor(
              transcriptionProvider,
              byoFor(transcriptionProvider),
              byoFor(transcriptionProvider)
            ),
      translation: providerDescriptor(draftProvider, byoFor(draftProvider)),
      summary: providerDescriptor(summaryProvider, byoFor(summaryProvider)),
      summary_high: providerDescriptor(
        summaryProvider,
        byoFor(summaryProvider)
      ),
      dubbing:
        dubbingProvider === 'stage5'
          ? providerDescriptor(ai.stage5DubbingTtsProvider, false)
          : providerDescriptor(
              dubbingProvider,
              byoFor(dubbingProvider),
              byoFor(dubbingProvider)
            ),
      video_suggestions: ai.useApiKeysMode
        ? providerDescriptor(
            videoSuggestionProvider,
            byoFor(videoSuggestionProvider),
            byoFor(videoSuggestionProvider)
          )
        : providerDescriptor('stage5', false),
    },
    planning: {
      quality_translation: ui.qualityTranslation,
      quality_transcription: ui.qualityTranscription,
      subtitle_rendering: currentSubtitleRenderSelection(),
      credit_rates: {
        transcription_per_hour: CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR,
        translation_standard_per_hour: estimateTranslationCreditsPerHour(false),
        translation_quality_per_hour: estimateTranslationCreditsPerHour(true),
        summary_standard_per_hour: CREDITS_PER_SUMMARY_AUDIO_HOUR,
        summary_high_per_hour:
          CREDITS_PER_SUMMARY_AUDIO_HOUR * SUMMARY_QUALITY_MULTIPLIER,
        dubbing_openai_per_minute: TTS_CREDITS_PER_MINUTE.openai,
        dubbing_elevenlabs_per_minute: TTS_CREDITS_PER_MINUTE.elevenlabs,
      },
    },
    agent_control: {
      enabled: window.env.isPackaged
        ? socketStatus.running
        : window.env.agentMode,
      connected_clients: socketStatus.connectedClients,
      allowed_directories: allowedDirectories,
      source_binding_protocol_version: AGENT_SOURCE_BINDING_PROTOCOL_VERSION,
    },
  };
}

function mcpV2ProviderRouteKey(value: unknown): string {
  const descriptor =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return [
    descriptor.kind || 'unavailable',
    descriptor.provider || '',
    descriptor.model || '',
  ].join(':');
}

async function assertMcpV2RuntimeGuard(
  input?: Record<string, unknown>
): Promise<void> {
  const guard = input?.runtimeGuard;
  if (!guard || typeof guard !== 'object' || Array.isArray(guard)) return;
  const value = guard as Record<string, unknown>;
  const providerSlot = String(value.provider_slot || value.provider_name || '');
  if (
    ![
      'transcription',
      'translation',
      'summary',
      'summary_high',
      'dubbing',
    ].includes(providerSlot)
  ) {
    throw new Error('MCP v2 runtime guard names an unsupported provider slot.');
  }
  const expectedRoute = String(value.expected_route || '');
  if (!expectedRoute) {
    throw new Error(
      'MCP v2 runtime guard is missing its planned provider route.'
    );
  }
  const context = await mcpContext({ refreshCredits: true });
  const providers = (context.providers || {}) as Record<string, unknown>;
  const currentRoute = mcpV2ProviderRouteKey(providers[providerSlot]);
  if (currentRoute !== expectedRoute) {
    throw new Error(
      `MCP v2 provider changed immediately before operation start (${expectedRoute} → ${currentRoute}).`
    );
  }
  const expectations = value.planning_expectations;
  if (
    expectations &&
    typeof expectations === 'object' &&
    !Array.isArray(expectations)
  ) {
    const planning = (context.planning || {}) as Record<string, unknown>;
    const creditRates = (planning.credit_rates || {}) as Record<
      string,
      unknown
    >;
    for (const [name, expected] of Object.entries(
      expectations as Record<string, unknown>
    )) {
      if (expected === undefined) continue;
      const current = name.startsWith('quality_')
        ? planning[name] === true
        : Number(creditRates[name]);
      if (current !== expected) {
        throw new Error(
          `MCP v2 planning assumption changed immediately before operation start (${name}: ${String(expected)} → ${String(current)}).`
        );
      }
    }
  }
  const minimumCredits = Math.max(0, Number(value.minimum_stage5_credits || 0));
  if (minimumCredits > 0) {
    const credits = (context.stage5 as any)?.credits;
    const balance = Number(credits?.balance);
    if (credits?.authoritative !== true || !Number.isFinite(balance)) {
      throw new Error(
        'MCP v2 requires an authoritative Stage5 balance immediately before operation start.'
      );
    }
    if (balance < minimumCredits) {
      throw new Error(
        `Stage5 balance ${balance} is below this stage's ${minimumCredits}-credit estimate.`
      );
    }
  }
}

async function applyTranslationSession(input?: {
  source?: { kind?: string; path?: string; history_id?: string; url?: string };
  videoPath?: string;
  targetLanguage?: string;
  segments?: Array<Record<string, unknown>>;
  sourceBinding?: unknown;
  mcpJobId?: string;
}): Promise<Record<string, unknown>> {
  if (hasActiveAppProcessing()) {
    throw new Error('Translator is busy with another processing operation.');
  }
  const mcpJobId = getInternalMcpJobId(input);
  const sourceBinding =
    input?.sourceBinding === undefined
      ? null
      : parseAgentSourceBinding(input.sourceBinding);
  if (input?.sourceBinding !== undefined && !sourceBinding) {
    throw new Error('Persistent MCP job source binding is invalid.');
  }
  if (mcpJobId && sourceBinding?.state !== 'mounted') {
    throw new Error(
      'Persistent MCP job session is missing its mounted source binding.'
    );
  }
  if (!Array.isArray(input?.segments) || input.segments.length === 0) {
    throw new Error('A non-empty persistent subtitle session is required.');
  }
  if (input.segments.length > 100_000) {
    throw new Error('Persistent subtitle session exceeds 100,000 cues.');
  }
  const ids = new Set<string>();
  const segments: SrtSegment[] = input.segments.map((raw, index) => {
    const id = String(raw.id || '').trim();
    const start = Number(raw.start);
    const end = Number(raw.end);
    const original = String(raw.source ?? raw.original ?? '').trim();
    const translation = String(raw.translation || '').trim();
    if (!id || ids.has(id))
      throw new Error(`Invalid or duplicate subtitle ID: ${id}`);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      throw new Error(`Invalid subtitle timing for ID: ${id}`);
    }
    if (!original)
      throw new Error(`Subtitle source text is empty for ID: ${id}`);
    ids.add(id);
    return {
      id,
      index: index + 1,
      start,
      end,
      original,
      translation,
    };
  });

  let videoPath = String(input?.videoPath || '').trim();
  if (!videoPath && input?.source?.kind === 'local_file') {
    videoPath = String(input.source.path || '').trim();
  }
  if (!videoPath && input?.source?.kind === 'library_item') {
    const history = await requireHistoryVideo(
      String(input.source.history_id || '')
    );
    videoPath = history.videoPath;
  }
  if (videoPath) {
    if (!(await window.fileApi.fileExists(videoPath))) {
      throw new Error(
        `Persistent job video is no longer available: ${videoPath}`
      );
    }
    const video = useVideoStore.getState();
    const currentVideoPath = video.originalPath ?? video.path ?? null;
    if (currentVideoPath !== videoPath) {
      await useVideoStore.getState().setFile(
        {
          name: videoPath.split(/[\\/]/).pop() || 'persistent-job-video',
          path: videoPath,
          sourceUrl: input?.source?.url,
        },
        { skipStoredSubtitleAutoMount: true }
      );
    }
  } else if (sourceBinding) {
    // A transcript-only persistent source owns a workspace with no video.
    // Do not leave the tab's previously open media attached to that job.
    await useVideoStore.getState().setFile(null);
  }
  useSubStore
    .getState()
    .load(segments, null, 'fresh', videoPath || null, null, null, null, {
      title: 'Persistent MCP job subtitles',
      sourceVideoPath: videoPath || null,
      sourceUrl: input?.source?.url || null,
      sourceProvenance: 'mcp_persistent_job',
      targetLanguage: String(input?.targetLanguage || '').trim() || null,
    });
  useUIStore.getState().setEditPanelOpen(true);
  const mountedVideo = useVideoStore.getState();
  const mountedSubtitles = useSubStore.getState();
  mountedMcpWorkspaceBinding =
    mcpJobId && sourceBinding
      ? {
          jobId: mcpJobId,
          binding: sourceBinding,
          videoPath: mountedVideo.originalPath ?? mountedVideo.path ?? null,
          subtitleSourceId: mountedSubtitles.sourceId,
        }
      : null;
  return {
    applied: true,
    cueCount: segments.length,
    translatedCueCount: segments.filter(segment =>
      Boolean(segment.translation?.trim())
    ).length,
    videoPath: videoPath || null,
    targetLanguage: String(input?.targetLanguage || '').trim() || null,
    ...(sourceBinding
      ? { source_binding: serializeAgentSourceBinding(sourceBinding) }
      : {}),
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
    async mcpContext() {
      return mcpContext({ refreshCredits: true });
    },

    async mcpDoctor(input) {
      const [doctor, context] = await Promise.all([
        SystemIPC.agentV2Doctor(input || {}),
        mcpContext({ refreshCredits: true }),
      ]);
      return { ...doctor, context };
    },

    async probeSource(input) {
      return SystemIPC.agentV2ProbeSource(input || {});
    },

    async fetchSourceCaptions(input) {
      return SystemIPC.agentV2FetchSourceCaptions(input || {});
    },

    async inspectOutputDirectory(input) {
      return SystemIPC.agentV2InspectOutputDirectory(input || {});
    },

    async inspectMedia(input) {
      return SystemIPC.agentV2InspectMedia(input || {});
    },

    async writeAgentOutputText(input) {
      return SystemIPC.agentV2WriteTextOutput(input || {});
    },

    async applyTranslationSession(input) {
      return applyTranslationSession(input);
    },

    async startPresetRender(input) {
      return beginAgentProcessing(
        'preset-render',
        operationId => runAgentPresetRender(operationId, input),
        input?.operationId,
        getInternalMcpJobRoute(input),
        input?.sourceBinding,
        getInternalMcpJobId(input)
      );
    },

    async renderPreview(input) {
      return renderAgentPreview(input);
    },

    async status(input) {
      if (input?.historyId) {
        const context = await requireHistoryVideo(input.historyId);
        const segments = await findSubtitlesForHistory(context);
        return {
          ready: true,
          historyId: input.historyId,
          historyTitle: context.item.title,
          videoPath: context.videoPath,
          videoReady: true,
          subtitleCueCount: segments?.length ?? 0,
          translatedCueCount: (segments ?? []).filter(segment =>
            Boolean(segment.translation?.trim())
          ).length,
          sourceNote: 'Status read without remounting the active tab.',
        };
      }
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
      await assertMcpV2RuntimeGuard(input);
      if (input?.historyId) {
        const historyId = input.historyId;
        return beginHistoryProcessing(
          'transcription',
          historyId,
          operationId =>
            runHistoryTranscription(
              operationId,
              historyId,
              input?.sourceVideoPath
            ),
          getInternalHistoryRouteToken(input),
          input?.operationId,
          getInternalMcpJobRoute(input)
        );
      }
      const strategy = requireMountedSubtitleStrategy(
        input?.replaceSubtitles,
        'fail'
      );
      return beginAgentProcessing(
        'transcription',
        operationId => runAgentTranscription(operationId, strategy),
        input?.operationId,
        getInternalMcpJobRoute(input),
        input?.sourceBinding,
        getInternalMcpJobId(input)
      );
    },

    async startTranslation(input) {
      await assertMcpV2RuntimeGuard(input);
      if (input?.historyId) {
        const historyId = input.historyId;
        const targetLanguage = String(input?.targetLanguage || '').trim();
        if (!targetLanguage) throw new Error('A target language is required.');
        return beginHistoryProcessing(
          'translation',
          historyId,
          operationId =>
            runHistoryTranslation(operationId, historyId, targetLanguage),
          getInternalHistoryRouteToken(input),
          input?.operationId,
          getInternalMcpJobRoute(input)
        );
      }
      const targetLanguage = String(input?.targetLanguage || '').trim();
      return beginAgentProcessing(
        'translation',
        operationId => runAgentTranslation(operationId, targetLanguage),
        input?.operationId,
        getInternalMcpJobRoute(input),
        input?.sourceBinding,
        getInternalMcpJobId(input)
      );
    },

    async startDubbing(input) {
      await assertMcpV2RuntimeGuard(input);
      return beginAgentProcessing(
        'dubbing',
        operationId =>
          runAgentDubbing(operationId, {
            targetLanguage: input?.targetLanguage,
            voice: input?.voice,
            translateIfNeeded: input?.translateIfNeeded,
            sourceVideoPath: input?.sourceVideoPath,
          }),
        input?.operationId,
        getInternalMcpJobRoute(input),
        input?.sourceBinding,
        getInternalMcpJobId(input)
      );
    },

    async startSummary(input) {
      await assertMcpV2RuntimeGuard(input);
      const effortLevel = (input?.effortLevel ||
        useUIStore.getState().summaryEffortLevel) as SummaryEffortLevel;
      return beginAgentProcessing(
        'summary',
        operationId =>
          runAgentSummary(operationId, {
            targetLanguage: input?.targetLanguage,
            effortLevel,
            includeHighlights: input?.includeHighlights,
            sourceVideoPath: input?.sourceVideoPath,
          }),
        input?.operationId,
        getInternalMcpJobRoute(input),
        input?.sourceBinding,
        getInternalMcpJobId(input)
      );
    },

    async startCueTranslation(input) {
      return beginAgentProcessing(
        'cue-translation',
        operationId =>
          runAgentCueTranslation(operationId, {
            id: input?.id,
            targetLanguage: input?.targetLanguage,
          }),
        input?.operationId,
        getInternalMcpJobRoute(input),
        input?.sourceBinding,
        getInternalMcpJobId(input)
      );
    },

    async startCueTranscription(input) {
      return beginAgentProcessing(
        'cue-transcription',
        operationId => runAgentCueTranscription(operationId, { id: input?.id }),
        input?.operationId,
        getInternalMcpJobRoute(input),
        input?.sourceBinding,
        getInternalMcpJobId(input)
      );
    },

    async startMerge(input) {
      if (input?.historyId) {
        const historyId = input.historyId;
        return beginHistoryProcessing(
          'merge',
          historyId,
          operationId =>
            runHistoryMerge(operationId, historyId, {
              outputPath: input?.outputPath,
              overwrite: input?.overwrite,
            }),
          getInternalHistoryRouteToken(input),
          input?.operationId,
          getInternalMcpJobRoute(input)
        );
      }
      return beginAgentProcessing(
        'merge',
        operationId =>
          runAgentMerge(operationId, {
            outputPath: input?.outputPath,
            overwrite: input?.overwrite,
          }),
        input?.operationId,
        getInternalMcpJobRoute(input),
        input?.sourceBinding,
        getInternalMcpJobId(input)
      );
    },

    async startMediaWorkflow(input) {
      await assertMcpV2RuntimeGuard(input);
      const replaceSubtitles = requireMountedSubtitleStrategy(
        input?.replaceSubtitles,
        'fail'
      );
      return beginAgentProcessing(
        'media-workflow',
        operationId =>
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
          }),
        input?.operationId,
        getInternalMcpJobRoute(input),
        input?.sourceBinding,
        getInternalMcpJobId(input)
      );
    },

    async processingStatus(input) {
      if (input?.historyId) {
        const job = historyJobs.get(input.historyId);
        const requestedOperationId = String(input.operationId || '').trim();
        if (requestedOperationId && job?.operationId !== requestedOperationId) {
          const retained = historyJobs.getByOperationId(requestedOperationId);
          if (retained?.historyId === input.historyId) {
            return {
              ...historyJobSnapshot(retained),
              sourceNote: 'Retained exact library operation result.',
            };
          }
          if (job?.inProgress) {
            return {
              ...historyJobSnapshot(job),
              sourceNote:
                'A different operation is active for this library item.',
            };
          }
          return {
            id: null,
            operationId: null,
            inProgress: false,
            status: 'unknown',
            requestedOperationId,
            historyId: input.historyId,
            sourceNote: 'No retained result for the requested operation.',
          };
        }
        if (!job) {
          return {
            inProgress: false,
            historyId: input.historyId,
            note: 'No recorded job for this library item.',
          };
        }
        return {
          ...historyJobSnapshot(job),
          sourceNote: 'Job status for a library item.',
        };
      }
      const requestedOperationId = String(input?.operationId || '').trim();
      if (
        requestedOperationId &&
        activeAgentPreview?.operationId === requestedOperationId
      ) {
        return {
          id: requestedOperationId,
          operationId: requestedOperationId,
          kind: 'preview',
          status: 'running',
          inProgress: true,
          stage: 'rendering-preview',
          sourceNote: 'Exact persistent preview operation is still active.',
        };
      }
      if (
        requestedOperationId &&
        agentProcessingState.id !== requestedOperationId
      ) {
        const retained = terminalAgentOperations.get(requestedOperationId);
        if (retained) {
          return {
            ...retained,
            sourceNote: 'Retained exact mounted operation result.',
          };
        }
        if (
          agentProcessingState.status === 'running' ||
          agentProcessingState.status === 'cancelling'
        ) {
          return {
            ...agentProcessingSnapshot(),
            sourceNote: 'A different mounted operation is active.',
          };
        }
        return {
          id: null,
          operationId: null,
          inProgress: false,
          status: 'unknown',
          requestedOperationId,
          sourceNote: 'No retained result for the requested operation.',
        };
      }
      return agentProcessingSnapshot();
    },

    async cancelProcessing(input) {
      return cancelAgentProcessing(input);
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
      agentEnabled = await SystemIPC.getAgentControlEnabled();
    } catch (err) {
      console.warn(
        '[agent-listener] Failed to check agent control setting:',
        err
      );
      agentEnabled = false;
    }
  }

  // Setup IPC bridge listener for packaged mode agent requests
  // This must be registered even when disabled so it can handle enable/disable toggles
  if (window.env.isPackaged) {
    SystemIPC.onAgentBridgeRequest(request => {
      const {
        method,
        params,
        responseChannel,
        historyRouteToken,
        mcpJobId,
        mcpJobRouteToken,
      } = request;

      (async () => {
        try {
          const agent = window.translatorAgent;
          const handler =
            agent && typeof method === 'string'
              ? (agent as unknown as Record<string, unknown>)[method]
              : null;
          if (typeof handler !== 'function') {
            throw new Error(
              'Agent control is not enabled. Enable it in Settings → Agent Control.'
            );
          }

          const invocationParams =
            historyRouteToken || mcpJobId || mcpJobRouteToken
              ? {
                  ...(params || {}),
                  ...(historyRouteToken
                    ? { __agentHistoryRouteToken: historyRouteToken }
                    : {}),
                  ...(mcpJobId ? { __agentMcpJobId: mcpJobId } : {}),
                  ...(mcpJobRouteToken
                    ? { __agentMcpJobRouteToken: mcpJobRouteToken }
                    : {}),
                }
              : params;
          const result = await handler(invocationParams);
          SystemIPC.sendAgentBridgeResponse(responseChannel, { result });
        } catch (error: any) {
          try {
            SystemIPC.sendAgentBridgeResponse(responseChannel, {
              error: error?.message || String(error),
            });
          } catch {
            // Main observes renderer destruction independently. Never create
            // an unhandled rejection by reporting a failed response through
            // the same unavailable IPC channel.
          }
        }
      })();
    });

    // Listen for agent control changes - install/remove bridge dynamically
    SystemIPC.onAgentControlChanged(({ enabled }) => {
      if (enabled) {
        // User enabled agent control - install bridge immediately (no reload)
        console.log(
          '[agent-listener] Agent control enabled - installing bridge'
        );
        installAgentBridge();
      } else {
        // User disabled agent control - remove bridge immediately
        console.log(
          '[agent-listener] Agent control disabled - removing bridge'
        );
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
