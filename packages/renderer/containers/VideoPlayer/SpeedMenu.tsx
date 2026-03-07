import { SPEED_STEPS } from '../VideoPlayer';
import { useEffect, useRef, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import { listenClose } from '../../utils/closeOnOutside';
import {
  speedMenuItemStyles,
  speedMenuStyles,
} from './video-player-side-styles';

interface Props {
  current: (typeof SPEED_STEPS)[number];
  onSelect: (rate: (typeof SPEED_STEPS)[number]) => void;
  onClose: () => void;
  placement?: 'up' | 'down';
}

export default function SpeedMenu({
  current,
  onSelect,
  onClose,
  placement = 'up',
}: Props) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLUListElement>(null);
  const selectedItemRef = useRef<HTMLLIElement>(null);
  const currentRateRef = useRef<(typeof SPEED_STEPS)[number]>(current);

  useEffect(() => {
    currentRateRef.current = current;
  }, [current]);

  useEffect(() => {
    selectedItemRef.current?.focus();
  }, []);

  useEffect(() => {
    return listenClose('.speed-menu', onClose, '.speed-btn');
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        {
          const currentIndex = SPEED_STEPS.indexOf(currentRateRef.current);
          const nextIndex = (currentIndex + 1) % SPEED_STEPS.length;
          onSelect(SPEED_STEPS[nextIndex]);
          currentRateRef.current = SPEED_STEPS[nextIndex];
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        {
          const currentIndex = SPEED_STEPS.indexOf(currentRateRef.current);
          const prevIndex =
            (currentIndex - 1 + SPEED_STEPS.length) % SPEED_STEPS.length;
          onSelect(SPEED_STEPS[prevIndex]);
          currentRateRef.current = SPEED_STEPS[prevIndex];
        }
        break;
      case 'Enter':
        e.preventDefault();
        onClose();
        break;
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLUListElement>) => {
    e.stopPropagation();
  };

  return (
    <ul
      ref={menuRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      role="menu"
      aria-label={t('videoPlayer.playbackSpeed', 'Playback speed')}
      aria-activedescendant={`speed-item-${current}`}
      className={`speed-menu ${speedMenuStyles(placement)}`}
    >
      {SPEED_STEPS.map((r: (typeof SPEED_STEPS)[number]) => (
        <li
          key={r}
          id={`speed-item-${r}`}
          ref={r === current ? selectedItemRef : null}
          onClick={() => {
            startTransition(() => {
              onSelect(r);
              onClose();
            });
          }}
          role="menuitemradio"
          aria-checked={r === current}
          tabIndex={r === current ? 0 : -1}
          className={speedMenuItemStyles(r === current)}
        >
          <span>{r}×</span>
          {r === current ? <span>✓</span> : null}
        </li>
      ))}
    </ul>
  );
}
