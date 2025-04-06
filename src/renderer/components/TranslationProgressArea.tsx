import { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { colors } from '../styles.js';

interface SubtitleProgressInfo {
  current?: number;
  total?: number;
  warning?: string;
}

interface TranslationProgressAreaProps {
  translationProgress: number;
  translationStage: string;
  subtitleProgress?: SubtitleProgressInfo;
  onClose: () => void;
  autoCloseDelay?: number;
  partialResult?: string;
  onPartialResult?: (partialResult: string) => void;
  translationOperationId?: string | null;
}

// Progress area styles - Updated for Dark Theme
const progressContainerStyles = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1100;
  padding: 18px 24px;
  background-color: rgba(30, 30, 30, 0.75); // Dark semi-transparent
  backdrop-filter: blur(12px); // Blur effect
  box-shadow: none; // Remove shadow
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-bottom: 1px solid ${colors.border}; // Theme border color
  animation: slideDown 0.3s ease-out;

  @keyframes slideDown {
    from {
      transform: translateY(-100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
`;

const headerStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;

  h3 {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
    color: ${colors.primaryLight}; // Lighter primary for dark bg
  }
`;

// Progress block styles - Adjust for dark theme
const progressBlockStyles = css`
  padding: 16px;
  background-color: ${colors.light}; // Secondary dark background
  border-radius: 8px;
  border: 1px solid ${colors.border}; // Theme border
  box-shadow: none; // Remove shadow
`;

// Progress bar container - Adjust for dark theme
const progressBarContainerStyles = css`
  height: 10px;
  background-color: ${colors.grayLight}; // Darker background for bar
  border-radius: 10px;
  overflow: hidden;
  margin: 8px 0;
  border: 1px solid ${colors.border}; // Subtle border
`;

// Progress label styles - Adjust for dark theme
const progressLabelStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 500;
  font-size: 0.95rem;
  color: ${colors.dark}; // Light text

  strong {
    color: ${colors.grayDark}; // Slightly dimmer label text
  }
`;

// Warning styles - Adjust for dark theme
const warningStyles = css`
  color: ${colors.warning}; // Use theme warning color
  background-color: rgba(247, 85, 154, 0.1); // Tinted background
  padding: 10px;
  margin-top: 8px;
  border-radius: 6px;
  font-size: 0.9rem;
  border-left: 3px solid ${colors.warning};
`;

// Close button styles - Adjust for dark theme
const closeButtonStyles = css`
  background: none;
  border: none;
  color: ${colors.gray}; // Medium gray
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  &:hover {
    color: ${colors.dark}; // Light hover color
  }
`;

export default function TranslationProgressArea({
  translationProgress,
  translationStage,
  subtitleProgress,
  onClose,
  autoCloseDelay = 3000,
  partialResult,
  onPartialResult,
  translationOperationId,
}: TranslationProgressAreaProps) {
  const [isCancelling, setIsCancelling] = useState(false);

  // If progress is 100%, auto-close after specified delay
  useEffect(() => {
    if (translationProgress === 100) {
      const timer = setTimeout(() => {
        onClose();
      }, autoCloseDelay);
      return () => clearTimeout(timer);
    }
  }, [translationProgress, onClose, autoCloseDelay]);

  // Effect to handle partial results
  useEffect(() => {
    if (partialResult && onPartialResult) {
      onPartialResult(partialResult);
    }
  }, [partialResult, onPartialResult]);

  const handleRequestClose = async () => {
    // Only show confirmation if process is not complete
    if (translationProgress < 100) {
      const shouldClose = window.confirm(
        "Are you sure you want to cancel the subtitle translation process? Any progress will be lost and you'll need to start again."
      );
      if (shouldClose) {
        // Log the ID we are about to use
        console.log(
          `[TranslationProgressArea] Attempting cancellation with ID: ${translationOperationId}`
        );

        // If we have an operation ID, send the cancel request
        if (translationOperationId && window.electron?.cancelOperation) {
          setIsCancelling(true);
          try {
            // Log before calling IPC
            console.log(
              `[TranslationProgressArea] Calling window.electron.cancelOperation for ID: ${translationOperationId}`
            );
            const result = await window.electron.cancelOperation(
              translationOperationId
            );
            // Log IPC result
            console.log(
              `[TranslationProgressArea] IPC cancelOperation result for ${translationOperationId}:`,
              result
            );
          } catch (error) {
            console.error(
              `[TranslationProgressArea] Error calling cancelOperation IPC for ${translationOperationId}:`,
              error
            );
          } finally {
            setIsCancelling(false);
            onClose(); // Close UI regardless of backend success/failure for now
          }
        } else {
          // If no operation ID, just close the progress area
          console.warn(
            `[TranslationProgressArea] Cannot cancel operation: No operation ID (${translationOperationId}) or IPC function available.`
          );
          onClose();
        }
      }
    } else {
      onClose();
    }
  };

  return (
    <div className={progressContainerStyles}>
      <div className={headerStyles}>
        <h3>Translation in Progress</h3>
        <button
          className={closeButtonStyles}
          onClick={handleRequestClose}
          disabled={isCancelling}
          aria-label="Close translation progress"
        >
          {isCancelling ? '...' : '×'}
        </button>
      </div>
      {/* Translation Progress */}
      {(translationProgress > 0 || translationStage) && (
        <div className={progressBlockStyles}>
          <div className={progressLabelStyles}>
            <span>
              <strong>Progress:</strong> {translationStage || 'Initializing...'}
              {/* Remove the (current/total) display */}
              {/* {subtitleProgress?.current && subtitleProgress?.total ? (
                <span>
                  {' '}
                  ({subtitleProgress.current}/{subtitleProgress.total})
                </span>
              ) : null} */}
            </span>
            <span>{translationProgress.toFixed(1)}%</span>
          </div>
          <div className={progressBarContainerStyles}>
            <div
              className={css`
                height: 100%;
                width: ${translationProgress}%;
                background-color: ${translationProgress === 100
                  ? '#4cc9f0'
                  : '#4895ef'};
                border-radius: 10px;
              `}
            />
          </div>
          {subtitleProgress?.warning && (
            <div className={warningStyles}>{subtitleProgress.warning}</div>
          )}
        </div>
      )}
    </div>
  );
}
