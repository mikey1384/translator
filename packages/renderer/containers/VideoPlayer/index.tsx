import {
  useState,
  useEffect,
  useRef,
  KeyboardEvent,
  ChangeEvent,
  useLayoutEffect,
  useCallback,
} from 'react';
import { css } from '@emotion/css';

import NativeVideoPlayer from './NativeVideoPlayer';
import SideMenu from './SideMenu';

import { colors } from '../../styles';
import Button from '../../components/Button';
import { PROGRESS_BAR_HEIGHT } from '../../components/ProgressAreas/ProgressArea';
import { BASELINE_HEIGHT } from '../../../shared/constants';

import {
  useVideoStore,
  useTaskStore,
  useSubStore,
  useSubtitlePrefs,
} from '../../state';

import { getNativePlayerInstance, nativeSeek } from '../../native-player';
import { SrtSegment } from '@shared-types/app';
import { useUrlStore } from '../../state/url-store';

const videoOverlayControlsStyles = css`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 80px;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.8) 0%,
    rgba(0, 0, 0, 0.5) 60%,
    transparent 100%
  );
  z-index: 10;
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 15px;
  opacity: 0;
  transition: opacity 0.3s ease-in-out;

  &:hover {
    opacity: 1;
  }
`;

const fullscreenOverlayControlsStyles = css`
  ${videoOverlayControlsStyles}
  height: 100px;
  padding: 0 40px;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.9) 0%,
    rgba(0, 0, 0, 0.7) 30%,
    transparent 100%
  );
  bottom: 0;
`;

const seekbarStyles = css`
  width: 100%;
  height: 8px;
  cursor: pointer;
  appearance: none;
  background: linear-gradient(
    to right,
    ${colors.primary} 0%,
    ${colors.primary} var(--seek-before-width, 0%),
    rgba(255, 255, 255, 0.3) var(--seek-before-width, 0%),
    rgba(255, 255, 255, 0.3) 100%
  );
  border-radius: 4px;
  outline: none;
  position: relative;
  z-index: 2;
  margin: 0;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    background: ${colors.light};
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
  }
  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: ${colors.light};
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
  }
`;

const fullscreenSeekbarStyles = css`
  ${seekbarStyles}
  height: 12px;

  &::-webkit-slider-thumb {
    width: 24px;
    height: 24px;
  }
  &::-moz-range-thumb {
    width: 24px;
    height: 24px;
  }
`;

const timeDisplayStyles = css`
  font-size: 0.9rem;
  min-width: 50px;
  text-align: center;
  font-family: monospace;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
`;

const fullscreenTimeDisplayStyles = css`
  ${timeDisplayStyles}
  font-size: 1.2rem;
  min-width: 70px;
`;

const transparentButtonStyles = css`
  background: transparent !important;
  border: none !important;
  padding: 5px;
  color: white;
  &:hover {
    color: ${colors.primary};
  }
  svg {
    width: 24px;
    height: 24px;
  }
`;

const fullscreenButtonStyles = css`
  ${transparentButtonStyles}
  svg {
    width: 32px;
    height: 32px;
  }
`;

const fixedVideoContainerBaseStyles = css`
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  background-color: rgba(30, 30, 30, 0.75);
  backdrop-filter: blur(12px);
  border: 1px solid ${colors.border};
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 15px;
  overflow: visible;
  transition: all 0.3s ease-out;
  &:focus,
  &:focus-visible {
    outline: none;
    box-shadow: none;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`;

const fixedVideoContainerStyles = (isFullScreen: boolean) => css`
  ${fixedVideoContainerBaseStyles}

  ${isFullScreen
    ? `
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    transform: none;
    padding: 0;
    border-radius: 0;
    z-index: 9999;
    background-color: black;
    gap: 0;
    flex-direction: column;
  `
    : `
    width: calc(95% - 30px);
    max-height: 35vh;
    padding: 10px;
    border-radius: 0 0 8px 8px;
    margin-bottom: 0;

    @media (max-height: 700px) {
      max-height: 30vh;
    }
  `}
`;

