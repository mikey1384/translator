import {
  useState,
  useEffect,
  useMemo,
  useRef,
  KeyboardEvent,
  ChangeEvent,
  useLayoutEffect,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import GapList from './GapList';

import NativeVideoPlayer from './NativeVideoPlayer';
import SpeedMenu from './SpeedMenu';
import SideMenu from './SideMenu';
import {
  fixedVideoContainerStyles,
  videoPlayerAnchorStyles,
  videoPlayerGrowStyles,
  videoPlayerIconButtonStyles,
  videoPlayerOverlayControlsStyles,
  videoPlayerRootStyles,
  videoPlayerSeekbarStyles,
  videoPlayerTimeStyles,
  videoPlayerWrapperStyles,
} from './video-player-side-styles';

import Button from '../../components/Button';
import { PROGRESS_BAR_HEIGHT } from '../../components/ProgressAreas/ProgressArea';
import { BASELINE_HEIGHT } from '../../../shared/constants';

import { useVideoStore, useTaskStore, useSubtitlePrefs } from '../../state';

import { getNativePlayerInstance, nativeSeek } from '../../native-player';
import { useUrlStore } from '../../state/url-store';
import { getPlaybackPosition, savePlaybackPosition } from '../../ipc/video';

// Side menu removed; no separate controls column needed

const fmt = (s: number) => {
  if (Number.isNaN(s)) return '00:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h
    ? [h, m, sec].map(n => String(n).padStart(2, '0')).join(':')
    : [m, sec].map(n => String(n).padStart(2, '0')).join(':');
};

const HIDE_DELAY = 3000;

export const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 5, 10] as const;

type PlayerOverlayStyle = CSSProperties & {
  '--player-overlay-opacity': number;
};

