import type { i18n as I18nInstance, TFunction } from 'i18next';
import {
  AI_MODEL_DISPLAY_NAMES,
  AI_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  TTS_CREDITS_PER_MINUTE,
} from '../../../shared/constants';
import {
  formatDubbingTime as formatDubbingTimeFromEstimator,
  type TtsProvider,
} from '../../utils/creditEstimates';

export { TTS_CREDITS_PER_MINUTE };

export function formatDubbingTime(
  credits: number,
  provider: TtsProvider
): string {
  return formatDubbingTimeFromEstimator(credits, provider);
}

function getNestedTranslationValue(
  bundle: Record<string, unknown> | undefined,
  key: string
): string | null {
  const value = key
    .split('.')
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[part]
          : undefined,
      bundle
    );

  return typeof value === 'string' ? value : null;
}

function getCurrentTranslation(i18n: I18nInstance, key: string): string | null {
  const language = i18n.resolvedLanguage || i18n.language;
  const bundle = i18n.getResourceBundle(language, 'translation') as
    | Record<string, unknown>
    | undefined;

  return getNestedTranslationValue(bundle, key);
}

export function getLocalizedSettingCopy(
  i18n: I18nInstance,
  keys: string[],
  defaultValue: string
): string {
  for (const key of keys) {
    const value = getCurrentTranslation(i18n, key);
    if (value) {
      return value;
    }
  }

  return defaultValue;
}

export function getReviewPassLabel(t: TFunction, i18n: I18nInstance): string {
  return getLocalizedSettingCopy(
    i18n,
    ['settings.byoPreferences.reviewPass'],
    String(t('settings.byoPreferences.reviewPass', 'Review Pass'))
  );
}

export function getReviewProviderHeading(
  t: TFunction,
  i18n: I18nInstance
): string {
  return getLocalizedSettingCopy(
    i18n,
    ['settings.performanceQuality.qualityTranslation.reviewProvider'],
    getReviewPassLabel(t, i18n)
  );
}

export function getReviewProviderLabel(
  t: TFunction,
  i18n: I18nInstance,
  provider: 'openai' | 'anthropic'
): string {
  const providerName = provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const fallback = `${providerName} ${getReviewPassLabel(t, i18n)}`;
  const keys =
    provider === 'openai'
      ? [
          'settings.performanceQuality.qualityTranslation.openAiHighEnd',
          'settings.byoPreferences.openAiHighEnd',
        ]
      : [
          'settings.performanceQuality.qualityTranslation.anthropicHighEnd',
          'settings.byoPreferences.anthropicHighEnd',
        ];

  return getLocalizedSettingCopy(i18n, keys, fallback);
}

export function getQualityTranslationOnLabel(
  t: TFunction,
  i18n: I18nInstance,
  provider: 'openai' | 'anthropic'
): string {
  const openAiLabel = String(
    t(
      'settings.performanceQuality.qualityTranslation.modelOn',
      'Standard draft + OpenAI high-end review'
    )
  );

  if (provider === 'openai') {
    return openAiLabel;
  }

  const openAiReviewDisplayName =
    AI_MODEL_DISPLAY_NAMES[STAGE5_REVIEW_TRANSLATION_MODEL] ||
    STAGE5_REVIEW_TRANSLATION_MODEL;
  const fallback = openAiLabel
    .replace(
      openAiReviewDisplayName,
      AI_MODEL_DISPLAY_NAMES[AI_MODELS.CLAUDE_OPUS]
    )
    .replace(
      STAGE5_REVIEW_TRANSLATION_MODEL,
      AI_MODEL_DISPLAY_NAMES[AI_MODELS.CLAUDE_OPUS]
    )
    .replace('OpenAI', 'Anthropic');

  return getLocalizedSettingCopy(
    i18n,
    ['settings.performanceQuality.qualityTranslation.modelOnAnthropic'],
    fallback
  );
}
