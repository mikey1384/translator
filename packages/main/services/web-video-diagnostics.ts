import { randomUUID } from 'node:crypto';

type Event =
  | 'discovery_started'
  | 'page_probe_finished'
  | 'browser_opened'
  | 'manifest_observed'
  | 'manifest_checked'
  | 'blob_observed'
  | 'frames_observed'
  | 'candidate_added'
  | 'picker_opened'
  | 'selection_confirmed'
  | 'transfer_started'
  | 'browser_closed'
  | 'discovery_finished';
type Details = {
  count?: number;
  attempt?: number;
  httpStatus?: number;
  kind?: 'hls' | 'dash' | 'file' | 'embed' | 'blob';
  outcome?:
    | 'ok'
    | 'cancelled'
    | 'released'
    | 'failed'
    | 'http_error'
    | 'timeout'
    | 'network_error'
    | 'request_blocked'
    | 'too_large'
    | 'invalid'
    | 'protected'
    | 'live'
    | 'master'
    | 'vod'
    | 'browser_required';
};
export type WebVideoDiagnostics = (event: Event, details?: Details) => void;

/** Local diagnostics only. Never accept URLs, titles, headers or raw errors. */
export function createWebVideoDiagnostics(
  write: (entry: Record<string, string | number>) => void
): WebVideoDiagnostics {
  const trace = randomUUID();
  const started = Date.now();
  let entries = 0;
  return (event, details = {}) => {
    if (
      ++entries > 160 &&
      ![
        'selection_confirmed',
        'transfer_started',
        'browser_closed',
        'discovery_finished',
      ].includes(event)
    )
      return;
    const entry: Record<string, string | number> = {
      trace,
      event,
      elapsedMs: Date.now() - started,
    };
    for (const key of ['count', 'attempt', 'httpStatus'] as const) {
      const value = details[key];
      if (typeof value === 'number' && Number.isFinite(value))
        entry[key] = Math.max(0, Math.min(1_000_000, Math.floor(value)));
    }
    if (['hls', 'dash', 'file', 'embed', 'blob'].includes(details.kind || ''))
      entry.kind = details.kind!;
    if (
      [
        'ok',
        'cancelled',
        'released',
        'failed',
        'http_error',
        'timeout',
        'network_error',
        'request_blocked',
        'too_large',
        'invalid',
        'protected',
        'live',
        'master',
        'vod',
        'browser_required',
      ].includes(details.outcome || '')
    )
      entry.outcome = details.outcome!;
    write(entry);
  };
}

export function manifestFailureOutcome(error: unknown): Details['outcome'] {
  const value = error instanceof Error ? error : undefined;
  if (value?.name === 'TimeoutError') return 'timeout';
  if (value?.name === 'AbortError') return 'cancelled';
  if (value?.message === 'net::ERR_BLOCKED_BY_CLIENT') return 'request_blocked';
  return 'network_error';
}
