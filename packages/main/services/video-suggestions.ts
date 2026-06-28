import { randomUUID } from 'node:crypto';
import log from 'electron-log';
import { normalizeAiModelId } from '../../shared/constants/index.js';
import type {
  VideoSuggestionChatRequest,
  VideoSuggestionChatResult,
  VideoSuggestionProgress,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import { callAIModel } from './subtitle-processing/ai-client.js';
import {
  resolveVideoSuggestionModel,
  resolveVideoSuggestionTranslationPhase,
  type VideoSuggestionModelPreference,
} from './ai-provider.js';
import { normalizeVideoSuggestionModelPreference } from './video-suggestion-model-preference.js';
import { isVideoSuggestionRecency } from '../../shared/helpers/video-suggestion-sanitize.js';
import {
  findFallbackTopicFromHistory,
  isBroadAcceptanceReply,
  parseSearchPlannerPayload,
  toPlannerMessages,
} from './video-suggestions/planner.js';
import {
  emitSuggestionProgress,
  startProgressPulse,
} from './video-suggestions/progress.js';
import {
  createVideoSearchContinuation,
  runVideoSearch,
  type VideoSearchContinuation,
  type VideoSearchRunOutcome,
} from './video-suggestions/search.js';
import { splitContinuationPageResults } from './video-suggestions/pagination.js';
import {
  type IntentResolverPayload,
  type QueryFormulatorPayload,
  type SearchPlannerPayload,
  VIDEO_SUGGESTION_SOURCE_LABEL,
  buildOrderedIntentSeedQueries,
  clampMessage,
  clampTraceLines,
  clampTraceMessage,
  compactText,
  describeLowConfidenceReason,
  isSuggestionAbortError,
  normalizeDescriptorPhrases,
  normalizeExcludeUrls,
  normalizeIntentCandidates,
  normalizePreferenceSlots,
  normalizeYoutubeWatchUrl,
  quotedStatusValue,
  recencyLabel,
  sanitizeCountryHint,
  sanitizeLanguageToken,
  sanitizeSearchKeywords,
  sanitizeYoutubeRegionCode,
  summarizeValues,
  summarizeSearchError,
  throwIfSuggestionAborted,
  uniqueTexts,
} from './video-suggestions/shared.js';

const STARTER_QUESTION = '__i18n__:input.videoSuggestion.starterQuestion';
const SEARCH_PLANNER_PROGRESS_MESSAGES = [
  'Planning the best YouTube search...',
  'Grounding real names and channels...',
  'Finalizing the search queries...',
];
const VIDEO_SUGGESTION_BATCH_SIZE = 20;
const VIDEO_SEARCH_CONTINUATION_TTL_MS = 30 * 60 * 1000;
const VIDEO_SEARCH_CONTINUATION_LIMIT = 128;

const videoSearchContinuationCache = new Map<
  string,
  { value: VideoSearchContinuation; updatedAt: number }
>();

function sweepExpiredVideoSearchContinuations(now = Date.now()): void {
  for (const [id, entry] of videoSearchContinuationCache.entries()) {
    if (now - entry.updatedAt > VIDEO_SEARCH_CONTINUATION_TTL_MS) {
      videoSearchContinuationCache.delete(id);
    }
  }
}

function persistVideoSearchContinuation(
  value: VideoSearchContinuation,
  continuationId?: string
): string {
  const now = Date.now();
  sweepExpiredVideoSearchContinuations(now);
  const id = compactText(continuationId) || randomUUID();
  videoSearchContinuationCache.set(id, {
    value,
    updatedAt: now,
  });

  if (videoSearchContinuationCache.size > VIDEO_SEARCH_CONTINUATION_LIMIT) {
    const oldest = [...videoSearchContinuationCache.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt
    )[0];
    if (oldest) {
      videoSearchContinuationCache.delete(oldest[0]);
    }
  }

  return id;
}

function getVideoSearchContinuation(
  continuationId: string | undefined
): VideoSearchContinuation | null {
  const id = compactText(continuationId);
  if (!id) return null;

  const now = Date.now();
  sweepExpiredVideoSearchContinuations(now);
  const entry = videoSearchContinuationCache.get(id);
  if (!entry) return null;

  entry.updatedAt = now;
  return entry.value;
}

function lowConfidenceErrorKey(reason: string | undefined): string {
  const normalized = compactText(reason).toLowerCase();
  if (normalized === 'no-scored-results') {
    return '__i18n__:input.videoSuggestion.lowConfidenceNoScoredResults';
  }
  return '__i18n__:input.videoSuggestion.lowConfidenceGeneric';
}

type SuggestVideoRuntimeOptions = {
  onProgress?: (progress: VideoSuggestionProgress) => void;
  signal?: AbortSignal;
};

function normalizeRecency(
  input: VideoSuggestionChatRequest['preferredRecency']
): VideoSuggestionRecency {
  return isVideoSuggestionRecency(input) ? input : 'any';
}

function getLastUserQuery(
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  return (
    [...history]
      .reverse()
      .find(item => item.role === 'user')
      ?.content.trim() || ''
  );
}

function buildThreadContext(
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const recent = history
    .map(item => ({
      role: item.role === 'assistant' ? 'Assistant' : 'User',
      content: compactText(item.content),
    }))
    .filter(item => item.content.length > 0)
    .slice(-6);

  return recent.map(item => `${item.role}: ${item.content}`).join('\n');
}

function buildTargetCountryLanguageInstruction(targetCountry?: string): string {
  const normalizedTargetCountry = compactText(targetCountry);
  if (!normalizedTargetCountry) {
    return 'Use English for searchQuery and retrievalQueries.';
  }
  return `Use whatever language ${JSON.stringify(
    normalizedTargetCountry
  )} speaks for searchQuery and retrievalQueries. If that is unclear, default to English.`;
}

function normalizeBiasMetadata({
  youtubeRegionCode,
  youtubeSearchLanguage,
  primarySearchLanguage,
  searchLanguages,
  fallbackYoutubeRegionCode,
  fallbackYoutubeSearchLanguage,
}: {
  youtubeRegionCode?: string;
  youtubeSearchLanguage?: string;
  primarySearchLanguage?: string;
  searchLanguages?: string[];
  fallbackYoutubeRegionCode?: string;
  fallbackYoutubeSearchLanguage?: string;
}): {
  youtubeRegionCode: string;
  youtubeSearchLanguage: string;
  primarySearchLanguage: string;
  searchLanguages: string[];
} {
  const normalizedSearchLanguage =
    sanitizeLanguageToken(youtubeSearchLanguage).toLowerCase() ||
    sanitizeLanguageToken(primarySearchLanguage).toLowerCase() ||
    sanitizeLanguageToken(fallbackYoutubeSearchLanguage).toLowerCase() ||
    'en';
  const normalizedSearchLanguages = uniqueTexts(
    [
      normalizedSearchLanguage,
      ...(searchLanguages || []),
      sanitizeLanguageToken(fallbackYoutubeSearchLanguage).toLowerCase(),
    ].map(value => sanitizeLanguageToken(value).toLowerCase())
  )
    .filter(Boolean)
    .slice(0, 3);

  return {
    youtubeRegionCode:
      sanitizeYoutubeRegionCode(youtubeRegionCode) ||
      sanitizeYoutubeRegionCode(fallbackYoutubeRegionCode),
    youtubeSearchLanguage: normalizedSearchLanguage,
    primarySearchLanguage: normalizedSearchLanguage,
    searchLanguages: normalizedSearchLanguages,
  };
}

type AgenticSearchPlan = {
  searchQuery: string;
  retrievalQueries: string[];
  youtubeRegionCode?: string;
  youtubeSearchLanguage?: string;
  selectedChannels: string[];
  capturedPreferences?: ReturnType<typeof normalizePreferenceSlots>;
};

type AgenticJudgePayload = {
  quality: 'good' | 'partial' | 'bad';
  shouldContinue: boolean;
  reason: string;
  revisedQueries: string[];
  assistantMessage: string;
  capturedPreferences?: ReturnType<typeof normalizePreferenceSlots>;
};

type AgenticLoopOutcome = {
  results: VideoSuggestionResultItem[];
  searchQuery: string;
  continuation: VideoSearchContinuation;
  assistantMessage: string;
  capturedPreferences?: ReturnType<typeof normalizePreferenceSlots>;
  lowConfidenceReason?: string;
};

function resolveAgenticIterationLimit({
  preference,
  translationPhase,
}: {
  preference: VideoSuggestionModelPreference;
  translationPhase: 'draft' | 'review';
}): number {
  return translationPhase === 'review' || preference === 'quality' ? 3 : 2;
}

function parseJsonObjectPayload(raw: string): Record<string, unknown> | null {
  const input = String(raw || '').trim();
  if (!input) return null;

  const attempts = [input];
  const fenced = input
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (fenced && fenced !== input) attempts.push(fenced);

  const firstBrace = input.indexOf('{');
  const lastBrace = input.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    attempts.push(input.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Continue trying fallback JSON spans.
    }
  }

  return null;
}

