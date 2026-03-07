import type {
  VideoSuggestionMessage,
  VideoSuggestionPreferenceSlots,
  VideoSuggestionRecency,
} from '@shared-types/app';
import {
  type DiscoveryRetrievalMode,
  type PlannerPayload,
  clampMessage,
  compactText,
  parseBooleanLike,
  recencyLabel,
  sanitizeCountryHint,
  sanitizeLanguageToken,
  sanitizeRetrievalSearchQuery,
  sanitizeSearchKeywords,
  sanitizeVideoSuggestionPreferenceValue,
  VIDEO_SUGGESTION_SOURCE_LABEL,
  uniqueTexts,
  normalizePreferenceSlots,
} from './shared.js';

export function buildPlannerPrompt(
  languageTag?: string,
  languageName?: string,
  countryHint?: string,
  recency: VideoSuggestionRecency = 'any',
  savedPreferences?: VideoSuggestionPreferenceSlots
): string {
  const safeTag = sanitizeLanguageToken(languageTag);
  const safeName = compactText(languageName).slice(0, 50);
  const safeCountry = sanitizeCountryHint(countryHint);
  const languageRule = safeName
    ? `Always write assistantMessage in ${safeName}${safeTag ? ` (${safeTag})` : ''}.`
    : safeTag
      ? `Always write assistantMessage in the language locale "${safeTag}".`
      : 'Always match the user selected app language.';
  const countryRule = safeCountry
    ? `Target country/region is "${safeCountry}". Keep results focused there unless the user overrides it.`
    : 'Never assume country/region from locale, account location, or prior defaults.';
  const countryQuestionRule = safeCountry
    ? 'If the user later asks for another country/region, switch to it immediately.'
    : 'If user intent is clear but country/region is missing, ask a short follow-up for country/region before searching.';
  const recencyRule =
    recency === 'any'
      ? 'No time restriction unless the user asks for one. Older videos are valid and should not be deprioritized by date.'
      : `Apply a strict recency filter of ${recencyLabel(recency)}.`;
  const queryLanguageRule = safeCountry
    ? 'searchQuery language must match the target country/region market language when clear (e.g., Japan -> Japanese keywords).'
    : 'searchQuery can use English keywords unless user requests another language.';
  const safeSavedTopic = sanitizeVideoSuggestionPreferenceValue(
    savedPreferences?.topic
  );
  const safeSavedCreator = sanitizeVideoSuggestionPreferenceValue(
    savedPreferences?.creator
  );
  const safeSavedSubtopic = sanitizeVideoSuggestionPreferenceValue(
    savedPreferences?.subtopic
  );
  const savedPreferenceRule =
    safeSavedTopic || safeSavedCreator || safeSavedSubtopic
      ? `Saved user preferences from previous sessions: topic="${safeSavedTopic || '(none)'}", creator="${safeSavedCreator || '(none)'}", subtopic="${safeSavedSubtopic || '(none)'}". Use these as defaults and avoid re-asking unless user overrides.`
      : 'No saved preference slots yet.';
  const platformLabel = VIDEO_SUGGESTION_SOURCE_LABEL;

  return `You are the strategist for a video recommender.
You do NOT run web search here.
Reply with JSON only. No markdown.

Schema:
{
  "assistantMessage": "short response, max 120 chars, user-facing",
  "needsMoreContext": true or false,
  "intentSummary": "one short sentence",
  "strategy": "short internal plan",
  "primarySearchLanguage": "language code like ja/en/ko",
  "searchLanguages": ["preferred language codes in order"],
  "retrievalMode": "channel or topic",
  "retrievalQueries": ["up to 10 concrete retrieval queries"],
  "searchQuery": "single fallback query",
  "discoveryQueries": ["exactly 5 channel-discovery queries when context is enough; [] otherwise"],
  "capturedPreferences": {
    "topic": "short topic keyword or empty",
    "creator": "short creator/streamer preference or empty",
    "subtopic": "short subtopic/genre keyword or empty"
  }
}

Rules:
- ${languageRule}
- ${countryRule}
- ${countryQuestionRule}
- ${recencyRule}
- ${savedPreferenceRule}
- Search source is fixed to ${platformLabel}. Never change it.
- Never ask the user to choose a source.
- Never suggest a different source in assistantMessage.
- Ask concise follow-up questions when context is vague.
- Do not overwhelm the user.
- If the user says broad acceptance (e.g., "any", "anything", "whatever", "no preference", "아무거나", "상관없어요"), treat it as sufficient preference and proceed.
- Do not repeat the same narrowing question after a broad-acceptance reply.
- Set needsMoreContext=true until the intent is clear enough for channel discovery.
- When ready, produce EXACTLY 5 discoveryQueries optimized for finding creator/channel candidates.
- discoveryQueries are for creator discovery only (channel-centric), not final video retrieval.
- ${queryLanguageRule}
- Keep searchQuery natural in the search language; do NOT force country tokens when intent is already clear.
- searchQuery should be the single best summary query (used for UI visibility).
- retrievalMode is required when ready:
  - "channel" when user intent is creator-specific (artist/creator/channel).
  - "topic" when user intent is broad category/topic exploration.
- retrievalQueries are required when ready (3-10 concise queries) and will be used downstream with high priority.
- retrievalQueries must target ${platformLabel} content only.
- For music-artist intent, include concrete artist + song/work title queries whenever confidently known.
- Never use filler query phrases like "official channel", "latest", or "newest" unless explicitly requested by user.
- Respect recency via filtering, not by adding explicit years/months/dates in searchQuery.
- Also respect recency for discoveryQueries: avoid explicit dates unless user asked for exact dates.
- Prefer creator/channel/topic keywords over generic words to avoid irrelevant music results.
- Never output explicit date tokens like "2024", "March", "3월", "3月" unless the user explicitly asked for a specific date.
- Keep capturedPreferences compact (max ~40 chars each) and update them whenever user gives explicit preference signals.
- If user says broad acceptance ("any"/"whatever"), preserve existing capturedPreferences instead of clearing them.
- If ready, assistantMessage should briefly confirm what the system will search for next.`;
}

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

export function parsePlannerPayload(raw: string): PlannerPayload | null {
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
      const message = clampMessage(obj?.assistantMessage);
      const searchQuery = compactText(obj?.searchQuery);
      const intentSummary = clampMessage(compactText(obj?.intentSummary));
      const strategy = clampMessage(compactText(obj?.strategy));
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
      const capturedPreferences = normalizePreferenceSlots(
        obj?.capturedPreferences ?? obj?.preferences
      );
      const parsedNeedsMoreContext = parseBooleanLike(obj?.needsMoreContext);
      const inferredReady = Boolean(
        searchQuery || discoveryQueries.length > 0 || retrievalQueries.length > 0
      );
      const needsMoreContext =
        parsedNeedsMoreContext ?? (inferredReady ? false : true);
      return {
        assistantMessage: message,
        needsMoreContext,
        searchQuery,
        intentSummary,
        strategy,
        primarySearchLanguage,
        searchLanguages,
        discoveryQueries,
        retrievalMode,
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
