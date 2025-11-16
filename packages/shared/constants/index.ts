export const AI_MODELS = {
  GPT: 'gpt-5.1',
  WHISPER: 'whisper-1',
} as const;

export const subtitleVideoPlayer = {
  instance: null as any,
  isReady: false,
};

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

// GPT-5.1 tokenizer costs (USD per token)
export const GPT5_1_USD_PER_TOKEN_IN = 2 / 1_000_000; // $0.002 / 1M
export const GPT5_1_USD_PER_TOKEN_OUT = 8 / 1_000_000; // $0.008 / 1M

// Credits per 1k tokens (estimated)
// Apply backend token calibration to align with actual deduction
export const TOKEN_CREDIT_CALIBRATION_UI = 0.7;
export const CREDITS_PER_1K_TOKENS_PROMPT = Math.ceil(
  ((PRICE_MARGIN * 1000 * GPT5_1_USD_PER_TOKEN_IN) / USD_PER_CREDIT) *
    TOKEN_CREDIT_CALIBRATION_UI
); // ≈ 98 when PRICE_MARGIN=2, calibration=0.7
export const CREDITS_PER_1K_TOKENS_COMPLETION = Math.ceil(
  ((PRICE_MARGIN * 1000 * GPT5_1_USD_PER_TOKEN_OUT) / USD_PER_CREDIT) *
    TOKEN_CREDIT_CALIBRATION_UI
); // ≈ 392 when PRICE_MARGIN=2, calibration=0.7

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

export const TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER = 3.06; // was 1.8

export const CREDITS_PER_TRANSLATION_AUDIO_HOUR = Math.ceil(
  BASE_CREDITS_PER_TRANSLATION_AUDIO_HOUR *
    TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER
);

// Transcription: compute credits/hour from model USD rate with margin and calibration
export const WHISPER_TURBO_USD_PER_HOUR = 0.04; // groq whisper-large-v3-turbo
// Align transcription credits/hour with backend deduction for whisper-large-v3-turbo
// Backend math: $0.04/h × margin(2) = $0.08/h; $0.08 / (10/350k) = 2,800 credits/hour
// Historical transcription estimate kept for reference only.
// We now unify hour estimation with translation.
export const CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR =
  CREDITS_PER_TRANSLATION_AUDIO_HOUR;

// Set the generic credits/hour constant used across UI to the translation-based estimate
export const CREDITS_PER_AUDIO_HOUR = CREDITS_PER_TRANSLATION_AUDIO_HOUR;
export const CREDITS_PER_AUDIO_SECOND = CREDITS_PER_AUDIO_HOUR / 3_600;

// Keep a single source of truth for "new pricing" as well
export const NEW_CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR =
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
