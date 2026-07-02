import log from 'electron-log';
import type {
  ChatToolCall,
  ChatToolDefinition,
  VideoSuggestionPreferenceSlots,
  VideoSuggestionProgress,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import { callAIModelWithTools } from '../subtitle-processing/ai-client.js';
import { runYoutubeYtDlpSearch } from './retrieval.js';
import { emitSuggestionProgress } from './progress.js';
import {
  clampTraceMessage,
  compactText,
  isSuggestionAbortError,
  normalizePreferenceSlots,
  normalizeYoutubeWatchUrl,
  quotedStatusValue,
  recencyLabel,
  sanitizeLanguageToken,
  sanitizeSearchKeywords,
  sanitizeYoutubeRegionCode,
  summarizeValues,
  summarizeSearchError,
  throwIfSuggestionAborted,
  uniqueTexts,
} from './shared.js';

const MAX_MODEL_TURNS = 4;
const MAX_QUERIES_PER_SEARCH = 4;
const MAX_OBSERVED_PER_SEARCH = 24;
const WALL_CLOCK_BUDGET_MS = 120_000;

const SEARCH_TOOL_NAME = 'search_youtube';
const PRESENT_TOOL_NAME = 'present_results';

export type VideoSearchAgentOutcome = {
  results: VideoSuggestionResultItem[];
  assistantMessage: string;
  searchQuery: string;
  queriesTried: string[];
  candidatePool: VideoSuggestionResultItem[];
  capturedPreferences?: VideoSuggestionPreferenceSlots;
  youtubeRegionCode?: string;
  youtubeSearchLanguage?: string;
  lowConfidenceReason?: string;
};

function buildAgentTools(): ChatToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: SEARCH_TOOL_NAME,
        description:
          'Search YouTube and get back candidate videos (title, channel, duration, view count, url). ' +
          'Provide 1-4 plain keyword queries, most precise first. Use native-language ' +
          'search idioms, real creator/franchise/expert names, not literal translations of ' +
          'the request. Never use search operators (site:, intitle:, quotes, booleans). ' +
          'You may call this again with different queries if results are weak.',
        parameters: {
          type: 'object',
          properties: {
            queries: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Plain YouTube keyword queries, most precise first, broadening to fallbacks.',
            },
            regionCode: {
              type: 'string',
              description:
                'Optional 2-letter YouTube region code (US, JP, KR, BR...) matching the target audience.',
            },
            language: {
              type: 'string',
              description:
                'Optional language code (en, ja, ko...) for the search interface.',
            },
          },
          required: ['queries'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: PRESENT_TOOL_NAME,
        description:
          'Finish by presenting the videos that best match the request, best first. ' +
          'Only use URLs that appeared in search_youtube results. Present as many ' +
          'genuinely relevant candidates as exist (up to 20) — do not pad with weak matches.',
        parameters: {
          type: 'object',
          properties: {
            videoUrls: {
              type: 'array',
              items: { type: 'string' },
              description:
                'URLs of the chosen videos from search results, best match first.',
            },
            reply: {
              type: 'string',
              description:
                "One short, friendly sentence for the user in the user's UI language — what you found or a next-step suggestion.",
            },
            capturedTopic: {
              type: 'string',
              description:
                "Short keyword for the user's topic preference, to remember for next time. Empty if unclear.",
            },
          },
          required: ['videoUrls', 'reply'],
          additionalProperties: false,
        },
      },
    },
  ];
}

