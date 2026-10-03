// Transcription routing lives in shared so the renderer uses the same rules.
export {
  API_KEY_MODE_TRANSCRIPTION_BLOCKER_MESSAGES,
  getApiKeyModeTranscriptionBlocker,
  resolveTranscriptionRoute,
  type ApiKeyModeTranscriptionBlocker,
  type TranscriptionRoute,
} from '../../shared/helpers/transcription-route.js';
