import type { ChangeEvent } from 'react';
import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import Button from '../../components/Button';
import { usePlayerVolume } from './player-volume';
import {
  videoPlayerIconButtonStyles,
  videoPlayerSeekbarStyles,
} from './video-player-side-styles';

const groupStyles = css`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

// The level slider opens beside the button on hover or keyboard focus, so the
// bar keeps its width for the seek bar at narrow sizes.
const hoverSliderStyles = css`
  width: 0;
  opacity: 0;
  overflow: hidden;
  transition:
    width 0.18s ease,
    opacity 0.18s ease;

  .player-volume:hover &,
  .player-volume:focus-within & {
    width: 76px;
    opacity: 1;
  }
`;

const sliderStyles = css`
  width: 72px;
  margin: 0 2px;
`;

/** Mute plus a level slider; the same store drives the M and arrow keys. */
export default function VolumeControl({
  isFullScreen = false,
  alwaysShowSlider = false,
  className,
}: {
  isFullScreen?: boolean;
  /** In a menu the slider is the point, so it shows without hovering. */
  alwaysShowSlider?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const volume = usePlayerVolume(s => s.volume);
  const muted = usePlayerVolume(s => s.muted);
  const setVolume = usePlayerVolume(s => s.setVolume);
  const toggleMute = usePlayerVolume(s => s.toggleMute);
  const silent = muted || volume === 0;
  const shown = silent ? 0 : volume;
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const muteLabel = silent
    ? t('videoPlayer.unmute', 'Unmute (M)')
    : t('videoPlayer.mute', 'Mute (M)');
  const volumeLabel = t('videoPlayer.volume', 'Volume');

  return (
    <div className={cx('player-volume', groupStyles, className)}>
      <Button
        variant="secondary"
        size="sm"
        onClick={toggleMute}
        className={videoPlayerIconButtonStyles(isFullScreen)}
        title={muteLabel}
        aria-label={muteLabel}
        aria-pressed={silent}
      >
        <Icon size={18} aria-hidden="true" />
      </Button>
      <span className={alwaysShowSlider ? undefined : hoverSliderStyles}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={shown}
          aria-label={volumeLabel}
          aria-valuetext={`${Math.round(shown * 100)}%`}
          title={`${volumeLabel} ${Math.round(shown * 100)}%`}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setVolume(Number(e.target.value))
          }
          className={cx(videoPlayerSeekbarStyles(isFullScreen), sliderStyles)}
          style={{ '--seek-before-width': `${shown * 100}%` } as any}
        />
      </span>
    </div>
  );
}
