import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/css';
import { useAiStore } from '../state';
import ApiKeyInput from './ApiKeyInput';
import { ApiKeyInputWrapper } from './ApiKeyOptionBox';
import Button from './Button';
import Modal from './Modal';
import ApiKeyGuideModal from '../containers/SettingsPage/ApiKeyGuideModal';
import {
  settingsBodyTextStyles,
  settingsInlineLinkButtonStyles,
} from '../containers/SettingsPage/styles';
import { colors } from '../styles';

interface Props {
  open: boolean;
  onClose: () => void;
}

const contentStyles = css`
  width: min(600px, 90vw);
  max-height: 85vh;
`;

const bodyStyles = css`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
  padding-bottom: 8px;
`;

const introStyles = css`
  margin-bottom: 16px;
`;

const providerStackStyles = css`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const coverageGridStyles = css`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const coverageCardStyles = css`
  padding: 12px 14px;
  border: 1px solid ${colors.border};
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.015);
`;

const coverageSatisfiedStyles = css`
  border-color: ${colors.primary};
  background: rgba(125, 167, 255, 0.06);
`;

const coverageHeaderStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
`;

const coverageCheckStyles = css`
  width: 20px;
  height: 20px;
  border-radius: 999px;
  border: 1px solid ${colors.border};
  color: ${colors.textDim};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.78rem;
  font-weight: 700;
  flex: 0 0 auto;
`;

const coverageCheckSatisfiedStyles = css`
  border-color: ${colors.primary};
  background: ${colors.primary};
  color: #fff;
`;

const coverageLabelStyles = css`
  color: ${colors.text};
  font-weight: 600;
`;

const coverageHintStyles = css`
  color: ${colors.textDim};
  font-size: 0.85rem;
  padding-left: 30px;
`;

const coverageStatusStyles = css`
  font-size: 0.92rem;
  flex: 1 1 auto;
  min-width: 0;
`;

const coverageStatusReadyStyles = css`
  color: ${colors.primaryLight};
`;

const coverageStatusMissingStyles = css`
  color: ${colors.textDim};
`;

const footerActionsStyles = css`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const footerButtonsStyles = css`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;

  @media (max-width: 640px) {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }
`;

