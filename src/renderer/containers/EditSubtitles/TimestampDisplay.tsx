import React, { useEffect, useState, useCallback, ChangeEvent } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles';
import ButtonGroup from '../../components/ButtonGroup';
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
        flex-direction: column;
        height: 100%;
        width: 100%;
        box-sizing: border-box;
        padding: 8px 12px;
        padding-top: 16px;
        font-family:
          'system-ui',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        color: ${colors.dark};
        border-radius: 8px;
        font-size: 14px;
      `}
    >
      {/* Top Buttons Section */}
      <div
        className={css`
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100%;
          margin-bottom: 12px;
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

      {/* Wrapper for Time, Playback, and Bottom Buttons - Pushed Down */}
      <div
        className={css`
          margin-top: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
        `}
      >
        {/* Time display - Now directly above Playback Controls */}
        <div
          className={css`
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 13px;
            color: ${colors.gray};
            width: 100%;
            text-align: center;
          `}
        >
          <div
            className={css`
              display: flex;
              gap: 8px;
              align-items: center;
              font-family: monospace;
            `}
          >
            <span
              className={css`
                font-weight: 500;
                color: ${colors.dark};
              `}
            >
              {formatTime(currentTime)}
            </span>
            <span>/</span>
            <span
              className={css`
                font-weight: 500;
                color: ${colors.dark};
              `}
            >
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Playback Controls Section */}
        <div
          className={css`
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
          `}
        >
          {/* Progress wrapper */}
          <div
            className={css`
              width: 100%;
              position: relative;
              height: 20px;
              display: flex;
              align-items: center;
            `}
          >
            {/* Buffered progress bar - Positioned absolutely within the new wrapper */}
            <div
              className={css`
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                left: 0;
                height: 8px;
                background-color: ${colors.gray};
                border-radius: 4px;
                pointer-events: none;
                z-index: 0;
              `}
              style={{ width: bufferedWidth }}
            />
            {/* Slider (seek bar) - Ensure it overlaps buffer correctly */}
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={currentTime}
              step="0.1"
              aria-label="Video Seek"
              className={css`
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 8px;
                border-radius: 4px;
                background: ${colors.light};
                outline: none;
                cursor: pointer;
                position: relative;
                z-index: 1;
                margin: 0;
                vertical-align: middle;

                &::-webkit-slider-thumb {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 18px;
                  height: 18px;
                  border-radius: 50%;
                  background: ${colors.primary};
                  cursor: pointer;
                  border: 2px solid ${colors.white};
                  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
                  position: relative;
                  z-index: 10;
                  transition: transform 0.1s ease;
                  margin-top: -5px;
                }

                &::-moz-range-thumb {
                  width: 18px;
                  height: 18px;
                  border-radius: 50%;
                  background: ${colors.primary};
                  cursor: pointer;
                  border: 2px solid ${colors.white};
                  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
                  position: relative;
                  z-index: 10;
                  transition: transform 0.1s ease;
                  margin-top: -5px;
                }

                &::-webkit-slider-runnable-track {
                  height: 8px;
                  border-radius: 4px;
                  background: ${colors.light};
                  cursor: pointer;
                }
                &::-moz-range-track {
                  height: 8px;
                  border-radius: 4px;
                  background: ${colors.light};
                  cursor: pointer;
                }

                &:hover::-webkit-slider-thumb {
                  background: ${colors.primaryDark || colors.primary};
                  transform: scale(1.2);
                }
                &:hover::-moz-range-thumb {
                  background: ${colors.primaryDark || colors.primary};
                  transform: scale(1.2);
                }

                &:active::-webkit-slider-thumb {
                  transform: scale(1.3);
                }
                &:active::-moz-range-thumb {
                  transform: scale(1.3);
                }
              `}
              onChange={handleSeek}
              disabled={!videoElement}
            />
          </div>

          {/* NEW Row for Play/Pause and Find Current */}
          <div
            className={css`
              display: flex;
              justify-content: center;
              gap: 8px;
              width: 100%;
            `}
          >
            {/* Play/Pause Button - Moved inside new row */}
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
                variant={isPlaying ? 'danger' : 'primary'}
                size="sm"
                className={css`
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
                  min-width: 70px;
                `}
              >
                {isPlaying ? (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      fill="currentColor"
                      viewBox="0 0 16 16"
                    >
                      <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z" />
                    </svg>
                    Pause
                  </>
                ) : (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      fill="currentColor"
                      viewBox="0 0 16 16"
                    >
                      <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z" />
                    </svg>
                    Play
                  </>
                )}
              </Button>
            )}

            {/* Find Current Button - Moved inside new row */}
            {hasSubtitles && onScrollToCurrentSubtitle && (
              <Button
                onClick={onScrollToCurrentSubtitle}
                variant="secondary"
                size="sm"
                title="Scroll to the subtitle currently being shown in the video"
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
                  style={{ marginRight: '6px' }}
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="19 12 12 19 5 12" />
                </svg>
                Find Current
              </Button>
            )}
          </div>
        </div>

        {/* Bottom Buttons Section */}
        <div
          className={css`
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            width: 100%;
          `}
        >
          <ButtonGroup
            spacing="sm"
            mobileStack={false}
            className={css`
              flex-wrap: wrap;
              justify-content: center;
              width: 100%;
              ${!isStickyExpanded &&
              css`
                button,
                > div > button {
                }
                > div:last-child {
                  display: flex;
                  width: 100%;
                  > input {
                    flex-grow: 1;
                  }
                  margin-bottom: 0;
                }
              `}
            `}
          >
            {/* ... Shift All Group ... */}
            {hasSubtitles && onShiftAllSubtitles && (
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
                  step="0.1"
                  placeholder="Offset (s)"
                  className={shiftInputStyles}
                  aria-label="Shift all subtitles by seconds"
                />
                <Button
                  onClick={handleApplyShift}
                  variant="secondary"
                  size="sm"
                  title="Apply shift to all subtitles"
                  disabled={
                    isNaN(parseFloat(shiftAmount)) ||
                    parseFloat(shiftAmount) === 0
                  }
                >
                  Shift All
                </Button>
              </div>
            )}
          </ButtonGroup>
        </div>
      </div>
    </div>
  );
}
