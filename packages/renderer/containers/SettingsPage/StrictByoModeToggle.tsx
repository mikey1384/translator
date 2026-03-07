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
  strictByoToggleCardActiveStyles,
  strictByoToggleCardStyles,
  strictByoToggleDetailsStyles,
  strictByoToggleLabelStyles,
} from './styles';
import { openApiKeysRequired } from '../../state/modal-store';
import {
  hasAnyByoEntitlementUnlocked,
  hasStrictByoConfiguredCoverage,
} from '../../state/byo-runtime';

export default function StrictByoModeToggle() {
  const { t } = useTranslation();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(state => state.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(
    state => state.byoElevenLabsUnlocked
  );
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const useStrictByoMode = useAiStore(state => state.useStrictByoMode);
  const setUseStrictByoMode = useAiStore(state => state.setUseStrictByoMode);
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
  const coverageReady = hasStrictByoConfiguredCoverage({
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
        !hasStrictByoConfiguredCoverage({
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

    const result = await setUseStrictByoMode(value);
    if (!result.success) {
      setStatusError(
        result.error ||
          t(
            'settings.strictByoMode.toggleError',
            'Failed to update preference.'
          )
      );
      return;
    }
    setStatusMessage(
      value
        ? t(
            'settings.strictByoMode.toggleOn',
            'Using your API keys for all AI operations. Stage5 credits will not be used.'
          )
        : t(
            'settings.strictByoMode.toggleOff',
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
          strictByoToggleCardStyles,
          useStrictByoMode && strictByoToggleCardActiveStyles
        )}
      >
        <div className={strictByoToggleDetailsStyles}>
          <span className={strictByoToggleLabelStyles}>
            {t('settings.strictByoMode.toggleLabel', 'Use my API keys')}
          </span>
          <span className={settingsMetaTextStyles}>
            {useStrictByoMode || coverageReady
              ? savedKeysCount > 0
                ? t(
                    'settings.strictByoMode.activeKeys',
                    '{{count}} key(s) ready',
                    { count: savedKeysCount }
                  )
                : t('settings.strictByoMode.noKeys', 'No keys configured')
              : t(
                  'settings.strictByoMode.requirement',
                  'Needs translation + audio coverage'
                )}
          </span>
          <span className={settingsMetaTextStyles}>
            {useStrictByoMode
              ? t(
                  'settings.strictByoMode.strictActive',
                  'Stage5 credits off'
                )
              : t(
                  'settings.strictByoMode.usingCredits',
                  'Stage5 credits on'
                )}
          </span>
        </div>
        <Switch
          checked={useStrictByoMode}
          onChange={handleToggle}
          aria-label={t(
            'settings.strictByoMode.toggleAria',
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
