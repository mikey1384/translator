import type { VideoSuggestionRecency } from '@shared-types/app';
import { callAIModel } from '../subtitle-processing/ai-client.js';
import {
  emitSuggestionProgress,
  type SuggestionProgressCallback,
} from './progress.js';
import {
  type CuratorOutcome,
  type DiscoveryChannelCandidate,
  type DiscoveryOutcome,
  type DiscoveryRetrievalMode,
  VIDEO_SUGGESTION_HOST_SUFFIXES,
  VIDEO_SUGGESTION_SOURCE_LABEL,
  clampTraceLines,
  clampTraceMessage,
  compactText,
  isSuggestionAbortError,
  isYoutubeVideoSuggestionUrl,
  recencyLabel,
  sanitizeCountryHint,
  sanitizeLanguageToken,
  sanitizeSearchKeywords,
  summarizeValues,
  throwIfSuggestionAborted,
  uniqueTexts,
} from './shared.js';

function looksStreamerIntent(query: string): boolean {
  const normalized = sanitizeSearchKeywords(query);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return (
    /\b(streamer|stream|livestream|live stream|twitch|vtuber|gaming|game)\b/i.test(
      lower
    ) ||
    /配信|配信者|実況|ストリーマー|ゲーム/.test(normalized) ||
    /스트리머|방송|게임|라이브/.test(normalized)
  );
}

function localizedDiscoveryHintTerms(
  locale: string,
  streamerIntent: boolean
): string[] {
  const normalizedLocale = sanitizeLanguageToken(locale)
    .toLowerCase()
    .split(/[-_]/)[0];

  if (normalizedLocale === 'ja') {
    return streamerIntent
      ? ['配信者', 'チャンネル', '配信 アーカイブ', '切り抜き', '動画']
      : ['クリエイター', 'チャンネル', '動画', '投稿者', '作品'];
  }

  if (normalizedLocale === 'ko') {
    return streamerIntent
      ? ['스트리머', '채널', '방송 다시보기', '클립', '영상']
      : ['크리에이터', '채널', '영상', '제작자', '콘텐츠'];
  }

  return streamerIntent
    ? ['streamer', 'channel', 'stream archive', 'clips', 'videos']
    : ['creator', 'channel', 'videos', 'clips', 'community'];
}

export function buildDefaultCreatorDiscoveryQueries({
  videoQuery,
  locale,
}: {
  videoQuery: string;
  locale: string;
}): string[] {
  const topic = sanitizeSearchKeywords(videoQuery);
  if (!topic) return [];

  return uniqueTexts([
    topic,
    ...localizedDiscoveryHintTerms(locale, looksStreamerIntent(topic)).map(
      suffix => `${topic} ${suffix}`.trim()
    ),
  ]).slice(0, 5);
}

