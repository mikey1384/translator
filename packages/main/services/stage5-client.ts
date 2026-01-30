import axios from 'axios';
import { BrowserWindow } from 'electron';
import fs from 'fs';
import FormData from 'form-data';
import {
  AI_MODELS,
  ERROR_CODES,
  API_TIMEOUTS,
} from '../../shared/constants/index.js';
import { getDeviceId } from '../handlers/credit-handlers.js';
import { formatElevenLabsTimeRemaining } from './subtitle-processing/utils.js';

export const STAGE5_API_URL = 'https://api.stage5.tools';

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

const headers = () => ({ Authorization: `Bearer ${getDeviceId()}` });

export async function transcribe({
  filePath,
  promptContext,
  model = AI_MODELS.WHISPER,
  idempotencyKey,
  signal,
}: {
  filePath: string;
  promptContext?: string;
  model?: string;
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

  const fd = new FormData();
  fd.append('file', fs.createReadStream(filePath));

  // Language hint removed; rely on auto-detection server-side

  if (promptContext) {
    fd.append('prompt', promptContext);
  }

  fd.append('model', model);

  try {
    // Step 1: Submit the transcription job
    const submitResponse = await axios.post(
      `${STAGE5_API_URL}/transcribe`,
      fd,
      {
        headers: {
          ...headers(),
          ...fd.getHeaders(), // Let form-data set the proper boundary
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        signal, // Pass the AbortSignal to axios
      }
    );
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
        const resultResponse = await axios.get(
          `${STAGE5_API_URL}/transcribe/result/${jobId}`,
          {
            headers: headers(),
            signal,
          }
        );
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
  model = AI_MODELS.GPT,
  reasoning,
  signal,
}: {
  messages: any[];
  model?: string;
  reasoning?: {
    effort?: 'low' | 'medium' | 'high';
  };
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
    const payload: any = { messages, model, reasoning };
    const postResponse = await axios.post(
      `${STAGE5_API_URL}/translate`,
      payload,
      {
        headers: headers(),
        signal,
        validateStatus: () => true,
      }
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

    const statusResponse = await axios.get(
      `${STAGE5_API_URL}/translate/result/${jobId}`,
      {
        headers: headers(),
        signal,
        validateStatus: () => true,
      }
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
    const response = await axios.post(
      `${STAGE5_API_URL}/dub`,
      {
        segments,
        voice,
        model,
        format,
        quality,
        ttsProvider,
      },
      {
        headers: {
          ...headers(),
          'Content-Type': 'application/json',
        },
        signal,
      }
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
      model: data.model ?? model ?? 'tts-1',
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

// ============================================================================
// Direct Relay Endpoints (Simplified Flow)
// ============================================================================

export const RELAY_URL = 'https://translator-relay.fly.dev';

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
  idempotencyKey,
  signal,
  onProgress,
}: {
  filePath: string;
  language?: string;
  durationSec?: number;
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

  const fd = new FormData();
  fd.append('file', fs.createReadStream(filePath));
  if (language) {
    fd.append('language', language);
  }

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
    const responsePromise = axios.post(`${RELAY_URL}/transcribe-direct`, fd, {
      headers: {
        Authorization: `Bearer ${getDeviceId()}`,
        ...fd.getHeaders(),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      signal,
      // No timeout - relay has no limits, can take as long as needed
      timeout: 0,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      onUploadProgress: progressEvent => {
        if (progressEvent.total) {
          const uploadPercent = Math.round(
            (progressEvent.loaded / progressEvent.total) * 30
          );
          onProgress?.('Uploading...', 10 + uploadPercent);

          // Start transcription progress timer when upload completes
          if (progressEvent.loaded >= progressEvent.total && !uploadComplete) {
            uploadComplete = true;
            transcriptionStartTime = Date.now();

            // Update progress every second during transcription
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

    throw error;
  }
}

/**
 * Translate via direct relay endpoint (simplified flow).
 * App sends request directly to relay, relay handles auth/credits via CF Worker.
 * No CF Worker middleware for the AI call itself - just auth/billing.
 */
export async function translateViaDirect({
  messages,
  model = AI_MODELS.GPT,
  reasoning,
  signal,
}: {
  messages: any[];
  model?: string;
  reasoning?: {
    effort?: 'low' | 'medium' | 'high';
  };
  signal?: AbortSignal;
}): Promise<any> {
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }

  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    const response = await axios.post(
      `${RELAY_URL}/translate-direct`,
      { messages, model, reasoning },
      {
        headers: {
          Authorization: `Bearer ${getDeviceId()}`,
          'Content-Type': 'application/json',
        },
        signal,
        timeout: 0, // No timeout for long translations
      }
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
    const response = await axios.post(
      `${RELAY_URL}/dub-direct`,
      { segments, voice, model, format, quality, ttsProvider },
      {
        headers: {
          Authorization: `Bearer ${getDeviceId()}`,
          'Content-Type': 'application/json',
        },
        signal,
        timeout: 0, // No timeout for long dubbing operations
      }
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

    return {
      audioBase64: data.audioBase64,
      format: data.format ?? 'mp3',
      voice: data.voice ?? voice ?? 'alloy',
      model: data.model ?? model ?? 'tts-1',
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

    if (error.response?.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }

    if (error.response?.status === 401) {
      throw new Error('Invalid API key');
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
    }

    throw error;
  }
}

// ============================================================================
// R2-based Large File Transcription (Legacy - kept for backwards compatibility)
// ============================================================================

export interface R2TranscriptionJob {
  jobId: string;
  uploadUrl: string;
  fileKey: string;
  expiresIn: number;
}

/**
 * Request a presigned URL for uploading a large audio file to R2
 */
export async function requestTranscriptionUploadUrl({
  language,
  contentType = 'audio/webm',
  fileSizeMB,
  signal,
}: {
  language?: string;
  contentType?: string;
  fileSizeMB?: number;
  signal?: AbortSignal;
}): Promise<R2TranscriptionJob> {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    const response = await axios.post(
      `${STAGE5_API_URL}/transcribe/upload-url`,
      { language, contentType, fileSizeMB },
      {
        headers: { ...headers(), 'Content-Type': 'application/json' },
        signal,
      }
    );

    sendNetLog('info', `POST /transcribe/upload-url -> ${response.status}`, {
      url: `${STAGE5_API_URL}/transcribe/upload-url`,
      method: 'POST',
      status: response.status,
    });

    return response.data as R2TranscriptionJob;
  } catch (error: any) {
    if (error?.response?.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }
    sendNetLog('error', `HTTP ERROR: ${error?.message || error}`);
    throw error;
  }
}

/**
 * Upload a file to R2 using a presigned URL
 */
export async function uploadToR2({
  uploadUrl,
  filePath,
  contentType = 'audio/webm',
  onProgress,
  signal,
}: {
  uploadUrl: string;
  filePath: string;
  contentType?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  const fs = await import('fs');
  const fileBuffer = await fs.promises.readFile(filePath);
  const totalSize = fileBuffer.length;

  // Use fetch for streaming upload with progress
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(totalSize),
    },
    body: fileBuffer,
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`R2 upload failed: ${response.status} ${errorText}`);
  }

  onProgress?.(100);
  sendNetLog(
    'info',
    `PUT R2 upload -> ${response.status} (${(totalSize / 1024 / 1024).toFixed(1)}MB)`
  );
}

/**
 * Start processing a file that was uploaded to R2
 */
export async function startTranscriptionProcessing({
  jobId,
  signal,
}: {
  jobId: string;
  signal?: AbortSignal;
}): Promise<{ status: string; message: string }> {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    const response = await axios.post(
      `${STAGE5_API_URL}/transcribe/process/${jobId}`,
      {},
      {
        headers: headers(),
        signal,
      }
    );

    sendNetLog(
      'info',
      `POST /transcribe/process/${jobId} -> ${response.status}`,
      {
        url: `${STAGE5_API_URL}/transcribe/process/${jobId}`,
        method: 'POST',
        status: response.status,
      }
    );

    return response.data;
  } catch (error: any) {
    if (error?.response?.status === 402) {
      throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
    }
    sendNetLog('error', `HTTP ERROR: ${error?.message || error}`);
    throw error;
  }
}

/**
 * Poll for transcription job status
 */
export async function getTranscriptionStatus({
  jobId,
  signal,
}: {
  jobId: string;
  signal?: AbortSignal;
}): Promise<{
  jobId: string;
  status: 'pending_upload' | 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
}> {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    const response = await axios.get(
      `${STAGE5_API_URL}/transcribe/status/${jobId}`,
      {
        headers: headers(),
        signal,
      }
    );

    sendNetLog(
      'info',
      `GET /transcribe/status/${jobId} -> ${response.status}`,
      {
        url: `${STAGE5_API_URL}/transcribe/status/${jobId}`,
        method: 'GET',
        status: response.status,
      }
    );

    return response.data;
  } catch (error: any) {
    if (error?.response?.status === 404) {
      throw new Error('Job not found');
    }
    sendNetLog('error', `HTTP ERROR: ${error?.message || error}`);
    throw error;
  }
}

/**
 * Full R2-based transcription workflow:
 * 1. Request upload URL
 * 2. Upload file to R2
 * 3. Start processing
 * 4. Poll for result
 */
export async function transcribeViaR2({
  filePath,
  language,
  signal,
  durationSec,
  onProgress,
}: {
  filePath: string;
  language?: string;
  signal?: AbortSignal;
  durationSec?: number;
  onProgress?: (stage: string, percent?: number) => void;
}): Promise<any> {
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }

  const fs = await import('fs');
  const stats = await fs.promises.stat(filePath);
  const fileSizeMB = stats.size / (1024 * 1024);

  // Step 1: Request upload URL
  onProgress?.('Requesting upload URL...', 5);
  const { jobId, uploadUrl } = await requestTranscriptionUploadUrl({
    language,
    fileSizeMB,
    signal,
  });

  // Step 2: Upload file to R2
  onProgress?.('Uploading audio to cloud storage...', 10);
  await uploadToR2({
    uploadUrl,
    filePath,
    onProgress: pct => onProgress?.('Uploading...', 10 + pct * 0.3),
    signal,
  });

  // Step 3: Start processing
  onProgress?.('Starting transcription...', 45);
  await startTranscriptionProcessing({ jobId, signal });

  // Step 4: Poll for result
  const pollInterval = API_TIMEOUTS.TRANSLATION_POLL_INTERVAL;
  const maxWaitMs = API_TIMEOUTS.TRANSLATION_MAX_WAIT;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    const status = await getTranscriptionStatus({ jobId, signal });

    if (status.status === 'completed') {
      onProgress?.('Transcription complete!', 100);
      return status.result;
    }

    if (status.status === 'failed') {
      throw new Error(status.error || 'Transcription failed');
    }

    // Update progress based on elapsed time
    const estimatedTotalSec = estimateTranscriptionTime(
      durationSec,
      fileSizeMB
    );
    const { stage, percent } = getTranscriptionProgress(
      startTime,
      estimatedTotalSec,
      45, // Base percent after upload
      95 // Max percent before complete
    );
    onProgress?.(stage, percent);

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('Transcription timed out');
}

// ============================================================================
// Voice Cloning Dubbing (ElevenLabs Dubbing API)
// ============================================================================

export interface VoiceCloningResult {
  audioBase64: string;
  transcript: string;
  format: string;
  durationSeconds: number;
  creditsUsed: number;
}

/**
 * Dub video/audio with voice cloning using ElevenLabs Dubbing API via Stage5 API
 * This clones the original speaker's voice and translates to the target language
 */
export async function voiceCloneDub({
  file,
  targetLanguage,
  sourceLanguage,
  durationSeconds,
  numSpeakers,
  dropBackgroundAudio = true,
  onProgress,
  signal,
}: {
  file: { path: string; name: string; type: string };
  targetLanguage: string;
  sourceLanguage?: string;
  durationSeconds: number;
  numSpeakers?: number;
  dropBackgroundAudio?: boolean;
  onProgress?: (status: string, progress: number) => void;
  signal?: AbortSignal;
}): Promise<VoiceCloningResult> {
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error(ERROR_CODES.INSUFFICIENT_CREDITS);
  }
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    onProgress?.('Preparing voice cloning...', 5);

    // Read the file
    const fs = await import('fs');
    const fileBuffer = await fs.promises.readFile(file.path);

    // Create form data
    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: file.name,
      contentType: file.type || 'video/mp4',
    });
    formData.append('target_language', targetLanguage);
    formData.append('duration_seconds', String(durationSeconds));
    if (sourceLanguage) {
      formData.append('source_language', sourceLanguage);
    }
    if (numSpeakers !== undefined) {
      formData.append('num_speakers', String(numSpeakers));
    }
    formData.append('drop_background_audio', String(dropBackgroundAudio));

    onProgress?.('Uploading for voice cloning...', 15);

    const response = await axios.post(
      `${STAGE5_API_URL}/dub/voice-clone`,
      formData,
      {
        headers: {
          ...headers(),
          ...formData.getHeaders(),
        },
        signal,
        // Long timeout for voice cloning (can take several minutes)
        timeout: 600000, // 10 minutes
        onUploadProgress: progressEvent => {
          if (progressEvent.total) {
            const uploadProgress = Math.round(
              (progressEvent.loaded / progressEvent.total) * 30
            );
            onProgress?.('Uploading...', 15 + uploadProgress);
          }
        },
      }
    );

    sendNetLog('info', `POST /dub/voice-clone -> ${response.status}`, {
      url: `${STAGE5_API_URL}/dub/voice-clone`,
      method: 'POST',
      status: response.status,
    });

    onProgress?.('Voice cloning complete!', 100);

    const data = response.data as VoiceCloningResult;
    return data;
  } catch (error: any) {
    if (
      error?.name === 'AbortError' ||
      error?.code === 'ERR_CANCELED' ||
      signal?.aborted
    ) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    if (error?.response?.status === 402) {
      const errorData = error.response.data;
      const message = errorData?.message || ERROR_CODES.INSUFFICIENT_CREDITS;
      throw new Error(message);
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
      const details =
        error.response.data?.details ??
        error.response.data?.message ??
        error.response.data;
      if (details) {
        const message =
          typeof details === 'string' ? details : JSON.stringify(details);
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
 * Get voice cloning pricing info from Stage5 API
 */
export async function getVoiceCloningPricing(): Promise<{
  creditsPerMinute: number;
  description: string;
}> {
  try {
    const response = await axios.get(
      `${STAGE5_API_URL}/dub/voice-clone/pricing`,
      {
        headers: headers(),
      }
    );
    return response.data;
  } catch {
    // Fallback pricing if API call fails
    return {
      creditsPerMinute: 35000,
      description: 'Voice cloning uses ElevenLabs Dubbing API',
    };
  }
}