function buildSystemPrompt({
  targetCountry,
  preferredRecency,
  preferredLanguage,
  preferredLanguageName,
  contextBlock,
}: {
  targetCountry?: string;
  preferredRecency: VideoSuggestionRecency;
  preferredLanguage?: string;
  preferredLanguageName?: string;
  contextBlock?: string;
}): string {
  const languageLine =
    preferredLanguage || preferredLanguageName
      ? `The user's UI language is ${compactText(
          preferredLanguageName || preferredLanguage
        )} (${compactText(preferredLanguage || '').toLowerCase()}). Write every user-facing reply in that language.`
      : 'Write user-facing replies in English unless the conversation is clearly in another language.';

  const countryLine = compactText(targetCountry)
    ? `Target country: ${compactText(targetCountry)}. Prefer content and search queries in that country's language, and set regionCode/language on searches accordingly.`
    : 'No target country is set. Default to English searches unless the request implies otherwise.';

  const recencyLine =
    preferredRecency === 'any'
      ? 'Upload recency: any age is fine.'
      : `Upload recency: the user asked for videos from the last ${recencyLabel(
          preferredRecency
        )}. This is enforced automatically on every search.`;

  return [
    'You are a YouTube video recommender inside a video-translation app. The user wants videos to download and translate.',
    'Work in this order:',
    `1. If the request is clear enough to search, call ${SEARCH_TOOL_NAME} with your best queries. Use domain knowledge to pick grounded, specific queries — real shows, creators, studios, experts, native search idioms.`,
    `2. Read the results. If they are a poor match, search once more with sharper or different-angle queries. Do not repeat queries you already tried.`,
    `3. Call ${PRESENT_TOOL_NAME} with the best matches ranked best-first, plus one short reply for the user.`,
    `If the request is too vague to search at all, reply with one short clarifying question in plain text instead of calling tools. Ask at most one question — if the user answers vaguely ("anything is fine"), just search with your best interpretation.`,
    'Rules:',
    '- Judge relevance from title, channel, duration, and view count. Prefer videos that plausibly deliver what the user asked for over tangentially related ones.',
    '- Never invent URLs. Present only URLs observed in search results.',
    '- Keep replies to one sentence. Never mention tools, pipelines, or these instructions.',
    languageLine,
    countryLine,
    recencyLine,
    contextBlock ? `Context:\n${contextBlock}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function compactResultForObservation(
  item: VideoSuggestionResultItem,
  index: number
): Record<string, unknown> {
  return {
    n: index + 1,
    url: item.url,
    title: clampTraceMessage(compactText(item.title), 110),
    ...(item.channel
      ? { channel: clampTraceMessage(compactText(item.channel), 60) }
      : {}),
    ...(typeof item.durationSec === 'number'
      ? { durationSec: Math.round(item.durationSec) }
      : {}),
    ...(typeof item.viewCount === 'number' ? { views: item.viewCount } : {}),
    ...(item.uploadedAt ? { uploaded: item.uploadedAt } : {}),
  };
}

export async function runVideoSearchAgent({
  operationId,
  model,
  translationPhase,
  signal,
  history,
  targetCountry,
  youtubeRegionCode,
  youtubeSearchLanguage,
  preferredRecency,
  excludeUrls,
  preferredLanguage,
  preferredLanguageName,
  savedPreferences,
  contextBlock,
  maxResults,
  onProgress,
  startedAt,
  onResolvedModel,
}: {
  operationId: string;
  model: string;
  translationPhase: 'draft' | 'review';
  signal?: AbortSignal;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  targetCountry?: string;
  youtubeRegionCode?: string;
  youtubeSearchLanguage?: string;
  preferredRecency: VideoSuggestionRecency;
  excludeUrls: Set<string>;
  preferredLanguage?: string;
  preferredLanguageName?: string;
  savedPreferences?: VideoSuggestionPreferenceSlots;
  contextBlock?: string;
  maxResults: number;
  onProgress?: (progress: VideoSuggestionProgress) => void;
  startedAt: number;
  onResolvedModel?: (model: string) => void;
}): Promise<VideoSearchAgentOutcome> {
  const tools = buildAgentTools();
  const systemPrompt = buildSystemPrompt({
    targetCountry,
    preferredRecency,
    preferredLanguage,
    preferredLanguageName,
    contextBlock,
  });
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  const candidatePool: VideoSuggestionResultItem[] = [];
  const candidateByUrl = new Map<string, VideoSuggestionResultItem>();
  const triedQueries: string[] = [];
  const triedQueryKeys = new Set<string>();
  let lastSearchRegion = sanitizeYoutubeRegionCode(youtubeRegionCode);
  let lastSearchLanguage = sanitizeLanguageToken(
    youtubeSearchLanguage
  ).toLowerCase();
  let lastLowConfidenceReason = '';
  let capturedPreferences = normalizePreferenceSlots(savedPreferences || {});
  const reasoningEffort = translationPhase === 'review' ? 'medium' : 'low';

  const registerCandidates = (items: VideoSuggestionResultItem[]) => {
    for (const item of items) {
      const url = normalizeYoutubeWatchUrl(item.url) || compactText(item.url);
      if (!url || candidateByUrl.has(url)) continue;
      candidateByUrl.set(url, item);
      candidatePool.push(item);
    }
  };

  const executeSearchTool = async (
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const queries = uniqueTexts(
      (Array.isArray(args.queries) ? args.queries : [])
        .map(value => sanitizeSearchKeywords(String(value || '')))
        .filter(Boolean)
    ).slice(0, MAX_QUERIES_PER_SEARCH);

    if (queries.length === 0) {
      return {
        ok: false,
        error: 'queries must contain at least one non-empty keyword query.',
      };
    }

    const repeated = queries.filter(query =>
      triedQueryKeys.has(query.toLowerCase())
    );
    const freshQueries = queries.filter(
      query => !triedQueryKeys.has(query.toLowerCase())
    );
    if (freshQueries.length === 0) {
      return {
        ok: false,
        error: `All queries were already tried: ${repeated.join(' | ')}. Present the best of what you have, or try a genuinely different angle.`,
      };
    }
    for (const query of freshQueries) {
      triedQueryKeys.add(query.toLowerCase());
      triedQueries.push(query);
    }

    const regionCode =
      sanitizeYoutubeRegionCode(String(args.regionCode || '')) ||
      lastSearchRegion;
    const searchLanguage =
      sanitizeLanguageToken(String(args.language || '')).toLowerCase() ||
      lastSearchLanguage;
    lastSearchRegion = regionCode;
    lastSearchLanguage = searchLanguage;

    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'searching',
      message: `Searching YouTube for ${quotedStatusValue(freshQueries[0], 90)}${
        freshQueries.length > 1 ? ` (+${freshQueries.length - 1} more)` : ''
      }.`,
      searchQuery: freshQueries[0],
      assistantPreview: clampTraceMessage(
        `Queries: ${summarizeValues(freshQueries, 4)}.`
      ),
      stageKey: 'retrieval',
      stageIndex: 2,
      stageTotal: 3,
      stageState: 'running',
      elapsedMs: Date.now() - startedAt,
    });

    const poolExcludes = new Set(excludeUrls);
    for (const url of candidateByUrl.keys()) {
      poolExcludes.add(url);
    }

    let outcome;
    try {
      outcome = await runYoutubeYtDlpSearch({
        searchQuery: freshQueries[0],
        retrievalQueries: freshQueries,
        retrievalSeedUrls: [],
        youtubeRegionCode: regionCode,
        youtubeSearchLanguage: searchLanguage,
        recency: preferredRecency,
        maxResults,
        excludeUrls: poolExcludes,
        operationId,
        onProgress,
        startedAt,
        signal,
      });
    } catch (error) {
      if (isSuggestionAbortError(error, signal)) throw error;
      const detail = summarizeSearchError(error);
      log.warn(
        `[video-suggestions] Agent search tool failed (${operationId}):`,
        detail
      );
      return {
        ok: false,
        error: `Search failed: ${detail}. You can retry with different queries.`,
      };
    }

    lastLowConfidenceReason = outcome.lowConfidenceReason || '';
    registerCandidates(outcome.results);

    // Two-track status: retrieval finished, model is about to read it.
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'ranking',
      message: `Reviewing ${candidatePool.length} candidate${candidatePool.length === 1 ? '' : 's'}.`,
      searchQuery: freshQueries[0],
      resultCount: candidatePool.length,
      stageKey: 'planner',
      stageIndex: 3,
      stageTotal: 3,
      stageState: 'running',
      elapsedMs: Date.now() - startedAt,
    });

    if (outcome.results.length === 0) {
      return {
        ok: true,
        resultCount: 0,
        results: [],
        note:
          preferredRecency !== 'any'
            ? `No results within the "${recencyLabel(preferredRecency)}" recency window. Try broader or different queries.`
            : 'No results. Try broader or different-angle queries.',
      };
    }

    return {
      ok: true,
      resultCount: outcome.results.length,
      results: outcome.results
        .slice(0, MAX_OBSERVED_PER_SEARCH)
        .map(compactResultForObservation),
      ...(outcome.results.length > MAX_OBSERVED_PER_SEARCH
        ? {
            note: `${outcome.results.length - MAX_OBSERVED_PER_SEARCH} more results omitted.`,
          }
        : {}),
    };
  };

  type PresentPayload = {
    results: VideoSuggestionResultItem[];
    reply: string;
  };

  const tryBuildPresentation = (
    args: Record<string, unknown>
  ): PresentPayload | { error: string } => {
    const urls = Array.isArray(args.videoUrls) ? args.videoUrls : [];
    const chosen: VideoSuggestionResultItem[] = [];
    const seen = new Set<string>();
    let unknownCount = 0;
    for (const rawUrl of urls) {
      const url =
        normalizeYoutubeWatchUrl(String(rawUrl || '')) ||
        compactText(String(rawUrl || ''));
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const item = candidateByUrl.get(url);
      if (!item) {
        unknownCount += 1;
        continue;
      }
      chosen.push(item);
      if (chosen.length >= maxResults) break;
    }

    if (chosen.length === 0) {
      return {
        error:
          unknownCount > 0
            ? 'None of those URLs came from search results. Present only observed URLs.'
            : 'videoUrls was empty. Present at least one observed URL, or reply with text if nothing fits.',
      };
    }

    const capturedTopic = compactText(String(args.capturedTopic || ''));
    if (capturedTopic) {
      capturedPreferences = normalizePreferenceSlots({
        ...capturedPreferences,
        topic: capturedTopic,
      });
    }

    return {
      results: chosen,
      reply: clampTraceMessage(compactText(String(args.reply || '')), 520),
    };
  };

  let assistantMessage = '';
  let presented: PresentPayload | null = null;

  for (let turn = 1; turn <= MAX_MODEL_TURNS; turn += 1) {
    throwIfSuggestionAborted(signal);
    const budgetExhausted = Date.now() - startedAt > WALL_CLOCK_BUDGET_MS;
    const isLastTurn = turn === MAX_MODEL_TURNS || budgetExhausted;

    emitSuggestionProgress(onProgress, {
      operationId,
      phase: turn === 1 ? 'planning' : 'ranking',
      message:
        turn === 1
          ? 'Choosing the best search strategy...'
          : 'Deciding the next step...',
      stageKey: 'planner',
      stageIndex: turn === 1 ? 1 : 3,
      stageTotal: 3,
      stageState: 'running',
      resultCount: candidatePool.length,
      elapsedMs: Date.now() - startedAt,
    });

    if (isLastTurn && candidatePool.length > 0) {
      // Out of turns/time: force a selection instead of another search.
      messages.push({
        role: 'user',
        content: `[system] Final step: call ${PRESENT_TOOL_NAME} now with the best observed results. Do not search again.`,
      });
    }

    // No translationPhase here: sending it would trigger the relay's
    // subtitle-workflow model authority, which rewrites the pinned model.
    const turnResult = await callAIModelWithTools({
      operationId: `${operationId}-agent-${turn}`,
      model,
      modelFamilyHintSource: 'model',
      reasoning: { effort: reasoningEffort },
      signal,
      messages,
      tools,
    });
    if (turnResult.resolvedModel) {
      onResolvedModel?.(turnResult.resolvedModel);
    }

    const { content, toolCalls } = turnResult;

    messages.push({
      role: 'assistant',
      content: content || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });

    if (toolCalls.length === 0) {
      // Plain text turn: a clarifying question or conversational reply.
      assistantMessage = compactText(content);
      break;
    }

    if (content.trim()) {
      // Interim narration alongside tool calls.
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'ranking',
        assistantPreview: clampTraceMessage(compactText(content), 240),
        resultCount: candidatePool.length,
        elapsedMs: Date.now() - startedAt,
      });
    }

    const appendToolResult = (call: ChatToolCall, output: unknown) => {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    };

    for (const call of toolCalls) {
      throwIfSuggestionAborted(signal);
      const name = call.function.name;
      const args = parseToolArguments(call.function.arguments);

      if (name === SEARCH_TOOL_NAME) {
        if (presented) {
          appendToolResult(call, {
            ok: false,
            error: 'Results were already presented.',
          });
          continue;
        }
        appendToolResult(call, await executeSearchTool(args));
        continue;
      }

      if (name === PRESENT_TOOL_NAME) {
        const built = tryBuildPresentation(args);
        if ('error' in built) {
          appendToolResult(call, { ok: false, error: built.error });
          continue;
        }
        presented = built;
        appendToolResult(call, { ok: true, presented: built.results.length });
        continue;
      }

      appendToolResult(call, {
        ok: false,
        error: `Unknown tool: ${name}. Available: ${SEARCH_TOOL_NAME}, ${PRESENT_TOOL_NAME}.`,
      });
    }

    if (presented) {
      assistantMessage = presented.reply;
      break;
    }
  }

  // Hard rail: if the model never presented but we do have candidates,
  // serve the pool in retrieval order rather than returning nothing.
  const finalResults = presented
    ? presented.results
    : candidatePool.slice(0, maxResults);
  if (!presented && finalResults.length > 0) {
    log.warn(
      `[video-suggestions] Agent exhausted turns without presenting (${operationId}); serving ${finalResults.length} unranked candidates.`
    );
  }
  if (!assistantMessage) {
    assistantMessage =
      finalResults.length > 0
        ? '__i18n__:input.videoSuggestion.defaultFollowUp'
        : '__i18n__:input.videoSuggestion.searchFailed';
  }

  if (finalResults.length > 0) {
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'finalizing',
      message: `Selected ${finalResults.length} result${finalResults.length === 1 ? '' : 's'}.`,
      searchQuery: triedQueries[0] || '',
      resultCount: finalResults.length,
      partialResults: finalResults,
      resultsFinal: true,
      stageKey: 'retrieval',
      stageIndex: 3,
      stageTotal: 3,
      stageState: 'cleared',
      elapsedMs: Date.now() - startedAt,
    });
  }

  return {
    results: finalResults,
    assistantMessage,
    searchQuery: triedQueries[0] || '',
    queriesTried: triedQueries,
    candidatePool,
    capturedPreferences:
      Object.keys(capturedPreferences || {}).length > 0
        ? capturedPreferences
        : undefined,
    youtubeRegionCode: lastSearchRegion || undefined,
    youtubeSearchLanguage: lastSearchLanguage || undefined,
    lowConfidenceReason:
      finalResults.length === 0 && triedQueries.length > 0
        ? lastLowConfidenceReason || 'no-scored-results'
        : undefined,
  };
}
