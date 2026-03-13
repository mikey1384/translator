import axios from 'axios';
import { BrowserWindow } from 'electron';
import Store from 'electron-store';
import crypto from 'crypto';
import fs from 'fs';
import FormData from 'form-data';
import path from 'path';
import {
  AI_MODELS,
  ERROR_CODES,
  API_TIMEOUTS,
  normalizeAiModelId,
} from '../../shared/constants/index.js';
import { formatElevenLabsTimeRemaining } from './subtitle-processing/utils.js';
import { createAbortableReadStream } from '../utils/abortable-file-stream.js';
import {
  withStage5AuthRetry,
  withStage5AuthRetryOnResponse,
} from './stage5-auth.js';
import { RELAY_URL, STAGE5_API_URL } from './endpoints.js';
import {
  throwIfStage5UpdateRequiredError,
  throwIfStage5UpdateRequiredResponse,
} from './stage5-version-gate.js';
import {
  getRelayErrorMessage,
  getRelayStatus,
  shouldRetryDubDirectRequest,
} from './stage5-client-retry.js';

export { STAGE5_API_URL, RELAY_URL };
export {
  isRetryableDubDirectError,
  shouldRetryDubDirectRequest,
} from './stage5-client-retry.js';

type DurableTranscriptionResumeRecord = {
  jobId: string;
  recoveryKey: string;
  createdAt?: string;
  updatedAt: string;
};

// Match the current stage5-api durable job cleanup window.
const DURABLE_TRANSCRIPTION_RESUME_TTL_MS = 24 * 60 * 60 * 1_000;
const DURABLE_TRANSCRIPTION_DETACHED_CODE = 'DURABLE_TRANSCRIPTION_DETACHED';
const DURABLE_TRANSCRIPTION_RESTART_REQUIRED_CODE =
  'DURABLE_TRANSCRIPTION_RESTART_REQUIRED';
const DURABLE_TRANSCRIPTION_TRANSIENT_DETACHABLE_STATUSES = new Set([
  408, 425, 429, 500, 502, 503, 504, 522, 524,
]);
const DURABLE_TRANSCRIPTION_TRANSIENT_DETACHABLE_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_NETWORK',
  'ETIMEDOUT',
]);
const DURABLE_TRANSCRIPTION_TRANSIENT_DETACHABLE_MESSAGE_PATTERN =
  /(timeout|timed out|temporarily unavailable|connection reset|fetch failed|gateway|rate limit|socket hang up|network)/i;

const durableTranscriptionStore = new Store<{
  jobs: Record<string, DurableTranscriptionResumeRecord>;
}>({
  name: 'durable-transcription-jobs',
  defaults: {
    jobs: {},
  },
});

class DurableTranscriptionDetachedError extends Error {
  readonly code = DURABLE_TRANSCRIPTION_DETACHED_CODE;
  readonly jobId: string;

  constructor(jobId: string, message: string) {
    super(message);
    this.name = 'DurableTranscriptionDetachedError';
    this.jobId = jobId;
  }
}

class DurableTranscriptionRestartRequiredError extends Error {
  readonly code = DURABLE_TRANSCRIPTION_RESTART_REQUIRED_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'DurableTranscriptionRestartRequiredError';
  }
}

function pruneDurableTranscriptionResumeJobs(): Record<
  string,
  DurableTranscriptionResumeRecord
> {
  const now = Date.now();
  const jobs = durableTranscriptionStore.get('jobs', {});
  const nextJobs = Object.fromEntries(
    Object.entries(jobs).filter(([, job]) => {
      const anchorMs = Date.parse(
        String(job?.createdAt || job?.updatedAt || '')
      );
      return Number.isFinite(anchorMs)
        ? now - anchorMs <= DURABLE_TRANSCRIPTION_RESUME_TTL_MS
        : false;
    })
  );

  if (Object.keys(nextJobs).length !== Object.keys(jobs).length) {
    durableTranscriptionStore.set('jobs', nextJobs);
  }

  return nextJobs;
}

function getDurableTranscriptionResumeJob(
  recoveryKey?: string
): DurableTranscriptionResumeRecord | null {
  const normalizedKey = String(recoveryKey || '').trim();
  if (!normalizedKey) return null;
  const jobs = pruneDurableTranscriptionResumeJobs();
  return jobs[normalizedKey] ?? null;
}

function setDurableTranscriptionResumeJob({
  recoveryKey,
  jobId,
}: {
  recoveryKey?: string;
  jobId: string;
}): void {
  const normalizedKey = String(recoveryKey || '').trim();
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedKey || !normalizedJobId) return;
  const jobs = pruneDurableTranscriptionResumeJobs();
  const existingJob = jobs[normalizedKey];
  const nowIso = new Date().toISOString();
  const createdAt =
    typeof existingJob?.createdAt === 'string' && existingJob.createdAt.trim()
      ? existingJob.createdAt
      : typeof existingJob?.updatedAt === 'string' &&
          existingJob.updatedAt.trim()
        ? existingJob.updatedAt
        : nowIso;
  durableTranscriptionStore.set('jobs', {
    ...jobs,
    [normalizedKey]: {
      recoveryKey: normalizedKey,
      jobId: normalizedJobId,
      createdAt,
      updatedAt: nowIso,
    },
  });
}

function clearDurableTranscriptionResumeJob(recoveryKey?: string): void {
  const normalizedKey = String(recoveryKey || '').trim();
  if (!normalizedKey) return;
  const jobs = pruneDurableTranscriptionResumeJobs();
  if (!(normalizedKey in jobs)) return;
  const nextJobs = { ...jobs };
  delete nextJobs[normalizedKey];
  durableTranscriptionStore.set('jobs', nextJobs);
}

function buildDetachedDurableTranscriptionMessage(jobId: string): string {
  return `Durable transcription is still running on Stage5 (job ${jobId}). Start the same file again to reconnect.`;
}

