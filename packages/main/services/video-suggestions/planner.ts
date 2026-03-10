import type { VideoSuggestionMessage } from '@shared-types/app';
import {
  type DiscoveryRetrievalMode,
  type IntentResolverPayload,
  type QueryFormulatorPayload,
  buildOrderedIntentSeedQueries,
  clampMessage,
  compactText,
  normalizeCountryCode,
  normalizeDescriptorPhrases,
  normalizeIntentCandidates,
  parseBooleanLike,
  sanitizeCountryHint,
  sanitizeLanguageToken,
  sanitizeRetrievalSearchQuery,
  sanitizeSearchKeywords,
  uniqueTexts,
  normalizePreferenceSlots,
} from './shared.js';

function normalizePlannerRetrievalMode(
  value: unknown
): DiscoveryRetrievalMode | undefined {
  const normalized = compactText(value).toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'channel' || normalized === 'channel-first') {
    return 'channel';
  }
  if (
    normalized === 'topic' ||
    normalized === 'topic-wide' ||
    normalized === 'broad'
  ) {
    return 'topic';
  }
  return undefined;
}

export function parseIntentResolverPayload(
  raw: string
): IntentResolverPayload | null {
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
      const answerToUserQuestion = clampMessage(
        compactText(obj?.answerToUserQuestion)
      );
      const assistantMessage = clampMessage(compactText(obj?.assistantMessage));
      const resolvedIntent = clampMessage(compactText(obj?.resolvedIntent));
      const intentSummary = clampMessage(compactText(obj?.intentSummary));
      const strategy = clampMessage(compactText(obj?.strategy));
      const candidates = normalizeIntentCandidates(obj?.candidates);
      const descriptorPhrases = normalizeDescriptorPhrases(
        obj?.descriptorPhrases
      );
      const canonicalEntities = uniqueTexts(
        Array.isArray(obj?.canonicalEntities)
          ? obj.canonicalEntities.map((value: unknown) => compactText(value))
          : []
      ).slice(0, 6);
      const impliedLocale = compactText(obj?.impliedLocale).slice(0, 30);
      const impliedSearchLanguage = sanitizeLanguageToken(
        obj?.impliedSearchLanguage
      ).toLowerCase();
      const primarySearchLanguage = sanitizeLanguageToken(
        obj?.primarySearchLanguage
      ).toLowerCase();
      const searchLanguages = uniqueTexts(
        Array.isArray(obj?.searchLanguages)
          ? obj.searchLanguages.map((value: unknown) =>
              sanitizeLanguageToken(value).toLowerCase()
            )
          : []
      ).slice(0, 3);
      const searchQuery = compactText(obj?.searchQuery);
      const discoveryQueries = uniqueTexts(
        Array.isArray(obj?.discoveryQueries)
          ? obj.discoveryQueries.map((value: unknown) =>
              sanitizeSearchKeywords(String(value || ''))
            )
          : []
      ).slice(0, 5);
      const retrievalMode = normalizePlannerRetrievalMode(obj?.retrievalMode);
      const retrievalQueries = uniqueTexts(
        Array.isArray(obj?.retrievalQueries)
          ? obj.retrievalQueries.map((value: unknown) =>
              sanitizeRetrievalSearchQuery(String(value || ''))
            )
          : []
      ).slice(0, 10);
      const impliedConstraintsRaw =
        obj?.impliedConstraints && typeof obj.impliedConstraints === 'object'
          ? (obj.impliedConstraints as Record<string, unknown>)
          : {};
      const ambiguities = uniqueTexts(
        Array.isArray(obj?.ambiguities)
          ? obj.ambiguities.map((value: unknown) => compactText(value))
          : []
      ).slice(0, 4);
      const recommendedInterpretation = clampMessage(
        compactText(obj?.recommendedInterpretation)
      );
      const confidenceRaw = compactText(obj?.confidence).toLowerCase();
      const confidence =
        confidenceRaw === 'low' ||
        confidenceRaw === 'medium' ||
        confidenceRaw === 'high'
          ? confidenceRaw
          : undefined;
      const capturedPreferenceSource = {
        ...(obj && typeof obj === 'object'
          ? (obj as Record<string, unknown>)
          : {}),
        ...(obj?.preferences && typeof obj.preferences === 'object'
          ? (obj.preferences as Record<string, unknown>)
          : {}),
        ...(obj?.capturedPreferences &&
        typeof obj.capturedPreferences === 'object'
          ? (obj.capturedPreferences as Record<string, unknown>)
          : {}),
      };
      const capturedPreferences = normalizePreferenceSlots(
        capturedPreferenceSource
      );
      const parsedNeedsMoreContext = parseBooleanLike(obj?.needsMoreContext);
      const fallbackQueries = buildOrderedIntentSeedQueries({
        candidates,
        descriptorPhrases,
        resolvedIntent,
      });
      const inferredReady = Boolean(
        searchQuery ||
        discoveryQueries.length > 0 ||
        retrievalQueries.length > 0 ||
        candidates.length > 0 ||
        descriptorPhrases.length > 0 ||
        fallbackQueries.length > 0
      );
      const needsMoreContext =
        parsedNeedsMoreContext ?? (inferredReady ? false : true);

      return {
        assistantMessage,
        needsMoreContext,
        answerToUserQuestion,
        resolvedIntent,
        intentSummary,
        strategy,
        candidates,
        descriptorPhrases,
        canonicalEntities,
        impliedLocale,
        impliedSearchLanguage,
        primarySearchLanguage,
        searchLanguages,
        searchQuery,
        discoveryQueries,
        retrievalMode,
        retrievalQueries:
          retrievalQueries.length > 0 ? retrievalQueries : fallbackQueries,
        impliedConstraints: {
          country: sanitizeCountryHint(impliedConstraintsRaw.country),
          recency: compactText(impliedConstraintsRaw.recency).toLowerCase(),
        },
        ambiguities,
        recommendedInterpretation,
        confidence,
        capturedPreferences,
      };
    } catch {
      // Continue trying fallback parsers.
    }
  }

  return null;
}

