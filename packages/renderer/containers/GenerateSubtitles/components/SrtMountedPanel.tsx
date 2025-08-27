import { css } from '@emotion/css';
import { colors } from '../../../styles.js';
import { useTranslation } from 'react-i18next';

interface SrtMountedPanelProps {
  srtPath?: string | null;
}

export default function SrtMountedPanel({ srtPath }: SrtMountedPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className={css`
        margin-top: 10px;
        padding: 20px;
        border: 1px solid ${colors.success};
        border-radius: 6px;
        background-color: ${colors.success}0F;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
      `}
    >
      <div
        className={css`
          display: flex;
          align-items: center;
          gap: 12px;
        `}
      >
        <span
          className={css`
            color: ${colors.success};
            font-size: 1.2rem;
          `}
        >
          ✓
        </span>
        <div>
          <div
            className={css`
              font-weight: 600;
              color: ${colors.dark};
            `}
          >
            {t('input.srtLoaded', 'Transcription Complete')}
          </div>
          {srtPath && (
            <div
              className={css`
                font-size: 0.9rem;
                color: ${colors.gray};
                margin-top: 2px;
              `}
            >
              {srtPath.split(/[/\\]/).pop()}
            </div>
          )}
        </div>
      </div>

      <div
        className={css`
          color: ${colors.gray};
          font-style: italic;
        `}
      >
        {t(
          'input.translationComingSoon',
          'Translation controls coming soon...'
        )}
      </div>
    </div>
  );
}
