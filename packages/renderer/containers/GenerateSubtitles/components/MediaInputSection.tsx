import { css } from '@emotion/css';
import { CircleCheckBig, Globe, HardDrive, X } from 'lucide-react';
import {
  colors,
  inputStyles as sharedInputStyles,
  selectStyles,
} from '../../../styles.js';
import { FileButton } from '../../../components/design-system/index.js';
import Button from '../../../components/Button.js';
import { logButton } from '../../../utils/logger';
import { VideoQuality } from '@shared-types/app';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  borderRadius,
  fontSize,
  fontWeight,
  lineHeight,
  spacing,
} from '../../../components/design-system/tokens.js';
import type { RecentLocalMediaItem } from '../../../state/recent-local-media.js';

interface MediaInputSectionProps {
  // File input props
  videoFile: File | null;
  recentMedia: RecentLocalMediaItem[];
  onOpenFileDialog: () => Promise<{ canceled: boolean; selectedPath?: string }>;
  onOpenRecentFile: (path: string) => Promise<void> | void;
  onRemoveRecentFile: (path: string) => void;
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
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: ${spacing.lg};
  margin: ${spacing.md} 0 0;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

const optionCardStyles = css`
  padding: ${spacing.lg};
  border: 1px solid ${colors.borderStrong};
  border-radius: ${borderRadius['2xl']};
  background-color: ${colors.surface};
  position: relative;
  min-width: 0;
  display: grid;
  align-content: start;
  gap: ${spacing.md};

  transition:
    border-color 120ms ease,
    box-shadow 120ms ease,
    background-color 120ms ease;

  &:hover {
    border-color: ${colors.primary};
    background: linear-gradient(
      180deg,
      rgba(125, 167, 255, 0.05),
      rgba(255, 255, 255, 0.01)
    );
    box-shadow:
      0 0 0 1px rgba(125, 167, 255, 0.16),
      0 4px 12px rgba(0, 0, 0, 0.1);
  }

  &.selected {
    border-color: ${colors.primary};
    background-color: ${colors.primary}05;
  }
`;

const optionHeaderStyles = css`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  min-width: 0;
`;

const optionHeaderTextStyles = css`
  min-width: 0;
  display: grid;
  gap: 2px;
`;

const optionHeaderTitleStyles = css`
  font-size: ${fontSize.xl};
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
  letter-spacing: -0.02em;
`;

const optionHeaderMetaStyles = css`
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.normal};
  color: ${colors.gray};
  line-height: ${lineHeight.normal};
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

  & > svg {
    width: 18px;
    height: 18px;
  }
`;

const fileInputAreaStyles = css`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: ${spacing.md};
  flex-wrap: wrap;
`;

const deviceCardBodyStyles = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 0.86fr);
  gap: ${spacing.lg};
  align-items: start;

  @media (max-width: 1180px) {
    grid-template-columns: 1fr;
  }
`;

const devicePrimaryColumnStyles = css`
  display: grid;
  gap: ${spacing.md};
  align-content: start;
`;

const recentSectionStyles = css`
  display: grid;
  gap: ${spacing.sm};
  min-width: 0;
`;

const recentSectionTitleStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const recentListStyles = css`
  display: grid;
  gap: ${spacing.sm};
`;

const recentItemShellStyles = css`
  position: relative;
