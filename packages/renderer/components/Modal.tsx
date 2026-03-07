import { css, cx } from '@emotion/css';
import { colors, gradients } from '../styles';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import {
  borderRadius,
  fontSize,
  fontWeight,
  spacing,
  zIndex,
} from './design-system/tokens.js';

const overlayStyles = css`
  position: fixed;
  inset: 0;
  background: ${colors.overlay};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${spacing.xl};
  z-index: ${zIndex.modal};
`;

const contentStyles = css`
  background: ${gradients.surface};
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius['2xl']};
  width: min(560px, 100%);
  padding: ${spacing['2xl']};
  box-shadow: 0 16px 32px rgba(5, 10, 19, 0.28);
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - ${spacing.xl} * 2);
  overflow: hidden;
`;

const titleStyles = css`
  margin: 0 0 ${spacing.sm} 0;
  font-size: ${fontSize.xl};
  font-weight: ${fontWeight.semibold};
  letter-spacing: -0.02em;
  color: ${colors.text};
`;

const messageStyles = css`
  margin: 0 0 ${spacing.xl} 0;
  color: ${colors.text};
  flex: 1 1 auto;
  min-height: 0;
`;

const actionsStyles = css`
  display: flex;
  gap: ${spacing.sm};
  justify-content: flex-end;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: ${spacing.lg};
`;

const closeButtonStyles = css`
  position: absolute;
  top: ${spacing.lg};
  right: ${spacing.lg};
  width: 34px;
  height: 34px;
  border-radius: ${borderRadius.full};
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.textDim};
  cursor: pointer;

  &:hover {
    color: ${colors.text};
    border-color: ${colors.borderStrong};
    background: rgba(255, 255, 255, 0.06);
  }
`;

interface ModalProps {
  open: boolean;
  title: string;
  titleId?: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  overlayClassName?: string;
  contentClassName?: string;
  bodyClassName?: string;
  actionsClassName?: string;
  closeLabel?: string;
  hideCloseButton?: boolean;
}

export default function Modal({
  open,
  title,
  titleId = 'modal-title',
  children,
  actions,
  onClose,
  overlayClassName,
  contentClassName,
  bodyClassName,
  actionsClassName,
  closeLabel = 'Close modal',
  hideCloseButton = false,
}: ModalProps) {
  useEffect(() => {
    if (!open || !onClose) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cx(overlayStyles, overlayClassName)}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className={cx(contentStyles, contentClassName)}
        onClick={e => e.stopPropagation()}
      >
        {onClose && !hideCloseButton && (
          <button
            type="button"
            className={closeButtonStyles}
            onClick={onClose}
            aria-label={closeLabel}
          >
            ✕
          </button>
        )}
        <h3 id={titleId} className={titleStyles}>
          {title}
        </h3>
        <div className={cx(messageStyles, bodyClassName)}>{children}</div>
        {actions && <div className={cx(actionsStyles, actionsClassName)}>{actions}</div>}
      </div>
    </div>
  );
}
