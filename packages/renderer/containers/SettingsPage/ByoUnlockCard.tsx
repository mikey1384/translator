import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStore } from '../../state';
import { logButton } from '../../utils/logger';
import Button from '../../components/Button';
import {
  byoCardStyles,
  settingsBodyTextStyles,
  settingsCalloutBodyStyles,
  settingsCalloutStyles,
  settingsCalloutTitleStyles,
  settingsCardTitleStyles,
  settingsDangerCalloutStyles,
  settingsDangerTextStyles,
  settingsInlineLinkButtonStyles,
  settingsStatusErrorStyles,
} from './styles';
import ApiKeyGuideModal from './ApiKeyGuideModal';
import {
  hasAnyByoEntitlementUnlocked,
  hasFullByoBundleUnlocked,
} from '../../state/byo-runtime';

export default function ByoUnlockCard() {
  const { t } = useTranslation();
  const [guideOpen, setGuideOpen] = useState(false);

  const initialized = useAiStore(state => state.initialized);
  const initialize = useAiStore(state => state.initialize);
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(state => state.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(
    state => state.byoElevenLabsUnlocked
  );
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const entitlementsLoading = useAiStore(state => state.entitlementsLoading);
  const entitlementsError = useAiStore(state => state.entitlementsError);
  const unlockPending = useAiStore(state => state.unlockPending);
  const unlockError = useAiStore(state => state.unlockError);
  const startUnlock = useAiStore(state => state.startUnlock);
  const refreshEntitlements = useAiStore(state => state.refreshEntitlements);

  const hasAnyUnlocked = hasAnyByoEntitlementUnlocked({
    byoUnlocked,
    byoAnthropicUnlocked,
    byoElevenLabsUnlocked,
  });
  const hasFullBundleUnlocked = hasFullByoBundleUnlocked({ byoUnlocked });
  const shouldHideUpgradeCard = hasFullBundleUnlocked && !adminByoPreviewMode;

  useEffect(() => {
    if (!initialized) {
      initialize().catch(err => {
        console.error('[ByoUnlockCard] init failed', err);
      });
    }
  }, [initialized, initialize]);

  const handleUnlock = async () => {
    logButton('settings_byo_unlock_click');
    await startUnlock();
  };

  // Hide the purchase CTA only after the full Stage5 BYO bundle is unlocked.
  // Legacy partial entitlements still need an upgrade path for audio/OpenAI coverage.
  if (shouldHideUpgradeCard) {
    return null;
  }

  const loading = entitlementsLoading && !hasAnyUnlocked;

  return (
    <section className={byoCardStyles}>
      <h2 className={settingsCardTitleStyles}>
        {t('settings.byoOpenAi.title', 'Bring Your Own API Keys')}
      </h2>

      <p className={settingsBodyTextStyles}>
        {t(
          'settings.byoOpenAi.description',
          'Unlock a one-time upgrade to use your own API keys. Once unlocked, any transcription, translation, dubbing, or summary runs directly on your accounts instead of consuming Stage5 credits.'
        )}{' '}
        <button
          onClick={() => {
            logButton('settings_byo_guide_open');
            setGuideOpen(true);
          }}
          className={settingsInlineLinkButtonStyles}
        >
          {t('settings.byoOpenAi.howToGetKeys', 'How do I get API keys?')}
        </button>
      </p>

      <div className={settingsCalloutStyles}>
        <div className={settingsCalloutTitleStyles}>
          {t('settings.byoOpenAi.economicsTitle', 'Why it’s worth it')}
        </div>
        <div className={settingsCalloutBodyStyles}>
          {t(
            'settings.byoOpenAi.economicsBody',
            'Stage5 credits optimize for convenience (no setup). BYO pays providers directly—usually ~30–50% cheaper depending on your pack.'
          )}
        </div>
      </div>

      {entitlementsError && (
        <div className={settingsDangerCalloutStyles}>
          <span className={settingsDangerTextStyles}>{entitlementsError}</span>
          <button
            onClick={() => refreshEntitlements()}
            className={settingsInlineLinkButtonStyles}
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
      )}

      <Button
        onClick={handleUnlock}
        disabled={unlockPending || loading}
        variant="primary"
      >
        {unlockPending
          ? t('settings.byoOpenAi.unlocking', 'Opening checkout…')
          : t('settings.byoOpenAi.unlockCta', 'Unlock for $10')}
      </Button>

      {unlockError && (
        <p className={settingsStatusErrorStyles}>{unlockError}</p>
      )}
      <ApiKeyGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </section>
  );
}