function parseBooleanField(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'y'].includes(normalized)) return true;
    if (['false', 'no', '0', 'n'].includes(normalized)) return false;
  }
  return null;
}

function normalizeQueryList(input: unknown, limit = 8): string[] {
  if (!Array.isArray(input)) return [];
  return uniqueTexts(
    input.map(value => sanitizeSearchKeywords(String(value || '')))
  )
    .filter(Boolean)
    .slice(0, limit);
}

function parseAgenticJudgePayload(
  raw: string,
  canContinue: boolean
): AgenticJudgePayload | null {
  const obj = parseJsonObjectPayload(raw);
  if (!obj) return null;

  const qualityRaw = compactText(obj.quality).toLowerCase();
  const quality =
    qualityRaw === 'good' || qualityRaw === 'partial' || qualityRaw === 'bad'
      ? qualityRaw
      : 'partial';
  const revisedQueries = normalizeQueryList(obj.revisedQueries);
  const shouldContinue =
    canContinue &&
    (parseBooleanField(obj.shouldContinue) ?? false) &&
    revisedQueries.length > 0;
  const capturedPreferenceSource = {
    ...(obj.preferences && typeof obj.preferences === 'object'
      ? (obj.preferences as Record<string, unknown>)
      : {}),
    ...(obj.capturedPreferences && typeof obj.capturedPreferences === 'object'
      ? (obj.capturedPreferences as Record<string, unknown>)
      : {}),
  };

  return {
    quality,
    shouldContinue,
    reason: clampTraceMessage(compactText(obj.reason), 360),
    revisedQueries,
    assistantMessage: clampTraceMessage(compactText(obj.assistantMessage), 520),
    capturedPreferences: normalizePreferenceSlots(capturedPreferenceSource),
  };
}

function mergeVideoSuggestionResults(
  items: VideoSuggestionResultItem[]
): VideoSuggestionResultItem[] {
  const merged: VideoSuggestionResultItem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const normalizedUrl = normalizeYoutubeWatchUrl(item?.url) || item?.url;
    const url = compactText(normalizedUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    merged.push(item);
  }

  return merged;
}

