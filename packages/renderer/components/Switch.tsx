import { css, cx } from '@emotion/css';
import { colors } from '../styles';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

const track = css`
  position: relative;
  width: 44px;
  height: 24px;
  background: ${colors.gray};
  border: 1px solid ${colors.border};
  border-radius: 999px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  cursor: pointer;
  flex: 0 0 auto;
  box-sizing: border-box;
`;

const trackOn = css`
  background: ${colors.primary};
  border-color: ${colors.primary};
`;

const thumb = css`
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: ${colors.dark};
  border-radius: 50%;
  transition: transform 0.2s ease;
`;

const thumbOn = css`
  transform: translateX(20px);
`;

export default function Switch({
  checked,
  onChange,
  disabled,
  className,
  ariaLabel,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cx(track, checked && trackOn, className)}
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={e => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <span className={cx(thumb, checked && thumbOn)} />
    </button>
  );
}
