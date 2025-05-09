import { css } from '@emotion/css';
import { colors, selectStyles } from '../../styles.js';
import Button from '../../components/Button.js';
import { useTranslation } from 'react-i18next';

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
      { value: 'korean', label: 'languages.korean' },
      { value: 'japanese', label: 'languages.japanese' },
      { value: 'chinese_simplified', label: 'languages.chinese_simplified' },
      { value: 'chinese_traditional', label: 'languages.chinese_traditional' },
      { value: 'vietnamese', label: 'languages.vietnamese' },
    ],
  },
  {
    label: 'regions.europe',
    options: [
      { value: 'spanish', label: 'languages.spanish' },
      { value: 'french', label: 'languages.french' },
      { value: 'german', label: 'languages.german' },
      { value: 'italian', label: 'languages.italian' },
      { value: 'portuguese', label: 'languages.portuguese' },
      { value: 'russian', label: 'languages.russian' },
      { value: 'dutch', label: 'languages.dutch' },
      { value: 'polish', label: 'languages.polish' },
      { value: 'swedish', label: 'languages.swedish' },
      { value: 'turkish', label: 'languages.turkish' },
      { value: 'norwegian', label: 'languages.norwegian' },
      { value: 'danish', label: 'languages.danish' },
      { value: 'finnish', label: 'languages.finnish' },
      { value: 'greek', label: 'languages.greek' },
      { value: 'czech', label: 'languages.czech' },
      { value: 'hungarian', label: 'languages.hungarian' },
      { value: 'romanian', label: 'languages.romanian' },
      { value: 'ukrainian', label: 'languages.ukrainian' },
    ],
  },
  {
    label: 'regions.southSoutheastAsia',
    options: [
      { value: 'hindi', label: 'languages.hindi' },
      { value: 'indonesian', label: 'languages.indonesian' },
      { value: 'thai', label: 'languages.thai' },
      { value: 'malay', label: 'languages.malay' },
      { value: 'tagalog', label: 'languages.tagalog' },
      { value: 'bengali', label: 'languages.bengali' },
      { value: 'tamil', label: 'languages.tamil' },
      { value: 'telugu', label: 'languages.telugu' },
      { value: 'marathi', label: 'languages.marathi' },
      { value: 'urdu', label: 'languages.urdu' },
    ],
  },
  {
    label: 'regions.middleEastAfrica',
    options: [
      { value: 'arabic', label: 'languages.arabic' },
      { value: 'hebrew', label: 'languages.hebrew' },
      { value: 'farsi', label: 'languages.farsi' },
      { value: 'swahili', label: 'languages.swahili' },
      { value: 'afrikaans', label: 'languages.afrikaans' },
    ],
  },
];

const baseLanguageOptions: LanguageOption[] = [
  { value: 'original', label: 'languages.original' },
  { value: 'english', label: 'languages.english' },
];

interface GenerateSubtitlesPanelProps {
  /** from LanguageSelection: */
  targetLanguage: string;
  setTargetLanguage: (language: string) => void;
  isTranslationInProgress: boolean;
  showOriginalText: boolean;
  onShowOriginalTextChange: (show: boolean) => void;

  /** from GenerateControls: */
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
