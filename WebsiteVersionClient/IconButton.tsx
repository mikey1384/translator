import React, { ButtonHTMLAttributes } from 'react';
import { css, cx } from '@emotion/css';

// Define the button variants and sizes
type IconButtonVariant = 'primary' | 'secondary' | 'transparent';
type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
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
  `
};

// Style variants
const iconButtonVariants = {
  primary: css`
    background: linear-gradient(135deg, #4361ee 0%, #3a0ca3 100%);
    color: white;
    box-shadow: 0 4px 14px rgba(67, 97, 238, 0.3);

    &:hover:not(:disabled) {
      transform: translateY(-5px) scale(1.05);
      box-shadow: 0 6px 20px rgba(67, 97, 238, 0.4);
    }

    &:active:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 3px 10px rgba(67, 97, 238, 0.3);
    }
  `,
  secondary: css`
    background-color: #ffffff;
    color: #212529;
    border: 1px solid #e9ecef;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

    &:hover:not(:disabled) {
      background-color: #f8f9fa;
      transform: translateY(-3px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    &:active:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
    }
  `,
  transparent: css`
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(5px);
    color: #212529;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
      transform: translateY(-3px);
    }

    &:active:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
  `
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
