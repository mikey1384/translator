import React from 'react';
import Button, { ButtonProps } from './Button.js';

interface FileButtonProps extends Omit<ButtonProps, 'leftIcon' | 'onClick'> {
  onFileSelect: () => void;
}

const UploadIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export default function FileButton({
  onFileSelect,
  children,
  variant = 'secondary',
  size = 'lg',
  ...props
}: FileButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      leftIcon={<UploadIcon />}
      onClick={onFileSelect}
      {...props}
    >
      {children}
    </Button>
  );
}
