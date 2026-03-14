import type { VideoSuggestionRecency } from '@shared-types/app';
import { callAIModel } from '../subtitle-processing/ai-client.js';
import {
  emitSuggestionProgress,
  type SuggestionProgressCallback,
} from './progress.js';
import {
  type DiscoveryChannelCandidate,
  type DiscoveryOutcome,
  VIDEO_SUGGESTION_HOST_SUFFIXES,
  VIDEO_SUGGESTION_SOURCE_LABEL,
  clampTraceLines,
  clampTraceMessage,
  compactText,
  isYoutubeVideoSuggestionUrl,
  recencyLabel,
  sanitizeSearchKeywords,
  summarizeValues,
  throwIfSuggestionAborted,
  uniqueTexts,
} from './shared.js';

type DiscoveryWebSearchPayload = {
  assistantMessage?: unknown;
  queriesUsed?: unknown;
  channels?: unknown;
};

function parseDiscoveryWebSearchPayload(
  raw: string
): DiscoveryWebSearchPayload | null {
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
      const obj = JSON.parse(candidate);
      if (!obj || typeof obj !== 'object') continue;
      return obj as DiscoveryWebSearchPayload;
    } catch {
      // Keep trying.
    }
  }
  return null;
}

function normalizeDiscoveryCandidate(
  input: any,
  index: number
): DiscoveryChannelCandidate | null {
  const name = compactText(input?.name || input?.channel || input?.title).slice(
    0,
    90
  );
  const rawUrl = compactText(
    input?.url || input?.channelUrl || input?.youtubeUrl || ''
  );
  const url =
    /^https?:\/\//i.test(rawUrl) && isYoutubeVideoSuggestionUrl(rawUrl)
      ? rawUrl
      : undefined;
  const evidenceUrls = uniqueTexts(
    Array.isArray(input?.evidenceUrls)
      ? input.evidenceUrls.map((value: unknown) => compactText(value))
      : Array.isArray(input?.evidence)
        ? input.evidence
            .map((item: unknown) => {
              if (typeof item === 'string') return compactText(item);
              return compactText(
                (item as any)?.sourceUrl || (item as any)?.url
              );
            })
            .filter(Boolean)
        : []
  )
    .filter(value => /^https?:\/\//i.test(value))
    .slice(0, 8);

  const evidenceCountRaw = Number(input?.evidenceCount);
  const evidenceCount =
    Number.isFinite(evidenceCountRaw) && evidenceCountRaw >= 0
      ? Math.floor(evidenceCountRaw)
      : evidenceUrls.length;
  const scoreRaw = Number(input?.score);
  const score =
    Number.isFinite(scoreRaw) && scoreRaw >= 0
      ? Math.floor(scoreRaw)
      : Math.min(100, 35 + evidenceCount * 8);

  if (!name && !url) return null;
  return {
    name: name || `channel-${index + 1}`,
    url,
    evidenceCount,
    evidenceUrls,
    score,
  };
}

function buildDiscoveryWebSearchPrompt({
  intentQuery,
  discoveryQueries,
  recency,
  primarySearchLanguage,
}: {
  intentQuery: string;
  discoveryQueries: string[];
  recency: VideoSuggestionRecency;
  primarySearchLanguage: string;
}): string {
  const safeIntent = sanitizeSearchKeywords(intentQuery);
  const platformLabel = VIDEO_SUGGESTION_SOURCE_LABEL;
  const platformDomains = VIDEO_SUGGESTION_HOST_SUFFIXES;
  const queries = discoveryQueries.slice(0, 5);
  const recencyRule =
    recency === 'any'
      ? 'No recency restriction. Older and newer uploads are both valid.'
      : `Recency target: ${recencyLabel(recency)}.`;
  return `You find likely channels or named sources on ${platformLabel} using web search tool calls.
Reply with JSON only. No markdown.

Schema:
{
  "assistantMessage": "short status line",
  "queriesUsed": ["query 1", "query 2"],
  "channels": [
    {
      "name": "channel display name",
      "url": "https://...",
      "categoryHint": "gaming streamer",
      "evidenceCount": 3,
      "evidenceUrls": ["https://..."],
      "score": 0
    }
  ]
}

Rules:
- Use web search tool calls grounded in this run.
- Search source is strictly ${platformLabel}.
- Intent: "${safeIntent}".
- ${recencyRule}
- Primary search language: ${primarySearchLanguage || 'en'}.
- Use plain keyword web queries in the target language. Avoid advanced operators like site:, inurl:, intitle:, channel:, or boolean quote syntax.
- Use these discovery queries first:
${queries.map((query, index) => `${index + 1}. ${query}`).join('\n')}
- Return up to 12 channel candidates.
- Prefer channels that are clearly relevant to the intent.
- candidate.url must be on one of these domains: ${platformDomains.join(', ')}.
- Include evidence URLs per channel.
- Never invent URLs.`;
}

export async function runDiscoveryWebSearch({
  intentQuery,
  discoveryQueries,
  recency,
  primarySearchLanguage,
  translationPhase,
  model,
  operationId,
  onProgress,
  onResolvedModel,
  signal,
}: {
  intentQuery: string;
  discoveryQueries: string[];
  recency: VideoSuggestionRecency;
  primarySearchLanguage: string;
  translationPhase: 'draft' | 'review';
  model: string;
  operationId: string;
  onProgress?: SuggestionProgressCallback;
  onResolvedModel?: (model: string) => void;
  signal?: AbortSignal;
}): Promise<DiscoveryOutcome> {
  const startedAt = Date.now();
  throwIfSuggestionAborted(signal);
  const queries = uniqueTexts(
    discoveryQueries.map(query => sanitizeSearchKeywords(query))
  ).slice(0, 5);
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message: `Discovery web search using ${queries.length} planned quer${queries.length === 1 ? 'y' : 'ies'}.`,
    searchQuery: queries[0] || sanitizeSearchKeywords(intentQuery),
    stageKey: 'planner',
    stageIndex: 2,
    stageTotal: 3,
    stageState: 'running',
    stageOutcome: clampTraceLines(
      [
        `Step 1 handoff intent: ${intentQuery}.`,
        `Planned discovery queries (${queries.length}): ${summarizeValues(queries, 5)}.`,
      ],
      420
    ),
    elapsedMs: Date.now() - startedAt,
  });

  let streamedPreview = '';
  const onDelta = (delta: string) => {
    const text = String(delta || '');
    if (!text) return;
    streamedPreview += text;
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'searching',
      message: `Running discovery web search tool calls...`,
      searchQuery: queries[0] || sanitizeSearchKeywords(intentQuery),
      assistantPreview: clampTraceMessage(streamedPreview, 320),
      stageKey: 'planner',
      stageIndex: 2,
      stageTotal: 3,
      stageState: 'running',
      elapsedMs: Date.now() - startedAt,
    });
  };

  let raw = '';
  raw = await callAIModel({
    operationId: `${operationId}-discovery-web-search`,
    model,
    translationPhase,
    modelFamilyHintSource: 'model',
    onResolvedModel,
    reasoning: { effort: 'low' },
    webSearch: true,
    onTextDelta: onDelta,
    signal,
    retryAttempts: 1,
    messages: [
      {
        role: 'system',
        content: buildDiscoveryWebSearchPrompt({
          intentQuery,
          discoveryQueries: queries,
          recency,
          primarySearchLanguage,
        }),
      },
      {
        role: 'user',
        content: JSON.stringify({
          intentQuery,
          discoveryQueries: queries,
          recency,
          primarySearchLanguage,
        }),
      },
    ],
  });
  throwIfSuggestionAborted(signal);

  const parsed = parseDiscoveryWebSearchPayload(raw);
  const channelsRaw = Array.isArray(parsed?.channels) ? parsed?.channels : [];
  const candidates = channelsRaw
    .map((item: unknown, index: number) =>
      normalizeDiscoveryCandidate(item, index)
    )
    .filter((item): item is DiscoveryChannelCandidate => Boolean(item));
  const deduped = new Map<string, DiscoveryChannelCandidate>();
  for (const item of candidates) {
    const key = (item.url || item.name).toLowerCase();
    const existing = deduped.get(key);
    if (!existing || item.score > existing.score) {
      deduped.set(key, item);
    }
  }
  const channels = Array.from(deduped.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const queriesUsed = uniqueTexts(
    Array.isArray(parsed?.queriesUsed)
      ? parsed.queriesUsed.map((value: unknown) =>
          sanitizeSearchKeywords(String(value || ''))
        )
      : queries
  ).slice(0, 6);
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'ranking',
    message: `Step 2/4 cleared: discovery found ${channels.length} channel candidates.`,
    searchQuery: queriesUsed[0] || sanitizeSearchKeywords(intentQuery),
    assistantPreview: clampTraceMessage(
      compactText(parsed?.assistantMessage) ||
        `Top channels: ${summarizeValues(
          channels.map(item => item.name),
          4
        )}.`,
      320
    ),
    stageKey: 'planner',
    stageIndex: 2,
    stageTotal: 3,
    stageState: 'cleared',
    stageOutcome: clampTraceLines(
      [
        `Input queries (${queries.length}): ${summarizeValues(queries, 5)}.`,
        `Executed queries (${queriesUsed.length}): ${summarizeValues(queriesUsed, 5)}.`,
        `Yielded channel candidates (${channels.length}): ${summarizeValues(
          channels.map(item => item.name),
          5
        )}.`,
        'Passed channel evidence forward to step 3 for retrieval preparation.',
      ],
      560
    ),
    elapsedMs: Date.now() - startedAt,
  });

  return {
    channels,
    queriesUsed,
    assistantMessage: clampTraceMessage(
      compactText(parsed?.assistantMessage),
      160
    ),
  };
}
