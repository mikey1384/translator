export const AI_MODELS = {
  // OpenAI model for API-key users (gpt-5.1 is removed from the API on
  // 2027-04-01; OpenAI names gpt-6-sol as its replacement).
  GPT: 'gpt-6.1-sol',
  CLAUDE_SONNET: 'claude-sonnet-5-5',
  CLAUDE_OPUS: 'claude-opus-5-5',
  CLAUDE_HAIKU: 'claude-haiku-5-5',
} as const;

// GPT high tier for API-key users (and the Stage5 fallback when Anthropic is
// unavailable). Not deprecated; moving it to GPT-6 is a separate change.
export const STAGE5_REVIEW_TRANSLATION_MODEL = 'gpt-5.5';

/**
 * Models Stage5 credits run on (servers choose these for subtitles; these
 * constants keep the app's labels, estimates and explicit requests in step):
 * drafts on Haiku 5.5, review on Opus 5.5 (2026-10-13 trials), summaries and
 * video search on Sonnet 5.5 (standard) / Opus 5.5 (high).
 */
export const STAGE5_CREDIT_MODELS = {
  DRAFT: AI_MODELS.CLAUDE_HAIKU,
  REVIEW: AI_MODELS.CLAUDE_OPUS,
  STANDARD: AI_MODELS.CLAUDE_SONNET,
  HIGH: AI_MODELS.CLAUDE_OPUS,
} as const;

/**
 * The model Stage5 should run for a model id the app was about to send. Stage5
 * credits serve Anthropic models, so GPT ids (from older saved settings or
 * code that defaults to "the GPT model") map to the Claude model at the same
 * tier: the draft tier to Haiku 5.5, the high tier to Opus 5.5.
 */
export function toStage5CreditModel(model: string): string {
  const normalized = normalizeAiModelId(model);
  if (normalized.startsWith('claude-')) return normalized;
  if (
    normalized === STAGE5_REVIEW_TRANSLATION_MODEL ||
    normalized === 'gpt-5.4'
  ) {
    return STAGE5_CREDIT_MODELS.HIGH;
  }
  return STAGE5_CREDIT_MODELS.DRAFT;
}
export const STAGE5_ELEVENLABS_SCRIBE_MODEL = 'elevenlabs-scribe';
export const STAGE5_TTS_MODEL_ELEVEN_V3 = 'eleven_v3';
export const STAGE5_TTS_MODEL_ELEVEN_V4 = 'eleven_v4';
export const STAGE5_TTS_MODEL_ELEVEN_TURBO = 'eleven_turbo_v2_5';

export type Stage5ReviewProvider = 'openai' | 'anthropic';

export const STAGE5_REVIEW_PROVIDER_OPTIONS = {
  openai: {
    provider: 'openai',
    model: STAGE5_REVIEW_TRANSLATION_MODEL,
    exactModelLabel: 'GPT-5.5',
  },
  anthropic: {
    provider: 'anthropic',
    model: AI_MODELS.CLAUDE_OPUS,
    exactModelLabel: 'Claude Opus 5.5',
  },
} as const;

export type Stage5ReviewOption =
  (typeof STAGE5_REVIEW_PROVIDER_OPTIONS)[Stage5ReviewProvider];

export function getStage5ReviewProvider(
  prefersClaude: boolean
): Stage5ReviewProvider {
  return prefersClaude ? 'anthropic' : 'openai';
}

export function getStage5ReviewOption(
  provider: Stage5ReviewProvider
): Stage5ReviewOption {
  return STAGE5_REVIEW_PROVIDER_OPTIONS[provider];
}

export function getStage5ReviewOptionForPreference(
  prefersClaude: boolean
): Stage5ReviewOption {
  return getStage5ReviewOption(getStage5ReviewProvider(prefersClaude));
}

export const AI_MODEL_ALIASES: Record<string, string> = {
  // Legacy GPT-5.4 values from saved settings normalize to current GPT review.
  'gpt-5.4': STAGE5_REVIEW_TRANSLATION_MODEL,
  // GPT-5.1 (removed 2027-04-01) and older Claude ids from saved settings
  // normalize to the current model of the same tier.
  'gpt-5.1': AI_MODELS.GPT,
  'claude-sonnet-5': AI_MODELS.CLAUDE_SONNET,
  'claude-opus-4-8': AI_MODELS.CLAUDE_OPUS,
  'claude-sonnet-4-5-20250929': AI_MODELS.CLAUDE_SONNET,
  'claude-sonnet-4-5': AI_MODELS.CLAUDE_SONNET,
  'claude-sonnet-4.6': AI_MODELS.CLAUDE_SONNET,
  // Legacy Sonnet values from saved settings normalize to current Sonnet.
  'claude-sonnet-4-6': AI_MODELS.CLAUDE_SONNET,
  // Legacy Opus values from saved settings normalize to current Opus.
  'claude-opus-4-6': AI_MODELS.CLAUDE_OPUS,
  'claude-opus-4.6': AI_MODELS.CLAUDE_OPUS,
  'claude-opus-4-7': AI_MODELS.CLAUDE_OPUS,
  'claude-opus-4.7': AI_MODELS.CLAUDE_OPUS,
  'claude-opus-4.8': AI_MODELS.CLAUDE_OPUS,
};

export const STAGE5_TRANSLATION_MODEL_PRICING = {
  [AI_MODELS.GPT]: {
    in: 2 / 1_000_000,
    out: 10 / 1_000_000,
  },
  [STAGE5_REVIEW_TRANSLATION_MODEL]: {
    in: 5 / 1_000_000,
    out: 30 / 1_000_000,
  },
  [AI_MODELS.CLAUDE_SONNET]: {
    in: 2 / 1_000_000,
    out: 10 / 1_000_000,
  },
  [AI_MODELS.CLAUDE_OPUS]: {
    in: 4 / 1_000_000,
    out: 20 / 1_000_000,
  },
  [AI_MODELS.CLAUDE_HAIKU]: {
    in: 0.1 / 1_000_000,
    out: 0.5 / 1_000_000,
  },
} as const;

// Transcription is ElevenLabs Scribe only (OpenAI whisper-1 retires
// 2027-02-26 and its replacement returns no timestamps).
export const STAGE5_TRANSCRIPTION_MODEL_PRICING = {
  [STAGE5_ELEVENLABS_SCRIBE_MODEL]: {
    perSecond: 0.4 / 3600,
  },
} as const;

// Dubbing is ElevenLabs-only (OpenAI tts-1/tts-1-hd retire 2027-01-06).
export const STAGE5_TTS_MODEL_PRICING = {
  // Standard rate, deliberately independent of the temporary launch promotion.
  [STAGE5_TTS_MODEL_ELEVEN_V4]: { perChar: 80 / 1_000_000 },
  [STAGE5_TTS_MODEL_ELEVEN_V3]: {
    perChar: 180 / 1_000_000,
  },
  [STAGE5_TTS_MODEL_ELEVEN_TURBO]: {
    perChar: 90 / 1_000_000,
  },
} as const;

export type Stage5TranscriptionModelId =
  keyof typeof STAGE5_TRANSCRIPTION_MODEL_PRICING;
export type Stage5TtsModelId = keyof typeof STAGE5_TTS_MODEL_PRICING;

export function normalizeAiModelId(model?: string): string {
  const trimmed = (model || '').trim();
  if (!trimmed) return AI_MODELS.GPT;
  return AI_MODEL_ALIASES[trimmed.toLowerCase()] || trimmed;
}
