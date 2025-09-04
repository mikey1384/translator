import React, { useRef, ChangeEvent, ReactNode, forwardRef } from 'react';
import { css, cx } from '@emotion/css';
import { colors, breakpoints } from '../styles.js';
import { logButton } from '../utils/logger.js';
import { useTranslation } from 'react-i18next';
// import LoadingSpinner from './LoadingSpinner'; // Comment out for now

// Define the button variants and sizes
type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'text'
  | 'danger'
  | 'success'
  | 'warning'
  | 'link';
type ButtonSize = 'sm' | 'md' | 'lg';

// Adjusted type for onFileChange to handle directory paths better
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
  asFileInput?: boolean;
  onFileChange?: (event: FileChangeEvent) => void;
  accept?: string;
  directory?: boolean;
  webkitdirectory?: boolean;
}

// Base button styles
const baseButtonStyles = css`
  position: relative; // Needed for absolute spinner and hidden input
  overflow: hidden; // Prevent input spillover
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  padding: 0.375rem 0.75rem;
  font-size: 1rem;
  line-height: 1.5;
  border-radius: 0.25rem;
  transition: all 0.15s ease-in-out;
  user-select: none;
  text-align: center;
  vertical-align: middle;
  white-space: nowrap;

  &:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    width: 100%;
  }
`;

// Size variants
const buttonSizes: Record<ButtonSize, string> = {
  sm: css`
    padding: 0.25rem 0.5rem;
    font-size: 0.875rem;
    line-height: 1.5;
    border-radius: 0.2rem;
  `,
  md: css`
    padding: 0.375rem 0.75rem;
    font-size: 1rem;
    line-height: 1.5;
    border-radius: 0.25rem;
  `,
  lg: css`
    padding: 0.5rem 1rem;
    font-size: 1.25rem;
    line-height: 1.5;
    border-radius: 0.3rem;
  `,
};

// Style variants
const buttonVariants: Record<ButtonVariant, string> = {
  primary: css`
    color: #fff;
    background-color: ${colors.primary};
    border-color: ${colors.primary};
    &:hover:not(:disabled) {
      background-color: ${colors.primaryDark};
      border-color: ${colors.primaryDark};
    }
  `,
  secondary: css`
    color: ${colors.dark};
    background-color: ${colors.grayLight};
    border-color: ${colors.border};
    &:hover:not(:disabled) {
      background-color: ${colors.light};
      border-color: ${colors.grayDark};
    }
  `,
  text: css`
    background: transparent;
    color: ${colors.primary};
    padding-left: 8px;
    padding-right: 8px;

    &:hover:not(:disabled) {
      background-color: rgba(0, 0, 0, 0.04);
    }

    &:active:not(:disabled) {
      background-color: rgba(0, 0, 0, 0.08);
    }
  `,
  danger: css`
    color: #fff;
    background-color: ${colors.danger};
    border-color: ${colors.danger};
    &:hover:not(:disabled) {
      background-color: #c82333;
      border-color: #bd2130;
    }
  `,
  warning: css`
    color: #1e1e1e;
    background-color: ${colors.progressDownload};
    border-color: ${colors.progressDownload};
    &:hover:not(:disabled) {
      background-color: #e6a93e; /* slightly darker */
      border-color: #e6a93e;
    }
  `,
  success: css`
    color: #fff;
    background-color: ${colors.success};
    border-color: ${colors.success};
    &:hover:not(:disabled) {
      background-color: #218838;
      border-color: #1e7e34;
    }
  `,
  link: css`
    color: ${colors.primary};
    background-color: transparent;
    border-color: transparent;
    text-decoration: none;
    padding: 0;
    height: auto;
    line-height: normal;
    &:hover:not(:disabled) {
      color: ${colors.primaryDark};
      text-decoration: underline;
    }
  `,
};

const fullWidthStyle = css`
  width: 100%;
`;

// Loading spinner style
// const loadingSpinnerStyle = css` ... `;

const loadingOverlayStyles = css`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
`;

const hiddenInputStyles = css`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  z-index: 1; // Ensure it's clickable but behind spinner overlay
  // Hide visually but keep accessible
  border: 0;
  clip: rect(0 0 0 0);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  width: 1px;
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
      asFileInput = false,
      onFileChange,
      accept,
      directory = false,
      webkitdirectory = false,
      onClick,
      ...rest
    },
    ref
  ) => {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);

    const handleButtonClick = async (
      event: React.MouseEvent<HTMLButtonElement>
    ) => {
      try {
        const name =
          (rest as any)['data-log'] ||
          (rest as any)['aria-label'] ||
          (rest as any).title ||
          (typeof children === 'string' ? children : 'button');
        logButton(String(name).toLowerCase().replace(/\s+/g, '_'));
      } catch {
        // Do nothing
      }
      if (asFileInput && inputRef.current) {
        inputRef.current.click();
      } else if (onClick) {
        onClick(event);
      }
    };

    const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
      if (onFileChange) {
        onFileChange(event);
        // Reset input value to allow selecting the same file again
        if (inputRef?.current) {
          inputRef.current.value = '';
        }
      }
    };

    const buttonContent = (
      <>
        {isLoading && (
          <div className={loadingOverlayStyles}>
            {/* <LoadingSpinner size={size === 'sm' ? 16 : 20} /> */}
            <span>{t('common.loading', 'Loading...')}</span> {/* Localized */}
          </div>
        )}
        <span style={{ visibility: isLoading ? 'hidden' : 'visible' }}>
          {/* Remove icon rendering logic */}
          {children}
        </span>
      </>
    );

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
      disabled: isLoading,
      ...rest,
    };

    if (asFileInput) {
      // If acting as file input, use a label wrapping the button styling
      // But handle the click via the outer button/div to manage Electron logic
      return (
        <button {...commonButtonProps} type="button">
          {buttonContent}
          {/* Conditionally render input only if not using Electron dialog */}
          {!(directory || webkitdirectory) && (
            <input
              ref={inputRef}
              type="file"
              className={hiddenInputStyles}
              accept={accept}
              onChange={handleInputChange}
              onClick={e => e.stopPropagation()}
              {...(webkitdirectory ? { webkitdirectory: 'true' } : {})} // Use standard prop if true
            />
          )}
        </button>
      );
    }

    // Standard button rendering
    return (
      <button {...commonButtonProps} type={rest.type || 'button'}>
        {buttonContent}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
