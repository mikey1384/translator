import { useEffect, useRef, useState, KeyboardEvent, MouseEvent } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles';

import {
  setNativePlayerInstance,
  getNativePlayerInstance,
  nativeSeek,
} from '../../native-player';

import BaseSubtitleDisplay from '../../components/BaseSubtitleDisplay';

import { useVideoStore, useSubStore, useUIStore } from '../../state';

import { cueText } from '../../../shared/helpers';
import { SubtitleStylePresetKey } from '../../../shared/constants/subtitle-styles';

declare global {
  interface Window {
    _videoLastValidTime?: number;
  }
}

// Define SVG Icons
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
  /** container that should receive focus when video clicked */
  parentRef?: React.RefObject<HTMLDivElement | null>;
  /** true when the player has been "zoomed" by VideoPlayer into full size */
  isFullyExpanded?: boolean;
}

export default function NativeVideoPlayer({
  parentRef,
  isFullyExpanded = false,
}: NativeVideoPlayerProps) {
  /* ============================================================
     1.  read everything from stores
     ============================================================ */
  const { url: videoUrl, togglePlay } = useVideoStore();
  const subtitles = useSubStore(s => s.order.map(id => s.segments[id]));

  const { downloadQuality, showOriginalText } = useUIStore();

  /* ============================================================
     2.  local state
     ============================================================ */
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorTimer = useRef<NodeJS.Timeout | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [activeSubtitle, setActiveSubtitle] = useState('');
  const [subtitleVisible, setSubtitleVisible] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [indicator, setIndicator] = useState<'play' | 'pause'>('pause');
  const [showInd, setShowInd] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nativeH, setNativeH] = useState(0);
  const [dispH, setDispH] = useState(0);

  /* ============================================================
     5.  attach basic video listeners
     ============================================================ */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    /* make this the global player */
    if (getNativePlayerInstance() !== v) setNativePlayerInstance(v);

    const onPlay = () => {
      setIsPlaying(true);
      setIndicator('play');
    };
    const onPause = () => {
      setIsPlaying(false);
      setIndicator('pause');
    };
    const onErr = () => setErrorMessage('Video playback error');

    const onLoadedMetadata = () => {
      setNativeH(v.videoHeight);
      setIsPlaying(!v.paused);
    };

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('error', onErr);
    v.addEventListener('loadedmetadata', onLoadedMetadata);

    /* detach */
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('error', onErr);
      v.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [videoUrl]);

  /* ============================================================
     6.  track container resize → dynamic subtitle font size
     ============================================================ */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const ro = new ResizeObserver(entries => {
      const h = Math.round(entries[0].contentRect.height);
      if (h > 0) setDispH(h);
    });
    ro.observe(v);
    return () => ro.disconnect();
  }, []);

  /* ============================================================
     7.  subtitle sync
     ============================================================ */
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

  /* fade-in new subtitle */
  useEffect(() => {
    if (!activeSubtitle) {
      setSubtitleVisible(false);
      return;
    }
    const id = setTimeout(() => setSubtitleVisible(true), 50);
    return () => clearTimeout(id);
  }, [activeSubtitle]);

  /* fallback guard */
  if (!videoUrl) return null;

  /* ============================================================
     3.  player click → play / pause + indicator
     ============================================================ */
  const onVideoClick = () => {
    const v = videoRef.current;
    if (!v) return;

    if (indicatorTimer.current) clearTimeout(indicatorTimer.current);

    if (v.paused) {
      v.play().catch(console.error);
      setIndicator('play');
    } else {
      v.pause();
      setIndicator('pause');
    }
    setShowInd(true);
    indicatorTimer.current = setTimeout(() => setShowInd(false), 600);

    /* bubble focus to wrapper so keyboard shortcuts still work */
    (parentRef?.current ?? containerRef.current)?.focus();
  };

  /* ============================================================
     4.  key-handler (←/→ = seek 10s, space = toggle)
     ============================================================ */
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

  const effFontSize = (() => {
    const base = Math.max(10, 16); // Fallback to a default value
    if (nativeH && dispH)
      return Math.max(10, Math.round((base * dispH) / nativeH));
    return isFullyExpanded ? Math.round(base * 1.2) : base;
  })();

  const wrapperCls =
    css`
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 180px;
      border-radius: 6px;
      overflow: hidden;
      will-change: transform;
      &:focus {
        outline: none;
      }
    ` + ' native-video-player-wrapper';

  return (
    <div
      ref={containerRef}
      className={wrapperCls}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        className={css`
          width: 100%;
          height: 100%;
          object-fit: contain;
        `}
        playsInline
        preload="auto"
        controls={false}
        onClick={(e: MouseEvent) => {
          onVideoClick();
          (e.currentTarget as HTMLVideoElement).focus();
        }}
      />

      <BaseSubtitleDisplay
        text={activeSubtitle}
        isVisible={subtitleVisible}
        displayFontSize={effFontSize}
        isFullScreen={isFullyExpanded}
        stylePreset={'default' as SubtitleStylePresetKey}
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
