import {
  CREDITS_PER_TRANSLATION_AUDIO_HOUR,
  TRANSLATION_QUALITY_MULTIPLIER,
} from '../../shared/constants';

/**
 * Calculate how many hours of video can be translated with given credits
 */
export function estimateTranslatableHours(
  credits: number | null,
  qualityEnabled: boolean
): number | null {
  if (typeof credits !== 'number' || credits <= 0) return null;
  const multiplier = qualityEnabled ? TRANSLATION_QUALITY_MULTIPLIER : 1;
  return credits / (CREDITS_PER_TRANSLATION_AUDIO_HOUR * multiplier);
}

/**
 * Format hours into a readable string (e.g., "2h 30m" or "45m")
 * Used in settings page for detailed display
 */
export function formatHours(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return mins > 0 ? `${mins}m` : '<1m';
  }
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format minutes into compact time string
 * < 60 min: "45m", >= 60 min: "2h 30m"
 */
export function formatTime(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format credits into compact string (e.g., "~5k", "~134k")
 */
export function formatCredits(credits: number): string {
  if (credits < 1000) return `~${Math.ceil(credits)}`;
  if (credits < 10000) return `~${(credits / 1000).toFixed(1)}k`;
  return `~${Math.round(credits / 1000)}k`;
}