type DiscoveryWebSearchPayload = {
  assistantMessage?: unknown;
  queriesUsed?: unknown;
  channels?: unknown;
  retrievalMode?: unknown;
  retrievalModeReason?: unknown;
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

function normalizeDiscoveryRetrievalMode(
  value: unknown
): DiscoveryRetrievalMode | null {
  const normalized = compactText(value).toLowerCase();
  if (!normalized) return null;
  if (
    normalized === 'channel' ||
    normalized === 'channel-first' ||
    normalized === 'channel_first'
  ) {
    return 'channel';
  }
  if (
    normalized === 'topic' ||
    normalized === 'topic-wide' ||
    normalized === 'topic_wide' ||
    normalized === 'broad'
  ) {
    return 'topic';
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
  const localeHint = sanitizeLanguageToken(input?.localeHint).toLowerCase();
  const categoryHint = compactText(input?.categoryHint).slice(0, 80);
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
    localeHint: localeHint || undefined,
    categoryHint: categoryHint || undefined,
    evidenceCount,
    evidenceUrls,
    score,
  };
}

function buildDiscoveryWebSearchPrompt({
  intentQuery,
  discoveryQueries,
  countryHint,
  recency,
  primarySearchLanguage,
}: {
  intentQuery: string;
  discoveryQueries: string[];
  countryHint: string;
  recency: VideoSuggestionRecency;
  primarySearchLanguage: string;
}): string {
  const safeIntent = sanitizeSearchKeywords(intentQuery);
  const safeCountry = sanitizeCountryHint(countryHint);
  const platformLabel = VIDEO_SUGGESTION_SOURCE_LABEL;
  const platformDomains = VIDEO_SUGGESTION_HOST_SUFFIXES;
  const queries = discoveryQueries.slice(0, 5);
  const recencyRule =
    recency === 'any'
      ? 'No recency restriction. Older and newer uploads are both valid.'
      : `Recency target: ${recencyLabel(recency)}.`;
  return `You find candidate creators/channels on ${platformLabel} using web search tool calls.
Reply with JSON only. No markdown.

Schema:
{
  "assistantMessage": "short status line",
  "retrievalMode": "channel or topic",
  "retrievalModeReason": "one short reason",
  "queriesUsed": ["query 1", "query 2"],
  "channels": [
    {
      "name": "channel display name",
      "url": "https://...",
      "localeHint": "ja",
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
- Country/region focus: ${safeCountry ? `"${safeCountry}"` : '(none)'}.
- ${recencyRule}
- Primary search language: ${primarySearchLanguage || 'en'}.
- Use plain keyword web queries in the target language. Avoid advanced operators like site:, inurl:, intitle:, channel:, or boolean quote syntax.
- Use these discovery queries first:
${queries.map((query, index) => `${index + 1}. ${query}`).join('\n')}
- Return up to 12 channel candidates.
- Prefer channels that are clearly relevant to the intent.
- candidate.url must be on one of these domains: ${platformDomains.join(', ')}.
- Include evidence URLs per channel.
- Set retrievalMode="channel" when creator/channel-centric search should run next.
- Set retrievalMode="topic" when a broad category/topic search should run next without channel filtering.
- Decide retrievalMode from user intent and evidence quality, not by fixed defaults.
- Never invent URLs.`;
}

export async function runDiscoveryWebSearch({
  intentQuery,
  discoveryQueries,
  countryHint,
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
  countryHint: string;
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
    stageKey: 'discovery',
    stageIndex: 2,
    stageTotal: 4,
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
      stageKey: 'discovery',
      stageIndex: 2,
      stageTotal: 4,
      stageState: 'running',
      elapsedMs: Date.now() - startedAt,
    });
  };

  let raw = '';
  raw = await callAIModel({
    operationId: `${operationId}-discovery-web-search`,
    model,
    translationPhase,
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
          countryHint,
          recency,
          primarySearchLanguage,
        }),
      },
      {
        role: 'user',
        content: JSON.stringify({
          intentQuery,
          discoveryQueries: queries,
          countryHint: countryHint || null,
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
  const explicitCreatorIntent =
    /\b(channel|creator|streamer|youtuber|vtuber|official)\b/i.test(
      intentQuery
    );
  const parsedRetrievalMode = normalizeDiscoveryRetrievalMode(
    parsed?.retrievalMode
  );
  const retrievalMode: DiscoveryRetrievalMode =
    parsedRetrievalMode ||
    (explicitCreatorIntent || channels.length >= 3 ? 'channel' : 'topic');
  const retrievalModeReason = clampTraceMessage(
    compactText(parsed?.retrievalModeReason) ||
      (retrievalMode === 'channel'
        ? 'Discovery found strong creator/channel evidence.'
        : 'Intent is category-wide or creator evidence is weak, so broad retrieval is better.'),
    180
  );

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'ranking',
    message: `Step 2/4 cleared: discovery found ${channels.length} channel candidates; mode=${retrievalMode === 'channel' ? 'channel-first' : 'topic-wide'}.`,
    searchQuery: queriesUsed[0] || sanitizeSearchKeywords(intentQuery),
    assistantPreview: clampTraceMessage(
      compactText(parsed?.assistantMessage) ||
        `Top channels: ${summarizeValues(
          channels.map(item => item.name),
          4
        )}.`,
      320
    ),
    stageKey: 'discovery',
    stageIndex: 2,
    stageTotal: 4,
    stageState: 'cleared',
    stageOutcome: clampTraceLines(
      [
        `Input queries (${queries.length}): ${summarizeValues(queries, 5)}.`,
        `Executed queries (${queriesUsed.length}): ${summarizeValues(queriesUsed, 5)}.`,
        `Yielded channel candidates (${channels.length}): ${summarizeValues(
          channels.map(item => item.name),
          5
        )}.`,
        `Yielded retrieval mode: ${retrievalMode} (${retrievalModeReason}).`,
        `Passed to step 3: ${retrievalMode === 'channel' ? 'channel curation' : 'topic-wide query planning'}.`,
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
    retrievalMode,
    retrievalModeReason,
  };
}

type CuratorPayload = {
  assistantMessage?: unknown;
  selectedChannels?: unknown;
  videoQueries?: unknown;
};

function parseCuratorPayload(raw: string): CuratorPayload | null {
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
      return obj as CuratorPayload;
    } catch {
      // Keep trying.
    }
  }
  return null;
}

function buildCuratorPrompt({
  intentQuery,
  countryHint,
  recency,
  primarySearchLanguage,
}: {
  intentQuery: string;
  countryHint: string;
  recency: VideoSuggestionRecency;
  primarySearchLanguage: string;
}): string {
  const safeIntent = sanitizeSearchKeywords(intentQuery);
  const safeCountry = sanitizeCountryHint(countryHint);
  const platformLabel = VIDEO_SUGGESTION_SOURCE_LABEL;
  const recencyRule =
    recency === 'any'
      ? 'No recency restriction. Do not bias ranking toward newer uploads.'
      : `Recency target: ${recencyLabel(recency)} (enforced later by algorithm; do not add dates).`;
  return `You are the curator.
Given intent + discovered channel candidates, choose the best channels and build final video search queries.
No web search tool here. Reply JSON only.

Schema:
{
  "assistantMessage": "short status",
  "selectedChannels": ["channel A", "channel B"],
  "videoQueries": ["query 1", "query 2"]
}

Rules:
- Intent: "${safeIntent}".
- Search source: ${platformLabel}.
- Country/region focus: ${safeCountry ? `"${safeCountry}"` : '(none)'}.
- ${recencyRule}
- Primary search language: ${primarySearchLanguage || 'en'}.
- selectedChannels: pick the best 3-6 channels.
- videoQueries: output 10 concise ${platformLabel} queries for actual video retrieval.
- Each query should be channel-centric when possible.
- Avoid duplicate/near-duplicate queries.
- Use plain keyword queries only. Do not use operators like site:, inurl:, intitle:, channel:, or boolean quote syntax.
- If an official handle is known, include it as plain text (e.g., MaiKurakiOfficial), not channel:"...".
- Do NOT emit filler phrases like "official channel", "latest", or "newest" unless the user explicitly requested that wording.
- Do not include explicit years/months/dates unless user asked for exact dates.`;
}

export async function curateVideoQueries({
  intentQuery,
  countryHint,
  recency,
  primarySearchLanguage,
  channels,
  translationPhase,
  model,
  operationId,
  onResolvedModel,
  signal,
}: {
  intentQuery: string;
  countryHint: string;
  recency: VideoSuggestionRecency;
  primarySearchLanguage: string;
  channels: DiscoveryChannelCandidate[];
  translationPhase: 'draft' | 'review';
  model: string;
  operationId: string;
  onResolvedModel?: (model: string) => void;
  signal?: AbortSignal;
}): Promise<CuratorOutcome> {
  throwIfSuggestionAborted(signal);
  const fallbackSelected = channels.slice(0, 4).map(item => item.name);
  const fallbackVideoQueries = uniqueTexts(
    channels
      .slice(0, 5)
      .map(item =>
        sanitizeSearchKeywords(
          `${item.name} ${intentQuery} ${
            primarySearchLanguage === 'ja'
              ? '配信 アーカイブ'
              : primarySearchLanguage === 'ko'
                ? '방송 다시보기'
                : 'stream archive'
          }`
        )
      )
      .filter(Boolean)
  ).slice(0, 10);

  try {
    const raw = await callAIModel({
      operationId: `${operationId}-curator`,
      model,
      translationPhase,
      onResolvedModel,
      reasoning: { effort: 'low' },
      signal,
      retryAttempts: 1,
      messages: [
        {
          role: 'system',
          content: buildCuratorPrompt({
            intentQuery,
            countryHint,
            recency,
            primarySearchLanguage,
          }),
        },
        {
          role: 'user',
          content: JSON.stringify({
            intentQuery,
            countryHint: countryHint || null,
            recency,
            primarySearchLanguage,
            channels: channels.map(item => ({
              name: item.name,
              url: item.url || null,
              localeHint: item.localeHint || null,
              categoryHint: item.categoryHint || null,
              evidenceCount: item.evidenceCount,
              evidenceUrls: item.evidenceUrls.slice(0, 4),
              score: item.score,
            })),
          }),
        },
      ],
    });
    throwIfSuggestionAborted(signal);

    const parsed = parseCuratorPayload(raw);
    const selectedChannels = uniqueTexts(
      Array.isArray(parsed?.selectedChannels)
        ? parsed.selectedChannels.map((value: unknown) => compactText(value))
        : fallbackSelected
    ).slice(0, 6);
    const videoQueries = uniqueTexts(
      Array.isArray(parsed?.videoQueries)
        ? parsed.videoQueries.map((value: unknown) =>
            sanitizeSearchKeywords(String(value || ''))
          )
        : fallbackVideoQueries
    ).slice(0, 10);

    return {
      selectedChannels: selectedChannels.length
        ? selectedChannels
        : fallbackSelected,
      videoQueries: videoQueries.length ? videoQueries : fallbackVideoQueries,
      assistantMessage: compactText(parsed?.assistantMessage),
    };
  } catch (error) {
    if (isSuggestionAbortError(error, signal)) {
      throw error;
    }
    return {
      selectedChannels: fallbackSelected,
      videoQueries: fallbackVideoQueries,
      assistantMessage: '',
    };
  }
}