const playerWrapperStyles = (isFullScreen: boolean) => css`
  flex-grow: 1;
  flex-shrink: 1;
  min-width: 0;
  position: relative;
  ${isFullScreen ? 'height: 100%;' : ''}
`;

const controlsWrapperStyles = (isFullScreen: boolean) => css`
  flex-shrink: 0;
  transition: background-color 0.3s ease;
  ${isFullScreen
    ? `
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: 100px;
    background-color: transparent;
    border-top: none;
    z-index: 10;
    &:hover {
      background-color: rgba(0, 0, 0, 0.95);
      border-top: 1px solid ${colors.border};
    }
  `
    : `
    width: 240px;
    border-top: 1px solid ${colors.border};
  `}
`;

const fmt = (s: number) => {
  if (Number.isNaN(s)) return '00:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h
    ? [h, m, sec].map(n => String(n).padStart(2, '0')).join(':')
    : [m, sec].map(n => String(n).padStart(2, '0')).join(':');
};

export default function VideoPlayer() {
  const videoUrl = useVideoStore(s => s.url);
  const resumeAt = useVideoStore(s => s.resumeAt);
  const togglePlay = useVideoStore(s => s.handleTogglePlay);
  const selectVideo = useVideoStore(s => s.openFileDialog);
  const { merge, translation } = useTaskStore();
  const download = useUrlStore(s => s.download);
  const { baseFontSize, subtitleStyle, showOriginal } = useSubtitlePrefs();

  const isProgressBarVisible =
    merge.inProgress || download.inProgress || translation.inProgress;

  const [isFullScreen, setIsFullScreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showFsControls, setShowFsControls] = useState(true);
  const activityTimeout = useRef<NodeJS.Timeout | null>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);

  const [progressBarH, setProgressBarH] = useState(0);
  useEffect(() => {
    setProgressBarH(isProgressBarVisible ? PROGRESS_BAR_HEIGHT : 0);
  }, [isProgressBarVisible]);

  const syncVisibleHeight = useCallback(() => {
    const getHeight = () =>
      isFullScreen
        ? window.innerHeight
        : (playerDivRef.current?.getBoundingClientRect().height ??
          BASELINE_HEIGHT);
    getHeight();
  }, [isFullScreen]);

  useEffect(() => {
    window.addEventListener('resize', syncVisibleHeight);
    return () => window.removeEventListener('resize', syncVisibleHeight);
  }, [syncVisibleHeight]);

  useLayoutEffect(() => {
    const el = playerDivRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncVisibleHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncVisibleHeight]);

  useEffect(() => {
    const v = getNativePlayerInstance();
    if (!v) return;

    const onTime = () => setCurrentTime(v.currentTime);
    const onDur = () => !Number.isNaN(v.duration) && setDuration(v.duration);
    const onPlayPause = () => setIsPlaying(!v.paused);

    v.addEventListener('timeupdate', onTime);
    v.addEventListener('durationchange', onDur);
    v.addEventListener('play', onPlayPause);
    v.addEventListener('pause', onPlayPause);

    onTime();
    onDur();
    onPlayPause();

    useVideoStore.getState().startPositionSaving();

    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('durationchange', onDur);
      v.removeEventListener('play', onPlayPause);
      v.removeEventListener('pause', onPlayPause);
      useVideoStore.getState().stopPositionSaving();
    };
  }, [videoUrl]);

  useEffect(() => {
    const v = getNativePlayerInstance();
    if (!v) return;

    if (resumeAt === null) return;

    const waitUntilSeekable = () =>
      new Promise<void>(res => {
        if (v.seekable.length) return res();
        v.addEventListener('loadedmetadata', () => res(), { once: true });
      });

    waitUntilSeekable().then(() => {
      const end = v.seekable.end(v.seekable.length - 1);
      v.currentTime = Math.min(resumeAt, end - 0.25);
      useVideoStore.setState({ resumeAt: null });
    });
  }, [videoUrl, resumeAt]);

  const seek = (val: number) => nativeSeek(val);

  const toggleFullscreen = () => {
    setIsFullScreen(f => {
      const next = !f;
      document.body.style.overflow = next ? 'hidden' : '';
      setTimeout(() => playerDivRef.current?.focus(), 0);
      window.dispatchEvent(new Event('resize'));
      return next;
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isFullScreen) {
      toggleFullscreen();
      e.preventDefault();
      return;
    }
    const v = getNativePlayerInstance();
    if (!v) return;
    if (e.key === 'ArrowRight') {
      seek(Math.min(v.currentTime + 10, v.duration));
      e.preventDefault();
    }
    if (e.key === 'ArrowLeft') {
      seek(Math.max(v.currentTime - 10, 0));
      e.preventDefault();
    }
  };

  const pokeFsControls = () => {
    if (!isFullScreen) return;
    setShowFsControls(true);
    if (activityTimeout.current) clearTimeout(activityTimeout.current);
    activityTimeout.current = setTimeout(() => setShowFsControls(false), 3000);
  };

  if (!videoUrl) return null;

  const pct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={playerDivRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={[
          'fixed-video-container',
          fixedVideoContainerStyles(isFullScreen),
        ].join(' ')}
        style={{ top: isFullScreen ? 0 : progressBarH }}
      >
        <div
          className={playerWrapperStyles(isFullScreen)}
          onMouseEnter={() => setShowOverlay(true)}
          onMouseLeave={() => setShowOverlay(false)}
          onMouseMove={pokeFsControls}
        >
          <NativeVideoPlayer
            parentRef={playerDivRef}
            isFullyExpanded={isFullScreen}
            baseFontSize={baseFontSize}
            stylePreset={subtitleStyle}
            showOriginalText={showOriginal}
          />

          <div
            className={
              isFullScreen
                ? fullscreenOverlayControlsStyles
                : videoOverlayControlsStyles
            }
            style={{
              opacity: isFullScreen
                ? showFsControls
                  ? 1
                  : 0
                : showOverlay
                  ? 1
                  : 0,
            }}
          >
            <Button
              onClick={togglePlay}
              variant="primary"
              size="sm"
              className={
                isFullScreen ? fullscreenButtonStyles : transparentButtonStyles
              }
            >
              {isPlaying ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M5.5 3.5A1.5 1.5 0 017 5v6a1.5 1.5 0 01-3 0V5A1.5 1.5 0 015.5 3.5zm5 0A1.5 1.5 0 0112 5v6a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5z" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M11.596 8.697l-6.363 3.692C4.694 12.702 4 12.323 4 11.692V4.308c0-.63.694-1.01 1.233-.696l6.363 3.692a.802.802 0 010 1.393z" />
                </svg>
              )}
            </Button>

            <span
              className={
                isFullScreen ? fullscreenTimeDisplayStyles : timeDisplayStyles
              }
            >
              {fmt(currentTime)}
            </span>

            <div style={{ flexGrow: 1 }}>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step="0.1"
                value={currentTime}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  seek(+e.target.value)
                }
                className={
                  isFullScreen ? fullscreenSeekbarStyles : seekbarStyles
                }
                style={{ '--seek-before-width': `${pct}%` } as any}
              />
            </div>

            <span
              className={
                isFullScreen ? fullscreenTimeDisplayStyles : timeDisplayStyles
              }
            >
              {fmt(duration)}
            </span>

            <Button
              onClick={toggleFullscreen}
              variant="secondary"
              size="sm"
              className={
                isFullScreen ? fullscreenButtonStyles : transparentButtonStyles
              }
              title={isFullScreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullScreen ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z" />
                </svg>
              )}
            </Button>
          </div>
        </div>

        {!isFullScreen && (
          <div className={controlsWrapperStyles(false)}>
            <SideMenu
              onShiftAllSubtitles={useSubStore.getState().shiftAll}
              onScrollToCurrentSubtitle={useSubStore.getState().scrollToCurrent}
              onSelectVideoClick={selectVideo}
              onSetSubtitleSegments={(segs: SrtSegment[]) =>
                useSubStore.getState().load(segs)
              }
              onSrtFileLoaded={useSubStore.getState().setSrtPath}
              onUiInteraction={pokeFsControls}
            />
          </div>
        )}
      </div>
    </div>
  );
}
