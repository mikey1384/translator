import { useTranslation } from 'react-i18next';
import { useAiStore } from '../../../state';
import { getTranscriptionActionState } from '../../../state/byo-runtime';

/**
 * Transcription is ElevenLabs Scribe only. In API key mode without a usable
 * BYO ElevenLabs key it cannot run (Stage5 credits are not used there and an
 * OpenAI key cannot transcribe), so the Transcribe / Translate actions show
 * why before anything starts. Returns the message, or null when allowed.
 */
export function useTranscriptionBlocker(): string | null {
  const { t } = useTranslation();
  const useApiKeysMode = useAiStore(s => s.useApiKeysMode);
  const byoElevenLabsUnlocked = useAiStore(s => s.byoElevenLabsUnlocked);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);
  const useByoElevenLabs = useAiStore(s => s.useByoElevenLabs);
  const preferredTranscriptionProvider = useAiStore(
    s => s.preferredTranscriptionProvider
  );
  const state = getTranscriptionActionState({
    useApiKeysMode,
    byoElevenLabsUnlocked,
    elevenLabsKeyPresent,
    useByoElevenLabs,
    preferredTranscriptionProvider,
  });
  if (state.kind !== 'blocked') return null;
  return t(
    'settings.byoPreferences.transcriptionRequiresElevenLabs',
    'Transcription uses ElevenLabs Scribe only. Add an ElevenLabs API key to transcribe with your own keys. Without one, transcription uses Stage5 credits, which are not used while your API keys are on. Your OpenAI key is still used for translation.'
  );
}
