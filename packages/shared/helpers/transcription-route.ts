/**
 * Transcription provider routing, shared by main (request routing) and
 * renderer (Generate / Transcribe buttons) so both agree on when
 * transcription is blocked. Transcription is ElevenLabs Scribe only: OpenAI
 * whisper-1 shuts down on 2027-02-26 and its replacement returns no
 * timestamps, so it cannot make subtitles. A BYO ElevenLabs key is used when
 * available, otherwise Stage5 credits (which also transcribe with Scribe).
 * An OpenAI key never routes transcription.
 */
import {
  getApiKeyModeDubbingBlocker,
  type ApiKeyModeDubbingBlocker,
} from './dubbing-route';
import { ERROR_CODES } from '../constants';

export type TranscriptionRoute = 'elevenlabs' | 'stage5';

export function resolveTranscriptionRoute({
  preference,
  apiKeyMode,
  hasElevenLabsByo,
}: {
  /** Stored preference; legacy 'openai' is treated as 'elevenlabs'. */
  preference: unknown;
  apiKeyMode: boolean;
  /** ElevenLabs BYO entitlement + key + toggle (toggle implies API key mode). */
  hasElevenLabsByo: boolean;
}): TranscriptionRoute {
  if (preference === 'stage5' && !apiKeyMode) return 'stage5';
  return hasElevenLabsByo ? 'elevenlabs' : 'stage5';
}

/**
 * Reason transcription cannot run when API key mode is on and no BYO
 * ElevenLabs route is available (Stage5 credits are not used in API key
 * mode). Same kinds as dubbing: both need ElevenLabs.
 */
export type ApiKeyModeTranscriptionBlocker = ApiKeyModeDubbingBlocker;

export function getApiKeyModeTranscriptionBlocker(state: {
  elevenLabsUnlocked: boolean;
  elevenLabsToggleEnabled: boolean;
  elevenLabsKeyPresent: boolean;
}): ApiKeyModeTranscriptionBlocker | null {
  return getApiKeyModeDubbingBlocker(state);
}

/** English messages main throws for each blocker (renderer shows i18n copy). */
export const API_KEY_MODE_TRANSCRIPTION_BLOCKER_MESSAGES: Record<
  ApiKeyModeTranscriptionBlocker,
  string
> = {
  'elevenlabs-not-unlocked':
    'Transcription uses ElevenLabs Scribe. BYO ElevenLabs is not unlocked for this account. Your OpenAI or Anthropic key is still used for translation. Turn off API key mode to transcribe with Stage5 credits, or unlock ElevenLabs BYO to continue.',
  'elevenlabs-disabled':
    'Transcription uses ElevenLabs Scribe. BYO ElevenLabs is disabled in Settings. Your OpenAI or Anthropic key is still used for translation. Enable ElevenLabs to transcribe with your own API keys, or turn off API key mode to transcribe with Stage5 credits.',
  'elevenlabs-key-missing':
    'Transcription uses ElevenLabs Scribe. Add an ElevenLabs API key in Settings to transcribe with your own API keys. Your OpenAI or Anthropic key is still used for translation. Or turn off API key mode to transcribe with Stage5 credits.',
};

/**
 * English text for transcription failures the app raises. Thrown as
 * `${code}: ${text}` so the renderer can localize by code while logs, agents
 * and any un-localized surface still read a clear sentence.
 */
export const TRANSCRIPTION_FAILURE_MESSAGES = {
  'transcription-provider-unavailable':
    'Transcription (ElevenLabs Scribe) is temporarily unavailable or could not be reached after several attempts. Please try again in a few minutes.',
  'elevenlabs-key-required':
    'Transcription uses ElevenLabs Scribe and needs an ElevenLabs API key. Add one in Settings, or turn off API key mode to transcribe with Stage5 credits. Your OpenAI or Anthropic key is still used for translation.',
} as const;

export type TranscriptionFailureCode =
  | keyof typeof TRANSCRIPTION_FAILURE_MESSAGES
  | 'transcription-file-too-large';

export function formatTranscriptionFailure(
  code: TranscriptionFailureCode,
  { maxHours }: { maxHours?: number } = {}
): string {
  if (code === 'transcription-file-too-large') {
    const limit =
      typeof maxHours === 'number' && maxHours > 0
        ? `about ${maxHours} hours`
        : 'the upload limit';
    return `${code}: This audio is too long to transcribe in one job (more than ${limit}). Split the video into shorter parts and transcribe each part.`;
  }
  return `${code}: ${TRANSCRIPTION_FAILURE_MESSAGES[code]}`;
}

/**
 * Map a Stage5 transcription error payload to an app error code, or null.
 * Transcription is ElevenLabs Scribe only: the server never falls back to
 * Whisper. Contract:
 *  - 402 (any body)                                   -> insufficient credits
 *  - 502 { error: 'transcription-provider-unavailable' } -> Scribe down after
 *    server retries
 *  - 400 { error: 'elevenlabs-key-required' }          -> BYO relay call with
 *    no ElevenLabs key
 * Older servers could still answer 'transcription-fallback-confirmation-required'
 * (a Whisper offer); it is treated as a plain failure with the same meaning.
 */
export function getStage5TranscriptionErrorCode(
  status: number | undefined,
  data: unknown
): string | null {
  if (status === 402) return ERROR_CODES.INSUFFICIENT_CREDITS;
  const payload =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const code = typeof payload.error === 'string' ? payload.error : '';
  if (code === ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE) {
    return ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE;
  }
  if (code === ERROR_CODES.ELEVENLABS_KEY_REQUIRED) {
    return ERROR_CODES.ELEVENLABS_KEY_REQUIRED;
  }
  if (code === 'transcription-fallback-confirmation-required') {
    return payload.reason === 'insufficient-credits'
      ? ERROR_CODES.INSUFFICIENT_CREDITS
      : ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE;
  }
  return null;
}
