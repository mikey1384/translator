import {
  STAGE5_ELEVENLABS_SCRIBE_MODEL,
  STAGE5_TRANSCRIPTION_MODEL_PRICING,
  STAGE5_TTS_MODEL_ELEVEN_MULTILINGUAL,
  STAGE5_TTS_MODEL_PRICING,
  STAGE5_TTS_MODEL_STANDARD,
  type Stage5TranscriptionModelId,
  type Stage5TtsModelId,
} from './model-catalog';
import { SPOKEN_CHARS_PER_MINUTE } from './estimate-heuristics';

export const USD_PER_CREDIT = 10 / 350_000;
export const PRICE_MARGIN = 2;
export const PREVIEW_TTS_SAMPLE_CHARS = 5;

export function getTranscriptionCreditsPerSecond(
  model: Stage5TranscriptionModelId
): number {
  return (
    (STAGE5_TRANSCRIPTION_MODEL_PRICING[model].perSecond * PRICE_MARGIN) /
    USD_PER_CREDIT
  );
}

export function estimateTranscriptionCredits({
  seconds,
  model,
}: {
  seconds: number;
  model: Stage5TranscriptionModelId;
}): number {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  if (safeSeconds === 0) return 0;
  return Math.ceil(safeSeconds * getTranscriptionCreditsPerSecond(model));
}

export function getTtsCreditsPerCharacter(model: Stage5TtsModelId): number {
  return (
    (STAGE5_TTS_MODEL_PRICING[model].perChar * PRICE_MARGIN) / USD_PER_CREDIT
  );
}

export function estimateTtsCredits({
  characters,
  model,
}: {
  characters: number;
  model: Stage5TtsModelId;
}): number {
  const safeCharacters = Math.max(0, Math.ceil(Number(characters) || 0));
  if (safeCharacters === 0) return 0;
  return Math.ceil(safeCharacters * getTtsCreditsPerCharacter(model));
}

export const CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR =
  getTranscriptionCreditsPerSecond(STAGE5_ELEVENLABS_SCRIBE_MODEL) * 3600;

export const TTS_CREDITS_PER_MINUTE = {
  openai:
    getTtsCreditsPerCharacter(STAGE5_TTS_MODEL_STANDARD) *
    SPOKEN_CHARS_PER_MINUTE,
  elevenlabs:
    getTtsCreditsPerCharacter(STAGE5_TTS_MODEL_ELEVEN_MULTILINGUAL) *
    SPOKEN_CHARS_PER_MINUTE,
} as const;

export const PREVIEW_TTS_CREDITS = {
  openai: estimateTtsCredits({
    characters: PREVIEW_TTS_SAMPLE_CHARS,
    model: STAGE5_TTS_MODEL_STANDARD,
  }),
  elevenlabs: estimateTtsCredits({
    characters: PREVIEW_TTS_SAMPLE_CHARS,
    model: STAGE5_TTS_MODEL_ELEVEN_MULTILINGUAL,
  }),
} as const;
