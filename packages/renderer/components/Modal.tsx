import { css, cx } from '@emotion/css';
import { colors, gradients } from '../styles';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.28);
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - ${spacing.xl} * 2);
  overflow: hidden;

  &:focus {
    outline: none;
  }
`;

const titleStyles = css`
  margin: 0 0 ${spacing.sm} 0;
  font-size: ${fontSize.xl};
  font-weight: ${fontWeight.semibold};
  letter-spacing: -0.02em;
  color: ${colors.text};
`;

// Keeps the title clear of the close button on whichever side it sits.
const titleWithCloseStyles = css`
  padding-inline-end: 44px;
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
  inset-inline-end: ${spacing.lg};
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

  &:focus-visible {
    outline: 2px solid ${colors.primaryLight};
    outline-offset: 2px;
  }
`;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(el => !el.hasAttribute('inert') && el.getClientRects().length > 0);
}

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
  closeLabel,
  hideCloseButton = false,
}: ModalProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);
  const showCloseButton = Boolean(onClose) && !hideCloseButton;

  // Move focus into the dialog when it opens and hand it back to whatever
  // opened it when it closes, so keyboard and screen-reader users never
  // land on the page behind the overlay.
  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      const node = contentRef.current;
      if (!node || node.contains(document.activeElement)) return;
      const focusables = getFocusableElements(node);
      const preferred =
        focusables.find(el => !el.dataset.modalClose) ?? focusables[0];
      (preferred ?? node).focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (opener && opener.isConnected) {
        opener.focus();
      }
    };
  }, [open]);

  const handleTabKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const node = contentRef.current;
    if (!node) return;
    const focusables = getFocusableElements(node);
    if (focusables.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === node)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (!node.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

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
        ref={contentRef}
        tabIndex={-1}
        className={cx(contentStyles, contentClassName)}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleTabKey}
      >
        {showCloseButton && (
          <button
            type="button"
            className={closeButtonStyles}
            onClick={onClose}
            aria-label={closeLabel || t('common.close', 'Close')}
            data-modal-close="true"
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
        <h3
          id={titleId}
          className={cx(titleStyles, showCloseButton && titleWithCloseStyles)}
        >
          {title}
        </h3>
        <div className={cx(messageStyles, bodyClassName)}>{children}</div>
        {actions && (
          <div className={cx(actionsStyles, actionsClassName)}>{actions}</div>
        )}
      </div>
    </div>
  );
}
