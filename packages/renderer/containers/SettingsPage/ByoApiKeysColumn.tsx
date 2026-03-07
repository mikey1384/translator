import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useAiStore } from '../../state';
import ApiKeyInput from '../../components/ApiKeyInput';
import { ApiKeyInputWrapper } from '../../components/ApiKeyOptionBox';
import {
  hasAnthropicByoConfigured,
  hasElevenLabsByoConfigured,
  hasOpenAiByoConfigured,
} from '../../state/byo-runtime';
import { colors } from '../../styles';

interface ByoApiKeysColumnProps {
  onOpenGuide: (provider: 'openai' | 'anthropic' | 'elevenlabs') => void;
  className?: string;
}

const baseColumnStyles = css`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
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

function formatCoverageHint(providers: string[], fallback: string): string {
  if (providers.length > 0) {
    return providers.join(' · ');
  }
  return fallback;
}

export default function ByoApiKeysColumn({
  onOpenGuide,
  className,
}: ByoApiKeysColumnProps) {
  const { t } = useTranslation();

  const keyValue = useAiStore(state => state.keyValue);
  const keyPresent = useAiStore(state => state.keyPresent);
  const keyLoading = useAiStore(state => state.keyLoading);
  const savingKey = useAiStore(state => state.savingKey);
  const validatingKey = useAiStore(state => state.validatingKey);
  const setKeyValue = useAiStore(state => state.setKeyValue);
  const saveKey = useAiStore(state => state.saveKey);
  const clearKey = useAiStore(state => state.clearKey);
  const validateKey = useAiStore(state => state.validateKey);
  const byoUnlocked = useAiStore(state => state.byoUnlocked);

  const anthropicKeyValue = useAiStore(state => state.anthropicKeyValue);
  const anthropicKeyPresent = useAiStore(state => state.anthropicKeyPresent);
  const anthropicKeyLoading = useAiStore(state => state.anthropicKeyLoading);
  const savingAnthropicKey = useAiStore(state => state.savingAnthropicKey);
  const validatingAnthropicKey = useAiStore(
    state => state.validatingAnthropicKey
  );
  const setAnthropicKeyValue = useAiStore(state => state.setAnthropicKeyValue);
  const saveAnthropicKey = useAiStore(state => state.saveAnthropicKey);
  const clearAnthropicKey = useAiStore(state => state.clearAnthropicKey);
  const validateAnthropicKey = useAiStore(state => state.validateAnthropicKey);
  const byoAnthropicUnlocked = useAiStore(state => state.byoAnthropicUnlocked);

  const elevenLabsKeyValue = useAiStore(state => state.elevenLabsKeyValue);
  const elevenLabsKeyPresent = useAiStore(state => state.elevenLabsKeyPresent);
  const elevenLabsKeyLoading = useAiStore(state => state.elevenLabsKeyLoading);
  const savingElevenLabsKey = useAiStore(state => state.savingElevenLabsKey);
  const validatingElevenLabsKey = useAiStore(
    state => state.validatingElevenLabsKey
  );
  const setElevenLabsKeyValue = useAiStore(
    state => state.setElevenLabsKeyValue
  );
  const saveElevenLabsKey = useAiStore(state => state.saveElevenLabsKey);
  const clearElevenLabsKey = useAiStore(state => state.clearElevenLabsKey);
  const validateElevenLabsKey = useAiStore(
    state => state.validateElevenLabsKey
  );
  const byoElevenLabsUnlocked = useAiStore(
    state => state.byoElevenLabsUnlocked
  );

  const hasOpenAiConfigured = hasOpenAiByoConfigured({
    byoUnlocked,
    keyPresent,
  });
  const hasAnthropicConfigured = hasAnthropicByoConfigured({
    byoAnthropicUnlocked,
    anthropicKeyPresent,
  });
  const hasElevenLabsConfigured = hasElevenLabsByoConfigured({
    byoElevenLabsUnlocked,
    elevenLabsKeyPresent,
  });
  const hasTranslationCoverage = hasOpenAiConfigured || hasAnthropicConfigured;
  const hasAudioCoverage = hasOpenAiConfigured || hasElevenLabsConfigured;

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

  return (
    <div className={cx(baseColumnStyles, className)}>
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
            loading={keyLoading}
            saving={savingKey}
            validating={validatingKey}
            compact
            onHelpClick={() => onOpenGuide('openai')}
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
            loading={anthropicKeyLoading}
            saving={savingAnthropicKey}
            validating={validatingAnthropicKey}
            compact
            onHelpClick={() => onOpenGuide('anthropic')}
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
            loading={elevenLabsKeyLoading}
            saving={savingElevenLabsKey}
            validating={validatingElevenLabsKey}
            compact
            onHelpClick={() => onOpenGuide('elevenlabs')}
          />
        </ApiKeyInputWrapper>
      </div>
    </div>
  );
}
