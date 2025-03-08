import React from 'react';
import { css } from '@emotion/css';
import IconButton from './IconButton';

interface SubtitleProgressInfo {
  current?: number;
  total?: number;
  warning?: string;
}

interface TranslationProgressAreaProps {
  progress: number;
  progressStage: string;
  translationProgress: number;
  translationStage: string;
  subtitleProgress?: SubtitleProgressInfo;
  onSetIsTranslationInProgress: (isInProgress: boolean) => void;
}

// Progress area styles
const progressContainerStyles = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1100;
  padding: 18px 24px;
  background-color: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
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
    color: #3f37c9;
  }
`;

const progressBlockStyles = css`
  padding: 16px;
  background-color: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #eaedf0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
`;

const progressBarContainerStyles = css`
  height: 10px;
  background-color: #e9ecef;
  border-radius: 10px;
  overflow: hidden;
  margin: 8px 0;
`;

const progressLabelStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 500;
  font-size: 0.95rem;
`;

const warningStyles = css`
  color: #856404;
  background-color: #fff3cd;
  padding: 10px;
  margin-top: 8px;
  border-radius: 6px;
  font-size: 0.9rem;
  border-left: 3px solid #ffc107;
`;

export default function TranslationProgressArea({
  progress,
  progressStage,
  translationProgress,
  translationStage,
  subtitleProgress,
  onSetIsTranslationInProgress
}: TranslationProgressAreaProps) {
  // If progress is 100%, auto-close after 3 seconds
  React.useEffect(() => {
    if (translationProgress === 100) {
      const timer = setTimeout(() => {
        onSetIsTranslationInProgress(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [translationProgress, onSetIsTranslationInProgress]);

  return (
    <div className={progressContainerStyles}>
      <div className={headerStyles}>
        <h3>Translation in Progress</h3>
        <IconButton
          onClick={() => onSetIsTranslationInProgress(false)}
          aria-label="Close translation progress"
          size="sm"
          variant="transparent"
          icon="×"
        />
      </div>

      {/* Audio Processing Progress */}
      {(progress > 0 || progressStage) && (
        <div className={progressBlockStyles}>
          <div className={progressLabelStyles}>
            <span>
              <strong>Audio Processing:</strong>{' '}
              {progressStage || 'Starting...'}
            </span>
            <span>{progress.toFixed(1)}%</span>
          </div>
          <div className={progressBarContainerStyles}>
            <div
              className={css`
                height: 100%;
                width: ${progress}%;
                background-color: ${progress === 100 ? '#4cc9f0' : '#4361ee'};
                border-radius: 10px;
                transition: width 0.3s ease;
              `}
            />
          </div>
        </div>
      )}

      {/* Translation Progress */}
      {(translationProgress > 0 || translationStage) && (
        <div className={progressBlockStyles}>
          <div className={progressLabelStyles}>
            <span>
              <strong>Progress:</strong> {translationStage || 'Initializing...'}
              {subtitleProgress?.current && subtitleProgress?.total ? (
                <span>
                  {' '}
                  ({subtitleProgress.current}/{subtitleProgress.total})
                </span>
              ) : null}
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
                transition: width 0.3s ease;
              `}
            />
          </div>

          {subtitleProgress?.warning && (
            <div className={warningStyles}>
              <strong>Warning:</strong> {subtitleProgress.warning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
