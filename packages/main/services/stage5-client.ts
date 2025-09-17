import axios from 'axios';
import { BrowserWindow } from 'electron';
import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import FormData from 'form-data';
import { AI_MODELS } from '../../shared/constants/index.js';

const API = 'https://api.stage5.tools';

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

const idStore = new Store<{ deviceId?: string }>({ name: 'device-config' });

export const getDeviceId = (): string => {
  let id = idStore.get('deviceId');
  if (!id) {
    id = uuidv4();
    idStore.set('deviceId', id);
  }
  return id;
};

const headers = () => ({ Authorization: `Bearer ${getDeviceId()}` });

export async function transcribe({
  filePath,
  promptContext,
  model = AI_MODELS.WHISPER,
  signal,
}: {
  filePath: string;
  promptContext?: string;
  model?: string;
  signal?: AbortSignal;
}) {
  // Dev: simulate zero credits without hitting the network
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error('insufficient-credits');
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
    const submitResponse = await axios.post(`${API}/transcribe`, fd, {
      headers: {
        ...headers(),
        ...fd.getHeaders(), // Let form-data set the proper boundary
      },
      signal, // Pass the AbortSignal to axios
    });
    sendNetLog('info', `POST /transcribe -> ${submitResponse.status}`, {
      url: `${API}/transcribe`,
      method: 'POST',
      status: submitResponse.status,
    });

    // Handle 202 response with job ID
    if (submitResponse.status === 202) {
      const { jobId } = submitResponse.data;

      // Step 2: Poll for job completion
      const pollInterval = 1000; // Poll every 1 second
      const maxWaitTime = 300000; // 5 minutes max
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        // Check if cancelled
        if (signal?.aborted) {
          throw new DOMException('Operation cancelled', 'AbortError');
        }

        // Poll for result
        const resultResponse = await axios.get(
          `${API}/transcribe/result/${jobId}`,
          {
            headers: headers(),
            signal,
          }
        );
        sendNetLog(
          'info',
          `GET /transcribe/result/${jobId} -> ${resultResponse.status}`,
          {
            url: `${API}/transcribe/result/${jobId}`,
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
      throw new Error('insufficient-credits');
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
  temperature = 0.4,
  signal,
}: {
  messages: any[];
  model?: string;
  reasoning?: {
    effort?: 'low' | 'medium' | 'high';
  };
  temperature?: number;
  signal?: AbortSignal;
}) {
  // Dev: simulate zero credits without hitting the network
  if (process.env.FORCE_ZERO_CREDITS === '1') {
    throw new Error('insufficient-credits');
  }
  // Check if already cancelled before starting
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    const isGpt5 = String(model).startsWith('gpt-5');
    const payload: any = { messages, model, reasoning };
    if (!isGpt5 && typeof temperature === 'number') {
      payload.temperature = temperature;
    }

    const postResponse = await axios.post(`${API}/translate`, payload, {
      headers: headers(),
      signal,
      validateStatus: () => true,
    });

    sendNetLog('info', `POST /translate -> ${postResponse.status}`, {
      url: `${API}/translate`,
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
      throw new Error('insufficient-credits');
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
      throw new Error('insufficient-credits');
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
  const pollIntervalMs = 2000;
  const maxWaitMs = 600_000; // 10 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    const statusResponse = await axios.get(`${API}/translate/result/${jobId}`, {
      headers: headers(),
      signal,
      validateStatus: () => true,
    });

    sendNetLog(
      'info',
      `GET /translate/result/${jobId} -> ${statusResponse.status}`,
      {
        url: `${API}/translate/result/${jobId}`,
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
      throw new Error('insufficient-credits');
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
    throw new Error('insufficient-credits');
  }
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    const response = await axios.post(
      `${API}/dub`,
      {
        segments,
        voice,
        model,
        format,
        quality,
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
      url: `${API}/dub`,
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
      throw new Error('insufficient-credits');
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
