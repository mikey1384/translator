// Feature flags shared between main/renderer.
// Keep these stable so we don't accidentally ship hidden/expensive behavior.

/**
 * Voice cloning (ElevenLabs Dubbing API / Stage5 voice-clone flow).
 *
 * This is intentionally disabled in production for now: the UI does not expose
 * controls for it, and we must not allow it to run silently due to persisted
 * localStorage state.
 */
export const ENABLE_VOICE_CLONING = false as const;

