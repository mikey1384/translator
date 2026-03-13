import { css, cx } from '@emotion/css';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStore } from '../../state';
import Switch from '../../components/Switch';
import {
  byoCardStyles,
  settingsCardTitleStyles,
  settingsMetaTextStyles,
  settingsStatusErrorStyles,
  settingsStatusMessageStyles,
  apiKeyModeToggleCardActiveStyles,
  apiKeyModeToggleCardStyles,
  apiKeyModeToggleDetailsStyles,
  apiKeyModeToggleLabelStyles,
} from './styles';
import { openApiKeysRequired } from '../../state/modal-store';
import {
  hasAnyByoEntitlementUnlocked,
  hasApiKeyModeConfiguredCoverage,
} from '../../state/byo-runtime';

export default function ApiKeyModeToggle() {
  const { t } = useTranslation();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(state => state.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(
    state => state.byoElevenLabsUnlocked
  );
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const useApiKeysMode = useAiStore(state => state.useApiKeysMode);
  const setUseApiKeysMode = useAiStore(state => state.setUseApiKeysMode);
  const keyPresent = useAiStore(state => state.keyPresent);
  const anthropicKeyPresent = useAiStore(state => state.anthropicKeyPresent);
  const elevenLabsKeyPresent = useAiStore(state => state.elevenLabsKeyPresent);

  // Effective BYO unlocked state (respects admin preview mode)
  const effectiveByoUnlocked =
    hasAnyByoEntitlementUnlocked({
      byoUnlocked,
      byoAnthropicUnlocked,
      byoElevenLabsUnlocked,
    }) && !adminByoPreviewMode;

  // Don't render if not unlocked (or in admin preview mode)
  if (!effectiveByoUnlocked) {
    return null;
  }

  const savedKeysCount = [
    keyPresent,
    anthropicKeyPresent,
    elevenLabsKeyPresent,
  ].filter(Boolean).length;
  const coverageReady = hasApiKeyModeConfiguredCoverage({
    byoUnlocked,
    byoAnthropicUnlocked,
    byoElevenLabsUnlocked,
    keyPresent,
    anthropicKeyPresent,
    elevenLabsKeyPresent,
  });

  const handleToggle = async (value: boolean) => {
    setStatusMessage(null);
    setStatusError(null);

    // When turning ON, validate that required keys are present
    if (value) {
      if (
        !hasApiKeyModeConfiguredCoverage({
          byoUnlocked,
          byoAnthropicUnlocked,
          byoElevenLabsUnlocked,
          keyPresent,
          anthropicKeyPresent,
          elevenLabsKeyPresent,
        })
      ) {
        // Show modal explaining what's needed
        openApiKeysRequired();
        return;
      }
    }

    const result = await setUseApiKeysMode(value);
    if (!result.success) {
      setStatusError(
        result.error ||
          t(
            'settings.apiKeyMode.toggleError',
            'Failed to update preference.'
          )
      );
      return;
    }
    setStatusMessage(
      value
        ? t(
            'settings.apiKeyMode.toggleOn',
            'Using your API keys for all AI operations. Stage5 credits will not be used.'
          )
        : t(
            'settings.apiKeyMode.toggleOff',
            'Using Stage5 credits for all AI operations.'
          )
    );
  };

  return (
    <section className={byoCardStyles}>
      <h2 className={settingsCardTitleStyles}>
        {t('settings.aiProvider.title', 'AI Provider')}
      </h2>

      <div
        className={cx(
          apiKeyModeToggleCardStyles,
          useApiKeysMode && apiKeyModeToggleCardActiveStyles
        )}
      >
        <div className={apiKeyModeToggleDetailsStyles}>
          <span className={apiKeyModeToggleLabelStyles}>
            {t('settings.apiKeyMode.toggleLabel', 'Use my API keys')}
          </span>
          <span className={settingsMetaTextStyles}>
            {useApiKeysMode || coverageReady
              ? savedKeysCount > 0
                ? t(
                    'settings.apiKeyMode.activeKeys',
                    '{{count}} key(s) ready',
                    { count: savedKeysCount }
                  )
                : t('settings.apiKeyMode.noKeys', 'No keys configured')
              : t(
                  'settings.apiKeyMode.requirement',
                  'Needs translation + audio coverage'
                )}
          </span>
          <span className={settingsMetaTextStyles}>
            {useApiKeysMode
              ? t(
                  'settings.apiKeyMode.usingApiKeys',
                  'Stage5 credits off'
                )
              : t(
                  'settings.apiKeyMode.usingCredits',
                  'Stage5 credits on'
                )}
          </span>
        </div>
        <Switch
          checked={useApiKeysMode}
          onChange={handleToggle}
          aria-label={t(
            'settings.apiKeyMode.toggleAria',
            'Use my API keys'
          )}
        />
      </div>

      {statusMessage && (
        <p className={settingsStatusMessageStyles}>{statusMessage}</p>
      )}
      {statusError && (
        <p className={settingsStatusErrorStyles}>{statusError}</p>
      )}
    </section>
  );
}
