export const AI_MODELS = {
  GPT: 'gpt-5.1',
  CLAUDE_SONNET: 'claude-sonnet-4-5-20250929',
  CLAUDE_OPUS: 'claude-opus-4-6',
  WHISPER: 'whisper-1',
} as const;

const AI_MODEL_ALIASES: Record<string, string> = {
  'claude-opus-4.6': AI_MODELS.CLAUDE_OPUS,
};

export function normalizeAiModelId(model?: string): string {
  const trimmed = (model || '').trim();
  if (!trimmed) return AI_MODELS.GPT;
  return AI_MODEL_ALIASES[trimmed.toLowerCase()] || trimmed;
}

export { ENABLE_VOICE_CLONING } from './features';

/** User-friendly display names for AI models */
export const AI_MODEL_DISPLAY_NAMES: Record<string, string> = {
  [AI_MODELS.GPT]: 'GPT-5.1',
  [AI_MODELS.CLAUDE_SONNET]: 'Claude Sonnet',
  [AI_MODELS.CLAUDE_OPUS]: 'Claude Opus',
  [AI_MODELS.WHISPER]: 'Whisper',
};

// Error codes used across the application
export const ERROR_CODES = {
  INSUFFICIENT_CREDITS: 'insufficient-credits',
  INSUFFICIENT_DISK_SPACE: 'insufficient-disk-space',
  OPENAI_KEY_INVALID: 'openai-key-invalid',
  OPENAI_RATE_LIMIT: 'openai-rate-limit',
  OPENAI_INSUFFICIENT_QUOTA: 'openai-insufficient-quota',
  ANTHROPIC_KEY_INVALID: 'anthropic-key-invalid',
  ANTHROPIC_RATE_LIMIT: 'anthropic-rate-limit',
  ANTHROPIC_INSUFFICIENT_QUOTA: 'anthropic-insufficient-quota',
  ELEVENLABS_KEY_INVALID: 'elevenlabs-key-invalid',
  ELEVENLABS_RATE_LIMIT: 'elevenlabs-rate-limit',
  ELEVENLABS_INSUFFICIENT_QUOTA: 'elevenlabs-insufficient-quota',
  TRANSLATION_JOB_NOT_FOUND: 'translation-job-not-found',
} as const;

export const colors = {
  primary: '#4361ee',
  primaryLight: '#4895ef',
  primaryDark: '#3a0ca3',
  secondary: '#3f37c9',
  // Use a deeper, more neutral green for success actions
  success: '#28a745',
  info: '#4895ef',
  warning: '#f72585',
  danger: '#e63946',
  light: '#f8f9fa',
  dark: '#212529',
  gray: '#6c757d',
  grayLight: '#f1f3f5',
  grayDark: '#343a40',
  white: '#ffffff',
  border: '#dee2e6',
};

export const languages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ru', name: 'Russian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
];

// Credit system constants (computed below using model pricing)

// Translation pricing estimate (client-side mirror of backend pricing)
// USD per credit based on $10 -> 350,000 credits
export const USD_PER_CREDIT = 10 / 350_000;
// Match backend pricing margin
export const PRICE_MARGIN = 2;

// GPT-5.1 tokenizer costs (USD per token) - used for UI credit estimates
const GPT5_1_USD_PER_TOKEN_IN = 1.25 / 1_000_000; // $1.25 / 1M
const GPT5_1_USD_PER_TOKEN_OUT = 10 / 1_000_000; // $10.00 / 1M

// Credits per 1k tokens (estimated)
// Calibration factor (1.0 = no adjustment)
export const TOKEN_CREDIT_CALIBRATION_UI = 1.0;
export const CREDITS_PER_1K_TOKENS_PROMPT = Math.ceil(
  ((PRICE_MARGIN * 1000 * GPT5_1_USD_PER_TOKEN_IN) / USD_PER_CREDIT) *
    TOKEN_CREDIT_CALIBRATION_UI
); // ≈ 88 with current pricing
export const CREDITS_PER_1K_TOKENS_COMPLETION = Math.ceil(
  ((PRICE_MARGIN * 1000 * GPT5_1_USD_PER_TOKEN_OUT) / USD_PER_CREDIT) *
    TOKEN_CREDIT_CALIBRATION_UI
); // ≈ 700 with current pricing

// Estimated tokens produced per 1 hour of audio transcript (prompt ~= completion)
// Tweakable after measurement; 16k strikes a practical balance across languages.
export const TRANSLATION_TOKENS_PER_AUDIO_HOUR_PROMPT = 16_000;
export const TRANSLATION_TOKENS_PER_AUDIO_HOUR_COMPLETION = 16_000;

