import React, { forwardRef, ReactNode } from 'react';
import { css, cx } from '@emotion/css';
import { colors } from '../../styles.js';
import {
  spacing,
  borderRadius,
  transitions,
  componentSizes,
  shadows,
} from './tokens.js';
import { logButton } from '../../utils/logger.js';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'text'
  | 'danger'
  | 'success'
  | 'link';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children: ReactNode;
}

// Base button styles using design tokens
const baseButtonStyles = css`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing.sm};
  border: 1px solid transparent;
  border-radius: ${borderRadius.md};
  font-weight: 500;
  text-decoration: none;
  transition: ${transitions.fast};
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  vertical-align: middle;

  &:focus {
    outline: 2px solid ${colors.primary};
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }
`;

// Size variations using design tokens
const sizeStyles: Record<ButtonSize, string> = {
  sm: css`
    height: ${componentSizes.button.sm.height};
    padding: 0 ${componentSizes.button.sm.paddingX};
    font-size: ${componentSizes.button.sm.fontSize};
  `,
  md: css`
    height: ${componentSizes.button.md.height};
    padding: 0 ${componentSizes.button.md.paddingX};
    font-size: ${componentSizes.button.md.fontSize};
  `,
  lg: css`
    height: ${componentSizes.button.lg.height};
    padding: 0 ${componentSizes.button.lg.paddingX};
    font-size: ${componentSizes.button.lg.fontSize};
  `,
};

// Variant styles
const variantStyles: Record<ButtonVariant, string> = {
  primary: css`
    background-color: ${colors.primary};
    border-color: ${colors.primary};
    color: ${colors.white};

    &:hover:not(:disabled) {
      background-color: ${colors.primaryDark};
      border-color: ${colors.primaryDark};
    }

    &:active:not(:disabled) {
      background-color: ${colors.primaryDark};
      box-shadow: ${shadows.sm};
    }
  `,

  secondary: css`
    background-color: ${colors.grayLight};
    border-color: ${colors.border};
    color: ${colors.dark};

    &:hover:not(:disabled) {
      background-color: ${colors.light};
      border-color: ${colors.grayDark};
    }

    &:active:not(:disabled) {
      background-color: ${colors.light};
      box-shadow: ${shadows.sm};
    }
  `,

  text: css`
    background-color: transparent;
    border-color: transparent;
    color: ${colors.primary};
    padding: ${spacing.sm} ${spacing.md};

    &:hover:not(:disabled) {
      background-color: ${colors.grayLight};
    }

    &:active:not(:disabled) {
      background-color: ${colors.light};
    }
  `,

  danger: css`
    background-color: ${colors.danger};
    border-color: ${colors.danger};
    color: ${colors.white};

    &:hover:not(:disabled) {
      background-color: #c82333;
      border-color: #bd2130;
    }

    &:active:not(:disabled) {
      background-color: #a71d2a;
      box-shadow: ${shadows.sm};
    }
  `,

  success: css`
    background-color: ${colors.success};
    border-color: ${colors.success};
    color: ${colors.white};

    &:hover:not(:disabled) {
      background-color: #218838;
      border-color: #1e7e34;
    }

    &:active:not(:disabled) {
      background-color: #1c7430;
      box-shadow: ${shadows.sm};
    }
  `,

  link: css`
    background-color: transparent;
    border-color: transparent;
    color: ${colors.primary};
    text-decoration: underline;
    padding: 0;
    height: auto;
    min-height: auto;

    &:hover:not(:disabled) {
      color: ${colors.primaryDark};
    }

    &:active:not(:disabled) {
      color: ${colors.primaryDark};
    }
  `,
};

const fullWidthStyle = css`
  width: 100%;
`;

const loadingSpinnerStyle = css`
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  width: 1em;
  height: 1em;
  border: 2px solid transparent;
  border-top: 2px solid currentColor;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
`;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      isLoading = false,
      leftIcon,
      rightIcon,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const { onClick, ...restProps } = props;
    const handleClick: React.MouseEventHandler<HTMLButtonElement> = e => {
      try {
        const name =
          (restProps as any)['data-log'] ||
          (restProps as any)['aria-label'] ||
          (restProps as any).title ||
          (typeof children === 'string' ? children : 'button');
        logButton(String(name).toLowerCase().replace(/\s+/g, '_'));
      } catch {}
      onClick?.(e);
    };

    return (
      <button
        ref={ref}
        className={cx(
          baseButtonStyles,
          sizeStyles[size],
          variantStyles[variant],
          fullWidth && fullWidthStyle,
          className
        )}
        disabled={isLoading || disabled}
        onClick={handleClick}
        {...restProps}
      >
        {isLoading ? (
          <>
            <span className={loadingSpinnerStyle} aria-hidden="true" />
            Loading...
          </>
        ) : (
          <>
            {leftIcon && <span>{leftIcon}</span>}
            {children}
            {rightIcon && <span>{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
