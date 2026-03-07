import type {
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import { callAIModel } from '../subtitle-processing/ai-client.js';
import {
  clampMessage,
  compactText,
  throwIfSuggestionAborted,
  recencyLabel,
  uniqueTexts,
} from './shared.js';

type LlmRerankPayload = {
  orderedUrls?: unknown;
  assistantMessage?: unknown;
};

type RankedCandidate = {
  item: VideoSuggestionResultItem;
  index: number;
  score: number;
  titleMatchCount: number;
  channelMatchCount: number;
  countryMatchCount: number;
  preferredChannelMatch: boolean;
  phraseMatch: boolean;
  uploadedTs: number | null;
};

const RANK_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'official',
  'video',
  'videos',
  'youtube',
  'channel',
]);

function parseUploadedTimestamp(value: string | undefined): number | null {
  const normalized = compactText(value);
  if (!normalized) return null;
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : null;
}

function recencyWindowDays(recency: VideoSuggestionRecency): number | null {
  switch (recency) {
    case 'day':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'year':
      return 365;
    default:
      return null;
  }
}

function normalizeRankText(value: string | undefined): string {
  return compactText(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeRankText(value: string | undefined): string[] {
  return uniqueTexts(
    normalizeRankText(value)
      .split(' ')
      .map(token => token.trim())
      .filter(token => {
        if (!token) return false;
        if (RANK_STOPWORDS.has(token)) return false;
        if (token.length >= 3) return true;
        if (/[0-9]/.test(token)) return true;
        return /[^\x00-\x7F]/.test(token);
      })
  );
}

function countTokenMatches(
  queryTokens: string[],
  candidateTokens: string[]
): number {
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;
  const candidateSet = new Set(candidateTokens);
  let matches = 0;
  for (const token of queryTokens) {
    if (candidateSet.has(token)) matches += 1;
  }
  return matches;
}

function isPreferredChannelMatch(
  channelText: string,
  channelTokens: string[],
  preferredChannels: string[]
): boolean {
  if (!channelText || preferredChannels.length === 0) return false;

  for (const preferred of preferredChannels) {
    const normalizedPreferred = normalizeRankText(preferred);
    if (!normalizedPreferred) continue;
    if (
      normalizedPreferred.length >= 4 &&
      (channelText.includes(normalizedPreferred) ||
        normalizedPreferred.includes(channelText))
    ) {
      return true;
    }
    const preferredTokens = tokenizeRankText(preferred);
    const overlap = countTokenMatches(preferredTokens, channelTokens);
    if (
      preferredTokens.length > 0 &&
      overlap >= Math.min(2, preferredTokens.length)
    ) {
      return true;
    }
  }

  return false;
}

function freshnessScore(
  recency: VideoSuggestionRecency,
  uploadedTs: number | null
): number {
  const windowDays = recencyWindowDays(recency);
  if (!windowDays || uploadedTs == null) return 0;

  const ageDays = Math.max(
    0,
    (Date.now() - uploadedTs) / (24 * 60 * 60 * 1000)
  );
  const normalizedAge = Math.min(1, ageDays / windowDays);
  return Math.round((1 - normalizedAge) * 8);
}

function buildDeterministicRankings({
  candidates,
  intentQuery,
  countryHint,
  recency,
  preferredChannels,
}: {
  candidates: VideoSuggestionResultItem[];
  intentQuery: string;
  countryHint: string;
  recency: VideoSuggestionRecency;
  preferredChannels: string[];
}): RankedCandidate[] {
  const normalizedIntent = normalizeRankText(intentQuery);
  const queryTokens = tokenizeRankText(intentQuery);
  const countryTokens = tokenizeRankText(countryHint);

  return candidates
    .map((item, index) => {
      const titleText = normalizeRankText(item.title);
      const channelText = normalizeRankText(item.channel);
      const titleTokens = tokenizeRankText(item.title);
      const channelTokens = tokenizeRankText(item.channel);
      const titleMatchCount = countTokenMatches(queryTokens, titleTokens);
      const channelMatchCount = countTokenMatches(queryTokens, channelTokens);
      const countryMatchCount =
        countTokenMatches(countryTokens, titleTokens) +
        countTokenMatches(countryTokens, channelTokens);
      const phraseMatch =
        normalizedIntent.length >= 6 &&
        (titleText.includes(normalizedIntent) ||
          channelText.includes(normalizedIntent));
      const preferredChannelMatch = isPreferredChannelMatch(
        channelText,
        channelTokens,
        preferredChannels
      );
      const uploadedTs = parseUploadedTimestamp(item.uploadedAt);
      const allQueryTokensInTitle =
        queryTokens.length >= 2 && titleMatchCount >= queryTokens.length;

      let score = 0;
      if (phraseMatch) score += 18;
      score += titleMatchCount * 10;
      score += channelMatchCount * 6;
      if (allQueryTokensInTitle) score += 10;
      if (preferredChannelMatch) score += 26;
      score += Math.min(6, countryMatchCount * 2);
      score += freshnessScore(recency, uploadedTs);
      if (
        titleMatchCount === 0 &&
        channelMatchCount === 0 &&
        !preferredChannelMatch &&
        !phraseMatch
      ) {
        score -= 4;
      }

      return {
        item,
        index,
        score,
        titleMatchCount,
        channelMatchCount,
        countryMatchCount,
        preferredChannelMatch,
        phraseMatch,
        uploadedTs,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.preferredChannelMatch !== right.preferredChannelMatch) {
        return left.preferredChannelMatch ? -1 : 1;
      }
      if (left.uploadedTs != null && right.uploadedTs != null) {
        if (right.uploadedTs !== left.uploadedTs) {
          return right.uploadedTs - left.uploadedTs;
        }
      } else if (left.uploadedTs != null || right.uploadedTs != null) {
        return left.uploadedTs != null ? -1 : 1;
      }
      return left.index - right.index;
    });
}

function summarizeDeterministicRanking(
  rankedCandidates: RankedCandidate[],
  recency: VideoSuggestionRecency
): string {
  const top = rankedCandidates[0];
  if (!top) return '';
  if (top.preferredChannelMatch) {
    return 'Deterministic ranking prioritized preferred-channel matches.';
  }
  if (top.phraseMatch) {
    return 'Deterministic ranking prioritized exact intent phrase matches.';
  }
  if (top.titleMatchCount > 0 && recency !== 'any' && top.uploadedTs != null) {
    return 'Deterministic ranking prioritized title relevance and freshness.';
  }
  if (top.titleMatchCount >= top.channelMatchCount) {
    return 'Deterministic ranking prioritized title relevance.';
  }
  if (top.channelMatchCount > 0) {
    return 'Deterministic ranking prioritized channel relevance.';
  }
  return 'Deterministic ranking kept the best available candidate order.';
}

function shouldUseLlmRerank(
  rankedCandidates: RankedCandidate[],
  maxResults: number
): boolean {
  if (rankedCandidates.length <= 3) return false;

  const comparable = rankedCandidates.slice(
    0,
    Math.min(rankedCandidates.length, Math.max(5, Math.min(maxResults, 8)))
  );
  const top = comparable[0];
  const second = comparable[1];
  if (!top || !second) return false;

  const topGap = top.score - second.score;
  const weakTopSignal = top.score < 12;
  const nearTies = comparable
    .slice(1)
    .filter(
      (entry, index) => Math.abs(comparable[index].score - entry.score) <= 5
    ).length;
  const clearPreferredChannelWin =
    top.preferredChannelMatch && !second.preferredChannelMatch && topGap >= 8;
  const clearLexicalWin =
    top.titleMatchCount >= Math.max(1, second.titleMatchCount + 1) &&
    topGap >= 8;

  if (clearPreferredChannelWin || clearLexicalWin) return false;
  if (!weakTopSignal && nearTies === 0 && topGap >= 10) return false;
  return true;
}

function parseLlmRerankPayload(raw: string): LlmRerankPayload | null {
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
      return obj as LlmRerankPayload;
    } catch {
      // Continue trying fallback parsers.
    }
  }
  return null;
}

