import { nativeLanguageName } from './translation-language-native-names.js';

// The UI languages the app ships, grouped the way the switcher lists them.
export interface LanguageOption {
  value: string;
  /** i18n key of the language name, e.g. languages.korean. */
  label: string;
}

export interface LanguageGroup {
  label: string;
  options: LanguageOption[];
}

export const languageGroups: LanguageGroup[] = [
  {
    label: 'regions.eastAsia',
    options: [
      { value: 'ko', label: 'languages.korean' },
      { value: 'ja', label: 'languages.japanese' },
      {
        value: 'zh-CN',
        label: 'languages.chinese_simplified',
      },
      {
        value: 'zh-TW',
        label: 'languages.chinese_traditional',
      },
      { value: 'vi', label: 'languages.vietnamese' },
    ],
  },
  {
    label: 'regions.europe',
    options: [
      { value: 'es', label: 'languages.spanish' },
      { value: 'fr', label: 'languages.french' },
      { value: 'de', label: 'languages.german' },
      { value: 'it', label: 'languages.italian' },
      { value: 'pt', label: 'languages.portuguese' },
      { value: 'ru', label: 'languages.russian' },
      { value: 'nl', label: 'languages.dutch' },
      { value: 'pl', label: 'languages.polish' },
      { value: 'sv', label: 'languages.swedish' },
      { value: 'tr', label: 'languages.turkish' },
      { value: 'no', label: 'languages.norwegian' },
      { value: 'da', label: 'languages.danish' },
      { value: 'fi', label: 'languages.finnish' },
      { value: 'el', label: 'languages.greek' },
      { value: 'cs', label: 'languages.czech' },
      { value: 'hu', label: 'languages.hungarian' },
      { value: 'ro', label: 'languages.romanian' },
      { value: 'uk', label: 'languages.ukrainian' },
    ],
  },
  {
    label: 'regions.southSoutheastAsia',
    options: [
      { value: 'hi', label: 'languages.hindi' },
      { value: 'id', label: 'languages.indonesian' },
      { value: 'th', label: 'languages.thai' },
      { value: 'ms', label: 'languages.malay' },
      { value: 'tl', label: 'languages.tagalog' },
      { value: 'bn', label: 'languages.bengali' },
      { value: 'ta', label: 'languages.tamil' },
      { value: 'te', label: 'languages.telugu' },
      { value: 'mr', label: 'languages.marathi' },
      { value: 'ur', label: 'languages.urdu' },
    ],
  },
  {
    label: 'regions.middleEastAfrica',
    options: [
      { value: 'ar', label: 'languages.arabic' },
      { value: 'he', label: 'languages.hebrew' },
      { value: 'fa', label: 'languages.farsi' },
      { value: 'sw', label: 'languages.swahili' },
      { value: 'af', label: 'languages.afrikaans' },
    ],
  },
];

export const baseLanguageOptions: LanguageOption[] = [
  { value: 'en', label: 'languages.english' },
];

/** "languages.korean" → "한국어": every language in its own script. */
export function uiLanguageEndonym(
  option: Pick<LanguageOption, 'label'>
): string {
  return nativeLanguageName(option.label.replace(/^languages\./, ''));
}

export function allUiLanguageOptions(): LanguageOption[] {
  return [
    ...baseLanguageOptions,
    ...languageGroups.flatMap(group => group.options),
  ];
}
