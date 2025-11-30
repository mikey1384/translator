import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import CreditCard from '../components/CreditCard';
import { colors, selectStyles } from '../styles';
import { useCreditStore } from '../state/credit-store';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useUIStore } from '../state/ui-store';
import Switch from '../components/Switch';
import * as SubtitlesIPC from '../ipc/subtitles';
import { useAiStore } from '../state';
import { logButton } from '../utils/logger';

// TTS credits per minute of speech (based on ~750 chars/min average speech rate)
// OpenAI: $15/1M chars * 2 margin / USD_PER_CREDIT ≈ 1.05 credits/char → ~788 credits/min
// ElevenLabs: $200/1M chars * 2 margin / USD_PER_CREDIT ≈ 14 credits/char → ~10,500 credits/min
const TTS_CREDITS_PER_MINUTE = {
  openai: 788,
  elevenlabs: 10500,
} as const;

function formatDubbingTime(credits: number, provider: 'openai' | 'elevenlabs'): string {
  const creditsPerMin = TTS_CREDITS_PER_MINUTE[provider];
  const minutes = credits / creditsPerMin;
  if (minutes < 1) {
    const seconds = Math.floor(minutes * 60);
    return `~${seconds}s`;
  }
  if (minutes < 60) {
    return `~${Math.floor(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = Math.floor(minutes % 60);
  if (remainingMins === 0) {
    return `~${hours}h`;
  }
  return `~${hours}h ${remainingMins}m`;
}

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
        <DubbingVoiceSelector />
        <DubbingMixSlider />
      </section>

      {/* —————————————————  CREDIT CARD  ————————————————— */}
      <CreditCard />

      <ByoOpenAiSection />
    </div>
  );
}

const byoCardStyles = css`
  background: rgba(40, 40, 40, 0.6);
  border: 1px solid ${colors.border};
  border-radius: 8px;
  padding: 24px;
  max-width: 660px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

function ByoOpenAiSection() {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  // Credit balance for dubbing time estimates
  const credits = useCreditStore(state => state.credits);
  const [anthropicStatusMessage, setAnthropicStatusMessage] = useState<
    string | null
  >(null);
  const [anthropicStatusError, setAnthropicStatusError] = useState<
    string | null
  >(null);
  const [elevenLabsStatusMessage, setElevenLabsStatusMessage] = useState<
    string | null
  >(null);
  const [elevenLabsStatusError, setElevenLabsStatusError] = useState<
    string | null
  >(null);
  const [masterStatusMessage, setMasterStatusMessage] = useState<string | null>(
    null
  );
  const [masterStatusError, setMasterStatusError] = useState<string | null>(
    null
  );

  const initialized = useAiStore(state => state.initialized);
  const initialize = useAiStore(state => state.initialize);
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const entitlementsLoading = useAiStore(state => state.entitlementsLoading);
  const entitlementsError = useAiStore(state => state.entitlementsError);
  const unlockPending = useAiStore(state => state.unlockPending);
  const unlockError = useAiStore(state => state.unlockError);
  const lastFetched = useAiStore(state => state.lastFetched);
  // OpenAI state
  const keyValue = useAiStore(state => state.keyValue);
  const keyPresent = useAiStore(state => state.keyPresent);
  const keyLoading = useAiStore(state => state.keyLoading);
  const savingKey = useAiStore(state => state.savingKey);
  const validatingKey = useAiStore(state => state.validatingKey);
  const useByo = useAiStore(state => state.useByo);
  const setKeyValue = useAiStore(state => state.setKeyValue);
  const saveKey = useAiStore(state => state.saveKey);
  const clearKey = useAiStore(state => state.clearKey);
  const startUnlock = useAiStore(state => state.startUnlock);
  const validateKey = useAiStore(state => state.validateKey);
  const refreshEntitlements = useAiStore(state => state.refreshEntitlements);
  const setUseByo = useAiStore(state => state.setUseByo);
  // Anthropic state
  const anthropicKeyValue = useAiStore(state => state.anthropicKeyValue);
  const anthropicKeyPresent = useAiStore(state => state.anthropicKeyPresent);
  const anthropicKeyLoading = useAiStore(state => state.anthropicKeyLoading);
  const savingAnthropicKey = useAiStore(state => state.savingAnthropicKey);
  const validatingAnthropicKey = useAiStore(
    state => state.validatingAnthropicKey
  );
  const useByoAnthropic = useAiStore(state => state.useByoAnthropic);
  const setAnthropicKeyValue = useAiStore(state => state.setAnthropicKeyValue);
  const saveAnthropicKey = useAiStore(state => state.saveAnthropicKey);
  const clearAnthropicKey = useAiStore(state => state.clearAnthropicKey);
  const validateAnthropicKey = useAiStore(state => state.validateAnthropicKey);
  const setUseByoAnthropic = useAiStore(state => state.setUseByoAnthropic);
  // ElevenLabs state
  const elevenLabsKeyValue = useAiStore(state => state.elevenLabsKeyValue);
  const elevenLabsKeyPresent = useAiStore(state => state.elevenLabsKeyPresent);
  const elevenLabsKeyLoading = useAiStore(state => state.elevenLabsKeyLoading);
  const savingElevenLabsKey = useAiStore(state => state.savingElevenLabsKey);
  const validatingElevenLabsKey = useAiStore(
    state => state.validatingElevenLabsKey
  );
  const useByoElevenLabs = useAiStore(state => state.useByoElevenLabs);
  const setElevenLabsKeyValue = useAiStore(
    state => state.setElevenLabsKeyValue
  );
  const saveElevenLabsKey = useAiStore(state => state.saveElevenLabsKey);
  const clearElevenLabsKey = useAiStore(state => state.clearElevenLabsKey);
  const validateElevenLabsKey = useAiStore(
    state => state.validateElevenLabsKey
  );
  const setUseByoElevenLabs = useAiStore(state => state.setUseByoElevenLabs);
  // Master toggle
  const useByoMaster = useAiStore(state => state.useByoMaster);
  const setUseByoMaster = useAiStore(state => state.setUseByoMaster);
  // Claude translation preference
  const preferClaudeTranslation = useAiStore(
    state => state.preferClaudeTranslation
  );
  const setPreferClaudeTranslation = useAiStore(
    state => state.setPreferClaudeTranslation
  );
  // Claude review preference
  const preferClaudeReview = useAiStore(state => state.preferClaudeReview);
  const setPreferClaudeReview = useAiStore(
    state => state.setPreferClaudeReview
  );
  // Transcription provider preference
  const preferredTranscriptionProvider = useAiStore(
    state => state.preferredTranscriptionProvider
  );
  const setPreferredTranscriptionProvider = useAiStore(
    state => state.setPreferredTranscriptionProvider
  );
  // Dubbing provider preference
  const preferredDubbingProvider = useAiStore(
    state => state.preferredDubbingProvider
  );
  const setPreferredDubbingProvider = useAiStore(
    state => state.setPreferredDubbingProvider
  );
  // Stage5 dubbing TTS provider preference
  const stage5DubbingTtsProvider = useAiStore(
    state => state.stage5DubbingTtsProvider
  );
  const setStage5DubbingTtsProvider = useAiStore(
    state => state.setStage5DubbingTtsProvider
  );

  useEffect(() => {
    if (!initialized) {
      initialize().catch(err => {
        console.error('[ByoOpenAiSection] init failed', err);
      });
    }
  }, [initialized, initialize]);

  useEffect(() => {
    setStatusMessage(null);
    setStatusError(null);
  }, [keyValue]);

  useEffect(() => {
    setAnthropicStatusMessage(null);
    setAnthropicStatusError(null);
  }, [anthropicKeyValue]);

  useEffect(() => {
    setElevenLabsStatusMessage(null);
    setElevenLabsStatusError(null);
  }, [elevenLabsKeyValue]);

  const handleUnlock = async () => {
    setStatusMessage(null);
    setStatusError(null);
    logButton('settings_byo_unlock_click');
    await startUnlock();
  };

  const handleSave = async () => {
    setStatusMessage(null);
    setStatusError(null);
    try {
      const result = await saveKey();
      if (result.success) {
        setStatusMessage(
          keyValue.trim()
            ? t('settings.byoOpenAi.keySaved', 'API key saved locally.')
            : t('settings.byoOpenAi.keyCleared', 'API key cleared.')
        );
        logButton('settings_byo_key_save', {
          hasKey: Boolean(keyValue.trim()),
        });
      } else if (result.error) {
        logButton('settings_byo_key_save_error', { error: result.error });
        setStatusError(result.error);
      }
    } catch (err: any) {
      logButton('settings_byo_key_save_exception');
      setStatusError(err?.message || String(err));
    }
  };

  const handleClear = async () => {
    setStatusMessage(null);
    setStatusError(null);
    try {
      const result = await clearKey();
      if (result.success) {
        setStatusMessage(
          t('settings.byoOpenAi.keyCleared', 'API key cleared.')
        );
        logButton('settings_byo_key_clear');
      } else if (result.error) {
        logButton('settings_byo_key_clear_error', { error: result.error });
        setStatusError(result.error);
      }
    } catch (err: any) {
      logButton('settings_byo_key_clear_exception');
      setStatusError(err?.message || String(err));
    }
  };

  const handleTest = async () => {
    setStatusMessage(null);
    setStatusError(null);
    try {
      const result = await validateKey();
      logButton('settings_byo_key_test', { ok: result.ok });
      if (result.ok) {
        setStatusMessage(
          t('settings.byoOpenAi.keyValid', 'API key validated successfully.')
        );
      } else {
        setStatusError(
          result.error ||
            t('settings.byoOpenAi.keyInvalid', 'API key validation failed.')
        );
      }
    } catch (err: any) {
      logButton('settings_byo_key_test_exception');
      setStatusError(err?.message || String(err));
    }
  };

  const handleToggleUseByo = async (value: boolean) => {
    setStatusMessage(null);
    setStatusError(null);
    const result = await setUseByo(value);
    if (!result.success) {
      setStatusError(
        result.error ||
          t('settings.byoOpenAi.toggleError', 'Failed to update preference.')
      );
      return;
    }
    setStatusMessage(
      value
        ? t(
            'settings.byoOpenAi.toggleOn',
            'Using your OpenAI key for AI tasks.'
          )
        : t(
            'settings.byoOpenAi.toggleOff',
            'Using Stage5 credits for AI tasks.'
          )
    );
  };

  // Anthropic handlers
  const handleAnthropicSave = async () => {
    setAnthropicStatusMessage(null);
    setAnthropicStatusError(null);
    try {
      const result = await saveAnthropicKey();
      if (result.success) {
        setAnthropicStatusMessage(
          anthropicKeyValue.trim()
            ? t('settings.byoAnthropic.keySaved', 'Anthropic API key saved.')
            : t(
                'settings.byoAnthropic.keyCleared',
                'Anthropic API key cleared.'
              )
        );
        logButton('settings_anthropic_key_save', {
          hasKey: Boolean(anthropicKeyValue.trim()),
        });
      } else if (result.error) {
        logButton('settings_anthropic_key_save_error', { error: result.error });
        setAnthropicStatusError(result.error);
      }
    } catch (err: any) {
      logButton('settings_anthropic_key_save_exception');
      setAnthropicStatusError(err?.message || String(err));
    }
  };

  const handleAnthropicClear = async () => {
    setAnthropicStatusMessage(null);
    setAnthropicStatusError(null);
    try {
      const result = await clearAnthropicKey();
      if (result.success) {
        setAnthropicStatusMessage(
          t('settings.byoAnthropic.keyCleared', 'Anthropic API key cleared.')
        );
        logButton('settings_anthropic_key_clear');
      } else if (result.error) {
        logButton('settings_anthropic_key_clear_error', {
          error: result.error,
        });
        setAnthropicStatusError(result.error);
      }
    } catch (err: any) {
      logButton('settings_anthropic_key_clear_exception');
      setAnthropicStatusError(err?.message || String(err));
    }
  };

  const handleAnthropicTest = async () => {
    setAnthropicStatusMessage(null);
    setAnthropicStatusError(null);
    try {
      const result = await validateAnthropicKey();
      logButton('settings_anthropic_key_test', { ok: result.ok });
      if (result.ok) {
        setAnthropicStatusMessage(
          t(
            'settings.byoAnthropic.keyValid',
            'Anthropic API key validated successfully.'
          )
        );
      } else {
        setAnthropicStatusError(
          result.error ||
            t(
              'settings.byoAnthropic.keyInvalid',
              'Anthropic API key validation failed.'
            )
        );
      }
    } catch (err: any) {
      logButton('settings_anthropic_key_test_exception');
      setAnthropicStatusError(err?.message || String(err));
    }
  };

  const handleToggleUseByoAnthropic = async (value: boolean) => {
    setAnthropicStatusMessage(null);
    setAnthropicStatusError(null);
    const result = await setUseByoAnthropic(value);
    if (!result.success) {
      setAnthropicStatusError(
        result.error ||
          t(
            'settings.byoAnthropic.toggleError',
            'Failed to update Anthropic preference.'
          )
      );
      return;
    }
    setAnthropicStatusMessage(
      value
        ? t(
            'settings.byoAnthropic.toggleOn',
            'Using your Anthropic key for Claude models.'
          )
        : t(
            'settings.byoAnthropic.toggleOff',
            'Using Stage5 credits for Claude models.'
          )
    );
  };

  // ElevenLabs handlers
  const handleElevenLabsSave = async () => {
    setElevenLabsStatusMessage(null);
    setElevenLabsStatusError(null);
    try {
      const result = await saveElevenLabsKey();
      if (result.success) {
        setElevenLabsStatusMessage(
          elevenLabsKeyValue.trim()
            ? t('settings.byoElevenLabs.keySaved', 'ElevenLabs API key saved.')
            : t(
                'settings.byoElevenLabs.keyCleared',
                'ElevenLabs API key cleared.'
              )
        );
        logButton('settings_elevenlabs_key_save', {
          hasKey: Boolean(elevenLabsKeyValue.trim()),
        });
      } else if (result.error) {
        logButton('settings_elevenlabs_key_save_error', {
          error: result.error,
        });
        setElevenLabsStatusError(result.error);
      }
    } catch (err: any) {
      logButton('settings_elevenlabs_key_save_exception');
      setElevenLabsStatusError(err?.message || String(err));
    }
  };

  const handleElevenLabsClear = async () => {
    setElevenLabsStatusMessage(null);
    setElevenLabsStatusError(null);
    try {
      const result = await clearElevenLabsKey();
      if (result.success) {
        setElevenLabsStatusMessage(
          t('settings.byoElevenLabs.keyCleared', 'ElevenLabs API key cleared.')
        );
        logButton('settings_elevenlabs_key_clear');
      } else if (result.error) {
        logButton('settings_elevenlabs_key_clear_error', {
          error: result.error,
        });
        setElevenLabsStatusError(result.error);
      }
    } catch (err: any) {
      logButton('settings_elevenlabs_key_clear_exception');
      setElevenLabsStatusError(err?.message || String(err));
    }
  };

  const handleElevenLabsTest = async () => {
    setElevenLabsStatusMessage(null);
    setElevenLabsStatusError(null);
    try {
      const result = await validateElevenLabsKey();
      logButton('settings_elevenlabs_key_test', { ok: result.ok });
      if (result.ok) {
        setElevenLabsStatusMessage(
          t(
            'settings.byoElevenLabs.keyValid',
            'ElevenLabs API key validated successfully.'
          )
        );
      } else {
        setElevenLabsStatusError(
          result.error ||
            t(
              'settings.byoElevenLabs.keyInvalid',
              'ElevenLabs API key validation failed.'
            )
        );
      }
    } catch (err: any) {
      logButton('settings_elevenlabs_key_test_exception');
      setElevenLabsStatusError(err?.message || String(err));
    }
  };

  const handleToggleUseByoElevenLabs = async (value: boolean) => {
    setElevenLabsStatusMessage(null);
    setElevenLabsStatusError(null);
    const result = await setUseByoElevenLabs(value);
    if (!result.success) {
      setElevenLabsStatusError(
        result.error ||
          t(
            'settings.byoElevenLabs.toggleError',
            'Failed to update ElevenLabs preference.'
          )
      );
      return;
    }
    setElevenLabsStatusMessage(
      value
        ? t(
            'settings.byoElevenLabs.toggleOn',
            'Using your ElevenLabs key for transcription & dubbing.'
          )
        : t(
            'settings.byoElevenLabs.toggleOff',
            'Using Stage5 credits for transcription & dubbing.'
          )
    );
  };

  const handleToggleUseByoMaster = async (value: boolean) => {
    setMasterStatusMessage(null);
    setMasterStatusError(null);
    const result = await setUseByoMaster(value);
    if (!result.success) {
      setMasterStatusError(
        result.error ||
          t('settings.byoMaster.toggleError', 'Failed to update preference.')
      );
      return;
    }
    setMasterStatusMessage(
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

  // Count how many keys are saved
  const savedKeysCount = [
    keyPresent,
    anthropicKeyPresent,
    elevenLabsKeyPresent,
  ].filter(Boolean).length;

  // Check if user has both OpenAI and Anthropic keys (to show Claude preference toggle)
  const hasBothTranslationKeys =
    keyPresent && useByo && anthropicKeyPresent && useByoAnthropic;

  const handleToggleClaudePreference = async (value: boolean) => {
    const result = await setPreferClaudeTranslation(value);
    if (!result.success) {
      console.error('Failed to update Claude preference:', result.error);
    }
  };

  const handleToggleClaudeReviewPreference = async (value: boolean) => {
    const result = await setPreferClaudeReview(value);
    if (!result.success) {
      console.error('Failed to update Claude review preference:', result.error);
    }
  };

  const handleTranscriptionProviderChange = async (
    provider: 'elevenlabs' | 'openai' | 'stage5'
  ) => {
    const result = await setPreferredTranscriptionProvider(provider);
    if (!result.success) {
      console.error('Failed to update transcription provider:', result.error);
    }
  };

  const handleDubbingProviderChange = async (
    provider: 'elevenlabs' | 'openai' | 'stage5'
  ) => {
    const result = await setPreferredDubbingProvider(provider);
    if (!result.success) {
      console.error('Failed to update dubbing provider:', result.error);
    }
  };

  const handleStage5TtsProviderChange = async (
    provider: 'openai' | 'elevenlabs'
  ) => {
    const result = await setStage5DubbingTtsProvider(provider);
    if (!result.success) {
      console.error('Failed to update Stage5 TTS provider:', result.error);
    }
  };

  // Check which transcription providers are available
  const hasElevenLabsForTranscription =
    elevenLabsKeyPresent && useByoElevenLabs;
  const hasOpenAiForTranscription = keyPresent && useByo;
  const hasAnyTranscriptionKey =
    hasElevenLabsForTranscription || hasOpenAiForTranscription;

  const renderLockedState = () => {
    const loading = entitlementsLoading && !byoUnlocked;

    return (
      <>
        <p
          style={{
            color: colors.textDim,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {t(
            'settings.byoOpenAi.description',
            'Unlock a one-time upgrade to use your own OpenAI API key. Once unlocked, any transcription, translation, dubbing, or summary runs directly on your account instead of consuming Stage5 credits.'
          )}
        </p>

        {entitlementsError && (
          <div
            style={{
              background: 'rgba(255,36,66,0.1)',
              border: `1px solid ${colors.danger}`,
              borderRadius: 6,
              padding: '12px 14px',
              color: colors.danger,
            }}
          >
            {entitlementsError}{' '}
            <button
              onClick={() => refreshEntitlements()}
              style={{
                color: colors.primary,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline',
                marginLeft: 6,
              }}
            >
              {t('common.retry', 'Retry')}
            </button>
          </div>
        )}

        <button
          onClick={handleUnlock}
          disabled={unlockPending || loading}
          style={{
            padding: '12px 16px',
            fontWeight: 600,
            background: colors.primary,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: unlockPending || loading ? 'wait' : 'pointer',
            opacity: unlockPending || loading ? 0.7 : 1,
          }}
        >
          {unlockPending
            ? t('settings.byoOpenAi.unlocking', 'Opening checkout…')
            : t('settings.byoOpenAi.unlockCta', 'Unlock for $10')}
        </button>

        {unlockError && (
          <p style={{ color: colors.danger, margin: 0 }}>{unlockError}</p>
        )}

        <p style={{ color: colors.textDim, fontSize: '.9rem', margin: 0 }}>
          {t(
            'settings.byoOpenAi.unlockHint',
            'Once unlocked, add your OpenAI key here at any time to toggle direct billing on your account.'
          )}
        </p>
      </>
    );
  };

  const renderUnlockedState = () => {
    return (
      <>
        {/* Master Toggle */}
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
                  · {savedKeysCount} {savedKeysCount === 1 ? 'key' : 'keys'}{' '}
                  saved
                </span>
              )}
            </span>
          </div>
          <Switch
            checked={useByoMaster}
            onChange={handleToggleUseByoMaster}
            aria-label={t(
              'settings.byoMaster.toggleAria',
              'Toggle using your API keys'
            )}
          />
        </div>

        {masterStatusMessage && (
          <p style={{ color: colors.primary, margin: 0 }}>
            {masterStatusMessage}
          </p>
        )}
        {masterStatusError && (
          <p style={{ color: colors.danger, margin: 0 }}>{masterStatusError}</p>
        )}

        {/* Status Summary when master is ON */}
        {useByoMaster &&
          (keyPresent || anthropicKeyPresent || elevenLabsKeyPresent) && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                padding: '10px 14px',
                background: 'rgba(40, 40, 40, 0.3)',
                borderRadius: 6,
                fontSize: '.85rem',
              }}
            >
              <span style={{ color: colors.textDim }}>
                {t('settings.byoMaster.activeLabel', 'Active:')}
              </span>
              {keyPresent && useByo && (
                <span style={{ color: colors.primary }}>OpenAI</span>
              )}
              {anthropicKeyPresent && useByoAnthropic && (
                <span style={{ color: colors.primary }}>Anthropic</span>
              )}
              {elevenLabsKeyPresent && useByoElevenLabs && (
                <span style={{ color: colors.primary }}>ElevenLabs</span>
              )}
              {!(
                (keyPresent && useByo) ||
                (anthropicKeyPresent && useByoAnthropic) ||
                (elevenLabsKeyPresent && useByoElevenLabs)
              ) && (
                <span style={{ color: colors.textDim, fontStyle: 'italic' }}>
                  {t('settings.byoMaster.noneActive', 'None enabled')}
                </span>
              )}
            </div>
          )}

        {/* Claude preference toggle - only show when user has both OpenAI and Anthropic keys */}
        {useByoMaster && hasBothTranslationKeys && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 14px',
              background: 'rgba(40, 40, 40, 0.2)',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span
                style={{
                  color: colors.dark,
                  fontWeight: 500,
                  fontSize: '.9rem',
                }}
              >
                {t(
                  'settings.claudePreference.label',
                  'Prefer Claude for translation'
                )}
              </span>
              <span style={{ color: colors.textDim, fontSize: '.8rem' }}>
                {preferClaudeTranslation
                  ? t(
                      'settings.claudePreference.onHint',
                      'Draft: Sonnet 4.5 → Review: Opus 4.5'
                    )
                  : t(
                      'settings.claudePreference.offHint',
                      'Draft: GPT-5.1 → Review: Opus 4.5'
                    )}
              </span>
            </div>
            <Switch
              checked={preferClaudeTranslation}
              onChange={handleToggleClaudePreference}
              aria-label={t(
                'settings.claudePreference.aria',
                'Toggle Claude preference for translation'
              )}
            />
          </div>
        )}

        {/* Claude review preference - show when user has both keys */}
        {useByoMaster && hasBothTranslationKeys && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              background: 'rgba(40, 40, 40, 0.2)',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span
                style={{
                  color: colors.dark,
                  fontWeight: 500,
                  fontSize: '.9rem',
                }}
              >
                {t(
                  'settings.claudeReviewPreference.label',
                  'Prefer Claude for review'
                )}
              </span>
              <span style={{ color: colors.textDim, fontSize: '.8rem' }}>
                {preferClaudeReview
                  ? t(
                      'settings.claudeReviewPreference.onHint',
                      'Review: Claude Opus 4.5'
                    )
                  : t(
                      'settings.claudeReviewPreference.offHint',
                      'Review: GPT-5.1 (high reasoning)'
                    )}
              </span>
            </div>
            <Switch
              checked={preferClaudeReview}
              onChange={handleToggleClaudeReviewPreference}
              aria-label={t(
                'settings.claudeReviewPreference.aria',
                'Toggle Claude preference for review'
              )}
            />
          </div>
        )}

        {/* Transcription provider selector - show when user has any audio keys */}
        {useByoMaster && hasAnyTranscriptionKey && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '12px 14px',
              background: 'rgba(40, 40, 40, 0.2)',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
            }}
          >
            <span
              style={{ color: colors.dark, fontWeight: 500, fontSize: '.9rem' }}
            >
              {t(
                'settings.transcriptionProvider.label',
                'Transcription provider'
              )}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {hasElevenLabsForTranscription && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    padding: '6px 8px',
                    borderRadius: 4,
                    background:
                      preferredTranscriptionProvider === 'elevenlabs'
                        ? 'rgba(67, 97, 238, 0.1)'
                        : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="transcriptionProvider"
                    checked={preferredTranscriptionProvider === 'elevenlabs'}
                    onChange={() =>
                      handleTranscriptionProviderChange('elevenlabs')
                    }
                    style={{ accentColor: colors.primary }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ color: colors.dark, fontSize: '.85rem' }}>
                      {t(
                        'settings.transcriptionProvider.elevenlabs',
                        'ElevenLabs Scribe'
                      )}
                    </span>
                    <span style={{ color: colors.textDim, fontSize: '.75rem' }}>
                      {t(
                        'settings.transcriptionProvider.elevenlabsHint',
                        'Highest quality, uses your ElevenLabs key'
                      )}
                    </span>
                  </div>
                </label>
              )}
              {hasOpenAiForTranscription && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    padding: '6px 8px',
                    borderRadius: 4,
                    background:
                      preferredTranscriptionProvider === 'openai'
                        ? 'rgba(67, 97, 238, 0.1)'
                        : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="transcriptionProvider"
                    checked={preferredTranscriptionProvider === 'openai'}
                    onChange={() => handleTranscriptionProviderChange('openai')}
                    style={{ accentColor: colors.primary }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ color: colors.dark, fontSize: '.85rem' }}>
                      {t(
                        'settings.transcriptionProvider.openai',
                        'OpenAI Whisper'
                      )}
                    </span>
                    <span style={{ color: colors.textDim, fontSize: '.75rem' }}>
                      {t(
                        'settings.transcriptionProvider.openaiHint',
                        'Fast and accurate, uses your OpenAI key'
                      )}
                    </span>
                  </div>
                </label>
              )}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '6px 8px',
                  borderRadius: 4,
                  background:
                    preferredTranscriptionProvider === 'stage5'
                      ? 'rgba(67, 97, 238, 0.1)'
                      : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="transcriptionProvider"
                  checked={preferredTranscriptionProvider === 'stage5'}
                  onChange={() => handleTranscriptionProviderChange('stage5')}
                  style={{ accentColor: colors.primary }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: colors.dark, fontSize: '.85rem' }}>
                    {t(
                      'settings.transcriptionProvider.stage5',
                      'Stage5 (Credits)'
                    )}
                  </span>
                  <span style={{ color: colors.textDim, fontSize: '.75rem' }}>
                    {t(
                      'settings.transcriptionProvider.stage5Hint',
                      'Uses your Stage5 AI credits'
                    )}
                  </span>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Dubbing provider selector - show when user has ElevenLabs or OpenAI */}
        {useByoMaster && hasAnyTranscriptionKey && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: 'rgba(67, 97, 238, 0.05)',
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
            }}
          >
            <div
              style={{ fontWeight: 600, marginBottom: 8, color: colors.dark }}
            >
              {t('settings.dubbingProvider.label', 'Dubbing Provider')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {hasElevenLabsForTranscription && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    cursor: 'pointer',
                    padding: '6px 8px',
                    borderRadius: 4,
                    background:
                      preferredDubbingProvider === 'elevenlabs'
                        ? 'rgba(67, 97, 238, 0.1)'
                        : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="dubbingProvider"
                    checked={preferredDubbingProvider === 'elevenlabs'}
                    onChange={() => handleDubbingProviderChange('elevenlabs')}
                    style={{ accentColor: colors.primary }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ color: colors.dark, fontSize: '.85rem' }}>
                      {t(
                        'settings.dubbingProvider.elevenlabs',
                        'ElevenLabs (Voice Cloning)'
                      )}
                    </span>
                    <span style={{ color: colors.textDim, fontSize: '.75rem' }}>
                      {t(
                        'settings.dubbingProvider.elevenlabsHint',
                        "Preserves original speaker's voice"
                      )}
                    </span>
                  </div>
                </label>
              )}
              {hasOpenAiForTranscription && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    cursor: 'pointer',
                    padding: '6px 8px',
                    borderRadius: 4,
                    background:
                      preferredDubbingProvider === 'openai'
                        ? 'rgba(67, 97, 238, 0.1)'
                        : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="dubbingProvider"
                    checked={preferredDubbingProvider === 'openai'}
                    onChange={() => handleDubbingProviderChange('openai')}
                    style={{ accentColor: colors.primary }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ color: colors.dark, fontSize: '.85rem' }}>
                      {t('settings.dubbingProvider.openai', 'OpenAI TTS')}
                    </span>
                    <span style={{ color: colors.textDim, fontSize: '.75rem' }}>
                      {t(
                        'settings.dubbingProvider.openaiHint',
                        'Uses synthetic voices (alloy, echo, etc.)'
                      )}
                    </span>
                  </div>
                </label>
              )}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '6px 8px',
                  borderRadius: 4,
                  background:
                    preferredDubbingProvider === 'stage5'
                      ? 'rgba(67, 97, 238, 0.1)'
                      : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="dubbingProvider"
                  checked={preferredDubbingProvider === 'stage5'}
                  onChange={() => handleDubbingProviderChange('stage5')}
                  style={{ accentColor: colors.primary }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: colors.dark, fontSize: '.85rem' }}>
                    {t('settings.dubbingProvider.stage5', 'Stage5 (Credits)')}
                  </span>
                  <span style={{ color: colors.textDim, fontSize: '.75rem' }}>
                    {t(
                      'settings.dubbingProvider.stage5Hint',
                      'Uses your Stage5 AI credits'
                    )}
                  </span>
                </div>
              </label>
            </div>

            {/* Stage5 TTS Provider sub-selector - show when Stage5 dubbing is selected */}
            {preferredDubbingProvider === 'stage5' && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  background: 'rgba(40, 40, 40, 0.3)',
                  borderRadius: 6,
                  border: `1px dashed ${colors.border}`,
                }}
              >
                <div
                  style={{
                    fontWeight: 500,
                    marginBottom: 8,
                    color: colors.dark,
                    fontSize: '.85rem',
                  }}
                >
                  {t(
                    'settings.stage5TtsProvider.label',
                    'TTS Quality (Stage5 Credits)'
                  )}
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      cursor: 'pointer',
                      padding: '6px 8px',
                      borderRadius: 4,
                      background:
                        stage5DubbingTtsProvider === 'openai'
                          ? 'rgba(67, 97, 238, 0.1)'
                          : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      name="stage5TtsProvider"
                      checked={stage5DubbingTtsProvider === 'openai'}
                      onChange={() => handleStage5TtsProviderChange('openai')}
                      style={{ accentColor: colors.primary }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ color: colors.dark, fontSize: '.85rem' }}>
                        {t(
                          'settings.stage5TtsProvider.openai',
                          'Standard (OpenAI TTS)'
                        )}
                      </span>
                      <span
                        style={{ color: colors.textDim, fontSize: '.75rem' }}
                      >
                        {credits != null && credits > 0
                          ? t(
                              'settings.stage5TtsProvider.openaiHintWithBalance',
                              'Good quality · Your balance: {{time}} of dubbing',
                              { time: formatDubbingTime(credits, 'openai') }
                            )
                          : t(
                              'settings.stage5TtsProvider.openaiHint',
                              'Good quality, lower cost'
                            )}
                      </span>
                    </div>
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      cursor: 'pointer',
                      padding: '6px 8px',
                      borderRadius: 4,
                      background:
                        stage5DubbingTtsProvider === 'elevenlabs'
                          ? 'rgba(67, 97, 238, 0.1)'
                          : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      name="stage5TtsProvider"
                      checked={stage5DubbingTtsProvider === 'elevenlabs'}
                      onChange={() =>
                        handleStage5TtsProviderChange('elevenlabs')
                      }
                      style={{ accentColor: colors.primary }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ color: colors.dark, fontSize: '.85rem' }}>
                        {t(
                          'settings.stage5TtsProvider.elevenlabs',
                          'Premium (ElevenLabs)'
                        )}
                      </span>
                      <span
                        style={{ color: colors.textDim, fontSize: '.75rem' }}
                      >
                        {credits != null && credits > 0
                          ? t(
                              'settings.stage5TtsProvider.elevenlabsHintWithBalance',
                              'Best quality · Your balance: {{time}} of dubbing',
                              { time: formatDubbingTime(credits, 'elevenlabs') }
                            )
                          : t(
                              'settings.stage5TtsProvider.elevenlabsHint',
                              'Best quality, higher cost (~13x)'
                            )}
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Only show key sections when master is ON */}
        {useByoMaster && (
          <>
            <p
              style={{
                color: colors.textDim,
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {t(
                'settings.byoOpenAi.unlockedDescription',
                'Enter your OpenAI API key below. All eligible AI requests will run directly against your OpenAI account when a key is present.'
              )}
            </p>

            <label
              style={{
                color: colors.dark,
                fontWeight: 600,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span>
                {t('settings.byoOpenAi.apiKeyLabel', 'OpenAI API Key')}
              </span>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyValue}
                  onChange={e => setKeyValue(e.target.value)}
                  placeholder="sk-..."
                  disabled={keyLoading || savingKey}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    background: colors.light,
                    color: colors.dark,
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  style={{
                    padding: '10px 12px',
                    background: colors.grayLight,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  {showKey
                    ? t('settings.byoOpenAi.hide', 'Hide')
                    : t('settings.byoOpenAi.show', 'Show')}
                </button>
              </div>
            </label>

            <div
              style={{
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={handleSave}
                disabled={savingKey || validatingKey}
                style={{
                  padding: '10px 16px',
                  background: colors.primary,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: savingKey || validatingKey ? 'wait' : 'pointer',
                  opacity: savingKey || validatingKey ? 0.7 : 1,
                }}
              >
                {savingKey
                  ? t('settings.byoOpenAi.saving', 'Saving…')
                  : t('common.save', 'Save')}
              </button>
              <button
                onClick={handleTest}
                disabled={validatingKey || !keyValue.trim()}
                style={{
                  padding: '10px 16px',
                  background: colors.grayLight,
                  color: colors.dark,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: validatingKey ? 'wait' : 'pointer',
                  opacity: validatingKey ? 0.7 : 1,
                }}
              >
                {validatingKey
                  ? t('settings.byoOpenAi.testing', 'Testing…')
                  : t('settings.byoOpenAi.test', 'Test Key')}
              </button>
              <button
                onClick={handleClear}
                disabled={
                  savingKey || validatingKey || (!keyPresent && !keyValue)
                }
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  color: colors.textDim,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: savingKey || validatingKey ? 'wait' : 'pointer',
                }}
              >
                {t('settings.byoOpenAi.clear', 'Clear Key')}
              </button>
            </div>

            {keyLoading && (
              <p style={{ color: colors.textDim, margin: 0 }}>
                {t('settings.byoOpenAi.loadingKey', 'Loading saved key…')}
              </p>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 14px',
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                background: colors.grayLight,
                marginTop: 4,
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
                <span style={{ fontWeight: 600 }}>
                  {t('settings.byoOpenAi.toggleLabel', 'Use my OpenAI key')}
                </span>
                <span style={{ color: colors.textDim, fontSize: '.85rem' }}>
                  {t(
                    'settings.byoOpenAi.toggleHelp',
                    'When off, AI Credits are used.'
                  )}
                </span>
              </div>
              <Switch
                checked={useByo}
                onChange={value => handleToggleUseByo(value)}
                disabled={!keyPresent && !keyValue.trim()}
                aria-label={t(
                  'settings.byoOpenAi.toggleAria',
                  'Toggle using your OpenAI key'
                )}
              />
            </div>

            {statusMessage && (
              <p style={{ color: colors.primary, margin: 0 }}>
                {statusMessage}
              </p>
            )}
            {statusError && (
              <p style={{ color: colors.danger, margin: 0 }}>{statusError}</p>
            )}

            {/* Anthropic API Key Section */}
            <div
              style={{
                borderTop: `1px solid ${colors.border}`,
                marginTop: 16,
                paddingTop: 20,
              }}
            >
              <h3
                style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  margin: '0 0 12px',
                  color: colors.dark,
                }}
              >
                {t(
                  'settings.byoAnthropic.title',
                  'Anthropic API Key (Optional)'
                )}
              </h3>
              <p
                style={{
                  color: colors.textDim,
                  lineHeight: 1.5,
                  margin: '0 0 14px',
                  fontSize: '.9rem',
                }}
              >
                {t(
                  'settings.byoAnthropic.description',
                  'Add your Anthropic API key to use Claude models directly. Without this key, translations will use GPT with enhanced reasoning for the review phase.'
                )}
              </p>

              <label
                style={{
                  color: colors.dark,
                  fontWeight: 600,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <span>
                  {t('settings.byoAnthropic.apiKeyLabel', 'Anthropic API Key')}
                </span>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <input
                    type={showAnthropicKey ? 'text' : 'password'}
                    value={anthropicKeyValue}
                    onChange={e => setAnthropicKeyValue(e.target.value)}
                    placeholder="sk-ant-..."
                    disabled={anthropicKeyLoading || savingAnthropicKey}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      borderRadius: 6,
                      border: `1px solid ${colors.border}`,
                      background: colors.light,
                      color: colors.dark,
                      fontFamily: 'monospace',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAnthropicKey(v => !v)}
                    style={{
                      padding: '10px 12px',
                      background: colors.grayLight,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    {showAnthropicKey
                      ? t('settings.byoAnthropic.hide', 'Hide')
                      : t('settings.byoAnthropic.show', 'Show')}
                  </button>
                </div>
              </label>

              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                  marginTop: 12,
                }}
              >
                <button
                  onClick={handleAnthropicSave}
                  disabled={savingAnthropicKey || validatingAnthropicKey}
                  style={{
                    padding: '10px 16px',
                    background: colors.primary,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor:
                      savingAnthropicKey || validatingAnthropicKey
                        ? 'wait'
                        : 'pointer',
                    opacity:
                      savingAnthropicKey || validatingAnthropicKey ? 0.7 : 1,
                  }}
                >
                  {savingAnthropicKey
                    ? t('settings.byoAnthropic.saving', 'Saving…')
                    : t('common.save', 'Save')}
                </button>
                <button
                  onClick={handleAnthropicTest}
                  disabled={validatingAnthropicKey || !anthropicKeyValue.trim()}
                  style={{
                    padding: '10px 16px',
                    background: colors.grayLight,
                    color: colors.dark,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    cursor: validatingAnthropicKey ? 'wait' : 'pointer',
                    opacity: validatingAnthropicKey ? 0.7 : 1,
                  }}
                >
                  {validatingAnthropicKey
                    ? t('settings.byoAnthropic.testing', 'Testing…')
                    : t('settings.byoAnthropic.test', 'Test Key')}
                </button>
                <button
                  onClick={handleAnthropicClear}
                  disabled={
                    savingAnthropicKey ||
                    validatingAnthropicKey ||
                    (!anthropicKeyPresent && !anthropicKeyValue)
                  }
                  style={{
                    padding: '10px 16px',
                    background: 'transparent',
                    color: colors.textDim,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    cursor:
                      savingAnthropicKey || validatingAnthropicKey
                        ? 'wait'
                        : 'pointer',
                  }}
                >
                  {t('settings.byoAnthropic.clear', 'Clear Key')}
                </button>
              </div>

              {anthropicKeyLoading && (
                <p style={{ color: colors.textDim, margin: '12px 0 0' }}>
                  {t(
                    'settings.byoAnthropic.loadingKey',
                    'Loading saved Anthropic key…'
                  )}
                </p>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  background: colors.grayLight,
                  marginTop: 16,
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
                  <span style={{ fontWeight: 600 }}>
                    {t(
                      'settings.byoAnthropic.toggleLabel',
                      'Use my Anthropic key'
                    )}
                  </span>
                  <span style={{ color: colors.textDim, fontSize: '.85rem' }}>
                    {t(
                      'settings.byoAnthropic.toggleHelp',
                      'When off, Claude requests use Stage5 credits.'
                    )}
                  </span>
                </div>
                <Switch
                  checked={useByoAnthropic}
                  onChange={value => handleToggleUseByoAnthropic(value)}
                  disabled={!anthropicKeyPresent && !anthropicKeyValue.trim()}
                  aria-label={t(
                    'settings.byoAnthropic.toggleAria',
                    'Toggle using your Anthropic key'
                  )}
                />
              </div>

              {anthropicStatusMessage && (
                <p style={{ color: colors.primary, margin: '12px 0 0' }}>
                  {anthropicStatusMessage}
                </p>
              )}
              {anthropicStatusError && (
                <p style={{ color: colors.danger, margin: '12px 0 0' }}>
                  {anthropicStatusError}
                </p>
              )}
            </div>

            {/* ElevenLabs API Key Section */}
            <div
              style={{
                borderTop: `1px solid ${colors.border}`,
                marginTop: 16,
                paddingTop: 20,
              }}
            >
              <h3
                style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  margin: '0 0 12px',
                  color: colors.dark,
                }}
              >
                {t(
                  'settings.byoElevenLabs.title',
                  'ElevenLabs API Key (Optional)'
                )}
              </h3>
              <p
                style={{
                  color: colors.textDim,
                  lineHeight: 1.5,
                  margin: '0 0 14px',
                  fontSize: '.9rem',
                }}
              >
                {t(
                  'settings.byoElevenLabs.description',
                  'Add your ElevenLabs API key for high-quality transcription (Scribe) and dubbing (TTS). Without this key, transcription and dubbing use OpenAI services.'
                )}
              </p>

              <label
                style={{
                  color: colors.dark,
                  fontWeight: 600,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <span>
                  {t(
                    'settings.byoElevenLabs.apiKeyLabel',
                    'ElevenLabs API Key'
                  )}
                </span>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <input
                    type={showElevenLabsKey ? 'text' : 'password'}
                    value={elevenLabsKeyValue}
                    onChange={e => setElevenLabsKeyValue(e.target.value)}
                    placeholder="sk_..."
                    disabled={elevenLabsKeyLoading || savingElevenLabsKey}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      borderRadius: 6,
                      border: `1px solid ${colors.border}`,
                      background: colors.light,
                      color: colors.dark,
                      fontFamily: 'monospace',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowElevenLabsKey(v => !v)}
                    style={{
                      padding: '10px 12px',
                      background: colors.grayLight,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    {showElevenLabsKey
                      ? t('settings.byoElevenLabs.hide', 'Hide')
                      : t('settings.byoElevenLabs.show', 'Show')}
                  </button>
                </div>
              </label>

              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                  marginTop: 12,
                }}
              >
                <button
                  onClick={handleElevenLabsSave}
                  disabled={savingElevenLabsKey || validatingElevenLabsKey}
                  style={{
                    padding: '10px 16px',
                    background: colors.primary,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor:
                      savingElevenLabsKey || validatingElevenLabsKey
                        ? 'wait'
                        : 'pointer',
                    opacity:
                      savingElevenLabsKey || validatingElevenLabsKey ? 0.7 : 1,
                  }}
                >
                  {savingElevenLabsKey
                    ? t('settings.byoElevenLabs.saving', 'Saving…')
                    : t('common.save', 'Save')}
                </button>
                <button
                  onClick={handleElevenLabsTest}
                  disabled={
                    validatingElevenLabsKey || !elevenLabsKeyValue.trim()
                  }
                  style={{
                    padding: '10px 16px',
                    background: colors.grayLight,
                    color: colors.dark,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    cursor: validatingElevenLabsKey ? 'wait' : 'pointer',
                    opacity: validatingElevenLabsKey ? 0.7 : 1,
                  }}
                >
                  {validatingElevenLabsKey
                    ? t('settings.byoElevenLabs.testing', 'Testing…')
                    : t('settings.byoElevenLabs.test', 'Test Key')}
                </button>
                <button
                  onClick={handleElevenLabsClear}
                  disabled={
                    savingElevenLabsKey ||
                    validatingElevenLabsKey ||
                    (!elevenLabsKeyPresent && !elevenLabsKeyValue)
                  }
                  style={{
                    padding: '10px 16px',
                    background: 'transparent',
                    color: colors.textDim,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    cursor:
                      savingElevenLabsKey || validatingElevenLabsKey
                        ? 'wait'
                        : 'pointer',
                  }}
                >
                  {t('settings.byoElevenLabs.clear', 'Clear Key')}
                </button>
              </div>

              {elevenLabsKeyLoading && (
                <p style={{ color: colors.textDim, margin: '12px 0 0' }}>
                  {t(
                    'settings.byoElevenLabs.loadingKey',
                    'Loading saved ElevenLabs key…'
                  )}
                </p>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  background: colors.grayLight,
                  marginTop: 16,
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
                  <span style={{ fontWeight: 600 }}>
                    {t(
                      'settings.byoElevenLabs.toggleLabel',
                      'Use my ElevenLabs key'
                    )}
                  </span>
                  <span style={{ color: colors.textDim, fontSize: '.85rem' }}>
                    {t(
                      'settings.byoElevenLabs.toggleHelp',
                      'When off, transcription & dubbing use Stage5 credits.'
                    )}
                  </span>
                </div>
                <Switch
                  checked={useByoElevenLabs}
                  onChange={value => handleToggleUseByoElevenLabs(value)}
                  disabled={!elevenLabsKeyPresent && !elevenLabsKeyValue.trim()}
                  aria-label={t(
                    'settings.byoElevenLabs.toggleAria',
                    'Toggle using your ElevenLabs key'
                  )}
                />
              </div>

              {elevenLabsStatusMessage && (
                <p style={{ color: colors.primary, margin: '12px 0 0' }}>
                  {elevenLabsStatusMessage}
                </p>
              )}
              {elevenLabsStatusError && (
                <p style={{ color: colors.danger, margin: '12px 0 0' }}>
                  {elevenLabsStatusError}
                </p>
              )}
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <section className={byoCardStyles}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
        {t('settings.byoOpenAi.title', 'Bring Your Own API Keys')}
      </h2>

      {lastFetched && (
        <span style={{ color: colors.textDim, fontSize: '.8rem' }}>
          {t('settings.byoOpenAi.lastSynced', 'Last synced')}: {lastFetched}
        </span>
      )}

      {byoUnlocked ? renderUnlockedState() : renderLockedState()}
    </section>
  );
}

function DubbingMixSlider() {
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
          color: ${colors.dark};
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

function DubbingVoiceSelector() {
  const { t } = useTranslation();
  const { dubVoice, setDubVoice } = useUIStore();
  const useByoMaster = useAiStore(state => state.useByoMaster);
  const useByoElevenLabs = useAiStore(state => state.useByoElevenLabs);
  const elevenLabsKeyPresent = useAiStore(state => state.elevenLabsKeyPresent);
  const byoElevenLabsUnlocked = useAiStore(
    state => state.byoElevenLabsUnlocked
  );
  const preferredDubbingProvider = useAiStore(
    state => state.preferredDubbingProvider
  );
  const [isPreviewing, setIsPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const previewTokenRef = useRef(0);

  // ElevenLabs voices (primary)
  const elevenLabsVoices = [
    { value: 'rachel', fallback: 'Rachel' },
    { value: 'adam', fallback: 'Adam' },
    { value: 'josh', fallback: 'Josh' },
    { value: 'sarah', fallback: 'Sarah' },
    { value: 'charlie', fallback: 'Charlie' },
    { value: 'emily', fallback: 'Emily' },
    { value: 'matilda', fallback: 'Matilda' },
    { value: 'brian', fallback: 'Brian' },
  ] as const;

  // OpenAI voices (kept for reference, ElevenLabs is now the only provider)
  const _openAiVoices = [
    { value: 'alloy', fallback: 'Alloy' },
    { value: 'echo', fallback: 'Echo' },
    { value: 'fable', fallback: 'Fable' },
    { value: 'onyx', fallback: 'Onyx' },
    { value: 'nova', fallback: 'Nova' },
    { value: 'shimmer', fallback: 'Shimmer' },
  ] as const;

  const options = elevenLabsVoices.map(opt => ({
    value: opt.value,
    label: t(`settings.dubbing.voiceOptions.${opt.value}`, opt.fallback),
  }));

  useEffect(() => {
    return () => {
      try {
        audioRef.current?.pause();
      } catch {
        // Do nothing
      }
      audioRef.current = null;
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, []);

  const handleVoiceChange = async (value: string) => {
    setDubVoice(value);
    const token = ++previewTokenRef.current;
    setIsPreviewing(true);
    try {
      const result = await SubtitlesIPC.previewDubVoice({ voice: value });
      if (previewTokenRef.current !== token) return;
      if (result?.success && result.audioBase64) {
        try {
          audioRef.current?.pause();
        } catch {
          // Do nothing
        }
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
        const format = result.format ?? 'mp3';
        const binary = atob(result.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes.buffer], { type: `audio/${format}` });
        const objectUrl = URL.createObjectURL(blob);
        audioUrlRef.current = objectUrl;
        const audio = new Audio(objectUrl);
        audioRef.current = audio;
        audio.play().catch(err => {
          console.warn('[SettingsPage] Voice preview playback failed:', err);
        });
      } else if (result?.error) {
        console.warn('[SettingsPage] Voice preview error:', result.error);
      }
    } catch (err) {
      if (previewTokenRef.current === token) {
        console.warn('[SettingsPage] Voice preview failed:', err);
      }
    } finally {
      if (previewTokenRef.current === token) {
        setIsPreviewing(false);
      }
    }
  };

  const selectClass = css`
    width: 100%;
    max-width: none;
    text-align: left;
  `;

  // When ElevenLabs voice cloning is fully enabled, show message instead of voice selector
  // All conditions must be true: master on, toggle on, key present, entitlement unlocked, and provider is elevenlabs
  const voiceCloningActive =
    useByoMaster &&
    useByoElevenLabs &&
    elevenLabsKeyPresent &&
    byoElevenLabsUnlocked &&
    preferredDubbingProvider === 'elevenlabs';

  if (voiceCloningActive) {
    return (
      <div
        className={css`
          display: flex;
          flex-direction: column;
          gap: 8px;
        `}
      >
        <div
          className={css`
            font-weight: 600;
            color: ${colors.dark};
          `}
        >
          {t('settings.dubbing.voiceLabel', 'Dubbed Voice')}
        </div>
        <div
          className={css`
            padding: 12px;
            background: ${colors.lightGray};
            border-radius: 8px;
            color: ${colors.dark};
            font-size: 0.9rem;
          `}
        >
          {t(
            'settings.dubbing.voiceCloningEnabled',
            "Voice cloning is enabled with ElevenLabs. The original speaker's voice will be preserved in the dubbed audio."
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: 8px;
      `}
    >
      <div
        className={css`
          font-weight: 600;
          color: ${colors.dark};
        `}
      >
        {t('settings.dubbing.voiceLabel', 'Dubbed Voice')}
      </div>
      <select
        className={`${selectStyles} ${selectClass}`}
        value={dubVoice}
        onChange={e => handleVoiceChange(e.target.value)}
        disabled={isPreviewing}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div
        className={css`
          color: ${colors.gray};
          font-size: 0.85rem;
        `}
      >
        {t(
          'settings.dubbing.voiceHelp',
          'Choose the default voice for generated dubs.'
        )}
      </div>
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
    summaryEffortLevel,
    setSummaryEffortLevel,
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
          'On: includes review phase (~5× more credits/time). Off: skip review.'
        )
      )}
      {row(
        t(
          'settings.performanceQuality.qualitySummary.label',
          'Quality Summary'
        ),
        summaryEffortLevel === 'high',
        v => setSummaryEffortLevel(v ? 'high' : 'standard'),
        t(
          'settings.performanceQuality.qualitySummary.help',
          'On: deep analysis with Claude Opus. Off: fast analysis with GPT-5.1.'
        )
      )}
    </div>
  );
}
