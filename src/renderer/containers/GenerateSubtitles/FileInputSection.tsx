import React from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import Button from '../../components/Button.js';

interface FileInputSectionProps {
  videoFile: File | null;
  handleFileSelectClick: () => void;
}

const inputSectionStyles = css`
  padding: 20px;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  background-color: ${colors.light};
`;

const FileInputSection: React.FC<FileInputSectionProps> = ({
  videoFile,
  handleFileSelectClick,
}) => {
  return (
    <div className={inputSectionStyles}>
      <div
        className={css`
          display: flex;
          align-items: center;
          padding: 5px 0;
          height: 35px;
        `}
      >
        <label
          style={{
            marginRight: '12px',
            lineHeight: '32px',
            display: 'inline-block',
            minWidth: '220px',
          }}
        >
          1. Select Video File:{' '}
        </label>
        <Button
          onClick={handleFileSelectClick}
          variant="secondary"
          className={css`
            width: 100%;
            justify-content: center;
            padding: 10px;
            margin-top: 5px;
          `}
        >
          {videoFile ? `Selected: ${videoFile.name}` : 'Select Video File'}
        </Button>
      </div>
    </div>
  );
};

export default FileInputSection;