function buildCandidateSummaryForJudge(
  items: VideoSuggestionResultItem[],
  max = 24
): string {
  if (items.length === 0) return 'None.';
  return items
    .slice(0, max)
    .map((item, index) => {
      const parts = [
        `${index + 1}. ${compactText(item.title) || 'Untitled'}`,
        compactText(item.channel) ? `channel=${compactText(item.channel)}` : '',
        compactText(item.uploadedAt)
          ? `uploaded=${compactText(item.uploadedAt)}`
          : '',
        `url=${compactText(item.url)}`,
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .join('\n');
}

function buildJudgeCandidateContext({
  currentResults,
  candidatePool,
}: {
  currentResults: VideoSuggestionResultItem[];
  candidatePool: VideoSuggestionResultItem[];
}): string {
  const freshResults = mergeVideoSuggestionResults(currentResults).slice(0, 24);
  const freshUrls = new Set(
    freshResults
      .map(item => normalizeYoutubeWatchUrl(item.url) || compactText(item.url))
      .filter(Boolean)
  );
  const priorResults = candidatePool.filter(item => {
    const url = normalizeYoutubeWatchUrl(item.url) || compactText(item.url);
    return Boolean(url) && !freshUrls.has(url);
  });

  return [
    `Fresh candidates from this pass:\n${buildCandidateSummaryForJudge(
      freshResults,
      24
    )}`,
    priorResults.length > 0
      ? `Prior candidates still available:\n${buildCandidateSummaryForJudge(
          priorResults,
          12
        )}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function createAgenticRetrievalProgressForwarder(
  onProgress?: (progress: VideoSuggestionProgress) => void
): ((progress: VideoSuggestionProgress) => void) | undefined {
  if (!onProgress) return undefined;
  return progress => {
    emitSuggestionProgress(onProgress, progress);
  };
}

function buildAgenticPlanFromPlanner({
  queryPlanner,
  answerer,
  latestUserQuery,
  fallbackQuery,
  fallbackYoutubeRegionCode,
  fallbackYoutubeSearchLanguage,
}: {
  queryPlanner?: QueryFormulatorPayload | null;
  answerer?: IntentResolverPayload | null;
  latestUserQuery: string;
  fallbackQuery?: string;
  fallbackYoutubeRegionCode?: string;
  fallbackYoutubeSearchLanguage?: string;
}): AgenticSearchPlan {
  const answererSeedQueries = buildOrderedIntentSeedQueries({
    candidates: answerer?.candidates,
    descriptorPhrases: answerer?.descriptorPhrases,
    resolvedIntent: answerer?.resolvedIntent || answerer?.intentSummary,
    latestUserQuery,
  });
  const retrievalQueries = uniqueTexts(
    [
      ...(queryPlanner?.retrievalQueries || []),
      queryPlanner?.searchQuery || '',
      ...answererSeedQueries,
      fallbackQuery || '',
      latestUserQuery,
    ].map(query => sanitizeSearchKeywords(query))
  )
    .filter(Boolean)
    .slice(0, 10);
  const normalizedBias = normalizeBiasMetadata({
    youtubeRegionCode: queryPlanner?.youtubeRegionCode,
    youtubeSearchLanguage: queryPlanner?.youtubeSearchLanguage,
    primarySearchLanguage: queryPlanner?.primarySearchLanguage,
    searchLanguages: [
      ...(queryPlanner?.searchLanguages || []),
      ...(answerer?.searchLanguages || []),
    ],
    fallbackYoutubeRegionCode:
      answerer?.youtubeRegionCode || fallbackYoutubeRegionCode,
    fallbackYoutubeSearchLanguage:
      answerer?.youtubeSearchLanguage ||
      answerer?.primarySearchLanguage ||
      fallbackYoutubeSearchLanguage ||
      'en',
  });

  return {
    searchQuery:
      sanitizeSearchKeywords(queryPlanner?.searchQuery || '') ||
      retrievalQueries[0] ||
      sanitizeSearchKeywords(answerer?.resolvedIntent || '') ||
      sanitizeSearchKeywords(fallbackQuery || latestUserQuery),
    retrievalQueries,
    youtubeRegionCode: normalizedBias.youtubeRegionCode,
    youtubeSearchLanguage: normalizedBias.youtubeSearchLanguage,
    selectedChannels: (answerer?.candidates || [])
      .map(candidate => compactText(candidate.name))
      .filter(Boolean),
    capturedPreferences:
      queryPlanner?.capturedPreferences || answerer?.capturedPreferences,
  };
}

function queryKey(value: string): string {
  return sanitizeSearchKeywords(value).toLowerCase();
}

function buildReplannedAgenticPlan({
  previousPlan,
  judge,
  answerer,
  latestUserQuery,
  triedQueryKeys,
}: {
  previousPlan: AgenticSearchPlan;
  judge: AgenticJudgePayload;
  answerer?: IntentResolverPayload | null;
  latestUserQuery: string;
  triedQueryKeys: Set<string>;
}): AgenticSearchPlan | null {
  const fallbackQueries = buildOrderedIntentSeedQueries({
    candidates: answerer?.candidates,
    descriptorPhrases: answerer?.descriptorPhrases,
    resolvedIntent: answerer?.resolvedIntent || answerer?.intentSummary,
    latestUserQuery,
  });
  const freshQueries = uniqueTexts(
    [
      ...judge.revisedQueries,
      ...fallbackQueries,
      sanitizeSearchKeywords(answerer?.resolvedIntent || ''),
      sanitizeSearchKeywords(latestUserQuery),
    ].filter(Boolean)
  )
    .filter(query => !triedQueryKeys.has(queryKey(query)))
    .slice(0, 8);

  if (freshQueries.length === 0) return null;

  return {
    ...previousPlan,
    searchQuery: freshQueries[0],
    retrievalQueries: freshQueries,
    capturedPreferences:
      judge.capturedPreferences &&
      Object.keys(judge.capturedPreferences).length > 0
        ? judge.capturedPreferences
        : previousPlan.capturedPreferences,
  };
}

function fallbackAgenticJudge({
  candidateCount,
  canContinue,
}: {
  candidateCount: number;
  canContinue: boolean;
}): AgenticJudgePayload {
  const quality =
    candidateCount >= 8 ? 'good' : candidateCount > 0 ? 'partial' : 'bad';
  return {
    quality,
    shouldContinue: canContinue && candidateCount < 6,
    reason:
      candidateCount > 0
        ? `Fallback query review accepted ${candidateCount} retrieved candidate${candidateCount === 1 ? '' : 's'}.`
        : 'Fallback query review found no retrieved candidates.',
    revisedQueries: [],
    assistantMessage:
      candidateCount > 0
        ? '__i18n__:input.videoSuggestion.defaultFollowUp'
        : '__i18n__:input.videoSuggestion.searchFailed',
  };
}

async function runAgenticJudge({
  operationId,
  model,
  translationPhase,
  signal,
  history,
  latestUserQuery,
  plan,
  candidatePool,
  currentResults,
  triedQueries,
  iteration,
  maxIterations,
  preferredLanguage,
  preferredLanguageName,
  onProgress,
  startedAt,
  onResolvedModel,
}: {
  operationId: string;
  model: string;
  translationPhase: 'draft' | 'review';
  signal?: AbortSignal;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  latestUserQuery: string;
  plan: AgenticSearchPlan;
  candidatePool: VideoSuggestionResultItem[];
  currentResults: VideoSuggestionResultItem[];
  triedQueries: string[];
  iteration: number;
  maxIterations: number;
  preferredLanguage?: string;
  preferredLanguageName?: string;
  onProgress?: (progress: VideoSuggestionProgress) => void;
  startedAt: number;
  onResolvedModel?: (model: string) => void;
}): Promise<AgenticJudgePayload> {
  const canContinue = iteration < maxIterations;
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'ranking',
    message: `Agent pass ${iteration}/${maxIterations}: checking query effectiveness.`,
    searchQuery: plan.searchQuery,
    resultCount: candidatePool.length,
    stageKey: 'planner',
    stageIndex: 2,
    stageTotal: 3,
    stageState: 'running',
    elapsedMs: Date.now() - startedAt,
  });

  try {
    const raw = await callAIModel({
      operationId: `${operationId}-judge-${iteration}`,
      model,
      translationPhase,
      modelFamilyHintSource: 'model',
      onResolvedModel,
      reasoning: { effort: translationPhase === 'review' ? 'high' : 'medium' },
      signal,
      retryAttempts: 1,
      messages: [
        {
          role: 'system',
          content: `You are the query reviewer in a bounded agentic YouTube video recommender.
Reply with JSON only. No markdown.

Schema:
{
  "quality": "good|partial|bad",
  "shouldContinue": false,
  "reason": "short reason",
  "revisedQueries": ["fresh YouTube keyword query if another pass is needed"],
  "assistantMessage": "one short helpful sentence for the user"
}

Rules:
- Do not select, rank, or filter individual observed videos. Your job is query strategy only.
- Set shouldContinue=true only when another retrieval pass is likely to improve the match and a fresh query is available.
- If shouldContinue=true, revisedQueries must avoid already tried queries and must be plain YouTube keyword searches, not operators like site:, channel:, intitle:, or boolean syntax. Use domain knowledge: native search idioms, specific shows/franchises, notable creators/studios/experts — not literal translations.
- If the current query produced plausible candidates, set shouldContinue=false even if the result list is imperfect.
- Write assistantMessage as a single sentence in the requested UI language. Do not mention implementation details or pipeline steps.`,
        },
        {
          role: 'user',
          content: [
            preferredLanguage || preferredLanguageName
              ? `User interface language: ${compactText(
                  preferredLanguageName || preferredLanguage
                )} (${compactText(preferredLanguage || '').toLowerCase()}).`
              : '',
            `Agent pass: ${iteration}/${maxIterations}. More passes allowed: ${
              canContinue ? 'yes' : 'no'
            }.`,
            buildThreadContext(history)
              ? `Conversation:\n${buildThreadContext(history)}`
              : '',
            latestUserQuery ? `Current user request:\n${latestUserQuery}` : '',
            `Current search query:\n${plan.searchQuery}`,
            plan.retrievalQueries.length > 0
              ? `Current retrieval queries:\n${plan.retrievalQueries.join('\n')}`
              : '',
            triedQueries.length > 0
              ? `Already tried queries:\n${triedQueries.join('\n')}`
              : '',
            `New results this pass: ${currentResults.length}. Total observed candidates: ${candidatePool.length}.`,
            `Observed candidates:\n${buildJudgeCandidateContext({
              currentResults,
              candidatePool,
            })}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });

    const parsed = parseAgenticJudgePayload(raw, canContinue);
    if (parsed) {
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'ranking',
        message:
          parsed.shouldContinue && canContinue
            ? `Agent pass ${iteration}/${maxIterations}: revising the search.`
            : `Agent pass ${iteration}/${maxIterations}: search query accepted.`,
        searchQuery: plan.searchQuery,
        resultCount: candidatePool.length,
        assistantPreview: parsed.reason,
        stageKey: 'planner',
        stageIndex: 2,
        stageTotal: 3,
        stageState: 'cleared',
        stageOutcome: clampTraceLines(
          [
            `Query review quality: ${parsed.quality}.`,
            parsed.reason ? `Reason: ${parsed.reason}` : '',
            parsed.revisedQueries.length > 0
              ? `Revised queries: ${summarizeValues(parsed.revisedQueries, 4)}.`
              : '',
          ],
          620
        ),
        elapsedMs: Date.now() - startedAt,
      });
      return parsed;
    }
  } catch (error) {
    if (isSuggestionAbortError(error, signal)) {
      throw error;
    }
    log.warn(
      `[video-suggestions] Agentic judge failed (${operationId} pass ${iteration}):`,
      summarizeSearchError(error)
    );
  }

  const fallback = fallbackAgenticJudge({
    candidateCount: candidatePool.length,
    canContinue,
  });
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'ranking',
    message: `Agent pass ${iteration}/${maxIterations}: fallback judge used.`,
    searchQuery: plan.searchQuery,
    resultCount: candidatePool.length,
    stageKey: 'planner',
    stageIndex: 2,
    stageTotal: 3,
    stageState: 'cleared',
    stageOutcome: fallback.reason,
    elapsedMs: Date.now() - startedAt,
  });
  return fallback;
}

