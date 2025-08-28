import React from 'react';
import { css } from '@emotion/css';
import { colors, selectStyles } from '../../../styles.js';
import { FileButton } from '../../../components/design-system/index.js';
import Button from '../../../components/Button.js';
import { VideoQuality } from '@shared-types/app';
import { useTranslation } from 'react-i18next';

interface MediaInputSectionProps {
  // File input props
  videoFile: File | null;
  onOpenFileDialog: () => void;
  isDownloadInProgress: boolean;
  isTranslationInProgress: boolean;

  // URL input props
  urlInput: string;
  setUrlInput: (value: string) => void;
  downloadQuality: VideoQuality;
  setDownloadQuality: (quality: VideoQuality) => void;
  handleProcessUrl: () => void;
}

const containerStyles = css`
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin: 20px 0;
`;

const optionCardStyles = css`
  padding: 24px;
  border: 2px solid ${colors.border};
  border-radius: 12px;
  background-color: ${colors.light};
  transition: all 0.3s ease;
  position: relative;
  text-align: center;

  &:hover {
    border-color: ${colors.primary};
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  &.selected {
    border-color: ${colors.primary};
    background-color: ${colors.primary}05;
  }
`;

const optionHeaderStyles = css`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 16px;
  font-size: 1.1rem;
  font-weight: 600;
  color: ${colors.dark};
`;

const iconPlaceholderStyles = css`
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background-color: ${colors.primary};
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.2rem;
  font-weight: bold;
`;

const descriptionStyles = css`
  color: ${colors.grayDark};
  margin-bottom: 16px;
  font-size: 0.9rem;
  line-height: 1.4;
  text-align: center;
`;

const fileInputAreaStyles = css`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
`;

const urlInputAreaStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
`;

const urlInputRowStyles = css`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;

  input[type='url'] {
    flex-shrink: 1;
  }
  select {
    flex-shrink: 0;
  }
  button {
    flex-shrink: 0;
    white-space: nowrap;
  }
`;

const urlInputStyles = css`
  width: 100%;
  max-width: 560px;
  padding: 10px 14px;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  font-size: 0.95rem;
  background-color: white;
  transition: border-color 0.2s ease;

  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 3px ${colors.primary}20;
  }

  &::placeholder {
    color: ${colors.gray};
  }
`;

// Removed local qualitySelectStyles in favor of shared dark selectStyles

export default function MediaInputSection({
  videoFile,
  onOpenFileDialog,
  isDownloadInProgress,
  isTranslationInProgress,
  urlInput,
  setUrlInput,
  downloadQuality,
  setDownloadQuality,
  handleProcessUrl,
}: MediaInputSectionProps) {
  const { t } = useTranslation();

  return (
    <div className={containerStyles}>
      {/* Local File Option */}
      <div className={optionCardStyles}>
        <div className={optionHeaderStyles}>
          <div className={iconPlaceholderStyles}>💾</div>
          <div>
            <div>{t('input.fromDevice')}</div>
            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 'normal',
                color: colors.gray,
              }}
            >
              {t('input.selectLocalFile')}
            </div>
          </div>
        </div>

        <div className={descriptionStyles}>
          {t('input.localFileDescription') ||
            'Upload a video or audio file from your computer'}
        </div>

        <div className={fileInputAreaStyles}>
          <FileButton
            onFileSelect={onOpenFileDialog}
            disabled={isDownloadInProgress || isTranslationInProgress}
          >
            {videoFile
              ? `${t('common.selected')}: ${videoFile.name}`
              : t('input.chooseFile')}
          </FileButton>
          {videoFile && (
            <span style={{ color: colors.success, fontSize: '0.9rem' }}>
              ✓ {t('input.fileSelected')}
            </span>
          )}
        </div>
      </div>

      {/* Web URL Option */}
      <div className={optionCardStyles}>
        <div className={optionHeaderStyles}>
          <div className={iconPlaceholderStyles}>🌐</div>
          <div>
            <div>{t('input.fromWeb')}</div>
            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 'normal',
                color: colors.gray,
              }}
            >
              {t('input.downloadFromUrl')}
            </div>
          </div>
        </div>

        <div className={descriptionStyles}>
          {t('input.webDescription') ||
            'Download video from YouTube, Vimeo, or other platforms'}
        </div>

        <div className={urlInputAreaStyles}>
          <div className={urlInputRowStyles}>
            <input
              type="url"
              className={urlInputStyles}
              placeholder={t('input.enterVideoUrl')}
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              disabled={isTranslationInProgress || isDownloadInProgress}
            />
            <select
              className={selectStyles}
              value={downloadQuality}
              onChange={e => setDownloadQuality(e.target.value as VideoQuality)}
              disabled={isDownloadInProgress || isTranslationInProgress}
            >
              <option value="high">{t('input.qualityHigh')}</option>
              <option value="mid">{t('input.qualityMedium')}</option>
              <option value="low">{t('input.qualityLow')}</option>
            </select>
            <Button
              onClick={handleProcessUrl}
              disabled={
                !urlInput || isDownloadInProgress || isTranslationInProgress
              }
              isLoading={isDownloadInProgress}
              size="md"
              variant="secondary"
            >
              {isDownloadInProgress
                ? t('input.downloading')
                : t('common.download')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
