import { classifyError } from './userFacingError';

const CANCEL_OR_ABORT_RE =
  /\b(cancel(?:led|ed|ation)?|abort(?:error|ed|ing)?)\b/i;
const RESOURCE_TAGS = new Set([
  'img',
  'image',
  'script',
  'link',
  'audio',
  'video',
  'source',
  'track',
  'iframe',
]);

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim();
}

/**
 * Task failures are routed by utils/taskFailure.ts. These helpers only cover
 * crashes outside any task: window errors and stray promise rejections.
 */

/**
 * A stray rejection opens the report dialog only when it is a real crash; an
 * unhandled credits, network or API-key refusal already has its own message.
 */
export function shouldReportUnhandledRejection(reason: unknown): boolean {
  if (isAbortLikeReason(reason)) return false;
  return classifyError(reason as any).kind === 'unexpected';
}

export function isAbortLikeReason(reason: unknown): boolean {
  if (!reason) return false;
  const asAny = reason as any;
  const name = normalizeText(asAny?.name);
  const message =
    typeof reason === 'string'
      ? reason
      : normalizeText(asAny?.message || String(reason));
  return CANCEL_OR_ABORT_RE.test(name) || CANCEL_OR_ABORT_RE.test(message);
}

export function shouldIgnoreGlobalBrowserError(event: Event): boolean {
  if (!(event instanceof ErrorEvent)) {
    // Resource load errors (img/script/link/etc) are emitted as generic Event.
    return true;
  }

  const message = normalizeText(event.message).toLowerCase();
  if (message.includes('resizeobserver')) return true;

  const hasRuntimeDetails = Boolean(message || event.error || event.filename);
  if (!hasRuntimeDetails) return true;

  const target = event.target as any;
  const isWindowTarget = typeof window !== 'undefined' && target === window;
  const isDocumentTarget =
    typeof document !== 'undefined' && target === document;
  const tagName = normalizeText(target?.tagName).toLowerCase();

  if (!isWindowTarget && !isDocumentTarget && RESOURCE_TAGS.has(tagName)) {
    return true;
  }

  return false;
}
