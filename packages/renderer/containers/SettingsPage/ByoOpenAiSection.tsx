import { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';
import { useAiStore } from '../../state';
import ApiKeyInput from '../../components/ApiKeyInput';
import {
  ApiKeyOptionBox,
  OrDivider,
  ApiKeyInputWrapper,
} from '../../components/ApiKeyOptionBox';
import { byoCardStyles } from './styles';
import ApiKeyGuideModal from './ApiKeyGuideModal';
import DubbingVoiceSelector from './DubbingVoiceSelector';
import { logButton } from '../../utils/logger';

// Provider configuration with i18n keys and pricing (per 1 hour video, 2025 prices)
// GPT-5.1: $1.25/1M in, $10/1M out | Claude Sonnet 4.5: $3/1M in, $15/1M out
// Claude Opus 4.6: $5/1M in, $25/1M out | Whisper: $0.006/min | Scribe: $0.40/hr
// OpenAI TTS: $15/1M chars | ElevenLabs TTS: ~$0.20/1K chars
const PROVIDERS = {
  transcription: {
    openai: {
      labelKey: 'settings.byoPreferences.openaiWhisper',
      fallback: 'OpenAI Whisper',
      price: '~$0.36',
    },
    elevenlabs: {
      labelKey: 'settings.byoPreferences.elevenLabsScribe',
      fallback: 'ElevenLabs Scribe',
      price: '~$0.40',
    },
  },
  translationDraft: {
    openai: {
      labelKey: 'settings.byoPreferences.gpt',
      fallback: 'GPT-5.1',
      price: '~$0.18',
    },
    anthropic: {
      labelKey: 'settings.byoPreferences.claudeSonnet',
      fallback: 'Claude Sonnet',
      price: '~$0.29',
    },
  },
  review: {
    openai: {
      labelKey: 'settings.byoPreferences.gptHigh',
      fallback: 'GPT-5.1 (high)',
      price: '~$0.18',
    },
    anthropic: {
      labelKey: 'settings.byoPreferences.claudeOpus',
      fallback: 'Claude Opus',
      price: '~$0.48',
    },
  },
  summary: {
    openai: {
      labelKey: 'settings.byoPreferences.gpt',
      fallback: 'GPT-5.1',
      price: '~$0.02',
    },
    anthropic: {
      labelKey: 'settings.byoPreferences.claudeOpus',
      fallback: 'Claude Opus',
      price: '~$0.10',
    },
  },
  dubbing: {
    openai: {
      labelKey: 'settings.byoPreferences.openaiTts',
      fallback: 'OpenAI TTS',
      price: '~$0.70',
    },
    elevenlabs: {
      labelKey: 'settings.byoPreferences.elevenLabsTts',
      fallback: 'ElevenLabs',
      price: '~$9',
    },
  },
} as const;

// Styles
const sectionTitle = css`
  font-size: 0.85rem;
  font-weight: 500;
  color: ${colors.text};
`;

const radioLabel = css`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 4px;
`;

const radioLabelSelected = css`
  background: rgba(67, 97, 238, 0.1);
`;

const infoText = css`
  font-size: 0.85rem;
  color: ${colors.textDim};
  padding-left: 4px;
`;

const priceText = css`
  color: ${colors.textDim};
  margin-left: 6px;
`;

// Reusable PreferenceRow component
interface PreferenceRowProps {
  title: string;
  hasChoice: boolean;
  radioName: string;
  options: Array<{
    value: string;
    label: string;
    price: string;
    selected: boolean;
    onSelect: () => void;
  }>;
  infoProvider?: {
    label: string;
    price: string;
  };
}

function PreferenceRow({
  title,
  hasChoice,
  radioName,
  options,
  infoProvider,
}: PreferenceRowProps) {
  return (
    <div>
      <div className={sectionTitle} style={{ marginBottom: hasChoice ? 8 : 4 }}>
        {title}
      </div>
      {hasChoice ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {options.map(opt => (
            <label
              key={opt.value}
              className={`${radioLabel} ${opt.selected ? radioLabelSelected : ''}`}
            >
              <input
                type="radio"
                name={radioName}
                checked={opt.selected}
                onChange={opt.onSelect}
                style={{ accentColor: colors.primary }}
              />
              <span style={{ fontSize: '.85rem', color: colors.text }}>
                {opt.label}
                <span className={priceText}>{opt.price}</span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        infoProvider && (
          <div className={infoText}>
            {infoProvider.label}
            <span className={priceText}>{infoProvider.price}</span>
          </div>
        )
      )}
    </div>
  );
}

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
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const useByoMaster = useAiStore(state => state.useByoMaster);
  const lastFetched = useAiStore(state => state.lastFetched);
  const encryptionAvailable = useAiStore(state => state.encryptionAvailable);

  // Effective BYO unlocked state (respects admin preview mode)
  const effectiveByoUnlocked = byoUnlocked && !adminByoPreviewMode;

  // OpenAI state
  const keyValue = useAiStore(state => state.keyValue);
  const keyPresent = useAiStore(state => state.keyPresent);
  const keyLoading = useAiStore(state => state.keyLoading);
  const savingKey = useAiStore(state => state.savingKey);
  const validatingKey = useAiStore(state => state.validatingKey);
  const setKeyValue = useAiStore(state => state.setKeyValue);
  const loadKey = useAiStore(state => state.loadKey);
  const saveKey = useAiStore(state => state.saveKey);
  const clearKey = useAiStore(state => state.clearKey);
  const validateKey = useAiStore(state => state.validateKey);

  // Anthropic state
  const anthropicKeyValue = useAiStore(state => state.anthropicKeyValue);
  const anthropicKeyPresent = useAiStore(state => state.anthropicKeyPresent);
  const anthropicKeyLoading = useAiStore(state => state.anthropicKeyLoading);
  const savingAnthropicKey = useAiStore(state => state.savingAnthropicKey);
  const validatingAnthropicKey = useAiStore(
    state => state.validatingAnthropicKey
  );
  const setAnthropicKeyValue = useAiStore(state => state.setAnthropicKeyValue);
  const loadAnthropicKey = useAiStore(state => state.loadAnthropicKey);
  const saveAnthropicKey = useAiStore(state => state.saveAnthropicKey);
  const clearAnthropicKey = useAiStore(state => state.clearAnthropicKey);
  const validateAnthropicKey = useAiStore(state => state.validateAnthropicKey);

  // ElevenLabs state
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
  const loadElevenLabsKey = useAiStore(state => state.loadElevenLabsKey);
  const saveElevenLabsKey = useAiStore(state => state.saveElevenLabsKey);
  const clearElevenLabsKey = useAiStore(state => state.clearElevenLabsKey);
  const validateElevenLabsKey = useAiStore(
    state => state.validateElevenLabsKey
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
  const preferClaudeSummary = useAiStore(state => state.preferClaudeSummary);
  const setPreferClaudeSummary = useAiStore(
    state => state.setPreferClaudeSummary
  );

  useEffect(() => {
    if (!initialized) {
      initialize().catch(err => {
        console.error('[ByoOpenAiSection] init failed', err);
      });
    }
  }, [initialized, initialize]);

  // Load API keys when component mounts
  useEffect(() => {
    loadKey();
    loadAnthropicKey();
    loadElevenLabsKey();
  }, [loadKey, loadAnthropicKey, loadElevenLabsKey]);

  // Don't render if not unlocked (or in admin preview mode) or master toggle is off
  if (!effectiveByoUnlocked || !useByoMaster) {
    return null;
  }

  // Provider preference handlers
  const handleTranscriptionProviderChange = async (
    provider: 'elevenlabs' | 'openai'
  ) => {
    const result = await setPreferredTranscriptionProvider(provider);
    if (!result.success) {
      console.error('Failed to update transcription provider:', result.error);
    }
  };

  const handleDubbingProviderChange = async (
    provider: 'elevenlabs' | 'openai'
  ) => {
    const result = await setPreferredDubbingProvider(provider);
    if (!result.success) {
      console.error('Failed to update dubbing provider:', result.error);
    }
  };

  const handleTranslationProviderChange = async (value: boolean) => {
    const result = await setPreferClaudeTranslation(value);
    if (!result.success) {
      console.error('Failed to update translation provider:', result.error);
    }
  };

  const handleReviewProviderChange = async (value: boolean) => {
    const result = await setPreferClaudeReview(value);
    if (!result.success) {
      console.error('Failed to update review provider:', result.error);
    }
  };

  const handleSummaryProviderChange = async (value: boolean) => {
    const result = await setPreferClaudeSummary(value);
    if (!result.success) {
      console.error('Failed to update summary provider:', result.error);
    }
  };

  // Computed values - check which preferences should be shown
  const hasOpenAi = keyPresent;
  const hasAnthropic = anthropicKeyPresent;
  const hasElevenLabs = elevenLabsKeyPresent;
  const hasAnthropicCombo = hasAnthropic && hasElevenLabs;

  // Show stack panel when any valid provider configuration exists
  const showStackPanel = hasOpenAi || hasAnthropicCombo;

  // Selection mode: user has both options and can choose between them
  const hasProviderChoice = hasOpenAi && (hasAnthropic || hasElevenLabs);

  // Individual choice flags (for radio buttons)
  const hasTranscriptionChoice = hasOpenAi && hasElevenLabs;
  const hasTranslationChoice = hasOpenAi && hasAnthropic;
  const hasReviewChoice = hasOpenAi && hasAnthropic;
  const hasSummaryChoice = hasOpenAi && hasAnthropic;
  const hasDubbingChoice = hasOpenAi && hasElevenLabs;

  // Determine which provider is used when there's no choice
  const transcriptionProvider = hasOpenAi ? 'openai' : 'elevenlabs';
  const translationDraftProvider = hasOpenAi ? 'openai' : 'anthropic';
  const reviewProvider = hasOpenAi ? 'openai' : 'anthropic';
  const summaryProvider = hasOpenAi ? 'openai' : 'anthropic';
  const dubbingProvider = hasOpenAi ? 'openai' : 'elevenlabs';

  return (
    <section className={byoCardStyles}>
      <h2
        style={{
          fontSize: '1.1rem',
          fontWeight: 600,
          margin: 0,
          color: colors.text,
        }}
      >
        {t('settings.byoOpenAi.title', 'Bring Your Own API Keys')}
      </h2>

      {lastFetched && (
        <span style={{ color: colors.textDim, fontSize: '.8rem' }}>
          {t('settings.byoOpenAi.lastSynced', 'Last synced')}: {lastFetched}
        </span>
      )}

      {/* Encryption warning */}
      {!encryptionAvailable && (
        <div
          style={{
            backgroundColor: 'rgba(220, 53, 69, 0.15)',
            border: '1px solid rgba(220, 53, 69, 0.3)',
            borderRadius: 6,
            padding: '10px 14px',
            marginTop: 8,
          }}
        >
          <span style={{ color: '#dc3545', fontSize: '0.85rem' }}>
            {t(
              'settings.byoOpenAi.encryptionUnavailable',
              'Secure storage is not available on this system. API keys cannot be saved.'
            )}
          </span>
        </div>
      )}

      {/* Two-column layout */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        {/* Left column: API Keys */}
        <div
          style={{
            flex: '1 1 auto',
            minWidth: 280,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <ApiKeyOptionBox
            optionNumber={1}
            title={t('settings.byoOpenAi.option1Title', 'Option 1: OpenAI')}
            satisfied={keyPresent}
          >
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
              onHelpClick={() => openGuide('openai')}
            />
          </ApiKeyOptionBox>

          <OrDivider />

          <ApiKeyOptionBox
            optionNumber={2}
            title={t(
              'settings.byoOpenAi.option2Title',
              'Option 2: Anthropic + ElevenLabs'
            )}
            satisfied={anthropicKeyPresent && elevenLabsKeyPresent}
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
                  loading={anthropicKeyLoading}
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
                  loading={elevenLabsKeyLoading}
                  saving={savingElevenLabsKey}
                  validating={validatingElevenLabsKey}
                  compact
                  onHelpClick={() => openGuide('elevenlabs')}
                />
              </ApiKeyInputWrapper>
            </div>
          </ApiKeyOptionBox>
        </div>

        {/* Right column: Stack info or Preferences */}
        {showStackPanel && (
          <div
            style={{
              flex: '0 0 auto',
              width: 220,
              display: 'flex',
              flexDirection: 'column',
              gap: hasProviderChoice ? 16 : 12,
              padding: 16,
              background: hasProviderChoice
                ? 'rgba(67, 97, 238, 0.05)'
                : 'transparent',
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: '.95rem',
                fontWeight: 600,
                color: colors.text,
              }}
            >
              {hasProviderChoice
                ? t('settings.byoPreferences.title', 'Provider Preferences')
                : t('settings.byoStack.title', 'Your AI Stack')}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: '.75rem',
                color: colors.textDim,
                lineHeight: 1.4,
              }}
            >
              {t(
                'settings.byoPreferences.pricingHint',
                'Estimated cost per 1 hour video'
              )}
            </p>

            <PreferenceRow
              title={t(
                'settings.byoPreferences.transcription',
                'Transcription'
              )}
              hasChoice={hasTranscriptionChoice}
              radioName="transcriptionProvider"
              options={[
                {
                  value: 'openai',
                  label: t(
                    PROVIDERS.transcription.openai.labelKey,
                    PROVIDERS.transcription.openai.fallback
                  ),
                  price: PROVIDERS.transcription.openai.price,
                  selected: preferredTranscriptionProvider === 'openai',
                  onSelect: () => handleTranscriptionProviderChange('openai'),
                },
                {
                  value: 'elevenlabs',
                  label: t(
                    PROVIDERS.transcription.elevenlabs.labelKey,
                    PROVIDERS.transcription.elevenlabs.fallback
                  ),
                  price: PROVIDERS.transcription.elevenlabs.price,
                  selected: preferredTranscriptionProvider === 'elevenlabs',
                  onSelect: () =>
                    handleTranscriptionProviderChange('elevenlabs'),
                },
              ]}
              infoProvider={
                transcriptionProvider === 'openai'
                  ? {
                      label: t(
                        PROVIDERS.transcription.openai.labelKey,
                        PROVIDERS.transcription.openai.fallback
                      ),
                      price: PROVIDERS.transcription.openai.price,
                    }
                  : {
                      label: t(
                        PROVIDERS.transcription.elevenlabs.labelKey,
                        PROVIDERS.transcription.elevenlabs.fallback
                      ),
                      price: PROVIDERS.transcription.elevenlabs.price,
                    }
              }
            />

            <PreferenceRow
              title={t(
                'settings.byoPreferences.translationDraft',
                'Translation (Draft)'
              )}
              hasChoice={hasTranslationChoice}
              radioName="translationProvider"
              options={[
                {
                  value: 'openai',
                  label: t(
                    PROVIDERS.translationDraft.openai.labelKey,
                    PROVIDERS.translationDraft.openai.fallback
                  ),
                  price: PROVIDERS.translationDraft.openai.price,
                  selected: !preferClaudeTranslation,
                  onSelect: () => handleTranslationProviderChange(false),
                },
                {
                  value: 'anthropic',
                  label: t(
                    PROVIDERS.translationDraft.anthropic.labelKey,
                    PROVIDERS.translationDraft.anthropic.fallback
                  ),
                  price: PROVIDERS.translationDraft.anthropic.price,
                  selected: preferClaudeTranslation,
                  onSelect: () => handleTranslationProviderChange(true),
                },
              ]}
              infoProvider={
                translationDraftProvider === 'openai'
                  ? {
                      label: t(
                        PROVIDERS.translationDraft.openai.labelKey,
                        PROVIDERS.translationDraft.openai.fallback
                      ),
                      price: PROVIDERS.translationDraft.openai.price,
                    }
                  : {
                      label: t(
                        PROVIDERS.translationDraft.anthropic.labelKey,
                        PROVIDERS.translationDraft.anthropic.fallback
                      ),
                      price: PROVIDERS.translationDraft.anthropic.price,
                    }
              }
            />

            <PreferenceRow
              title={t(
                'settings.byoPreferences.translationReview',
                'Translation (Review)'
              )}
              hasChoice={hasReviewChoice}
              radioName="reviewProvider"
              options={[
                {
                  value: 'openai',
                  label: t(
                    PROVIDERS.review.openai.labelKey,
                    PROVIDERS.review.openai.fallback
                  ),
                  price: PROVIDERS.review.openai.price,
                  selected: !preferClaudeReview,
                  onSelect: () => handleReviewProviderChange(false),
                },
                {
                  value: 'anthropic',
                  label: t(
                    PROVIDERS.review.anthropic.labelKey,
                    PROVIDERS.review.anthropic.fallback
                  ),
                  price: PROVIDERS.review.anthropic.price,
                  selected: preferClaudeReview,
                  onSelect: () => handleReviewProviderChange(true),
                },
              ]}
              infoProvider={
                reviewProvider === 'openai'
                  ? {
                      label: t(
                        PROVIDERS.review.openai.labelKey,
                        PROVIDERS.review.openai.fallback
                      ),
                      price: PROVIDERS.review.openai.price,
                    }
                  : {
                      label: t(
                        PROVIDERS.review.anthropic.labelKey,
                        PROVIDERS.review.anthropic.fallback
                      ),
                      price: PROVIDERS.review.anthropic.price,
                    }
              }
            />

            <PreferenceRow
              title={t('settings.byoPreferences.summary', 'Summary')}
              hasChoice={hasSummaryChoice}
              radioName="summaryProvider"
              options={[
                {
                  value: 'openai',
                  label: t(
                    PROVIDERS.summary.openai.labelKey,
                    PROVIDERS.summary.openai.fallback
                  ),
                  price: PROVIDERS.summary.openai.price,
                  selected: !preferClaudeSummary,
                  onSelect: () => handleSummaryProviderChange(false),
                },
                {
                  value: 'anthropic',
                  label: t(
                    PROVIDERS.summary.anthropic.labelKey,
                    PROVIDERS.summary.anthropic.fallback
                  ),
                  price: PROVIDERS.summary.anthropic.price,
                  selected: preferClaudeSummary,
                  onSelect: () => handleSummaryProviderChange(true),
                },
              ]}
              infoProvider={
                summaryProvider === 'openai'
                  ? {
                      label: t(
                        PROVIDERS.summary.openai.labelKey,
                        PROVIDERS.summary.openai.fallback
                      ),
                      price: PROVIDERS.summary.openai.price,
                    }
                  : {
                      label: t(
                        PROVIDERS.summary.anthropic.labelKey,
                        PROVIDERS.summary.anthropic.fallback
                      ),
                      price: PROVIDERS.summary.anthropic.price,
                    }
              }
            />

            <PreferenceRow
              title={t('settings.byoPreferences.dubbing', 'Dubbing')}
              hasChoice={hasDubbingChoice}
              radioName="dubbingProvider"
              options={[
                {
                  value: 'openai',
                  label: t(
                    PROVIDERS.dubbing.openai.labelKey,
                    PROVIDERS.dubbing.openai.fallback
                  ),
                  price: PROVIDERS.dubbing.openai.price,
                  selected: preferredDubbingProvider === 'openai',
                  onSelect: () => handleDubbingProviderChange('openai'),
                },
                {
                  value: 'elevenlabs',
                  label: t(
                    PROVIDERS.dubbing.elevenlabs.labelKey,
                    PROVIDERS.dubbing.elevenlabs.fallback
                  ),
                  price: PROVIDERS.dubbing.elevenlabs.price,
                  selected: preferredDubbingProvider === 'elevenlabs',
                  onSelect: () => handleDubbingProviderChange('elevenlabs'),
                },
              ]}
              infoProvider={
                dubbingProvider === 'openai'
                  ? {
                      label: t(
                        PROVIDERS.dubbing.openai.labelKey,
                        PROVIDERS.dubbing.openai.fallback
                      ),
                      price: PROVIDERS.dubbing.openai.price,
                    }
                  : {
                      label: t(
                        PROVIDERS.dubbing.elevenlabs.labelKey,
                        PROVIDERS.dubbing.elevenlabs.fallback
                      ),
                      price: PROVIDERS.dubbing.elevenlabs.price,
                    }
              }
            />
          </div>
        )}
      </div>

      {/* Default dub voice picker (BYO mode) */}
      <div style={{ marginTop: 16 }}>
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
