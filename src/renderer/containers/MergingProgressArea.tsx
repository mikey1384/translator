import { css } from '@emotion/css';
import { colors } from '../styles';
import { useState, useEffect } from 'react';

interface MergingProgressAreaProps {
  mergeProgress: number;
  mergeStage: string;
  onSetIsMergingInProgress: (inProgress: boolean) => void;
  operationId: string | null;
  onCancelComplete: () => void;
  autoCloseDelay?: number;
}

const progressContainerStyles = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1100;
  padding: 18px 24px;
  background-color: rgba(30, 30, 30, 0.75);
  backdrop-filter: blur(12px);
  box-shadow: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-bottom: 1px solid ${colors.border};
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
    color: ${colors.primaryLight};
  }
`;

const progressBlockStyles = css`
  padding: 16px;
  background-color: ${colors.light};
  border-radius: 8px;
  border: 1px solid ${colors.border};
  box-shadow: none;
`;

const progressBarContainerStyles = css`
  height: 10px;
  background-color: ${colors.grayLight};
  border-radius: 10px;
  overflow: hidden;
  margin: 8px 0;
  border: 1px solid ${colors.border};
`;

const progressLabelStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 500;
  font-size: 0.95rem;
  color: ${colors.dark};

  strong {
    color: ${colors.grayDark};
  }
`;

const closeButtonStyles = css`
  background: none;
  border: none;
  color: ${colors.gray};
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  &:hover {
    color: ${colors.dark};
  }
`;

export default function MergingProgressArea({
  mergeProgress,
  mergeStage,
  onSetIsMergingInProgress,
  operationId,
  onCancelComplete,
  autoCloseDelay = 5000,
}: MergingProgressAreaProps) {
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    console.log('MergingProgressArea received operationId:', operationId);
  }, [operationId]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (mergeProgress === 100) {
      timer = setTimeout(() => {
        onSetIsMergingInProgress(false);
        onCancelComplete();
      }, autoCloseDelay);
    }
    return () => clearTimeout(timer);
  }, [
    mergeProgress,
    onSetIsMergingInProgress,
    onCancelComplete,
    autoCloseDelay,
  ]);

  const handleCancel = async () => {
    console.log('Cancel button clicked, operationId:', operationId);

    // Ask for confirmation before canceling
    if (
      !window.confirm(
        "Are you sure you want to cancel the subtitle merge process? Any progress will be lost and you'll need to start again."
      )
    ) {
      return;
    }

    setIsCancelling(true);

    if (!operationId) {
      console.warn('Cannot cancel merge: operationId is null.');
      setIsCancelling(false);
      onSetIsMergingInProgress(false);
      onCancelComplete();
      return;
    }
    try {
      console.log(`Attempting to cancel merge operation: ${operationId}`);
      const result = await window.electron.cancelOperation(operationId);
      console.log(`Cancellation result for ${operationId}:`, result);
      if (result.success) {
        console.log(`Successfully canceled operation ${operationId}`);
      } else {
        console.error(
          `Failed to cancel operation ${operationId}:`,
          result.error
        );
      }
    } catch (error) {
      console.error(`Error calling cancelOperation for ${operationId}:`, error);
    } finally {
      setIsCancelling(false);
      onSetIsMergingInProgress(false);
      onCancelComplete();
    }
  };

  return (
    <div className={progressContainerStyles}>
      <div className={headerStyles}>
        <h3>Merge in Progress</h3>
        <button
          className={closeButtonStyles}
          onClick={handleCancel}
          disabled={isCancelling}
          aria-label="Cancel merge process"
        >
          {isCancelling ? '...' : '×'}
        </button>
      </div>
      <div className={progressBlockStyles}>
        <div className={progressLabelStyles}>
          <span>
            <strong>Progress:</strong> {mergeStage || 'Preparing...'}
          </span>
          <span>{mergeProgress.toFixed(1)}%</span>
        </div>
        <div className={progressBarContainerStyles}>
          <div
            className={css`
              height: 100%;
              width: ${mergeProgress}%;
              background-color: ${mergeProgress === 100
                ? colors.success
                : colors.warning};
              border-radius: 10px;
              transition: width 0.3s ease;
            `}
          />
        </div>
      </div>
    </div>
  );
}
