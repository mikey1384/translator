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

export const BASELINE_HEIGHT = 720;
export const BASELINE_FONT_SIZE = 30;
export const MIN_VIDEO_HEIGHT = 360;
export const MIN_FONT_SCALE = 0.5;
export const MAX_FONT_SCALE = 2.0;
export const DEBOUNCE_DELAY_MS = 300;
export const DEFAULT_FILENAME = 'edited_subtitles.srt';
export const STARTING_STAGE = 'Starting...';

export function fontScale(height: number): number {
  const effectiveHeight = Math.max(height, MIN_VIDEO_HEIGHT);
  return Math.min(
    Math.max(effectiveHeight / BASELINE_HEIGHT, MIN_FONT_SCALE),
    MAX_FONT_SCALE
  );
}
