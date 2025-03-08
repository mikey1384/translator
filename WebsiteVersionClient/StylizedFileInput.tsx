import React, { ChangeEvent } from 'react';
import { css } from '@emotion/css';

interface StylizedFileInputProps {
  accept: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  label?: string;
  selectedFile?: File | null;
  buttonText?: string;
}

const fileInputLabelStyles = css`
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
`;

const fileInputButtonStyles = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  background-color: #f8f9fa;
  border: 1px dashed #ced4da;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: all 0.2s ease;
  color: #212529;
  min-width: 140px;
  text-align: center;
  height: 40px;

  &:hover {
    background-color: #e9ecef;
    border-color: #4361ee;
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.08);
  }

  &:active {
    transform: translateY(0);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }
`;

const fileInputContainerStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
`;

const fileInfoStyles = css`
  margin-left: 10px;
  font-size: 0.9rem;
  color: #6c757d;
  display: flex;
  align-items: center;
`;

const fileSizeStyles = css`
  background-color: #e9ecef;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.8rem;
  margin-left: 8px;
  font-weight: 500;
  color: #495057;
`;

const hiddenInputStyles = css`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
`;

export default function StylizedFileInput({
  accept,
  onChange,
  label,
  selectedFile = null,
  buttonText = 'Choose File'
}: StylizedFileInputProps) {
  return (
    <div>
      {label && <label className={fileInputLabelStyles}>{label}</label>}
      <div className={fileInputContainerStyles}>
        <label className={fileInputButtonStyles}>
          <input
            type="file"
            accept={accept}
            onChange={onChange}
            className={hiddenInputStyles}
          />
          {selectedFile ? (
            <React.Fragment>
              <span
                className={css`
                  max-width: 200px;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;
                  display: block;
                `}
              >
                {selectedFile.name}
              </span>
            </React.Fragment>
          ) : (
            <div
              className={css`
                display: flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
              `}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={css`
                  margin-right: 8px;
                  flex-shrink: 0;
                  position: relative;
                  top: 0px;
                `}
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>{buttonText}</span>
            </div>
          )}
        </label>
        {selectedFile && (
          <span className={fileInfoStyles}>
            <span className={fileSizeStyles}>
              {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
