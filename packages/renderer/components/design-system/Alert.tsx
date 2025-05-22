import React, { ReactNode } from 'react';
import { css, cx } from '@emotion/css';
import { colors } from '../../styles.js';
import { spacing, borderRadius, transitions } from './tokens.js';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}

const baseAlertStyles = css`
  display: flex;
  align-items: flex-start;
  gap: ${spacing.md};
  padding: ${spacing.lg};
  border-radius: ${borderRadius.md};
  border: 1px solid;
  position: relative;
  transition: ${transitions.normal};
  margin-bottom: ${spacing.lg};
`;

const variantStyles: Record<AlertVariant, string> = {
  info: css`
    background-color: rgba(91, 192, 222, 0.1);
    border-color: ${colors.info};
    color: ${colors.info};

    a {
      color: ${colors.info};
      text-decoration: underline;

      &:hover {
        color: ${colors.primaryDark};
      }
    }
  `,

  success: css`
    background-color: rgba(76, 224, 179, 0.1);
    border-color: ${colors.success};
    color: ${colors.success};

    a {
      color: ${colors.success};
      text-decoration: underline;

      &:hover {
        color: #218838;
      }
    }
  `,

  warning: css`
    background-color: rgba(247, 85, 154, 0.1);
    border-color: ${colors.warning};
    color: ${colors.warning};

    a {
      color: ${colors.primary};
      text-decoration: underline;

      &:hover {
        color: ${colors.primaryDark};
      }
    }
  `,

  error: css`
    background-color: rgba(230, 94, 106, 0.1);
    border-color: ${colors.danger};
    color: ${colors.danger};

    a {
      color: ${colors.danger};
      text-decoration: underline;

      &:hover {
        color: #c82333;
      }
    }
  `,
};

const contentStyles = css`
  flex: 1;
  font-size: 0.9rem;
  line-height: 1.5;
`;

const titleStyles = css`
  font-weight: 600;
  margin-bottom: ${spacing.xs};
`;

const closeButtonStyles = css`
  background: none;
  border: none;
  color: currentColor;
  cursor: pointer;
  padding: 0;
  font-size: 1.2rem;
  line-height: 1;
  opacity: 0.7;
  transition: ${transitions.fast};

  &:hover {
    opacity: 1;
  }

  &:focus {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
`;

const iconMap: Record<AlertVariant, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

export default function Alert({
  variant = 'info',
  title,
  children,
  onClose,
  className,
}: AlertProps) {
  return (
    <div
      className={cx(baseAlertStyles, variantStyles[variant], className)}
      role="alert"
    >
      <span aria-hidden="true">{iconMap[variant]}</span>

      <div className={contentStyles}>
        {title && <div className={titleStyles}>{title}</div>}
        {children}
      </div>

      {onClose && (
        <button
          className={closeButtonStyles}
          onClick={onClose}
          aria-label="Close alert"
        >
          ✕
        </button>
      )}
    </div>
  );
}
