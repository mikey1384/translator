import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import CreditCard from '../components/CreditCard';
import { colors, selectStyles } from '../styles';
import { useCreditStore } from '../state/credit-store';
import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../state/ui-store';
import Switch from '../components/Switch';
import * as SubtitlesIPC from '../ipc/subtitles';
import { useAiStore } from '../state';
import { logButton } from '../utils/logger';

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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [anthropicStatusMessage, setAnthropicStatusMessage] = useState<
    string | null
  >(null);
  const [anthropicStatusError, setAnthropicStatusError] = useState<
    string | null
  >(null);

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
            : t('settings.byoAnthropic.keyCleared', 'Anthropic API key cleared.')
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
          <span>{t('settings.byoOpenAi.apiKeyLabel', 'OpenAI API Key')}</span>
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
            onChange={value => handleToggleUseByo(value)}
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
  const [isPreviewing, setIsPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const previewTokenRef = useRef(0);

  const voiceOptions = [
    { value: 'alloy', fallback: 'Alloy' },
    { value: 'echo', fallback: 'Echo' },
    { value: 'fable', fallback: 'Fable' },
    { value: 'onyx', fallback: 'Onyx' },
    { value: 'nova', fallback: 'Nova' },
    { value: 'shimmer', fallback: 'Shimmer' },
  ] as const;

  const options = voiceOptions.map(opt => ({
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
    </div>
  );
}
