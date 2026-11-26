/**
 * Anonymous daily counts for the path most new users take: a link on Home,
 * then the download handoff card in the workspace. Like every anonymous
 * count they are event names only (no URL, title, file, content, device id
 * or token); stage5-api stores per-day totals per name, platform and version.
 */

import type {
  FreePreviewDismissReasonEvent,
  HandoffFunnelEvent,
  ProductStartTrigger,
} from '@shared-types/app';

export type {
  HandoffFunnelEvent,
  ProductStartTrigger,
} from '@shared-types/app';

/** What the renderer may count. */
export const RENDERER_HANDOFF_FUNNEL_EVENTS = Object.freeze([
  'home_translate_clicked',
  'home_download_only_clicked',
  'download_handoff_shown',
  'download_handoff_clicked',
  'download_handoff_dismissed',
] as const satisfies readonly HandoffFunnelEvent[]);

/**
 * The one-tap answer to "What held you back?" after the free-preview offer
 * is dismissed. The renderer may count these too.
 */
export const FREE_PREVIEW_DISMISS_REASON_EVENTS = Object.freeze([
  'free_preview_dismiss_price',
  'free_preview_dismiss_quality',
  'free_preview_dismiss_enough',
  'free_preview_dismiss_trying',
  'free_preview_dismiss_download_only',
] as const satisfies readonly FreePreviewDismissReasonEvent[]);

/**
 * Counted by main when it refuses to open a checkout because the server
 * created it for a different number of packs than the offer showed. It
 * should stay at zero; anything else means the app and the API disagree.
 */
export const CHECKOUT_PACK_COUNT_MISMATCH = 'checkout_pack_count_mismatch';

/**
 * Counted by main when a validated `stage5-translator://open?url=...` deep
 * link (e.g. from the 1-click browser bookmarklet) pre-fills the URL input.
 */
export const BOOKMARKLET_URL_OPENED = 'bookmarklet_url_opened';

/**
 * Counted by main when the translation of a run started from the card
 * begins (the step that turns a download into subtitles).
 */
export const HANDOFF_TRANSLATION_STARTED =
  'download_handoff_translation_started';

/**
 * Names stage5-api's /usage/counts allow-list does not know before the
 * download-handoff server change. The server refuses a whole batch for one
 * unknown name, so these are always sent in a request of their own and kept
 * (up to the 14-day window) until the server accepts them; the established
 * counts are never put at risk by them.
 */
export const PROVISIONAL_USAGE_EVENTS: ReadonlySet<string> = new Set([
  ...RENDERER_HANDOFF_FUNNEL_EVENTS,
  HANDOFF_TRANSLATION_STARTED,
  ...FREE_PREVIEW_DISMISS_REASON_EVENTS,
  CHECKOUT_PACK_COUNT_MISMATCH,
  BOOKMARKLET_URL_OPENED,
]);

const rendererEventSet = new Set<string>([
  ...RENDERER_HANDOFF_FUNNEL_EVENTS,
  ...FREE_PREVIEW_DISMISS_REASON_EVENTS,
]);

/** True for a count the renderer may ask main to record. */
export function isRendererHandoffFunnelEvent(
  event: unknown
): event is
  | (typeof RENDERER_HANDOFF_FUNNEL_EVENTS)[number]
  | (typeof FREE_PREVIEW_DISMISS_REASON_EVENTS)[number] {
  return typeof event === 'string' && rendererEventSet.has(event);
}

/** The trigger a renderer put on a run's options, if it is a known one. */
export function parseStartTrigger(
  value: unknown
): ProductStartTrigger | undefined {
  return value === 'download_handoff' ? value : undefined;
}

/** The extra count for a translation that started from the card, if any. */
export function handoffTranslationStartEvent(trigger: unknown): string | null {
  return parseStartTrigger(trigger) ? HANDOFF_TRANSLATION_STARTED : null;
}
