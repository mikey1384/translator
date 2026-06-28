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
  TRANSLATION_LANGUAGE_GROUPS,
  TRANSLATION_LANGUAGES_BASE,
} from '../../../constants/translation-languages';
import {
  borderRadius,
  fontSize,
  fontWeight,
  lineHeight,
  spacing,
} from '../../../components/design-system/tokens.js';
import type { RecentLocalMediaItem } from '../../../state/recent-local-media.js';

// How far the post-download pipeline should run before stopping. The stops are
// cumulative: 'transcribe' implies download, 'translate' implies transcribe.
export type AutoRunTarget = 'download' | 'transcribe' | 'translate';

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

  // Auto-run: how far to chain after download (download → transcribe → translate).
  // Optional so reuse sites (e.g. the "Change Video" modal) can omit it; the
  // selector only renders when setAutoRunTarget is provided.
  autoRunTarget?: AutoRunTarget;
  setAutoRunTarget?: (value: AutoRunTarget) => void;
  autoRunLanguage?: string;
  setAutoRunLanguage?: (value: string) => void;
}

const autoRunRowStyles = css`
  display: grid;
  gap: ${spacing.sm};
  padding-top: ${spacing.xs};
`;

const autoRunLabelStyles = css`
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${colors.textDim};
`;

const autoRunSegmentedStyles = css`
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  padding: 3px;
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.full};
  background: rgba(255, 255, 255, 0.03);
  width: fit-content;
  max-width: 100%;
  flex-wrap: wrap;
`;

const autoRunSegmentStyles = (active: boolean) => css`
  appearance: none;
  border: 0;
  border-radius: ${borderRadius.full};
  padding: 0.4rem 0.85rem;
  font-size: ${fontSize.sm};
  font-weight: ${active ? fontWeight.semibold : fontWeight.medium};
  cursor: pointer;
  white-space: nowrap;
  color: ${active ? colors.text : colors.textDim};
  background: ${active ? 'rgba(125, 167, 255, 0.16)' : 'transparent'};
  transition:
    background-color 120ms ease,
    color 120ms ease;

  &:hover:not(:disabled) {
    color: ${colors.text};
    background: ${active
      ? 'rgba(125, 167, 255, 0.22)'
      : 'rgba(255, 255, 255, 0.06)'};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const autoRunLanguageRowStyles = css`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  font-size: ${fontSize.sm};
  color: ${colors.textDim};

  label {
    white-space: nowrap;
  }

  select {
    flex: 1;
    min-width: 0;
  }
`;

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
  autoRunTarget = 'download',
  setAutoRunTarget,
  autoRunLanguage = 'english',
  setAutoRunLanguage,
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
                      aria-label={t(
                        'input.videoSuggestion.removeHistoryItem',
                        'Remove'
                      )}
                      title={t(
                        'input.videoSuggestion.removeHistoryItem',
                        'Remove'
                      )}
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
                  : autoRunTarget === 'translate'
                    ? t('input.downloadAndTranslate', 'Download & Translate')
                    : autoRunTarget === 'transcribe'
                      ? t(
                          'input.downloadAndTranscribe',
                          'Download & Transcribe'
                        )
                      : t('common.download')}
              </Button>
            </div>
          </div>

          {setAutoRunTarget ? (
            <div className={autoRunRowStyles}>
              <span className={autoRunLabelStyles}>
                {t('input.autoRunLabel', 'After download, run to')}
              </span>
              <div
                className={autoRunSegmentedStyles}
                role="radiogroup"
                aria-label={t('input.autoRunLabel', 'After download, run to')}
              >
                {(['download', 'transcribe', 'translate'] as const).map(
                  value => {
                    const labels: Record<AutoRunTarget, string> = {
                      download: t('input.autoRunStopDownload', 'Download'),
                      transcribe: t(
                        'input.autoRunStopTranscribe',
                        '+ Subtitles'
                      ),
                      translate: t('input.autoRunStopTranslate', '+ Translate'),
                    };
                    const active = autoRunTarget === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={autoRunSegmentStyles(active)}
                        onClick={() => setAutoRunTarget(value)}
                        disabled={
                          isDownloadInProgress || isTranslationInProgress
                        }
                      >
                        {labels[value]}
                      </button>
                    );
                  }
                )}
              </div>
              {autoRunTarget === 'translate' ? (
                <div className={autoRunLanguageRowStyles}>
                  <label htmlFor="auto-run-language-select">
                    {t('subtitles.outputLanguage', 'Output language')}:
                  </label>
                  <select
                    id="auto-run-language-select"
                    className={selectStyles}
                    value={autoRunLanguage}
                    onChange={e => setAutoRunLanguage?.(e.target.value)}
                    disabled={isDownloadInProgress || isTranslationInProgress}
                  >
                    {TRANSLATION_LANGUAGES_BASE.map(option => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                    {TRANSLATION_LANGUAGE_GROUPS.map(group => (
                      <optgroup key={group.labelKey} label={t(group.labelKey)}>
                        {group.options.map(option => (
                          <option key={option.value} value={option.value}>
                            {t(option.labelKey)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
