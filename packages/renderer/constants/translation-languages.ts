export interface TranslationLanguageOption {
  value: string;
  labelKey: string;
}

// Centralized list of target translation languages used across the app.
// Values match what we pass to the translation pipeline (human-readable tokens),
// and labelKey maps to i18n entries in locales (languages.*).
export const TRANSLATION_LANGUAGES: TranslationLanguageOption[] = [
  { value: 'english', labelKey: 'languages.english' },
  { value: 'korean', labelKey: 'languages.korean' },
  { value: 'japanese', labelKey: 'languages.japanese' },
  { value: 'chinese_simplified', labelKey: 'languages.chinese_simplified' },
  { value: 'chinese_traditional', labelKey: 'languages.chinese_traditional' },
  { value: 'vietnamese', labelKey: 'languages.vietnamese' },
  { value: 'spanish', labelKey: 'languages.spanish' },
  { value: 'french', labelKey: 'languages.french' },
  { value: 'german', labelKey: 'languages.german' },
  { value: 'italian', labelKey: 'languages.italian' },
  { value: 'portuguese', labelKey: 'languages.portuguese' },
  { value: 'russian', labelKey: 'languages.russian' },
  { value: 'dutch', labelKey: 'languages.dutch' },
  { value: 'polish', labelKey: 'languages.polish' },
  { value: 'swedish', labelKey: 'languages.swedish' },
  { value: 'turkish', labelKey: 'languages.turkish' },
  { value: 'norwegian', labelKey: 'languages.norwegian' },
  { value: 'danish', labelKey: 'languages.danish' },
  { value: 'finnish', labelKey: 'languages.finnish' },
  { value: 'greek', labelKey: 'languages.greek' },
  { value: 'czech', labelKey: 'languages.czech' },
  { value: 'hungarian', labelKey: 'languages.hungarian' },
  { value: 'romanian', labelKey: 'languages.romanian' },
  { value: 'ukrainian', labelKey: 'languages.ukrainian' },
  { value: 'hindi', labelKey: 'languages.hindi' },
  { value: 'indonesian', labelKey: 'languages.indonesian' },
  { value: 'thai', labelKey: 'languages.thai' },
  { value: 'malay', labelKey: 'languages.malay' },
  { value: 'tagalog', labelKey: 'languages.tagalog' },
  { value: 'bengali', labelKey: 'languages.bengali' },
  { value: 'tamil', labelKey: 'languages.tamil' },
  { value: 'telugu', labelKey: 'languages.telugu' },
  { value: 'marathi', labelKey: 'languages.marathi' },
  { value: 'urdu', labelKey: 'languages.urdu' },
  { value: 'arabic', labelKey: 'languages.arabic' },
  { value: 'hebrew', labelKey: 'languages.hebrew' },
  { value: 'farsi', labelKey: 'languages.farsi' },
  { value: 'swahili', labelKey: 'languages.swahili' },
  { value: 'afrikaans', labelKey: 'languages.afrikaans' },
];