`;

const recentItemButtonStyles = css`
  width: 100%;
  min-width: 0;
  text-align: left;
  display: grid;
  gap: 2px;
  padding: ${spacing.sm} ${spacing.xl} ${spacing.sm} ${spacing.md};
  border-radius: ${borderRadius.xl};
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.text};
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    color 120ms ease;

  &:hover:not(:disabled) {
    border-color: ${colors.primary};
    background: rgba(125, 167, 255, 0.08);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const recentItemNameStyles = css`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: ${fontSize.sm};
  font-weight: ${fontWeight.medium};
`;

const recentItemMetaStyles = css`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  line-height: ${lineHeight.normal};
`;

const recentItemRemoveButtonStyles = css`
  position: absolute;
  top: ${spacing.xs};
  right: ${spacing.xs};
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: ${borderRadius.full};
  background: rgba(255, 255, 255, 0.06);
  color: ${colors.textDim};
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;

  &:hover {
    background: rgba(255, 255, 255, 0.14);
    color: ${colors.text};
  }
`;

const urlInputAreaStyles = css`
  display: grid;
  gap: ${spacing.md};
  width: 100%;
  min-width: 0;
`;

const urlInputRowStyles = css`
  display: grid;
  gap: ${spacing.md};
  width: 100%;
`;

const urlInputStyles = css`
  ${sharedInputStyles}
  width: 100%;
  max-width: none;
`;

const urlControlsRowStyles = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: ${spacing.md};
  align-items: center;

  select {
    width: 100%;
    max-width: none;
  }

  @media (max-width: 780px) {
    grid-template-columns: 1fr;
  }
`;

const fileSelectedStyles = css`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  color: ${colors.success};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.normal};
`;

// Removed local qualitySelectStyles in favor of shared dark selectStyles

export default function MediaInputSection({
  videoFile,
  recentMedia,
  onOpenFileDialog,
  onOpenRecentFile,
  onRemoveRecentFile,
  isDownloadInProgress,
  isTranslationInProgress,
  urlInput,
  setUrlInput,
  downloadQuality,
  setDownloadQuality,
  handleProcessUrl,
}: MediaInputSectionProps) {
  const { t } = useTranslation();
  const hasRecentMedia = recentMedia.length > 0;

  const selectedFileLabel = useMemo(
    () =>
      videoFile
        ? `${t('common.selected')}: ${videoFile.name}`
        : t('input.chooseFile'),
    [t, videoFile]
  );

  const handleDeviceFileSelect = async () => {
    logButton('select_file_from_device');
    await onOpenFileDialog();
  };

  const handleOpenRecent = async (path: string) => {
    await onOpenRecentFile(path);
  };

  return (
    <div className={containerStyles}>
      {/* Local File Option */}
      <div className={optionCardStyles}>
        <div className={optionHeaderStyles}>
          <div className={iconPlaceholderStyles}>
            <HardDrive strokeWidth={2.2} />
          </div>
          <div className={optionHeaderTextStyles}>
            <div className={optionHeaderTitleStyles}>
              {t('input.fromDevice')}
            </div>
            <div className={optionHeaderMetaStyles}>
              {t('input.selectLocalFile')}
            </div>
          </div>
        </div>

        <div className={deviceCardBodyStyles}>
          <div className={devicePrimaryColumnStyles}>
            <div className={fileInputAreaStyles}>
              <FileButton
                onFileSelect={handleDeviceFileSelect}
                disabled={isTranslationInProgress}
                size="md"
              >
                {selectedFileLabel}
              </FileButton>
              {videoFile && (
                <span className={fileSelectedStyles}>
                  <CircleCheckBig size={16} strokeWidth={2.2} />
                  {t('input.fileSelected')}
                </span>
              )}
            </div>
          </div>

          {hasRecentMedia ? (
            <div className={recentSectionStyles}>
              <div className={recentSectionTitleStyles}>
                {t('input.recentMedia', 'Recent files')}
              </div>
              <div className={recentListStyles}>
                {recentMedia.map(item => (
                  <div key={item.path} className={recentItemShellStyles}>
                    <button
                      type="button"
                      className={recentItemButtonStyles}
                      onClick={() => {
                        void handleOpenRecent(item.path);
                      }}
                      disabled={isTranslationInProgress}
                      title={item.path}
                    >
                      <div className={recentItemNameStyles}>{item.name}</div>
                      <div className={recentItemMetaStyles}>{item.path}</div>
                    </button>
                    <button
                      type="button"
                      className={recentItemRemoveButtonStyles}
                      aria-label={t('common.remove', 'Remove')}
                      title={t('common.remove', 'Remove')}
                      onClick={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRemoveRecentFile(item.path);
                      }}
                    >
                      <X size={14} strokeWidth={2.2} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Web URL Option */}
      <div className={optionCardStyles}>
        <div className={optionHeaderStyles}>
          <div className={iconPlaceholderStyles}>
            <Globe strokeWidth={2.2} />
          </div>
          <div className={optionHeaderTextStyles}>
            <div className={optionHeaderTitleStyles}>{t('input.fromWeb')}</div>
            <div className={optionHeaderMetaStyles}>
              {t('input.downloadFromUrl')}
            </div>
          </div>
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
            <div className={urlControlsRowStyles}>
              <select
                className={selectStyles}
                value={downloadQuality}
                onChange={e =>
                  setDownloadQuality(e.target.value as VideoQuality)
                }
                disabled={isDownloadInProgress || isTranslationInProgress}
              >
                <optgroup label={t('input.qualityPresets', 'Presets')}>
                  <option value="high">{t('input.qualityBest', 'Best')}</option>
                  <option value="mid">{t('input.qualityMedium')}</option>
                  <option value="low">{t('input.qualityLow')}</option>
                </optgroup>
                <optgroup label={t('input.qualityResolution', 'Resolution')}>
                  <option value="4320p">
                    {t('input.quality8k', 'UHD 8K')}
                  </option>
                  <option value="2160p">{t('input.quality4k', 'HD 4K')}</option>
                  <option value="1440p">{t('input.quality2k', 'HQ 2K')}</option>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="480p">480p</option>
                  <option value="360p">360p</option>
                  <option value="240p">240p</option>
                </optgroup>
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
    </div>
  );
}
