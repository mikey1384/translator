import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import CreditCard from '../../components/CreditCard';
import AdminResetButton from '../../components/AdminResetButton';
import { shellHeaderBlockStyles, shellTitleStyles } from '../../styles';
import { useCreditStore } from '../../state/credit-store';
import { useAiStore } from '../../state';
import { SystemIPC } from '../../ipc';
import Section from '../../components/Section';
import QualityToggles from './QualityToggles';
import DubbingVoiceSelector from './DubbingVoiceSelector';
import DubbingMixSlider from './DubbingMixSlider';
import ByoUnlockCard from './ByoUnlockCard';
import ApiKeyModeToggle from './ApiKeyModeToggle';
import ByoOpenAiSection from './ByoOpenAiSection';
import SiteConnectionSection from './SiteConnectionSection';
import { hasAnyByoEntitlementUnlocked } from '../../state/byo-runtime';
import { settingsCenterColumnStyles, settingsPageLayoutStyles } from './styles';

export default function SettingsPage() {
  const { t } = useTranslation();
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(state => state.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(
    state => state.byoElevenLabsUnlocked
  );
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const useApiKeysMode = useAiStore(state => state.useApiKeysMode);
  const [isAdmin, setIsAdmin] = useState(false);

  // Effective BYO unlocked state (respects admin preview mode)
  const effectiveByoUnlocked =
    hasAnyByoEntitlementUnlocked({
      byoUnlocked,
      byoAnthropicUnlocked,
      byoElevenLabsUnlocked,
    }) && !adminByoPreviewMode;

  useEffect(() => {
    useCreditStore.getState().refresh();
  }, []);

  useEffect(() => {
    let mounted = true;
    const checkAdminStatus = async () => {
      try {
        const admin = await SystemIPC.isAdminMode();
        if (mounted) {
          setIsAdmin(admin);
        }
      } catch (error) {
        console.error('Failed to check admin status:', error);
        if (mounted) {
          setIsAdmin(false);
        }
      }
    };

    void checkAdminStatus();
    return () => {
      mounted = false;
    };
  }, []);

  // Show Stage5 credits section when:
  // - BYO is not unlocked (default flow)
  // - OR BYO is unlocked but API-key mode is OFF (using credits)
  const showStage5Section = !effectiveByoUnlocked || !useApiKeysMode;

  return (
    <div className={settingsPageLayoutStyles}>
      <header className={shellHeaderBlockStyles}>
        <h1 className={shellTitleStyles}>{t('settings.title')}</h1>
      </header>

      {/* —————————————————  STAGE5 CREDITS SECTION  ————————————————— */}
      {showStage5Section && <CreditCard />}

      {/* —————————————————  BYO MODE TOGGLE (if unlocked)  ————————————————— */}
      <ApiKeyModeToggle />

      {showStage5Section && (
        <Section
          title={t(
            'settings.performanceQuality.title',
            'Performance & Quality'
          )}
          className={settingsCenterColumnStyles}
        >
          <QualityToggles />
          <DubbingVoiceSelector />
          <DubbingMixSlider />
        </Section>
      )}

      {/* —————————————————  BYO UNLOCK (if not unlocked)  ————————————————— */}
      <ByoUnlockCard />

      {isAdmin && (
        <Section
          title={t('admin.title', 'Admin')}
          className={settingsCenterColumnStyles}
        >
          <AdminResetButton />
        </Section>
      )}

      {isAdmin && <SiteConnectionSection />}

      {/* —————————————————  BYO API KEYS SECTION (if unlocked + API-key mode ON)  ————————————————— */}
      <ByoOpenAiSection />
    </div>
  );
}
