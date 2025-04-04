import React from 'react';
import { css } from '@emotion/css';
import Button from '../../components/Button';
import { colors } from '../../styles';
import {
  ASS_STYLE_PRESETS,
  AssStylePresetKey,
} from '../../constants/subtitle-styles';

// Define local styles copied from EditSubtitles/index.tsx
const mergeOptionsStyles = css`
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
`;

const fontSizeInputStyles = css`
  padding: 0.5rem 0.75rem;
  border: 1px solid ${colors.border}; // Use theme color
  border-radius: 4px;
  font-size: 1rem;
  width: 80px;
  background-color: ${colors.light}; // Theme background
  color: ${colors.dark}; // Theme text
  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 2px rgba(88, 118, 245, 0.3); // Adjusted focus shadow for dark
  }
`;

const fontSizeLabelStyles = css`
  font-weight: 500;
  color: ${colors.grayDark};
`;

const styleSelectStyles = css`
  padding: 0.5rem 0.75rem;
  border: 1px solid ${colors.border}; // Use theme color
  border-radius: 4px;
  font-size: 1rem;
  background-color: ${colors.light}; // Theme background
  color: ${colors.dark}; // Theme text
  cursor: pointer;
  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 2px rgba(88, 118, 245, 0.3); // Adjusted focus shadow for dark
  }
`;

// Define the custom style for the merge button
const mergeButtonStyle = css`
  background-color: ${colors.warning}; // Use the 'warning' color
  border-color: ${colors.warning};
  color: #ffffff !important; // Ensure text is white for contrast

  &:hover:not(:disabled) {
    // Define a slightly darker hover state for the warning color
    background-color: #e0488a; // Darker shade of #F7559A
    border-color: #e0488a;
  }

  // Optional: Define active state if needed
  &:active:not(:disabled) {
    background-color: #c7407b; // Even darker shade
    border-color: #c7407b;
  }
`;

interface MergeControlsProps {
  mergeFontSize: number;
  setMergeFontSize: (value: number) => void;
  mergeStylePreset: AssStylePresetKey;
  setMergeStylePreset: (value: AssStylePresetKey) => void;
  handleMergeVideoWithSubtitles: () => void; // Simplified prop just for the action
  isMergingInProgress: boolean;
  videoFileExists: boolean;
  subtitlesExist: boolean;
}

// Use function declaration syntax
function MergeControls({
  mergeFontSize,
  setMergeFontSize,
  mergeStylePreset,
  setMergeStylePreset,
  handleMergeVideoWithSubtitles,
  isMergingInProgress,
  videoFileExists,
  subtitlesExist,
}: MergeControlsProps) {
  const handleFontSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const stringValue = e.target.value;
    if (stringValue === '') {
      setMergeFontSize(0); // Or a placeholder/min value
      return;
    }
    const numericString = stringValue.replace(/\D/g, '');
    if (numericString === '') {
      setMergeFontSize(0); // Or a placeholder/min value
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

  return (
    <div className={mergeOptionsStyles}>
      {/* Font Size Input */}
      <label className={fontSizeLabelStyles} htmlFor="mergeFontSizeInput">
        Font Size:
      </label>
      <input
        id="mergeFontSizeInput"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className={fontSizeInputStyles}
        value={mergeFontSize || ''} // Handle potential 0 or NaN
        onChange={handleFontSizeChange}
        onBlur={handleFontSizeBlur}
        disabled={isMergingInProgress}
      />

      {/* Style Preset Select */}
      <label className={fontSizeLabelStyles} htmlFor="mergeStylePresetSelect">
        Style:
      </label>
      <select
        id="mergeStylePresetSelect"
        className={styleSelectStyles}
        value={mergeStylePreset}
        onChange={e => setMergeStylePreset(e.target.value as AssStylePresetKey)}
        disabled={isMergingInProgress}
      >
        {(Object.keys(ASS_STYLE_PRESETS) as AssStylePresetKey[]).map(key => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>

      {/* Merge Button */}
      <Button
        onClick={handleMergeVideoWithSubtitles}
        disabled={!videoFileExists || !subtitlesExist || isMergingInProgress}
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
          {isMergingInProgress ? 'Merging...' : 'Merge Subtitles'}
        </div>
      </Button>
    </div>
  );
}

export default MergeControls;
