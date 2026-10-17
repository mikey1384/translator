import { i18n } from '../i18n';
import { resolveTaskFailure } from './taskFailure';
import {
  classifyError,
  formatUserFacingError,
  stripIpcErrorPrefix,
  taskForOperationId,
  type ErrorTask,
} from './userFacingError';

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, options as any) as string;

/** Localized text for a failed or stopped translation. Pure: no dialogs. */
export function getTranslationFailureMessage({
  error,
  cancelled,
  task = 'translation',
}: {
  error?: string;
  cancelled?: boolean;
  task?: ErrorTask;
}): string {
  const message = stripIpcErrorPrefix(error);
  if (!message) {
    return cancelled
      ? t('generateSubtitles.status.cancelled')
      : formatUserFacingError(classifyError('', { task }), t);
  }
  return formatUserFacingError(classifyError(message, { task }), t);
}

/**
 * Whether the failure needs a banner. Credit refusals are explained by the
 * credits dialog, and a plain cancel needs no message.
 */
export function shouldSurfaceTranslationFailure({
  error,
  cancelled,
}: {
  error?: string;
  cancelled?: boolean;
}): boolean {
  const message = stripIpcErrorPrefix(error);
  if (!message) return !cancelled;
  const kind = classifyError(message, { task: 'translation' }).kind;
  return kind !== 'insufficient-credits' && kind !== 'cancelled';
}

/**
 * Shared failure handling for a translation result or throw: opens the
 * credits or report dialog when needed and returns the stage/banner text.
 */
export function resolveTranslationFailure(options: {
  error?: unknown;
  cancelled?: boolean;
  operationId?: string | null;
  task?: ErrorTask;
}): { stage: string; banner: string | null; creditsRefused: boolean } {
  const task =
    options.task ??
    (options.operationId ? taskForOperationId(options.operationId) : null);
  return resolveTaskFailure({
    ...options,
    task: !task || task === 'other' ? 'translation' : task,
  });
}
