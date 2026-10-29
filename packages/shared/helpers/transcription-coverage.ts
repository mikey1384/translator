import type { TranscriptionCoverage } from '@shared-types/app';

/** Audio processed by the provider, independent of the last spoken cue. */
export function normalizeTranscriptionCoverage(
  value: unknown
): TranscriptionCoverage | null {
  if (!value || typeof value !== 'object') return null;
  const { endSec, durationSec } = value as TranscriptionCoverage;
  if (
    !Number.isFinite(endSec) ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    endSec < 0 ||
    endSec > durationSec + 1
  )
    return null;
  return { endSec: Math.min(endSec, durationSec), durationSec };
}
