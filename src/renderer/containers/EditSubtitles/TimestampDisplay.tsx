import React, { useState } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles';
import Button from '../../components/Button';
import { openSubtitleWithElectron } from '../../helpers';
import { SrtSegment } from '../../../types/interface';
import { VideoQuality } from '../../../types/interface';

interface TimestampDisplayProps {
  onChangeVideo?: (file: File | { path: string; name: string }) => void;
  onLoadFromUrl?: (url: string, quality: VideoQuality) => void;
  hasSubtitles?: boolean;
  onShiftAllSubtitles?: (offsetSeconds: number) => void;
  onScrollToCurrentSubtitle?: () => void;
  onSrtLoaded: (segments: SrtSegment[]) => void;
  onUiInteraction?: () => void;
  isUrlLoading?: boolean;
  urlLoadProgress?: number;
  urlLoadStage?: string;
}

// Simple input style similar to time inputs in editor - Updated for Dark Theme
const shiftInputStyles = css`
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
`;

// --- Style for URL Input --- START ---
const urlInputStyles = css`
  max-width: 35%;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid ${colors.border};
  background-color: ${colors.light};
  color: ${colors.dark};
  font-family: sans-serif; // Use standard font
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
`;
// --- Style for URL Input --- END ---

// --- Styles for Quality Select --- START ---
const qualitySelectStyles = css`
  padding: 6px 4px; // Slightly less padding than input
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
`;
// --- Styles for Quality Select --- END ---

// --- Styles for Progress Bar --- START ---
const progressBarContainerStyles = css`
  height: 10px;
  background-color: ${colors.grayLight};
  border-radius: 5px;
  overflow: hidden;
  margin: 5px 0;
  width: 100%; // Take full width of its container
`;

const progressBarStyles = (progress: number) => css`
  height: 100%;
  width: ${progress}%;
  background-color: ${colors.primary};
  transition: width 0.3s ease;
  border-radius: 5px;
`;

const progressTextStyles = css`
  font-size: 0.8rem;
  color: ${colors.grayDark};
  text-align: center;
  width: 100%;
  margin-top: 2px;
`;
// --- Styles for Progress Bar --- END ---

