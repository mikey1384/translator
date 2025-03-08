import React, { ButtonHTMLAttributes } from "react";
import { css, cx } from "@emotion/css";
import { colors } from "../styles";

// Define the button variants and sizes
type ButtonVariant = "primary" | "secondary" | "text" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
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
  `,
};

// Style variants
const buttonVariants = {
  primary: css`
    background: linear-gradient(
      135deg,
      ${colors.primary} 0%,
      ${colors.primaryDark} 100%
    );
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
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);

    &:hover:not(:disabled) {
      border-color: #dee2e6;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      transform: translateY(-2px);
    }

    &:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    }
  `,
  text: css`
    background-color: transparent;
    color: ${colors.primary};
    padding: 6px 8px;

    &:hover:not(:disabled) {
      background-color: rgba(67, 97, 238, 0.05);
    }

    &:active:not(:disabled) {
      background-color: rgba(67, 97, 238, 0.1);
    }
  `,
  danger: css`
    background: linear-gradient(135deg, ${colors.danger} 0%, #f94144 100%);
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
    background: linear-gradient(135deg, ${colors.success} 0%, #06d6a0 100%);
    color: white;
    box-shadow: 0 4px 10px rgba(76, 201, 240, 0.3);

    &:hover:not(:disabled) {
      box-shadow: 0 6px 15px rgba(76, 201, 240, 0.4);
      transform: translateY(-2px);
    }

    &:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: 0 2px 5px rgba(76, 201, 240, 0.2);
    }
  `,
};

const fullWidthStyle = css`
  width: 100%;
`;

const loadingStyle = css`
  position: relative;
  color: transparent !important;
  pointer-events: none;

  &::after {
    content: "";
    position: absolute;
    width: 16px;
    height: 16px;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    margin: auto;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: button-loading-spinner 0.7s linear infinite;
  }

  @keyframes button-loading-spinner {
    from {
      transform: rotate(0turn);
    }
    to {
      transform: rotate(1turn);
    }
  }
`;

export default function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  icon,
  iconPosition = "left",
  className,
  isLoading = false,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(
        baseButtonStyles,
        buttonVariants[variant],
        buttonSizes[size],
        fullWidth && fullWidthStyle,
        isLoading && loadingStyle,
        className
      )}
      disabled={disabled || isLoading}
      {...rest}
    >
      {icon && iconPosition === "left" && (
        <span style={{ marginRight: "8px" }}>{icon}</span>
      )}
      {children}
      {icon && iconPosition === "right" && (
        <span style={{ marginLeft: "8px" }}>{icon}</span>
      )}
    </button>
  );
}
