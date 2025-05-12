import React from 'react';
import { css } from '@emotion/css';
import Button from '../../components/Button.js';
import { colors } from '../../styles.js';
import { SubtitleStylePresetKey } from '../../../shared/constants/subtitle-styles.js';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../state/ui-store.js';

const mergeOptionsStyles = css`
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
`;

const fontSizeInputStyles = css`
  padding: 0.5rem 0.75rem;
  border: 1px solid ${colors.border};
  border-radius: 4px;
  font-size: 1rem;
  width: 80px;
  background-color: ${colors.light};
  color: ${colors.dark};
  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 2px rgba(88, 118, 245, 0.3);
  }
`;

const fontSizeLabelStyles = css`
  font-weight: 500;
  color: ${colors.grayDark};
`;

const styleSelectStyles = css`
  padding: 0.5rem 0.75rem;
  border: 1px solid ${colors.border};
  border-radius: 4px;
  font-size: 1rem;
  background-color: ${colors.light};
  color: ${colors.dark};
  cursor: pointer;
  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 2px rgba(88, 118, 245, 0.3);
  }
`;

const mergeButtonStyle = css`
  background-color: ${colors.warning};
  border-color: ${colors.warning};
  color: #ffffff !important;

  &:hover:not(:disabled) {
    background-color: #e0488a;
    border-color: #e0488a;
  }

  &:active:not(:disabled) {
    background-color: #c7407b;
    border-color: #c7407b;
  }
`;

interface MergeMenuProps {
  isMergingInProgress: boolean;
  videoFileExists: boolean;
  subtitlesExist: boolean;
  isTranslationInProgress?: boolean;
  onMergeMediaWithSubtitles: () => void;
}

export default function MergeMenu({
  isMergingInProgress,
  videoFileExists,
  subtitlesExist,
  isTranslationInProgress,
  onMergeMediaWithSubtitles,
}: MergeMenuProps) {
  const { t } = useTranslation();

  const [mergeFontSize, setMergeFontSize] = useUIStore(s => [
    s.baseFontSize,
    s.setBaseFontSize,
  ]);

  const [mergeStylePreset, setMergeStylePreset] = useUIStore(s => [
    s.subtitleStyle,
    s.setSubtitleStyle,
  ]);

  const handleFontSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const stringValue = e.target.value;
    if (stringValue === '') {
      setMergeFontSize(0);
      return;
    }
    const numericString = stringValue.replace(/\D/g, '');
    if (numericString === '') {
      setMergeFontSize(0);
      return;
    }
    const numValue = parseInt(numericString, 10);
    setMergeFontSize(numValue);
  };

  const handleFontSizeBlur = () => {
    const clampedSize = Math.max(10, Math.min(mergeFontSize || 10, 72));
    if (clampedSize !== mergeFontSize) {
      setMergeFontSize(clampedSize);
    }
  };

  const stylePresetOrder: SubtitleStylePresetKey[] = [
    'Default',
    'Classic',
    'Boxed',
    'LineBox',
  ];

  return (
    <div className={mergeOptionsStyles}>
      <label className={fontSizeLabelStyles} htmlFor="mergeFontSizeInput">
        {t('editSubtitles.mergeControls.fontSizeLabel')}
      </label>
      <input
        id="mergeFontSizeInput"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className={fontSizeInputStyles}
        value={mergeFontSize || ''}
        onChange={handleFontSizeChange}
        onBlur={handleFontSizeBlur}
      />

      <label className={fontSizeLabelStyles} htmlFor="mergeStylePresetSelect">
        {t('editSubtitles.mergeControls.styleLabel')}
      </label>
      <select
        id="mergeStylePresetSelect"
        className={styleSelectStyles}
        value={mergeStylePreset}
        onChange={e =>
          setMergeStylePreset(e.target.value as SubtitleStylePresetKey)
        }
      >
        {stylePresetOrder.map(key => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>

      <Button
        onClick={onMergeMediaWithSubtitles}
        disabled={
          !videoFileExists ||
          !subtitlesExist ||
          isMergingInProgress ||
          isTranslationInProgress
        }
        isLoading={isMergingInProgress}
        className={mergeButtonStyle}
      >
        <div
          className={css`
            display: flex;
            align-items: center;
          `}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: '8px' }}
          >
            <path d="M13 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V9l-7-7z" />
            <path d="M13 3v6h6" />
            <path d="M16 13H8" />
            <path d="M16 17H8" />
            <path d="M10 9H8" />
          </svg>
          {isMergingInProgress
            ? t('editSubtitles.mergeControls.mergingButton')
            : t('editSubtitles.mergeControls.mergeButton')}
        </div>
      </Button>
    </div>
  );
}
