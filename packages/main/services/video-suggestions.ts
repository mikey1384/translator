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
  parseIntentResolverPayload,
  parseQueryFormulatorPayload,
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
} from './video-suggestions/search.js';
import {
  type IntentResolverPayload,
  type QueryFormulatorPayload,
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
const INTENT_RESOLUTION_PROGRESS_MESSAGES = [
  'Answering the question first...',
  'Checking likely interpretations...',
  'Locking the best answer before search...',
];
const QUERY_FORMULATOR_PROGRESS_MESSAGES = [
  'Turning the answer into search queries...',
  'Shaping the best search queries...',
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

function buildTargetCountryLanguageInstruction(
  targetCountry?: string
): string {
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

async function runIntentResolver({
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
}) {
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
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'planning',
    message: INTENT_RESOLUTION_PROGRESS_MESSAGES[0],
    stageKey: 'answerer',
    stageIndex: 1,
    stageTotal: 3,
    stageState: 'running',
    elapsedMs: Date.now() - startedAt,
  });
  const stopIntentPulse = startProgressPulse({
    onProgress,
    operationId,
    phase: 'planning',
    messages: INTENT_RESOLUTION_PROGRESS_MESSAGES,
    startedAt,
    extra: () => ({
      stageKey: 'answerer',
      stageIndex: 1,
      stageTotal: 3,
      stageState: 'running',
    }),
  });

  try {
    const raw = await callAIModel({
      operationId: `${operationId}-intent-resolver`,
      model,
      translationPhase,
      onResolvedModel,
      reasoning: { effort: 'medium' },
      webSearch: true,
      signal,
      retryAttempts: 2,
      messages: [
        {
          role: 'system',
          content: `You resolve recommendation intent for a YouTube video finder.
Use web search as a supporting signal, not a hard gate. The goal is strong candidate generation for retrieval, not perfect verification.
Reply with JSON only. No markdown.

Schema:
{
  "answerToUserQuestion": "short direct answer or recommendation",
  "resolvedIntent": "short canonical intent",
  "intentSummary": "short summary",
  "youtubeRegionCode": "2-letter YouTube region code like US/JP/BR or empty string if unclear",
  "youtubeSearchLanguage": "language code like en/ja/es",
  "candidates": [
    {
      "name": "direct answer to user's query",
      "confidence": "high"
    },
    {
      "name": "direct answer to user's query 2",
      "confidence": "medium"
    },
    {
      "name": "direct answer to user's query 3",
      "confidence": "medium"
    },
    {
      "name": "most likely specific candidate that could help find the right video",
      "confidence": "medium"
    },
    {
      "name": "another likely specific candidate that could help find the right video",
      "confidence": "medium"
    }
  ],
  "descriptorPhrases": [
    "retrieval-friendly descriptor phrase",
    "broader descriptor phrase"
  ],
  "primarySearchLanguage": "same language code as youtubeSearchLanguage",
  "searchLanguages": ["preferred language codes in order"],
    "capturedPreferences": {
      "topic": "short topic keyword or empty"
    },
  "needsMoreContext": false
}

Rules:
- Search source is YouTube only.
- Always use websearch first.
- If Target country is present, you MUST output youtubeRegionCode and youtubeSearchLanguage for it. Do not omit them.
- If the target country is unclear or not a real place, set youtubeRegionCode="" and youtubeSearchLanguage="en".
- primarySearchLanguage must equal youtubeSearchLanguage.
- Treat candidates as a wide pool of likely targets, not a single winner.
- Return at least 10 likely candidates whenever the request is broad enough to support that many plausible targets. Return fewer only when the space is genuinely narrow.
- Prefer grounded specific names when available, but if a likely fit is obvious you may still propose it even when this run does not fully verify it.
- Use confidence to express uncertainty. High = strongly likely, medium = plausible, low = speculative fallback.
- answerToUserQuestion should state the likely best direction directly. Do not fill it with verification caveats or "I could not reliably ground..." style hedging.
- Prefer credible specific names over generic descriptors when they are likely to improve retrieval.
- descriptorPhrases must be retrieval-friendly phrases built from the user's request. Do not output vague adjectives alone.
- Do not output final retrievalQueries. Step 2 will order the plan.
- If the request is too vague to act on, set needsMoreContext=true and explain briefly in answerToUserQuestion.`,
        },
        {
          role: 'user',
          content: [
            threadContext ? `Conversation thread:\n${threadContext}` : '',
            settingsContext
              ? `Current recommender settings:\n${settingsContext}`
              : '',
            `Current user request:\n${answererQuery}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });
    stopIntentPulse();
    const parsed = parseIntentResolverPayload(raw);
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
      const normalizedParsed: IntentResolverPayload = {
        ...parsed,
        resolvedIntent:
          parsed.resolvedIntent ||
          parsed.intentSummary ||
          fallbackQueries[0] ||
          sanitizeSearchKeywords(answererQuery),
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
      };

      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'planning',
        message: 'Step 1/3 cleared: answerer ready.',
        searchQuery:
          fallbackQueries[0] || normalizedParsed.resolvedIntent || '',
        assistantPreview: clampTraceMessage(
          [
            normalizedParsed.answerToUserQuestion
              ? `Answer: ${normalizedParsed.answerToUserQuestion}`
              : '',
            normalizedParsed.candidates?.length
              ? `Candidates: ${summarizeValues(
                  normalizedParsed.candidates.map(item => item.name),
                  3
                )}`
              : '',
            normalizedParsed.descriptorPhrases?.length
              ? `Descriptors: ${summarizeValues(
                  normalizedParsed.descriptorPhrases,
                  3
                )}`
              : '',
          ]
            .filter(Boolean)
            .join(' | ')
        ),
        stageKey: 'answerer',
        stageIndex: 1,
        stageTotal: 3,
        stageState: 'cleared',
        stageOutcome: clampTraceLines(
          [
            normalizedParsed.answerToUserQuestion
              ? `Answer: ${normalizedParsed.answerToUserQuestion}`
              : '',
            normalizedParsed.candidates?.length
              ? `Likely candidates (${normalizedParsed.candidates.length}): ${summarizeValues(
                  normalizedParsed.candidates.map(item => item.name),
                  4
                )}.`
              : 'No likely candidates were found.',
            normalizedParsed.descriptorPhrases?.length
              ? `Descriptor phrases: ${summarizeValues(
                  normalizedParsed.descriptorPhrases,
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
      const fallbackQuery = sanitizeSearchKeywords(answererQuery);
      const resolvedAnchor =
        sanitizeSearchKeywords(answerText) || fallbackQuery;
      const parsed: IntentResolverPayload = {
        answerToUserQuestion: answerText,
        resolvedIntent: resolvedAnchor || answerText,
        intentSummary: answerText,
        ...normalizeBiasMetadata({}),
        capturedPreferences: savedPreferences,
      };
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'planning',
        message: 'Step 1/3 cleared: answerer ready.',
        searchQuery: parsed.resolvedIntent || '',
        assistantPreview: clampTraceMessage(`Answer: ${answerText}`),
        stageKey: 'answerer',
        stageIndex: 1,
        stageTotal: 3,
        stageState: 'cleared',
        stageOutcome: clampTraceLines([`Answer: ${answerText}`], 620),
        elapsedMs: Date.now() - startedAt,
      });
      return parsed;
    }
  } catch (error) {
    stopIntentPulse();
    if (isSuggestionAbortError(error, signal)) {
      throw error;
    }
    const errorDetail = summarizeSearchError(error);
    log.error(
      `[video-suggestions] Answerer failed (${operationId}):`,
      errorDetail
    );
  }
}

async function runQueryFormulator({
  operationId,
  model,
  translationPhase,
  signal,
  history,
  answerer,
  targetCountry,
  onProgress,
  startedAt,
  onResolvedModel,
}: {
  operationId: string;
  model: string;
  translationPhase: 'draft' | 'review';
  signal?: AbortSignal;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  answerer?: IntentResolverPayload | null;
  targetCountry?: string;
  onProgress?: (progress: VideoSuggestionProgress) => void;
  startedAt: number;
  onResolvedModel?: (model: string) => void;
}): Promise<QueryFormulatorPayload | null> {
  const answererText = compactText(answerer?.answerToUserQuestion || '');
  const latestUserQuery = compactText(getLastUserQuery(history));
  const answererSeedQueries = buildOrderedIntentSeedQueries({
    candidates: answerer?.candidates,
    descriptorPhrases: answerer?.descriptorPhrases,
    resolvedIntent: answerer?.resolvedIntent || answerer?.intentSummary,
    latestUserQuery,
  });
  const answererAnchor =
    answererSeedQueries[0] ||
    sanitizeSearchKeywords(answerer?.resolvedIntent || '') ||
    sanitizeSearchKeywords(answererText);
  const threadContext = buildThreadContext(history);
  const targetCountryLanguageInstruction =
    buildTargetCountryLanguageInstruction(targetCountry);
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'planning',
    message: QUERY_FORMULATOR_PROGRESS_MESSAGES[0],
    stageKey: 'planner',
    stageIndex: 2,
    stageTotal: 3,
    stageState: 'running',
    elapsedMs: Date.now() - startedAt,
  });
  const stopPulse = startProgressPulse({
    onProgress,
    operationId,
    phase: 'planning',
    messages: QUERY_FORMULATOR_PROGRESS_MESSAGES,
    startedAt,
    extra: () => ({
      stageKey: 'planner',
      stageIndex: 2,
      stageTotal: 3,
      stageState: 'running',
    }),
  });

  try {
    const raw = await callAIModel({
      operationId: `${operationId}-query-formulator`,
      model,
      translationPhase,
      onResolvedModel,
      reasoning: { effort: 'medium' },
      signal,
      retryAttempts: 2,
      messages: [
        {
          role: 'system',
          content: `Turn the structured intent output into an ordered yt-dlp YouTube search plan.
Reply with JSON only. No markdown.

Schema:
{
  "youtubeRegionCode": "2-letter YouTube region code like US/JP/BR or empty string if unclear",
  "youtubeSearchLanguage": "language code like en/ja/es",
  "primarySearchLanguage": "same language code as youtubeSearchLanguage",
  "searchLanguages": ["preferred language codes in order"],
  "searchQuery": "must equal the first retrieval query",
  "retrievalQueries": ["ordered from most precise/high-confidence to broader fallback"],
    "capturedPreferences": {
      "topic": "short topic keyword or empty"
    }
}

Rules:
- Search source is YouTube only.
- Use only names from candidates for name-based queries.
- Use only descriptor phrases from descriptorPhrases or explicit user wording.
- You may reorder terms, combine candidate names with descriptor phrases, normalize wording, and selectively relax constraints as the plan broadens.
- Order retrievalQueries from most likely/high-confidence specific seeds to less specific fallback seeds.
- searchQuery must equal retrievalQueries[0].
- If App target country is present, you MUST output youtubeRegionCode and youtubeSearchLanguage for it. Do not omit them.
- If the target country is unclear or not a real place, set youtubeRegionCode="" and youtubeSearchLanguage="en".
- primarySearchLanguage must equal youtubeSearchLanguage.
- When a local-language search is clearly best, keep most queries in that language and only include English if it adds real retrieval value.
- Never use operators like site:, inurl:, intitle:, channel:, or quoted boolean syntax.
- ${targetCountryLanguageInstruction}
`,
        },
        {
          role: 'user',
          content:
            [
              threadContext ? `Conversation thread:\n${threadContext}` : '',
              latestUserQuery
                ? `Current user request:\n${latestUserQuery}`
                : '',
              targetCountry
                ? `App target country:\n${targetCountry}`
                : '',
              answerer
                ? `Structured step 1 output:\n${JSON.stringify({
                    answerToUserQuestion: answerer.answerToUserQuestion || '',
                    resolvedIntent: answerer.resolvedIntent || '',
                    youtubeRegionCode: answerer.youtubeRegionCode || '',
                    youtubeSearchLanguage:
                      answerer.youtubeSearchLanguage ||
                      answerer.primarySearchLanguage ||
                      '',
                    candidates: answerer.candidates || [],
                    descriptorPhrases: answerer.descriptorPhrases || [],
                    primarySearchLanguage: answerer.primarySearchLanguage || '',
                    searchLanguages: answerer.searchLanguages || [],
                  })}`
                : '',
              answererSeedQueries.length > 0
                ? `Seed queries already derivable from step 1:\n${answererSeedQueries.join('\n')}`
                : '',
            ]
              .filter(Boolean)
              .join('\n\n') || 'Find the best matching YouTube videos.',
        },
        ...(answererText
          ? [
              {
                role: 'assistant' as const,
                content: `Likely answer or candidate context:\n${answererText}`,
              },
            ]
          : []),
        {
          role: 'user',
          content: 'Return only the search formulation JSON.',
        },
      ],
    });
    stopPulse();
    const parsed = parseQueryFormulatorPayload(raw);
    if (parsed) {
      const retrievalQueries =
        parsed.retrievalQueries && parsed.retrievalQueries.length > 0
          ? parsed.retrievalQueries
          : answererSeedQueries;
      const normalizedBias = normalizeBiasMetadata({
        youtubeRegionCode: parsed.youtubeRegionCode,
        youtubeSearchLanguage: parsed.youtubeSearchLanguage,
        primarySearchLanguage: parsed.primarySearchLanguage,
        searchLanguages: [
          ...(parsed.searchLanguages || []),
          ...(answerer?.searchLanguages || []),
        ],
        fallbackYoutubeRegionCode: answerer?.youtubeRegionCode,
        fallbackYoutubeSearchLanguage:
          answerer?.youtubeSearchLanguage ||
          answerer?.primarySearchLanguage ||
          'en',
      });
      const normalizedParsed: QueryFormulatorPayload = {
        ...parsed,
        youtubeRegionCode: normalizedBias.youtubeRegionCode,
        youtubeSearchLanguage: normalizedBias.youtubeSearchLanguage,
        primarySearchLanguage: normalizedBias.primarySearchLanguage,
        searchLanguages: normalizedBias.searchLanguages,
        searchQuery:
          parsed.searchQuery ||
          retrievalQueries[0] ||
          answerer?.resolvedIntent ||
          '',
        retrievalQueries,
      };
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'planning',
        message: 'Step 2/3 cleared: search formulator ready.',
        searchQuery:
          normalizedParsed.searchQuery ||
          normalizedParsed.retrievalQueries?.[0] ||
          answerer?.resolvedIntent ||
          '',
        assistantPreview: clampTraceMessage(
          [
            answerer?.answerToUserQuestion
              ? `Answer: ${answerer.answerToUserQuestion}`
              : '',
            normalizedParsed.strategy
              ? `Plan: ${normalizedParsed.strategy}`
              : '',
            normalizedParsed.retrievalQueries?.length
              ? `Queries: ${summarizeValues(
                  normalizedParsed.retrievalQueries,
                  3
                )}`
              : '',
          ]
            .filter(Boolean)
            .join(' | ')
        ),
        stageKey: 'planner',
        stageIndex: 2,
        stageTotal: 3,
        stageState: 'cleared',
        stageOutcome: clampTraceLines(
          [
            answerer?.answerToUserQuestion
              ? `Answer from step 1: ${answerer.answerToUserQuestion}`
              : '',
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

    const fallbackQueries =
      answererSeedQueries.length > 0
        ? answererSeedQueries
        : answererAnchor
          ? [answererAnchor]
          : [];
    const fallbackQuery = fallbackQueries[0] || '';
    const fallbackPayload: QueryFormulatorPayload = {
      intentSummary: answerer?.resolvedIntent || fallbackQuery,
      strategy: fallbackQuery
        ? 'Use the structured candidates/descriptors output as the search plan.'
        : '',
      ...normalizeBiasMetadata({
        youtubeRegionCode: answerer?.youtubeRegionCode,
        youtubeSearchLanguage:
          answerer?.youtubeSearchLanguage ||
          answerer?.primarySearchLanguage,
        primarySearchLanguage: answerer?.primarySearchLanguage,
        searchLanguages: answerer?.searchLanguages,
      }),
      searchQuery: fallbackQuery,
      retrievalQueries: fallbackQueries,
      capturedPreferences: answerer?.capturedPreferences,
    };
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'planning',
      message: 'Step 2/3 cleared: search formulator fallback used.',
      searchQuery: fallbackQuery,
      assistantPreview: clampTraceMessage(
        fallbackQuery
          ? `Using direct fallback search query: ${quotedStatusValue(fallbackQuery, 120)}.`
          : 'Search formulator returned no structured result; continuing with minimal fallback.'
      ),
      stageKey: 'planner',
      stageIndex: 2,
      stageTotal: 3,
      stageState: 'cleared',
      stageOutcome: clampTraceLines(
        [
          'Search formulator did not return a parseable structured payload.',
          fallbackQuery
            ? `Fallback search query: ${quotedStatusValue(fallbackQuery, 120)}.`
            : 'No answerer-backed fallback search query was available.',
        ],
        620
      ),
      elapsedMs: Date.now() - startedAt,
    });
    return fallbackPayload;
  } catch (error) {
    stopPulse();
    if (isSuggestionAbortError(error, signal)) {
      throw error;
    }
    const fallbackQueries =
      answererSeedQueries.length > 0
        ? answererSeedQueries
        : answererAnchor
          ? [answererAnchor]
          : [];
    const fallbackQuery = fallbackQueries[0] || '';
    const fallbackPayload: QueryFormulatorPayload = {
      intentSummary: answerer?.resolvedIntent || fallbackQuery,
      strategy: fallbackQuery
        ? 'Use the structured candidates/descriptors output as the search plan.'
        : '',
      ...normalizeBiasMetadata({
        youtubeRegionCode: answerer?.youtubeRegionCode,
        youtubeSearchLanguage:
          answerer?.youtubeSearchLanguage ||
          answerer?.primarySearchLanguage,
        primarySearchLanguage: answerer?.primarySearchLanguage,
        searchLanguages: answerer?.searchLanguages,
      }),
      searchQuery: fallbackQuery,
      retrievalQueries: fallbackQueries,
      capturedPreferences: answerer?.capturedPreferences,
    };
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'planning',
      message: 'Step 2/3 cleared: search formulator fallback used.',
      searchQuery: fallbackQuery,
      assistantPreview: clampTraceMessage(
        fallbackQuery
          ? `Using direct fallback search query: ${quotedStatusValue(fallbackQuery, 120)}.`
          : 'Search formulator failed; continuing with minimal fallback.'
      ),
      stageKey: 'planner',
      stageIndex: 2,
      stageTotal: 3,
      stageState: 'cleared',
      stageOutcome: clampTraceLines(
        [
          'Search formulator failed before returning a structured payload.',
          fallbackQuery
            ? `Fallback search query: ${quotedStatusValue(fallbackQuery, 120)}.`
            : 'No reliable fallback search query was available.',
        ],
        620
      ),
      elapsedMs: Date.now() - startedAt,
    });
    return fallbackPayload;
  }
}

async function runClarifyingFollowUp({
  operationId,
  model,
  translationPhase,
  signal,
  history,
  answerer,
  queryPlanner,
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
  answerer?: IntentResolverPayload | null;
  queryPlanner?: QueryFormulatorPayload | null;
  results?: VideoSuggestionResultItem[];
  searchQuery?: string;
  preferredLanguage?: string;
  preferredLanguageName?: string;
  onResolvedModel?: (model: string) => void;
}): Promise<string> {
  const threadContext = buildThreadContext(history);
  const latestUserQuery = compactText(getLastUserQuery(history));
  const answererText = compactText(answerer?.answerToUserQuestion || '');
  const retrievalQueries = uniqueTexts(
    queryPlanner?.retrievalQueries || []
  ).slice(0, 6);
  const topTitles = uniqueTexts(
    (results || []).map(item => compactText(item.title || ''))
  ).slice(0, 4);
  const topChannels = uniqueTexts(
    (results || []).map(item => compactText(item.channel || ''))
  ).slice(0, 4);

  try {
    const raw = await callAIModel({
      operationId: `${operationId}-clarifying-follow-up`,
      model,
      translationPhase,
      onResolvedModel,
      reasoning: { effort: 'medium' },
      signal,
      retryAttempts: 1,
      messages: [
        {
          role: 'system',
          content: `Write a helpful follow-up message for an AI video recommender after search completes. If the request was clear enough, suggest a smart next lookup closely related to the current results. If the request is still too broad or unclear, ask a thoughtful clarifying question instead. When the search space is broad or confusing, teach the user a bit about it by naming example creators, categories, or directions they could choose from so they can make a more informed choice. Always write the follow-up in the user interface language requested below, not the language of the search results unless they are the same.`,
        },
        {
          role: 'user',
          content: [
            preferredLanguage || preferredLanguageName
              ? `User interface language: ${compactText(
                  preferredLanguageName || preferredLanguage
                )} (${compactText(preferredLanguage || '').toLowerCase()}).`
              : '',
            threadContext ? `Conversation thread:\n${threadContext}` : '',
            latestUserQuery ? `Current user request:\n${latestUserQuery}` : '',
            searchQuery ? `Search used:\n${searchQuery}` : '',
            answererText ? `Step 1 output:\n${answererText}` : '',
            retrievalQueries.length > 0
              ? `Step 2 search queries:\n${retrievalQueries.join('\n')}`
              : '',
            `Results found: ${(results || []).length}.`,
            topTitles.length > 0
              ? `Top result titles:\n${topTitles.join('\n')}`
              : 'Top result titles:\nNone yet.',
            topChannels.length > 0
              ? `Top result channels:\n${topChannels.join('\n')}`
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
      let nextAssistantMessage =
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

    try {
      const forcedIntent = await runIntentResolver({
        operationId,
        model: resolvedModel,
        translationPhase: suggestionTranslationPhase,
        signal,
        history: [
          {
            role: 'user',
            content: `Intent: ${forcedSearchQueryRaw}`,
          },
        ],
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
      const forcedPlan = await runQueryFormulator({
        operationId,
        model: resolvedModel,
        translationPhase: suggestionTranslationPhase,
        signal,
        history: [
          {
            role: 'user',
            content: `Intent: ${forcedSearchQueryRaw}`,
          },
        ],
        answerer: forcedIntent,
        targetCountry,
        onProgress,
        startedAt,
        onResolvedModel: observeResolvedModel,
      });
      const outcome = await runVideoSearch({
        continuation: createVideoSearchContinuation({
          recency: preferredRecency,
          translationPhase: suggestionTranslationPhase,
          model: resolvedModel,
          maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
          intentQuery: forcedSearchQueryRaw,
          youtubeRegionCode: forcedPlan?.youtubeRegionCode,
          youtubeSearchLanguage:
            forcedPlan?.youtubeSearchLanguage ||
            forcedPlan?.primarySearchLanguage,
          retrievalQueries: forcedPlan?.retrievalQueries?.length
            ? forcedPlan.retrievalQueries
            : [forcedSearchQueryRaw],
          retrievalSeedUrls: [],
          selectedChannels: (forcedIntent?.candidates || []).map(
            candidate => candidate.name
          ),
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
      results = outcome.results;
      searchQuery = outcome.searchQuery;
      assistantMessage =
        (await runClarifyingFollowUp({
          operationId,
          model: resolvedModel,
          translationPhase: suggestionTranslationPhase,
          signal,
          history: [
            {
              role: 'user',
              content: `Intent: ${forcedSearchQueryRaw}`,
            },
          ],
          answerer: forcedIntent,
          queryPlanner: forcedPlan,
          results,
          searchQuery,
          preferredLanguage: request.preferredLanguage,
          preferredLanguageName: request.preferredLanguageName,
          onResolvedModel: observeResolvedModel,
        })) ||
        forcedPlan?.assistantMessage ||
        assistantMessage;
      if (outcome.lowConfidenceReason) {
        emitSuggestionProgress(onProgress, {
          operationId,
          phase: 'finalizing',
          message: `${describeLowConfidenceReason(
            outcome.lowConfidenceReason
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
        youtubeRegionCode: outcome.continuation.youtubeRegionCode,
        youtubeSearchLanguage: outcome.continuation.youtubeSearchLanguage,
        results,
        capturedPreferences:
          forcedPlan?.capturedPreferences || forcedIntent?.capturedPreferences,
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

  const answerer = await runIntentResolver({
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
  const queryPlanner = await runQueryFormulator({
    operationId,
    model: resolvedModel,
    translationPhase: suggestionTranslationPhase,
    signal,
    history: plannerHistory,
    answerer,
    targetCountry,
    onProgress,
    startedAt,
    onResolvedModel: observeResolvedModel,
  });
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
        const outcome = await runVideoSearch({
          continuation: createVideoSearchContinuation({
            recency: preferredRecency,
            translationPhase: suggestionTranslationPhase,
            model: resolvedModel,
            maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
            intentQuery: effectiveBaseQuery,
            youtubeRegionCode: queryPlanner?.youtubeRegionCode,
            youtubeSearchLanguage:
              queryPlanner?.youtubeSearchLanguage ||
              queryPlanner?.primarySearchLanguage,
            retrievalQueries:
              plannerRetrievalQueries.length > 0
                ? plannerRetrievalQueries
                : [effectiveBaseQuery],
            retrievalSeedUrls: [],
            selectedChannels: (answerer?.candidates || []).map(
              candidate => candidate.name
            ),
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
        results = outcome.results;
        searchQuery = outcome.searchQuery;
        assistantMessage =
          (await runClarifyingFollowUp({
            operationId,
            model: resolvedModel,
            translationPhase: suggestionTranslationPhase,
            signal,
            history: plannerHistory,
            answerer,
            queryPlanner,
            results,
            searchQuery,
            preferredLanguage: request.preferredLanguage,
            preferredLanguageName: request.preferredLanguageName,
            onResolvedModel: observeResolvedModel,
          })) ||
          queryPlanner?.assistantMessage ||
          assistantMessage ||
          '__i18n__:input.videoSuggestion.defaultFollowUp';
        if (outcome.lowConfidenceReason) {
          searchFailureDetail = lowConfidenceErrorKey(
            outcome.lowConfidenceReason
          );
          emitSuggestionProgress(onProgress, {
            operationId,
            phase: 'finalizing',
            message: `${describeLowConfidenceReason(
              outcome.lowConfidenceReason
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

    if (hasUserMessage && !searchFailureDetail && !assistantMessage.trim()) {
      assistantMessage =
        (await runClarifyingFollowUp({
          operationId,
          model: resolvedModel,
          translationPhase: suggestionTranslationPhase,
          signal,
          history: plannerHistory,
          answerer,
          queryPlanner,
          results,
          searchQuery,
          preferredLanguage: request.preferredLanguage,
          preferredLanguageName: request.preferredLanguageName,
          onResolvedModel: observeResolvedModel,
        })) || '__i18n__:input.videoSuggestion.defaultFollowUp';
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
      capturedPreferences:
        queryPlanner?.capturedPreferences || answerer?.capturedPreferences,
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
