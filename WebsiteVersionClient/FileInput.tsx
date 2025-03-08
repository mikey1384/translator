import React, { ChangeEvent, useRef } from 'react';
import { css } from '@emotion/css';
import Button from './Button';

interface FileInputProps {
  accept: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  label: string;
  buttonText?: string;
  selectedFile?: File | null;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
}

const fileInputWrapperStyles = css`
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;

  label.label-text {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
  }
`;

const fileInputContainerStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const fileInfoStyles = css`
  margin-left: 10px;
  font-size: 0.9rem;
  color: #6c757d;
  display: flex;
  align-items: center;
`;

const fileNameStyles = css`
  font-weight: 500;
  margin-right: 8px;
`;

const fileSizeStyles = css`
  font-size: 0.8rem;
  color: #6c757d;
  background-color: #e9ecef;
  padding: 2px 6px;
  border-radius: 4px;
`;

export default function FileInput({
  accept,
  onChange,
  label,
  buttonText = 'Choose File',
  selectedFile = null,
  variant = 'primary',
  size = 'md'
}: FileInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleButtonClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div className={fileInputWrapperStyles}>
      {label && <label className="label-text">{label}</label>}
      <div className={fileInputContainerStyles}>
        <Button onClick={handleButtonClick} variant={variant} size={size}>
          {buttonText}
        </Button>
        {selectedFile && (
          <span className={fileInfoStyles}>
            <span className={fileNameStyles}>{selectedFile.name}</span>
            <span className={fileSizeStyles}>
              {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
            </span>
          </span>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={onChange}
          className={css`
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border-width: 0;
          `}
        />
      </div>
    </div>
  );
}
