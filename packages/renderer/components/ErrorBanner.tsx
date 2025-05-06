import { css } from '@emotion/css';
import { colors, errorMessageStyles } from '../styles';

interface Props {
  message: string;
  onClose: () => void;
}

export default function ErrorBanner({ message, onClose }: Props) {
  if (!message) return null;

  return (
    <div
      className={css`
        ${errorMessageStyles};
        position: relative;
        padding-right: 30px; /* space for the X */
      `}
    >
      {message}
      <button
        aria-label="Dismiss error"
        onClick={onClose}
        className={css`
          position: absolute;
          top: 50%;
          right: 10px;
          transform: translateY(-50%);
          background: none;
          border: 0;
          font-size: 1rem;
          color: ${colors.danger};
          cursor: pointer;

          &:hover {
            color: ${colors.dark};
          }
        `}
      >
        ✕
      </button>
    </div>
  );
}
