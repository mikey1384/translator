import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { colors, selectStyles } from '../../styles';
import { useUIStore } from '../../state/ui-store';
import { useAiStore, useCreditStore } from '../../state';
import * as SubtitlesIPC from '../../ipc/subtitles';
import * as SystemIPC from '../../ipc/system';
import { PREVIEW_TTS_CREDITS } from '../../utils/creditEstimates';
import { getDubbingActionState } from '../../state/byo-runtime';
import { formatCostInMinutes } from '../../utils/formatCostInMinutes';
import {
  notifyIfCreditsRefused,
  notifyInsufficientCredits,
} from '../../utils/taskFailure';
import {
  DEFAULT_DUB_VOICE,
  ELEVENLABS_DUB_VOICE_OPTIONS,
} from '../../../shared/constants';

// Dubbing is ElevenLabs-only; legacy OpenAI voice names are migrated to
// ElevenLabs voices in the UI store (see LEGACY_OPENAI_DUB_VOICE_MAP).
const ELEVENLABS_VOICES = ELEVENLABS_DUB_VOICE_OPTIONS;

export default function DubbingVoiceSelector({
  helpText,
}: {
  /** Replaces the Settings description where the picker sits in a tool. */
  helpText?: string;
} = {}) {
  const { t, i18n } = useTranslation();
  const credits = useCreditStore(state => state.credits);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const dubVoice = useUIStore(s => s.dubVoice);
  const setDubVoice = useUIStore(s => s.setDubVoice);
  const useApiKeysMode = useAiStore(state => state.useApiKeysMode);
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

  // Same rules as the Dub button: BYO ElevenLabs is free, Stage5 is priced,
  // API key mode without a usable ElevenLabs key is blocked (no request).
  const previewState = getDubbingActionState({
    useApiKeysMode,
    useByoElevenLabs,
    elevenLabsKeyPresent,
    byoElevenLabsUnlocked,
    preferredDubbingProvider,
  });
  const isUsingStage5Credits = previewState.kind === 'credits';
  const isPreviewBlocked = previewState.kind === 'blocked';
  const previewFailedMessage = t(
    'settings.dubbing.previewFailed',
    "Couldn't play the voice preview. Try again."
  );
  const blockedMessage = t(
    'settings.byoPreferences.dubbingRequiresElevenLabs',
    'Dubbing uses ElevenLabs only. Add an ElevenLabs API key to dub with your own keys. Without one, dubbing uses your Stage5 minutes, which aren’t used while your own keys are on.'
  );

  const activeVoices = ELEVENLABS_VOICES;
  const defaultVoice = DEFAULT_DUB_VOICE;
  const isCurrentVoiceValid = activeVoices.some(v => v.value === dubVoice);
  const effectiveVoice = isCurrentVoiceValid ? dubVoice : defaultVoice;

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

  const previewCost = PREVIEW_TTS_CREDITS.elevenlabs;
  // Too few credits: a preview request would only be refused, so the button
  // goes straight to the credits dialog instead of failing silently.
  const previewShortOfCredits =
    isUsingStage5Credits &&
    typeof credits === 'number' &&
    credits < previewCost;

  const handlePreview = async () => {
    if (isPreviewBlocked) return;
    setPreviewError(null);
    if (previewShortOfCredits) {
      notifyInsufficientCredits({
        kind: 'voicePreview',
        transcriptionSeconds: null,
      });
      return;
    }
    const token = ++previewTokenRef.current;
    setIsPreviewing(true);
    try {
      const result = await SubtitlesIPC.previewDubVoice({
        voice: effectiveVoice,
      });
      if (previewTokenRef.current !== token) return;
      if (result?.success && result.audioBase64) {
        if (isUsingStage5Credits) {
          void SystemIPC.refreshCreditSnapshot(true).catch(error => {
            console.warn(
              '[SettingsPage] Failed to refresh authoritative credit snapshot after voice preview:',
              error
            );
          });
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
        if (!notifyIfCreditsRefused(result.error, 'dubbing', 'voicePreview')) {
          setPreviewError(previewFailedMessage);
        }
      }
    } catch (err) {
      if (previewTokenRef.current === token) {
        console.warn('[SettingsPage] Voice preview failed:', err);
        if (!notifyIfCreditsRefused(err as any, 'dubbing', 'voicePreview')) {
          setPreviewError(previewFailedMessage);
        }
      }
    } finally {
      if (previewTokenRef.current === token) {
        setIsPreviewing(false);
      }
    }
  };

  const selectClass = css`
    flex: 1;
    min-width: 0;
    text-align: start;
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

  // Warning state, matching the Dub button's blocked cost label.
  const previewBlockedClass = css`
    color: ${colors.danger};
    border-color: ${colors.danger};
    cursor: not-allowed;
  `;

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
        {t('settings.dubbing.voiceLabel', 'Dubbed voice')}
      </div>

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
          onChange={e => setDubVoice(e.target.value)}
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
          className={cx(
            previewButtonClass,
            isPreviewBlocked && previewBlockedClass
          )}
          onClick={handlePreview}
          disabled={isPreviewing}
          aria-disabled={isPreviewBlocked}
          data-preview-state={previewState.kind}
          title={
            isPreviewBlocked
              ? blockedMessage
              : t('settings.dubbing.previewTooltip', 'Preview this voice')
          }
        >
          {isPreviewing
            ? t('settings.dubbing.previewing', 'Playing...')
            : isPreviewBlocked
              ? 'ElevenLabs'
              : previewState.kind === 'byo'
                ? t('settings.dubbing.previewFree', 'Preview')
                : t(
                    'settings.dubbing.previewWithMinutes',
                    'Preview ({{cost}})',
                    {
                      cost: formatCostInMinutes(previewCost, {
                        kind: 'estimate',
                        locale: i18n.language,
                      }),
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
        {helpText ??
          t(
            'settings.dubbing.voiceHelp',
            'Choose the default voice for generated dubs.'
          )}
      </div>
      {previewError ? (
        <div
          role="alert"
          className={css`
            color: ${colors.danger};
            font-size: 0.85rem;
          `}
        >
          {previewError}
        </div>
      ) : null}
      {isPreviewBlocked ? (
        <div
          role="note"
          className={css`
            color: ${colors.danger};
            font-size: 0.85rem;
          `}
        >
          {blockedMessage}
        </div>
      ) : null}
    </div>
  );
}