// Credits required to translate 1 hour of audio-equivalent text (prompt + completion)
const BASE_CREDITS_PER_TRANSLATION_AUDIO_HOUR = Math.ceil(
  (TRANSLATION_TOKENS_PER_AUDIO_HOUR_PROMPT / 1000) *
    CREDITS_PER_1K_TOKENS_PROMPT +
    (TRANSLATION_TOKENS_PER_AUDIO_HOUR_COMPLETION / 1000) *
      CREDITS_PER_1K_TOKENS_COMPLETION
);

export const TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER = 1.5;
export const TRANSLATION_QUALITY_MULTIPLIER = 5;
export const SUMMARY_QUALITY_MULTIPLIER = 4;

// Summary pipeline overhead multiplier.
// Stage5 summary runs multiple model calls per chunk:
// 1) summarizeChunk, 2) mergeIntoRunningSummary, 3) proposeHighlightsForChunk.
// This approximates the extra credit spend vs a single-pass summary estimate.
export const SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER = 3;

// TTS credits per minute (based on ~750 chars/min * credits/char)
// OpenAI: 1.05 credits/char * 750 = ~788 credits/min
// ElevenLabs: 14 credits/char * 750 = ~10,500 credits/min
export const TTS_CREDITS_PER_MINUTE = {
  openai: 788,
  elevenlabs: 10500,
} as const;

// API polling intervals and timeouts (in milliseconds)
// Used for long-running operations that require polling for completion
export const API_TIMEOUTS = {
  // Transcription (Whisper via Stage5 API)
  TRANSCRIPTION_POLL_INTERVAL: 1_000, // 1 second
  TRANSCRIPTION_MAX_WAIT: 300_000, // 5 minutes

  // Translation (GPT/Claude via Stage5 API)
  TRANSLATION_POLL_INTERVAL: 2_000, // 2 seconds
  TRANSLATION_MAX_WAIT: 600_000, // 10 minutes

  // Voice cloning (ElevenLabs Dubbing API)
  VOICE_CLONING_POLL_INTERVAL: 5_000, // 5 seconds
  VOICE_CLONING_BASE_MAX_WAIT: 600_000, // 10 minutes minimum

  // Credit balance refresh after payment
  CREDIT_REFRESH_RETRY_DELAY: 2_000, // 2 seconds between retries
  CREDIT_REFRESH_MAX_RETRIES: 3,
} as const;

export const CREDITS_PER_TRANSLATION_AUDIO_HOUR = Math.ceil(
  BASE_CREDITS_PER_TRANSLATION_AUDIO_HOUR *
    TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER
);

// Credits per audio hour (unified for transcription + translation)
export const CREDITS_PER_AUDIO_HOUR = CREDITS_PER_TRANSLATION_AUDIO_HOUR;
export const CREDITS_PER_AUDIO_SECOND = CREDITS_PER_AUDIO_HOUR / 3_600;

// Transcription pricing aligned with non-HQ translation rate
export const CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR =
  CREDITS_PER_TRANSLATION_AUDIO_HOUR;

const MICRO_CREDITS = 15_000; // $1 entry pack
const STARTER_CREDITS = 150_000;
const STANDARD_CREDITS = 350_000;
const PRO_CREDITS = 2_400_000;

export const CREDIT_PACKS = {
  MICRO: {
    id: 'MICRO' as const,
    price: 1,
    hours: MICRO_CREDITS / CREDITS_PER_AUDIO_HOUR,
    credits: MICRO_CREDITS,
  },
  STARTER: {
    id: 'STARTER' as const,
    price: 5,
    hours: STARTER_CREDITS / CREDITS_PER_AUDIO_HOUR,
    credits: STARTER_CREDITS,
  },
  STANDARD: {
    id: 'STANDARD' as const,
    price: 10,
    hours: STANDARD_CREDITS / CREDITS_PER_AUDIO_HOUR,
    credits: STANDARD_CREDITS,
  },
  PRO: {
    id: 'PRO' as const,
    price: 50,
    hours: PRO_CREDITS / CREDITS_PER_AUDIO_HOUR,
    credits: PRO_CREDITS,
  },
} as const;

// Re-export from runtime-config for backward compatibility
export {
  BASELINE_HEIGHT,
  BASELINE_FONT_SIZE,
  MIN_VIDEO_HEIGHT,
  MIN_FONT_SCALE,
  MAX_FONT_SCALE,
  DEBOUNCE_DELAY_MS,
  DEFAULT_FILENAME,
  fontScale,
} from './runtime-config';