function formatCoverageHint(providers: string[], fallback: string): string {
  if (providers.length > 0) {
    return providers.join(' · ');
  }
  return fallback;
}

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
  const byoUnlocked = useAiStore(s => s.byoUnlocked);

  // Anthropic state
  const anthropicKeyValue = useAiStore(s => s.anthropicKeyValue);
  const anthropicKeyPresent = useAiStore(s => s.anthropicKeyPresent);
  const setAnthropicKeyValue = useAiStore(s => s.setAnthropicKeyValue);
  const saveAnthropicKey = useAiStore(s => s.saveAnthropicKey);
  const validateAnthropicKey = useAiStore(s => s.validateAnthropicKey);
  const clearAnthropicKey = useAiStore(s => s.clearAnthropicKey);
  const savingAnthropicKey = useAiStore(s => s.savingAnthropicKey);
  const validatingAnthropicKey = useAiStore(s => s.validatingAnthropicKey);
  const byoAnthropicUnlocked = useAiStore(s => s.byoAnthropicUnlocked);

  // ElevenLabs state
  const elevenLabsKeyValue = useAiStore(s => s.elevenLabsKeyValue);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);
  const setElevenLabsKeyValue = useAiStore(s => s.setElevenLabsKeyValue);
  const saveElevenLabsKey = useAiStore(s => s.saveElevenLabsKey);
  const validateElevenLabsKey = useAiStore(s => s.validateElevenLabsKey);
  const clearElevenLabsKey = useAiStore(s => s.clearElevenLabsKey);
  const savingElevenLabsKey = useAiStore(s => s.savingElevenLabsKey);
  const validatingElevenLabsKey = useAiStore(s => s.validatingElevenLabsKey);
  const byoElevenLabsUnlocked = useAiStore(s => s.byoElevenLabsUnlocked);

  const hasOpenAiConfigured = byoUnlocked && keyPresent;
  const hasAnthropicConfigured = byoAnthropicUnlocked && anthropicKeyPresent;
  const hasElevenLabsConfigured =
    byoElevenLabsUnlocked && elevenLabsKeyPresent;

  const hasTranslationCoverage = hasOpenAiConfigured || hasAnthropicConfigured;
  const hasAudioCoverage = hasOpenAiConfigured || hasElevenLabsConfigured;
  const conditionsMet = hasTranslationCoverage && hasAudioCoverage;
  const translationHint = formatCoverageHint(
    [
      hasOpenAiConfigured ? 'OpenAI' : '',
      hasAnthropicConfigured ? 'Anthropic' : '',
    ].filter(Boolean),
    'OpenAI / Anthropic'
  );
  const audioHint = formatCoverageHint(
    [
      hasOpenAiConfigured ? 'OpenAI' : '',
      hasElevenLabsConfigured ? 'ElevenLabs' : '',
    ].filter(Boolean),
    'OpenAI / ElevenLabs'
  );
  const translationProviderOptions =
    [
      byoUnlocked ? 'OpenAI' : '',
      byoAnthropicUnlocked ? 'Anthropic' : '',
    ].filter(Boolean) || [];
  const audioProviderOptions =
    [
      byoUnlocked ? 'OpenAI' : '',
      byoElevenLabsUnlocked ? 'ElevenLabs' : '',
    ].filter(Boolean) || [];

  const formatProviderList = (providers: string[], fallback: string[]) => {
    const available = providers.length > 0 ? providers : fallback;
    if (available.length === 1) return available[0];
    if (available.length === 2) {
      return `${available[0]} ${t('common.or', 'or')} ${available[1]}`;
    }
    return `${available.slice(0, -1).join(', ')} ${t('common.or', 'or')} ${available[available.length - 1]}`;
  };

  const translationProvidersLabel = formatProviderList(
    translationProviderOptions,
    ['OpenAI', 'Anthropic']
  );
  const audioProvidersLabel = formatProviderList(audioProviderOptions, [
    'OpenAI',
    'ElevenLabs',
  ]);
  const coverageStatusMessage = !conditionsMet
    ? !hasTranslationCoverage && !hasAudioCoverage
      ? t(
          'dialogs.apiKeysRequired.missingBoth',
          'Still needed: translation ({{translationProviders}}) and audio ({{audioProviders}}).',
          {
            translationProviders: translationProvidersLabel,
            audioProviders: audioProvidersLabel,
          }
        )
      : !hasTranslationCoverage
        ? t(
            'dialogs.apiKeysRequired.missingTranslation',
            'Translation still needs {{providers}}.',
            {
              providers: translationProvidersLabel,
            }
          )
        : t(
            'dialogs.apiKeysRequired.missingAudio',
            'Audio still needs {{providers}}.',
            {
              providers: audioProvidersLabel,
            }
          )
    : null;

  const handleDone = async () => {
    if (!conditionsMet) return;
    const setUseApiKeysMode = useAiStore.getState().setUseApiKeysMode;
    const result = await setUseApiKeysMode(true);
    if (result.success) {
      onClose();
    }
  };

  return (
    <>
      <Modal
        open={open}
        title={t('dialogs.apiKeysRequired.title', 'API Keys Required')}
        titleId="api-keys-required-title"
        onClose={onClose}
        contentClassName={contentStyles}
        bodyClassName={bodyStyles}
        actions={
          <div className={footerActionsStyles}>
            <div
              className={`${coverageStatusStyles} ${
                conditionsMet
                  ? coverageStatusReadyStyles
                  : coverageStatusMissingStyles
              }`}
            >
              {coverageStatusMessage}
            </div>
            <div className={footerButtonsStyles}>
              <Button variant="secondary" onClick={onClose}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleDone}
                disabled={!conditionsMet}
              >
                {conditionsMet
                  ? t('dialogs.apiKeysRequired.enable', 'Use My API Keys')
                  : t('dialogs.apiKeysRequired.done', 'Done')}
              </Button>
            </div>
          </div>
        }
      >
        <p
          className={`${settingsBodyTextStyles} ${introStyles}`}
        >
          {t(
            'dialogs.apiKeysRequired.message',
            'To use your API keys for all AI operations, you need translation coverage and audio coverage. OpenAI covers both. Anthropic needs OpenAI or ElevenLabs for audio.'
          )}{' '}
          <button
            onClick={() => openGuide()}
            className={settingsInlineLinkButtonStyles}
          >
            {t('dialogs.apiKeysRequired.howToGet', 'How to get API keys')}
          </button>
        </p>

        <div className={coverageGridStyles}>
          <div
            className={`${coverageCardStyles} ${
              hasTranslationCoverage ? coverageSatisfiedStyles : ''
            }`}
          >
            <div className={coverageHeaderStyles}>
              <span
                className={`${coverageCheckStyles} ${
                  hasTranslationCoverage ? coverageCheckSatisfiedStyles : ''
                }`}
              >
                {hasTranslationCoverage ? '✓' : '1'}
              </span>
              <span className={coverageLabelStyles}>
                {t('settings.byoPreferences.translationDraft', 'Translation')}
              </span>
            </div>
            <div className={coverageHintStyles}>{translationHint}</div>
          </div>

          <div
            className={`${coverageCardStyles} ${
              hasAudioCoverage ? coverageSatisfiedStyles : ''
            }`}
          >
            <div className={coverageHeaderStyles}>
              <span
                className={`${coverageCheckStyles} ${
                  hasAudioCoverage ? coverageCheckSatisfiedStyles : ''
                }`}
              >
                {hasAudioCoverage ? '✓' : '2'}
              </span>
              <span className={coverageLabelStyles}>
                {`${t('settings.byoPreferences.transcription', 'Transcription')} + ${t('settings.byoPreferences.dubbing', 'Dubbing')}`}
              </span>
            </div>
            <div className={coverageHintStyles}>{audioHint}</div>
          </div>
        </div>

        <div className={providerStackStyles}>
          <ApiKeyInputWrapper satisfied={hasOpenAiConfigured}>
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
          </ApiKeyInputWrapper>

          <ApiKeyInputWrapper satisfied={hasAnthropicConfigured}>
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

          <ApiKeyInputWrapper satisfied={hasElevenLabsConfigured}>
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
      </Modal>
      <ApiKeyGuideModal
        open={showGuide}
        onClose={() => setShowGuide(false)}
        provider={guideProvider}
      />
    </>
  );
}
