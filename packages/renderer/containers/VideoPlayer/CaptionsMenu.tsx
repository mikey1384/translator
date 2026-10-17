import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { css } from '@emotion/css';
import { listenClose } from '../../utils/closeOnOutside';
import { useReturnFocusWhenClosed } from '../../utils/focusReturn';
import {
  SubtitleDisplaySwitch,
  SubtitleSizeStepper,
} from '../../components/SubtitleViewControls';
import { colors } from '../../styles';
import VolumeControl from './VolumeControl';

const menuStyles = css`
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 99999;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: 14px;
  background: rgba(20, 19, 24, 0.96);
  border: 1px solid ${colors.borderStrong};
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
`;

/**
 * Which lines show, how big, and how loud, from the player's own controls, so it works
 * in full screen where the line under the video is hidden. Kept inside the
 * player box at any width or language.
 */
export default function CaptionsMenu({ onClose }: { onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Esc or a pick hands focus back to the button that opened the menu.
  useReturnFocusWhenClosed(true, menuRef);
  const [shift, setShift] = useState<{ x: number; maxWidth?: number }>({
    x: 0,
  });

  useEffect(
    () => listenClose('.captions-menu', onClose, '.captions-btn'),
    [onClose]
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const host = menu?.closest('.fixed-video-container');
    if (!menu || !host) return;
    const place = () => {
      const box = host.getBoundingClientRect();
      const maxWidth = Math.max(160, box.width - 16);
      menu.style.maxWidth = `${maxWidth}px`;
      menu.style.transform = '';
      const r = menu.getBoundingClientRect();
      let x = 0;
      if (r.right > box.right - 8) x = box.right - 8 - r.right;
      if (r.left + x < box.left + 8) x = box.left + 8 - r.left;
      setShift({ x, maxWidth });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  // Escape closes only the menu (not full screen); keys stay in the menu.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
    event.stopPropagation();
  };

  return (
    <div
      ref={menuRef}
      className={`captions-menu ${menuStyles}`}
      style={{
        transform: shift.x ? `translateX(${shift.x}px)` : undefined,
        maxWidth: shift.maxWidth,
      }}
      onKeyDown={onKeyDown}
    >
      <SubtitleDisplaySwitch />
      <SubtitleSizeStepper />
      <VolumeControl alwaysShowSlider />
    </div>
  );
}
