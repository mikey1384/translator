import { css, keyframes } from '@emotion/css';
import { colors } from '../constants';
import ProgressBar from '../components/ProgressBar';
import { useState } from 'react';

interface MergingProgressAreaProps {
  mergeProgress: number;
  mergeStage: string;
  onSetIsMergingInProgress: (inProgress: boolean) => void;
  operationId: string;
  onCancelComplete: () => void;
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
  onSetIsMergingInProgress,
  operationId,
  onCancelComplete,
}: MergingProgressAreaProps) {
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancel = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    console.log(`Requesting cancellation for merge operation: ${operationId}`);
    try {
      const result = await window.electron.cancelMerge(operationId);
      console.log(`Cancellation result for ${operationId}:`, result);
      if (result.success) {
        // Optionally show a message or change stage
      } else {
        // Handle cancellation failure (e.g., show error)
        console.error(
          `Failed to cancel operation ${operationId}:`,
          result.error
        );
        // Maybe show an alert to the user?
      }
    } catch (error) {
      console.error(`Error calling cancelMerge for ${operationId}:`, error);
      // Handle IPC error
    } finally {
      setIsCancelling(false);
      onSetIsMergingInProgress(false); // Hide the progress area
      onCancelComplete(); // Notify parent to clear the ID
    }
  };

  return (
    <div className={progressAreaStyles}>
      <div className={titleStyles}>
        <span>Merging Progress</span>
        <button
          className={cancelButtonStyles}
          onClick={handleCancel}
          disabled={isCancelling}
        >
          {isCancelling ? 'Cancelling...' : 'Cancel'}
        </button>
      </div>

      <div>
        <ProgressBar progress={mergeProgress} />
        <p className={progressTextStyles}>
          {mergeStage || 'Preparing to merge...'}
          {mergeProgress > 0 &&
            mergeProgress < 100 &&
            ` (${Math.round(mergeProgress)}%)`}
          {mergeProgress >= 100 && ' Complete!'}
        </p>
      </div>
    </div>
  );
}
