import React from 'react';
import { css } from '@emotion/css';
import IconButton from './IconButton';

interface MergingProgressAreaProps {
  mergeProgress: number;
  mergeStage: string;
  onSetIsMergingInProgress: (isInProgress: boolean) => void;
}

// Progress area styles
const progressContainerStyles = css`
  position: fixed;
  left: 0;
  right: 0;
  z-index: 1090; // Below translation progress if both are visible
  padding: 18px 24px;
  background-color: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  animation: slideDown 0.3s ease-out;
  transition: top 0.3s ease;

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
    color: #4895ef;
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

export default function MergingProgressArea({
  mergeProgress,
  mergeStage,
  onSetIsMergingInProgress
}: MergingProgressAreaProps) {
  React.useEffect(() => {
    if (mergeProgress === 100) {
      const timer = setTimeout(() => {
        onSetIsMergingInProgress(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [mergeProgress, onSetIsMergingInProgress]);

  return (
    <div className={progressContainerStyles} style={{ top: 0 }}>
      <div className={headerStyles}>
        <h3>Merging Video with Subtitles</h3>
        <IconButton
          onClick={() => onSetIsMergingInProgress(false)}
          aria-label="Close merging progress"
          size="sm"
          variant="transparent"
          icon="×"
        />
      </div>

      {/* Merge Progress */}
      <div className={progressBlockStyles}>
        <div className={progressLabelStyles}>
          <span>
            <strong>Progress:</strong> {mergeStage || 'Initializing...'}
          </span>
          <span>{mergeProgress.toFixed(1)}%</span>
        </div>
        <div className={progressBarContainerStyles}>
          <div
            className={css`
              height: 100%;
              width: ${mergeProgress}%;
              background-color: ${mergeProgress === 100
                ? '#4cc9f0'
                : '#7209b7'};
              border-radius: 10px;
              transition: width 0.3s ease;
            `}
          />
        </div>
      </div>
    </div>
  );
}
