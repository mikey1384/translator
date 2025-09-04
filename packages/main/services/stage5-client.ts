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
  language,
  promptContext,
  model = AI_MODELS.WHISPER,
  signal,
}: {
  filePath: string;
  language?: string;
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

  if (language) {
    fd.append('language', language);
  }

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
    const response = await axios.post(`${API}/translate`, payload, {
      headers: headers(),
      signal, // Pass the AbortSignal to axios
    });
    sendNetLog('info', `POST /translate -> ${response.status}`, {
      url: `${API}/translate`,
      method: 'POST',
      status: response.status,
    });

    return response.data;
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