function shouldDetachDurableTranscriptionForTransientError(error: any): boolean {
  const status = getRelayStatus(error);
  if (status != null) {
    if (status >= 200 && status < 400) {
      return false;
    }
    if (DURABLE_TRANSCRIPTION_TRANSIENT_DETACHABLE_STATUSES.has(status)) {
      return true;
    }
  }

  const code = String(error?.code ?? '').toUpperCase();
  if (code && DURABLE_TRANSCRIPTION_TRANSIENT_DETACHABLE_CODES.has(code)) {
    return true;
  }

  const message = getRelayErrorMessage(error) || String(error?.message ?? '');
  if (DURABLE_TRANSCRIPTION_TRANSIENT_DETACHABLE_MESSAGE_PATTERN.test(message)) {
    return true;
  }

  return Boolean(error?.request) && !error?.response;
}

function sendNetLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: any
) {
  try {
    const payload = { level, kind: 'network', message, meta };
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('app:log', payload)
    );
  } catch {
    // Do nothing
  }
}

async function waitForAbortableDelay(
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  if (delayMs <= 0) return;
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Operation cancelled', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForDubDirectRetry(
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  await waitForAbortableDelay(delayMs, signal);
}

function resolveTranscriptionUploadContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.mp4':
      return 'video/mp4';
    case '.flac':
      return 'audio/flac';
    case '.ogg':
      return 'audio/ogg';
    case '.opus':
      return 'audio/ogg';
    case '.aac':
      return 'audio/aac';
    case '.webm':
      return 'audio/webm';
    default:
      return 'application/octet-stream';
  }
}

function getR2TranscriptionMaxWaitMs(
  estimatedTranscriptionSec: number
): number {
  return Math.max(
    API_TIMEOUTS.TRANSCRIPTION_MAX_WAIT,
    15 * 60 * 1_000,
    Math.ceil(Math.max(estimatedTranscriptionSec, 0) * 4 * 1_000)
  );
}

function buildDurableTranscriptionRecoveryKey({
  recoverySeed,
  sourcePath,
  language,
  durationSec,
}: {
  recoverySeed?: string;
  sourcePath?: string;
  language?: string;
  durationSec?: number;
}): string | undefined {
  const normalizedRecoverySeed = String(recoverySeed || '').trim();
  const normalizedSourcePath = String(sourcePath || '').trim();
  let sourcePathIdentity = '';
  if (normalizedSourcePath) {
    const resolvedSourcePath = path.resolve(normalizedSourcePath);
    try {
      const sourceStats = fs.statSync(resolvedSourcePath);
      sourcePathIdentity = [
        resolvedSourcePath,
        String(sourceStats.size),
        String(Math.round(sourceStats.mtimeMs)),
      ].join('\n');
    } catch {
      sourcePathIdentity = resolvedSourcePath;
    }
  }
  const recoveryIdentity = normalizedRecoverySeed
    ? normalizedRecoverySeed
    : sourcePathIdentity
      ? sourcePathIdentity
      : '';
  if (!recoveryIdentity) return undefined;
  return crypto
    .createHash('sha256')
    .update(
      `durable-transcription-recovery-v1\n${recoveryIdentity}\n${language || ''}\n${
        typeof durationSec === 'number' && Number.isFinite(durationSec)
          ? Math.round(durationSec)
          : ''
      }`
    )
    .digest('hex');
}

function buildDurableTranscriptionRequestIdempotencyKey({
  recoveryKey,
  fallbackIdempotencyKey,
}: {
  recoveryKey?: string;
  fallbackIdempotencyKey?: string;
}): string | undefined {
  const normalizedRecoveryKey = String(recoveryKey || '').trim();
  if (normalizedRecoveryKey) {
    return `durable-transcription-request-v1:${normalizedRecoveryKey}`;
  }
  const normalizedFallback = String(fallbackIdempotencyKey || '').trim();
  return normalizedFallback || undefined;
}

async function fetchDurableTranscriptionStatus({
  jobId,
  signal,
}: {
  jobId: string;
  signal?: AbortSignal;
}) {
  const statusResponse = await withStage5AuthRetryOnResponse(authHeaders =>
    axios.get(`${STAGE5_API_URL}/transcribe/status/${jobId}`, {
      headers: authHeaders,
      signal,
      validateStatus: () => true,
    })
  );
  throwIfStage5UpdateRequiredResponse({
    response: statusResponse,
    source: 'stage5-api',
  });

  sendNetLog('info', `GET /transcribe/status/${jobId} -> ${statusResponse.status}`, {
    url: `${STAGE5_API_URL}/transcribe/status/${jobId}`,
    method: 'GET',
    status: statusResponse.status,
  });

  return statusResponse;
}

