export const AI_MODELS = {
  GPT: 'gpt-4.1',
  WHISPER: { id: 'whisper-1' },
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
  success: '#4cc9f0',
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

// Credit system constants
export const CREDITS_PER_AUDIO_HOUR = 100_000;
export const CREDITS_PER_AUDIO_SECOND = CREDITS_PER_AUDIO_HOUR / 3_600;

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
