import { useState, useEffect, useRef } from 'react';
import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../../i18n.js';
import { selectStyles, colors } from '../../styles.js';

// Revert CountryFlag to always render an image
const CountryFlag = ({
  countryCode,
  style,
}: {
  countryCode: string;
  style?: React.CSSProperties;
}) => {
  const url = `https://cdnjs.cloudflare.com/ajax/libs/flag-icon-css/3.5.0/flags/4x3/${countryCode.toLowerCase()}.svg`;
  return (
    <img
      src={url}
      alt={`${countryCode} flag`}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        ...style,
      }}
    />
  );
};

interface LanguageOption {
  value: string;
  label: string;
  countryCode: string; // ISO 3166-1 alpha-2 country code for the flag
}

interface LanguageGroup {
  label: string;
  options: LanguageOption[];
}

const languageGroups: LanguageGroup[] = [
  {
    label: 'regions.eastAsia',
    options: [
      { value: 'ko', label: 'languages.korean', countryCode: 'KR' },
      { value: 'ja', label: 'languages.japanese', countryCode: 'JP' },
      {
        value: 'zh-CN',
        label: 'languages.chinese_simplified',
        countryCode: 'CN',
      },
      {
        value: 'zh-TW',
        label: 'languages.chinese_traditional',
        countryCode: 'TW',
      },
      { value: 'vi', label: 'languages.vietnamese', countryCode: 'VN' },
    ],
  },
  {
    label: 'regions.europe',
    options: [
      { value: 'es', label: 'languages.spanish', countryCode: 'ES' },
      { value: 'fr', label: 'languages.french', countryCode: 'FR' },
      { value: 'de', label: 'languages.german', countryCode: 'DE' },
      { value: 'it', label: 'languages.italian', countryCode: 'IT' },
      { value: 'pt', label: 'languages.portuguese', countryCode: 'PT' },
      { value: 'ru', label: 'languages.russian', countryCode: 'RU' },
      { value: 'nl', label: 'languages.dutch', countryCode: 'NL' },
      { value: 'pl', label: 'languages.polish', countryCode: 'PL' },
      { value: 'sv', label: 'languages.swedish', countryCode: 'SE' },
      { value: 'tr', label: 'languages.turkish', countryCode: 'TR' },
      { value: 'no', label: 'languages.norwegian', countryCode: 'NO' },
      { value: 'da', label: 'languages.danish', countryCode: 'DK' },
      { value: 'fi', label: 'languages.finnish', countryCode: 'FI' },
      { value: 'el', label: 'languages.greek', countryCode: 'GR' },
      { value: 'cs', label: 'languages.czech', countryCode: 'CZ' },
      { value: 'hu', label: 'languages.hungarian', countryCode: 'HU' },
      { value: 'ro', label: 'languages.romanian', countryCode: 'RO' },
      { value: 'uk', label: 'languages.ukrainian', countryCode: 'UA' },
    ],
  },
  {
    label: 'regions.southSoutheastAsia',
    options: [
      { value: 'hi', label: 'languages.hindi', countryCode: 'IN' },
      { value: 'id', label: 'languages.indonesian', countryCode: 'ID' },
      { value: 'th', label: 'languages.thai', countryCode: 'TH' },
      { value: 'ms', label: 'languages.malay', countryCode: 'MY' },
      { value: 'tl', label: 'languages.tagalog', countryCode: 'PH' },
      { value: 'bn', label: 'languages.bengali', countryCode: 'BD' },
      { value: 'ta', label: 'languages.tamil', countryCode: 'LK' },
      { value: 'te', label: 'languages.telugu', countryCode: 'IN' },
      { value: 'mr', label: 'languages.marathi', countryCode: 'IN' },
      { value: 'ur', label: 'languages.urdu', countryCode: 'PK' },
    ],
  },
  {
    label: 'regions.middleEastAfrica',
    options: [
      { value: 'ar', label: 'languages.arabic', countryCode: 'SA' },
      { value: 'he', label: 'languages.hebrew', countryCode: 'IL' },
      { value: 'fa', label: 'languages.farsi', countryCode: 'IR' },
      { value: 'sw', label: 'languages.swahili', countryCode: 'KE' },
      { value: 'af', label: 'languages.afrikaans', countryCode: 'ZA' },
    ],
  },
];

const baseLanguageOptions: LanguageOption[] = [
  { value: 'en', label: 'languages.english', countryCode: 'US' }, // Use 'US' flag for English
];

