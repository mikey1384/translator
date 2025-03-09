import React from 'react';
import { css, keyframes } from '@emotion/css';
import { colors } from '../constants';
import ProgressBar from './ProgressBar';

interface MergingProgressAreaProps {
  mergeProgress: number;
  mergeStage: string;
  onSetIsMergingInProgress: (inProgress: boolean) => void;
}

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
`;

const progressAreaStyles = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background-color: ${colors.dark};
  color: ${colors.white};
  padding: 1.5rem;
  z-index: 1000;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  animation: ${fadeIn} 0.3s ease-in-out;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const titleStyles = css`
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const progressTextStyles = css`
  font-size: 1rem;
  margin: 0.5rem 0;
  color: ${colors.grayLight};
`;

const cancelButtonStyles = css`
  background-color: ${colors.danger};
  border: none;
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: background-color 0.2s;
  
  &:hover {
    background-color: #d32f2f;
  }
`;

export default function MergingProgressArea({
  mergeProgress,
  mergeStage,
  onSetIsMergingInProgress
}: MergingProgressAreaProps) {
  return (
    <div className={progressAreaStyles}>
      <div className={titleStyles}>
        <span>Merging Progress</span>
        <button 
          className={cancelButtonStyles}
          onClick={() => onSetIsMergingInProgress(false)}
        >
          Cancel
        </button>
      </div>
      
      <div>
        <ProgressBar 
          progress={mergeProgress} 
          barColor={colors.info} 
          height={10}
        />
        <p className={progressTextStyles}>
          {mergeStage || 'Preparing to merge...'}
          {mergeProgress > 0 && mergeProgress < 100 && ` (${Math.round(mergeProgress)}%)`}
          {mergeProgress >= 100 && ' Complete!'}
        </p>
      </div>
    </div>
  );
}