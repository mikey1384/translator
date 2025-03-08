import React, { ChangeEvent, InputHTMLAttributes } from "react";
import { css } from "@emotion/css";
import Button from "./Button";
import { colors } from "../styles";

interface StylizedFileInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  buttonText?: string;
  showSelectedFile?: boolean;
  variant?: "primary" | "secondary";
}

const fileInputStyles = css`
  position: relative;
  display: inline-flex;
  align-items: center;
`;

const hiddenInputStyles = css`
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0;
  width: 0.1px;
  height: 0.1px;
  overflow: hidden;
  z-index: -1;
`;

const fileNameStyles = css`
  margin-left: 12px;
  font-size: 0.9rem;
  color: ${colors.gray};
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export default function StylizedFileInput({
  label,
  buttonText = "Choose File",
  showSelectedFile = true,
  variant = "primary",
  onChange,
  accept,
  ...rest
}: StylizedFileInputProps) {
  const [fileName, setFileName] = React.useState<string>("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleButtonClick = () => {
    inputRef.current?.click();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setFileName(files[0].name);
    } else {
      setFileName("");
    }

    if (onChange) {
      onChange(e);
    }
  };

  return (
    <div>
      {label && (
        <label
          className={css`
            display: block;
            margin-bottom: 8px;
          `}
        >
          {label}
        </label>
      )}
      <div className={fileInputStyles}>
        <Button variant={variant} onClick={handleButtonClick} type="button">
          {buttonText}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className={hiddenInputStyles}
          onChange={handleFileChange}
          accept={accept}
          {...rest}
        />
        {showSelectedFile && fileName && (
          <span className={fileNameStyles}>{fileName}</span>
        )}
      </div>
    </div>
  );
}
