import {
  AI_MODELS,
  CHARS_PER_TOKEN,
  PREVIEW_TTS_CREDITS,
  CREDITS_PER_TRANSLATION_AUDIO_HOUR,
  CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR,
  SUMMARY_OUTPUT_TOKEN_RATIO,
  SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER,
  SUMMARY_QUALITY_MULTIPLIER,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  STAGE5_TTS_MODEL_ELEVEN_V4,
  TTS_CREDITS_PER_MINUTE,
  TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER,
  TRANSLATION_HOURLY_COST_CALIBRATION,
  TRANSLATION_CHARS_COST_CALIBRATION,
  TRANSLATION_REVIEW_PROMPT_TOKENS_PER_SOURCE_TOKEN,
  estimateSummaryUsdPerHour,
  estimateTokenModelUsd,
  estimateTranslationUsdPerHour,
  estimateTtsCredits,
  getTtsCreditsPerCharacter,
  PRICE_MARGIN,
  STAGE5_CREDIT_MODELS,
  USD_PER_CREDIT,
} from '../../shared/constants';

export { PREVIEW_TTS_CREDITS };

export type SummaryEffortLevel = 'standard' | 'high';
// Dubbing is ElevenLabs-only (OpenAI TTS retires 2027-01-06).
export type TtsProvider = 'elevenlabs';
export type TranslationReviewModel =
  | typeof STAGE5_REVIEW_TRANSLATION_MODEL
  | typeof AI_MODELS.CLAUDE_OPUS;

export const TTS_CREDITS_PER_CHAR: Record<TtsProvider, number> = {
  elevenlabs: getTtsCreditsPerCharacter(STAGE5_TTS_MODEL_ELEVEN_V4),
};

const usdToCredits = (usd: number) =>
  Math.ceil((usd * PRICE_MARGIN) / USD_PER_CREDIT);

/**
 * Credits per audio hour: the draft on the credit-mode draft model, plus (with
 * quality on) the review on its own model's price. Calibrated to measured
 * costs; review is not a multiple of the draft (Opus 5.5 review costs ~40x a
 * Haiku 5.5 draft).
 */
export function estimateTranslationCreditsPerHour(
  qualityEnabled: boolean,
  reviewModel: string = STAGE5_CREDIT_MODELS.REVIEW
): number {
  if (!qualityEnabled) {
    return CREDITS_PER_TRANSLATION_AUDIO_HOUR;
  }
  return (
    CREDITS_PER_TRANSLATION_AUDIO_HOUR +
    usdToCredits(
      estimateTranslationUsdPerHour(reviewModel) *
        TRANSLATION_HOURLY_COST_CALIBRATION
    )
  );
}

function normalizeKnownCredits(credits: number | null): number | null {
  if (typeof credits !== 'number' || !Number.isFinite(credits)) return null;
  return Math.max(0, credits);
}

/**
 * Calculate how many hours of video can be translated with given credits
 */
export function estimateTranslatableHours(
  credits: number | null,
  qualityEnabled: boolean,
  reviewModel: string = STAGE5_REVIEW_TRANSLATION_MODEL
): number | null {
  const safeCredits = normalizeKnownCredits(credits);
  if (safeCredits === null) return null;
  return (
    safeCredits / estimateTranslationCreditsPerHour(qualityEnabled, reviewModel)
  );
}

export function estimateTranscriptionHours(
  credits: number | null
): number | null {
  const safeCredits = normalizeKnownCredits(credits);
  if (safeCredits === null) return null;
  return safeCredits / CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR;
}

export function estimateDubbingHours(
  credits: number | null,
  provider: TtsProvider = 'elevenlabs'
): number | null {
  const safeCredits = normalizeKnownCredits(credits);
  if (safeCredits === null) return null;
  return safeCredits / TTS_CREDITS_PER_MINUTE[provider] / 60;
}

export function estimateSummaryHours(
  credits: number | null,
  effortLevel: SummaryEffortLevel
): number | null {
  const safeCredits = normalizeKnownCredits(credits);
  if (safeCredits === null) return null;
  const creditsPerHour =
    effortLevel === 'high'
      ? CREDITS_PER_SUMMARY_AUDIO_HOUR_HIGH
      : CREDITS_PER_SUMMARY_AUDIO_HOUR;
  return safeCredits / creditsPerHour;
}

export function estimateTranslationCreditsFromChars(
  charCount: number,
  qualityEnabled: boolean,
  reviewModel: string = STAGE5_CREDIT_MODELS.REVIEW
): number {
  const safeCharCount = Math.max(0, Math.ceil(charCount || 0));
  if (safeCharCount === 0) return 0;
  const sourceTokens = Math.ceil(safeCharCount / CHARS_PER_TOKEN);
  const draftUsd = estimateTokenModelUsd({
    promptTokens: sourceTokens,
    completionTokens: sourceTokens,
    model: STAGE5_CREDIT_MODELS.DRAFT,
  });
  const reviewUsd = qualityEnabled
    ? estimateTokenModelUsd({
        promptTokens:
          sourceTokens * TRANSLATION_REVIEW_PROMPT_TOKENS_PER_SOURCE_TOKEN,
        completionTokens: sourceTokens,
        model: reviewModel,
      })
    : 0;
  return usdToCredits(
    (draftUsd + reviewUsd) *
      TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER *
      TRANSLATION_CHARS_COST_CALIBRATION
  );
}

