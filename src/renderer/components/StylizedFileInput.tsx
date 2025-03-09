import React, { ChangeEvent, InputHTMLAttributes } from "react";
import { css } from "@emotion/css";
import { colors, shadows, breakpoints } from "../styles";

interface StylizedFileInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  buttonText?: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  showSelectedFile?: boolean;
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
  transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  color: #212529;
  min-width: 140px;
  text-align: center;
  height: 40px;
  line-height: 1;
  box-sizing: border-box;
  white-space: nowrap;

  &:hover {
    background-color: #e9ecef;
    border-color: ${colors.primary};
    transform: translateY(-1px);
    box-shadow: ${shadows.md};
  }

  &:active {
    transform: translateY(0);
    box-shadow: ${shadows.sm};
  }
  
  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    width: 100%;
  }
`;

const fileInputContainerStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  width: 100%;
  box-sizing: border-box;
  
  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    flex-direction: column;
    align-items: flex-start;
    
    > * {
      width: 100%;
    }
  }
`;

const fileInfoStyles = css`
  margin-left: 10px;
  font-size: 0.9rem;
  color: ${colors.gray};
  display: flex;
  align-items: center;
  
  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    margin-left: 0;
    margin-top: 8px;
  }
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
  label,
  buttonText = "Choose File",
  onChange,
  accept,
  showSelectedFile = true,
  ...rest
}: StylizedFileInputProps) {
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
    } else {
      setSelectedFile(null);
    }

    if (onChange) {
      onChange(e);
    }
  };

  return (
    <div>
      {label && <label className={fileInputLabelStyles}>{label}</label>}
      <div className={fileInputContainerStyles}>
        <label className={fileInputButtonStyles}>
          <input
            type="file"
            accept={accept}
            onChange={handleFileChange}
            className={hiddenInputStyles}
            {...rest}
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
        {showSelectedFile && selectedFile && (
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