export function parseQueryFormulatorPayload(
  raw: string
): QueryFormulatorPayload | null {
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
      const assistantMessage = clampMessage(compactText(obj?.assistantMessage));
      const intentSummary = clampMessage(compactText(obj?.intentSummary));
      const strategy = clampMessage(compactText(obj?.strategy));
      const countryCode = normalizeCountryCode(obj?.countryCode);
      const primarySearchLanguage = sanitizeLanguageToken(
        obj?.primarySearchLanguage
      ).toLowerCase();
      const searchLanguages = uniqueTexts(
        Array.isArray(obj?.searchLanguages)
          ? obj.searchLanguages.map((value: unknown) =>
              sanitizeLanguageToken(value).toLowerCase()
            )
          : []
      ).slice(0, 3);
      const searchQuery = compactText(obj?.searchQuery);
      const retrievalQueries = uniqueTexts(
        Array.isArray(obj?.retrievalQueries)
          ? obj.retrievalQueries.map((value: unknown) =>
              sanitizeRetrievalSearchQuery(String(value || ''))
            )
          : []
      ).slice(0, 10);
      const capturedPreferenceSource = {
        ...(obj && typeof obj === 'object'
          ? (obj as Record<string, unknown>)
          : {}),
        ...(obj?.preferences && typeof obj.preferences === 'object'
          ? (obj.preferences as Record<string, unknown>)
          : {}),
        ...(obj?.capturedPreferences &&
        typeof obj.capturedPreferences === 'object'
          ? (obj.capturedPreferences as Record<string, unknown>)
          : {}),
      };
      const capturedPreferences = normalizePreferenceSlots(
        capturedPreferenceSource
      );
      const parsedNeedsMoreContext = parseBooleanLike(obj?.needsMoreContext);
      const inferredReady = Boolean(searchQuery || retrievalQueries.length > 0);
      const needsMoreContext =
        parsedNeedsMoreContext ?? (inferredReady ? false : true);

      return {
        assistantMessage,
        needsMoreContext,
        intentSummary,
        strategy,
        countryCode,
        primarySearchLanguage,
        searchLanguages,
        searchQuery,
        retrievalQueries,
        capturedPreferences,
      };
    } catch {
      // Continue trying fallback parsers.
    }
  }

  return null;
}

export function toPlannerMessages(
  history: VideoSuggestionMessage[] | undefined
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const cleaned = (history || [])
    .map((msg): { role: 'user' | 'assistant'; content: string } => ({
      role: msg?.role === 'assistant' ? 'assistant' : 'user',
      content: compactText(msg?.content),
    }))
    .map(msg => {
      if (msg.role === 'assistant' && msg.content.startsWith('__i18n__:')) {
        // Drop unresolved placeholder keys from context so planner receives
        // conversational text only.
        return { ...msg, content: '' };
      }
      return msg;
    })
    .filter(msg => msg.content.length > 0)
    .slice(-12);
  return cleaned;
}

function normalizeForIntentChecks(value: string): string {
  return compactText(value)
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"'`~\-_/\\|]/g, '');
}

export function isBroadAcceptanceReply(value: string): boolean {
  const normalized = normalizeForIntentChecks(value);
  if (!normalized) return false;

  const exact = new Set([
    'any',
    'anything',
    'any one',
    'whatever',
    'no preference',
    'doesnt matter',
    "doesn't matter",
    'anything is fine',
    'any is fine',
    'all good',
    '아무거나',
    '아무거나요',
    '상관없어',
    '상관없어요',
    '상관없습니다',
    '뭐든',
    '뭐든지',
    '다 좋아',
    '아무거나 괜찮아',
    '아무거나 괜찮아요',
  ]);

  if (exact.has(normalized)) return true;

  return (
    normalized.includes('anything is fine') ||
    normalized.includes('no preference') ||
    normalized.includes('아무거나') ||
    normalized.includes('상관없')
  );
}

export function findFallbackTopicFromHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== 'user') continue;
    const content = compactText(msg.content);
    if (!content) continue;
    if (isBroadAcceptanceReply(content)) continue;
    return content;
  }
  return '';
}
