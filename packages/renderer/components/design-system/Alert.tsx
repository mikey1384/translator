import React, { ReactNode } from 'react';
import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
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

// Calm tinted surfaces; body text stays in the main text color for contrast.
const variantStyles: Record<AlertVariant, string> = {
  info: css`
    background-color: rgba(157, 187, 255, 0.08);
    border-color: rgba(157, 187, 255, 0.36);
    color: ${colors.text};

    a {
      color: ${colors.info};
      text-decoration: underline;

      &:hover {
        color: ${colors.text};
      }
    }
  `,

  success: css`
    background-color: rgba(123, 224, 165, 0.08);
    border-color: rgba(123, 224, 165, 0.36);
    color: ${colors.text};

    a {
      color: ${colors.success};
      text-decoration: underline;

      &:hover {
        color: ${colors.text};
      }
    }
  `,

  warning: css`
    background-color: rgba(255, 181, 71, 0.08);
    border-color: rgba(255, 181, 71, 0.36);
    color: ${colors.text};

    a {
      color: ${colors.warning};
      text-decoration: underline;

      &:hover {
        color: ${colors.text};
      }
    }
  `,

  error: css`
    background-color: rgba(255, 122, 107, 0.08);
    border-color: rgba(255, 122, 107, 0.36);
    color: ${colors.text};

    a {
      color: ${colors.danger};
      text-decoration: underline;

      &:hover {
        color: ${colors.text};
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
  const { t } = useTranslation();

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
          aria-label={t('common.closeAlert', 'Close alert')}
        >
          ✕
        </button>
      )}
    </div>
  );
}
