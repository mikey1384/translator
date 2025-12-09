import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { colors } from '../styles';

// Cooldown between validation attempts (milliseconds)
const VALIDATION_COOLDOWN_MS = 2000;

interface ApiKeyInputProps {
  provider: 'openai' | 'anthropic' | 'elevenlabs';
  value: string;
  onChange: (value: string) => void;
  onSave: () => Promise<{ success: boolean; error?: string }>;
  onValidate: () => Promise<{ ok: boolean; error?: string }>;
  onClear: () => Promise<{ success: boolean; error?: string }>;
  keyPresent: boolean;
  loading?: boolean;
  saving?: boolean;
  validating?: boolean;
  compact?: boolean;
}

const placeholders: Record<string, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  elevenlabs: 'sk_...',
};

const labels: Record<string, string> = {
  openai: 'OpenAI API Key',
  anthropic: 'Anthropic API Key',
  elevenlabs: 'ElevenLabs API Key',
};

export default function ApiKeyInput({
  provider,
  value,
  onChange,
  onSave,
  onValidate,
  onClear,
  keyPresent,
  loading = false,
  saving = false,
  validating = false,
  compact = false,
}: ApiKeyInputProps) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [cooldownActive, setCooldownActive] = useState(false);
  const lastValidationRef = useRef<number>(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear cooldown timer on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);

  const startCooldown = useCallback(() => {
    setCooldownActive(true);
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
    }
    cooldownTimerRef.current = setTimeout(() => {
      setCooldownActive(false);
    }, VALIDATION_COOLDOWN_MS);
  }, []);

  const handleSave = async () => {
    // Cooldown: prevent rapid validation attempts
    const now = Date.now();
    if (now - lastValidationRef.current < VALIDATION_COOLDOWN_MS) {
      return;
    }
    lastValidationRef.current = now;
    startCooldown();

    setStatusMessage(null);
    setStatusError(null);

    // Validate first
    const validation = await onValidate();
    if (!validation.ok) {
      setStatusError(
        validation.error ||
          t('settings.apiKey.invalid', 'API key validation failed.')
      );
      return;
    }

    // Only save if validation passed
    const result = await onSave();
    if (result.success) {
      setStatusMessage(t('settings.apiKey.saved', 'API key saved.'));
    } else if (result.error) {
      setStatusError(result.error);
    }
  };

  const handleClear = async () => {
    setStatusMessage(null);
    setStatusError(null);
    const result = await onClear();
    if (result.success) {
      setStatusMessage(t('settings.apiKey.cleared', 'API key cleared.'));
    } else if (result.error) {
      setStatusError(result.error);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 8 : 12,
      }}
    >
      <label
        style={{
          color: colors.text,
          fontWeight: 600,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span>{labels[provider]}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholders[provider]}
            disabled={loading || saving}
            style={{
              flex: 1,
              padding: compact ? '8px 10px' : '10px 12px',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.text,
              fontFamily: 'monospace',
              fontSize: compact ? '.85rem' : '1rem',
            }}
          />
          <button
            type="button"
            onClick={() => setShowKey(v => !v)}
            style={{
              padding: compact ? '8px 10px' : '10px 12px',
              background: colors.grayLight,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: compact ? '.85rem' : '1rem',
            }}
          >
            {showKey ? t('common.hide', 'Hide') : t('common.show', 'Show')}
          </button>
        </div>
      </label>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          disabled={saving || validating || cooldownActive || !value.trim()}
          style={{
            padding: compact ? '8px 12px' : '10px 16px',
            background: colors.primary,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: saving || validating || cooldownActive ? 'wait' : 'pointer',
            opacity:
              saving || validating || cooldownActive || !value.trim() ? 0.7 : 1,
            fontSize: compact ? '.85rem' : '1rem',
          }}
        >
          {saving || validating
            ? t('common.validating', 'Validating…')
            : cooldownActive
              ? t('common.wait', 'Wait…')
              : t('common.save', 'Save')}
        </button>
        <button
          onClick={handleClear}
          disabled={saving || validating || (!keyPresent && !value)}
          style={{
            padding: compact ? '8px 12px' : '10px 16px',
            background: 'transparent',
            color: colors.textDim,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            cursor: saving || validating ? 'wait' : 'pointer',
            fontSize: compact ? '.85rem' : '1rem',
          }}
        >
          {t('common.clear', 'Clear')}
        </button>
      </div>

      {statusMessage && (
        <p
          style={{
            color: colors.primary,
            margin: 0,
            fontSize: compact ? '.85rem' : '1rem',
          }}
        >
          {statusMessage}
        </p>
      )}
      {statusError && (
        <p
          style={{
            color: colors.danger,
            margin: 0,
            fontSize: compact ? '.85rem' : '1rem',
          }}
        >
          {statusError}
        </p>
      )}
    </div>
  );
}
