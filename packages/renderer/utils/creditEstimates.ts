import {
  CHARS_PER_TOKEN,
  CREDITS_PER_1K_TOKENS_COMPLETION,
  CREDITS_PER_1K_TOKENS_PROMPT,
  PREVIEW_TTS_CREDITS,
  CREDITS_PER_TRANSLATION_AUDIO_HOUR,
  CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR,
  SUMMARY_INPUT_TOKENS_PER_AUDIO_HOUR,
  SUMMARY_OUTPUT_TOKEN_RATIO,
  SUMMARY_OUTPUT_TOKENS_PER_AUDIO_HOUR,
  SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER,
  SUMMARY_QUALITY_MULTIPLIER,
  STAGE5_TTS_MODEL_ELEVEN_V3,
  STAGE5_TTS_MODEL_STANDARD,
  TTS_CREDITS_PER_MINUTE,
  TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER,
  TRANSLATION_QUALITY_MULTIPLIER,
  estimateTtsCredits,
  getTtsCreditsPerCharacter,
} from '../../shared/constants';

export { PREVIEW_TTS_CREDITS };

export type SummaryEffortLevel = 'standard' | 'high';
export type TtsProvider = 'openai' | 'elevenlabs';

export const TTS_CREDITS_PER_CHAR: Record<TtsProvider, number> = {
  openai: getTtsCreditsPerCharacter(STAGE5_TTS_MODEL_STANDARD),
  elevenlabs: getTtsCreditsPerCharacter(STAGE5_TTS_MODEL_ELEVEN_V3),
};

function normalizeKnownCredits(credits: number | null): number | null {
  if (typeof credits !== 'number' || !Number.isFinite(credits)) return null;
  return Math.max(0, credits);
}

/**
 * Calculate how many hours of video can be translated with given credits
 */
export function estimateTranslatableHours(
  credits: number | null,
  qualityEnabled: boolean
): number | null {
  const safeCredits = normalizeKnownCredits(credits);
  if (safeCredits === null) return null;
  const multiplier = qualityEnabled ? TRANSLATION_QUALITY_MULTIPLIER : 1;
  return safeCredits / (CREDITS_PER_TRANSLATION_AUDIO_HOUR * multiplier);
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
  provider: TtsProvider
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
      ? CREDITS_PER_SUMMARY_AUDIO_HOUR * SUMMARY_QUALITY_MULTIPLIER
      : CREDITS_PER_SUMMARY_AUDIO_HOUR;
  return safeCredits / creditsPerHour;
}

export function estimateTranslationCreditsFromChars(
  charCount: number,
  qualityEnabled: boolean
): number {
  const safeCharCount = Math.max(0, Math.ceil(charCount || 0));
  if (safeCharCount === 0) return 0;
  const inputTokens = Math.ceil(safeCharCount / CHARS_PER_TOKEN);
  const outputTokens = inputTokens;
  const baseCredits = Math.ceil(
    (inputTokens / 1000) * CREDITS_PER_1K_TOKENS_PROMPT +
      (outputTokens / 1000) * CREDITS_PER_1K_TOKENS_COMPLETION
  );
  const withReviewOverhead = Math.ceil(
    baseCredits * TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER
  );
  return qualityEnabled
    ? Math.ceil(withReviewOverhead * TRANSLATION_QUALITY_MULTIPLIER)
    : withReviewOverhead;
}

const BASE_CREDITS_PER_SUMMARY_AUDIO_HOUR = Math.ceil(
  (SUMMARY_INPUT_TOKENS_PER_AUDIO_HOUR / 1000) * CREDITS_PER_1K_TOKENS_PROMPT +
    (SUMMARY_OUTPUT_TOKENS_PER_AUDIO_HOUR / 1000) *
      CREDITS_PER_1K_TOKENS_COMPLETION
);

export const CREDITS_PER_SUMMARY_AUDIO_HOUR = Math.ceil(
  BASE_CREDITS_PER_SUMMARY_AUDIO_HOUR * SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER
);

export function estimateSummaryCreditsFromChars(
  charCount: number,
  effortLevel: SummaryEffortLevel
): number {
  const safeCharCount = Math.max(0, Math.ceil(charCount || 0));
  if (safeCharCount === 0) return 0;
  const inputTokens = Math.ceil(safeCharCount / CHARS_PER_TOKEN);
  const outputTokens = Math.ceil(inputTokens * SUMMARY_OUTPUT_TOKEN_RATIO);
  const baseCredits = Math.ceil(
    (inputTokens / 1000) * CREDITS_PER_1K_TOKENS_PROMPT +
      (outputTokens / 1000) * CREDITS_PER_1K_TOKENS_COMPLETION
  );
  const withPipelineOverhead = Math.ceil(
    baseCredits * SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER
  );
  return effortLevel === 'high'
    ? Math.ceil(withPipelineOverhead * SUMMARY_QUALITY_MULTIPLIER)
    : withPipelineOverhead;
}

export function estimateDubbingCreditsFromChars(
  charCount: number,
  provider: TtsProvider
): number {
  const safeCharCount = Math.max(0, Math.ceil(charCount || 0));
  if (safeCharCount === 0) return 0;
  return estimateTtsCredits({
    characters: safeCharCount,
    model:
      provider === 'elevenlabs'
        ? STAGE5_TTS_MODEL_ELEVEN_V3
        : STAGE5_TTS_MODEL_STANDARD,
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
export function formatCredits(credits: number): string {
  if (credits < 1000) return `~${Math.ceil(credits)}`;
  if (credits < 10000) return `~${(credits / 1000).toFixed(1)}k`;
  return `~${Math.round(credits / 1000)}k`;
}

export function formatDubbingTime(
  credits: number,
  provider: TtsProvider
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
