import { useState, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import NativeVideoPlayer, {
  nativePlayer,
} from './EditSubtitles/NativeVideoPlayer';
import TimestampDisplay from './TimestampDisplay';
import { SrtSegment } from '../App';

export default function StickyVideoPlayer({
  videoUrl,
  subtitles,
  onPlayerReady,
  onChangeVideo,
  onChangeSrt,
  onStickyChange,
  onScrollToCurrentSubtitle,
}: {
  videoUrl: string;
  subtitles: SrtSegment[];
  onPlayerReady: (player: any) => void;
  onChangeVideo?: (file: File) => void;
  onChangeSrt?: (file: File) => void;
  onStickyChange?: (isSticky: boolean) => void;
  onScrollToCurrentSubtitle?: () => void;
}) {
  const [placeholderHeight, setPlaceholderHeight] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const calculateHeight = () => {
      if (!playerRef.current) return;

      const rect = playerRef.current.getBoundingClientRect();
      if (rect.height > 0) {
        setPlaceholderHeight(rect.height);
      }
    };

    calculateHeight();

    window.addEventListener('resize', calculateHeight);

    if (onStickyChange) {
      onStickyChange(true);
    }

    return () => {
      window.removeEventListener('resize', calculateHeight);
    };
  }, [onStickyChange]);

  useEffect(() => {
    const checkScrollPosition = () => {
      const editSubtitlesSection = document.getElementById(
        'edit-subtitles-section'
      );

      const generateSubtitlesSections = Array.from(
        document.querySelectorAll('h2')
      ).filter(h2 => h2.textContent?.includes('Generate Subtitles'));
      const generateSubtitlesSection =
        generateSubtitlesSections.length > 0
          ? generateSubtitlesSections[0]
          : null;

      if (!editSubtitlesSection) return;

      const screenCenterY = window.innerHeight / 2;

      const editSectionRect = editSubtitlesSection.getBoundingClientRect();

      let shouldFullyExpand = false;
      const shouldExpand = editSectionRect.top > screenCenterY;

      if (generateSubtitlesSection) {
        const generateSectionRect =
          generateSubtitlesSection.getBoundingClientRect();
        shouldFullyExpand = generateSectionRect.top > window.innerHeight - 100;
      }

      if (shouldFullyExpand !== isFullyExpanded) {
        setIsFullyExpanded(shouldFullyExpand);
        if (shouldFullyExpand && !isExpanded) {
          setIsExpanded(true);
        }
      } else if (shouldExpand !== isExpanded && !shouldFullyExpand) {
        setIsExpanded(shouldExpand);
      }
    };

    checkScrollPosition();

    let scrollTimeout: number | null = null;
    const throttledScroll = () => {
      if (scrollTimeout === null) {
        scrollTimeout = window.setTimeout(() => {
          checkScrollPosition();
          scrollTimeout = null;
        }, 100);
      }
    };

    window.addEventListener('scroll', throttledScroll);

    return () => {
      window.removeEventListener('scroll', throttledScroll);
      if (scrollTimeout) {
        window.clearTimeout(scrollTimeout);
      }
    };
  }, [isExpanded, isFullyExpanded]);

  useEffect(() => {
    if (!nativePlayer.instance) return;

    const videoElement = nativePlayer.instance;
    const updatePlayState = () => setIsPlaying(!videoElement.paused);

    videoElement.addEventListener('play', updatePlayState);
    videoElement.addEventListener('pause', updatePlayState);

    return () => {
      videoElement.removeEventListener('play', updatePlayState);
      videoElement.removeEventListener('pause', updatePlayState);
    };
  }, []);

  if (!videoUrl) return null;

  const handlePlayerReadyWrapper = (player: any) => {
    onPlayerReady(player);
  };

  const handleTogglePlay = () => {
    try {
      isPlaying ? nativePlayer.pause() : nativePlayer.play();
    } catch (err) {
      console.error('Error toggling play state:', err);
    }
  };

  return (
    <div ref={containerRef}>
      <div
        className={css`
          display: block;
          height: ${placeholderHeight}px;
          width: 100%;
          margin-bottom: 10px;
        `}
      />

      <div
        className={css`sticky-video-container ${isExpanded ? 'expanded' : ''} ${
          isFullyExpanded ? 'fully-expanded' : ''
        }
        position: fixed;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        width: ${isFullyExpanded ? 'calc(95% - 30px)' : 'calc(90% - 30px)'};
        z-index: 100;
        background-color: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        padding: 15px;
        border-radius: 0 0 8px 8px;
        border: 1px solid rgba(238, 238, 238, 0.9);
        margin-bottom: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        max-height: ${
          isFullyExpanded ? 'calc(100vh - 60px)' : isExpanded ? '50vh' : '40vh'
        };
        overflow: visible;
        transition: all 0.3s ease-out;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
      `}
        ref={playerRef}
        data-expanded={isExpanded}
        data-fully-expanded={isFullyExpanded}
      >
        <NativeVideoPlayer
          videoUrl={videoUrl}
          subtitles={subtitles}
          onPlayerReady={handlePlayerReadyWrapper}
          isExpanded={isExpanded}
          isFullyExpanded={isFullyExpanded}
        />

        <TimestampDisplay
          isPlaying={isPlaying}
          videoElement={nativePlayer.instance}
          onChangeVideo={onChangeVideo}
          onChangeSrt={onChangeSrt}
          hasSubtitles={subtitles && subtitles.length > 0}
          onTogglePlay={handleTogglePlay}
          onScrollToCurrentSubtitle={onScrollToCurrentSubtitle}
        />
      </div>
    </div>
  );
}
