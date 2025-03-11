import React from 'react';
import {
  progressBarStyles,
  progressBarFillStyles,
  progressStageStyles,
} from '../styles';

interface ProgressBarProps {
  progress: number;
  stage?: string;
  showPercentage?: boolean;
}

export default function ProgressBar({
  progress,
  stage,
  showPercentage = false,
}: ProgressBarProps) {
  return (
    <div>
      {stage && <div className={progressStageStyles}>{stage}</div>}
      <div className={progressBarStyles}>
        <div className={progressBarFillStyles(progress)} />
      </div>
      {showPercentage && (
        <div className={progressStageStyles} style={{ textAlign: 'right' }}>
          {Math.round(progress)}%
        </div>
      )}
    </div>
  );
}
