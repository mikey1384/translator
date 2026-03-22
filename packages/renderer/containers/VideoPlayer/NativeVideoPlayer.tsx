import {
  useEffect,
  useRef,
  useState,
  KeyboardEvent,
  MouseEvent,
  useCallback,
  useLayoutEffect,
  ElementType,
} from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';

import {
  setNativePlayerInstance,
  getNativePlayerInstance,
  nativeSeek,
} from '../../native-player';

import BaseSubtitleDisplay from '../../components/BaseSubtitleDisplay';
import { useVideoMetadata } from '../GenerateSubtitles/hooks/useVideoMetadata';
import {
  videoPlayerCenterStateBodyStyles,
  videoPlayerCenterStateCopyStyles,
  videoPlayerCenterStateHeaderStyles,
  videoPlayerCenterStateHintStyles,
  videoPlayerCenterStateIconStyles,
  videoPlayerCenterStateProgressFillStyles,
  videoPlayerCenterStateProgressTrackStyles,
  videoPlayerCenterStateStyles,
  videoPlayerCenterStateTitleStyles,
} from './video-player-side-styles';

import { useVideoStore, useSubStore, useUIStore } from '../../state';
import { useSubSourceId } from '../../state/subtitle-store';
import { SubtitleStylePresetKey } from '../../../shared/constants/subtitle-styles';
import { BASELINE_HEIGHT, fontScale } from '../../../shared/constants';
import type { SubtitleDisplayMode } from '@shared-types/app';

import { cueText } from '../../../shared/helpers';

declare global {
  interface Window {
    _videoLastValidTime?: number;
  }
}

interface IconProps {
  size?: string;
  color?: string;
}

const PlayIcon = ({ size = '64px', color = '#fff' }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M6.96817 4.2448C5.56675 3.40125 3.80317 4.48751 3.80317 6.11543V17.8846C3.80317 19.5125 5.56675 20.5987 6.96817 19.7552L17.6627 13.8706C19.039 13.0445 19.039 10.9555 17.6627 10.1294L6.96817 4.2448Z"
      fill={color}
    />
  </svg>
);

const PauseIcon = ({ size = '64px', color = '#fff' }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="6" y="4" width="4" height="16" rx="1" fill={color} />
    <rect x="14" y="4" width="4" height="16" rx="1" fill={color} />
  </svg>
);

export interface NativeVideoPlayerProps {
  parentRef?: React.RefObject<HTMLDivElement | null>;
  isFullyExpanded?: boolean;
  baseFontSize: number;
  stylePreset: SubtitleStylePresetKey;
  subtitleDisplayMode: SubtitleDisplayMode;
  isAudioOnly: boolean;
  videoHeight?: number | null;
  videoWidth?: number | null;
  displayHeight?: number | null;
  displayWidth?: number | null;
}

