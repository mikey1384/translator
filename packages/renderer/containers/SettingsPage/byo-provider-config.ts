import {
  AI_MODELS,
  SUMMARY_QUALITY_MULTIPLIER,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  estimateDubbingUsdPerHour,
  estimateSummaryUsdPerHour,
  estimateTranslationUsdPerHour,
  estimateTranscriptionUsdPerHour,
  estimateVideoSuggestionUsdPerSearch,
  type UsdRange,
} from '../../../shared/constants';

function formatUsd(usd: number): string {
  const rounded = usd >= 10 ? usd.toFixed(1) : usd.toFixed(2);
  return rounded.replace(/\.0$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatUsdEstimate(value: number | UsdRange, unit: '/hr' | '/search') {
  if (typeof value === 'number') {
    return `~$${formatUsd(value)}${unit}`;
  }
  return `~$${formatUsd(value.minUsd)}-$${formatUsd(value.maxUsd)}${unit}`;
}

const OPENAI_SUMMARY_STANDARD_USD = estimateSummaryUsdPerHour(AI_MODELS.GPT);
const OPENAI_SUMMARY_HIGH_USD =
  estimateSummaryUsdPerHour(STAGE5_REVIEW_TRANSLATION_MODEL) *
  SUMMARY_QUALITY_MULTIPLIER;
const ANTHROPIC_SUMMARY_STANDARD_USD = estimateSummaryUsdPerHour(
  AI_MODELS.CLAUDE_SONNET
);
const ANTHROPIC_SUMMARY_HIGH_USD =
  estimateSummaryUsdPerHour(AI_MODELS.CLAUDE_OPUS) * SUMMARY_QUALITY_MULTIPLIER;

export const BYO_PROVIDERS = {
  transcription: {
    openai: {
      labelKey: 'settings.byoPreferences.openaiWhisper',
      fallback: 'OpenAI Whisper',
      price: formatUsdEstimate(
        estimateTranscriptionUsdPerHour('openai'),
        '/hr'
      ),
    },
    elevenlabs: {
      labelKey: 'settings.byoPreferences.elevenLabsScribe',
      fallback: 'ElevenLabs Scribe',
      price: formatUsdEstimate(
        estimateTranscriptionUsdPerHour('elevenlabs'),
        '/hr'
      ),
    },
  },
  translationDraft: {
    openai: {
      labelKey: 'settings.byoPreferences.gpt',
      fallback: 'GPT-5.1',
      price: formatUsdEstimate(
        estimateTranslationUsdPerHour(AI_MODELS.GPT),
        '/hr'
      ),
    },
    anthropic: {
      labelKey: 'settings.byoPreferences.claudeSonnet',
      fallback: 'Claude Sonnet',
      price: formatUsdEstimate(
        estimateTranslationUsdPerHour(AI_MODELS.CLAUDE_SONNET),
        '/hr'
      ),
    },
  },
  review: {
    openai: {
      labelKey: 'settings.byoPreferences.openAiHighEnd',
      fallback: 'OpenAI high-end model',
      price: formatUsdEstimate(
        estimateTranslationUsdPerHour(STAGE5_REVIEW_TRANSLATION_MODEL),
        '/hr'
      ),
    },
    anthropic: {
      labelKey: 'settings.byoPreferences.anthropicHighEnd',
      fallback: 'Anthropic high-end model',
      price: formatUsdEstimate(
        estimateTranslationUsdPerHour(AI_MODELS.CLAUDE_OPUS),
        '/hr'
      ),
    },
  },
  summary: {
    standard: {
      openai: {
        labelKey: 'settings.byoPreferences.gpt',
        fallback: 'GPT-5.1',
        price: formatUsdEstimate(OPENAI_SUMMARY_STANDARD_USD, '/hr'),
      },
      anthropic: {
        labelKey: 'settings.byoPreferences.claudeSonnet',
        fallback: 'Claude Sonnet',
        price: formatUsdEstimate(ANTHROPIC_SUMMARY_STANDARD_USD, '/hr'),
      },
    },
    high: {
      openai: {
        labelKey: 'settings.byoPreferences.gptHigh',
        fallback: 'GPT-5.4',
        price: formatUsdEstimate(OPENAI_SUMMARY_HIGH_USD, '/hr'),
      },
      anthropic: {
        labelKey: 'settings.byoPreferences.claudeOpus',
        fallback: 'Claude Opus',
        price: formatUsdEstimate(ANTHROPIC_SUMMARY_HIGH_USD, '/hr'),
      },
    },
  },
  dubbing: {
    openai: {
      labelKey: 'settings.byoPreferences.openaiTts',
      fallback: 'OpenAI TTS',
      price: formatUsdEstimate(estimateDubbingUsdPerHour('openai'), '/hr'),
    },
    elevenlabs: {
      labelKey: 'settings.byoPreferences.elevenLabsTts',
      fallback: 'ElevenLabs',
      price: formatUsdEstimate(estimateDubbingUsdPerHour('elevenlabs'), '/hr'),
    },
  },
  videoSuggestion: {
    gpt: {
      labelKey: 'settings.byoPreferences.gpt',
      fallback: 'GPT-5.1',
      price: formatUsdEstimate(
        estimateVideoSuggestionUsdPerSearch(AI_MODELS.GPT),
        '/search'
      ),
    },
    gptHigh: {
      labelKey: 'settings.byoPreferences.gptHigh',
      fallback: 'GPT-5.4',
      price: formatUsdEstimate(
        estimateVideoSuggestionUsdPerSearch(STAGE5_REVIEW_TRANSLATION_MODEL),
        '/search'
      ),
    },
    sonnet: {
      labelKey: 'settings.byoPreferences.claudeSonnet',
      fallback: 'Claude Sonnet',
      price: formatUsdEstimate(
        estimateVideoSuggestionUsdPerSearch(AI_MODELS.CLAUDE_SONNET),
        '/search'
      ),
    },
    opus: {
      labelKey: 'settings.byoPreferences.claudeOpus',
      fallback: 'Claude Opus',
      price: formatUsdEstimate(
        estimateVideoSuggestionUsdPerSearch(AI_MODELS.CLAUDE_OPUS),
        '/search'
      ),
    },
  },
} as const;
