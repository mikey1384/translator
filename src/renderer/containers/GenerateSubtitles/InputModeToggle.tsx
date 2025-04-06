import React from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';

interface InputModeToggleProps {
  inputMode: 'file' | 'url';
  setInputMode: (mode: 'file' | 'url') => void;
  isGenerating: boolean;
  isProcessingUrl: boolean;
}

// --- Style Adjustments for New Layout --- START ---
const inputModeToggleStyles = css`
  display: flex;
  margin-bottom: 15px;
  border: none; // Remove all borders initially
  border-bottom: 1px solid ${colors.border}; // Add only the bottom border

  button {
    flex: 1;
    padding: 8px 12px;
    font-size: 0.95rem;
    border: none;
    background-color: transparent;
    color: ${colors.grayDark};
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      color 0.2s ease;
    border-radius: 0; // Remove individual button radius

    &:not(:last-child) {
      border-right: none; // Remove the divider line between buttons
    }

    &:hover {
      background-color: transparent;
      color: ${colors.primary};
    }

    &.active {
      background-color: transparent;
      color: ${colors.primary};
      border-bottom: 2px solid ${colors.primary};
      border-top: none;
      font-weight: 600;
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      background-color: transparent !important;
      color: ${colors.gray} !important;
    }
  }
`;

const InputModeToggle: React.FC<InputModeToggleProps> = ({
  inputMode,
  setInputMode,
  isGenerating,
  isProcessingUrl,
}) => {
  return (
    <div className={inputModeToggleStyles}>
      <button
        className={inputMode === 'file' ? 'active' : ''}
        onClick={() => setInputMode('file')}
        disabled={isGenerating || isProcessingUrl}
      >
        From your device
      </button>
      <button
        className={inputMode === 'url' ? 'active' : ''}
        onClick={() => setInputMode('url')}
        disabled={isGenerating || isProcessingUrl}
      >
        From the web
      </button>
    </div>
  );
};

export default InputModeToggle;
