import axios from 'axios';
import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import FormData from 'form-data';
import { AI_MODELS } from '../../shared/constants/index.js';

const API = 'https://api.stage5.tools';

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
  model = 'whisper-1',
  signal,
}: {
  filePath: string;
  language?: string;
  promptContext?: string;
  model?: string;
  signal?: AbortSignal;
}) {
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
    const response = await axios.post(`${API}/transcribe`, fd, {
      headers: {
        ...headers(),
        ...fd.getHeaders(), // Let form-data set the proper boundary
      },
      signal, // Pass the AbortSignal to axios
    });
    
    return response.data;
  } catch (error: any) {
    // Handle cancellation specifically
    if (error.name === 'AbortError' || error.code === 'ERR_CANCELED' || signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }
    
    // Handle insufficient credits with a friendly error message
    if (error.response?.status === 402) {
      throw new Error('insufficient-credits');
    }
    
    // Re-throw other errors as-is
    throw error;
  }
}

export async function translate({
  messages,
  model = AI_MODELS.GPT,
  temperature = 0.4,
  signal,
}: {
  messages: any[];
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}) {
  // Check if already cancelled before starting
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  try {
    const response = await axios.post(
      `${API}/translate`,
      { messages, model, temperature },
      { 
        headers: headers(),
        signal, // Pass the AbortSignal to axios
      }
    );

    return response.data;
  } catch (error: any) {
    // Handle cancellation specifically
    if (error.name === 'AbortError' || error.code === 'ERR_CANCELED' || signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }
    
    // Handle insufficient credits with a friendly error message
    if (error.response?.status === 402) {
      throw new Error('insufficient-credits');
    }
    
    // Re-throw other errors as-is
    throw error;
  }
}