export default function VideoPlayer() {
  const { t } = useTranslation();
  const videoUrl = useVideoStore(s => s.url);
  const resumeAt = useVideoStore(s => s.resumeAt);
  const togglePlay = useVideoStore(s => s.handleTogglePlay);
  // Side menu removed; no need for file dialog here
  const isAudioOnly = useVideoStore(s => s.isAudioOnly);
  const videoPath = useVideoStore(s => s.path);
  const videoHeightMeta = useVideoStore(s => s.meta?.height ?? null);
  const videoWidthMeta = useVideoStore(s => s.meta?.width ?? null);
  const videoDisplayHeightMeta = useVideoStore(
    s => s.meta?.displayHeight ?? null
  );
  const videoDisplayWidthMeta = useVideoStore(
    s => s.meta?.displayWidth ?? null
  );
  const mergeInProgress = useTaskStore(s => s.merge.inProgress);
  const translationInProgress = useTaskStore(s => s.translation.inProgress);
  const transcriptionInProgress = useTaskStore(s => s.transcription.inProgress);
  const dubbingInProgress = useTaskStore(
    s => !!s.dubbing.inProgress && (s.dubbing.id?.startsWith('dub-') ?? false)
  );
  const download = useUrlStore(s => s.download);
  const { baseFontSize, subtitleStyle, showOriginal } = useSubtitlePrefs();

  const isProgressBarVisible = useMemo(() => {
    return (
      mergeInProgress ||
      download.inProgress ||
      translationInProgress ||
      transcriptionInProgress ||
      dubbingInProgress
    );
  }, [
    mergeInProgress,
    download.inProgress,
    translationInProgress,
    transcriptionInProgress,
    dubbingInProgress,
  ]);

  const [isFullScreen, setIsFullScreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showFsControls, setShowFsControls] = useState(true);
  const [cursorHidden, setCursorHidden] = useState(false);
  const [playbackRate, setPlaybackRate] =
    useState<(typeof SPEED_STEPS)[number]>(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const activityTimeout = useRef<NodeJS.Timeout | null>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const speedBtnRef = useRef<HTMLButtonElement>(null);

  const [progressBarH, setProgressBarH] = useState(0);
  const isFullScreenRef = useRef(false);
  useEffect(() => {
    isFullScreenRef.current = isFullScreen;
  }, [isFullScreen]);

  function restartHideTimer() {
    if (activityTimeout.current) clearTimeout(activityTimeout.current);
    setCursorHidden(false);
    setShowFsControls(true);
    if (!isFullScreenRef.current) setShowOverlay(true);

    activityTimeout.current = setTimeout(() => {
      if (!isFullScreenRef.current) {
        setShowOverlay(false);
        if (activityTimeout.current) clearTimeout(activityTimeout.current);
      }
      setCursorHidden(true);
      setShowFsControls(false);
    }, HIDE_DELAY);
  }

  useEffect(() => {
    setProgressBarH(isProgressBarVisible ? PROGRESS_BAR_HEIGHT : 0);
  }, [isProgressBarVisible]);

  const overlayControlsStyle = useMemo<PlayerOverlayStyle>(
    () => ({
      '--player-overlay-opacity': isFullScreen
        ? showFsControls
          ? 1
          : 0
        : showOverlay
          ? 1
          : 0,
    }),
    [isFullScreen, showFsControls, showOverlay]
  );

  function syncVisibleHeight() {
    const getHeight = () =>
      isFullScreenRef.current
        ? window.innerHeight
        : (playerDivRef.current?.getBoundingClientRect().height ??
          BASELINE_HEIGHT);
    getHeight();
  }

  useEffect(() => {
    window.addEventListener('resize', syncVisibleHeight);
    return () => window.removeEventListener('resize', syncVisibleHeight);
  }, []);

  useLayoutEffect(() => {
    const el = playerDivRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncVisibleHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const attachListeners = () => {
      const v = getNativePlayerInstance();
      if (!v) return;

      v.playbackRate = 1;
      setPlaybackRate(1);

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
    };

    const cleanup = attachListeners();
    window.addEventListener('native-player-ready', attachListeners);

    return () => {
      if (cleanup) cleanup();
      window.removeEventListener('native-player-ready', attachListeners);
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

    if (e.key === ' ' || e.key === 'Spacebar' || e.key.toLowerCase() === 'k') {
      e.preventDefault();
      togglePlay();
      return;
    }

    if (e.key === '>' || e.key === '.') {
      stepRate('up');
      e.preventDefault();
      return;
    }
    if (e.key === '<' || e.key === ',') {
      stepRate('down');
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

  useEffect(() => {
    if (isFullScreen) {
      restartHideTimer();
      window.addEventListener('mousemove', restartHideTimer);
    } else {
      setCursorHidden(false);
      window.removeEventListener('mousemove', restartHideTimer);
      if (activityTimeout.current) clearTimeout(activityTimeout.current);
    }
    return () => window.removeEventListener('mousemove', restartHideTimer);
  }, [isFullScreen]);

  useEffect(() => {
    if (!isFullScreen && cursorHidden) {
      setCursorHidden(false);
    }
  }, [isFullScreen, cursorHidden]);

  useEffect(
    () => () => {
      if (activityTimeout.current) clearTimeout(activityTimeout.current);
    },
    []
  );

  // Load saved position when component mounts if not already loaded
  useEffect(() => {
    const loadSavedPosition = async () => {
      if (!videoPath || resumeAt !== null) return;

      try {
        const saved = await getPlaybackPosition(videoPath);
        if (saved != null) {
          useVideoStore.setState({ resumeAt: saved });
        }
      } catch (err) {
        console.error(
          '[VideoPlayer] Failed to load saved position on mount:',
          err
        );
      }
    };

    loadSavedPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPath]);
  // Save current position immediately when component unmounts
  useEffect(() => {
    return () => {
      const v = getNativePlayerInstance();
      if (v && videoPath && v.currentTime > 0) {
        // Force save current position immediately on unmount
        savePlaybackPosition(videoPath, v.currentTime).catch(err => {
          console.error(
            '[VideoPlayer] Failed to save position on unmount:',
            err
          );
        });
      }
    };
  }, [videoPath]);

  // Side menu removed; no need to manually poke fullscreen controls

  if (!videoUrl) return null;

  const pct = duration ? (currentTime / duration) * 100 : 0;

  const applyRate = (rate: (typeof SPEED_STEPS)[number]) => {
    const v = getNativePlayerInstance();
    if (!v) return;
    v.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const stepRate = (dir: 'up' | 'down') => {
    const idx = SPEED_STEPS.indexOf(playbackRate);
    const next =
      dir === 'up'
        ? SPEED_STEPS[Math.min(idx + 1, SPEED_STEPS.length - 1)]
        : SPEED_STEPS[Math.max(idx - 1, 0)];
    applyRate(next);
  };

  return (
    <div className={videoPlayerRootStyles}>
      <div
        ref={playerDivRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={[
          'fixed-video-container',
          fixedVideoContainerStyles(isFullScreen),
          cursorHidden ? 'cursor-off' : '',
        ].join(' ')}
        style={{ top: isFullScreen ? 0 : progressBarH }}
      >
        {!isFullScreen && (
          <GapList key={(videoPath || videoUrl || 'none').toString()} />
        )}
        <div
          className={videoPlayerWrapperStyles}
          onMouseEnter={() => {
            setShowOverlay(true);
            restartHideTimer();
          }}
          onMouseLeave={() => setShowOverlay(false)}
          onMouseMove={() => restartHideTimer()}
        >
          <NativeVideoPlayer
            parentRef={playerDivRef}
            isFullyExpanded={isFullScreen}
            baseFontSize={baseFontSize}
            stylePreset={subtitleStyle}
            showOriginalText={showOriginal}
            isAudioOnly={isAudioOnly}
            videoHeight={videoHeightMeta}
            videoWidth={videoWidthMeta}
            displayHeight={videoDisplayHeightMeta}
            displayWidth={videoDisplayWidthMeta}
          />

          <div
            className={videoPlayerOverlayControlsStyles(isFullScreen)}
            style={overlayControlsStyle}
          >
            <Button
              onClick={togglePlay}
              variant="primary"
              size="sm"
              className={videoPlayerIconButtonStyles(isFullScreen)}
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

            <span className={videoPlayerTimeStyles(isFullScreen)}>
              {fmt(currentTime)}
            </span>

            <div className={videoPlayerGrowStyles}>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step="0.1"
                value={currentTime}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  seek(+e.target.value)
                }
                className={videoPlayerSeekbarStyles(isFullScreen)}
                style={{ '--seek-before-width': `${pct}%` } as any}
              />
            </div>

            <span className={videoPlayerTimeStyles(isFullScreen)}>
              {fmt(duration)}
            </span>

            <div className={videoPlayerAnchorStyles}>
              <Button
                ref={speedBtnRef}
                variant="secondary"
                size="sm"
                onClick={() => setShowSpeedMenu(m => !m)}
                className={`speed-btn ${videoPlayerIconButtonStyles(
                  isFullScreen
                )}`}
                title={t('videoPlayer.playbackSpeed', 'Playback speed')}
              >
                {playbackRate}×
              </Button>

              {showSpeedMenu && (
                <SpeedMenu
                  current={
                    SPEED_STEPS.find(
                      rate =>
                        rate ===
                        (getNativePlayerInstance()?.playbackRate ??
                          playbackRate)
                    ) ?? playbackRate
                  }
                  onSelect={applyRate}
                  onClose={() => {
                    setShowSpeedMenu(false);
                    setShowOverlay(false);
                    speedBtnRef.current?.focus();
                  }}
                  placement={'up'}
                />
              )}
            </div>

            <Button
              onClick={toggleFullscreen}
              variant="secondary"
              size="sm"
              className={videoPlayerIconButtonStyles(isFullScreen)}
              title={
                isFullScreen
                  ? t('videoPlayer.exitFullscreen')
                  : t('videoPlayer.enterFullscreen')
              }
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

        <SideMenu isFullScreen={isFullScreen} />
      </div>
    </div>
  );
}