// Styles for the custom dropdown
const languageSwitcherContainer = css`
  margin: 10px 0;
  position: relative;
  width: 70px;
`;

const selectedValueStyles = css`
  ${selectStyles}
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  width: 100%;
  padding: 8px 10px;
  background-image: none;
`;

const dropdownListStyles = css`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background-color: ${colors.light};
  border: 1px solid ${colors.border};
  border-radius: 6px;
  max-height: 300px;
  overflow-y: auto;
  z-index: 10;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  color: ${colors.dark};
  width: 160px;
  box-sizing: border-box;
`;

const dropdownOptionStyles = css`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  cursor: pointer;
  // Base hover style for non-selected items
  &:hover {
    background-color: ${colors.grayLight};
  }
`;

// Specific style for the selected option
const selectedOptionStyle = css`
  background-color: ${colors.primary};
  color: white; // Ensure text color contrasts
  // Keep the background blue even on hover
  &:hover {
    background-color: ${colors.primary};
  }
`;

const dropdownGroupLabelStyles = css`
  padding: 8px;
  font-weight: bold;
  font-size: 0.8rem;
  text-align: center;
  background-color: ${colors.grayLight};
  color: ${colors.gray};
  border-top: 1px solid ${colors.border};
  border-bottom: 1px solid ${colors.border};
  cursor: default;
`;

const arrowStyles = css`
  margin-left: 6px;
  color: ${colors.gray};
  font-size: 10px;
`;

const flagStyleObject = {
  width: '24px',
  height: 'auto', // Maintain aspect ratio
  borderRadius: '2px',
};

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [currentLanguage, setCurrentLanguage] = useState(i18n.language || 'en');
  const [currentCountryCode, setCurrentCountryCode] = useState('US'); // Default to US
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getAllOptions = () => [
    ...baseLanguageOptions,
    ...languageGroups.flatMap(group => group.options),
  ];

  // Update the current country code when language changes
  useEffect(() => {
    const selectedOption = getAllOptions().find(
      opt => opt.value === i18n.language
    );
    setCurrentLanguage(i18n.language);
    setCurrentCountryCode(selectedOption?.countryCode || 'US'); // Default to US if not found
  }, [i18n.language]);

  // Effect to handle clicks outside the dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    // Add listener only when dropdown is open
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    // Cleanup listener
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className={languageSwitcherContainer} ref={dropdownRef}>
      <div className={selectedValueStyles} onClick={() => setIsOpen(!isOpen)}>
        <CountryFlag countryCode={currentCountryCode} style={flagStyleObject} />
        <span className={arrowStyles}>▼</span>
      </div>

      {isOpen && (
        <div className={dropdownListStyles}>
          {/* Base language options */}
          {baseLanguageOptions.map(lang => (
            <div
              key={lang.value}
              // Use cx to combine base style and conditional selected style
              className={cx(
                dropdownOptionStyles,
                currentLanguage === lang.value && selectedOptionStyle
              )}
              onClick={() => handleLanguageChange(lang.value)}
            >
              <CountryFlag
                countryCode={lang.countryCode}
                style={flagStyleObject}
              />
            </div>
          ))}

          {/* Grouped options */}
          {languageGroups.map(group => (
            <div key={group.label}>
              <div className={dropdownGroupLabelStyles}>{t(group.label)}</div>
              {group.options.map(lang => (
                <div
                  key={lang.value}
                  // Use cx to combine base style and conditional selected style
                  className={cx(
                    dropdownOptionStyles,
                    currentLanguage === lang.value && selectedOptionStyle
                  )}
                  onClick={() => handleLanguageChange(lang.value)}
                >
                  <CountryFlag
                    countryCode={lang.countryCode}
                    style={flagStyleObject}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  async function handleLanguageChange(languageValue: string) {
    const selectedOption = getAllOptions().find(
      opt => opt.value === languageValue
    );

    try {
      // Update state immediately
      setCurrentLanguage(languageValue);
      setCurrentCountryCode(selectedOption?.countryCode || 'US'); // Use selected or default to US
      setIsOpen(false);

      // Change the language
      await changeLanguage(languageValue);
    } catch (error) {
      console.error(`[LanguageSwitcher] Error changing language:`, error);
      // Revert
      setCurrentLanguage(i18n.language);
      const revertOption = getAllOptions().find(
        opt => opt.value === i18n.language
      );
      setCurrentCountryCode(revertOption?.countryCode || 'US');
    }
  }
}
