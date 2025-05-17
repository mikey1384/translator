import { css } from '@emotion/css';
import { SPEED_STEPS } from '../VideoPlayer';
import { useEffect, useRef, startTransition } from 'react';
import { listenClose } from '../../utils/closeOnOutside';

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
      aria-label="Playback speed"
      aria-activedescendant={`speed-item-${current}`}
      className={`speed-menu ${
        placement === 'down' ? 'pop-down' : 'pop-up'
      } ${css`
        position: absolute;
        right: 0;
        background: rgba(0, 0, 0, 0.95);
        border: 1px solid #444;
        border-radius: 4px;
        padding: 4px 0;
        list-style: none;
        margin: 0;
        z-index: 99999;
        min-width: 80px;
        opacity: 1;
        transition: opacity 0.2s ease-out;

        &.pop-up {
          bottom: 100%;
          margin-bottom: 6px;
        }

        &.pop-down {
          top: 100%;
          margin-top: 6px;
        }
      `}`}
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
          className={css`
            padding: 6px 12px;
            color: ${r === current ? '#fff' : '#aaa'};
            font-weight: ${r === current ? 600 : 400};
            font-size: 14px;
            cursor: pointer;
            &:hover {
              background: #333;
              color: #fff;
            }
            ${r === current ? 'background: rgba(255, 255, 255, 0.1);' : ''}
          `}
        >
          {r}× {r === current && <span style={{ marginLeft: '5px' }}>✓</span>}
        </li>
      ))}
    </ul>
  );
}