export async function rerankVideosWithLlm({
  candidates,
  intentQuery,
  countryHint,
  recency,
  translationPhase,
  model,
  operationId,
  maxResults,
  preferredChannels = [],
  onResolvedModel,
  signal,
}: {
  candidates: VideoSuggestionResultItem[];
  intentQuery: string;
  countryHint: string;
  recency: VideoSuggestionRecency;
  translationPhase: 'draft' | 'review';
  model: string;
  operationId: string;
  maxResults: number;
  preferredChannels?: string[];
  onResolvedModel?: (model: string) => void;
  signal?: AbortSignal;
}): Promise<{
  results: VideoSuggestionResultItem[];
  assistantMessage: string;
  rankingMode: 'deterministic' | 'llm-assisted';
}> {
  throwIfSuggestionAborted(signal);
  const rankedCandidates = buildDeterministicRankings({
    candidates,
    intentQuery,
    countryHint,
    recency,
    preferredChannels,
  });
  const preparedCandidates = rankedCandidates.map(entry => entry.item);
  const deterministicMessage = summarizeDeterministicRanking(
    rankedCandidates,
    recency
  );

  if (preparedCandidates.length <= 1) {
    return {
      results: preparedCandidates.slice(0, maxResults),
      assistantMessage: deterministicMessage,
      rankingMode: 'deterministic',
    };
  }
  if (!shouldUseLlmRerank(rankedCandidates, maxResults)) {
    return {
      results: preparedCandidates.slice(0, maxResults),
      assistantMessage: deterministicMessage,
      rankingMode: 'deterministic',
    };
  }
  const recencyRankingRule =
    recency === 'any'
      ? 'Do not prioritize freshness. Rank by relevance and country fit regardless of upload date.'
      : `Prioritize intent relevance, country fit, and ${recencyLabel(recency)} freshness using uploadedAt when present. Treat missing upload dates as unknown, not fresh.`;

  const raw = await callAIModel({
    operationId: `${operationId}-llm-rerank`,
    model,
    translationPhase,
    onResolvedModel,
    reasoning: { effort: 'low' },
    signal,
    retryAttempts: 1,
    messages: [
      {
        role: 'system',
        content: `You rank candidate videos for a recommender.
Reply with JSON only.

Schema:
{
  "assistantMessage": "short explanation",
  "orderedUrls": ["url1", "url2"]
}

Rules:
- orderedUrls must only contain URLs from the given candidate list.
- Keep only the best ${maxResults} results.
- ${recencyRankingRule}
- Candidates are pre-sorted by deterministic relevance. Only reorder when a clearly better ranking exists.
- uploadedAt is an ISO timestamp when known, otherwise an empty string.
- Remove duplicates and low-confidence items.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          intentQuery,
          countryHint: countryHint || null,
          recency,
          candidates: preparedCandidates.map(item => ({
            title: item.title,
            url: item.url,
            channel: item.channel || '',
            durationSec: item.durationSec ?? null,
            uploadedAt: item.uploadedAt || '',
          })),
        }),
      },
    ],
  });
  throwIfSuggestionAborted(signal);

  const parsed = parseLlmRerankPayload(raw);
  const orderedUrls = Array.isArray(parsed?.orderedUrls)
    ? uniqueTexts(parsed?.orderedUrls.map(value => compactText(value)))
    : [];
  if (orderedUrls.length === 0) {
    return {
      results: preparedCandidates.slice(0, maxResults),
      assistantMessage: clampMessage(
        compactText(parsed?.assistantMessage) || deterministicMessage
      ),
      rankingMode: 'deterministic',
    };
  }

  const byUrl = new Map<string, VideoSuggestionResultItem>();
  for (const item of preparedCandidates) {
    byUrl.set(item.url, item);
  }
  const reranked: VideoSuggestionResultItem[] = [];
  const seenUrls = new Set<string>();
  for (const url of orderedUrls) {
    const matched = byUrl.get(url);
    if (!matched) continue;
    if (seenUrls.has(matched.url)) continue;
    seenUrls.add(matched.url);
    reranked.push(matched);
    if (reranked.length >= maxResults) break;
  }

  for (const item of preparedCandidates) {
    if (reranked.length >= maxResults) break;
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    reranked.push(item);
  }

  if (reranked.length === 0) {
    return {
      results: preparedCandidates.slice(0, maxResults),
      assistantMessage: clampMessage(
        compactText(parsed?.assistantMessage) || deterministicMessage
      ),
      rankingMode: 'deterministic',
    };
  }

  return {
    results: reranked,
    assistantMessage: clampMessage(
      compactText(parsed?.assistantMessage) || deterministicMessage
    ),
    rankingMode: 'llm-assisted',
  };
}
