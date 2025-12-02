import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';
import { useCreditStore } from '../../state/credit-store';
import { useAiStore } from '../../state';
import { useUIStore } from '../../state/ui-store';
import Switch from '../../components/Switch';
import { logButton } from '../../utils/logger';
import { byoCardStyles } from './styles';
import { formatDubbingTime } from './utils';

export default function ByoOpenAiSection() {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const credits = useCreditStore(state => state.credits);
  const { qualityTranscription, setQualityTranscription } = useUIStore();
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

  const initialized = useAiStore(state => state.initialized);
  const initialize = useAiStore(state => state.initialize);
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const useByoMaster = useAiStore(state => state.useByoMaster);
  const lastFetched = useAiStore(state => state.lastFetched);

  // Effective BYO unlocked state (respects admin preview mode)
  const effectiveByoUnlocked = byoUnlocked && !adminByoPreviewMode;

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
  const validateKey = useAiStore(state => state.validateKey);
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

  // Claude preferences
  const preferClaudeTranslation = useAiStore(
    state => state.preferClaudeTranslation
  );
  const setPreferClaudeTranslation = useAiStore(
    state => state.setPreferClaudeTranslation
  );
  const preferClaudeReview = useAiStore(state => state.preferClaudeReview);
  const setPreferClaudeReview = useAiStore(
    state => state.setPreferClaudeReview
  );

  // Provider preferences
  const preferredTranscriptionProvider = useAiStore(
    state => state.preferredTranscriptionProvider
  );
  const setPreferredTranscriptionProvider = useAiStore(
    state => state.setPreferredTranscriptionProvider
  );
  const preferredDubbingProvider = useAiStore(
    state => state.preferredDubbingProvider
  );
  const setPreferredDubbingProvider = useAiStore(
    state => state.setPreferredDubbingProvider
  );
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

  // Don't render if not unlocked (or in admin preview mode) or master toggle is off
  if (!effectiveByoUnlocked || !useByoMaster) {
    return null;
  }

  // OpenAI handlers
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

  // Preference handlers
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

  // Computed values
  const hasBothTranslationKeys =
    keyPresent && useByo && anthropicKeyPresent && useByoAnthropic;
  const hasElevenLabsForTranscription =
    elevenLabsKeyPresent && useByoElevenLabs;
  const hasOpenAiForTranscription = keyPresent && useByo;
  const hasAnyTranscriptionKey =
    hasElevenLabsForTranscription || hasOpenAiForTranscription;

  // Show quality transcription toggle only when OpenAI Whisper is the selected provider
  const showQualityTranscriptionToggle =
    hasOpenAiForTranscription && preferredTranscriptionProvider === 'openai';

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

      {/* Active keys summary */}
      {(keyPresent || anthropicKeyPresent || elevenLabsKeyPresent) && (
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

      {/* Claude preference toggles */}
      {hasBothTranslationKeys && (
        <>
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
        </>
      )}

      {/* Transcription provider selector */}
      {hasAnyTranscriptionKey && (
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

          {/* Quality Transcription toggle - only for OpenAI Whisper */}
          {showQualityTranscriptionToggle && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                background: 'rgba(40, 40, 40, 0.3)',
                borderRadius: 6,
                border: `1px dashed ${colors.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  style={{
                    color: colors.dark,
                    fontWeight: 500,
                    fontSize: '.85rem',
                  }}
                >
                  {t(
                    'settings.performanceQuality.qualityTranscription.label',
                    'Quality Transcription'
                  )}
                </span>
                <span style={{ color: colors.textDim, fontSize: '.75rem' }}>
                  {qualityTranscription
                    ? t(
                        'settings.performanceQuality.qualityTranscription.onHint',
                        'Sequential mode with prior-line context'
                      )
                    : t(
                        'settings.performanceQuality.qualityTranscription.offHint',
                        'Faster batched mode (5 chunks in parallel)'
                      )}
                </span>
              </div>
              <Switch
                checked={qualityTranscription}
                onChange={setQualityTranscription}
                aria-label={t(
                  'settings.performanceQuality.qualityTranscription.label',
                  'Quality Transcription'
                )}
              />
            </div>
          )}
        </div>
      )}

      {/* Dubbing provider selector */}
      {hasAnyTranscriptionKey && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: 'rgba(67, 97, 238, 0.05)',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8, color: colors.dark }}>
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

          {/* Stage5 TTS Provider sub-selector */}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                    <span style={{ color: colors.textDim, fontSize: '.75rem' }}>
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
                    onChange={() => handleStage5TtsProviderChange('elevenlabs')}
                    style={{ accentColor: colors.primary }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ color: colors.dark, fontSize: '.85rem' }}>
                      {t(
                        'settings.stage5TtsProvider.elevenlabs',
                        'Premium (ElevenLabs)'
                      )}
                    </span>
                    <span style={{ color: colors.textDim, fontSize: '.75rem' }}>
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

      {/* OpenAI API Key Section */}
      <p style={{ color: colors.textDim, lineHeight: 1.5, margin: 0 }}>
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
        <span>{t('settings.byoOpenAi.apiKeyLabel', 'OpenAI API Key')}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
          disabled={savingKey || validatingKey || (!keyPresent && !keyValue)}
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
          onChange={handleToggleUseByo}
          disabled={!keyPresent && !keyValue.trim()}
          aria-label={t(
            'settings.byoOpenAi.toggleAria',
            'Toggle using your OpenAI key'
          )}
        />
      </div>

      {statusMessage && (
        <p style={{ color: colors.primary, margin: 0 }}>{statusMessage}</p>
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
          {t('settings.byoAnthropic.title', 'Anthropic API Key (Optional)')}
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}
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
              opacity: savingAnthropicKey || validatingAnthropicKey ? 0.7 : 1,
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
              {t('settings.byoAnthropic.toggleLabel', 'Use my Anthropic key')}
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
            onChange={handleToggleUseByoAnthropic}
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
          {t('settings.byoElevenLabs.title', 'ElevenLabs API Key (Optional)')}
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
            {t('settings.byoElevenLabs.apiKeyLabel', 'ElevenLabs API Key')}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}
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
              opacity: savingElevenLabsKey || validatingElevenLabsKey ? 0.7 : 1,
            }}
          >
            {savingElevenLabsKey
              ? t('settings.byoElevenLabs.saving', 'Saving…')
              : t('common.save', 'Save')}
          </button>
          <button
            onClick={handleElevenLabsTest}
            disabled={validatingElevenLabsKey || !elevenLabsKeyValue.trim()}
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
              {t('settings.byoElevenLabs.toggleLabel', 'Use my ElevenLabs key')}
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
            onChange={handleToggleUseByoElevenLabs}
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
    </section>
  );
}
