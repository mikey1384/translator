import React, { useRef, ChangeEvent, ReactNode, forwardRef } from 'react';
import { css, cx } from '@emotion/css';
import { colors, breakpoints } from '../styles.js';
import { logButton } from '../utils/logger.js';
import { useTranslation } from 'react-i18next';
import {
  borderRadius,
  componentSizes,
  fontWeight,
  shadows,
  spacing,
  transitions,
} from './design-system/tokens.js';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'text'
  | 'danger'
  | 'success'
  | 'warning'
  | 'link';

export type ButtonSize = 'sm' | 'md' | 'lg';

type FileChangeEvent =
  | ChangeEvent<HTMLInputElement>
  | { target: { files: FileList | { name: string; path: string }[] | null } };

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
  isLoading?: boolean;
  children: ReactNode;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  asFileInput?: boolean;
  onFileChange?: (event: FileChangeEvent) => void;
  accept?: string;
  directory?: boolean;
  webkitdirectory?: boolean;
}

const baseButtonStyles = css`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing.sm};
  border: 1px solid transparent;
  border-radius: ${borderRadius.lg};
  font-weight: ${fontWeight.semibold};
  letter-spacing: -0.01em;
  transition:
    border-color ${transitions.fast},
    background-color ${transitions.fast},
    color ${transitions.fast};
  cursor: pointer;
  user-select: none;
  text-align: center;
  vertical-align: middle;
  white-space: nowrap;
  box-shadow: ${shadows.sm};
  overflow: hidden;

  &:focus-visible {
    outline: none;
    box-shadow:
      ${shadows.sm},
      0 0 0 3px rgba(125, 167, 255, 0.2);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    width: 100%;
  }
`;

const buttonSizes: Record<ButtonSize, string> = {
  sm: css`
    min-height: ${componentSizes.button.sm.height};
    padding: 0 ${componentSizes.button.sm.paddingX};
    font-size: ${componentSizes.button.sm.fontSize};
  `,
  md: css`
    min-height: ${componentSizes.button.md.height};
    padding: 0 ${componentSizes.button.md.paddingX};
    font-size: ${componentSizes.button.md.fontSize};
  `,
  lg: css`
    min-height: ${componentSizes.button.lg.height};
    padding: 0 ${componentSizes.button.lg.paddingX};
    font-size: ${componentSizes.button.lg.fontSize};
  `,
};

const buttonVariants: Record<ButtonVariant, string> = {
  primary: css`
    color: ${colors.bg};
    background: linear-gradient(
      135deg,
      ${colors.primaryLight},
      ${colors.primary}
    );
    border-color: rgba(171, 200, 255, 0.18);
    box-shadow: ${shadows.button};

    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #bfd5ff, ${colors.primary});
      border-color: rgba(171, 200, 255, 0.28);
    }
  `,
  secondary: css`
    color: ${colors.text};
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.03),
      rgba(255, 255, 255, 0)
    );
    background-color: ${colors.grayLight};
    border-color: ${colors.border};

    &:hover:not(:disabled) {
      background-color: ${colors.surfaceRaised};
      border-color: ${colors.borderStrong};
    }
  `,
  text: css`
    background: transparent;
    color: ${colors.primaryLight};
    border-color: transparent;
    box-shadow: none;
    padding-left: ${spacing.md};
    padding-right: ${spacing.md};

    &:hover:not(:disabled) {
      background-color: rgba(125, 167, 255, 0.08);
      color: ${colors.text};
    }
  `,
  danger: css`
    color: ${colors.bg};
    background: linear-gradient(135deg, #ff8b90, ${colors.danger});
    border-color: rgba(255, 109, 114, 0.18);
    box-shadow: ${shadows.button};

    &:hover:not(:disabled) {
      border-color: rgba(255, 109, 114, 0.28);
    }
  `,
  warning: css`
    color: #261700;
    background: linear-gradient(135deg, #ffd58e, ${colors.warning});
    border-color: rgba(240, 180, 75, 0.2);
    box-shadow: ${shadows.button};

    &:hover:not(:disabled) {
      border-color: rgba(240, 180, 75, 0.28);
    }
  `,
  success: css`
    color: ${colors.bg};
    background: linear-gradient(135deg, #6de0a4, ${colors.success});
    border-color: rgba(57, 200, 135, 0.18);
    box-shadow: ${shadows.button};

    &:hover:not(:disabled) {
      border-color: rgba(57, 200, 135, 0.28);
    }
  `,
  link: css`
    color: ${colors.primaryLight};
    background-color: transparent;
    border-color: transparent;
    text-decoration: none;
    padding: 0;
    min-height: auto;
    box-shadow: none;

    &:hover:not(:disabled) {
      color: ${colors.text};
      text-decoration: underline;
    }
  `,
};

const fullWidthStyle = css`
  width: 100%;
`;

const loadingOverlayStyles = css`
  position: absolute;
  inset: 0;
  background: rgba(9, 13, 20, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
`;

const loadingSpinnerStyle = css`
  width: 1em;
  height: 1em;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: buttonSpin 0.8s linear infinite;

  @keyframes buttonSpin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const hiddenInputStyles = css`
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  border: 0;
  clip: rect(0 0 0 0);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  width: 1px;
`;

const labelStyles = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing.sm};
`;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      className,
      isLoading = false,
      leftIcon,
      rightIcon,
      asFileInput = false,
      onFileChange,
      accept,
      directory = false,
      webkitdirectory = false,
      onClick,
      disabled,
      ...rest
    },
    ref
  ) => {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);

    const handleButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      try {
        const name =
          (rest as any)['data-log'] ||
          (rest as any)['aria-label'] ||
          (rest as any).title ||
          (typeof children === 'string' ? children : 'button');
        logButton(String(name).toLowerCase().replace(/\s+/g, '_'));
      } catch {
        // Ignore logging failures.
      }

      if (asFileInput && inputRef.current) {
        inputRef.current.click();
        return;
      }

      onClick?.(event);
    };

    const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
      onFileChange?.(event);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    };

    const commonButtonProps = {
      ref,
      onClick: handleButtonClick,
      className: cx(
        baseButtonStyles,
        buttonVariants[variant],
        buttonSizes[size],
        fullWidth && fullWidthStyle,
        className
      ),
      disabled: isLoading || disabled,
      ...rest,
    };

    const buttonContent = (
      <>
        {isLoading && (
          <div className={loadingOverlayStyles}>
            <span className={loadingSpinnerStyle} aria-hidden="true" />
            <span style={{ marginLeft: spacing.sm }}>
              {t('common.loading', 'Loading...')}
            </span>
          </div>
        )}
        <span
          className={labelStyles}
          style={{ visibility: isLoading ? 'hidden' : 'visible' }}
        >
          {leftIcon && <span aria-hidden="true">{leftIcon}</span>}
          {children}
          {rightIcon && <span aria-hidden="true">{rightIcon}</span>}
        </span>
      </>
    );

    if (asFileInput) {
      return (
        <button {...commonButtonProps} type="button">
          {buttonContent}
          {!(directory || webkitdirectory) && (
            <input
              ref={inputRef}
              type="file"
              className={hiddenInputStyles}
              accept={accept}
              onChange={handleInputChange}
              onClick={e => e.stopPropagation()}
              {...(webkitdirectory ? { webkitdirectory: 'true' } : {})}
            />
          )}
        </button>
      );
    }

    return (
      <button {...commonButtonProps} type={rest.type || 'button'}>
        {buttonContent}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
