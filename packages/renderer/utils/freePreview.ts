import {
  CREDIT_PACKS,
  CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR,
} from '../../shared/constants';
import { estimateTranslationCreditsPerHour } from './creditEstimates';

type Pack = (typeof CREDIT_PACKS)[keyof typeof CREDIT_PACKS];

// The server holds transcription for the audio length plus two seconds.
const TRANSCRIPTION_HOLD_PAD_SEC = 2;
// Translation calls hold more than they settle. Haiku drafts hold ~300
// credits per call at most (production, Oct 2026); quality review on Opus
// holds up to ~48k. Keep that much free so the preview's own translation is
// never refused.
const DRAFT_TRANSLATION_HOLD_HEADROOM = 600;
const QUALITY_TRANSLATION_HOLD_HEADROOM = 50_000;
// Below this a preview is not worth watching; offer the whole video instead.
export const MIN_PREVIEW_SEC = 45;
const PREVIEW_STEP_SEC = 15;
const SAFETY = 0.95;

export type FreePreviewPlan =
  | { kind: 'full' }
  | { kind: 'preview'; previewSecs: number }
  | { kind: 'none' };

function rates(qualityEnabled: boolean) {
  const transcribe = CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR / 3600;
  const translate = estimateTranslationCreditsPerHour(qualityEnabled) / 3600;
  const headroom = qualityEnabled
    ? QUALITY_TRANSLATION_HOLD_HEADROOM
    : DRAFT_TRANSLATION_HOLD_HEADROOM;
  return { transcribe, translate, headroom };
}

/** Credits to transcribe and translate `seconds` of video, holds included. */
export function creditsToFinish(
  seconds: number,
  qualityEnabled: boolean
): number {
  if (!(seconds > 0)) return 0;
  const r = rates(qualityEnabled);
  return Math.ceil(
    (seconds + TRANSCRIPTION_HOLD_PAD_SEC) * r.transcribe +
      seconds * r.translate +
      r.headroom
  );
}

/**
 * Whole video, the opening minutes the balance covers, or nothing at all.
 * Only for Stage5 credit mode with an authoritative balance.
 */
export function planFreePreview({
  durationSecs,
  credits,
  qualityEnabled,
}: {
  durationSecs: number;
  credits: number;
  qualityEnabled: boolean;
}): FreePreviewPlan {
  if (!(durationSecs > 0)) return { kind: 'full' };
  const balance = Math.max(0, Math.floor(credits));
  if (balance >= creditsToFinish(durationSecs, qualityEnabled)) {
    return { kind: 'full' };
  }
  const r = rates(qualityEnabled);
  const usable =
    balance - r.headroom - TRANSCRIPTION_HOLD_PAD_SEC * r.transcribe;
  const raw = (usable / (r.transcribe + r.translate)) * SAFETY;
  const previewSecs =
    Math.floor(Math.min(raw, durationSecs) / PREVIEW_STEP_SEC) *
    PREVIEW_STEP_SEC;
  if (previewSecs < MIN_PREVIEW_SEC) return { kind: 'none' };
  return { kind: 'preview', previewSecs };
}

/**
 * The smallest pack that, with what is left, finishes the remaining seconds.
 * Falls back to the largest pack for very long videos.
 */
export function packToFinish({
  remainingSecs,
  credits,
  qualityEnabled,
}: {
  remainingSecs: number;
  credits: number;
  qualityEnabled: boolean;
}): { pack: Pack; coversAll: boolean } {
  const needed = creditsToFinish(remainingSecs, qualityEnabled);
  const have = Math.max(0, Math.floor(credits));
  const packs: Pack[] = [
    CREDIT_PACKS.MICRO,
    CREDIT_PACKS.STARTER,
    CREDIT_PACKS.STANDARD,
    CREDIT_PACKS.PRO,
  ];
  for (const pack of packs) {
    if (have + pack.credits >= needed) return { pack, coversAll: true };
  }
  return { pack: CREDIT_PACKS.PRO, coversAll: false };
}

/** "4" or "28": whole minutes for copy, never zero for a non-empty span. */
export function wholeMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}
