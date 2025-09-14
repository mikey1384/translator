import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import CreditCard from '../components/CreditCard';
import { colors } from '../styles';
import { useCreditStore } from '../state/credit-store';
import { useEffect } from 'react';
import { useUIStore } from '../state/ui-store';
import Switch from '../components/Switch';

export default function SettingsPage() {
  const { t } = useTranslation();
  useEffect(() => {
    useCreditStore.getState().refresh();
  }, []);

  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: 48px;
        padding: 30px 0;
      `}
    >
      {/* —————————————————  TITLE  ————————————————— */}
      <header
        className={css`
          max-width: 700px;
          margin: 0 auto;
          border-bottom: 1px solid ${colors.border};
          padding-bottom: 18px;
        `}
      >
        <h1
          className={css`
            font-size: 1.8em;
            color: ${colors.dark};
            margin: 0;
          `}
        >
          {t('settings.title')}
        </h1>
      </header>

      {/* Quality Settings (above credits) */}
      <section
        className={css`
          max-width: 700px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        `}
      >
        <h2
          className={css`
            font-size: 1.2rem;
            margin: 0 0 6px;
            color: ${colors.dark};
          `}
        >
          {t('settings.performanceQuality.title', 'Performance & Quality')}
        </h2>
        <QualityToggles />
      </section>

      {/* —————————————————  CREDIT CARD  ————————————————— */}
      <CreditCard />
    </div>
  );
}

function QualityToggles() {
  const { t } = useTranslation();
  const {
    qualityTranscription,
    setQualityTranscription,
    qualityTranslation,
    setQualityTranslation,
  } = useUIStore();

  const row = (
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    help?: string
  ) => (
    <div
      className={css`
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border: 1px solid ${colors.border};
        border-radius: 8px;
        background: ${colors.grayLight};
      `}
    >
      <div>
        <div
          className={css`
            font-weight: 600;
            color: ${colors.dark};
          `}
        >
          {label}
        </div>
        {help ? (
          <div
            className={css`
              margin-top: 4px;
              color: ${colors.gray};
              font-size: 0.9rem;
            `}
          >
            {help}
          </div>
        ) : null}
      </div>
      <Switch checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  );

  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: 10px;
      `}
    >
      {row(
        t(
          'settings.performanceQuality.qualityTranscription.label',
          'Quality Transcription'
        ),
        qualityTranscription,
        setQualityTranscription,
        t(
          'settings.performanceQuality.qualityTranscription.help',
          'On: sequential, uses prior-line context. Off: faster batched mode.'
        )
      )}
      {row(
        t(
          'settings.performanceQuality.qualityTranslation.label',
          'Quality Translation'
        ),
        qualityTranslation,
        setQualityTranslation,
        t(
          'settings.performanceQuality.qualityTranslation.help',
          'On: includes review phase. Off: skip review for speed.'
        )
      )}
    </div>
  );
}
