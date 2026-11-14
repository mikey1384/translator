/**
 * Anonymous daily counts for the path most new users take: a link on Home,
 * then the download handoff card in the workspace. Like every anonymous
 * count they are event names only (no URL, title, file, content, device id
 * or token); stage5-api stores per-day totals per name, platform and version.
 */

import type {
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
]);

const rendererEventSet = new Set<string>(RENDERER_HANDOFF_FUNNEL_EVENTS);

export function isRendererHandoffFunnelEvent(
  event: unknown
): event is (typeof RENDERER_HANDOFF_FUNNEL_EVENTS)[number] {
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
