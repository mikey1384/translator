import { CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR } from '../../shared/constants';
import { taskForOperationId } from './userFacingError';

/** The task the user started; the credits dialog is worded for it. */
export type CreditRefusalKind =
  | 'transcription'
  | 'translation'
  | 'dubbing'
  | 'summary'
  | 'videoSearch'
  | 'other';

// What was refused. Kept separate from the balance so the dialog can read the
// live, authoritative balance instead of a number frozen at refusal time.
export type CreditRefusal = {
  kind: CreditRefusalKind;
  // Audio length of a whole-file transcription. Null for partial runs
  // (single line, tail) and anything the app cannot measure.
  transcriptionSeconds: number | null;
};

export type CreditShortfall = {
  // Credits the task needs, when the app can estimate it. Null when only the
  // balance is known; the dialog then avoids quoting a requirement.
  requiredCredits: number | null;
  availableCredits: number;
};

const MAX_TRACKED_OPERATIONS = 50;
const fullTranscriptionSeconds = new Map<string, number>();

/**
 * Record the audio length of a whole-file transcription when it starts.
 * Only these runs may be quoted a cost; partial runs never register.
 */
export function registerFullTranscriptionSeconds(
  operationId: string,
  seconds: number | null | undefined
): void {
  if (!operationId) return;
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return;
  }
  fullTranscriptionSeconds.delete(operationId);
  fullTranscriptionSeconds.set(operationId, seconds);
  while (fullTranscriptionSeconds.size > MAX_TRACKED_OPERATIONS) {
    const oldest = fullTranscriptionSeconds.keys().next().value;
    if (oldest === undefined) break;
    fullTranscriptionSeconds.delete(oldest);
  }
}

export function creditRefusalKindForOperation(
  operationId: string | null | undefined
): CreditRefusalKind {
  const task = taskForOperationId(operationId);
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

export function creditRefusalForOperation(
  operationId: string | null | undefined
): CreditRefusal {
  const kind = creditRefusalKindForOperation(operationId);
  const seconds =
    kind === 'transcription' && operationId
      ? (fullTranscriptionSeconds.get(operationId) ?? null)
      : null;
  return { kind, transcriptionSeconds: seconds };
}

function knownPositiveCredits(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const floored = Math.floor(value);
  return floored > 0 ? floored : null;
}

/**
 * Describe why a task was refused for credits without claiming the balance
 * "ran out" when the user still has credits. Returns null when the balance is
 * zero or unknown (pass null for a cached, non-authoritative balance), which
 * keeps the original "ran out" wording.
 */
export function describeCreditShortfall({
  availableCredits,
  transcriptionSeconds,
}: {
  availableCredits: number | null | undefined;
  transcriptionSeconds?: number | null;
}): CreditShortfall | null {
  const available = knownPositiveCredits(availableCredits);
  if (available === null) return null;

  const seconds =
    typeof transcriptionSeconds === 'number' &&
    Number.isFinite(transcriptionSeconds) &&
    transcriptionSeconds > 0
      ? transcriptionSeconds
      : null;
  const estimate =
    seconds === null
      ? null
      : Math.ceil((seconds * CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR) / 3600);

  // An estimate at or under the balance cannot explain the refusal (the
  // server may have reserved more), so never quote a figure that contradicts it.
  return {
    requiredCredits:
      estimate !== null && estimate > available ? estimate : null,
    availableCredits: available,
  };
}

/**
 * Unit for describing what the $1 pack buys. Translation hours overstate
 * transcription and dubbing, so only translation refusals use them.
 */
export function creditOfferBasis(
  refusal: CreditRefusal | null
): 'transcription' | 'translation' | 'none' {
  if (refusal?.kind === 'transcription') return 'transcription';
  if (refusal?.kind === 'translation') return 'translation';
  return 'none';
}

/** Minutes of transcription the given credits cover, rounded down. */
export function transcriptionMinutesForCredits(credits: number): number {
  if (!Number.isFinite(credits) || credits <= 0) return 0;
  return Math.floor((credits / CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR) * 60);
}
