import React, { ReactNode } from 'react';
import { css, cx } from '@emotion/css';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
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
    background-color: ${colors.surfaceRaised};
    border-color: ${colors.borderStrong};
    color: ${colors.text};

    a {
      color: ${colors.primaryLight};
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

const iconMap: Record<AlertVariant, { Icon: typeof Info; color: string }> = {
  info: { Icon: Info, color: colors.textDim },
  success: { Icon: CheckCircle2, color: colors.success },
  warning: { Icon: AlertTriangle, color: colors.warning },
  error: { Icon: XCircle, color: colors.danger },
};

const iconStyles = css`
  flex: none;
  margin-top: 2px;
`;

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
      {(() => {
        const { Icon, color } = iconMap[variant];
        return (
          <Icon
            size={18}
            color={color}
            className={iconStyles}
            aria-hidden="true"
          />
        );
      })()}

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
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