async function startDurableTranscriptionJob({
  jobId,
  idempotencyKey,
  signal,
}: {
  jobId: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<{ httpStatus: number; durableStatus: string }> {
  const processResponse = await withStage5AuthRetryOnResponse(authHeaders =>
    axios.post(
      `${STAGE5_API_URL}/transcribe/process/${jobId}`,
      {},
      {
        headers: {
          ...authHeaders,
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        signal,
        validateStatus: () => true,
      }
    )
  );
  throwIfStage5UpdateRequiredResponse({
    response: processResponse,
    source: 'stage5-api',
  });

  sendNetLog('info', `POST /transcribe/process/${jobId} -> ${processResponse.status}`, {
    url: `${STAGE5_API_URL}/transcribe/process/${jobId}`,
    method: 'POST',
    status: processResponse.status,
  });

  if (processResponse.status === 402) {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }

  const processStatus = processResponse.data?.status;
  const processAccepted =
    processResponse.status === 200 ||
    ((processResponse.status === 400 || processResponse.status === 409) &&
      (processStatus === 'processing' || processStatus === 'completed'));
  if (!processAccepted) {
    throw new Error(
      processResponse.data?.message || 'Failed to start durable transcription'
    );
  }

  return {
    httpStatus: processResponse.status,
    durableStatus: String(processStatus || ''),
  };
}

async function resumeDurableTranscriptionJob({
  jobId,
  idempotencyKey,
  signal,
  onProgress,
  estimatedTranscriptionSec,
  maxWaitMs,
  recoveryKey,
}: {
  jobId: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  onProgress?: (stage: string, percent?: number) => void;
  estimatedTranscriptionSec: number;
  maxWaitMs: number;
  recoveryKey?: string;
}): Promise<any> {
  const statusResponse = await fetchDurableTranscriptionStatus({
    jobId,
    signal,
  });

  if (statusResponse.status === 404) {
    clearDurableTranscriptionResumeJob(recoveryKey);
    throw new Error('transcription-job-not-found');
  }

  if (statusResponse.status !== 200) {
    throw new Error(
      statusResponse.data?.message ||
        `Failed to read durable transcription status (${statusResponse.status})`
    );
  }

  const jobStatus = String(statusResponse.data?.status || '');
  if (jobStatus === 'completed') {
    clearDurableTranscriptionResumeJob(recoveryKey);
    onProgress?.('Transcription complete!', 100);
    return statusResponse.data?.result;
  }

  if (jobStatus === 'failed') {
    clearDurableTranscriptionResumeJob(recoveryKey);
    throw new DurableTranscriptionRestartRequiredError(
      statusResponse.data?.error || 'Transcription failed'
    );
  }

  if (jobStatus === 'pending_upload') {
    onProgress?.('Restarting durable transcription...', 35);
    const startResult = await startDurableTranscriptionJob({
      jobId,
      idempotencyKey,
      signal,
    });
    if (
      startResult.httpStatus !== 200 &&
      startResult.durableStatus === 'processing'
    ) {
      const confirmedStatusResponse = await fetchDurableTranscriptionStatus({
        jobId,
        signal,
      });

      if (confirmedStatusResponse.status === 404) {
        clearDurableTranscriptionResumeJob(recoveryKey);
        throw new Error('transcription-job-not-found');
      }
      if (confirmedStatusResponse.status !== 200) {
        throw new Error(
          confirmedStatusResponse.data?.message ||
            `Failed to read durable transcription status (${confirmedStatusResponse.status})`
        );
      }

      const confirmedStatus = String(
        confirmedStatusResponse.data?.status || ''
      );
      if (confirmedStatus === 'completed') {
        clearDurableTranscriptionResumeJob(recoveryKey);
        onProgress?.('Transcription complete!', 100);
        return confirmedStatusResponse.data?.result;
      }
      if (confirmedStatus === 'failed') {
        clearDurableTranscriptionResumeJob(recoveryKey);
        throw new DurableTranscriptionRestartRequiredError(
          confirmedStatusResponse.data?.error || 'Transcription failed'
        );
      }
      if (confirmedStatus !== 'processing') {
        clearDurableTranscriptionResumeJob(recoveryKey);
        throw new DurableTranscriptionRestartRequiredError(
          'Durable transcription did not resume cleanly'
        );
      }
    }
    setDurableTranscriptionResumeJob({ recoveryKey, jobId });
  }

  return pollDurableTranscriptionJob({
    jobId,
    signal,
    onProgress,
    estimatedTranscriptionSec,
    maxWaitMs,
    recoveryKey,
  });
}

async function pollDurableTranscriptionJob({
  jobId,
  signal,
  onProgress,
  estimatedTranscriptionSec,
  maxWaitMs,
  recoveryKey,
}: {
  jobId: string;
  signal?: AbortSignal;
  onProgress?: (stage: string, percent?: number) => void;
  estimatedTranscriptionSec: number;
  maxWaitMs: number;
  recoveryKey?: string;
}): Promise<any> {
  const pollStartedAt = Date.now();

  while (Date.now() - pollStartedAt < maxWaitMs) {
    if (signal?.aborted) {
      throw new DurableTranscriptionDetachedError(
        jobId,
        buildDetachedDurableTranscriptionMessage(jobId)
      );
    }

    let statusResponse;
    try {
      statusResponse = await fetchDurableTranscriptionStatus({
        jobId,
        signal,
      });
    } catch (error: any) {
      if (
        error?.name === 'AbortError' ||
        error?.code === 'ERR_CANCELED' ||
        signal?.aborted
      ) {
        throw new DurableTranscriptionDetachedError(
          jobId,
          buildDetachedDurableTranscriptionMessage(jobId)
        );
      }
      throw error;
    }

    if (statusResponse.status === 404) {
      clearDurableTranscriptionResumeJob(recoveryKey);
      throw new Error('transcription-job-not-found');
    }
    if (statusResponse.status !== 200) {
      throw new Error(
        statusResponse.data?.message ||
          `Failed to read durable transcription status (${statusResponse.status})`
      );
    }

    const resultData = statusResponse.data;
    if (resultData?.status === 'completed') {
      clearDurableTranscriptionResumeJob(recoveryKey);
      onProgress?.('Transcription complete!', 100);
      return resultData.result;
    }

    if (resultData?.status === 'failed') {
      clearDurableTranscriptionResumeJob(recoveryKey);
      throw new Error(resultData.error || 'Transcription failed');
    }

    const { stage, percent } = getTranscriptionProgress(
      pollStartedAt,
      estimatedTranscriptionSec,
      40,
      95
    );
    onProgress?.(
      resultData?.status === 'processing'
        ? stage
        : 'Waiting for durable transcription...',
      percent
    );

    try {
      await waitForAbortableDelay(
        API_TIMEOUTS.TRANSCRIPTION_POLL_INTERVAL,
        signal
      );
    } catch (error: any) {
      if (
        error?.name === 'AbortError' ||
        error?.code === 'ERR_CANCELED' ||
        signal?.aborted
      ) {
        throw new DurableTranscriptionDetachedError(
          jobId,
          buildDetachedDurableTranscriptionMessage(jobId)
        );
      }
      throw error;
    }
  }

  throw new DurableTranscriptionDetachedError(
    jobId,
    buildDetachedDurableTranscriptionMessage(jobId)
  );
}

export async function transcribe({
  filePath,
  promptContext,
  model = AI_MODELS.WHISPER,
  qualityMode,
  durationSec,
  idempotencyKey,
  signal,
}: {
  filePath: string;
  promptContext?: string;
  model?: string;
  qualityMode?: boolean;
  durationSec?: number;
  /** Prevent double-charges on client retries / disconnects. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}) {
  // Dev: simulate zero credits without hitting the network
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }
  // Check if already cancelled before starting
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    // Step 1: Submit the transcription job
    const submitResponse = await withStage5AuthRetry(async authHeaders => {
      const fd = new FormData();
      const { stream, cleanup } = createAbortableReadStream(filePath, signal);
      fd.append('file', stream);

      if (promptContext) {
        fd.append('prompt', promptContext);
      }

      fd.append('model', model);
      if (typeof qualityMode === 'boolean') {
        fd.append('qualityMode', String(qualityMode));
      }
      if (
        typeof durationSec === 'number' &&
        Number.isFinite(durationSec) &&
        durationSec > 0
      ) {
        fd.append('durationSec', String(durationSec));
      }

      try {
        return await axios.post(`${STAGE5_API_URL}/transcribe`, fd, {
          headers: {
            ...authHeaders,
            ...fd.getHeaders(),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          signal,
        });
      } finally {
        cleanup();
      }
    });
    throwIfStage5UpdateRequiredResponse({
      response: submitResponse,
      source: 'stage5-api',
    });
    sendNetLog('info', `POST /transcribe -> ${submitResponse.status}`, {
      url: `${STAGE5_API_URL}/transcribe`,
      method: 'POST',
      status: submitResponse.status,
    });

    // Handle 202 response with job ID
    if (submitResponse.status === 202) {
      const { jobId } = submitResponse.data;

      // Step 2: Poll for job completion
      const pollInterval = API_TIMEOUTS.TRANSCRIPTION_POLL_INTERVAL;
      const maxWaitTime = API_TIMEOUTS.TRANSCRIPTION_MAX_WAIT;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        // Check if cancelled
        if (signal?.aborted) {
          throw new DOMException('Operation cancelled', 'AbortError');
        }

        // Poll for result
        const resultResponse = await withStage5AuthRetry(authHeaders =>
          axios.get(`${STAGE5_API_URL}/transcribe/result/${jobId}`, {
            headers: authHeaders,
            signal,
          })
        );
        throwIfStage5UpdateRequiredResponse({
          response: resultResponse,
          source: 'stage5-api',
        });
        sendNetLog(
          'info',
          `GET /transcribe/result/${jobId} -> ${resultResponse.status}`,
          {
            url: `${STAGE5_API_URL}/transcribe/result/${jobId}`,
            method: 'GET',
            status: resultResponse.status,
          }
        );

        const resultData = resultResponse.data;

        // Check if job is done - the API returns the transcript directly when status is 200 and segments exist
        if (resultResponse.status === 200 && resultData.segments) {
          // Job completed successfully, return transcription result
          return resultData;
        }

        // If we get a 200 but no segments, it means job is still processing
        // The API returns { status: 'queued'/'processing', created, updated } while processing

        // Check if job failed
        if (resultData.error) {
          throw new Error(resultData.message || 'Transcription failed');
        }

        // Job still processing, wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      // Timeout
      throw new Error('Transcription job timed out after 5 minutes');
    }

    // Fallback for direct response (shouldn't happen with new API)
    return submitResponse.data;
  } catch (error: any) {
    // Handle cancellation specifically
    if (
      error.name === 'AbortError' ||
      error.code === 'ERR_CANCELED' ||
      signal?.aborted
    ) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    throwIfStage5UpdateRequiredError({ error, source: 'stage5-api' });

    // Handle insufficient credits with a friendly error message
    if (error.response?.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }

    // Log HTTP errors then re-throw
    if (error.response) {
      sendNetLog(
        'error',
        `HTTP ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
        {
          status: error.response.status,
          url: error.config?.url,
          method: error.config?.method,
        }
      );
    } else if (error.request) {
      sendNetLog(
        'error',
        `HTTP NO_RESPONSE ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
        { url: error.config?.url, method: error.config?.method }
      );
    } else {
      sendNetLog('error', `HTTP ERROR: ${String(error?.message || error)}`);
    }
    throw error;
  }
}

export async function translate({
  messages,
  model,
  modelFamily,
  reasoning,
  translationPhase,
  qualityMode,
  idempotencyKey,
  signal,
}: {
  messages: any[];
  model?: string;
  modelFamily?: 'gpt' | 'claude' | 'auto';
  reasoning?: {
    effort?: 'low' | 'medium' | 'high';
  };
  translationPhase?: 'draft' | 'review';
  qualityMode?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
}) {
  // Dev: simulate zero credits without hitting the network
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }
  // Check if already cancelled before starting
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    const normalizedModel = model ? normalizeAiModelId(model) : undefined;
    const payload: any = { messages, reasoning };
    if (normalizedModel) {
      payload.model = normalizedModel;
    }
    if (modelFamily) {
      payload.modelFamily = modelFamily;
    }
    if (translationPhase) {
      payload.translationPhase = translationPhase;
    }
    if (typeof qualityMode === 'boolean') {
      payload.qualityMode = qualityMode;
    }
    const postResponse = await withStage5AuthRetryOnResponse(authHeaders =>
      axios.post(`${STAGE5_API_URL}/translate`, payload, {
        headers: {
          ...authHeaders,
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        signal,
        validateStatus: () => true,
      })
    );

    sendNetLog('info', `POST /translate -> ${postResponse.status}`, {
      url: `${STAGE5_API_URL}/translate`,
      method: 'POST',
      status: postResponse.status,
    });

    if (postResponse.status === 200) {
      return postResponse.data;
    }

    if (postResponse.status === 202) {
      const jobId = postResponse.data?.jobId;
      if (!jobId) {
        throw new Error('Translation job missing jobId');
      }
      return await pollTranslationJob({ jobId, signal });
    }

    if (postResponse.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }

    throwIfStage5UpdateRequiredResponse({
      response: postResponse,
      source: 'stage5-api',
    });

    throw new Error(
      postResponse.data?.message || 'Failed to submit translation job'
    );
  } catch (error: any) {
    // Handle cancellation specifically
    if (
      error.name === 'AbortError' ||
      error.code === 'ERR_CANCELED' ||
      signal?.aborted
    ) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    throwIfStage5UpdateRequiredError({ error, source: 'stage5-api' });

    // Handle insufficient credits with a friendly error message
    if (error.response?.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }

    // Log HTTP errors then re-throw
    if (error.response) {
      sendNetLog(
        'error',
        `HTTP ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
        {
          status: error.response.status,
          url: error.config?.url,
          method: error.config?.method,
        }
      );
    } else if (error.request) {
      sendNetLog(
        'error',
        `HTTP NO_RESPONSE ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
        { url: error.config?.url, method: error.config?.method }
      );
    } else {
      sendNetLog('error', `HTTP ERROR: ${String(error?.message || error)}`);
    }
    throw error;
  }
}

async function pollTranslationJob({
  jobId,
  signal,
}: {
  jobId: string;
  signal?: AbortSignal;
}): Promise<any> {
  const pollIntervalMs = API_TIMEOUTS.TRANSLATION_POLL_INTERVAL;
  const maxWaitMs = API_TIMEOUTS.TRANSLATION_MAX_WAIT;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    const statusResponse = await withStage5AuthRetryOnResponse(authHeaders =>
      axios.get(`${STAGE5_API_URL}/translate/result/${jobId}`, {
        headers: authHeaders,
        signal,
        validateStatus: () => true,
      })
    );

    sendNetLog(
      'info',
      `GET /translate/result/${jobId} -> ${statusResponse.status}`,
      {
        url: `${STAGE5_API_URL}/translate/result/${jobId}`,
        method: 'GET',
        status: statusResponse.status,
      }
    );

    if (statusResponse.status === 202) {
      continue;
    }

    if (statusResponse.status === 200) {
      return statusResponse.data;
    }

    if (statusResponse.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }

    throwIfStage5UpdateRequiredResponse({
      response: statusResponse,
      source: 'stage5-api',
    });

    if (statusResponse.status === 404) {
      throw new Error('translation-job-not-found');
    }

    const message =
      statusResponse.data?.error ||
      statusResponse.data?.message ||
      `Translation job failed (status ${statusResponse.status})`;
    throw new Error(message);
  }

  throw new Error('Translation job timed out after 10 minutes');
}

export async function synthesizeDub({
  segments,
  voice,
  model,
  format,
  quality,
  ttsProvider,
  idempotencyKey,
  signal,
}: {
  segments: Array<{
    start?: number;
    end?: number;
    original?: string;
    translation?: string;
    index?: number;
  }>;
  voice?: string;
  model?: string;
  format?: string;
  quality?: 'standard' | 'high';
  /** TTS provider for Stage5 API: 'openai' (cheaper) or 'elevenlabs' (higher quality) */
  ttsProvider?: 'openai' | 'elevenlabs';
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<{
  audioBase64?: string;
  format: string;
  voice: string;
  model: string;
  segments?: Array<{
    index: number;
    audioBase64: string;
    targetDuration?: number;
  }>;
  chunkCount?: number;
  segmentCount?: number;
}> {
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    // Stage5 backends accept `model` for TTS selection. Default to Eleven v3 when using ElevenLabs.
    const effectiveModel =
      model ?? (ttsProvider === 'elevenlabs' ? 'eleven_v3' : undefined);
    const response = await withStage5AuthRetry(authHeaders =>
      axios.post(
        `${STAGE5_API_URL}/dub`,
        {
          segments,
          voice,
          model: effectiveModel,
          format,
          quality,
          ttsProvider,
        },
        {
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          signal,
        }
      )
    );

    sendNetLog('info', `POST /dub -> ${response.status}`, {
      url: `${STAGE5_API_URL}/dub`,
      method: 'POST',
      status: response.status,
    });

    const data = response.data as {
      audioBase64?: string;
      format?: string;
      voice?: string;
      model?: string;
      segments?: Array<{
        index: number;
        audioBase64: string;
        targetDuration?: number;
      }>;
      chunkCount?: number;
      segmentCount?: number;
    };

    if (!data.audioBase64 && !data.segments?.length) {
      throw new Error('Dub synthesis returned no audio segments');
    }

    return {
      audioBase64: data.audioBase64,
      format: data.format ?? 'mp3',
      voice: data.voice ?? voice ?? 'alloy',
      model: data.model ?? effectiveModel ?? model ?? 'tts-1',
      segments: data.segments,
      chunkCount: data.chunkCount,
      segmentCount: data.segmentCount,
    };
  } catch (error: any) {
    if (
      error?.name === 'AbortError' ||
      error?.code === 'ERR_CANCELED' ||
      signal?.aborted
    ) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    throwIfStage5UpdateRequiredError({ error, source: 'stage5-api' });

    if (error?.response?.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }

    let errToThrow: any = error;

    if (error.response) {
      sendNetLog(
        'error',
        `HTTP ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
        {
          status: error.response.status,
          url: error.config?.url,
          method: error.config?.method,
          data: error.response.data,
        }
      );
      const relayDetails = error.response.data?.details ?? error.response.data;
      if (relayDetails) {
        const message =
          typeof relayDetails === 'string'
            ? relayDetails
            : JSON.stringify(relayDetails);
        errToThrow = new Error(message);
      }
    } else if (error.request) {
      sendNetLog(
        'error',
        `HTTP NO_RESPONSE ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
        { url: error.config?.url, method: error.config?.method }
      );
    } else {
      sendNetLog('error', `HTTP ERROR: ${String(error?.message || error)}`);
    }

    throw errToThrow;
  }
}

/**
 * Transcribe a large file via the durable R2 job flow.
 * Upload to storage first, then let stage5-api + relay finish asynchronously
 * while the desktop app polls job status.
 */
export async function transcribeViaR2({
  filePath,
  language,
  durationSec,
  idempotencyKey,
  recoverySeed,
  recoverySourcePath,
  signal,
  onProgress,
}: {
  filePath: string;
  language?: string;
  durationSec?: number;
  /** Prevent double-charges on client retries / disconnects. */
  idempotencyKey?: string;
  /** Stable identifier used to reconnect to a detached durable job. */
  recoverySeed?: string;
  /** Stable source path used to reconnect to a detached durable job. */
  recoverySourcePath?: string;
  signal?: AbortSignal;
  onProgress?: (stage: string, percent?: number) => void;
}): Promise<any> {
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }

  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  const stats = fs.statSync(filePath);
  const fileSizeMB = stats.size / (1024 * 1024);
  const contentType = resolveTranscriptionUploadContentType(filePath);
  const estimatedTranscriptionSec = estimateTranscriptionTime(
    durationSec,
    fileSizeMB
  );
  const maxWaitMs = getR2TranscriptionMaxWaitMs(estimatedTranscriptionSec);
  const recoveryKey = buildDurableTranscriptionRecoveryKey({
    recoverySeed,
    sourcePath: recoverySourcePath,
    language,
    durationSec,
  });
  const durableRequestIdempotencyKey =
    buildDurableTranscriptionRequestIdempotencyKey({
      recoveryKey,
      fallbackIdempotencyKey: idempotencyKey,
    });
  const existingResumeJob = getDurableTranscriptionResumeJob(recoveryKey);
  let durableJobIdForDetach: string | null = null;

  onProgress?.('Preparing durable transcription...', 5);

  try {
    if (existingResumeJob?.jobId) {
      onProgress?.('Reconnecting to durable transcription...', 35);
      try {
        durableJobIdForDetach = existingResumeJob.jobId;
        return await resumeDurableTranscriptionJob({
          jobId: existingResumeJob.jobId,
          idempotencyKey: durableRequestIdempotencyKey,
          signal,
          onProgress,
          estimatedTranscriptionSec,
          maxWaitMs,
          recoveryKey,
        });
      } catch (error: any) {
        if (
          error?.message !== 'transcription-job-not-found' &&
          error?.code !== DURABLE_TRANSCRIPTION_RESTART_REQUIRED_CODE
        ) {
          throw error;
        }
      }
    }

    const uploadUrlResponse = await withStage5AuthRetryOnResponse(authHeaders =>
      axios.post(
        `${STAGE5_API_URL}/transcribe/upload-url`,
        {
          language,
          contentType,
          fileSizeMB,
          durationSec,
        },
        {
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
            ...(durableRequestIdempotencyKey
              ? { 'Idempotency-Key': durableRequestIdempotencyKey }
              : {}),
          },
          signal,
          validateStatus: () => true,
        }
      )
    );
    throwIfStage5UpdateRequiredResponse({
      response: uploadUrlResponse,
      source: 'stage5-api',
    });

    sendNetLog(
      'info',
      `POST /transcribe/upload-url -> ${uploadUrlResponse.status}`,
      {
        url: `${STAGE5_API_URL}/transcribe/upload-url`,
        method: 'POST',
        status: uploadUrlResponse.status,
      }
    );

    if (uploadUrlResponse.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }
    if (uploadUrlResponse.status !== 200) {
      throw new Error(
        uploadUrlResponse.data?.message || 'Failed to prepare durable upload'
      );
    }

    const jobId =
      typeof uploadUrlResponse.data?.jobId === 'string'
        ? uploadUrlResponse.data.jobId
        : '';
    const uploadRequired = uploadUrlResponse.data?.uploadRequired !== false;
    const uploadUrl =
      typeof uploadUrlResponse.data?.uploadUrl === 'string'
        ? uploadUrlResponse.data.uploadUrl
        : '';
    const jobStatus =
      typeof uploadUrlResponse.data?.status === 'string'
        ? uploadUrlResponse.data.status
        : 'pending_upload';
    if (!jobId) {
      throw new Error(
        'Durable transcription upload URL response was incomplete'
      );
    }
    if (uploadRequired && !uploadUrl) {
      throw new Error(
        'Durable transcription upload URL response was incomplete'
      );
    }

    if (uploadRequired) {
      onProgress?.('Uploading audio to secure storage...', 10);

      let uploadStatus = 0;
      const { stream, cleanup } = createAbortableReadStream(filePath, signal);
      try {
        const uploadResponse = await axios.put(uploadUrl, stream, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(stats.size),
          },
          signal,
          timeout: 0,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          validateStatus: () => true,
          onUploadProgress: progressEvent => {
            if (!progressEvent.total) return;
            const uploadPercent = Math.round(
              (progressEvent.loaded / progressEvent.total) * 25
            );
            onProgress?.('Uploading...', 10 + uploadPercent);
          },
        });
        uploadStatus = uploadResponse.status;

        if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
          throw new Error(
            `R2 upload failed with status ${uploadResponse.status}`
          );
        }
      } finally {
        cleanup();
      }

      sendNetLog('info', `PUT durable transcription upload -> ${uploadStatus}`, {
        url: 'presigned-r2-upload',
        method: 'PUT',
        status: uploadStatus,
        jobId,
      });

      onProgress?.('Starting durable transcription...', 35);
      durableJobIdForDetach = jobId;
      setDurableTranscriptionResumeJob({ recoveryKey, jobId });
      await startDurableTranscriptionJob({
        jobId,
        idempotencyKey: durableRequestIdempotencyKey,
        signal,
      });
    } else if (jobStatus === 'processing' || jobStatus === 'completed') {
      durableJobIdForDetach = jobId;
      setDurableTranscriptionResumeJob({ recoveryKey, jobId });
      onProgress?.('Reconnecting to durable transcription...', 35);
    }

    return await pollDurableTranscriptionJob({
      jobId,
      signal,
      onProgress,
      estimatedTranscriptionSec,
      maxWaitMs,
      recoveryKey,
    });
  } catch (error: any) {
    if (error?.code === DURABLE_TRANSCRIPTION_DETACHED_CODE) {
      throw error;
    }
    if (
      error?.name === 'AbortError' ||
      error?.code === 'ERR_CANCELED' ||
      signal?.aborted
    ) {
      if (durableJobIdForDetach) {
        throw new DurableTranscriptionDetachedError(
          durableJobIdForDetach,
          buildDetachedDurableTranscriptionMessage(durableJobIdForDetach)
        );
      }
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    if (
      durableJobIdForDetach &&
      shouldDetachDurableTranscriptionForTransientError(error)
    ) {
      setDurableTranscriptionResumeJob({
        recoveryKey,
        jobId: durableJobIdForDetach,
      });
      throw new DurableTranscriptionDetachedError(
        durableJobIdForDetach,
        buildDetachedDurableTranscriptionMessage(durableJobIdForDetach)
      );
    }

    throwIfStage5UpdateRequiredError({ error, source: 'stage5-api' });

    if (error?.response?.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }

    if (error?.response) {
      sendNetLog(
        'error',
        `HTTP ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
        {
          status: error.response.status,
          url: error.config?.url,
          method: error.config?.method,
          data: error.response.data,
        }
      );
    } else if (error?.request) {
      sendNetLog(
        'error',
        `HTTP NO_RESPONSE ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
        { url: error.config?.url, method: error.config?.method }
      );
    } else {
      sendNetLog('error', `HTTP ERROR: ${String(error?.message || error)}`);
    }

    if (error?.message === 'transcription-job-not-found') {
      clearDurableTranscriptionResumeJob(recoveryKey);
    }

    throw error;
  }
}

