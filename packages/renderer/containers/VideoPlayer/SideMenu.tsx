import { useState } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import Button from '../../components/Button.js';
import { openSubtitleWithElectron } from '../../../shared/helpers/index.js';
import { SrtSegment, VideoQuality } from '@shared-types/app';
import { useTranslation } from 'react-i18next';
import { useTaskStore, useSubStore } from '../../state';
import { useUrlStore } from '../../state/url-store';

export interface SideMenuProps {
  onShiftAllSubtitles?: (offsetSeconds: number) => void;
  onScrollToCurrentSubtitle?: () => void;
  onSelectVideoClick: () => void;
  onSetSubtitleSegments: (segments: SrtSegment[], filePath: string) => void;
  onUiInteraction?: () => void;
}

export default function SideMenu({
  onShiftAllSubtitles,
  onScrollToCurrentSubtitle,
  onSelectVideoClick,
  onSetSubtitleSegments,
  onUiInteraction,
}: SideMenuProps) {
  const { t } = useTranslation();
  const {
    urlInput,
    setUrlInput,
    downloadQuality,
    setDownloadQuality,
    download,
    downloadMedia,
  } = useUrlStore();
  const { merge, translation } = useTaskStore();
  const subtitleCount = useSubStore(s => s.order.length);
  const [shiftAmount, setShiftAmount] = useState<string>('0');
  const hasSubtitles = subtitleCount > 0;
  const isProcessingUrl = download.inProgress;
  const isMergingInProgress = merge.inProgress;
  const isTranslationInProgress = translation.inProgress;
  const shouldShowScrollButton = !!onScrollToCurrentSubtitle && hasSubtitles;
  const shouldShowShiftControls = !!onShiftAllSubtitles && hasSubtitles;
  const onlyTopButtonsBlock =
    !shouldShowScrollButton && !shouldShowShiftControls;

  return (
    <div
      className={css`
        display: flex;
        height: 100%;
        width: 100%;
        box-sizing: border-box;
        font-family:
          'system-ui',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        color: ${colors.dark};
        border-radius: 8px;
        font-size: 14px;
        flex-direction: column;
        padding: 10px;
        gap: 10px;
        overflow-y: auto;
      `}
    >
      <div
        className={css`
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          ${onlyTopButtonsBlock ? 'margin-top: auto;' : ''}
        `}
      >
        <Button
          onClick={onSelectVideoClick}
          variant="secondary"
          size="sm"
          title={t('videoPlayer.sideMenu.changeVideoAudio')}
          className={css`
            width: 100%;
            justify-content: flex-start;
            padding: 8px 12px;
          `}
        >
          <div
            className={css`
              display: inline-flex;
              align-items: center;
              gap: 6px;
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
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{t('videoPlayer.sideMenu.changeVideoAudio')}</span>
          </div>
        </Button>

        <div
          className={css`
            display: flex;
            align-items: stretch;
            width: 100%;
          `}
        >
          <input
            type="url"
            placeholder={t('videoPlayer.sideMenu.enterUrlPlaceholder')}
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.stopPropagation();
              }
            }}
            className={css`
              max-width: 35%;
              padding: 6px 8px;
              border-radius: 4px;
              border: 1px solid ${colors.border};
              background-color: ${colors.light};
              color: ${colors.dark};
              font-family: sans-serif;
              font-size: 0.9rem;
              margin-right: 5px;
              transition: border-color 0.2s ease;
              &:focus {
                outline: none;
                border-color: ${colors.primary};
              }
              &::placeholder {
                color: ${colors.gray};
              }
            `}
            title={t('videoPlayer.sideMenu.enterUrlPlaceholder')}
          />
          <select
            value={downloadQuality}
            onChange={e => setDownloadQuality(e.target.value as VideoQuality)}
            className={css`
              padding: 6px 4px;
              border-radius: 4px;
              border: 1px solid ${colors.border};
              background-color: ${colors.light};
              color: ${colors.dark};
              font-family: sans-serif;
              font-size: 0.85rem;
              margin-left: 5px;
              margin-right: 5px;
              cursor: pointer;
              &:focus {
                outline: none;
                border-color: ${colors.primary};
              }
            `}
            title={t('input.quality')}
          >
            <option value="high">
              {t('videoPlayer.sideMenu.qualityHigh')}
            </option>
            <option value="mid">{t('videoPlayer.sideMenu.qualityMid')}</option>
            <option value="low">{t('videoPlayer.sideMenu.qualityLow')}</option>
          </select>
          <Button
            onClick={() => {
              downloadMedia();
              onUiInteraction?.();
            }}
            variant="secondary"
            size="sm"
            title={t('videoPlayer.sideMenu.loadVideoFromUrl')}
            disabled={
              !urlInput.trim() ||
              isTranslationInProgress ||
              isProcessingUrl ||
              isMergingInProgress
            }
          >
            {t('videoPlayer.sideMenu.load')}
          </Button>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={handleSrtLoad}
          title={
            hasSubtitles
              ? t('videoPlayer.sideMenu.loadDifferentSrtFile')
              : t('videoPlayer.sideMenu.loadSrtFile')
          }
          className={css`
            width: 100%;
            justify-content: flex-start;
            padding: 8px 12px;
          `}
        >
          <div
            className={css`
              display: inline-flex;
              align-items: center;
              gap: 6px;
            `}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <span>
              {hasSubtitles
                ? t('videoPlayer.sideMenu.changeSrt')
                : t('videoPlayer.sideMenu.addSrt')}
            </span>
          </div>
        </Button>
      </div>

      {shouldShowScrollButton && (
        <Button
          onClick={() => {
            if (onUiInteraction) onUiInteraction();
            onScrollToCurrentSubtitle();
          }}
          title={t('videoPlayer.sideMenu.scrollToCurrent')}
          size="sm"
          variant="secondary"
          className={css`
            width: 100%;
            justify-content: flex-start;
            padding: 8px 12px;
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
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          <span
            className={css`
              margin-left: 6px;
            `}
          >
            {t('videoPlayer.sideMenu.scrollToCurrent')}
          </span>
        </Button>
      )}

      {shouldShowShiftControls && (
        <div
          className={css`
            display: flex;
            align-items: center;
            width: 100%;
            margin-top: auto; /* Push to bottom */
          `}
        >
          <label
            className={css`
              margin-right: 5px;
            `}
          >
            {t('videoPlayer.sideMenu.shiftLabel')}
          </label>
          <div
            className={css`
              display: flex;
              align-items: center;
              width: 100%;
            `}
          >
            <input
              type="number"
              value={shiftAmount}
              onChange={e => setShiftAmount(e.target.value)}
              onBlur={handleApplyShift}
              onKeyDown={e => e.key === 'Enter' && handleApplyShift()}
              className={css`
                width: 80px;
                padding: 6px 8px;
                border-radius: 4px;
                border: 1px solid ${colors.border};
                background-color: ${colors.light};
                color: ${colors.dark};
                font-family: monospace;
                text-align: right;
                margin-right: 5px;
                transition: border-color 0.2s ease;
                &:focus {
                  outline: none;
                  border-color: ${colors.primary};
                }
              `}
              step="0.1"
              placeholder="Shift (s)"
              title="Shift all subtitles by seconds (+/-)"
            />
            <Button
              onClick={handleApplyShift}
              size="sm"
              variant="secondary"
              disabled={!shiftAmount || parseFloat(shiftAmount) === 0}
            >
              {t('videoPlayer.sideMenu.applyShift')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  async function handleSrtLoad() {
    try {
      const result = await openSubtitleWithElectron();
      if (result.filePath && result.segments) {
        onSetSubtitleSegments(result.segments, result.filePath);
      } else if (result.error && !result.error.includes('canceled')) {
        console.error('Error loading SRT:', result.error);
      }
      onUiInteraction?.();
    } catch (err) {
      console.error('Failed to load SRT file:', err);
    }
  }

  function handleApplyShift() {
    const offset = parseFloat(shiftAmount);
    if (onShiftAllSubtitles && !isNaN(offset) && offset !== 0) {
      onShiftAllSubtitles(offset);
    }
  }
}
