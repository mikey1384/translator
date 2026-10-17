import { i18n } from '../i18n';
import { openCreditRanOut, openErrorReportPrompt } from '../state/modal-store';
import { useModalStore } from '../state/modal-store';
import {
  creditRefusalForOperation,
  type CreditRefusal,
  type CreditRefusalKind,
} from './creditShortfall';
import {
  classifyError,
  formatUserFacingError,
  taskForOperationId,
  type ErrorInput,
  type ErrorTask,
  type UserFacingError,
} from './userFacingError';

/**
 * The single place a failed task turns into what the user sees next:
 * - not enough credits: the credits dialog, worded for the task, never a
 *   retry and never the report dialog;
 * - genuinely unexpected: the report dialog, saying what failed;
 * - everything else: nothing here; the caller shows `message`.
 */

const CREDIT_PROMPT_DEDUPE_MS = 4_000;
let lastCreditPrompt: { kind: CreditRefusalKind; at: number } | null = null;

export type ReportedFailure = {
  task: ErrorTask;
  kind: UserFacingError['kind'];
  code: string | null;
  detail: string;
  at: string;
};
let lastReportedFailure: ReportedFailure | null = null;

/** The latest failure the report dialog was opened for (for the report). */
export function getLastReportedFailure(): ReportedFailure | null {
  return lastReportedFailure;
}

function refusalKindForTask(task: ErrorTask): CreditRefusalKind {
  switch (task) {
    case 'transcription':
    case 'translation':
    case 'dubbing':
    case 'summary':
    case 'videoSearch':
      return task;
    default:
      return 'other';
  }
}

/**
 * Open the credits dialog for a refused task. The same refusal often arrives
 * twice (the final progress packet and the IPC result), so repeats within a
 * few seconds are dropped; a vague "other" refusal is upgraded in place.
 */
export function notifyInsufficientCredits(refusal: CreditRefusal): void {
  const now = Date.now();
  const modal = useModalStore.getState();
  if (modal.creditRanOutOpen) {
    if (modal.creditRefusal?.kind === 'other' && refusal.kind !== 'other') {
      useModalStore.setState({ creditRefusal: refusal });
    }
    lastCreditPrompt = { kind: refusal.kind, at: now };
    return;
  }
  if (
    lastCreditPrompt &&
    now - lastCreditPrompt.at < CREDIT_PROMPT_DEDUPE_MS &&
    (lastCreditPrompt.kind === refusal.kind || refusal.kind === 'other')
  ) {
    return;
  }
  lastCreditPrompt = { kind: refusal.kind, at: now };
  void openCreditRanOut(refusal);
}

/** Open the report dialog worded for the failed task. */
export function reportUnexpectedFailure(error: UserFacingError): void {
  lastReportedFailure = {
    task: error.task,
    kind: error.kind,
    code: error.code,
    detail: error.detail.slice(0, 500),
    at: new Date().toISOString(),
  };
  openErrorReportPrompt(`__i18n__:logs.reportPromptTask.${error.task}`);
}

export type HandledTaskFailure = UserFacingError & {
  /** Localized text for a banner or stage; empty when nothing should show. */
  message: string;
};

/**
 * Classify a failure and run its side effect. Returns the localized message
 * the caller should show, which is empty for credit refusals (the dialog
 * says it) and cancellations.
 */
export function handleTaskFailure(
  input: ErrorInput,
  options: {
    task?: ErrorTask;
    operationId?: string | null;
    /** Set false when the caller reports failures its own way. */
    autoReport?: boolean;
  } = {}
): HandledTaskFailure {
  const task =
    options.task ??
    (options.operationId ? taskForOperationId(options.operationId) : 'other');
  const error = classifyError(input, { task });

  if (error.kind === 'insufficient-credits') {
    const fromOperation = options.operationId
      ? creditRefusalForOperation(options.operationId)
      : null;
    notifyInsufficientCredits({
      kind:
        fromOperation && fromOperation.kind !== 'other'
          ? fromOperation.kind
          : refusalKindForTask(task),
      transcriptionSeconds: fromOperation?.transcriptionSeconds ?? null,
    });
    return { ...error, message: '' };
  }
  if (error.kind === 'cancelled') {
    return { ...error, message: '' };
  }
  if (error.report === 'auto' && options.autoReport !== false) {
    reportUnexpectedFailure(error);
  }
  return {
    ...error,
    message: formatUserFacingError(error, i18n.t.bind(i18n) as any),
  };
}

export type ResolvedTaskFailure = {
  /** Localized text for the task's progress stage. */
  stage: string;
  /** Localized text for the global banner, or null when none should show. */
  banner: string | null;
  creditsRefused: boolean;
  cancelled: boolean;
};

/**
 * `handleTaskFailure` for a task result (`{ success: false, error, cancelled }`)
 * or a thrown error, returning what the progress stage and banner show.
 */
export function resolveTaskFailure({
  error,
  cancelled,
  operationId,
  task,
}: {
  error?: unknown;
  cancelled?: boolean;
  operationId?: string | null;
  /** Defaults to the operation's task (a dub's pre-translation is dubbing). */
  task?: ErrorTask;
}): ResolvedTaskFailure {
  const resolvedTask =
    task ?? (operationId ? taskForOperationId(operationId) : 'other');
  const t = i18n.t.bind(i18n) as any;
  const input: ErrorInput =
    error instanceof Error
      ? error
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object'
          ? (error as ErrorInput)
          : null;
  const hasReason =
    input instanceof Error ||
    (typeof input === 'string' && input.trim().length > 0) ||
    (input !== null && typeof input === 'object');
  if (!hasReason && cancelled) {
    return {
      stage: t('generateSubtitles.status.cancelled'),
      banner: null,
      creditsRefused: false,
      cancelled: true,
    };
  }
  const handled = handleTaskFailure(input, {
    task: resolvedTask,
    operationId,
  });
  if (handled.kind === 'insufficient-credits') {
    return {
      stage: formatUserFacingError(handled, t),
      banner: null,
      creditsRefused: true,
      cancelled: false,
    };
  }
  if (handled.kind === 'cancelled') {
    return {
      stage: t('generateSubtitles.status.cancelled'),
      banner: null,
      creditsRefused: false,
      cancelled: true,
    };
  }
  return {
    stage: handled.message,
    banner: handled.message,
    creditsRefused: false,
    cancelled: false,
  };
}

/**
 * Localized text for a failed link download, from main's `errorCode` when
 * present (otherwise its English message). With `report`, an unexplained
 * failure also opens the report dialog; pass it once per failure.
 */
export function describeDownloadFailure({
  error,
  errorCode,
  report = false,
}: {
  error?: string | null;
  errorCode?: string | null;
  report?: boolean;
}): string {
  const input = { error: error ?? '', errorCode: errorCode ?? undefined };
  if (report) {
    return handleTaskFailure(input, { task: 'download' }).message;
  }
  return formatUserFacingError(
    classifyError(input, { task: 'download' }),
    i18n.t.bind(i18n) as any
  );
}

/**
 * For flows that show their own inline error: open the credits dialog when
 * the failure was a credit refusal. Returns whether it was one.
 */
export function notifyIfCreditsRefused(
  input: ErrorInput,
  task: ErrorTask
): boolean {
  if (classifyError(input, { task }).kind !== 'insufficient-credits') {
    return false;
  }
  notifyInsufficientCredits({
    kind: refusalKindForTask(task),
    transcriptionSeconds: null,
  });
  return true;
}