async function runAgenticVideoSearchLoop({
  operationId,
  model,
  translationPhase,
  signal,
  history,
  latestUserQuery,
  initialPlan,
  answerer,
  preferredRecency,
  excludeUrls,
  preferredLanguage,
  preferredLanguageName,
  maxIterations,
  onProgress,
  startedAt,
  onResolvedModel,
}: {
  operationId: string;
  model: string;
  translationPhase: 'draft' | 'review';
  signal?: AbortSignal;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  latestUserQuery: string;
  initialPlan: AgenticSearchPlan;
  answerer?: IntentResolverPayload | null;
  preferredRecency: VideoSuggestionRecency;
  excludeUrls: Set<string>;
  preferredLanguage?: string;
  preferredLanguageName?: string;
  maxIterations: number;
  onProgress?: (progress: VideoSuggestionProgress) => void;
  startedAt: number;
  onResolvedModel?: (model: string) => void;
}): Promise<AgenticLoopOutcome> {
  let currentPlan = initialPlan;
  let candidatePool: VideoSuggestionResultItem[] = [];
  let deferredCandidatePool: VideoSuggestionResultItem[] = [];
  let observedCandidatePool: VideoSuggestionResultItem[] = [];
  let lastOutcome: VideoSearchRunOutcome | null = null;
  let lastJudge: AgenticJudgePayload | null = null;
  let lowConfidenceReason = '';
  const triedQueryKeys = new Set<string>();
  const triedQueries: string[] = [];
  const totalIterations = Math.max(1, Math.min(3, Math.floor(maxIterations)));
  const mutedRetrievalProgress =
    createAgenticRetrievalProgressForwarder(onProgress);

  for (let pass = 1; pass <= totalIterations; pass += 1) {
    throwIfSuggestionAborted(signal);

    const retrievalQueries = uniqueTexts(
      [...currentPlan.retrievalQueries, currentPlan.searchQuery].map(query =>
        sanitizeSearchKeywords(query)
      )
    )
      .filter(Boolean)
      .slice(0, 10);
    if (retrievalQueries.length === 0) break;

    for (const query of retrievalQueries) {
      const key = queryKey(query);
      if (!triedQueryKeys.has(key)) {
        triedQueryKeys.add(key);
        triedQueries.push(query);
      }
    }

    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'searching',
      message: `Agent pass ${pass}/${totalIterations}: retrieving YouTube candidates.`,
      searchQuery: retrievalQueries[0],
      assistantPreview: clampTraceMessage(
        `Trying: ${summarizeValues(retrievalQueries, 4)}.`
      ),
      stageKey: 'retrieval',
      stageIndex: 3,
      stageTotal: 3,
      stageState: 'running',
      elapsedMs: Date.now() - startedAt,
    });

    const effectiveExcludeUrls = new Set(excludeUrls);
    for (const item of observedCandidatePool) {
      const url = normalizeYoutubeWatchUrl(item.url) || compactText(item.url);
      if (url) effectiveExcludeUrls.add(url);
    }

    const continuation = createVideoSearchContinuation({
      recency: preferredRecency,
      translationPhase,
      model,
      maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
      intentQuery: currentPlan.searchQuery || retrievalQueries[0],
      youtubeRegionCode: currentPlan.youtubeRegionCode,
      youtubeSearchLanguage: currentPlan.youtubeSearchLanguage,
      retrievalQueries,
      retrievalSeedUrls: [],
      selectedChannels: currentPlan.selectedChannels,
      iteration: pass - 1,
    });

    const outcome = await runVideoSearch({
      continuation,
      excludeUrls: effectiveExcludeUrls,
      emitReuseStages: false,
      operationId,
      onProgress: mutedRetrievalProgress,
      startedAt,
      signal,
    });
    lastOutcome = outcome;
    lowConfidenceReason = outcome.lowConfidenceReason || lowConfidenceReason;
    const passResults = mergeVideoSuggestionResults([
      ...outcome.results,
      ...(outcome.continuation.pendingResults || []),
    ]);
    const observedPool = mergeVideoSuggestionResults([
      ...observedCandidatePool,
      ...passResults,
    ]);

    lastJudge = await runAgenticJudge({
      operationId,
      model,
      translationPhase,
      signal,
      history,
      latestUserQuery,
      plan: currentPlan,
      candidatePool: observedPool,
      currentResults: passResults,
      triedQueries,
      iteration: pass,
      maxIterations: totalIterations,
      preferredLanguage,
      preferredLanguageName,
      onProgress,
      startedAt,
      onResolvedModel,
    });

    const shouldDeferPass = lastJudge.shouldContinue && pass < totalIterations;
    if (!shouldDeferPass) {
      candidatePool = mergeVideoSuggestionResults([
        ...candidatePool,
        ...passResults,
      ]);
      observedCandidatePool = observedPool;
      break;
    }

    const nextPlan = buildReplannedAgenticPlan({
      previousPlan: currentPlan,
      judge: lastJudge,
      answerer,
      latestUserQuery,
      triedQueryKeys,
    });
    if (!nextPlan) {
      candidatePool = mergeVideoSuggestionResults([
        ...candidatePool,
        ...passResults,
      ]);
      observedCandidatePool = observedPool;
      break;
    }

    deferredCandidatePool = mergeVideoSuggestionResults([
      ...deferredCandidatePool,
      ...passResults,
    ]);
    observedCandidatePool = observedPool;
    currentPlan = nextPlan;
  }

  const prioritizedCandidatePool = mergeVideoSuggestionResults([
    ...candidatePool,
    ...deferredCandidatePool,
  ]);
  const pagedResults = splitContinuationPageResults({
    items: prioritizedCandidatePool,
    pageSize: VIDEO_SUGGESTION_BATCH_SIZE,
  });
  const finalResults = pagedResults.pageResults;
  const finalLowConfidenceReason =
    finalResults.length > 0
      ? undefined
      : lowConfidenceReason ||
        (lastJudge?.quality === 'bad' ? 'no-scored-results' : undefined);
  const finalSearchQuery =
    currentPlan.searchQuery ||
    currentPlan.retrievalQueries[0] ||
    lastOutcome?.searchQuery ||
    latestUserQuery;
  const finalContinuation = createVideoSearchContinuation({
    recency: preferredRecency,
    translationPhase,
    model,
    maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
    intentQuery: finalSearchQuery,
    youtubeRegionCode: currentPlan.youtubeRegionCode,
    youtubeSearchLanguage: currentPlan.youtubeSearchLanguage,
    retrievalQueries:
      currentPlan.retrievalQueries.length > 0
        ? currentPlan.retrievalQueries
        : [finalSearchQuery],
    retrievalSeedUrls: [],
    selectedChannels: currentPlan.selectedChannels,
    iteration: lastOutcome?.continuation.iteration || 1,
    pendingResults: pagedResults.pendingResults,
  });

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'finalizing',
    message:
      finalResults.length === 0
        ? 'No verified YouTube candidates survived the agent loop.'
        : `Agent loop found ${finalResults.length} result${finalResults.length === 1 ? '' : 's'}.`,
    searchQuery: finalSearchQuery,
    resultCount: finalResults.length,
    partialResults: finalResults,
    assistantPreview:
      lastJudge?.assistantMessage &&
      !lastJudge.assistantMessage.startsWith('__i18n__:')
        ? lastJudge.assistantMessage
        : undefined,
    stageKey: 'retrieval',
    stageIndex: 3,
    stageTotal: 3,
    stageState: 'cleared',
    stageOutcome: clampTraceLines(
      [
        `Prioritized candidates: ${prioritizedCandidatePool.length}.`,
        deferredCandidatePool.length > 0
          ? `Deferred fallback candidates: ${deferredCandidatePool.length}.`
          : '',
        observedCandidatePool.length !== prioritizedCandidatePool.length
          ? `Candidates seen across passes: ${observedCandidatePool.length}.`
          : '',
        `Returned candidates: ${finalResults.length}.`,
        lastJudge?.quality
          ? `Final query review quality: ${lastJudge.quality}.`
          : '',
        lastJudge?.reason ? `Reason: ${lastJudge.reason}` : '',
      ],
      620
    ),
    elapsedMs: Date.now() - startedAt,
  });

  return {
    results: finalResults,
    searchQuery: finalSearchQuery,
    continuation: finalContinuation,
    assistantMessage:
      lastJudge?.assistantMessage ||
      (finalResults.length > 0
        ? '__i18n__:input.videoSuggestion.defaultFollowUp'
        : '__i18n__:input.videoSuggestion.searchFailed'),
    capturedPreferences:
      lastJudge?.capturedPreferences &&
      Object.keys(lastJudge.capturedPreferences).length > 0
        ? lastJudge.capturedPreferences
        : currentPlan.capturedPreferences,
    lowConfidenceReason: finalLowConfidenceReason,
  };
}