export default function NativeVideoPlayer({
  parentRef,
  isFullyExpanded = false,
  baseFontSize,
  stylePreset,
  subtitleDisplayMode,
  isAudioOnly,
  videoHeight,
  videoWidth,
  displayHeight,
  displayWidth,
}: NativeVideoPlayerProps) {
  const { t } = useTranslation();
  const videoUrl = useVideoStore(s => s.url);
  const videoPath = useVideoStore(s => s.path);
  const togglePlay = useVideoStore(s => s.togglePlay);

  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorTimer = useRef<NodeJS.Timeout | null>(null);
  const videoRef = useRef<HTMLVideoElement & HTMLAudioElement>(null!);
  const [scale, setScale] = useState(1);
  const [displayHeightPx, setDisplayHeightPx] = useState(0);

  const [activeSubtitle, setActiveSubtitle] = useState('');
  const [subtitleVisible, setSubtitleVisible] = useState(false);

  const [indicator, setIndicator] = useState<'play' | 'pause'>('pause');
  const [showInd, setShowInd] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const subSourceId = useSubSourceId();
  const { metadataStatus, metadataErrorCode } = useVideoMetadata(videoPath);
  const showICloudWaitingState = metadataErrorCode === 'icloud-placeholder';
  const suppressGenericPlaybackError =
    showICloudWaitingState ||
    metadataStatus === 'fetching' ||
    metadataStatus === 'waiting';
  const showPlaybackErrorState =
    Boolean(errorMessage) && !suppressGenericPlaybackError;

  const targetVideoHeight = !isAudioOnly
    ? Math.max(videoHeight ?? BASELINE_HEIGHT, 1)
    : null;
  const targetVideoWidth =
    !isAudioOnly && targetVideoHeight
      ? Math.max(videoWidth ?? Math.round((targetVideoHeight * 16) / 9), 1)
      : null;
  const subtitleCanvasWidth =
    !isAudioOnly && (displayWidth || videoWidth || targetVideoWidth)
      ? (displayWidth ?? videoWidth ?? targetVideoWidth ?? undefined)
      : undefined;
  const subtitleCanvasHeight =
    !isAudioOnly && (displayHeight || videoHeight || targetVideoHeight)
      ? (displayHeight ?? videoHeight ?? targetVideoHeight ?? undefined)
      : undefined;
  const canonicalFontSize = isAudioOnly
    ? Math.max(10, baseFontSize)
    : Math.max(
        10,
        Math.round(
          baseFontSize * fontScale(targetVideoHeight ?? BASELINE_HEIGHT)
        )
      );

  const recomputeScale = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const rect = v.getBoundingClientRect();
    const cssWidth = Math.max(rect.width, 1);
    const cssHeight = Math.max(rect.height, 1);

    let contentHeight = cssHeight;
    if (!isAudioOnly) {
      const intrinsicWidth = v.videoWidth || targetVideoWidth || cssWidth || 1;
      const intrinsicHeight =
        v.videoHeight || targetVideoHeight || cssHeight || 1;
      const scaleFactor = Math.min(
        cssWidth / intrinsicWidth,
        cssHeight / intrinsicHeight
      );
      contentHeight = Math.max(1, intrinsicHeight * scaleFactor);
    } else if (rect.height === 0) {
      contentHeight = 180;
    }

    const rounded = Math.round(contentHeight);
    setDisplayHeightPx(rounded);
    if (!isAudioOnly && targetVideoHeight) {
      setScale(contentHeight / targetVideoHeight);
    } else {
      setScale(1);
    }
  }, [isAudioOnly, targetVideoHeight, targetVideoWidth]);

  const flash = useCallback((state: 'play' | 'pause') => {
    setIndicator(state);
    setShowInd(true);
    if (indicatorTimer.current) clearTimeout(indicatorTimer.current);
    indicatorTimer.current = setTimeout(() => setShowInd(false), 600);
  }, []);

  useEffect(() => {
    setErrorMessage(null);
  }, [videoUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    if (getNativePlayerInstance() !== v) setNativePlayerInstance(v);

    const onPlay = () => flash('play');
    const onPause = () => flash('pause');
    const onErr = () =>
      setErrorMessage(
        t('videoPlayer.mediaPlaybackError', 'Media playback error')
      );

    const onLoadedMetadata = () => {
      setErrorMessage(null);
      const duration = Number(v.duration);
      const width = Number(v.videoWidth);
      const height = Number(v.videoHeight);
      const currentPath = useVideoStore.getState().path;
      if (Number.isFinite(duration) && duration > 0) {
        useVideoStore.setState(state => ({
          meta: {
            duration,
            width:
              Number.isFinite(width) && width > 0
                ? width
                : (state.meta?.width ?? 0),
            height:
              Number.isFinite(height) && height > 0
                ? height
                : (state.meta?.height ?? 0),
            frameRate: state.meta?.frameRate ?? 0,
            rotation: state.meta?.rotation,
            displayWidth: state.meta?.displayWidth,
            displayHeight: state.meta?.displayHeight,
          },
          metaPath: currentPath,
        }));
      }
      recomputeScale();
    };
    const onCanPlay = () => setErrorMessage(null);

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('error', onErr);
    v.addEventListener('loadedmetadata', onLoadedMetadata);
    v.addEventListener('canplay', onCanPlay);

    setNativePlayerInstance(v);
    const readyEvent = new Event('native-player-ready');
    window.dispatchEvent(readyEvent);

    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('error', onErr);
      v.removeEventListener('loadedmetadata', onLoadedMetadata);
      v.removeEventListener('canplay', onCanPlay);
    };
  }, [recomputeScale, videoUrl, flash, t]);

  useLayoutEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!isAudioOnly) {
      const ro = new ResizeObserver(recomputeScale);
      ro.observe(v);
      return () => ro.disconnect();
    }
  }, [recomputeScale, isAudioOnly]);

  useEffect(() => {
    recomputeScale();
  }, [recomputeScale]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      const t = v.currentTime;
      // Resolve current segment via a quick search using current store state
      const state = useSubStore.getState();
      const { segments, order } = state;
      // Binary search over sorted order (by start time)
      let lo = 0,
        hi = order.length - 1,
        foundIdx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const s = segments[order[mid]];
        if (!s) break;
        if (t < s.start) {
          hi = mid - 1;
        } else if (t > s.end) {
          lo = mid + 1;
        } else {
          foundIdx = mid;
          break;
        }
      }
      const seg = foundIdx >= 0 ? segments[order[foundIdx]] : undefined;
      const txt = seg ? cueText(seg, subtitleDisplayMode) : '';
      if (txt !== activeSubtitle) {
        if (activeSubtitle) setSubtitleVisible(false);
        setActiveSubtitle(txt);
      }
    };

    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [subtitleDisplayMode, activeSubtitle]);

  // Refresh subtitle immediately when subtitle source changes (e.g., translation completed)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    const state = useSubStore.getState();
    const { segments, order } = state;
    let lo = 0,
      hi = order.length - 1,
      foundIdx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = segments[order[mid]];
      if (!s) break;
      if (t < s.start) {
        hi = mid - 1;
      } else if (t > s.end) {
        lo = mid + 1;
      } else {
        foundIdx = mid;
        break;
      }
    }
    const seg = foundIdx >= 0 ? segments[order[foundIdx]] : undefined;
    const nextText = seg ? cueText(seg, subtitleDisplayMode) : '';
    if (nextText !== activeSubtitle) {
      if (activeSubtitle) setSubtitleVisible(false);
      setActiveSubtitle(nextText);
    } else if (nextText) {
      setSubtitleVisible(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subSourceId, subtitleDisplayMode]);

  useEffect(() => {
    if (!activeSubtitle) {
      setSubtitleVisible(false);
      return;
    }
    const id = setTimeout(() => setSubtitleVisible(true), 50);
    return () => clearTimeout(id);
  }, [activeSubtitle]);

  const effFontSize = Math.max(10, Math.round(canonicalFontSize * scale));

  useEffect(() => {
    if (!isAudioOnly && displayHeightPx > 0 && targetVideoHeight) {
      useUIStore
        .getState()
        .setPreviewSubtitleMetrics(
          effFontSize,
          displayHeightPx,
          targetVideoHeight
        );
    }
  }, [effFontSize, displayHeightPx, targetVideoHeight, isAudioOnly]);

  if (!videoUrl) return null;

  const onVideoClick = () => {
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      v.play().catch(console.error);
    } else {
      v.pause();
    }

    (parentRef?.current ?? containerRef.current)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;

    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      togglePlay();
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nativeSeek(Math.max(v.currentTime - 10, 0));
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nativeSeek(Math.min(v.currentTime + 10, v.duration));
    }
  };

  const wrapperCls =
    css`
      position: relative;
      width: 100%;
      min-height: 180px;
      height: 100%;
      border-radius: 6px;
      overflow: hidden;
      will-change: transform;
      &:focus {
        outline: none;
      }
      & audio {
        display: block;
        width: 100%;
        height: 100%;
        background: transparent;
      }
      & audio::-webkit-media-controls {
        display: none !important;
      }
    ` + ' native-video-player-wrapper';

  const ElTag: ElementType = isAudioOnly ? 'audio' : 'video';

  return (
    <div
      ref={containerRef}
      className={wrapperCls}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <ElTag
        ref={videoRef}
        src={videoUrl}
        className={css`
          width: 100%;
          height: 100%;
          ${!isAudioOnly ? 'object-fit: contain;' : ''}
        `}
        playsInline
        preload="auto"
        controls={false}
        onClick={(e: MouseEvent) => {
          onVideoClick();
          (e.currentTarget as HTMLMediaElement).focus();
        }}
      />

      <BaseSubtitleDisplay
        text={activeSubtitle}
        isVisible={subtitleVisible}
        displayFontSize={effFontSize}
        isFullScreen={isFullyExpanded}
        stylePreset={stylePreset}
        videoWidthPx={subtitleCanvasWidth}
        videoHeightPx={subtitleCanvasHeight}
      />

      {showInd && (
        <div
          className={css`
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            animation: fadeOut 0.6s forwards;
            pointer-events: none;
            color: rgba(255, 255, 255, 0.8);
            background: rgba(0, 0, 0, 0.5);
            border-radius: 50%;
            padding: 15px;
            @keyframes fadeOut {
              0% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1.05);
              }
              70% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
              }
              100% {
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.95);
              }
            }
          `}
        >
          {indicator === 'pause' ? (
            <PauseIcon size="48px" />
          ) : (
            <PlayIcon size="48px" />
          )}
        </div>
      )}

      {showICloudWaitingState && (
        <div
          className={videoPlayerCenterStateStyles('warning')}
          role="status"
          aria-live="polite"
        >
          <div className={videoPlayerCenterStateHeaderStyles}>
            <div
              className={videoPlayerCenterStateIconStyles('warning')}
              aria-hidden="true"
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
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </div>
            <div className={videoPlayerCenterStateCopyStyles}>
              <div className={videoPlayerCenterStateTitleStyles}>
                {t('videoPlayer.icloudWaitingTitle', 'Downloading from iCloud')}
              </div>
              <div className={videoPlayerCenterStateBodyStyles}>
                {t(
                  'videoPlayer.icloudWaitingBody',
                  "This file is not stored locally yet. In Finder, click 'Download' and wait for the cloud icon to disappear."
                )}
              </div>
            </div>
          </div>
          <div className={videoPlayerCenterStateProgressTrackStyles}>
            <div className={videoPlayerCenterStateProgressFillStyles} />
          </div>
          <div className={videoPlayerCenterStateHintStyles}>
            {t(
              'videoPlayer.icloudWaitingHint',
              'The video will load automatically when the download finishes.'
            )}
          </div>
        </div>
      )}

      {showPlaybackErrorState && (
        <div className={videoPlayerCenterStateStyles('error')} role="alert">
          <div className={videoPlayerCenterStateHeaderStyles}>
            <div
              className={videoPlayerCenterStateIconStyles('error')}
              aria-hidden="true"
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
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6" />
                <path d="M9 9l6 6" />
              </svg>
            </div>
            <div className={videoPlayerCenterStateCopyStyles}>
              <div className={videoPlayerCenterStateTitleStyles}>
                {errorMessage}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
