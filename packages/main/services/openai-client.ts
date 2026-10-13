import axios from 'axios';
import log from 'electron-log';
import type {
  ChatToolCall,
  ChatToolChoice,
  ChatToolDefinition,
} from '@shared-types/app';
import { AI_MODELS, normalizeAiModelId } from '@shared/constants';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

type OpenAiReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface OpenAiTranslateOptions {
  messages: any[];
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
  reasoning?: { effort?: OpenAiReasoningEffort };
  tools?: ChatToolDefinition[];
  toolChoice?: ChatToolChoice;
}

export interface OpenAiWebSearchOptions {
  messages: any[];
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
  reasoning?: { effort?: OpenAiReasoningEffort };
  onTextDelta?: (delta: string) => void;
}

/**
 * GPT-6 family (e.g. gpt-6.1-sol): always-on reasoning models. Reasoning
 * cannot be disabled ('none'/'minimal' are rejected), and function tools are
 * only available on the Responses API (Chat Completions has no tool calling).
 */
export function isGpt6FamilyModel(model?: string): boolean {
  return /^gpt-6(?:[.-]|$)/i.test(String(model || '').trim());
}

/**
 * Resolve the reasoning effort to send for a model. For GPT-6 models,
 * 'none'/'minimal'/absent map to 'low' (the cheapest supported level, and the
 * closest match to the no-reasoning default the previous GPT model had);
 * higher efforts pass through. Other models keep the caller's value as-is.
 */
export function resolveOpenAiReasoningEffort(
  model: string,
  effort?: OpenAiReasoningEffort
): OpenAiReasoningEffort | undefined {
  if (!isGpt6FamilyModel(model)) return effort;
  if (!effort || effort === 'none' || effort === 'minimal') return 'low';
  return effort;
}

function chatContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('');
  }
  if (content == null) return '';
  return String(content);
}

/**
 * Map chat-completions-style messages (system/user/assistant with
 * tool_calls, role:'tool' results) onto Responses API input items.
 */
export function toOpenAiResponsesInput(messages: any[]): any[] {
  const input: any[] = [];
  for (const msg of messages || []) {
    if (!msg) continue;
    const role = typeof msg.role === 'string' ? msg.role : 'user';

    if (role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: String(msg.tool_call_id || ''),
        output: chatContentToText(msg.content),
      });
      continue;
    }

    const text = chatContentToText(msg.content);
    if (role === 'assistant') {
      if (text.trim()) {
        input.push({ role: 'assistant', content: text });
      }
      for (const call of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
        const name = String(call?.function?.name || '').trim();
        if (!name) continue;
        const rawArgs = call?.function?.arguments;
        // Omit the output item `id`: replaying a function_call item id
        // without its paired reasoning item is rejected by the API.
        input.push({
          type: 'function_call',
          call_id: String(call?.id || ''),
          name,
          arguments:
            typeof rawArgs === 'string'
              ? rawArgs
              : JSON.stringify(rawArgs ?? {}),
        });
      }
      continue;
    }

    if (!text.trim()) continue;
    input.push({
      role:
        role === 'system' || role === 'developer' || role === 'user'
          ? role
          : 'user',
      content: text,
    });
  }
  return input;
}

export function toOpenAiResponsesTools(tools: ChatToolDefinition[]): any[] {
  return tools.map(tool => ({
    type: 'function',
    name: tool.function.name,
    ...(tool.function.description
      ? { description: tool.function.description }
      : {}),
    parameters: tool.function.parameters,
    // Chat Completions function tools are non-strict by default; keep that
    // contract (Responses defaults to strict, which rejects optional fields).
    strict: false,
  }));
}

/**
 * Map a Responses API result back to the chat-completions shape callers
 * consume (choices[0].message.content/tool_calls, usage prompt/completion).
 */
export function fromOpenAiResponsesResult(response: any): any {
  const output = Array.isArray(response?.output) ? response.output : [];
  const textParts: string[] = [];
  const toolCalls: ChatToolCall[] = [];
  for (const item of output) {
    if (item?.type === 'function_call') {
      const name = String(item?.name || '').trim();
      if (!name) continue;
      toolCalls.push({
        id: String(item?.call_id || item?.id || `call_${toolCalls.length}`),
        type: 'function',
        function: {
          name,
          arguments:
            typeof item?.arguments === 'string'
              ? item.arguments
              : JSON.stringify(item?.arguments ?? {}),
        },
      });
      continue;
    }
    if (item?.type === 'message' && Array.isArray(item?.content)) {
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part?.text === 'string') {
          textParts.push(part.text);
        }
      }
    }
  }

  const text =
    textParts.join('') ||
    (typeof response?.output_text === 'string' ? response.output_text : '');
  const usage = response?.usage;
  const promptTokens = Number(usage?.input_tokens) || 0;
  const completionTokens = Number(usage?.output_tokens) || 0;

  return {
    id: response?.id,
    object: 'chat.completion',
    model: response?.model,
    output_text: text,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason:
          toolCalls.length > 0
            ? 'tool_calls'
            : response?.status === 'incomplete'
              ? 'length'
              : 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens:
        Number(usage?.total_tokens) || promptTokens + completionTokens,
    },
  };
}

function openAiHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

export async function translateWithOpenAi({
  messages,
  model = AI_MODELS.GPT,
  apiKey,
  signal,
  reasoning,
  tools,
  toolChoice,
}: OpenAiTranslateOptions): Promise<any> {
  const normalizedModel = normalizeAiModelId(model);
  const hasTools = Array.isArray(tools) && tools.length > 0;
  const effort = resolveOpenAiReasoningEffort(
    normalizedModel,
    reasoning?.effort
  );

  // GPT-6 tool calling is only available on the Responses API. No
  // max_output_tokens is sent: reasoning tokens count toward it, so the
  // provider default (the model maximum) leaves the needed headroom.
  if (hasTools && isGpt6FamilyModel(normalizedModel)) {
    const payload: Record<string, any> = {
      model: normalizedModel,
      input: toOpenAiResponsesInput(messages),
      tools: toOpenAiResponsesTools(tools!),
      tool_choice: toolChoice === 'required' ? 'required' : 'auto',
    };
    if (effort) {
      payload.reasoning = { effort };
    }
    log.debug(
      `[openai-client] Using Responses API tool call (model=${normalizedModel}, effort=${effort})`
    );
    const response = await axios.post(`${OPENAI_BASE_URL}/responses`, payload, {
      headers: openAiHeaders(apiKey),
      signal,
    });
    return fromOpenAiResponsesResult(response.data);
  }

  const payload: Record<string, any> = {
    model: normalizedModel,
    messages,
  };

  if (hasTools) {
    payload.tools = tools;
    if (toolChoice === 'required') {
      payload.tool_choice = 'required';
    }
  }

  // Chat Completions API uses flat `reasoning_effort` parameter, not nested object
  if (effort) {
    payload.reasoning_effort = effort;
    log.debug(`[openai-client] Using reasoning_effort: ${effort}`);
  }

  const response = await axios.post(
    `${OPENAI_BASE_URL}/chat/completions`,
    payload,
    {
      headers: openAiHeaders(apiKey),
      signal,
    }
  );

  return response.data;
}

export function buildOpenAiWebSearchPayload({
  messages,
  model,
  reasoning,
}: {
  messages: any[];
  model: string;
  reasoning?: { effort?: OpenAiReasoningEffort };
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
    // OpenAI's web search tool is `web_search` for new integrations;
    // `web_search_preview` is legacy, kept for the GPT-5.x models it was used
    // with.
    tools: [
      {
        type: isGpt6FamilyModel(model) ? 'web_search' : 'web_search_preview',
      },
    ],
  };

  // GPT-6 reasoning cannot be disabled; resolve to a supported effort (>= low).
  const effort = resolveOpenAiReasoningEffort(model, reasoning?.effort);
  if (effort) {
    payload.reasoning = { effort };
    log.debug(`[openai-client] Using web-search reasoning.effort: ${effort}`);
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

export async function testOpenAiApiKey(
  apiKey: string,
  signal?: AbortSignal
): Promise<boolean> {
  const requestConfig = {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
    timeout: 10_000,
  };
  try {
    try {
      // Validate against the model the app actually uses for API-key users.
      await axios.get(
        `${OPENAI_BASE_URL}/models/${encodeURIComponent(AI_MODELS.GPT)}`,
        requestConfig
      );
    } catch (err: any) {
      // 404 means the key authenticated but this model is not visible to the
      // account; confirm the key itself with the model list.
      if (err?.response?.status !== 404) throw err;
      log.warn(
        `[openai-client] ${AI_MODELS.GPT} not visible to this key; validating via model list.`
      );
      await axios.get(`${OPENAI_BASE_URL}/models`, requestConfig);
    }
    return true;
  } catch (err: any) {
    log.warn('[openai-client] API key validation failed:', err?.message || err);
    throw err;
  }
}