// Stage5 credit summaries run on Claude Sonnet 5.5 (standard) and Opus 5.5
// (high, which also does SUMMARY_QUALITY_MULTIPLIER times the work), so the
// estimates use those models' prices, not the draft model's.
export const CREDITS_PER_SUMMARY_AUDIO_HOUR = usdToCredits(
  estimateSummaryUsdPerHour(STAGE5_CREDIT_MODELS.STANDARD)
);
export const CREDITS_PER_SUMMARY_AUDIO_HOUR_HIGH = usdToCredits(
  estimateSummaryUsdPerHour(STAGE5_CREDIT_MODELS.HIGH) *
    SUMMARY_QUALITY_MULTIPLIER
);

export function estimateSummaryCreditsFromChars(
  charCount: number,
  effortLevel: SummaryEffortLevel
): number {
  const safeCharCount = Math.max(0, Math.ceil(charCount || 0));
  if (safeCharCount === 0) return 0;
  const inputTokens = Math.ceil(safeCharCount / CHARS_PER_TOKEN);
  const outputTokens = Math.ceil(inputTokens * SUMMARY_OUTPUT_TOKEN_RATIO);
  const model =
    effortLevel === 'high'
      ? STAGE5_CREDIT_MODELS.HIGH
      : STAGE5_CREDIT_MODELS.STANDARD;
  const baseUsd = estimateTokenModelUsd({
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    model,
  });
  const withPipelineOverhead = baseUsd * SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER;
  return usdToCredits(
    effortLevel === 'high'
      ? withPipelineOverhead * SUMMARY_QUALITY_MULTIPLIER
      : withPipelineOverhead
  );
}

export function estimateDubbingCreditsFromChars(
  charCount: number,
  _provider: TtsProvider = 'elevenlabs'
): number {
  const safeCharCount = Math.max(0, Math.ceil(charCount || 0));
  if (safeCharCount === 0) return 0;
  return estimateTtsCredits({
    characters: safeCharCount,
    model: STAGE5_TTS_MODEL_ELEVEN_V4,
  });
}

/**
 * Format hours into a readable string (e.g., "2h 30m" or "45m")
 * Used in settings page for detailed display
 */
export function formatHours(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return mins > 0 ? `${mins}m` : '<1m';
  }
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format minutes into compact time string
 * < 60 min: "45m", >= 60 min: "2h 30m"
 */
export function formatTime(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format credits into compact string (e.g., "~5k", "~134k")
 */
/** Credits a transcription of `seconds` of audio costs (ElevenLabs Scribe). */
export function estimateTranscriptionCreditsForSeconds(
  seconds: number
): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil((seconds * CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR) / 3600);
}

/**
 * Audio a credit amount can transcribe, as "32m" or "5h 21m". Packs and the
 * balance are described in transcription time because every credit path
 * (subtitles, dubbing) starts with it, while translating with the user's own
 * Claude or Codex is free; translation hours overstated what credits buy.
 */
export function formatTranscriptionTime(credits: number | null): string | null {
  const hours = estimateTranscriptionHours(credits);
  return hours != null && hours > 0 ? formatHours(hours) : null;
}

/** A balance without the "~" estimate marker: 850, 4.2k, 168k. */
export function formatCreditBalance(credits: number): string {
  const safe = Math.max(0, Math.floor(credits));
  if (safe < 1000) return String(safe);
  if (safe < 10000) return `${(safe / 1000).toFixed(1)}k`;
  return `${Math.round(safe / 1000)}k`;
}

export function formatCredits(credits: number): string {
  if (credits < 1000) return `~${Math.ceil(credits)}`;
  if (credits < 10000) return `~${(credits / 1000).toFixed(1)}k`;
  return `~${Math.round(credits / 1000)}k`;
}

export function formatDubbingTime(
  credits: number,
  provider: TtsProvider = 'elevenlabs'
): string {
  const hours = estimateDubbingHours(credits, provider);
  if (hours == null) return '~0s';
  const minutes = hours * 60;
  if (minutes < 1) {
    const seconds = Math.floor(minutes * 60);
    return `~${seconds}s`;
  }
  if (minutes < 60) {
    return `~${Math.floor(minutes)}m`;
  }
  const wholeHours = Math.floor(minutes / 60);
  const remainingMins = Math.floor(minutes % 60);
  if (remainingMins === 0) return `~${wholeHours}h`;
  return `~${wholeHours}h ${remainingMins}m`;
}

/** Share of the balance at which starting a dub asks for confirmation. */
export const DUB_COST_CONFIRM_SHARE = 0.25;

/**
 * Whether a dub is big enough, relative to the balance, to confirm before it
 * starts. Voices cost far more than translation (a 44-minute dub used ~132k
 * credits on 2026-10-12, most of a just-bought pack, with no warning).
 */
export function shouldConfirmDubCost(
  estimatedCredits: number,
  balance: number | null
): boolean {
  if (!Number.isFinite(estimatedCredits) || estimatedCredits <= 0) return false;
  if (balance == null || !Number.isFinite(balance)) return false;
  return estimatedCredits >= balance * DUB_COST_CONFIRM_SHARE;
}
