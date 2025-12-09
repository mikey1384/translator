import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';
import { useUIStore } from '../../state/ui-store';

export default function DubbingMixSlider() {
  const { t } = useTranslation();
  const { dubAmbientMix, setDubAmbientMix } = useUIStore();
  const percent = Math.round(dubAmbientMix * 100);
  const voicePercent = 100 - percent;

  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: 10px;
      `}
    >
      <div
        className={css`
          font-weight: 600;
          color: ${colors.text};
        `}
      >
        {t('settings.dubbing.mixLabel', 'Ambient vs Dub Balance')}
      </div>

      <div
        className={css`
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        `}
      >
        <span
          className={css`
            color: ${colors.gray};
            font-size: 0.85rem;
            min-width: 80px;
          `}
        >
          {t('settings.dubbing.mixVoice', 'More voice')} ({voicePercent}%)
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={e => setDubAmbientMix(Number(e.target.value) / 100)}
          aria-label={t('settings.dubbing.mixLabel', 'Ambient vs Dub Balance')}
          className={css`
            flex: 1 1 180px;
            accent-color: ${colors.primary};
          `}
        />
        <span
          className={css`
            color: ${colors.gray};
            font-size: 0.85rem;
            min-width: 80px;
            text-align: right;
          `}
        >
          {t('settings.dubbing.mixAmbient', 'More ambient')} ({percent}%)
        </span>
      </div>

      <div
        className={css`
          color: ${colors.gray};
          font-size: 0.85rem;
        `}
      >
        {t(
          'settings.dubbing.mixHelp',
          'Control how much of the original audio plays underneath the dubbed voice.'
        )}
      </div>
    </div>
  );
}
