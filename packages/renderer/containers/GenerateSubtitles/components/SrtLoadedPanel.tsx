import { css } from '@emotion/css';
import { colors, selectStyles } from '../../../styles.js';
import { useTranslation } from 'react-i18next';
import Button from '../../../components/Button.js';
import { useUIStore } from '../../../state/ui-store';
import {
  TRANSLATION_LANGUAGES_BASE,
  TRANSLATION_LANGUAGE_GROUPS,
} from '../../../constants/translation-languages';
import { useTaskStore } from '../../../state/task-store';

interface SrtLoadedPanelProps {
  srtPath?: string | null;
  onTranslate?: () => void;
  isTranslating?: boolean;
  disabled?: boolean;
  targetLanguage?: string;
  onTargetLanguageChange?: (lang: string) => void;
}

export default function SrtLoadedPanel({
  srtPath,
  onTranslate,
  isTranslating = false,
  disabled = false,
  targetLanguage,
  onTargetLanguageChange,
}: SrtLoadedPanelProps) {
  const { t } = useTranslation();
  const showOriginalText = useUIStore(s => s.showOriginalText);
  const setShowOriginalText = useUIStore(s => s.setShowOriginalText);
  const isTranscribing = useTaskStore(s => !!s.transcription.inProgress);
  const isDisabled = disabled || isTranslating || isTranscribing;

  return (
    <div
      className={css`
        margin-top: 10px;
        padding: 20px;
        border: 1px solid ${colors.info};
        border-radius: 6px;
        background-color: ${colors.info}0F;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
      `}
    >
      <div
        className={css`
          display: flex;
          align-items: center;
          gap: 12px;
        `}
      >
        <span
          className={css`
            color: ${colors.info};
            font-size: 1.2rem;
          `}
        >
          •
        </span>
        <div>
          <div
            className={css`
              font-weight: 600;
              color: ${colors.text};
            `}
          >
            {t('input.srtFileLoaded', 'SRT Loaded')}
          </div>
          {srtPath && (
            <div
              className={css`
                font-size: 0.9rem;
                color: ${colors.gray};
                margin-top: 2px;
              `}
            >
              {srtPath.split(/[/\\\\]/).pop()}
            </div>
          )}
        </div>
      </div>

      <div
        className={css`
          display: flex;
          align-items: center;
          gap: 12px;
        `}
      >
        <label
          className={css`
            margin-right: 6px;
          `}
        >
          {t('subtitles.outputLanguage')}:
        </label>
        <select
          className={selectStyles}
          value={targetLanguage}
          onChange={e => onTargetLanguageChange?.(e.target.value)}
          disabled={isDisabled}
        >
          {TRANSLATION_LANGUAGES_BASE.map(opt => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
          {TRANSLATION_LANGUAGE_GROUPS.map(group => (
            <optgroup key={group.labelKey} label={t(group.labelKey)}>
              {group.options.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
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
              onChange={e => setShowOriginalText(e.target.checked)}
              className={css`
                margin-right: 6px;
                accent-color: #4361ee;
              `}
            />
            {t('subtitles.showOriginalText')}
          </label>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={onTranslate}
          disabled={isDisabled}
          isLoading={isTranslating}
        >
          {t('subtitles.translate', 'Translate')}
        </Button>
      </div>
    </div>
  );
}
