import axios from 'axios';
import FormData from 'form-data';
import log from 'electron-log';
import type { DubSegmentPayload } from '@shared-types/app';
import { AI_MODELS, normalizeAiModelId } from '@shared/constants';
import { createAbortableReadStream } from '../utils/abortable-file-stream.js';

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
  apiKey: string;
  signal?: AbortSignal;
  reasoning?: { effort?: 'low' | 'medium' | 'high' };
}

export interface OpenAiWebSearchOptions {
  messages: any[];
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
  reasoning?: { effort?: 'low' | 'medium' | 'high' };
  onTextDelta?: (delta: string) => void;
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
  model = AI_MODELS.WHISPER,
  apiKey,
  signal,
}: OpenAiTranscribeOptions): Promise<any> {
  const form = new FormData();
  const { stream, cleanup } = createAbortableReadStream(filePath, signal);
  try {
    form.append('file', stream);
  } catch {
    cleanup();
    throw new Error('Failed to open audio file for transcription');
  }
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  // Request word-level timestamps for better subtitle segmentation
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  if (promptContext) {
    form.append('prompt', promptContext);
  }

  const headers = {
    ...form.getHeaders(),
    Authorization: `Bearer ${apiKey}`,
  };

  try {
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
  } finally {
    cleanup();
  }
}

export async function translateWithOpenAi({
  messages,
  model = AI_MODELS.GPT,
  apiKey,
  signal,
  reasoning,
}: OpenAiTranslateOptions): Promise<any> {
  const normalizedModel = normalizeAiModelId(model);
  const payload: Record<string, any> = {
    model: normalizedModel,
    messages,
  };

  // Add reasoning_effort for models that support it (e.g., GPT-5.1)
  // Chat Completions API uses flat `reasoning_effort` parameter, not nested object
  if (reasoning?.effort) {
    payload.reasoning_effort = reasoning.effort;
    log.debug(`[openai-client] Using reasoning_effort: ${reasoning.effort}`);
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

function buildOpenAiWebSearchPayload({
  messages,
  model,
  reasoning,
}: {
  messages: any[];
  model: string;
  reasoning?: { effort?: 'low' | 'medium' | 'high' };
}): Record<string, any> {
  const payload: Record<string, any> = {
    model,
    input: (messages || [])
      .map((msg: any) => {
        const roleRaw = typeof msg?.role === 'string' ? msg.role : 'user';
        const role =
          roleRaw === 'system' || roleRaw === 'assistant' || roleRaw === 'user'
            ? roleRaw
            : 'user';
        const text = String(msg?.content || '').trim();
        if (!text) return null;
        return {
          role,
          content: [
            {
              type: 'input_text',
              text,
            },
          ],
        };
      })
      .filter(Boolean),
    tools: [{ type: 'web_search_preview' }],
  };

  if (reasoning?.effort) {
    payload.reasoning = { effort: reasoning.effort };
    log.debug(
      `[openai-client] Using web-search reasoning.effort: ${reasoning.effort}`
    );
  }
  return payload;
}

function extractTextFromResponseObject(response: any): string {
  if (!response) return '';
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  if (Array.isArray(response.output_text)) {
    const joined = response.output_text
      .map((part: any) => (typeof part === 'string' ? part : ''))
      .join('')
      .trim();
    if (joined) return joined;
  }
  if (Array.isArray(response.output)) {
    const chunks: string[] = [];
    for (const item of response.output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (typeof part?.text === 'string' && part.text.trim()) {
          chunks.push(part.text.trim());
        }
      }
    }
    const joined = chunks.join('\n').trim();
    if (joined) return joined;
  }
  return '';
}

function extractOpenAiStreamDelta(eventPayload: any): string {
  if (!eventPayload || typeof eventPayload !== 'object') return '';
  if (
    eventPayload.type === 'response.output_text.delta' &&
    typeof eventPayload.delta === 'string'
  ) {
    return eventPayload.delta;
  }
  if (
    typeof eventPayload.delta?.text === 'string' &&
    eventPayload.delta.text.trim()
  ) {
    return eventPayload.delta.text;
  }
  return '';
}

export async function respondWithOpenAiWebSearch({
  messages,
  model = AI_MODELS.GPT,
  apiKey,
  signal,
  reasoning,
  onTextDelta,
}: OpenAiWebSearchOptions): Promise<any> {
  const normalizedModel = normalizeAiModelId(model);
  const payload = buildOpenAiWebSearchPayload({
    messages,
    model: normalizedModel,
    reasoning,
  });
  const streamPayload = {
    ...payload,
    stream: true,
  };

  const response = await axios.post(
    `${OPENAI_BASE_URL}/responses`,
    streamPayload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'stream',
      signal,
    }
  );
  const stream = response.data as NodeJS.ReadableStream;

  let rawBuffer = '';
  let textContent = '';
  let resolvedModel = normalizedModel;

  const processSseEvent = (rawEvent: string) => {
    const lines = rawEvent
      .split(/\r?\n/)
      .map(line => line.trimEnd())
      .filter(Boolean);
    if (lines.length === 0) return;
    const dataLines = lines
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart());
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') return;

    try {
      const eventPayload = JSON.parse(data);
      const modelFromEvent =
        typeof eventPayload?.response?.model === 'string'
          ? eventPayload.response.model
          : typeof eventPayload?.model === 'string'
            ? eventPayload.model
            : '';
      if (modelFromEvent) {
        resolvedModel = normalizeAiModelId(modelFromEvent);
      }

      const delta = extractOpenAiStreamDelta(eventPayload);
      if (delta) {
        textContent += delta;
        try {
          onTextDelta?.(delta);
        } catch {
          // Ignore observer callback errors.
        }
      }

      if (eventPayload?.type === 'response.completed' && !textContent.trim()) {
        const fromResponse = extractTextFromResponseObject(
          eventPayload.response
        );
        if (fromResponse) {
          textContent = fromResponse;
        }
      }
    } catch {
      // Ignore malformed SSE payloads.
    }
  };

  const flushSseBuffer = (flushTail = false) => {
    let nextEventIndex = rawBuffer.indexOf('\n\n');
    while (nextEventIndex !== -1) {
      const rawEvent = rawBuffer.slice(0, nextEventIndex);
      rawBuffer = rawBuffer.slice(nextEventIndex + 2);
      processSseEvent(rawEvent);
      nextEventIndex = rawBuffer.indexOf('\n\n');
    }
    if (flushTail) {
      const tail = rawBuffer.trim();
      if (tail) processSseEvent(tail);
      rawBuffer = '';
    }
  };

  await new Promise<void>((resolve, reject) => {
    stream.setEncoding?.('utf8');
    stream.on('data', (chunk: Buffer | string) => {
      rawBuffer += String(chunk).replace(/\r\n/g, '\n');
      flushSseBuffer(false);
    });
    stream.on('end', () => {
      flushSseBuffer(true);
      resolve();
    });
    stream.on('error', reject);
  });

  const finalized = textContent.trim();
  if (!finalized) {
    throw new Error('OpenAI web-search stream returned no text content.');
  }

  return {
    model: resolvedModel,
    output_text: finalized,
    choices: [
      {
        message: {
          role: 'assistant',
          content: finalized,
        },
      },
    ],
  };
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
    await axios.get(`${OPENAI_BASE_URL}/models/gpt-5-mini`, {
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
