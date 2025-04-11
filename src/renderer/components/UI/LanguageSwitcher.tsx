import React, { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../../i18n.js';
import { selectStyles } from '../../styles.js';

interface LanguageOption {
  value: string;
  label: string;
}

interface LanguageGroup {
  label: string;
  options: LanguageOption[];
}

const languageGroups: LanguageGroup[] = [
  {
    label: 'regions.eastAsia',
    options: [
      { value: 'ko', label: 'languages.korean' },
      { value: 'ja', label: 'languages.japanese' },
      { value: 'zh-CN', label: 'languages.chinese_simplified' },
      { value: 'zh-TW', label: 'languages.chinese_traditional' },
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

const baseLanguageOptions: LanguageOption[] = [
  { value: 'en', label: 'languages.english' },
];

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [currentLanguage, setCurrentLanguage] = useState(i18n.language || 'en');

  useEffect(() => {
    // Update the state when the language changes
    setCurrentLanguage(i18n.language);
  }, [i18n.language]);

  const handleLanguageChange = async (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedLanguage = e.target.value;
    await changeLanguage(selectedLanguage);
    setCurrentLanguage(selectedLanguage);
  };

  return (
    <div
      className={css`
        margin: 10px 0;
        display: flex;
        align-items: center;
      `}
    >
      <select
        value={currentLanguage}
        onChange={handleLanguageChange}
        className={selectStyles}
      >
        {baseLanguageOptions.map(lang => {
          const translatedLabel = t(lang.label);
          console.log(
            `[Switcher] Base lang ${lang.value} (${lang.label}) -> ${translatedLabel}`
          );
          return (
            <option key={lang.value} value={lang.value}>
              {translatedLabel}
            </option>
          );
        })}
        {/* Render grouped options */}
        {languageGroups.map(group => {
          const translatedGroupLabel = t(group.label);
          console.log(
            `[Switcher] Group ${group.label} -> ${translatedGroupLabel}`
          );
          return (
            <optgroup key={group.label} label={translatedGroupLabel}>
              {group.options.map(lang => {
                const translatedLabel = t(lang.label);
                console.log(
                  `[Switcher] Lang ${lang.value} (${lang.label}) -> ${translatedLabel}`
                );
                return (
                  <option key={lang.value} value={lang.value}>
                    {translatedLabel}
                  </option>
                );
              })}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}
