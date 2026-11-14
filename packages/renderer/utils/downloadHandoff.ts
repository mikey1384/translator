import type { CreditBalanceState } from './creditBalanceState';
import type { VideoCost } from './freePreview';
import type { DownloadHandoff } from '../state/download-handoff-store';

/**
 * When the download handoff card shows. Pure, so the rules are testable:
 * only right after a link download, only for a video with no subtitles, and
 * never while anything else on screen already owns the next step.
 */
export function shouldShowDownloadHandoff(input: {
  handoff: DownloadHandoff | null | undefined;
  hasVideo: boolean;
  subtitleCount: number;
  /** A download, transcription, translation, dub or merge is running. */
  busy: boolean;
  /** A free-preview offer (open or dismissed) stands for this video. */
  previewStands: boolean;
  /** "Pick up where it stopped" for an interrupted job. */
  interrupted: boolean;
  /** The file can't be read, or its first probe hasn't finished. */
  unreadable: boolean;
  checking: boolean;
}): boolean {
  return (
    input.handoff?.status === 'ready' &&
    input.hasVideo &&
    input.subtitleCount === 0 &&
    !input.busy &&
    !input.previewStands &&
    !input.interrupted &&
    !input.unreadable &&
    !input.checking
  );
}

/**
 * What the card says about cost, built only from the figures the existing
 * cost helper (currentVideoCost / describeVideoCost) produces, so the card
 * and the free-preview offer that may follow never disagree.
 *
 * - covered: the balance covers the whole video
 * - preview: it covers the first N minutes (the run stops there and offers
 *   the rest, as it already does)
 * - offer: it covers under 45 s, so nothing runs; clicking shows the
 *   existing purchase offer
 * - unknown: API keys, or the balance isn't known yet
 */
export type HandoffCost =
  | { kind: 'unknown' }
  | { kind: 'covered'; free: boolean }
  | { kind: 'preview'; free: boolean; previewMinutes: number; price: number }
  | { kind: 'offer'; price: number; welcomePending: boolean };

const FREE_STATES: ReadonlySet<CreditBalanceState> = new Set([
  'free',
  'freeThisMonth',
]);

export function describeHandoffCost(
  cost: VideoCost | null,
  balanceState: CreditBalanceState
): HandoffCost {
  if (!cost) return { kind: 'unknown' };
  const free = FREE_STATES.has(balanceState);
  if (cost.kind === 'covered') return { kind: 'covered', free };
  if (cost.kind === 'preview') {
    return {
      kind: 'preview',
      free,
      previewMinutes: cost.previewMinutes,
      price: cost.wholeVideoPrice,
    };
  }
  return {
    kind: 'offer',
    price: cost.wholeVideoPrice,
    welcomePending: balanceState === 'welcomePending',
  };
}

/**
 * Which words the card's yellow button uses. "Free" only for minutes that
 * really are free (welcome or monthly); a partial run names how far it goes;
 * under 45 s of balance the button names the price of the whole video.
 */
export function handoffPrimaryLabel(
  cost: HandoffCost
): 'buy' | 'firstMinutesFree' | 'firstMinutes' | 'watch' {
  if (cost.kind === 'offer') return 'buy';
  if (cost.kind === 'preview')
    return cost.free ? 'firstMinutesFree' : 'firstMinutes';
  return 'watch';
}

/** "…/Movies/clip.mp4" → "Movies", the folder the user will recognise. */
export function savedFolderName(savedPath: string): string {
  const parts = savedPath.split(/[\\/]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : savedPath;
}
