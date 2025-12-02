import { css } from '@emotion/css';
import { colors, selectStyles } from '../../styles.js';
import Button from '../../components/Button.js';
import { useTranslation } from 'react-i18next';

interface LanguageOption {
  value: string;
  label: string;
}

import {
  TRANSLATION_LANGUAGE_GROUPS,
  TRANSLATION_LANGUAGES_BASE,
} from '../../constants/translation-languages';

// Map centralized language data to local format
const languageGroups = TRANSLATION_LANGUAGE_GROUPS.map(g => ({
  label: g.labelKey,
  options: g.options.map(o => ({ value: o.value, label: o.labelKey })),
}));

const baseLanguageOptions: LanguageOption[] = [
  { value: 'original', label: 'languages.original' },
  ...TRANSLATION_LANGUAGES_BASE.map(o => ({
    value: o.value,
    label: o.labelKey,
  })),
];

interface GenerateSubtitlesPanelProps {
  targetLanguage: string;
  setTargetLanguage: (language: string) => void;
  isTranslationInProgress: boolean;
  showOriginalText: boolean;
  onShowOriginalTextChange: (show: boolean) => void;

  videoFile: File | null;
  videoFilePath?: string | null;
  isProcessingUrl: boolean;
  handleGenerateSubtitles: () => void;
  isMergingInProgress: boolean;
  disabledKey: boolean;
}

export default function GenerateSubtitlesPanel({
  targetLanguage,
  setTargetLanguage,
  isTranslationInProgress,
  showOriginalText,
  onShowOriginalTextChange,
  videoFile,
  videoFilePath,
  isProcessingUrl,
  handleGenerateSubtitles,
  isMergingInProgress,
  disabledKey,
}: GenerateSubtitlesPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className={css`
        margin-top: 10px;
        padding: 20px;
        border: 1px solid ${colors.border};
        border-radius: 6px;
        background-color: ${colors.light};
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        justify-content: center;
      `}
    >
      <div>
        <label
          className={css`
            margin-right: 12px;
          `}
        >
          {t('subtitles.outputLanguage')}:
        </label>
        <select
          value={targetLanguage}
          onChange={e => setTargetLanguage(e.target.value)}
          className={selectStyles}
          disabled={
            disabledKey ||
            isTranslationInProgress ||
            isProcessingUrl ||
            isMergingInProgress
          }
        >
          {baseLanguageOptions.map(lang => (
            <option key={lang.value} value={lang.value}>
              {t(lang.label)}
            </option>
          ))}

          {languageGroups.map(group => (
            <optgroup key={group.label} label={t(group.label)}>
              {group.options.map(lang => (
                <option key={lang.value} value={lang.value}>
                  {t(lang.label)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <div
          className={css`
            margin-top: 8px;
          `}
        >
          <label
            className={css`
              display: inline-flex;
              align-items: center;
              cursor: pointer;
            `}
          >
            <input
              type="checkbox"
              checked={showOriginalText}
              disabled={targetLanguage === 'original'}
              onChange={e => onShowOriginalTextChange(e.target.checked)}
              className={css`
                margin-right: 6px;
                accent-color: #4361ee;
              `}
            />
            {t('subtitles.showOriginalText')}
          </label>
        </div>
      </div>

      <div>
        <Button
          onClick={handleGenerateSubtitles}
          disabled={
            disabledKey ||
            (!videoFile && !videoFilePath) ||
            isTranslationInProgress ||
            isProcessingUrl ||
            isMergingInProgress
          }
          size="md"
          variant="primary"
          isLoading={isTranslationInProgress}
        >
          {isTranslationInProgress
            ? t('subtitles.generating')
            : t('subtitles.generateNow')}
        </Button>
      </div>
    </div>
  );
}
