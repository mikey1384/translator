/**
 * Stage5 transcription size limits. Transcription is ElevenLabs Scribe only:
 * small/short audio goes through the direct relay, larger audio through the
 * durable R2 upload flow, and anything over the R2 upload limit cannot be
 * transcribed in one job.
 */
import { ASR_FAST_MODE } from './runtime-config';

/** Direct relay stays under Cloudflare's 100MB request limit with a buffer. */
export const STAGE5_TRANSCRIPTION_DIRECT_MAX_MB = 95;
/** Scribe at ~8x realtime vs. the Worker subrequest timeout (see transcribe-pass). */
export const STAGE5_TRANSCRIPTION_DIRECT_MAX_DURATION_SEC = 160;
/** Durable R2 upload limit. */
export const STAGE5_TRANSCRIPTION_MAX_UPLOAD_MB = 500;

/**
 * Opus bitrate (kbps) of the audio the app extracts for Stage5 transcription
 * (mono 16 kHz speech). Main's ASR_OPUS_BITRATE is derived from this.
 */
export const STAGE5_TRANSCRIPTION_OPUS_KBPS = ASR_FAST_MODE ? 24 : 32;

/**
 * Hours of audio that fill the R2 upload limit at a given Opus bitrate,
 * rounded down. At 32 kbps: 500 MiB = 4,194,304,000 bits / 32,000 bps
 * = 131,072 s, about 36.4 hours.
 */
export function maxTranscriptionAudioHours(
  kbps: number = STAGE5_TRANSCRIPTION_OPUS_KBPS,
  maxUploadMb: number = STAGE5_TRANSCRIPTION_MAX_UPLOAD_MB
): number {
  if (!Number.isFinite(kbps) || kbps <= 0) return 0;
  const bits = maxUploadMb * 1024 * 1024 * 8;
  return Math.floor(bits / (kbps * 1000) / 3600);
}

export const STAGE5_TRANSCRIPTION_MAX_AUDIO_HOURS =
  maxTranscriptionAudioHours();
