import Store from 'electron-store';

export type AppSettingsSchema = {
  app_language_preference: string;
  subtitleTargetLanguage: string;
  apiKey: string | null;
  anthropicApiKey: string | null;
  elevenLabsApiKey: string | null;
  videoPlaybackPositions: Record<string, number>;
  byoOpenAiUnlocked: boolean;
  byoAnthropicUnlocked: boolean;
  byoElevenLabsUnlocked: boolean;
  useByoOpenAi: boolean;
  useByoAnthropic: boolean;
  useByoElevenLabs: boolean;
  useByoMaster: boolean;
  preferClaudeTranslation: boolean;
  preferClaudeReview: boolean;
  preferClaudeSummary: boolean;
  preferredTranscriptionProvider: 'elevenlabs' | 'openai' | 'stage5';
  preferredDubbingProvider: 'elevenlabs' | 'openai' | 'stage5';
  stage5DubbingTtsProvider: 'openai' | 'elevenlabs';
};

export type SettingsStoreType = Store<AppSettingsSchema>;

export const settingsStore: SettingsStoreType = new Store<AppSettingsSchema>({
  name: 'app-settings',
  defaults: {
    app_language_preference: 'en',
    subtitleTargetLanguage: 'original',
    apiKey: null,
    anthropicApiKey: null,
    elevenLabsApiKey: null,
    videoPlaybackPositions: {},
    byoOpenAiUnlocked: false,
    byoAnthropicUnlocked: false,
    byoElevenLabsUnlocked: false,
    useByoOpenAi: false,
    useByoAnthropic: false,
    useByoElevenLabs: false,
    useByoMaster: false, // Default false - user must explicitly enable after entering keys
    preferClaudeTranslation: false,
    preferClaudeReview: true, // Default true for higher quality
    preferClaudeSummary: true, // Default true for higher quality
    preferredTranscriptionProvider: 'elevenlabs',
    preferredDubbingProvider: 'openai', // Default to OpenAI TTS (cheaper than ElevenLabs)
    stage5DubbingTtsProvider: 'openai', // Default to OpenAI for cost efficiency
  },
});
