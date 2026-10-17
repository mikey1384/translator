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
import { localizeErrorOr } from '../../utils/userFacingError';
import { formatUsd } from '../../utils/formatUsd';
import * as SystemIPC from '../../ipc/system';

const BYO_UNLOCK_USD_PRICE = 10;

// The copy carries the price as "$10" / "10$" (any digits); show it as a
// US-dollar price in the UI language's own digits and symbol placement.
function preserveLocalizedUnlockCopyWithUsdPrice(
  copy: string,
  locale: string
): string {
  return copy.replace(
    /\$\s?(?:10|۱۰|১০|१०|١٠)|(?:10|۱۰|১০|१०|١٠)\s?\$/g,
    formatUsd(BYO_UNLOCK_USD_PRICE, locale)
  );
}

export default function ByoUnlockCard() {
  const { t, i18n } = useTranslation();
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
  const unlockUnresolved = useAiStore(state => state.unlockUnresolved);
  const unlockError = useAiStore(state => state.unlockError);
  const startUnlock = useAiStore(state => state.startUnlock);
  const dismissUnresolvedUnlock = useAiStore(
    state => state.dismissUnresolvedUnlock
  );
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

  useEffect(() => {
    // Track button shown once when card is mounted and not hidden
    if (!shouldHideUpgradeCard) {
      void SystemIPC.trackPurchaseEvent('byo_unlock_button_shown', {
        placement: 'settings-byo',
      }).catch(() => {
        // Ignore tracking errors
      });
    }
  }, [shouldHideUpgradeCard]);

  const handleUnlock = async () => {
    logButton('settings_byo_unlock_click');

    // Track button click
    void SystemIPC.trackPurchaseEvent('byo_unlock_button_clicked', {
      placement: 'settings-byo',
    }).catch(() => {
      // Ignore tracking errors
    });

    await startUnlock();
  };

  const unlockPriceLabel = preserveLocalizedUnlockCopyWithUsdPrice(
    t('settings.byoOpenAi.unlockCta', 'Unlock for $10'),
    i18n.language
  );

  // Hide the purchase CTA only after the full Stage5 BYO bundle is unlocked.
  // Legacy partial entitlements still need an upgrade path for audio/OpenAI coverage.
  if (shouldHideUpgradeCard) {
    return null;
  }

  const loading = entitlementsLoading && !hasAnyUnlocked;

  return (
    <section
      className={byoCardStyles}
      data-translator-destination="settings-byo"
    >
      <h2 className={settingsCardTitleStyles}>
        {t('settings.byoOpenAi.title', 'Bring Your Own API Keys')}
      </h2>

      <p className={settingsBodyTextStyles}>
        {t(
          'settings.byoOpenAi.description',
          'A one-time unlock to use your own API keys. Once unlocked, transcription, translation, dubbing and summaries run on your own AI accounts instead of using your Stage5 minutes.'
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
            'Stage5 minutes are the easy option: nothing to set up. With your own keys you pay the AI providers directly, usually about 30–50% less, depending on the pack.'
          )}
        </div>
      </div>

      {entitlementsError && (
        <div className={settingsDangerCalloutStyles}>
          <span className={settingsDangerTextStyles}>
            {localizeErrorOr(entitlementsError, t as any, {
              key: 'settings.byoOpenAi.entitlementsLoadFailed',
              defaultText:
                'Your unlock status couldn’t be checked. Check your connection and retry.',
            })}
          </span>
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
        disabled={unlockPending || unlockUnresolved || loading}
        variant="secondary"
      >
        {unlockPending
          ? t('settings.byoOpenAi.unlocking', 'Opening checkout…')
          : unlockUnresolved
            ? t('settings.byoOpenAi.checkoutOpen', 'Checkout open in browser…')
            : unlockPriceLabel}
      </Button>

      {unlockUnresolved && (
        <div className={settingsCalloutStyles}>
          <div className={settingsCalloutBodyStyles}>
            {t(
              'settings.byoOpenAi.checkoutOpenHint',
              'Finish checkout in your browser. Your own keys unlock automatically once the payment goes through.'
            )}{' '}
            <button
              type="button"
              onClick={dismissUnresolvedUnlock}
              className={settingsInlineLinkButtonStyles}
            >
              {t('credits.iCancelledCheckout', 'I cancelled checkout')}
            </button>
          </div>
        </div>
      )}

      {unlockError && (
        <p className={settingsStatusErrorStyles}>
          {localizeErrorOr(unlockError, t as any, {
            key: 'settings.byoOpenAi.unlockFailed',
            defaultText:
              'Checkout couldn’t start. Check your connection and try again.',
          })}
        </p>
      )}
      <ApiKeyGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </section>
  );
}
