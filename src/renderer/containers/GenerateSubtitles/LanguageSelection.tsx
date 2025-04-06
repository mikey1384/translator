import { css } from '@emotion/css';
import { selectStyles, colors } from '../../styles.js';

interface LanguageOption {
  value: string;
  label: string;
}

interface LanguageGroup {
  label: string;
  options: LanguageOption[];
}

// Constants copied from index.tsx
const languageGroups: LanguageGroup[] = [
  {
    label: 'East Asia',
    options: [
      { value: 'korean', label: 'Korean' },
      { value: 'japanese', label: 'Japanese' },
      { value: 'chinese_simplified', label: 'Chinese (Simplified)' },
      { value: 'chinese_traditional', label: 'Chinese (Traditional)' },
      { value: 'vietnamese', label: 'Vietnamese' },
    ],
  },
  {
    label: 'Europe',
    options: [
      { value: 'spanish', label: 'Spanish' },
      { value: 'french', label: 'French' },
      { value: 'german', label: 'German' },
      { value: 'italian', label: 'Italian' },
      { value: 'portuguese', label: 'Portuguese' },
      { value: 'russian', label: 'Russian' },
      { value: 'dutch', label: 'Dutch' },
      { value: 'polish', label: 'Polish' },
      { value: 'swedish', label: 'Swedish' },
      { value: 'turkish', label: 'Turkish' },
      { value: 'norwegian', label: 'Norwegian' },
      { value: 'danish', label: 'Danish' },
      { value: 'finnish', label: 'Finnish' },
      { value: 'greek', label: 'Greek' },
      { value: 'czech', label: 'Czech' },
      { value: 'hungarian', label: 'Hungarian' },
      { value: 'romanian', label: 'Romanian' },
      { value: 'ukrainian', label: 'Ukrainian' },
    ],
  },
  {
    label: 'South / Southeast Asia',
    options: [
      { value: 'hindi', label: 'Hindi' },
      { value: 'indonesian', label: 'Indonesian' },
      { value: 'thai', label: 'Thai' },
      { value: 'malay', label: 'Malay' },
      { value: 'tagalog', label: 'Tagalog (Filipino)' },
      { value: 'bengali', label: 'Bengali' },
      { value: 'tamil', label: 'Tamil' },
      { value: 'telugu', label: 'Telugu' },
      { value: 'marathi', label: 'Marathi' },
      { value: 'urdu', label: 'Urdu' },
    ],
  },
  {
    label: 'Middle East / Africa',
    options: [
      { value: 'arabic', label: 'Arabic' },
      { value: 'hebrew', label: 'Hebrew' },
      { value: 'farsi', label: 'Farsi (Persian)' },
      { value: 'swahili', label: 'Swahili' },
      { value: 'afrikaans', label: 'Afrikaans' },
    ],
  },
];

const baseLanguageOptions: LanguageOption[] = [
  { value: 'original', label: 'Same as Audio' },
  { value: 'english', label: 'English' },
];

interface LanguageSelectionProps {
  targetLanguage: string;
  setTargetLanguage: (language: string) => void;
  isGenerating: boolean;
  showOriginalText: boolean;
  onShowOriginalTextChange: (show: boolean) => void;
}

export default function LanguageSelection({
  targetLanguage,
  setTargetLanguage,
  isGenerating,
  showOriginalText,
  onShowOriginalTextChange,
}: LanguageSelectionProps) {
  return (
    <div
      className={css`
        margin-top: 10px;
        padding: 20px;
        border: 1px solid ${colors.border};
        border-radius: 6px;
        background-color: ${colors.light};
      `}
    >
      <label
        className={css`
          margin-right: 12px;
        `}
      >
        2. Output Language:
      </label>
      <select
        value={targetLanguage}
        onChange={e => setTargetLanguage(e.target.value)}
        className={selectStyles}
        disabled={isGenerating}
      >
        {baseLanguageOptions.map(lang => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
        {/* Render grouped options */}
        {languageGroups.map(group => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map(lang => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {targetLanguage !== 'original' && targetLanguage !== 'english' && (
        <div
          className={css`
            margin-top: 12px;
            display: flex;
            align-items: center;
          `}
        >
          <label
            className={css`
              display: flex;
              align-items: center;
              cursor: pointer;
              user-select: none;
              margin: 0;
              line-height: 1;
            `}
          >
            <input
              type="checkbox"
              checked={showOriginalText}
              onChange={e => onShowOriginalTextChange(e.target.checked)}
              className={css`
                margin-right: 8px;
                width: 16px;
                height: 16px;
                accent-color: #4361ee;
                margin-top: 0;
                margin-bottom: 0;
                vertical-align: middle;
              `}
            />
            <span
              className={css`
                display: inline-block;
                vertical-align: middle;
              `}
            >
              Show original text
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
