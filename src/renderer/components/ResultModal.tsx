import React from 'react';
import { css, keyframes } from '@emotion/css';
import { colors } from '../constants';
import Button from './Button';
import IconButton from './IconButton';

interface ResultModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  actionLabel?: string;
  cancelLabel?: string;
  onAction?: () => void;
  onCancel?: () => void;
  onClose: () => void;
  type?: 'success' | 'error' | 'info';
}

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideIn = keyframes`
  from { transform: translateY(-50px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

const modalOverlayStyles = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: ${fadeIn} 0.3s ease-out;
`;

const modalContentStyles = css`
  background-color: ${colors.white};
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  width: 90%;
  max-width: 500px;
  padding: 1.5rem;
  animation: ${slideIn} 0.3s ease-out;
`;

const modalHeaderStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
`;

const modalTitleStyles = css`
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
`;

const closeButtonStyles = css`
  background: none;
  border: none;
  color: ${colors.gray};
  cursor: pointer;
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border-radius: 50%;
  transition: background-color 0.2s;
  
  &:hover {
    background-color: ${colors.grayLight};
  }
`;

const modalBodyStyles = css`
  margin-bottom: 1.5rem;
  color: ${colors.dark};
  line-height: 1.5;
`;

const modalFooterStyles = css`
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
`;

// Status icons for different modal types
const getTypeIcon = (type: string) => {
  switch (type) {
    case 'success':
      return '✓';
    case 'error':
      return '✕';
    case 'info':
    default:
      return 'ℹ';
  }
};

const getTypeColor = (type: string) => {
  switch (type) {
    case 'success':
      return colors.success;
    case 'error':
      return colors.danger;
    case 'info':
    default:
      return colors.info;
  }
};

export default function ResultModal({
  isOpen,
  title,
  message,
  actionLabel,
  cancelLabel,
  onAction,
  onCancel,
  onClose,
  type = 'info'
}: ResultModalProps) {
  if (!isOpen) return null;
  
  const iconColor = getTypeColor(type);
  
  return (
    <div className={modalOverlayStyles} onClick={onClose}>
      <div 
        className={modalContentStyles}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={modalHeaderStyles}>
          <h2 className={modalTitleStyles}>
            <span style={{ color: iconColor, marginRight: '0.5rem' }}>
              {getTypeIcon(type)}
            </span>
            {title}
          </h2>
          <button className={closeButtonStyles} onClick={onClose}>
            ×
          </button>
        </div>
        <div className={modalBodyStyles}>
          {message}
        </div>
        <div className={modalFooterStyles}>
          {cancelLabel && (
            <Button
              variant="secondary"
              onClick={() => {
                if (onCancel) onCancel();
                onClose();
              }}
            >
              {cancelLabel}
            </Button>
          )}
          {actionLabel && (
            <Button
              variant="primary"
              onClick={() => {
                if (onAction) onAction();
                onClose();
              }}
            >
              {actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}