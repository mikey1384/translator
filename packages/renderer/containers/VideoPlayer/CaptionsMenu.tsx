import { useEffect } from 'react';
import { css } from '@emotion/css';
import { listenClose } from '../../utils/closeOnOutside';
import {
  SubtitleDisplaySwitch,
  SubtitleSizeStepper,
} from '../../components/SubtitleViewControls';
import { colors } from '../../styles';

const menuStyles = css`
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 99999;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: 14px;
  background: rgba(20, 19, 24, 0.96);
  border: 1px solid ${colors.borderStrong};
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.5);
  white-space: nowrap;

  [dir='rtl'] & {
    right: auto;
    left: 0;
  }
`;

/**
 * Which lines show and how big, from the player's own controls, so it works
 * in full screen where the line under the video is hidden.
 */
export default function CaptionsMenu({ onClose }: { onClose: () => void }) {
  useEffect(
    () => listenClose('.captions-menu', onClose, '.captions-btn'),
    [onClose]
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`captions-menu ${menuStyles}`}>
      <SubtitleDisplaySwitch />
      <SubtitleSizeStepper />
    </div>
  );
}
