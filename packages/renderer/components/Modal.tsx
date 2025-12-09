import { css } from '@emotion/css';
import { colors } from '../styles';
import type { ReactNode } from 'react';

const overlayStyles = css`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
`;

const contentStyles = css`
  background: ${colors.surface};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  width: min(520px, 90vw);
  padding: 16px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.25);
`;

const titleStyles = css`
  margin: 0 0 8px 0;
`;

const messageStyles = css`
  margin: 0 0 16px 0;
  color: ${colors.text};
`;

const actionsStyles = css`
  display: flex;
  gap: 10px;
  justify-content: flex-end;
`;

interface ModalProps {
  open: boolean;
  title: string;
  titleId?: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}

export default function Modal({
  open,
  title,
  titleId = 'modal-title',
  children,
  actions,
  onClose,
}: ModalProps) {
  if (!open) return null;

  return (
    <div
      className={overlayStyles}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div className={contentStyles} onClick={e => e.stopPropagation()}>
        <h3 id={titleId} className={titleStyles}>
          {title}
        </h3>
        <div className={messageStyles}>{children}</div>
        {actions && <div className={actionsStyles}>{actions}</div>}
      </div>
    </div>
  );
}