export function TimestampDisplay({
  onChangeVideo,
  onLoadFromUrl,
  hasSubtitles = false,
  onShiftAllSubtitles,
  onScrollToCurrentSubtitle,
  onSrtLoaded,
  onUiInteraction,
  isUrlLoading = false,
  urlLoadProgress = 0,
  urlLoadStage = '',
}: TimestampDisplayProps) {
  // State for the shift input field
  const [shiftAmount, setShiftAmount] = useState<string>('0');
  const [urlInputValue, setUrlInputValue] = useState<string>('');
  const [urlError, setUrlError] = useState<string>('');
  const [selectedQuality, setSelectedQuality] = useState<VideoQuality>('mid');

  // Determine visibility of optional sections
  const shouldShowScrollButton = onScrollToCurrentSubtitle && hasSubtitles;
  const shouldShowShiftControls = onShiftAllSubtitles && hasSubtitles;
  const onlyTopButtonsBlockVisible =
    !shouldShowScrollButton && !shouldShowShiftControls;

  // Handlers for video/srt buttons
  const handleVideoChangeClick = async () => {
    if (!window.electron?.openFile) {
      console.error('Electron openFile API is not available.');
      // Optionally show an error message to the user
      return;
    }
    try {
      const result = await window.electron.openFile({
        filters: [
          {
            name: 'Video Files',
            extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'],
          },
        ],
        title: 'Select Video File',
      });

      if (result.canceled || !result.filePaths?.length) {
        console.log('Video selection cancelled.');
        return;
      }

      const filePath = result.filePaths[0];
      console.log('Selected video file path:', filePath);

      if (onChangeVideo) {
        const fileData = {
          name: filePath.split(/[\\/]/).pop() || 'video.mp4',
          path: filePath,
          size: 0,
          type: '',
        };
        onChangeVideo(fileData as any);
        onUiInteraction?.();
      }
    } catch (error) {
      console.error('Error opening video file with Electron:', error);
      // Optionally show an error message to the user
    }
  };

  // --- Handler for Load URL Button (Updated) --- START ---
  const handleLoadUrlClick = () => {
    setUrlError('');
    if (!urlInputValue.trim()) {
      setUrlError('Please enter a valid URL.');
      return;
    }
    if (
      !urlInputValue.startsWith('http://') &&
      !urlInputValue.startsWith('https://')
    ) {
      setUrlError('URL must start with http:// or https://');
      return;
    }

    if (onLoadFromUrl) {
      onLoadFromUrl(urlInputValue, selectedQuality);
      onUiInteraction?.();
    } else {
      console.warn('onLoadFromUrl prop is not provided to TimestampDisplay');
    }
  };
  // --- Handler for Load URL Button (Updated) --- END ---

  const handleSrtLoad = async () => {
    try {
      const result = await openSubtitleWithElectron();
      if (result.segments) {
        onSrtLoaded(result.segments);
      } else if (result.error && !result.error.includes('canceled')) {
        console.error('Error loading SRT:', result.error);
        // Consider showing an error message to the user
      }
      onUiInteraction?.();
    } catch (err) {
      console.error('Failed to load SRT file:', err);
    }
  };

  // Handler for applying the shift
  const handleApplyShift = () => {
    const offset = parseFloat(shiftAmount);
    if (onShiftAllSubtitles && !isNaN(offset) && offset !== 0) {
      onShiftAllSubtitles(offset);
      // Optional: Reset input after applying, or leave it
      // setShiftAmount('0');
    }
  };

  // Simplified component with only the necessary buttons
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
        height: 100%;
        overflow-y: auto;
      `}
    >
      {/* Video, SRT Buttons */}
      <div
        className={css`
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          ${onlyTopButtonsBlockVisible ? 'margin-top: auto;' : ''}
        `}
      >
        {onChangeVideo && (
          <Button
            onClick={handleVideoChangeClick}
            variant="secondary"
            size="sm"
            title="Load a different video file"
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
              <span>Change Video</span>
            </div>
          </Button>
        )}

        {/* --- URL Input Section (Conditional Rendering) --- START --- */}
        {onLoadFromUrl && (
          <div
            className={css`
              margin-top: 10px; // Space above URL section
            `}
          >
            {isUrlLoading ? (
              // --- Progress Display --- START ---
              <div
                className={css`
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  padding: 10px 5px;
                  border: 1px solid ${colors.border};
                  border-radius: 4px;
                  background-color: ${colors.light};
                `}
              >
                <div className={progressBarContainerStyles}>
                  <div className={progressBarStyles(urlLoadProgress)} />
                </div>
                <span className={progressTextStyles}>
                  {urlLoadStage || 'Loading...'} ({urlLoadProgress.toFixed(0)}%)
                </span>
              </div>
            ) : (
              // --- Input / Quality / Load Button --- START ---
              <div
                className={css`
                  display: flex;
                  align-items: stretch; // Align items vertically
                  width: 100%;
                `}
              >
                <input
                  type="url"
                  placeholder="Enter Video URL..."
                  value={urlInputValue}
                  onChange={e => setUrlInputValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLoadUrlClick()}
                  className={urlInputStyles}
                  title="Enter the URL of the video to load"
                  disabled={isUrlLoading} // Disable input while loading
                />
                <select
                  value={selectedQuality}
                  onChange={e =>
                    setSelectedQuality(e.target.value as VideoQuality)
                  }
                  className={qualitySelectStyles}
                  title="Select download quality"
                  disabled={isUrlLoading} // Disable select while loading
                >
                  <option value="low">Low</option>
                  <option value="mid">Mid</option>
                  <option value="high">High</option>
                </select>
                <Button
                  onClick={handleLoadUrlClick}
                  variant="secondary"
                  size="sm"
                  title="Load video from URL"
                  disabled={isUrlLoading} // Disable button while loading
                >
                  Load
                </Button>
              </div>
              // --- Input / Quality / Load Button --- END ---
            )}
            {/* Error message display */}
            {urlError && !isUrlLoading && (
              <div
                className={css`
                  color: ${colors.danger};
                  font-size: 0.8rem;
                  margin-top: 4px;
                `}
              >
                {urlError}
              </div>
            )}
          </div>
        )}
        {/* --- URL Input Section (Conditional Rendering) --- END --- */}

        <Button
          variant="secondary"
          size="sm"
          onClick={handleSrtLoad}
          title={
            hasSubtitles ? 'Load a different SRT file' : 'Load an SRT file'
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
            <span>{hasSubtitles ? 'Change SRT' : 'Add SRT'}</span>
          </div>
        </Button>
      </div>

      {/* Scroll to Current Button */}
      {shouldShowScrollButton && (
        <Button
          onClick={() => {
            // Call onUiInteraction first to ignore upcoming scroll events
            if (onUiInteraction) onUiInteraction();
            // Then scroll to current subtitle
            onScrollToCurrentSubtitle();
          }}
          title="Scroll to current subtitle"
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
            Scroll to Current
          </span>
        </Button>
      )}

      {/* Shift Controls */}
      {shouldShowShiftControls && (
        <div
          className={css`
            display: flex;
            align-items: center;
            width: 100%;
            margin-top: auto; /* Push to bottom */
          `}
        >
          <input
            type="number"
            value={shiftAmount}
            onChange={e => setShiftAmount(e.target.value)}
            onBlur={handleApplyShift}
            onKeyDown={e => e.key === 'Enter' && handleApplyShift()}
            className={shiftInputStyles}
            step="0.1"
            placeholder="Shift (s)"
            title="Shift all subtitles by seconds (+/-)"
          />
          <Button
            onClick={handleApplyShift}
            size="sm"
            variant="secondary"
            title="Apply subtitle shift"
            style={{ flexGrow: 1 }}
          >
            Apply Shift
          </Button>
        </div>
      )}
    </div>
  );
}