function buildAnswererContextBlock({
  targetCountry,
  preferredRecency,
  modelPreference,
  includeDownloadHistory,
  includeWatchedChannels,
  recentDownloadTitles,
  recentChannelNames,
}: {
  targetCountry?: string;
  preferredRecency: VideoSuggestionRecency;
  modelPreference?: string;
  includeDownloadHistory: boolean;
  includeWatchedChannels: boolean;
  recentDownloadTitles: string[];
  recentChannelNames: string[];
}): string {
  const lines: string[] = [];

  if (compactText(modelPreference)) {
    lines.push(`Quality preference: ${compactText(modelPreference)}.`);
  }
  if (compactText(targetCountry)) {
    lines.push(`Target country: ${compactText(targetCountry)}.`);
  } else {
    lines.push('Target country: none. Default search language: English.');
  }

  lines.push(
    preferredRecency === 'any'
      ? 'Recency: any time, including older videos.'
      : `Recency: prefer ${preferredRecency}.`
  );

  if (includeDownloadHistory && recentDownloadTitles.length > 0) {
    lines.push(
      `Most recent download: ${quotedStatusValue(recentDownloadTitles[0], 120)}.`
    );
    if (recentDownloadTitles.length > 1) {
      lines.push(
        `Earlier recent downloads: ${summarizeValues(
          recentDownloadTitles.slice(1),
          3
        )}.`
      );
    }
  }
  if (includeWatchedChannels && recentChannelNames.length > 0) {
    lines.push(
      `Recent watched channels: ${summarizeValues(recentChannelNames, 4)}.`
    );
  }

  return lines.join('\n');
}

