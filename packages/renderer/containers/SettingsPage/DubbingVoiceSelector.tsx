import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { colors, selectStyles } from '../../styles';
import { useUIStore } from '../../state/ui-store';
import { useAiStore } from '../../state';
import { useCreditStore } from '../../state/credit-store';
import * as SubtitlesIPC from '../../ipc/subtitles';
import * as SystemIPC from '../../ipc/system';

// Preview credit costs (for "Hello" = 5 characters)
// Calculated using: chars × ($/1M chars) × MARGIN(2) / USD_PER_CREDIT($10/350k)
const PREVIEW_CREDITS = {
  openai: 6, // ~$0.000075 → 6 credits
  elevenlabs: 70, // ~$0.001 → 70 credits
} as const;

// Voice cloning cost fallback (fetched from API at runtime)
// ElevenLabs Dubbing API ~$0.50/min × MARGIN(2) / USD_PER_CREDIT ≈ 35,000 credits per minute
const DEFAULT_VOICE_CLONING_CREDITS_PER_MINUTE = 35_000;

// ElevenLabs voices
const ELEVENLABS_VOICES = [
  { value: 'rachel', fallback: 'Rachel' },
  { value: 'adam', fallback: 'Adam' },
  { value: 'josh', fallback: 'Josh' },
  { value: 'sarah', fallback: 'Sarah' },
  { value: 'charlie', fallback: 'Charlie' },
  { value: 'emily', fallback: 'Emily' },
  { value: 'matilda', fallback: 'Matilda' },
  { value: 'brian', fallback: 'Brian' },
] as const;

// OpenAI TTS voices
const OPENAI_VOICES = [
  { value: 'alloy', fallback: 'Alloy' },
  { value: 'echo', fallback: 'Echo' },
  { value: 'fable', fallback: 'Fable' },
  { value: 'onyx', fallback: 'Onyx' },
  { value: 'nova', fallback: 'Nova' },
  { value: 'shimmer', fallback: 'Shimmer' },
] as const;

// Default voices for each provider
const DEFAULT_OPENAI_VOICE = 'alloy';
const DEFAULT_ELEVENLABS_VOICE = 'rachel';

