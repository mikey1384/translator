import { useEffect } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';

interface ProgressAreaProps {
  isVisible: boolean;
  progress: number;
  stage: string;
  title: string;
  progressBarColor: string;
  operationId: string | null;
  onCancel: (operationId: string) => Promise<void> | void;
  autoCloseDelay?: number;
  isCancelling?: boolean;
  onClose: () => void;
}

export const PROGRESS_BAR_HEIGHT = 150;

// --- Styles ---
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

// --- Component Implementation ---
export default function ProgressArea({
  isVisible,
  progress,
  stage,
  title,
  progressBarColor,
  operationId,
  onCancel,
  isCancelling,
  onClose,
  autoCloseDelay = 4000,
}: ProgressAreaProps) {
  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (isVisible && progress >= 100) {
      timer = setTimeout(() => {
        onClose();
      }, autoCloseDelay);
    }
    return () => clearTimeout(timer);
  }, [progress, isVisible, onClose, autoCloseDelay]);

  const handleCloseOrCancelClick = async () => {
    if (progress < 100) {
      if (!operationId) {
        console.warn(
          `[ProgressArea] Cannot trigger cancel for "${title}": operationId is missing.`
        );
        onClose();
        return;
      }
      try {
        await onCancel(operationId);
      } catch (error) {
        console.error(
          `[ProgressArea] Error during onCancel call for ${operationId} ("${title}"):`,
          error
        );
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className={progressContainerStyles}>
      <div className={headerStyles}>
        <h3>{title}</h3>
        <button
          className={closeButtonStyles}
          onClick={handleCloseOrCancelClick}
          disabled={isCancelling}
          aria-label="Close or cancel process"
        >
          {isCancelling ? '...' : '×'}
        </button>
      </div>
      <div className={progressBlockStyles}>
        <div className={progressLabelStyles}>
          <span>{stage}</span>
          {progress > 0 && <span>{progress.toFixed(1)}%</span>}
        </div>
        <div className={progressBarContainerStyles}>
          <div
            className={css`
              height: 100%;
              width: ${Math.min(progress, 100)}%;
              background-color: ${progressBarColor};
              border-radius: 10px;
              transition: width 0.3s ease;
            `}
          />
        </div>
      </div>
    </div>
  );
}
