import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import CreditCard from '../../components/CreditCard';
import { colors } from '../../styles';
import { useCreditStore } from '../../state/credit-store';
import { useAiStore } from '../../state';
import QualityToggles from './QualityToggles';
import DubbingVoiceSelector from './DubbingVoiceSelector';
import DubbingMixSlider from './DubbingMixSlider';
import ByoUnlockCard from './ByoUnlockCard';
import ByoMasterToggle from './ByoMasterToggle';
import ByoOpenAiSection from './ByoOpenAiSection';

export default function SettingsPage() {
  const { t } = useTranslation();
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const useByoMaster = useAiStore(state => state.useByoMaster);

  // Effective BYO unlocked state (respects admin preview mode)
  const effectiveByoUnlocked = byoUnlocked && !adminByoPreviewMode;

  useEffect(() => {
    useCreditStore.getState().refresh();
  }, []);

  // Show Stage5 credits section when:
  // - BYO is not unlocked (default flow)
  // - OR BYO is unlocked but master toggle is OFF (using credits)
  const showStage5Section = !effectiveByoUnlocked || !useByoMaster;

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

      {/* —————————————————  BYO UNLOCK (if not unlocked)  ————————————————— */}
      <ByoUnlockCard />

      {/* —————————————————  MASTER TOGGLE (if unlocked)  ————————————————— */}
      <ByoMasterToggle />

      {/* —————————————————  STAGE5 CREDITS SECTION  ————————————————— */}
      {showStage5Section && (
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
          <DubbingVoiceSelector />
          <DubbingMixSlider />
          <CreditCard />
        </section>
      )}

      {/* —————————————————  BYO API KEYS SECTION (if unlocked + master ON)  ————————————————— */}
      <ByoOpenAiSection />
    </div>
  );
}