// ============================================================================
// Direct Relay Endpoints (Simplified Flow)
// ============================================================================

/**
 * Estimate transcription time for ElevenLabs Scribe (~8x realtime).
 * Returns estimated seconds to complete.
 */
function estimateTranscriptionTime(
  durationSec: number | undefined,
  fileSizeMB: number
): number {
  return durationSec
    ? (durationSec / 8) * (durationSec > 3600 ? 1.5 : 1.2) // 8x realtime + buffer for long files
    : (fileSizeMB / 10) * 60; // Fallback: ~10MB per minute of audio
}

/**
 * Calculate transcription progress and format time remaining.
 * @param startTime - When transcription started (ms)
 * @param estimatedTotalSec - Estimated total transcription time (seconds)
 * @param basePercent - Starting percentage (e.g., 40 after upload)
 * @param maxPercent - Maximum percentage before complete (e.g., 95)
 */
function getTranscriptionProgress(
  startTime: number,
  estimatedTotalSec: number,
  basePercent = 40,
  maxPercent = 95
): { stage: string; percent: number } {
  const elapsedSec = (Date.now() - startTime) / 1000;
  const progressRange = maxPercent - basePercent;
  const percent = Math.min(
    maxPercent,
    basePercent + (elapsedSec / estimatedTotalSec) * progressRange
  );
  const remainingSec = Math.max(0, estimatedTotalSec - elapsedSec);
  const stage = formatElevenLabsTimeRemaining(remainingSec);
  return { stage, percent };
}

