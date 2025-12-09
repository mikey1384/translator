import React, { ButtonHTMLAttributes } from 'react';
import { css, cx } from '@emotion/css';
import { colors } from '../styles.js';
import { logButton } from '../utils/logger.js';

// Define the button variants and sizes
type IconButtonVariant = 'primary' | 'secondary' | 'transparent';
type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  icon: React.ReactNode;
  className?: string;
  isLoading?: boolean;
}

// Base icon button styles
const baseIconButtonStyles = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    pointer-events: none;
  }
`;

// Size variants
const iconButtonSizes = {
  sm: css`
    width: 36px;
    height: 36px;
    font-size: 0.875rem;
  `,
  md: css`
    width: 48px;
    height: 48px;
    font-size: 1rem;
  `,
  lg: css`
    width: 56px;
    height: 56px;
    font-size: 1.25rem;
  `,
};

// Style variants
const iconButtonVariants = {
  primary: css`
    background-color: ${colors.primary};
    color: #ffffff;

    &:hover:not(:disabled) {
      background-color: ${colors.primaryDark};
    }

    &:active:not(:disabled) {
      background-color: ${colors.primaryDark};
    }
  `,
  secondary: css`
    background-color: ${colors.grayLight};
    color: ${colors.text};
    border: 1px solid ${colors.border};

    &:hover:not(:disabled) {
      background-color: ${colors.surface};
      border-color: ${colors.grayDark};
    }

    &:active:not(:disabled) {
      background-color: ${colors.surface};
    }
  `,
  transparent: css`
    background: rgba(42, 42, 42, 0.8);
    color: ${colors.text};

    &:hover:not(:disabled) {
      background: rgba(42, 42, 42, 0.95);
    }

    &:active:not(:disabled) {
      background: rgba(42, 42, 42, 0.95);
    }
  `,
};

// Loading spinner style
const loadingSpinnerStyle = css`
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
`;

// Entry animation
const entryAnimation = css`
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.9);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  animation: fadeIn 0.5s ease-out;
`;

export default function IconButton({
  variant = 'primary',
  size = 'md',
  icon,
  className,
  isLoading = false,
  disabled,
  ...props
}: IconButtonProps) {
  const userOnClick = (props as any).onClick as
    | ((e: React.MouseEvent<HTMLButtonElement>) => void)
    | undefined;
  const { 'data-log': dataLog, title, 'aria-label': ariaLabel } = props as any;
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    try {
      const name = dataLog || ariaLabel || title || 'icon_button';
      logButton(String(name).toLowerCase().replace(/\s+/g, '_'));
    } catch {
      // Ignore logging errors
    }
    userOnClick?.(e);
  };
  return (
    <button
      className={cx(
        baseIconButtonStyles,
        iconButtonVariants[variant],
        iconButtonSizes[size],
        entryAnimation,
        className
      )}
      disabled={isLoading || disabled}
      onClick={handleClick}
      {...props}
    >
      {isLoading ? (
        <span className={loadingSpinnerStyle} aria-hidden="true" />
      ) : (
        icon
      )}
    </button>
  );
}
