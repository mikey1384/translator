import React, { ButtonHTMLAttributes } from 'react';
import { css, cx } from '@emotion/css';

// Define the button variants and sizes
type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  className?: string;
  isLoading?: boolean;
}

// Base button styles
const baseButtonStyles = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);

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
const buttonSizes = {
  sm: css`
    font-size: 0.875rem;
    padding: 6px 12px;
    border-radius: 4px;
  `,
  md: css`
    font-size: 0.95rem;
    padding: 10px 18px;
    border-radius: 6px;
  `,
  lg: css`
    font-size: 1rem;
    padding: 12px 24px;
    border-radius: 8px;
  `
};

// Style variants
const buttonVariants = {
  primary: css`
    background: linear-gradient(135deg, #4361ee 0%, #3a0ca3 100%);
    color: white;
    box-shadow: 0 4px 10px rgba(67, 97, 238, 0.3);

    &:hover:not(:disabled) {
      box-shadow: 0 6px 15px rgba(67, 97, 238, 0.4);
      transform: translateY(-2px);
    }

    &:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: 0 2px 5px rgba(67, 97, 238, 0.2);
    }
  `,
  secondary: css`
    background-color: #ffffff;
    color: #212529;
    border: 1px solid #e9ecef;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);

    &:hover:not(:disabled) {
      background-color: #f1f3f5;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.08);
      transform: translateY(-1px);
    }

    &:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    }
  `,
  text: css`
    background: transparent;
    color: #4361ee;
    padding-left: 8px;
    padding-right: 8px;

    &:hover:not(:disabled) {
      background-color: rgba(67, 97, 238, 0.08);
    }

    &:active:not(:disabled) {
      background-color: rgba(67, 97, 238, 0.12);
    }
  `,
  danger: css`
    background: linear-gradient(135deg, #e63946 0%, #d62828 100%);
    color: white;
    box-shadow: 0 4px 10px rgba(230, 57, 70, 0.3);

    &:hover:not(:disabled) {
      box-shadow: 0 6px 15px rgba(230, 57, 70, 0.4);
      transform: translateY(-2px);
    }

    &:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: 0 2px 5px rgba(230, 57, 70, 0.2);
    }
  `,
  success: css`
    background: linear-gradient(135deg, #2ec4b6 0%, #1a936f 100%);
    color: white;
    box-shadow: 0 4px 10px rgba(46, 196, 182, 0.3);

    &:hover:not(:disabled) {
      box-shadow: 0 6px 15px rgba(46, 196, 182, 0.4);
      transform: translateY(-2px);
    }

    &:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: 0 2px 5px rgba(46, 196, 182, 0.2);
    }
  `
};

// Full width style
const fullWidthStyle = css`
  width: 100%;
`;

// Loading spinner style
const loadingSpinnerStyle = css`
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  display: inline-block;
  width: 1em;
  height: 1em;
  margin-right: 0.5em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
  vertical-align: text-bottom;
`;

// Icon spacing styles
const iconLeftStyle = css`
  margin-right: 8px;
`;

const iconRightStyle = css`
  margin-left: 8px;
`;

export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  icon,
  iconPosition = 'left',
  className,
  children,
  isLoading = false,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(
        baseButtonStyles,
        buttonVariants[variant],
        buttonSizes[size],
        fullWidth && fullWidthStyle,
        className
      )}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading && <span className={loadingSpinnerStyle} aria-hidden="true" />}

      {!isLoading && icon && iconPosition === 'left' && (
        <span className={iconLeftStyle}>{icon}</span>
      )}

      {children}

      {!isLoading && icon && iconPosition === 'right' && (
        <span className={iconRightStyle}>{icon}</span>
      )}
    </button>
  );
}