/**
 * Transcribe via direct relay endpoint (simplified flow).
 * App sends file directly to relay, relay handles auth/credits via CF Worker.
 * No R2, no polling, no webhooks - just send file and get result.
 */
export async function transcribeViaDirect({
  filePath,
  language,
  durationSec,
  modelId = 'scribe_v2',
  qualityMode,
  idempotencyKey,
  signal,
  onProgress,
}: {
  filePath: string;
  language?: string;
  durationSec?: number;
  /** ElevenLabs Scribe model for relay transcription. */
  modelId?: string;
  qualityMode?: boolean;
  /** Prevent double-charges on client retries / disconnects. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  onProgress?: (stage: string, percent?: number) => void;
}): Promise<any> {
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }

  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  onProgress?.('Preparing transcription...', 5);

  // Get file size for progress estimation
  const stats = fs.statSync(filePath);
  const fileSizeMB = stats.size / (1024 * 1024);

  onProgress?.('Uploading audio to relay...', 10);

  // Track upload completion to start transcription progress
  let uploadComplete = false;
  let transcriptionStartTime: number | null = null;
  let progressInterval: NodeJS.Timeout | null = null;
  const estimatedTranscriptionSec = estimateTranscriptionTime(
    durationSec,
    fileSizeMB
  );

  try {
    const responsePromise = withStage5AuthRetry(async authHeaders => {
      const fd = new FormData();
      const { stream, cleanup } = createAbortableReadStream(filePath, signal);
      fd.append('file', stream);
      if (language) {
        fd.append('language', language);
      }
      if (modelId) {
        fd.append('model_id', modelId);
      }
      if (typeof qualityMode === 'boolean') {
        fd.append('qualityMode', String(qualityMode));
      }

      try {
        return await axios.post(`${RELAY_URL}/transcribe-direct`, fd, {
          headers: {
            ...authHeaders,
            ...fd.getHeaders(),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          signal,
          timeout: 0,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          onUploadProgress: progressEvent => {
            if (progressEvent.total) {
              const uploadPercent = Math.round(
                (progressEvent.loaded / progressEvent.total) * 30
              );
              onProgress?.('Uploading...', 10 + uploadPercent);

              if (
                progressEvent.loaded >= progressEvent.total &&
                !uploadComplete
              ) {
                uploadComplete = true;
                transcriptionStartTime = Date.now();

                progressInterval = setInterval(() => {
                  if (!transcriptionStartTime) return;
                  const { stage, percent } = getTranscriptionProgress(
                    transcriptionStartTime,
                    estimatedTranscriptionSec
                  );
                  onProgress?.(stage, percent);
                }, 1000);
              }
            }
          },
        });
      } finally {
        cleanup();
      }
    });

    const response = await responsePromise;

    // Clear progress interval
    if (progressInterval) {
      clearInterval(progressInterval);
    }

    sendNetLog('info', `POST /transcribe-direct -> ${response.status}`, {
      url: `${RELAY_URL}/transcribe-direct`,
      method: 'POST',
      status: response.status,
    });

    onProgress?.('Transcription complete!', 100);
    return response.data;
  } catch (error: any) {
    // Clear progress interval on error
    if (progressInterval) {
      clearInterval(progressInterval);
    }
    if (
      error.name === 'AbortError' ||
      error.code === 'ERR_CANCELED' ||
      signal?.aborted
    ) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    throwIfStage5UpdateRequiredError({ error, source: 'relay' });

    if (error.response?.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }

    if (error.response?.status === 401) {
      throw new Error('Invalid API key');
    }

    if (error.response) {
      sendNetLog(
        'error',
        `HTTP ${error.response.status} POST ${RELAY_URL}/transcribe-direct`,
        {
          status: error.response.status,
          data: error.response.data,
        }
      );
    }

    const relayMessage =
      getRelayErrorMessage(error) ||
      error?.message ||
      'Direct transcription request failed';
    if (error && typeof error === 'object') {
      error.message = relayMessage;
      throw error;
    }

    throw new Error(relayMessage);
  }
}

/**
 * Translate via direct relay endpoint (simplified flow).
 * App sends request directly to relay, relay handles auth/credits via CF Worker.
 * No CF Worker middleware for the AI call itself - just auth/billing.
 */
export async function translateViaDirect({
  messages,
  model,
  modelFamily,
  webSearch,
  reasoning,
  translationPhase,
  qualityMode,
  idempotencyKey,
  signal,
}: {
  messages: any[];
  model?: string;
  modelFamily?: 'gpt' | 'claude' | 'auto';
  webSearch?: boolean;
  reasoning?: {
    effort?: 'low' | 'medium' | 'high';
  };
  translationPhase?: 'draft' | 'review';
  qualityMode?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<any> {
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }

  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    const normalizedModel = model ? normalizeAiModelId(model) : undefined;
    const payload: Record<string, unknown> = { messages, reasoning };
    if (normalizedModel) {
      payload.model = normalizedModel;
    }
    if (modelFamily) {
      payload.modelFamily = modelFamily;
    }
    if (translationPhase) {
      payload.translationPhase = translationPhase;
    }
    if (typeof qualityMode === 'boolean') {
      payload.qualityMode = qualityMode;
    }
    if (webSearch === true) {
      payload.webSearch = true;
    }
    const response = await withStage5AuthRetry(authHeaders =>
      axios.post(`${RELAY_URL}/translate-direct`, payload, {
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        signal,
        timeout: 0,
      })
    );

    sendNetLog('info', `POST /translate-direct -> ${response.status}`, {
      url: `${RELAY_URL}/translate-direct`,
      method: 'POST',
      status: response.status,
    });

    return response.data;
  } catch (error: any) {
    if (
      error.name === 'AbortError' ||
      error.code === 'ERR_CANCELED' ||
      signal?.aborted
    ) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    throwIfStage5UpdateRequiredError({ error, source: 'relay' });

    if (error.response?.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }

    if (error.response?.status === 401) {
      throw new Error('Invalid API key');
    }

    if (error.response) {
      sendNetLog(
        'error',
        `HTTP ${error.response.status} POST ${RELAY_URL}/translate-direct`,
        {
          status: error.response.status,
          data: error.response.data,
        }
      );
    }

    throw error;
  }
}

/**
 * Dub via direct relay endpoint (simplified flow).
 * App sends request directly to relay, relay handles auth/credits via CF Worker.
 * No CF Worker middleware for the TTS call itself - just auth/billing.
 */
export async function dubViaDirect({
  segments,
  voice,
  model,
  format,
  quality,
  ttsProvider,
  idempotencyKey,
  signal,
}: {
  segments: Array<{
    start?: number;
    end?: number;
    original?: string;
    translation?: string;
    index?: number;
  }>;
  voice?: string;
  model?: string;
  format?: string;
  quality?: 'standard' | 'high';
  ttsProvider?: 'openai' | 'elevenlabs';
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<{
  audioBase64?: string;
  format: string;
  voice: string;
  model: string;
  segments?: Array<{
    index: number;
    audioBase64: string;
    targetDuration?: number;
  }>;
  chunkCount?: number;
  segmentCount?: number;
}> {
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }

  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  // Relay / API both support idempotent replay recovery for transient 408s.
  const effectiveModel =
    model ?? (ttsProvider === 'elevenlabs' ? 'eleven_v3' : undefined);
  const maxAttempts = 2;
  const hasIdempotencyKey = Boolean(String(idempotencyKey || '').trim());

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await withStage5AuthRetry(authHeaders =>
        axios.post(
          `${RELAY_URL}/dub-direct`,
          {
            segments,
            voice,
            model: effectiveModel,
            format,
            quality,
            ttsProvider,
          },
          {
            headers: {
              ...authHeaders,
              'Content-Type': 'application/json',
              ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            },
            signal,
            timeout: 0,
          }
        )
      );

      sendNetLog('info', `POST /dub-direct -> ${response.status}`, {
        url: `${RELAY_URL}/dub-direct`,
        method: 'POST',
        status: response.status,
      });

      const data = response.data as {
        audioBase64?: string;
        format?: string;
        voice?: string;
        model?: string;
        segments?: Array<{
          index: number;
          audioBase64: string;
          targetDuration?: number;
        }>;
        chunkCount?: number;
        segmentCount?: number;
      };

      if (
        !data.audioBase64 &&
        !(Array.isArray(data.segments) && data.segments.length > 0)
      ) {
        throw new Error('Dub request returned no audio payload.');
      }

      return {
        audioBase64: data.audioBase64,
        format: data.format ?? 'mp3',
        voice: data.voice ?? voice ?? 'alloy',
        model: data.model ?? effectiveModel ?? model ?? 'tts-1',
        segments: data.segments,
        chunkCount: data.chunkCount,
        segmentCount: data.segmentCount,
      };
    } catch (error: any) {
      if (
        error.name === 'AbortError' ||
        error.code === 'ERR_CANCELED' ||
        signal?.aborted
      ) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      throwIfStage5UpdateRequiredError({ error, source: 'relay' });

      if (error.response?.status === 402) {
        throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
      }

      if (error.response?.status === 401) {
        throw new Error('Invalid API key');
      }

      const relayMessage =
        getRelayErrorMessage(error) || error?.message || 'Dub request failed';
      const retryable = shouldRetryDubDirectRequest({
        error,
        attempt,
        maxAttempts,
        hasIdempotencyKey,
      });

      if (retryable) {
        sendNetLog(
          'warn',
          'Retrying POST /dub-direct after transient failure',
          {
            attempt,
            maxAttempts,
            status: getRelayStatus(error),
            data: error?.response?.data,
          }
        );
        await waitForDubDirectRetry(750 * attempt, signal);
        continue;
      }

      if (error.response) {
        sendNetLog(
          'error',
          `HTTP ${error.response.status} POST ${RELAY_URL}/dub-direct`,
          {
            status: error.response.status,
            data: error.response.data,
          }
        );
      } else if (error.request) {
        sendNetLog('error', `HTTP NO_RESPONSE POST ${RELAY_URL}/dub-direct`, {
          url: `${RELAY_URL}/dub-direct`,
          method: 'POST',
        });
      } else {
        sendNetLog('error', `HTTP ERROR: ${relayMessage}`);
      }

      if (error && typeof error === 'object') {
        error.message = relayMessage;
        throw error;
      }

      throw new Error(relayMessage);
    }
  }

  throw new Error('Dub request failed');
}
