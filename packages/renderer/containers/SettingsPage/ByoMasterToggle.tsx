import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';
import { useAiStore } from '../../state';
import Switch from '../../components/Switch';
import { byoCardStyles } from './styles';

export default function ByoMasterToggle() {
  const { t } = useTranslation();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const useByoMaster = useAiStore(state => state.useByoMaster);
  const setUseByoMaster = useAiStore(state => state.setUseByoMaster);
  const keyPresent = useAiStore(state => state.keyPresent);
  const anthropicKeyPresent = useAiStore(state => state.anthropicKeyPresent);
  const elevenLabsKeyPresent = useAiStore(state => state.elevenLabsKeyPresent);

  // Effective BYO unlocked state (respects admin preview mode)
  const effectiveByoUnlocked = byoUnlocked && !adminByoPreviewMode;

  // Don't render if not unlocked (or in admin preview mode)
  if (!effectiveByoUnlocked) {
    return null;
  }

  const savedKeysCount = [
    keyPresent,
    anthropicKeyPresent,
    elevenLabsKeyPresent,
  ].filter(Boolean).length;

  const handleToggle = async (value: boolean) => {
    setStatusMessage(null);
    setStatusError(null);
    const result = await setUseByoMaster(value);
    if (!result.success) {
      setStatusError(
        result.error ||
          t('settings.byoMaster.toggleError', 'Failed to update preference.')
      );
      return;
    }
    setStatusMessage(
      value
        ? t(
            'settings.byoMaster.toggleOn',
            'Using your API keys for AI operations.'
          )
        : t(
            'settings.byoMaster.toggleOff',
            'Using Stage5 credits for all AI operations.'
          )
    );
  };

  return (
    <section className={byoCardStyles}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
        {t('settings.aiProvider.title', 'AI Provider')}
      </h2>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 16px',
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          background: useByoMaster ? colors.grayLight : 'transparent',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            color: colors.dark,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '1rem' }}>
            {t('settings.byoMaster.toggleLabel', 'Use my API keys')}
          </span>
          <span style={{ color: colors.textDim, fontSize: '.85rem' }}>
            {useByoMaster
              ? savedKeysCount > 0
                ? t(
                    'settings.byoMaster.activeKeys',
                    '{{count}} key(s) active',
                    { count: savedKeysCount }
                  )
                : t('settings.byoMaster.noKeys', 'No keys configured')
              : t(
                  'settings.byoMaster.usingCredits',
                  'All AI uses Stage5 credits'
                )}
            {!useByoMaster && savedKeysCount > 0 && (
              <span style={{ marginLeft: 8, opacity: 0.7 }}>
                · {savedKeysCount} {savedKeysCount === 1 ? 'key' : 'keys'} saved
              </span>
            )}
          </span>
        </div>
        <Switch
          checked={useByoMaster}
          onChange={handleToggle}
          aria-label={t(
            'settings.byoMaster.toggleAria',
            'Toggle using your API keys'
          )}
        />
      </div>

      {statusMessage && (
        <p style={{ color: colors.primary, margin: 0 }}>{statusMessage}</p>
      )}
      {statusError && (
        <p style={{ color: colors.danger, margin: 0 }}>{statusError}</p>
      )}
    </section>
  );
}
