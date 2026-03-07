import { useState, useRef, useEffect, useCallback } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import { breakpoints, colors, gradients, shadows } from '../styles';
import {
  borderRadius,
  fontSize,
  fontWeight,
  lineHeight,
  spacing,
  transitions,
} from './design-system/tokens.js';

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
  onHelpClick?: () => void;
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

const rootStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  min-width: 0;
`;

const compactRootStyles = css`
  gap: ${spacing.sm};
`;

const labelStyles = css`
  color: ${colors.text};
  font-weight: ${fontWeight.semibold};
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
  min-width: 0;
`;

const labelTextRowStyles = css`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;

const helpButtonStyles = css`
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: none;
  color: ${colors.primary};
  cursor: pointer;
  flex: 0 0 auto;

  &:hover {
    color: ${colors.primaryLight};
  }
`;

const inputRowStyles = css`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  min-width: 0;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    flex-wrap: wrap;
  }
`;

const inputStyles = css`
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  padding: 0.72rem 0.9rem;
  min-height: 42px;
  border-radius: ${borderRadius.lg};
  border: 1px solid ${colors.border};
  background: ${gradients.surfaceRaised};
  color: ${colors.text};
  box-shadow: ${shadows.sm};
  font-family: monospace;
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.normal};
  transition:
    border-color ${transitions.fast},
    box-shadow ${transitions.fast},
    background-color ${transitions.fast};

  &:focus {
    outline: none;
    border-color: ${colors.primaryLight};
    box-shadow:
      ${shadows.sm},
      0 0 0 3px rgba(125, 167, 255, 0.16);
  }

  &::placeholder {
    color: ${colors.gray};
  }
`;

const roomyInputStyles = css`
  min-height: 44px;
  font-size: ${fontSize.md};
`;

const actionRowStyles = css`
  display: flex;
  gap: ${spacing.sm};
  flex-wrap: wrap;
`;

const statusMessageStyles = css`
  margin: 0;
  color: ${colors.primaryLight};
  font-size: ${fontSize.sm};
`;

const statusErrorStyles = css`
  margin: 0;
  color: ${colors.danger};
  font-size: ${fontSize.sm};
`;

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
  onHelpClick,
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
    <div className={`${rootStyles} ${compact ? compactRootStyles : ''}`}>
      <label className={labelStyles}>
        <span className={labelTextRowStyles}>
          {labels[provider]}
          {onHelpClick && (
            <button
              type="button"
              onClick={e => {
                e.preventDefault();
                onHelpClick();
              }}
              title={t('settings.apiKey.howToGet', 'How to get this key')}
              className={helpButtonStyles}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </button>
          )}
        </span>
        <div className={inputRowStyles}>
          <input
            type={showKey ? 'text' : 'password'}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholders[provider]}
            disabled={loading || saving}
            className={`${inputStyles} ${compact ? '' : roomyInputStyles}`}
          />
          <Button
            type="button"
            onClick={() => setShowKey(v => !v)}
            variant="secondary"
            size={compact ? 'sm' : 'md'}
            disabled={loading || saving}
          >
            {showKey ? t('common.hide', 'Hide') : t('common.show', 'Show')}
          </Button>
        </div>
      </label>

      <div className={actionRowStyles}>
        <Button
          onClick={handleSave}
          disabled={saving || validating || cooldownActive || !value.trim()}
          variant="primary"
          size={compact ? 'sm' : 'md'}
        >
          {saving || validating
            ? t('common.validating', 'Validating…')
            : cooldownActive
              ? t('common.wait', 'Wait…')
              : t('common.save', 'Save')}
        </Button>
        <Button
          onClick={handleClear}
          disabled={saving || validating || (!keyPresent && !value)}
          variant="secondary"
          size={compact ? 'sm' : 'md'}
        >
          {t('common.clear', 'Clear')}
        </Button>
      </div>

      {statusMessage && (
        <p className={statusMessageStyles}>{statusMessage}</p>
      )}
      {statusError && (
        <p className={statusErrorStyles}>{statusError}</p>
      )}
    </div>
  );
}
