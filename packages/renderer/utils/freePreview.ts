import { transcriptStopsEarlyAt } from './transcriptCoverage';
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
  // Translation runs after transcription, so what is left then must cover
  // the larger of its real cost and a single call's hold.
  return Math.ceil(
    (seconds + TRANSCRIPTION_HOLD_PAD_SEC) * r.transcribe +
      Math.max(seconds * r.translate, r.headroom)
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
  // Invert creditsToFinish: short spans are bounded by the hold, long ones
  // by the real translation cost.
  const afterPad = balance - TRANSCRIPTION_HOLD_PAD_SEC * r.transcribe;
  const holdBound = (afterPad - r.headroom) / r.transcribe;
  const costBound = afterPad / (r.transcribe + r.translate);
  const exact = costBound * r.translate >= r.headroom ? costBound : holdBound;
  const raw = exact * SAFETY;
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

/**
 * Covered, total and remaining whole minutes that add up (covered +
 * remaining = total) however the seconds round. Covered rounds down, like
 * the preview's own "first N min"; remaining is never zero while some is left.
 */
export function previewMinuteSplit({
  coveredSecs,
  durationSecs,
}: {
  coveredSecs: number;
  durationSecs: number;
}): { covered: number; total: number; remaining: number } {
  const coveredClamped = Math.min(
    Math.max(0, coveredSecs),
    Math.max(0, durationSecs)
  );
  const left = Math.max(0, durationSecs - coveredClamped);
  const covered =
    coveredClamped > 0 ? Math.max(1, Math.floor(coveredClamped / 60)) : 0;
  const total = Math.max(
    wholeMinutes(durationSecs),
    covered + (left > 0 ? 1 : 0)
  );
  return { covered, total, remaining: total - covered };
}

export type VideoCost =
  | { kind: 'covered' }
  | { kind: 'preview'; previewMinutes: number; wholeVideoPrice: number }
  | { kind: 'offer'; wholeVideoPrice: number };

/**
 * What subtitling a video of this length costs the user right now: covered
 * by their minutes, the first N minutes free then a pack, or a pack.
 */
export function describeVideoCost({
  durationSecs,
  credits,
  qualityEnabled,
}: {
  durationSecs: number;
  credits: number;
  qualityEnabled: boolean;
}): VideoCost {
  const plan = planFreePreview({ durationSecs, credits, qualityEnabled });
  if (plan.kind === 'full') return { kind: 'covered' };
  const covered = plan.kind === 'preview' ? plan.previewSecs : 0;
  // What is left after the preview spends its share of the balance.
  const leftover = Math.max(
    0,
    credits - (covered > 0 ? creditsToFinish(covered, qualityEnabled) : 0)
  );
  const { pack } = packToFinish({
    remainingSecs: durationSecs - covered,
    credits: leftover,
    qualityEnabled,
  });
  return plan.kind === 'preview'
    ? {
        kind: 'preview',
        previewMinutes: Math.max(1, Math.floor(covered / 60)),
        wholeVideoPrice: pack.price,
      }
    : { kind: 'offer', wholeVideoPrice: pack.price };
}

/**
 * Whether finishing a preview still has to transcribe the rest. After the
 * tail was transcribed once, a retry only translates, unless those lines
 * were lost (a restart before they were saved).
 */
export function needsTailTranscription({
  transcribedToEnd,
  durationSecs,
  lastEndSecs,
}: {
  transcribedToEnd?: boolean;
  durationSecs: number;
  lastEndSecs: number | null;
}): boolean {
  if (!transcribedToEnd) return true;
  return transcriptStopsEarlyAt({ durationSecs, lastEndSecs }) !== null;
}

/**
 * Which "nothing covered yet" line the offer shows. A device still waiting
 * for its welcome grant gets the same "on the way" state as the minutes pill
 * and Settings, never a monthly top-up date that doesn't apply to it yet.
 */
export function offerNoneBodyKind({
  balanceState,
  hasMonthlyFree,
}: {
  balanceState: string;
  hasMonthlyFree: boolean;
}): 'welcomePending' | 'nextFree' | 'plain' {
  if (balanceState === 'welcomePending') return 'welcomePending';
  return hasMonthlyFree ? 'nextFree' : 'plain';
}
