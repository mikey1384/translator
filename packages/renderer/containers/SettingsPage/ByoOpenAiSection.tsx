import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStore } from '../../state';
import {
  byoCardStyles,
  byoLayoutStyles,
  byoPrimaryColumnStyles,
  byoVoiceSectionStyles,
  settingsCardTitleStyles,
  settingsDangerCalloutStyles,
  settingsDangerTextStyles,
  settingsMetaTextStyles,
} from './styles';
import ApiKeyGuideModal from './ApiKeyGuideModal';
import DubbingVoiceSelector from './DubbingVoiceSelector';
import ByoApiKeysColumn from './ByoApiKeysColumn';
import ByoProviderPreferencesPanel from './ByoProviderPreferencesPanel';
import { logButton } from '../../utils/logger';
import { hasAnyByoEntitlementUnlocked } from '../../state/byo-runtime';

export default function ByoOpenAiSection() {
  const { t } = useTranslation();
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideProvider, setGuideProvider] = useState<
    'openai' | 'anthropic' | 'elevenlabs' | undefined
  >();

  const openGuide = (provider: 'openai' | 'anthropic' | 'elevenlabs') => {
    logButton(`settings_byo_guide_open_${provider}`);
    setGuideProvider(provider);
    setGuideOpen(true);
  };

  const initialized = useAiStore(state => state.initialized);
  const initialize = useAiStore(state => state.initialize);
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(state => state.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(
    state => state.byoElevenLabsUnlocked
  );
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const useStrictByoMode = useAiStore(state => state.useStrictByoMode);
  const lastFetched = useAiStore(state => state.lastFetched);
  const encryptionAvailable = useAiStore(state => state.encryptionAvailable);

  const loadKey = useAiStore(state => state.loadKey);
  const loadAnthropicKey = useAiStore(state => state.loadAnthropicKey);
  const loadElevenLabsKey = useAiStore(state => state.loadElevenLabsKey);

  const effectiveByoUnlocked =
    hasAnyByoEntitlementUnlocked({
      byoUnlocked,
      byoAnthropicUnlocked,
      byoElevenLabsUnlocked,
    }) && !adminByoPreviewMode;

  useEffect(() => {
    if (!initialized) {
      initialize().catch(err => {
        console.error('[ByoOpenAiSection] init failed', err);
      });
    }
  }, [initialized, initialize]);

  useEffect(() => {
    loadKey();
    loadAnthropicKey();
    loadElevenLabsKey();
  }, [loadKey, loadAnthropicKey, loadElevenLabsKey]);

  if (!effectiveByoUnlocked || !useStrictByoMode) {
    return null;
  }

  return (
    <section className={byoCardStyles}>
      <h2 className={settingsCardTitleStyles}>
        {t('settings.byoOpenAi.title', 'Bring Your Own API Keys')}
      </h2>

      {lastFetched && (
        <span className={settingsMetaTextStyles}>
          {t('settings.byoOpenAi.lastSynced', 'Last synced')}: {lastFetched}
        </span>
      )}

      {!encryptionAvailable && (
        <div className={settingsDangerCalloutStyles}>
          <span className={settingsDangerTextStyles}>
            {t(
              'settings.byoOpenAi.encryptionUnavailable',
              'Secure storage is not available on this system. API keys cannot be saved.'
            )}
          </span>
        </div>
      )}

      <div className={byoLayoutStyles}>
        <ByoApiKeysColumn
          onOpenGuide={openGuide}
          className={byoPrimaryColumnStyles}
        />
        <ByoProviderPreferencesPanel />
      </div>

      <div className={byoVoiceSectionStyles}>
        <DubbingVoiceSelector />
      </div>

      <ApiKeyGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        provider={guideProvider}
      />
    </section>
  );
}
