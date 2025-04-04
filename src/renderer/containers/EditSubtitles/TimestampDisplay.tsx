import React, { useState, ChangeEvent } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles';
import Button from '../../components/Button';
import { openSubtitleWithElectron } from '../../helpers/subtitle-utils';
import { SrtSegment } from '../../../types/interface';

interface TimestampDisplayProps {
  _isPlaying: boolean;
  _videoElement: HTMLVideoElement | null;
  onChangeVideo?: (file: File) => void;
  hasSubtitles?: boolean;
  _onTogglePlay?: () => void;
  onShiftAllSubtitles?: (offsetSeconds: number) => void;
  onScrollToCurrentSubtitle?: () => void;
  onSrtLoaded: (segments: SrtSegment[]) => void;
  onUiInteraction?: () => void;
  _isStickyExpanded?: boolean;
  _isPseudoFullscreen?: boolean;
  _onTogglePseudoFullscreen?: () => void;
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

// Adjusted type for file change events from Button
type FileChangeEvent =
  | ChangeEvent<HTMLInputElement>
  | { target: { files: FileList | { name: string; path: string }[] | null } };

export function TimestampDisplay({
  _isPlaying,
  _videoElement,
  onChangeVideo,
  hasSubtitles = false,
  _onTogglePlay,
  onShiftAllSubtitles,
  onScrollToCurrentSubtitle,
  onSrtLoaded,
  onUiInteraction,
  _isStickyExpanded = true,
  _isPseudoFullscreen = false,
  _onTogglePseudoFullscreen,
}: TimestampDisplayProps) {
  // State for the shift input field
  const [shiftAmount, setShiftAmount] = useState<string>('0');

  // Handlers for video/srt buttons
  const handleVideoChange = (event: FileChangeEvent) => {
    let file: File | null = null;
    if (
      'target' in event &&
      event.target &&
      'files' in event.target &&
      event.target.files instanceof FileList &&
      event.target.files.length > 0
    ) {
      file = event.target.files[0];
    }
    if (file && onChangeVideo) {
      onChangeVideo(file);
      onUiInteraction?.();
    }
  };

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
        `}
      >
        {onChangeVideo && (
          <Button
            asFileInput
            accept="video/*"
            onFileChange={handleVideoChange}
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
      {onScrollToCurrentSubtitle && hasSubtitles && (
        <Button
          onClick={onScrollToCurrentSubtitle}
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
      {onShiftAllSubtitles && hasSubtitles && (
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
