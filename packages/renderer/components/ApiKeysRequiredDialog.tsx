import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/css';
import { useAiStore } from '../state';
import { colors } from '../styles';
import ApiKeyInput from './ApiKeyInput';
import {
  ApiKeyOptionBox,
  OrDivider,
  ApiKeyInputWrapper,
} from './ApiKeyOptionBox';
import Button from './Button';
import ApiKeyGuideModal from '../containers/SettingsPage/ApiKeyGuideModal';

interface Props {
  open: boolean;
  onClose: () => void;
}

const overlayStyles = css`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
`;

const contentStyles = css`
  background: ${colors.surface};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  width: min(600px, 90vw);
  max-height: 85vh;
  overflow-y: auto;
  padding: 20px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.25);
`;

export default function ApiKeysRequiredDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [showGuide, setShowGuide] = useState(false);
  const [guideProvider, setGuideProvider] = useState<
    'openai' | 'anthropic' | 'elevenlabs' | undefined
  >();

  const openGuide = (provider?: 'openai' | 'anthropic' | 'elevenlabs') => {
    setGuideProvider(provider);
    setShowGuide(true);
  };

  // OpenAI state
  const keyValue = useAiStore(s => s.keyValue);
  const keyPresent = useAiStore(s => s.keyPresent);
  const setKeyValue = useAiStore(s => s.setKeyValue);
  const saveKey = useAiStore(s => s.saveKey);
  const validateKey = useAiStore(s => s.validateKey);
  const clearKey = useAiStore(s => s.clearKey);
  const savingKey = useAiStore(s => s.savingKey);
  const validatingKey = useAiStore(s => s.validatingKey);

  // Anthropic state
  const anthropicKeyValue = useAiStore(s => s.anthropicKeyValue);
  const anthropicKeyPresent = useAiStore(s => s.anthropicKeyPresent);
  const setAnthropicKeyValue = useAiStore(s => s.setAnthropicKeyValue);
  const saveAnthropicKey = useAiStore(s => s.saveAnthropicKey);
  const validateAnthropicKey = useAiStore(s => s.validateAnthropicKey);
  const clearAnthropicKey = useAiStore(s => s.clearAnthropicKey);
  const savingAnthropicKey = useAiStore(s => s.savingAnthropicKey);
  const validatingAnthropicKey = useAiStore(s => s.validatingAnthropicKey);

  // ElevenLabs state
  const elevenLabsKeyValue = useAiStore(s => s.elevenLabsKeyValue);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);
  const setElevenLabsKeyValue = useAiStore(s => s.setElevenLabsKeyValue);
  const saveElevenLabsKey = useAiStore(s => s.saveElevenLabsKey);
  const validateElevenLabsKey = useAiStore(s => s.validateElevenLabsKey);
  const clearElevenLabsKey = useAiStore(s => s.clearElevenLabsKey);
  const savingElevenLabsKey = useAiStore(s => s.savingElevenLabsKey);
  const validatingElevenLabsKey = useAiStore(s => s.validatingElevenLabsKey);

  // Check if conditions are now met
  const hasOpenAi = keyPresent;
  const hasAnthropicAndElevenLabs = anthropicKeyPresent && elevenLabsKeyPresent;
  const conditionsMet = hasOpenAi || hasAnthropicAndElevenLabs;

  // Auto-close and enable when conditions are met
  const handleDone = async () => {
    if (conditionsMet) {
      // Enable the master toggle
      const setUseByoMaster = useAiStore.getState().setUseByoMaster;
      await setUseByoMaster(true);
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className={overlayStyles}
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-keys-required-title"
      onClick={onClose}
    >
      <div className={contentStyles} onClick={e => e.stopPropagation()}>
        <h3
          id="api-keys-required-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}
        >
          {t('dialogs.apiKeysRequired.title', 'API Keys Required')}
        </h3>

        <p
          style={{ color: colors.textDim, margin: '0 0 16px', lineHeight: 1.5 }}
        >
          {t(
            'dialogs.apiKeysRequired.message',
            'To use your own API keys, you need either an OpenAI key OR both Anthropic and ElevenLabs keys.'
          )}{' '}
          <button
            onClick={() => openGuide()}
            style={{
              background: 'none',
              border: 'none',
              color: colors.primary,
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: 0,
              font: 'inherit',
            }}
          >
            {t('dialogs.apiKeysRequired.howToGet', 'How to get API keys')}
          </button>
        </p>

        {/* Option 1: OpenAI */}
        <ApiKeyOptionBox
          optionNumber={1}
          title={t('dialogs.apiKeysRequired.option1', 'Option 1: OpenAI')}
          satisfied={hasOpenAi}
        >
          <ApiKeyInput
            provider="openai"
            value={keyValue}
            onChange={setKeyValue}
            onSave={saveKey}
            onValidate={validateKey}
            onClear={clearKey}
            keyPresent={keyPresent}
            saving={savingKey}
            validating={validatingKey}
            compact
            onHelpClick={() => openGuide('openai')}
          />
        </ApiKeyOptionBox>

        <OrDivider />

        {/* Option 2: Anthropic + ElevenLabs */}
        <ApiKeyOptionBox
          optionNumber={2}
          title={t(
            'dialogs.apiKeysRequired.option2',
            'Option 2: Anthropic + ElevenLabs'
          )}
          satisfied={hasAnthropicAndElevenLabs}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ApiKeyInputWrapper satisfied={anthropicKeyPresent}>
              <ApiKeyInput
                provider="anthropic"
                value={anthropicKeyValue}
                onChange={setAnthropicKeyValue}
                onSave={saveAnthropicKey}
                onValidate={validateAnthropicKey}
                onClear={clearAnthropicKey}
                keyPresent={anthropicKeyPresent}
                saving={savingAnthropicKey}
                validating={validatingAnthropicKey}
                compact
                onHelpClick={() => openGuide('anthropic')}
              />
            </ApiKeyInputWrapper>

            <ApiKeyInputWrapper satisfied={elevenLabsKeyPresent}>
              <ApiKeyInput
                provider="elevenlabs"
                value={elevenLabsKeyValue}
                onChange={setElevenLabsKeyValue}
                onSave={saveElevenLabsKey}
                onValidate={validateElevenLabsKey}
                onClear={clearElevenLabsKey}
                keyPresent={elevenLabsKeyPresent}
                saving={savingElevenLabsKey}
                validating={validatingElevenLabsKey}
                compact
                onHelpClick={() => openGuide('elevenlabs')}
              />
            </ApiKeyInputWrapper>
          </div>
        </ApiKeyOptionBox>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 20,
          }}
        >
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleDone}
            disabled={!conditionsMet}
          >
            {conditionsMet
              ? t('dialogs.apiKeysRequired.enable', 'Enable API Keys')
              : t('dialogs.apiKeysRequired.done', 'Done')}
          </Button>
        </div>
      </div>

      <ApiKeyGuideModal
        open={showGuide}
        onClose={() => setShowGuide(false)}
        provider={guideProvider}
      />
    </div>
  );
}