export default function DubbingVoiceSelector() {
  const { t } = useTranslation();
  const { dubVoice, setDubVoice, dubUseVoiceCloning, setDubUseVoiceCloning } =
    useUIStore();
  const useByoMaster = useAiStore(state => state.useByoMaster);
  const credits = useCreditStore(state => state.credits);
  const useByoElevenLabs = useAiStore(state => state.useByoElevenLabs);
  const elevenLabsKeyPresent = useAiStore(state => state.elevenLabsKeyPresent);
  const byoElevenLabsUnlocked = useAiStore(
    state => state.byoElevenLabsUnlocked
  );
  const preferredDubbingProvider = useAiStore(
    state => state.preferredDubbingProvider
  );
  const stage5DubbingTtsProvider = useAiStore(
    state => state.stage5DubbingTtsProvider
  );
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [voiceCloningCreditsPerMinute, setVoiceCloningCreditsPerMinute] =
    useState(DEFAULT_VOICE_CLONING_CREDITS_PER_MINUTE);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const previewTokenRef = useRef(0);

  // Fetch voice cloning pricing from API on mount
  useEffect(() => {
    let cancelled = false;
    SystemIPC.getVoiceCloningPricing()
      .then(pricing => {
        if (!cancelled && pricing?.creditsPerMinute) {
          setVoiceCloningCreditsPerMinute(pricing.creditsPerMinute);
        }
      })
      .catch(() => {
        // Keep default on error
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-disable voice cloning if user can no longer afford it
  useEffect(() => {
    const canAfford =
      typeof credits === 'number' && credits >= voiceCloningCreditsPerMinute;
    if (dubUseVoiceCloning && !canAfford) {
      setDubUseVoiceCloning(false);
    }
  }, [
    credits,
    voiceCloningCreditsPerMinute,
    dubUseVoiceCloning,
    setDubUseVoiceCloning,
  ]);

  // Determine which TTS provider is active for voice selection
  // For Stage5 credits mode: use stage5DubbingTtsProvider
  // For BYO mode: use preferredDubbingProvider
  const isUsingElevenLabs =
    useByoMaster && preferredDubbingProvider === 'elevenlabs'
      ? true
      : useByoMaster && preferredDubbingProvider === 'openai'
        ? false
        : stage5DubbingTtsProvider === 'elevenlabs';

  // Get voices based on active provider
  const activeVoices = isUsingElevenLabs ? ELEVENLABS_VOICES : OPENAI_VOICES;
  const defaultVoice = isUsingElevenLabs
    ? DEFAULT_ELEVENLABS_VOICE
    : DEFAULT_OPENAI_VOICE;

  // Check if current voice is valid for the active provider
  const isCurrentVoiceValid = activeVoices.some(v => v.value === dubVoice);
  const effectiveVoice = isCurrentVoiceValid ? dubVoice : defaultVoice;

  // Auto-switch voice when provider changes and current voice is invalid
  useEffect(() => {
    if (!isCurrentVoiceValid && dubVoice !== effectiveVoice) {
      setDubVoice(effectiveVoice);
    }
  }, [isCurrentVoiceValid, dubVoice, effectiveVoice, setDubVoice]);

  const options = activeVoices.map(opt => ({
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

  // Just update the voice selection (no auto-preview)
  const handleVoiceChange = (value: string) => {
    setDubVoice(value);
  };

  // Get credit refresh function (only used in Stage5 mode)
  const refreshCredits = useCreditStore(state => state.refresh);

  // Preview the currently selected voice (costs credits for Stage5 mode)
  const handlePreview = async () => {
    const token = ++previewTokenRef.current;
    setIsPreviewing(true);
    try {
      const result = await SubtitlesIPC.previewDubVoice({
        voice: effectiveVoice,
      });
      if (previewTokenRef.current !== token) return;
      if (result?.success && result.audioBase64) {
        // Refresh credit balance after successful preview (Stage5 mode deducts credits)
        if (!useByoMaster) {
          refreshCredits();
        }
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

  // Get preview cost (only relevant for Stage5 credits mode)
  const previewCost = isUsingElevenLabs
    ? PREVIEW_CREDITS.elevenlabs
    : PREVIEW_CREDITS.openai;

  // Calculate voice cloning credit estimates
  const estimatedMinutes =
    typeof credits === 'number' && credits > 0
      ? Math.floor(credits / voiceCloningCreditsPerMinute)
      : 0;

  const selectClass = css`
    flex: 1;
    min-width: 0;
    text-align: left;
  `;

  const previewButtonClass = css`
    padding: 8px 12px;
    background: ${colors.grayLight};
    border: 1px solid ${colors.grayMedium};
    border-radius: 6px;
    color: ${colors.text};
    font-size: 0.85rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease;

    &:hover:not(:disabled) {
      background: ${colors.grayMedium};
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `;

  const toggleRowClass = css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  `;

  const toggleLabelClass = css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `;

  const toggleTitleClass = css`
    font-weight: 500;
    color: ${colors.text};
    font-size: 0.9rem;
  `;

  const toggleDescClass = css`
    color: ${colors.gray};
    font-size: 0.8rem;
  `;

  const toggleSwitchClass = css`
    position: relative;
    width: 44px;
    height: 24px;
    background: ${colors.grayMedium};
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.2s ease;
    flex-shrink: 0;

    &[data-checked='true'] {
      background: ${colors.primary};
    }

    &[data-disabled='true'] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s ease;
    }

    &[data-checked='true']::after {
      transform: translateX(20px);
    }
  `;

  const creditInfoClass = css`
    padding: 12px;
    background: ${colors.grayLight};
    border-radius: 8px;
    font-size: 0.85rem;
  `;

  const creditRowClass = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;

    &:not(:last-child) {
      border-bottom: 1px solid ${colors.grayMedium};
      margin-bottom: 4px;
    }
  `;

  const creditLabelClass = css`
    color: ${colors.gray};
  `;

  const creditValueClass = css`
    color: ${colors.text};
    font-weight: 500;
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
            color: ${colors.text};
          `}
        >
          {t('settings.dubbing.voiceLabel', 'Dubbed Voice')}
        </div>
        <div
          className={css`
            padding: 12px;
            background: ${colors.grayLight};
            border-radius: 8px;
            color: ${colors.text};
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

  // Voice cloning toggle is disabled for Stage5 credit users
  // ElevenLabs Dubbing API is too expensive (~35k credits/min) and doesn't allow
  // control over translation quality. Keep it only for BYO ElevenLabs users.
  const showVoiceCloningOption = false;

  // Disable voice cloning if user can't afford at least 1 minute
  const canAffordVoiceCloning = estimatedMinutes >= 1;

  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: 12px;
      `}
    >
      <div
        className={css`
          font-weight: 600;
          color: ${colors.text};
        `}
      >
        {t('settings.dubbing.voiceLabel', 'Dubbed Voice')}
      </div>

      {/* Voice Cloning Toggle (Stage5 credits + ElevenLabs only) */}
      {showVoiceCloningOption && (
        <div className={toggleRowClass}>
          <div className={toggleLabelClass}>
            <span className={toggleTitleClass}>
              {t('settings.dubbing.voiceCloning', 'Clone Original Voice')}
            </span>
            <span className={toggleDescClass}>
              {canAffordVoiceCloning
                ? t(
                    'settings.dubbing.voiceCloningDesc',
                    "Preserve the original speaker's voice in dubbed audio"
                  )
                : t(
                    'settings.dubbing.voiceCloningInsufficientCredits',
                    'Requires at least 1 minute of credits'
                  )}
            </span>
          </div>
          <div
            className={toggleSwitchClass}
            data-checked={dubUseVoiceCloning && canAffordVoiceCloning}
            data-disabled={!canAffordVoiceCloning}
            onClick={() => {
              if (canAffordVoiceCloning) {
                setDubUseVoiceCloning(!dubUseVoiceCloning);
              }
            }}
            role="switch"
            aria-checked={dubUseVoiceCloning && canAffordVoiceCloning}
            aria-disabled={!canAffordVoiceCloning}
            tabIndex={canAffordVoiceCloning ? 0 : -1}
            onKeyDown={e => {
              if (
                canAffordVoiceCloning &&
                (e.key === 'Enter' || e.key === ' ')
              ) {
                e.preventDefault();
                setDubUseVoiceCloning(!dubUseVoiceCloning);
              }
            }}
          />
        </div>
      )}

      {/* Voice Cloning Credit Info (when cloning is enabled) */}
      {showVoiceCloningOption && dubUseVoiceCloning ? (
        <div className={creditInfoClass}>
          <div className={creditRowClass}>
            <span className={creditLabelClass}>
              {t('settings.dubbing.costPerMinute', 'Cost per minute')}
            </span>
            <span className={creditValueClass}>
              {voiceCloningCreditsPerMinute.toLocaleString()}{' '}
              {t('settings.dubbing.credits', 'credits')}
            </span>
          </div>
          <div className={creditRowClass}>
            <span className={creditLabelClass}>
              {t('settings.dubbing.yourBalance', 'Your balance')}
            </span>
            <span className={creditValueClass}>
              {typeof credits === 'number'
                ? `${credits.toLocaleString()} ${t('settings.dubbing.credits', 'credits')}`
                : t('settings.dubbing.loading', 'Loading...')}
            </span>
          </div>
          <div className={creditRowClass}>
            <span className={creditLabelClass}>
              {t('settings.dubbing.canClone', 'You can clone')}
            </span>
            <span className={creditValueClass}>
              {t('settings.dubbing.upToMinutes', 'up to {{minutes}} min', {
                minutes: estimatedMinutes,
              })}
            </span>
          </div>
          <div
            className={css`
              margin-top: 8px;
              color: ${colors.gray};
              font-size: 0.8rem;
            `}
          >
            {t(
              'settings.dubbing.voiceCloningInfo',
              "Voice cloning uses ElevenLabs Dubbing API to analyze and recreate the original speaker's voice."
            )}
          </div>
        </div>
      ) : (
        /* Voice Actor Dropdown (when cloning is disabled or using TTS) */
        <>
          <div
            className={css`
              display: flex;
              gap: 8px;
              align-items: center;
            `}
          >
            <select
              className={`${selectStyles} ${selectClass}`}
              value={effectiveVoice}
              onChange={e => handleVoiceChange(e.target.value)}
              disabled={isPreviewing}
            >
              {options.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={previewButtonClass}
              onClick={handlePreview}
              disabled={isPreviewing}
              title={t('settings.dubbing.previewTooltip', 'Preview this voice')}
            >
              {isPreviewing
                ? t('settings.dubbing.previewing', 'Playing...')
                : useByoMaster
                  ? t('settings.dubbing.previewFree', 'Preview')
                  : t(
                      'settings.dubbing.previewWithCost',
                      'Preview ({{cost}} credits)',
                      {
                        cost: previewCost,
                      }
                    )}
            </button>
          </div>
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
        </>
      )}
    </div>
  );
}
