import {
  CHARS_PER_TOKEN,
  SPOKEN_CHARS_PER_MINUTE,
  SUMMARY_INPUT_TOKENS_PER_AUDIO_HOUR,
  SUMMARY_OUTPUT_TOKENS_PER_AUDIO_HOUR,
  SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER,
  TRANSLATION_TOKENS_PER_AUDIO_HOUR_COMPLETION,
  TRANSLATION_TOKENS_PER_AUDIO_HOUR_PROMPT,
  VIDEO_SUGGESTION_COMPLETION_TOKENS_PER_SEARCH,
  VIDEO_SUGGESTION_PROMPT_TOKENS_PER_SEARCH,
  VIDEO_SUGGESTION_WEB_SEARCH_CALLS_PER_SEARCH,
} from './estimate-heuristics';
import {
  normalizeAiModelId,
  STAGE5_ELEVENLABS_SCRIBE_MODEL,
  STAGE5_TTS_MODEL_ELEVEN_V3,
  STAGE5_TTS_MODEL_STANDARD,
  STAGE5_WHISPER_MODEL,
} from './model-catalog';
import {
  ANTHROPIC_WEB_SEARCH_USD_PER_CALL,
  ELEVENLABS_PLAN_TIERS,
  OPENAI_WEB_SEARCH_USD_PER_CALL,
  VENDOR_TOKEN_MODEL_PRICING,
  VENDOR_TRANSCRIPTION_MODEL_PRICING,
  VENDOR_TTS_MODEL_PRICING,
  type VendorTokenModelId,
} from './vendor-pricing';

export type UsdRange = {
  minUsd: number;
  maxUsd: number;
};

function getVendorTokenModelPricing(model: string) {
  const normalized = normalizeAiModelId(model) as VendorTokenModelId;
  const pricing = VENDOR_TOKEN_MODEL_PRICING[normalized];
  if (!pricing) {
    throw new Error(`Unsupported vendor pricing model: ${model}`);
  }
  return pricing;
}

function toUsdRange(values: readonly number[]): UsdRange {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    minUsd: sorted[0] ?? 0,
    maxUsd: sorted[sorted.length - 1] ?? 0,
  };
}

export function estimateTokenModelUsd({
  promptTokens,
  completionTokens,
  model,
}: {
  promptTokens: number;
  completionTokens: number;
  model: string;
}): number {
  const pricing = getVendorTokenModelPricing(model);
  return promptTokens * pricing.in + completionTokens * pricing.out;
}

export function estimateTranslationUsdPerHour(model: string): number {
  return estimateTokenModelUsd({
    promptTokens: TRANSLATION_TOKENS_PER_AUDIO_HOUR_PROMPT,
    completionTokens: TRANSLATION_TOKENS_PER_AUDIO_HOUR_COMPLETION,
    model,
  });
}

export function estimateSummaryUsdPerHour(model: string): number {
  const baseUsd = estimateTokenModelUsd({
    promptTokens: SUMMARY_INPUT_TOKENS_PER_AUDIO_HOUR,
    completionTokens: SUMMARY_OUTPUT_TOKENS_PER_AUDIO_HOUR,
    model,
  });
  return baseUsd * SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER;
}

export function estimateTranscriptionUsdPerHour(
  provider: 'openai' | 'elevenlabs'
): number | UsdRange {
  if (provider === 'openai') {
    return (
      VENDOR_TRANSCRIPTION_MODEL_PRICING[STAGE5_WHISPER_MODEL].perSecond * 3600
    );
  }

  const hourlyValues = ELEVENLABS_PLAN_TIERS.map(
    tier =>
      VENDOR_TRANSCRIPTION_MODEL_PRICING[STAGE5_ELEVENLABS_SCRIBE_MODEL][tier] *
      3600
  );
  return toUsdRange(hourlyValues);
}

export function estimateDubbingUsdPerHour(
  provider: 'openai' | 'elevenlabs'
): number | UsdRange {
  const charsPerHour = SPOKEN_CHARS_PER_MINUTE * 60;

  if (provider === 'openai') {
    return (
      VENDOR_TTS_MODEL_PRICING[STAGE5_TTS_MODEL_STANDARD].perChar * charsPerHour
    );
  }

  const hourlyValues = ELEVENLABS_PLAN_TIERS.map(
    tier =>
      VENDOR_TTS_MODEL_PRICING[STAGE5_TTS_MODEL_ELEVEN_V3][tier] * charsPerHour
  );
  return toUsdRange(hourlyValues);
}

export function estimatePreviewUsd({
  characters,
  provider,
}: {
  characters: number;
  provider: 'openai' | 'elevenlabs';
}): number | UsdRange {
  const safeCharacters = Math.max(0, Math.ceil(Number(characters) || 0));
  if (provider === 'openai') {
    return (
      VENDOR_TTS_MODEL_PRICING[STAGE5_TTS_MODEL_STANDARD].perChar *
      safeCharacters
    );
  }

  const values = ELEVENLABS_PLAN_TIERS.map(
    tier =>
      VENDOR_TTS_MODEL_PRICING[STAGE5_TTS_MODEL_ELEVEN_V3][tier] *
      safeCharacters
  );
  return toUsdRange(values);
}

export function estimateVideoSuggestionUsdPerSearch(model: string): number {
  const normalized = normalizeAiModelId(model);
  const modelUsd = estimateTokenModelUsd({
    promptTokens: VIDEO_SUGGESTION_PROMPT_TOKENS_PER_SEARCH,
    completionTokens: VIDEO_SUGGESTION_COMPLETION_TOKENS_PER_SEARCH,
    model: normalized,
  });

  const webSearchUsd = normalized.startsWith('claude-')
    ? ANTHROPIC_WEB_SEARCH_USD_PER_CALL
    : OPENAI_WEB_SEARCH_USD_PER_CALL;

  return modelUsd + VIDEO_SUGGESTION_WEB_SEARCH_CALLS_PER_SEARCH * webSearchUsd;
}

export function estimateTranscriptCharsToTokens(charCount: number): number {
  return Math.ceil(Math.max(0, Math.ceil(charCount || 0)) / CHARS_PER_TOKEN);
}
