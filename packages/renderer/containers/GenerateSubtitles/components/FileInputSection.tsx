import React from 'react';
import { css } from '@emotion/css';
import { colors } from '../../../styles.js';
import { FileButton } from '../../../components/design-system/index.js';
import { useTranslation } from 'react-i18next';

interface FileInputSectionProps {
  videoFile: File | null;
  onOpenFileDialog: () => void;
  isDownloadInProgress: boolean;
  isTranslationInProgress: boolean;
}

const sectionStyle = css`
  padding: 13px 20px;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  background-color: ${colors.surface};
`;

const labelStyle = {
  marginRight: '12px',
  display: 'inline-block',
  minWidth: '220px',
} as const;

export default function FileInputSection({
  videoFile,
  onOpenFileDialog,
  isDownloadInProgress,
  isTranslationInProgress,
}: FileInputSectionProps) {
  const { t } = useTranslation();

  return (
    <div className={sectionStyle}>
      <label style={labelStyle}>{t('input.selectVideoAudioFile')}:</label>
      <FileButton
        onFileSelect={onOpenFileDialog}
        disabled={isDownloadInProgress || isTranslationInProgress}
      >
        {videoFile
          ? `${t('common.selected')}: ${videoFile.name}`
          : t('input.selectFile')}
      </FileButton>
    </div>
  );
}
