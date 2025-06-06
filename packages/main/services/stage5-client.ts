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
}: {
  filePath: string;
  language?: string;
  promptContext?: string;
  model?: string;
}) {
  const fd = new FormData();
  fd.append('file', fs.createReadStream(filePath));

  if (language) {
    fd.append('language', language);
  }

  if (promptContext) {
    fd.append('prompt', promptContext);
  }

  fd.append('model', model);

  const response = await axios.post(`${API}/transcribe`, fd, {
    headers: {
      ...headers(),
      ...fd.getHeaders(), // Let form-data set the proper boundary
    },
  });

  return response.data;
}

export async function translate({
  messages,
  model = AI_MODELS.GPT,
  temperature = 0.4,
}: {
  messages: any[];
  model?: string;
  temperature?: number;
}) {
  const response = await axios.post(
    `${API}/translate`,
    { messages, model, temperature },
    { headers: headers() }
  );

  return response.data;
}
