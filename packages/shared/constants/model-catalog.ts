export const AI_MODELS = {
  GPT: 'gpt-5.1',
  CLAUDE_SONNET: 'claude-sonnet-4-6',
  CLAUDE_OPUS: 'claude-opus-4-7',
  WHISPER: 'whisper-1',
} as const;

export const STAGE5_REVIEW_TRANSLATION_MODEL = 'gpt-5.4';
export const STAGE5_WHISPER_MODEL = AI_MODELS.WHISPER;
export const STAGE5_ELEVENLABS_SCRIBE_MODEL = 'elevenlabs-scribe';
export const STAGE5_TTS_MODEL_STANDARD = 'tts-1';
export const STAGE5_TTS_MODEL_HD = 'tts-1-hd';
export const STAGE5_TTS_MODEL_ELEVEN_V3 = 'eleven_v3';
export const STAGE5_TTS_MODEL_ELEVEN_TURBO = 'eleven_turbo_v2_5';

export type Stage5ReviewProvider = 'openai' | 'anthropic';

export const STAGE5_REVIEW_PROVIDER_OPTIONS = {
  openai: {
    provider: 'openai',
    model: STAGE5_REVIEW_TRANSLATION_MODEL,
    exactModelLabel: 'GPT-5.4',
  },
  anthropic: {
    provider: 'anthropic',
    model: AI_MODELS.CLAUDE_OPUS,
    exactModelLabel: 'Claude Opus 4.7',
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
  'claude-sonnet-4-5-20250929': AI_MODELS.CLAUDE_SONNET,
  'claude-sonnet-4-5': AI_MODELS.CLAUDE_SONNET,
  'claude-sonnet-4.6': AI_MODELS.CLAUDE_SONNET,
  // Legacy Opus 4.6 values from saved settings normalize to current Opus.
  'claude-opus-4-6': AI_MODELS.CLAUDE_OPUS,
  'claude-opus-4.6': AI_MODELS.CLAUDE_OPUS,
  'claude-opus-4.7': AI_MODELS.CLAUDE_OPUS,
};

export const STAGE5_TRANSLATION_MODEL_PRICING = {
  [AI_MODELS.GPT]: {
    in: 1.25 / 1_000_000,
    out: 10 / 1_000_000,
  },
  [STAGE5_REVIEW_TRANSLATION_MODEL]: {
    in: 2.5 / 1_000_000,
    out: 15 / 1_000_000,
  },
  [AI_MODELS.CLAUDE_OPUS]: {
    in: 5 / 1_000_000,
    out: 25 / 1_000_000,
  },
} as const;

export const STAGE5_TRANSCRIPTION_MODEL_PRICING = {
  [STAGE5_WHISPER_MODEL]: {
    perSecond: 0.006 / 60,
  },
  [STAGE5_ELEVENLABS_SCRIBE_MODEL]: {
    perSecond: 0.4 / 3600,
  },
} as const;

export const STAGE5_TTS_MODEL_PRICING = {
  [STAGE5_TTS_MODEL_STANDARD]: {
    perChar: 15 / 1_000_000,
  },
  [STAGE5_TTS_MODEL_HD]: {
    perChar: 30 / 1_000_000,
  },
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
