import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import log from 'electron-log';
import type { DubSegmentPayload } from '@shared-types/app';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAiTranscribeOptions {
  filePath: string;
  promptContext?: string;
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
}

export interface OpenAiTranslateOptions {
  messages: any[];
  model?: string;
  temperature?: number;
  apiKey: string;
  signal?: AbortSignal;
}

export interface OpenAiDubOptions {
  segments: Array<
    Pick<
      DubSegmentPayload,
      'index' | 'translation' | 'original' | 'targetDuration'
    >
  >;
  voice?: string;
  model?: string;
  format?: string;
  apiKey: string;
  signal?: AbortSignal;
  concurrency?: number;
}

export interface OpenAiDubResult {
  audioBase64?: string;
  format: string;
  voice: string;
  model: string;
  segments?: Array<{
    index: number;
    audioBase64: string;
    targetDuration?: number;
  }>;
}

export async function transcribeWithOpenAi({
  filePath,
  promptContext,
  model = 'whisper-1',
  apiKey,
  signal,
}: OpenAiTranscribeOptions): Promise<any> {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  if (promptContext) {
    form.append('prompt', promptContext);
  }

  const headers = {
    ...form.getHeaders(),
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await axios.post(
    `${OPENAI_BASE_URL}/audio/transcriptions`,
    form,
    {
      headers,
      signal,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  return response.data;
}

export async function translateWithOpenAi({
  messages,
  model = 'gpt-4.1',
  temperature,
  apiKey,
  signal,
}: OpenAiTranslateOptions): Promise<any> {
  const payload: Record<string, any> = {
    model,
    messages,
  };
  if (typeof temperature === 'number') {
    payload.temperature = temperature;
  }

  const response = await axios.post(
    `${OPENAI_BASE_URL}/chat/completions`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
    }
  );

  return response.data;
}

export async function synthesizeDubWithOpenAi({
  segments,
  voice = 'alloy',
  model = 'tts-1',
  format = 'mp3',
  apiKey,
  signal,
  concurrency = 3,
}: OpenAiDubOptions): Promise<OpenAiDubResult> {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('No segments provided for dubbing.');
  }

  const limiter = Math.max(1, Math.min(5, concurrency));
  const queue = [...segments];
  const out: Array<{
    index: number;
    audioBase64: string;
    targetDuration?: number;
  }> = [];

  let active = 0;
  let error: any = null;

  await new Promise<void>(resolve => {
    const pump = () => {
      if (error) {
        if (active === 0) resolve();
        return;
      }
      if (queue.length === 0) {
        if (active === 0) resolve();
        return;
      }
      if (active >= limiter) {
        return;
      }

      const seg = queue.shift();
      if (!seg) {
        if (active === 0) resolve();
        return;
      }

      const text = (seg.translation || seg.original || '').trim();
      if (!text) {
        out.push({
          index: seg.index ?? out.length,
          audioBase64: '',
          targetDuration: seg.targetDuration,
        });
        pump();
        return;
      }

      active += 1;

      axios
        .post(
          `${OPENAI_BASE_URL}/audio/speech`,
          {
            model,
            voice,
            input: text,
            format,
          },
          {
            responseType: 'arraybuffer',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            signal,
          }
        )
        .then(res => {
          const buffer = Buffer.from(res.data as ArrayBuffer);
          out.push({
            index: seg.index ?? out.length,
            audioBase64: buffer.toString('base64'),
            targetDuration: seg.targetDuration,
          });
        })
        .catch(err => {
          error = err;
          log.error('[openai-client] Dub synthesis failed:', err);
        })
        .finally(() => {
          active -= 1;
          pump();
        });

      pump();
    };

    for (let i = 0; i < limiter; i++) {
      pump();
    }
  });

  if (error) {
    throw error;
  }

  out.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  return {
    format,
    voice,
    model,
    segments: out,
  };
}

export async function testOpenAiApiKey(
  apiKey: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    await axios.get(`${OPENAI_BASE_URL}/models/gpt-4o-mini`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
      timeout: 10_000,
    });
    return true;
  } catch (err: any) {
    log.warn('[openai-client] API key validation failed:', err?.message || err);
    throw err;
  }
}
