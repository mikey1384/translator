import React, { useEffect, useState, useCallback, ChangeEvent } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles';
import Button from '../../components/Button';
import { openSubtitleWithElectron } from '../../helpers/subtitle-utils';
import { SrtSegment } from '../../../types/interface';

interface TimestampDisplayProps {
  isPlaying: boolean;
  videoElement: HTMLVideoElement | null;
  onChangeVideo?: (file: File) => void;
  hasSubtitles?: boolean;
  onTogglePlay?: () => void;
  onShiftAllSubtitles?: (offsetSeconds: number) => void;
  onScrollToCurrentSubtitle?: () => void;
  onSrtLoaded: (segments: SrtSegment[]) => void;
  onUiInteraction?: () => void;
  isStickyExpanded?: boolean;
  isPseudoFullscreen?: boolean;
  onTogglePseudoFullscreen?: () => void;
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
  isPlaying,
  videoElement,
  onChangeVideo,
  hasSubtitles = false,
  onTogglePlay,
  onShiftAllSubtitles,
  onScrollToCurrentSubtitle,
  onSrtLoaded,
  onUiInteraction,
  isStickyExpanded = true,
  isPseudoFullscreen = false,
  onTogglePseudoFullscreen,
}: TimestampDisplayProps) {
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedWidth, setBufferedWidth] = useState<string>('0%');
  // State for the shift input field
  const [shiftAmount, setShiftAmount] = useState<string>('0');

  const formatTime = useCallback((seconds: number): string => {
    if (isNaN(seconds)) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(
        2,
        '0'
      )}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, []);

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

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (videoElement) {
      const seekTime = parseFloat(e.target.value);
      videoElement.currentTime = seekTime;
      onUiInteraction?.();
    }
  };

  useEffect(() => {
    if (!videoElement) return;

    setCurrentTime(videoElement.currentTime || 0);
    setDuration(videoElement.duration || 0);

    const updateBufferedWidth = () => {
      if (videoElement.buffered.length > 0 && videoElement.duration) {
        const bufferedEnd = videoElement.buffered.end(
          videoElement.buffered.length - 1
        );
        const bufferedPercent = (bufferedEnd / videoElement.duration) * 100;
        setBufferedWidth(`${bufferedPercent.toFixed(1)}%`);
      }
    };

    updateBufferedWidth();

    const handleTimeUpdate = () => {
      setCurrentTime(videoElement.currentTime);
      updateBufferedWidth();
    };
    const handleDurationChange = () => {
      setDuration(videoElement.duration);
    };
    const handleProgress = () => {
      updateBufferedWidth();
    };

    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('durationchange', handleDurationChange);
    videoElement.addEventListener('progress', handleProgress);

    // Cleanup
    return () => {
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('durationchange', handleDurationChange);
      videoElement.removeEventListener('progress', handleProgress);
    };
  }, [videoElement]);

  // Handler for applying the shift
  const handleApplyShift = () => {
    const offset = parseFloat(shiftAmount);
    if (onShiftAllSubtitles && !isNaN(offset) && offset !== 0) {
      onShiftAllSubtitles(offset);
      // Optional: Reset input after applying, or leave it
      // setShiftAmount('0');
    }
  };

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
        ${isPseudoFullscreen
          ? `
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          padding: 10px 24px;
          background: transparent;
        `
          : `
          flex-direction: column;
          padding: 8px 12px;
          padding-top: 16px;
          justify-content: space-between;
          height: 100%;
        `}
      `}
    >
      {/* Top Buttons Section - Conditionally rendered */}
      {!isPseudoFullscreen && (
        <div
          className={css`
            display: flex;
            flex-direction: column;
            gap: 4px;
            width: 100%;
            margin-bottom: 8px;
            > div > button,
            > div > label {
              height: 40px;
              box-sizing: border-box;
              display: flex;
              align-items: center;
              justify-content: center;
              width: 100%;
            }
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
      )}

      {/* Combined controls area - Adapts based on fullscreen */}
      <div
        className={css`
          display: flex;
          width: 100%;
          ${isPseudoFullscreen
            ? `
            flex-direction: row;
            align-items: center;
            justify-content: space-between; 
            gap: 15px;
            padding: 10px 20px;
          `
            : `
            flex-direction: column;
            gap: 8px;
            flex-grow: 1;
            justify-content: center;
          `}
        `}
      >
        {/* Left side controls (Play, Scroll) OR Play/Time for fullscreen */}
        <div
          className={css`
            display: flex;
            align-items: center;
            gap: 10px;
            ${isPseudoFullscreen ? 'flex-grow: 1;' : ''}
            ${!isPseudoFullscreen ? 'width: 100%;' : ''}
          `}
        >
          {onTogglePlay && (
            <Button
              onClick={() => {
                if (onUiInteraction) {
                  onUiInteraction();
                }
                if (onTogglePlay) {
                  onTogglePlay();
                }
              }}
              variant={isPseudoFullscreen ? 'primary' : 'primary'}
              size="sm"
              className={css`
                ${isPseudoFullscreen
                  ? `
                  padding: 8px 14px;
                  border-radius: 6px;
                  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
                  svg {
                    width: 20px;
                    height: 20px;
                  }
                `
                  : ''}
              `}
            >
              {isPlaying ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width={isPseudoFullscreen ? '20' : '16'}
                  height={isPseudoFullscreen ? '20' : '16'}
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width={isPseudoFullscreen ? '20' : '16'}
                  height={isPseudoFullscreen ? '20' : '16'}
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  <path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z" />
                </svg>
              )}
            </Button>
          )}

          {/* Time/Seek Bar - Always show, adjusts layout */}
          <span
            className={css`
              font-size: ${isPseudoFullscreen ? '1.1rem' : '0.8rem'};
              min-width: 45px;
              text-align: right;
              font-family: monospace;
              color: white;
              ${isPseudoFullscreen
                ? 'text-shadow: 0 1px 2px rgba(0,0,0,0.8);'
                : ''}
            `}
          >
            {formatTime(currentTime)}
          </span>
          <div
            className={css`
              flex-grow: 1;
              position: relative;
              height: 12px;
              cursor: pointer;
            `}
          >
            <input
              type="range"
              min={0}
              max={duration || 1}
              value={currentTime}
              onChange={handleSeek}
              step="0.1"
              className={css`
                width: 100%;
                height: 6px;
                cursor: pointer;
                appearance: none;
                ${isPseudoFullscreen
                  ? `
                  height: 8px;
                  &::-webkit-slider-thumb {
                    width: 18px !important;
                    height: 18px !important;
                  }
                  &::-moz-range-thumb {
                    width: 18px !important;
                    height: 18px !important;
                  }
                `
                  : ''}
                background: linear-gradient(
                  to right,
                  ${colors.primary} 0%,
                  ${colors.primary} ${(
                  (currentTime / (duration || 1)) *
                  100
                ).toFixed(1)}%,
                  rgba(255, 255, 255, 0.3) ${(
                  (currentTime / (duration || 1)) *
                  100
                ).toFixed(1)}%,
                  rgba(255, 255, 255, 0.3) 100%
                );
                border-radius: 3px;
                outline: none;
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                z-index: 2;
                margin: 0;
                &::-webkit-slider-thumb {
                  appearance: none;
                  width: 14px;
                  height: 14px;
                  background: ${colors.light};
                  border-radius: 50%;
                  cursor: pointer;
                  box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
                }
                &::-moz-range-thumb {
                  width: 14px;
                  height: 14px;
                  background: ${colors.light};
                  border-radius: 50%;
                  cursor: pointer;
                  border: none;
                  box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
                }
              `}
            />
            {/* Buffered range visual */}
            <div
              className={css`
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                left: 0;
                height: 6px;
                background-color: rgba(255, 255, 255, 0.5);
                width: ${bufferedWidth};
                border-radius: 3px;
                z-index: 1;
                pointer-events: none;
              `}
            />
          </div>
          <span
            className={css`
              font-size: ${isPseudoFullscreen ? '1.1rem' : '0.8rem'};
              min-width: 45px;
              text-align: left;
              font-family: monospace;
              color: white;
              ${isPseudoFullscreen
                ? 'text-shadow: 0 1px 2px rgba(0,0,0,0.8);'
                : ''}
            `}
          >
            {formatTime(duration)}
          </span>
        </div>

        {/* Bottom Controls Section - For non-fullscreen mode only */}
        {!isPseudoFullscreen && (
          <div
            className={css`
              display: flex;
              flex-wrap: wrap;
              gap: 10px;
              width: 100%;
              margin-top: 8px;
            `}
          >
            {/* Left side - Scroll to Current */}
            <div
              className={css`
                display: flex;
                gap: 8px;
                flex: 1;
                min-width: 100px;
              `}
            >
              {onScrollToCurrentSubtitle && hasSubtitles && (
                <Button
                  onClick={onScrollToCurrentSubtitle}
                  title="Scroll to current subtitle"
                  size="sm"
                  variant="secondary"
                  className={css`
                    white-space: nowrap;
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
            </div>

            {/* Center - Fullscreen Toggle */}
            {onTogglePseudoFullscreen && (
              <Button
                onClick={onTogglePseudoFullscreen}
                title={
                  isPseudoFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'
                }
                size="sm"
                variant={isPseudoFullscreen ? 'primary' : 'secondary'}
                className={css`
                  white-space: nowrap;
                  ${isPseudoFullscreen
                    ? `
                    padding: 8px 14px;
                    border-radius: 6px;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
                    svg {
                      width: 20px;
                      height: 20px;
                    }
                  `
                    : ''}
                `}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width={isPseudoFullscreen ? '20' : '16'}
                  height={isPseudoFullscreen ? '20' : '16'}
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  {isPseudoFullscreen ? (
                    // Exit fullscreen icon
                    <path d="M5.5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5zm-10 5.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5zm10 0a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5zm10 0a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5zm-5.5 5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5zM10.5 11a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5z" />
                  ) : (
                    // Enter fullscreen icon
                    <path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z" />
                  )}
                </svg>
                <span
                  className={css`
                    margin-left: 6px;
                  `}
                >
                  {isPseudoFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                </span>
              </Button>
            )}

            {/* Right side - Shift Controls */}
            <div
              className={css`
                display: flex;
                gap: 8px;
                flex: 1;
                justify-content: flex-end;
                min-width: 180px;
              `}
            >
              {onShiftAllSubtitles && hasSubtitles && isStickyExpanded && (
                <div
                  className={css`
                    display: flex;
                    align-items: center;
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
                  >
                    Apply Shift
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
