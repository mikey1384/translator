import React, { useEffect, useState, useCallback } from 'react';
import { css } from '@emotion/css';
import { colors } from '../constants';
import ButtonGroup from './ButtonGroup';
import StylizedFileInput from './StylizedFileInput';
import Button from './Button';
import { openSubtitleWithElectron } from '../helpers/subtitle-utils';
import ElectronFileButton from './ElectronFileButton';
import { buttonGradientStyles } from '../containers/EditSubtitles/styles';

interface TimestampDisplayProps {
  isPlaying: boolean;
  videoElement: HTMLVideoElement | null;
  onChangeVideo?: (file: File) => void;
  onChangeSrt?: (file: File) => void;
  hasSubtitles?: boolean;
  onTogglePlay?: () => void;
  onScrollToCurrentSubtitle?: () => void;
}

export function TimestampDisplay({
  isPlaying,
  videoElement,
  onChangeVideo,
  onChangeSrt,
  hasSubtitles = false,
  onTogglePlay,
  onScrollToCurrentSubtitle,
}: TimestampDisplayProps) {
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedWidth, setBufferedWidth] = useState<string>('0%');

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

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0] && onChangeVideo) {
      onChangeVideo(e.target.files[0]);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (videoElement) {
      const seekTime = parseFloat(e.target.value);
      videoElement.currentTime = seekTime;
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

  return (
    <div
      className={css`
        font-family:
          'system-ui',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        background-color: ${colors.grayLight};
        color: ${colors.dark};
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 14px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        width: 100%;
      `}
    >
      {/* Progress bar container */}
      <div
        className={css`
          width: 100%;
          padding: 8px 0 0;
          position: relative;
        `}
      >
        {/* Buffered progress bar */}
        <div
          className={css`
            position: absolute;
            top: 16px;
            left: 0;
            height: 8px;
            background-color: #ccc;
            border-radius: 4px;
            pointer-events: none;
            z-index: 0;
          `}
          style={{ width: bufferedWidth }}
        />
        {/* Slider (seek bar) */}
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
            background: #e1e1e1;
            outline: none;
            cursor: pointer;
            position: relative;
            z-index: 1;
            margin: 8px 0;

            &::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 18px;
              height: 18px;
              border-radius: 50%;
              background: ${colors.primary};
              cursor: pointer;
              border: 2px solid #fff;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
              position: relative;
              z-index: 10;
              margin-top: -5px;
              transition: transform 0.1s ease;
            }

            &::-moz-range-thumb {
              width: 18px;
              height: 18px;
              border-radius: 50%;
              background: ${colors.primary};
              cursor: pointer;
              border: 2px solid #fff;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
              position: relative;
              z-index: 10;
              transition: transform 0.1s ease;
            }

            &::-webkit-slider-runnable-track {
              height: 8px;
              border-radius: 4px;
              background: #e1e1e1;
              cursor: pointer;
            }
            &::-moz-range-track {
              height: 8px;
              border-radius: 4px;
              background: #e1e1e1;
              cursor: pointer;
            }

            &:hover::-webkit-slider-thumb {
              background: ${colors.primaryDark || '#0056b3'};
              transform: scale(1.2);
              box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
            }
            &:hover::-moz-range-thumb {
              background: ${colors.primaryDark || '#0056b3'};
              transform: scale(1.2);
              box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
            }

            &:active::-webkit-slider-thumb {
              transform: scale(1.3);
              box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
            }
            &:active::-moz-range-thumb {
              transform: scale(1.3);
              box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
            }
          `}
          onChange={handleSeek}
          disabled={!videoElement}
        />
      </div>

      {/* Time display */}
      <div
        className={css`
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 4px 0;
          font-size: 13px;
          color: #555;
          margin-top: 8px;
          width: 100%;
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
              color: #333;
            `}
          >
            {formatTime(currentTime)}
          </span>
          <span>/</span>
          <span
            className={css`
              font-weight: 500;
              color: #333;
            `}
          >
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Bottom controls: Upload, SRT, etc */}
      <div
        className={css`
          display: flex;
          align-items: center;
          gap: 8px;
        `}
      >
        <ButtonGroup spacing="sm" mobileStack={false}>
          {onChangeVideo && (
            <StylizedFileInput
              accept="video/*"
              onChange={handleVideoChange}
              buttonText="Change Video"
              showSelectedFile={false}
            />
          )}

          {onChangeSrt && (
            <ElectronFileButton
              buttonText={hasSubtitles ? 'Change SRT' : 'Add SRT'}
              onClick={async () => {
                await openSubtitleWithElectron();
              }}
            />
          )}

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

          {onTogglePlay && (
            <Button
              onClick={onTogglePlay}
              variant={isPlaying ? 'danger' : 'primary'}
              size="sm"
              className={`${buttonGradientStyles.base} ${
                isPlaying
                  ? buttonGradientStyles.danger
                  : buttonGradientStyles.primary
              } ${css`
                display: inline-flex;
                align-items: center;
                gap: 6px;
                min-width: 70px;
              `}`}
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
        </ButtonGroup>
      </div>
    </div>
  );
}