async function runSearchPlanner({
  operationId,
  model,
  modelPreference,
  translationPhase,
  signal,
  history,
  targetCountry,
  preferredRecency,
  includeDownloadHistory,
  includeWatchedChannels,
  recentDownloadTitles,
  recentChannelNames,
  savedPreferences,
  onProgress,
  startedAt,
  onResolvedModel,
}: {
  operationId: string;
  model: string;
  modelPreference?: string;
  translationPhase: 'draft' | 'review';
  signal?: AbortSignal;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  targetCountry?: string;
  preferredRecency: VideoSuggestionRecency;
  includeDownloadHistory: boolean;
  includeWatchedChannels: boolean;
  recentDownloadTitles: string[];
  recentChannelNames: string[];
  savedPreferences: ReturnType<typeof normalizePreferenceSlots>;
  onProgress?: (progress: VideoSuggestionProgress) => void;
  startedAt: number;
  onResolvedModel?: (model: string) => void;
}): Promise<SearchPlannerPayload> {
  const answererQuery =
    compactText(getLastUserQuery(history)) ||
    'Find the best YouTube video match for this request.';
  const threadContext = buildThreadContext(history);
  const settingsContext = buildAnswererContextBlock({
    targetCountry,
    preferredRecency,
    modelPreference,
    includeDownloadHistory,
    includeWatchedChannels,
    recentDownloadTitles,
    recentChannelNames,
  });
  const targetCountryLanguageInstruction =
    buildTargetCountryLanguageInstruction(targetCountry);
  const buildFallbackPayload = (): SearchPlannerPayload => {
    const seedQueries = buildOrderedIntentSeedQueries({
      resolvedIntent: answererQuery,
      latestUserQuery: answererQuery,
    });
    const fallbackQuery =
      seedQueries[0] || sanitizeSearchKeywords(answererQuery);
    return {
      resolvedIntent: fallbackQuery,
      ...normalizeBiasMetadata({}),
      retrievalQueries: fallbackQuery ? [fallbackQuery] : [],
      searchQuery: fallbackQuery,
      capturedPreferences: savedPreferences,
    };
  };
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'planning',
    message: SEARCH_PLANNER_PROGRESS_MESSAGES[0],
    stageKey: 'planner',
    stageIndex: 1,
    stageTotal: 1,
    stageState: 'running',
    elapsedMs: Date.now() - startedAt,
  });
  const stopIntentPulse = startProgressPulse({
    onProgress,
    operationId,
    phase: 'planning',
    messages: SEARCH_PLANNER_PROGRESS_MESSAGES,
    startedAt,
    extra: () => ({
      stageKey: 'planner',
      stageIndex: 1,
      stageTotal: 1,
      stageState: 'running',
    }),
  });

  try {
    const raw = await callAIModel({
      operationId: `${operationId}-search-planner`,
      model,
      translationPhase,
      modelFamilyHintSource: 'model',
      onResolvedModel,
      reasoning: { effort: 'medium' },
      webSearch: true,
      signal,
      retryAttempts: 2,
      messages: [
        {
          role: 'system',
          content: `You plan a YouTube video search for a recommender. Use web search to ground real names. Reply with JSON only. No markdown.

Schema:
{
  "assistantMessage": "one short helpful sentence; if the request is too vague to search, ask one short clarifying question instead",
  "resolvedIntent": "short canonical intent",
  "candidates": [{ "name": "search anchor: native topic term, creator, channel, franchise, studio, or expert", "confidence": "high|medium|low" }],
  "descriptorPhrases": ["retrieval-friendly descriptor phrase"],
  "youtubeRegionCode": "2-letter code like US/JP/BR, or empty if unclear",
  "youtubeSearchLanguage": "language code like en/ja/es",
  "searchLanguages": ["preferred language codes in order"],
  "retrievalQueries": ["plain YouTube keyword queries, most precise first, broadening to fallbacks"],
  "searchQuery": "must equal retrievalQueries[0]",
  "capturedPreferences": { "topic": "short topic keyword or empty" }
}

Rules:
- YouTube only. Never use operators (site:, intitle:, channel:, quotes, or boolean syntax).
- Prefer grounded specific names and native search idioms over literal translation of the user's words; use domain knowledge to surface real creators, franchises, and experts rather than restating the request.
- Order retrievalQueries from high-confidence specific seeds to broader fallbacks, and keep them in the target language when that is clearly best.
- If a target country is given you MUST set youtubeRegionCode and youtubeSearchLanguage for it; otherwise use "" and "en".
- ${targetCountryLanguageInstruction}`,
        },
        {
          role: 'user',
          content: [
            threadContext ? `Conversation thread:\n${threadContext}` : '',
            settingsContext
              ? `Current recommender settings:\n${settingsContext}`
              : '',
            targetCountry ? `App target country:\n${targetCountry}` : '',
            `Current user request:\n${answererQuery}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });
    stopIntentPulse();
    const parsed = parseSearchPlannerPayload(raw);
    if (parsed) {
      const normalizedBias = normalizeBiasMetadata({
        youtubeRegionCode: parsed.youtubeRegionCode,
        youtubeSearchLanguage: parsed.youtubeSearchLanguage,
        primarySearchLanguage: parsed.primarySearchLanguage,
        searchLanguages: parsed.searchLanguages,
      });
      const normalizedCandidates = normalizeIntentCandidates(parsed.candidates);
      const normalizedDescriptorPhrases = normalizeDescriptorPhrases(
        parsed.descriptorPhrases
      );
      const fallbackQueries = buildOrderedIntentSeedQueries({
        candidates: normalizedCandidates,
        descriptorPhrases: normalizedDescriptorPhrases,
        resolvedIntent: parsed.resolvedIntent || parsed.intentSummary,
        latestUserQuery: answererQuery,
      });
      const resolvedIntent =
        parsed.resolvedIntent ||
        parsed.intentSummary ||
        fallbackQueries[0] ||
        sanitizeSearchKeywords(answererQuery);
      const retrievalQueries = uniqueTexts(
        [
          ...(parsed.retrievalQueries || []),
          parsed.searchQuery || '',
          ...fallbackQueries,
        ].map(query => sanitizeSearchKeywords(query))
      )
        .filter(Boolean)
        .slice(0, 10);
      const normalizedParsed: SearchPlannerPayload = {
        ...parsed,
        resolvedIntent,
        capturedPreferences:
          parsed.capturedPreferences &&
          Object.keys(parsed.capturedPreferences).length > 0
            ? parsed.capturedPreferences
            : savedPreferences,
        candidates: normalizedCandidates,
        descriptorPhrases: normalizedDescriptorPhrases,
        youtubeRegionCode: normalizedBias.youtubeRegionCode,
        youtubeSearchLanguage: normalizedBias.youtubeSearchLanguage,
        primarySearchLanguage: normalizedBias.primarySearchLanguage,
        searchLanguages: normalizedBias.searchLanguages,
        retrievalQueries,
        searchQuery:
          sanitizeSearchKeywords(parsed.searchQuery || '') ||
          retrievalQueries[0] ||
          resolvedIntent,
      };

      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'planning',
        message: 'Search plan ready.',
        searchQuery:
          normalizedParsed.searchQuery ||
          fallbackQueries[0] ||
          normalizedParsed.resolvedIntent ||
          '',
        assistantPreview: clampTraceMessage(
          [
            normalizedParsed.candidates?.length
              ? `Candidates: ${summarizeValues(
                  normalizedParsed.candidates.map(item => item.name),
                  3
                )}`
              : '',
            normalizedParsed.retrievalQueries?.length
              ? `Queries: ${summarizeValues(normalizedParsed.retrievalQueries, 3)}`
              : '',
          ]
            .filter(Boolean)
            .join(' | ')
        ),
        stageKey: 'planner',
        stageIndex: 1,
        stageTotal: 1,
        stageState: 'cleared',
        stageOutcome: clampTraceLines(
          [
            normalizedParsed.candidates?.length
              ? `Likely candidates (${normalizedParsed.candidates.length}): ${summarizeValues(
                  normalizedParsed.candidates.map(item => item.name),
                  4
                )}.`
              : 'No likely candidates were found.',
            normalizedParsed.retrievalQueries?.length
              ? `Retrieval queries (${normalizedParsed.retrievalQueries.length}): ${summarizeValues(
                  normalizedParsed.retrievalQueries,
                  4
                )}.`
              : '',
          ],
          620
        ),
        elapsedMs: Date.now() - startedAt,
      });
      return normalizedParsed;
    }

    const answerText = clampMessage(compactText(raw));
    if (answerText) {
      const fallbackPayload = buildFallbackPayload();
      const fallbackPlan: SearchPlannerPayload = {
        ...fallbackPayload,
        assistantMessage: answerText,
        intentSummary: answerText,
      };
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'planning',
        message: 'Search plan ready.',
        searchQuery:
          fallbackPlan.searchQuery || fallbackPlan.resolvedIntent || '',
        assistantPreview: clampTraceMessage(`Plan: ${answerText}`),
        stageKey: 'planner',
        stageIndex: 1,
        stageTotal: 1,
        stageState: 'cleared',
        stageOutcome: clampTraceLines([`Plan: ${answerText}`], 620),
        elapsedMs: Date.now() - startedAt,
      });
      return fallbackPlan;
    }
  } catch (error) {
    stopIntentPulse();
    if (isSuggestionAbortError(error, signal)) {
      throw error;
    }
    const errorDetail = summarizeSearchError(error);
    log.error(
      `[video-suggestions] Search planner failed (${operationId}):`,
      errorDetail
    );
  }

  return buildFallbackPayload();
}

async function runClarifyingFollowUp({
  operationId,
  model,
  translationPhase,
  signal,
  history,
  results,
  searchQuery,
  preferredLanguage,
  preferredLanguageName,
  onResolvedModel,
}: {
  operationId: string;
  model: string;
  translationPhase: 'draft' | 'review';
  signal?: AbortSignal;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  results?: VideoSuggestionResultItem[];
  searchQuery?: string;
  preferredLanguage?: string;
  preferredLanguageName?: string;
  onResolvedModel?: (model: string) => void;
}): Promise<string> {
  const latestUserQuery = compactText(getLastUserQuery(history));
  const topTitles = uniqueTexts(
    (results || []).map(item => compactText(item.title || ''))
  ).slice(0, 4);

  try {
    const raw = await callAIModel({
      operationId: `${operationId}-clarifying-follow-up`,
      model,
      translationPhase,
      modelFamilyHintSource: 'model',
      onResolvedModel,
      reasoning: { effort: 'low' },
      signal,
      retryAttempts: 1,
      messages: [
        {
          role: 'system',
          content: `Write one short, friendly follow-up sentence after a YouTube search. If the request was clear, suggest a closely related next search. If it was too vague, ask one short clarifying question instead. Write it in the requested UI language. Keep it to a single sentence; do not list examples or explain the search.`,
        },
        {
          role: 'user',
          content: [
            preferredLanguage || preferredLanguageName
              ? `UI language: ${compactText(
                  preferredLanguageName || preferredLanguage
                )} (${compactText(preferredLanguage || '').toLowerCase()}).`
              : '',
            latestUserQuery ? `Current user request:\n${latestUserQuery}` : '',
            searchQuery ? `Search used:\n${searchQuery}` : '',
            `Results found: ${(results || []).length}.`,
            topTitles.length > 0
              ? `Top result titles:\n${topTitles.join('\n')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });
    return compactText(raw);
  } catch (error) {
    if (isSuggestionAbortError(error, signal)) {
      throw error;
    }
    log.warn(
      `[video-suggestions] Clarifying follow-up failed (${operationId}):`,
      summarizeSearchError(error)
    );
    return '';
  }
}

export async function suggestVideosViaChat(
  request: VideoSuggestionChatRequest,
  runtimeOptions: SuggestVideoRuntimeOptions = {}
): Promise<VideoSuggestionChatResult> {
  const operationId = request.operationId || `video-suggest-${Date.now()}`;
  const startedAt = Date.now();
  const onProgress = runtimeOptions.onProgress;
  const signal = runtimeOptions.signal;
  throwIfSuggestionAborted(signal);
  const history = toPlannerMessages(request.history);
  const hasUserMessage = history.some(msg => msg.role === 'user');
  const lastUserMessage = [...history]
    .reverse()
    .find(msg => msg.role === 'user')?.content;
  const broadAcceptance = isBroadAcceptanceReply(lastUserMessage || '');
  const fallbackTopic = broadAcceptance
    ? findFallbackTopicFromHistory(history.slice(0, -1))
    : '';
  const preference: VideoSuggestionModelPreference =
    normalizeVideoSuggestionModelPreference(request.modelPreference);
  const suggestionTranslationPhase =
    resolveVideoSuggestionTranslationPhase(preference);
  const resolvedModel = normalizeAiModelId(
    resolveVideoSuggestionModel(preference)
  );
  let observedResolvedModel = resolvedModel;
  const observeResolvedModel = (model: string) => {
    const normalized = normalizeAiModelId(model);
    if (normalized) {
      observedResolvedModel = normalized;
    }
  };
  const sourceLabel = VIDEO_SUGGESTION_SOURCE_LABEL;
  const targetCountry = sanitizeCountryHint(request.targetCountry);
  const requestYoutubeRegionCode = sanitizeYoutubeRegionCode(
    request.youtubeRegionCode
  );
  const requestYoutubeSearchLanguage =
    sanitizeLanguageToken(request.youtubeSearchLanguage).toLowerCase() || 'en';
  const preferredRecency = normalizeRecency(request.preferredRecency);
  const savedPreferences = normalizePreferenceSlots(request.savedPreferences);
  const includeDownloadHistory = Boolean(
    request.contextToggles?.includeDownloadHistory
  );
  const includeWatchedChannels = Boolean(
    request.contextToggles?.includeWatchedChannels
  );
  const recentDownloadTitles = Array.isArray(request.recentDownloadTitles)
    ? request.recentDownloadTitles
        .map(value => compactText(value))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const recentChannelNames = Array.isArray(request.recentChannelNames)
    ? request.recentChannelNames
        .map(value => compactText(value))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const queryOverride = sanitizeSearchKeywords(
    compactText(request.searchQueryOverride || '')
  );
  const broadAcceptanceQuery =
    !queryOverride && broadAcceptance && fallbackTopic
      ? sanitizeSearchKeywords(fallbackTopic)
      : '';
  const forcedSearchQueryRaw = queryOverride || broadAcceptanceQuery;
  const excludeUrls = normalizeExcludeUrls(request.excludeUrls);
  let activeContinuationId = compactText(request.continuationId) || undefined;
  const runIncrementalSearch = async ({
    continuation,
    continuationId,
    assistantMessage,
  }: {
    continuation: VideoSearchContinuation;
    continuationId?: string;
    assistantMessage: string;
  }): Promise<VideoSuggestionChatResult> => {
    try {
      const outcome = await runVideoSearch({
        continuation,
        excludeUrls,
        operationId,
        onProgress,
        startedAt,
        signal,
      });
      const nextContinuationId = persistVideoSearchContinuation(
        outcome.continuation,
        continuationId
      );
      const nextAssistantMessage =
        (await runClarifyingFollowUp({
          operationId,
          model: resolvedModel,
          translationPhase: suggestionTranslationPhase,
          signal,
          history,
          results: outcome.results,
          searchQuery: outcome.searchQuery,
          preferredLanguage: request.preferredLanguage,
          preferredLanguageName: request.preferredLanguageName,
          onResolvedModel: observeResolvedModel,
        })) || assistantMessage;

      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'finalizing',
        message:
          outcome.results.length === 0
            ? 'No additional matches found.'
            : `Found ${outcome.results.length} additional result${outcome.results.length === 1 ? '' : 's'}.`,
        searchQuery: outcome.searchQuery,
        resultCount: outcome.results.length,
        elapsedMs: Date.now() - startedAt,
      });
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'done',
        message: 'Suggestions ready.',
        searchQuery: outcome.searchQuery,
        resultCount: outcome.results.length,
        elapsedMs: Date.now() - startedAt,
      });

      return {
        success: true,
        assistantMessage: compactText(nextAssistantMessage),
        searchQuery: outcome.searchQuery,
        youtubeRegionCode: outcome.continuation.youtubeRegionCode,
        youtubeSearchLanguage: outcome.continuation.youtubeSearchLanguage,
        results: outcome.results,
        continuationId: nextContinuationId,
        resolvedModel: observedResolvedModel,
      };
    } catch (error: any) {
      if (isSuggestionAbortError(error, signal)) {
        throw error;
      }
      const detail = summarizeSearchError(error);
      log.error(
        `[video-suggestions] Incremental retrieval failed (${operationId}):`,
        detail
      );
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'error',
        message: detail,
        elapsedMs: Date.now() - startedAt,
      });
      return {
        success: false,
        assistantMessage: '__i18n__:input.videoSuggestion.searchFailed',
        searchQuery:
          continuation.retrievalQueries[0] || continuation.intentQuery,
        results: [],
        resolvedModel: observedResolvedModel,
        error: detail,
      };
    }
  };
  const storedContinuation = getVideoSearchContinuation(activeContinuationId);

  if (storedContinuation) {
    return runIncrementalSearch({
      continuation: storedContinuation,
      continuationId: activeContinuationId,
      assistantMessage: '__i18n__:input.videoSuggestion.defaultFollowUp',
    });
  }

  if (queryOverride) {
    try {
      const outcome = await runVideoSearch({
        continuation: createVideoSearchContinuation({
          recency: preferredRecency,
          translationPhase: suggestionTranslationPhase,
          model: resolvedModel,
          maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
          intentQuery: queryOverride,
          youtubeRegionCode: requestYoutubeRegionCode,
          youtubeSearchLanguage: requestYoutubeSearchLanguage,
          retrievalQueries: [queryOverride],
          retrievalSeedUrls: [],
          selectedChannels: [],
          iteration: 0,
        }),
        excludeUrls,
        operationId,
        onProgress,
        startedAt,
        signal,
      });
      const nextContinuationId = persistVideoSearchContinuation(
        outcome.continuation,
        activeContinuationId
      );
      activeContinuationId = nextContinuationId;
      const assistantMessage =
        (await runClarifyingFollowUp({
          operationId,
          model: resolvedModel,
          translationPhase: suggestionTranslationPhase,
          signal,
          history: [
            {
              role: 'user',
              content: `Intent: ${queryOverride}`,
            },
          ],
          results: outcome.results,
          searchQuery: outcome.searchQuery,
          preferredLanguage: request.preferredLanguage,
          preferredLanguageName: request.preferredLanguageName,
          onResolvedModel: observeResolvedModel,
        })) || '__i18n__:input.videoSuggestion.defaultFollowUp';

      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'finalizing',
        message:
          outcome.results.length === 0
            ? 'No additional matches found.'
            : `Found ${outcome.results.length} additional result${outcome.results.length === 1 ? '' : 's'}.`,
        searchQuery: outcome.searchQuery,
        resultCount: outcome.results.length,
        elapsedMs: Date.now() - startedAt,
      });
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'done',
        message: 'Suggestions ready.',
        searchQuery: outcome.searchQuery,
        resultCount: outcome.results.length,
        elapsedMs: Date.now() - startedAt,
      });

      return {
        success: true,
        assistantMessage: compactText(assistantMessage),
        searchQuery: outcome.searchQuery,
        youtubeRegionCode: outcome.continuation.youtubeRegionCode,
        youtubeSearchLanguage: outcome.continuation.youtubeSearchLanguage,
        results: outcome.results,
        continuationId: nextContinuationId,
        resolvedModel: observedResolvedModel,
      };
    } catch (error: any) {
      if (isSuggestionAbortError(error, signal)) {
        throw error;
      }
      const detail = summarizeSearchError(error);
      log.error(
        `[video-suggestions] Broad acceptance search failed (${operationId}):`,
        detail
      );
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'error',
        message: detail,
        elapsedMs: Date.now() - startedAt,
      });
      return {
        success: false,
        assistantMessage: '__i18n__:input.videoSuggestion.searchFailed',
        searchQuery: queryOverride,
        youtubeRegionCode: requestYoutubeRegionCode,
        youtubeSearchLanguage: requestYoutubeSearchLanguage,
        results: [],
        resolvedModel: observedResolvedModel,
        error: detail,
      };
    }
  }

  if (broadAcceptanceQuery) {
    let results: VideoSuggestionResultItem[] = [];
    let searchQuery = '';
    let assistantMessage = 'Searching now.';
    const forcedHistory: Array<{
      role: 'user' | 'assistant';
      content: string;
    }> = [
      {
        role: 'user',
        content: `Intent: ${forcedSearchQueryRaw}`,
      },
    ];

    try {
      const forcedIntent = await runSearchPlanner({
        operationId,
        model: resolvedModel,
        translationPhase: suggestionTranslationPhase,
        signal,
        history: forcedHistory,
        targetCountry,
        preferredRecency,
        includeDownloadHistory,
        includeWatchedChannels,
        recentDownloadTitles,
        recentChannelNames,
        savedPreferences,
        onProgress,
        startedAt,
        onResolvedModel: observeResolvedModel,
      });
      // Single merged planner now produces both the intent seeds and the query
      // plan; alias so the existing downstream wiring is unchanged.
      const forcedPlan = forcedIntent;
      const agentOutcome = await runAgenticVideoSearchLoop({
        operationId,
        model: resolvedModel,
        translationPhase: suggestionTranslationPhase,
        signal,
        history: forcedHistory,
        latestUserQuery: forcedSearchQueryRaw,
        answerer: forcedIntent,
        initialPlan: buildAgenticPlanFromPlanner({
          queryPlanner: forcedPlan,
          answerer: forcedIntent,
          latestUserQuery: forcedSearchQueryRaw,
          fallbackQuery: forcedSearchQueryRaw,
          fallbackYoutubeRegionCode: requestYoutubeRegionCode,
          fallbackYoutubeSearchLanguage: requestYoutubeSearchLanguage,
        }),
        excludeUrls,
        preferredRecency,
        preferredLanguage: request.preferredLanguage,
        preferredLanguageName: request.preferredLanguageName,
        maxIterations: resolveAgenticIterationLimit({
          preference,
          translationPhase: suggestionTranslationPhase,
        }),
        onProgress,
        startedAt,
        onResolvedModel: observeResolvedModel,
      });
      const nextContinuationId = persistVideoSearchContinuation(
        agentOutcome.continuation,
        activeContinuationId
      );
      activeContinuationId = nextContinuationId;
      results = agentOutcome.results;
      searchQuery = agentOutcome.searchQuery;
      assistantMessage =
        agentOutcome.assistantMessage ||
        forcedPlan?.assistantMessage ||
        assistantMessage;
      if (agentOutcome.lowConfidenceReason) {
        emitSuggestionProgress(onProgress, {
          operationId,
          phase: 'finalizing',
          message: `${describeLowConfidenceReason(
            agentOutcome.lowConfidenceReason
          )} Try a broader topic, add one more detail, or change recency.`,
          searchQuery,
          resultCount: 0,
          elapsedMs: Date.now() - startedAt,
        });
      }
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'finalizing',
        message:
          results.length === 0
            ? 'No additional matches found.'
            : `Found ${results.length} additional result${results.length === 1 ? '' : 's'}.`,
        searchQuery,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt,
      });
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'done',
        message: 'Suggestions ready.',
        searchQuery,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt,
      });
      return {
        success: true,
        assistantMessage: compactText(assistantMessage),
        searchQuery,
        youtubeRegionCode: agentOutcome.continuation.youtubeRegionCode,
        youtubeSearchLanguage: agentOutcome.continuation.youtubeSearchLanguage,
        results,
        capturedPreferences:
          agentOutcome.capturedPreferences ||
          forcedPlan?.capturedPreferences ||
          forcedIntent?.capturedPreferences,
        continuationId: nextContinuationId,
        resolvedModel: observedResolvedModel,
      };
    } catch (error: any) {
      if (isSuggestionAbortError(error, signal)) {
        throw error;
      }
      const detail = summarizeSearchError(error);
      log.error(
        `[video-suggestions] Search-more failed (${operationId}):`,
        detail
      );
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'error',
        message: detail,
        elapsedMs: Date.now() - startedAt,
      });
      return {
        success: false,
        assistantMessage: '__i18n__:input.videoSuggestion.searchFailed',
        searchQuery: forcedSearchQueryRaw,
        youtubeRegionCode: requestYoutubeRegionCode,
        youtubeSearchLanguage: requestYoutubeSearchLanguage,
        results: [],
        resolvedModel: observedResolvedModel,
        error: detail,
      };
    }
  }

  const plannerHistory = hasUserMessage
    ? history
    : [
        {
          role: 'user' as const,
          content:
            'Start the chat with one short question asking what kind of video I want and which target country to use.',
        },
      ];

  const answerer = await runSearchPlanner({
    operationId,
    model: resolvedModel,
    translationPhase: suggestionTranslationPhase,
    signal,
    history: plannerHistory,
    targetCountry,
    preferredRecency,
    includeDownloadHistory,
    includeWatchedChannels,
    recentDownloadTitles,
    recentChannelNames,
    savedPreferences,
    onProgress,
    startedAt,
    onResolvedModel: observeResolvedModel,
  });
  // Single merged planner produces both intent seeds and the query plan; alias
  // so the existing downstream wiring (answerer + queryPlanner) is unchanged.
  const queryPlanner = answerer;
  try {
    let assistantMessage = queryPlanner?.assistantMessage || '';
    const plannerRetrievalQueries = uniqueTexts(
      (queryPlanner?.retrievalQueries || []).map(query =>
        sanitizeSearchKeywords(query)
      )
    ).slice(0, 10);

    let searchQuery = sanitizeSearchKeywords(
      queryPlanner?.searchQuery ||
        plannerRetrievalQueries[0] ||
        answerer?.resolvedIntent ||
        ''
    );
    const baseQueryForSearch = () =>
      sanitizeSearchKeywords(
        searchQuery ||
          queryPlanner?.intentSummary ||
          answerer?.resolvedIntent ||
          fallbackTopic ||
          plannerRetrievalQueries[0] ||
          ''
      );

    if (!searchQuery && broadAcceptance && fallbackTopic) {
      // Fallback for "any/whatever" replies: proceed using the known topic
      // instead of forcing another narrowing loop.
      searchQuery = sanitizeSearchKeywords(fallbackTopic);
    }

    if (searchQuery) {
      searchQuery = sanitizeSearchKeywords(searchQuery);
    }

    let results: VideoSuggestionResultItem[] = [];
    let searchFailureDetail = '';
    let capturedPreferences =
      queryPlanner?.capturedPreferences || answerer?.capturedPreferences;

    const effectiveBaseQuery = baseQueryForSearch();
    if (hasUserMessage && effectiveBaseQuery) {
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'searching',
        message: `Searching ${sourceLabel} for ${quotedStatusValue(effectiveBaseQuery)} (${recencyLabel(preferredRecency)}).`,
        searchQuery: effectiveBaseQuery,
        assistantPreview: assistantMessage.startsWith('__i18n__:')
          ? undefined
          : assistantMessage,
        elapsedMs: Date.now() - startedAt,
      });
      try {
        const agentOutcome = await runAgenticVideoSearchLoop({
          operationId,
          model: resolvedModel,
          translationPhase: suggestionTranslationPhase,
          signal,
          history: plannerHistory,
          latestUserQuery:
            getLastUserQuery(plannerHistory) || effectiveBaseQuery,
          answerer,
          initialPlan: buildAgenticPlanFromPlanner({
            queryPlanner,
            answerer,
            latestUserQuery:
              getLastUserQuery(plannerHistory) || effectiveBaseQuery,
            fallbackQuery: effectiveBaseQuery,
            fallbackYoutubeRegionCode: requestYoutubeRegionCode,
            fallbackYoutubeSearchLanguage: requestYoutubeSearchLanguage,
          }),
          preferredRecency,
          excludeUrls,
          preferredLanguage: request.preferredLanguage,
          preferredLanguageName: request.preferredLanguageName,
          maxIterations: resolveAgenticIterationLimit({
            preference,
            translationPhase: suggestionTranslationPhase,
          }),
          onProgress,
          startedAt,
          onResolvedModel: observeResolvedModel,
        });
        const nextContinuationId = persistVideoSearchContinuation(
          agentOutcome.continuation,
          activeContinuationId
        );
        activeContinuationId = nextContinuationId;
        results = agentOutcome.results;
        searchQuery = agentOutcome.searchQuery;
        capturedPreferences =
          agentOutcome.capturedPreferences || capturedPreferences;
        assistantMessage =
          agentOutcome.assistantMessage ||
          queryPlanner?.assistantMessage ||
          assistantMessage ||
          '__i18n__:input.videoSuggestion.defaultFollowUp';
        if (agentOutcome.lowConfidenceReason) {
          searchFailureDetail = lowConfidenceErrorKey(
            agentOutcome.lowConfidenceReason
          );
          emitSuggestionProgress(onProgress, {
            operationId,
            phase: 'finalizing',
            message: `${describeLowConfidenceReason(
              agentOutcome.lowConfidenceReason
            )} Try a broader topic, add one more detail, or change recency.`,
            searchQuery,
            resultCount: 0,
            elapsedMs: Date.now() - startedAt,
          });
        }
      } catch (error: any) {
        if (isSuggestionAbortError(error, signal)) {
          throw error;
        }
        searchFailureDetail = summarizeSearchError(error);
        log.error(
          `[video-suggestions] Search failed (${operationId}):`,
          searchFailureDetail
        );
        assistantMessage = '__i18n__:input.videoSuggestion.searchFailed';
        emitSuggestionProgress(onProgress, {
          operationId,
          phase: 'error',
          message: searchFailureDetail,
          searchQuery,
          elapsedMs: Date.now() - startedAt,
        });
      }
    }

    // The merged planner already supplies a concise assistantMessage (an answer
    // preview, or a clarifying question when the request is too vague), and the
    // judge overwrites it after the search loop. Fall back to the default
    // follow-up rather than spending another LLM call.
    if (hasUserMessage && !searchFailureDetail && !assistantMessage.trim()) {
      assistantMessage = '__i18n__:input.videoSuggestion.defaultFollowUp';
    }

    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'finalizing',
      searchQuery,
      resultCount: results.length,
      assistantPreview: assistantMessage.startsWith('__i18n__:')
        ? undefined
        : assistantMessage,
      elapsedMs: Date.now() - startedAt,
    });

    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'done',
      message: 'Suggestions ready.',
      searchQuery,
      resultCount: results.length,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      success: true,
      assistantMessage: compactText(assistantMessage),
      searchQuery,
      youtubeRegionCode:
        getVideoSearchContinuation(activeContinuationId)?.youtubeRegionCode ||
        undefined,
      youtubeSearchLanguage:
        getVideoSearchContinuation(activeContinuationId)
          ?.youtubeSearchLanguage || undefined,
      results,
      capturedPreferences,
      continuationId: activeContinuationId,
      resolvedModel: observedResolvedModel,
      error: searchFailureDetail || undefined,
    };
  } catch (error: any) {
    if (isSuggestionAbortError(error, signal)) {
      throw error;
    }
    log.error(
      `[video-suggestions] Chat failed (${operationId}):`,
      error?.message || error
    );
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'error',
      message: 'Suggestion request failed.',
      elapsedMs: Date.now() - startedAt,
    });
    return {
      success: false,
      assistantMessage: hasUserMessage
        ? '__i18n__:input.videoSuggestion.genericError'
        : STARTER_QUESTION,
      searchQuery: '',
      results: [],
      resolvedModel: observedResolvedModel,
      error: error?.message || 'Failed to suggest videos',
    };
  }
}
