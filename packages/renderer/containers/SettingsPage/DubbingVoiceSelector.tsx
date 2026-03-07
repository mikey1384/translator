import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { colors, selectStyles } from '../../styles';
import { useUIStore } from '../../state/ui-store';
import { useAiStore } from '../../state';
import { useCreditStore } from '../../state/credit-store';
import * as SubtitlesIPC from '../../ipc/subtitles';
import { PREVIEW_TTS_CREDITS } from '../../utils/creditEstimates';

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

const OPENAI_VOICES = [
  { value: 'alloy', fallback: 'Alloy' },
  { value: 'echo', fallback: 'Echo' },
  { value: 'fable', fallback: 'Fable' },
  { value: 'onyx', fallback: 'Onyx' },
  { value: 'nova', fallback: 'Nova' },
  { value: 'shimmer', fallback: 'Shimmer' },
] as const;

const DEFAULT_OPENAI_VOICE = 'alloy';
const DEFAULT_ELEVENLABS_VOICE = 'rachel';

export default function DubbingVoiceSelector() {
  const { t } = useTranslation();
  const dubVoice = useUIStore(s => s.dubVoice);
  const setDubVoice = useUIStore(s => s.setDubVoice);
  const useStrictByoMode = useAiStore(state => state.useStrictByoMode);
  const byoOpenAiUnlocked = useAiStore(state => state.byoUnlocked);
  const openAiKeyPresent = useAiStore(state => state.keyPresent);
  const useByoOpenAi = useAiStore(state => state.useByo);
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
  const refreshCredits = useCreditStore(state => state.refresh);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const previewTokenRef = useRef(0);

  const hasOpenAiByo =
    useStrictByoMode &&
    byoOpenAiUnlocked &&
    openAiKeyPresent &&
    useByoOpenAi;
  const hasElevenLabsByo =
    useStrictByoMode &&
    byoElevenLabsUnlocked &&
    elevenLabsKeyPresent &&
    useByoElevenLabs;

  const activeDubbingProvider: 'stage5' | 'openai' | 'elevenlabs' = useStrictByoMode
    ? (() => {
        if (preferredDubbingProvider === 'stage5') {
          if (hasOpenAiByo) return 'openai';
          if (hasElevenLabsByo) return 'elevenlabs';
          return 'stage5';
        }
        if (preferredDubbingProvider === 'elevenlabs') {
          if (hasElevenLabsByo) return 'elevenlabs';
          if (hasOpenAiByo) return 'openai';
          return 'stage5';
        }
        if (preferredDubbingProvider === 'openai') {
          if (hasOpenAiByo) return 'openai';
          if (hasElevenLabsByo) return 'elevenlabs';
          return 'stage5';
        }
        if (hasOpenAiByo) return 'openai';
        if (hasElevenLabsByo) return 'elevenlabs';
        return 'stage5';
      })()
    : 'stage5';

  const activeVoiceProvider: 'openai' | 'elevenlabs' =
    activeDubbingProvider === 'stage5'
      ? stage5DubbingTtsProvider
      : activeDubbingProvider;

  const isUsingElevenLabs = activeVoiceProvider === 'elevenlabs';
  const activeVoices = isUsingElevenLabs ? ELEVENLABS_VOICES : OPENAI_VOICES;
  const defaultVoice = isUsingElevenLabs
    ? DEFAULT_ELEVENLABS_VOICE
    : DEFAULT_OPENAI_VOICE;
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

  const handlePreview = async () => {
    const token = ++previewTokenRef.current;
    setIsPreviewing(true);
    try {
      const result = await SubtitlesIPC.previewDubVoice({
        voice: effectiveVoice,
      });
      if (previewTokenRef.current !== token) return;
      if (result?.success && result.audioBase64) {
        if (!useStrictByoMode || activeDubbingProvider === 'stage5') {
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

  const previewCost = isUsingElevenLabs
    ? PREVIEW_TTS_CREDITS.elevenlabs
    : PREVIEW_TTS_CREDITS.openai;

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
          className={previewButtonClass}
          onClick={handlePreview}
          disabled={isPreviewing}
          title={t('settings.dubbing.previewTooltip', 'Preview this voice')}
        >
          {isPreviewing
            ? t('settings.dubbing.previewing', 'Playing...')
            : useStrictByoMode && activeDubbingProvider !== 'stage5'
              ? t('settings.dubbing.previewFree', 'Preview')
              : t('settings.dubbing.previewWithCost', 'Preview ({{cost}} credits)', {
                  cost: previewCost,
                })}
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
    </div>
  );
}
