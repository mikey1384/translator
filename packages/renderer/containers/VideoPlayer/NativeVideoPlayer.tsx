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
import { colors } from '../../styles';

import {
  setNativePlayerInstance,
  getNativePlayerInstance,
  nativeSeek,
} from '../../native-player';

import BaseSubtitleDisplay from '../../components/BaseSubtitleDisplay';

import { useVideoStore, useSubStore } from '../../state';
import { SubtitleStylePresetKey } from '../../../shared/constants/subtitle-styles';
import { fontScale, BASELINE_HEIGHT } from '../../../shared/constants';

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
  showOriginalText: boolean;
  isAudioOnly: boolean;
}

export default function NativeVideoPlayer({
  parentRef,
  isFullyExpanded = false,
  baseFontSize,
  stylePreset,
  showOriginalText,
  isAudioOnly,
}: NativeVideoPlayerProps) {
  const { url: videoUrl, togglePlay } = useVideoStore();
  const subtitles = useSubStore(s => s.order.map(id => s.segments[id]));

  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorTimer = useRef<NodeJS.Timeout | null>(null);
  const videoRef = useRef<HTMLVideoElement & HTMLAudioElement>(null!);
  const [scale, setScale] = useState(1);

  const [activeSubtitle, setActiveSubtitle] = useState('');
  const [subtitleVisible, setSubtitleVisible] = useState(false);

  const [indicator, setIndicator] = useState<'play' | 'pause'>('pause');
  const [showInd, setShowInd] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recomputeScale = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const rect = v.getBoundingClientRect();
    const h = rect.height === 0 && isAudioOnly ? BASELINE_HEIGHT : rect.height;
    setScale(fontScale(Math.round(h)));
  }, [isAudioOnly]);

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
    const onErr = () => setErrorMessage('Media playback error');

    const onLoadedMetadata = recomputeScale;

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('error', onErr);
    v.addEventListener('loadedmetadata', onLoadedMetadata);

    // Dispatch event when native player is ready
    setNativePlayerInstance(v);
    const readyEvent = new Event('native-player-ready');
    window.dispatchEvent(readyEvent);

    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('error', onErr);
      v.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [recomputeScale, videoUrl, flash]);

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
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      const t = v.currentTime;
      const seg = subtitles.find(s => t >= +s.start && t <= +s.end);
      const txt = seg
        ? cueText(seg, showOriginalText ? 'dual' : 'translation')
        : '';
      if (txt !== activeSubtitle) {
        if (activeSubtitle) setSubtitleVisible(false);
        setActiveSubtitle(txt);
      }
    };

    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [subtitles, showOriginalText, activeSubtitle]);

  useEffect(() => {
    if (!activeSubtitle) {
      setSubtitleVisible(false);
      return;
    }
    const id = setTimeout(() => setSubtitleVisible(true), 50);
    return () => clearTimeout(id);
  }, [activeSubtitle]);

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

  const effFontSize = Math.max(10, Math.round(baseFontSize * scale));

  const wrapperCls =
    css`
      position: relative;
      width: 100%;
      min-height: ${isAudioOnly ? BASELINE_HEIGHT : 180}px;
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
        height: auto;
        min-height: ${BASELINE_HEIGHT}px;
        object-fit: contain;
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

      {errorMessage && (
        <div
          className={css`
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: ${colors.light};
            color: ${colors.danger};
            padding: 10px 15px;
            border: 1px solid ${colors.danger};
            border-radius: 4px;
          `}
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
