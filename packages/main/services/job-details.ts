import { AsyncLocalStorage } from 'node:async_hooks';
import {
  cleanJobDetails,
  type JobDetails,
} from '../../shared/helpers/job-details.js';
import { WIRE_JOB_DETAILS_HEADER } from '../../shared/constants/wire-protocol.js';

// A transcription or translation job fans out into many requests several
// layers below its handler. The handler states the job's details once and
// the Stage5 client reads them when it builds a credit request, so nothing
// in between has to carry them. Requests made outside a job (summaries,
// dubbing, single-line edits) see no details and send none.
const jobDetailsStorage = new AsyncLocalStorage<JobDetails>();

/** Runs `task` as one job; Stage5 credit requests inside it carry `details`. */
export function runWithJobDetails<T>(
  details: Parameters<typeof cleanJobDetails>[0],
  task: () => Promise<T>
): Promise<T> {
  const cleaned = cleanJobDetails(details);
  return cleaned ? jobDetailsStorage.run(cleaned, task) : task();
}

/**
 * Header for a Stage5 credit transcription or translation request. Only the
 * Stage5 client calls this, so own-key jobs, which never reach Stage5, never
 * send it.
 */
export function jobDetailsHeaders(): Record<string, string> {
  const details = jobDetailsStorage.getStore();
  return details ? { [WIRE_JOB_DETAILS_HEADER]: JSON.stringify(details) } : {};
}
