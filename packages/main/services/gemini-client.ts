import log from 'electron-log';
import type {
  ChatToolCall,
  ChatToolChoice,
  ChatToolDefinition,
} from '@shared-types/app';
import { AI_MODELS, normalizeAiModelId } from '@shared/constants';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_REQUEST_TIMEOUT_MS = 600_000;
const GEMINI_KEY_TEST_TIMEOUT_MS = 15_000;
const GEMINI_MAX_TOKENS = 16_000;
const GEMINI_MAX_TOKENS_WITH_THINKING = 32_000;

export type GeminiEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type GeminiThinkingLevel =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export interface GeminiModelCapabilities {
  thinking: 'level-always' | 'level-minimal';
  defaultLevel: GeminiThinkingLevel;
  supportedLevels: readonly GeminiThinkingLevel[];
}

const DEFAULT_GEMINI_4_CAPABILITIES: GeminiModelCapabilities = {
  thinking: 'level-always',
  defaultLevel: 'low',
  supportedLevels: ['low', 'medium', 'high', 'xhigh'],
};

const GEMINI_MODEL_CAPABILITIES: Record<string, GeminiModelCapabilities> = {
  [AI_MODELS.GEMINI_FLASH_LITE]: {
    thinking: 'level-minimal',
    defaultLevel: 'minimal',
    supportedLevels: ['minimal', 'low', 'medium', 'high'],
  },
  [AI_MODELS.GEMINI_HYDROGEN]: DEFAULT_GEMINI_4_CAPABILITIES,
  [AI_MODELS.GEMINI_NEON]: DEFAULT_GEMINI_4_CAPABILITIES,
  [AI_MODELS.GEMINI_CARBON]: DEFAULT_GEMINI_4_CAPABILITIES,
};

export function getGeminiModelCapabilities(
  model: string
): GeminiModelCapabilities {
  const normalized = normalizeAiModelId(model).toLowerCase();
  return GEMINI_MODEL_CAPABILITIES[normalized] ?? DEFAULT_GEMINI_4_CAPABILITIES;
}

export function resolveGeminiThinkingConfig({
  model,
  effort,
  maxTokens = GEMINI_MAX_TOKENS,
}: {
  model: string;
  effort?: GeminiEffort;
  maxTokens?: number;
}): {
  thinkingOn: boolean;
  thinkingLevel: GeminiThinkingLevel;
  maxTokens: number;
} {
  const capabilities = getGeminiModelCapabilities(model);
  const normalizedEffort = effort ? String(effort).trim().toLowerCase() : '';

  let resolvedLevel: GeminiThinkingLevel = capabilities.defaultLevel;
  if (normalizedEffort) {
    if (
      capabilities.supportedLevels.includes(
        normalizedEffort as GeminiThinkingLevel
      )
    ) {
      resolvedLevel = normalizedEffort as GeminiThinkingLevel;
    } else if (normalizedEffort === 'xhigh') {
      resolvedLevel = 'high';
    }
  }

  const thinkingOn =
    capabilities.thinking === 'level-always' || resolvedLevel !== 'minimal';
  const resolvedMaxTokens = thinkingOn
    ? Math.max(maxTokens, GEMINI_MAX_TOKENS_WITH_THINKING)
    : maxTokens;

  return {
    thinkingOn,
    thinkingLevel: resolvedLevel,
    maxTokens: resolvedMaxTokens,
  };
}

export class GeminiIncompleteResponseError extends Error {
  constructor(
    readonly reason:
      | 'refusal'
      | 'max_tokens'
      | 'missing_tool_call'
      | 'malformed_tool_call'
      | 'empty'
      | 'other',
    detail?: string
  ) {
    super(
      `Gemini response not usable (${reason}${detail ? `: ${detail}` : ''})`
    );
    this.name = 'GeminiIncompleteResponseError';
  }
}

const GEMINI_REFUSAL_FINISH_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'IMAGE_SAFETY',
  'LANGUAGE',
]);

interface ChatMessage {
  role: string;
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function toGeminiContents(messages: ChatMessage[]): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<Record<string, unknown>>;
  }>;
} {
  const systemParts: string[] = [];
  const contents: Array<{
    role: 'user' | 'model';
    parts: Array<Record<string, unknown>>;
  }> = [];
  const toolNameByCallId = new Map<string, string>();

  const pushTurn = (
    role: 'user' | 'model',
    parts: Array<Record<string, unknown>>
  ) => {
    if (parts.length === 0) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
      return;
    }
    contents.push({ role, parts });
  };

  for (const msg of messages || []) {
    if (msg.role === 'system') {
      const text = String(msg.content || '').trim();
      if (text) systemParts.push(text);
      continue;
    }
    if (msg.role === 'tool') {
      const name =
        (msg.tool_call_id && toolNameByCallId.get(msg.tool_call_id)) ||
        'tool_result';
      const rawContent = String(msg.content || '');
      let parsedResponse: Record<string, unknown>;
      try {
        const parsed = JSON.parse(rawContent);
        parsedResponse =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { result: parsed };
      } catch {
        parsedResponse = { result: rawContent };
      }
      pushTurn('user', [
        {
          functionResponse: {
            name,
            response: parsedResponse,
          },
        },
      ]);
      continue;
    }
    if (msg.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      const text = String(msg.content || '');
      if (text.trim()) {
        parts.push({ text });
      }
      for (const call of msg.tool_calls || []) {
        if (call.id && call.function?.name) {
          toolNameByCallId.set(call.id, call.function.name);
        }
        parts.push({
          functionCall: {
            name: call.function.name,
            args: parseToolArguments(call.function.arguments),
          },
        });
      }
      pushTurn('model', parts);
      continue;
    }
    if (msg.role === 'user') {
      const text = String(msg.content || '');
      if (text.trim()) {
        pushTurn('user', [{ text }]);
      }
    }
  }

  if (contents.length === 0 || contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: 'Please proceed.' }] });
  }

  return {
    ...(systemParts.length > 0
      ? { systemInstruction: { parts: [{ text: systemParts.join('\n\n') }] } }
      : {}),
    contents,
  };
}

function toGeminiFunctionTools(tools: ChatToolDefinition[]): Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  }>;
}> {
  return [
    {
      functionDeclarations: tools.map(tool => ({
        name: tool.function.name,
        ...(tool.function.description
          ? { description: tool.function.description }
          : {}),
        parameters: tool.function.parameters,
      })),
    },
  ];
}

export function extractGeminiUsage(usageMetadata: any): {
  prompt_tokens: number;
  completion_tokens: number;
  thoughts_tokens: number;
} {
  const promptTokens =
    (Number(usageMetadata?.promptTokenCount) || 0) +
    (Number(usageMetadata?.toolUsePromptTokenCount) || 0);
  const candidatesTokens = Number(usageMetadata?.candidatesTokenCount) || 0;
  const thoughtsTokens = Number(usageMetadata?.thoughtsTokenCount) || 0;
  const totalTokens = Number(usageMetadata?.totalTokenCount) || 0;
  let completionTokens = candidatesTokens + thoughtsTokens;
  if (completionTokens <= 0 && totalTokens > promptTokens) {
    completionTokens = totalTokens - promptTokens;
  }
  return {
    prompt_tokens: Math.max(0, promptTokens),
    completion_tokens: Math.max(0, completionTokens),
    thoughts_tokens: Math.max(0, thoughtsTokens),
  };
}

export function assertGeminiCompletion(
  response: any,
  { requireToolCall = false }: { requireToolCall?: boolean } = {}
): { textContent: string; toolCalls: ChatToolCall[] } {
  const blockReason = response?.promptFeedback?.blockReason;
  if (blockReason && blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
    throw new GeminiIncompleteResponseError('refusal', String(blockReason));
  }

  const candidate = Array.isArray(response?.candidates)
    ? response.candidates[0]
    : undefined;
  if (!candidate) {
    throw new GeminiIncompleteResponseError('empty', 'no candidates');
  }

  const finishReason = String(candidate?.finishReason || '').toUpperCase();
  if (finishReason === 'MAX_TOKENS') {
    throw new GeminiIncompleteResponseError('max_tokens');
  }
  if (GEMINI_REFUSAL_FINISH_REASONS.has(finishReason)) {
    throw new GeminiIncompleteResponseError('refusal', finishReason);
  }
  if (finishReason === 'MALFORMED_FUNCTION_CALL') {
    throw new GeminiIncompleteResponseError(
      'malformed_tool_call',
      finishReason
    );
  }
  if (finishReason && finishReason !== 'STOP') {
    throw new GeminiIncompleteResponseError('other', finishReason);
  }

  const parts = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
    : [];
  let textContent = '';
  const toolCalls: ChatToolCall[] = [];
  let toolIndex = 0;

  for (const part of parts) {
    if (part?.thought === true) continue;
    if (typeof part?.text === 'string') {
      textContent += part.text;
    }
    if (part?.functionCall && typeof part.functionCall.name === 'string') {
      toolIndex += 1;
      toolCalls.push({
        id: `call_gemini_${toolIndex}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
    }
  }

  if (requireToolCall && toolCalls.length === 0) {
    throw new GeminiIncompleteResponseError('missing_tool_call');
  }
  if (!requireToolCall && !textContent.trim() && toolCalls.length === 0) {
    throw new GeminiIncompleteResponseError('empty');
  }

  return { textContent, toolCalls };
}

async function fetchGeminiJson({
  url,
  method = 'POST',
  apiKey,
  body,
  timeoutMs,
  signal,
}: {
  url: string;
  method?: 'GET' | 'POST';
  apiKey: string;
  body?: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'x-goog-api-key': apiKey,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const apiMessage =
        data?.error?.message ||
        data?.message ||
        `${response.status} ${response.statusText}`;
      const error: any = new Error(apiMessage);
      error.status = response.status;
      error.response = { status: response.status, data };
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
}

export interface GeminiTranslateOptions {
  messages: ChatMessage[];
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
  effort?: GeminiEffort;
  tools?: ChatToolDefinition[];
  toolChoice?: ChatToolChoice;
}

export async function translateWithGemini({
  messages,
  model = AI_MODELS.GEMINI_HYDROGEN,
  apiKey,
  signal,
  effort,
  tools,
  toolChoice,
}: GeminiTranslateOptions): Promise<{
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
      tool_calls?: ChatToolCall[];
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    thoughts_tokens: number;
  };
}> {
  const normalizedModel = normalizeAiModelId(model);
  const hasTools = Array.isArray(tools) && tools.length > 0;
  const forceToolUse = hasTools && toolChoice === 'required';
  const { systemInstruction, contents } = toGeminiContents(messages);
  const thinking = resolveGeminiThinkingConfig({
    model: normalizedModel,
    effort,
  });

  log.debug(
    `[gemini-client] translateWithGemini model=${normalizedModel} thinkingLevel=${thinking.thinkingLevel}`
  );

  const requestBody: Record<string, unknown> = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(hasTools
      ? {
          tools: toGeminiFunctionTools(tools!),
          toolConfig: {
            functionCallingConfig: {
              mode: forceToolUse ? 'ANY' : 'AUTO',
            },
          },
        }
      : {}),
    generationConfig: {
      maxOutputTokens: thinking.maxTokens,
      thinkingConfig: {
        thinkingLevel: thinking.thinkingLevel,
      },
    },
  };

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
  const response = await fetchGeminiJson({
    url,
    apiKey,
    body: requestBody,
    timeoutMs: GEMINI_REQUEST_TIMEOUT_MS,
    signal,
  });

  const { textContent, toolCalls } = assertGeminiCompletion(response, {
    requireToolCall: forceToolUse,
  });

  return {
    model: normalizedModel,
    choices: [
      {
        message: {
          role: 'assistant',
          content: textContent,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: extractGeminiUsage(response?.usageMetadata),
  };
}

export async function respondWithGeminiWebSearch({
  messages,
  model = AI_MODELS.GEMINI_NEON,
  apiKey,
  signal,
  effort,
  onTextDelta,
}: {
  messages: ChatMessage[];
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
  effort?: GeminiEffort;
  onTextDelta?: (delta: string) => void;
}): Promise<{
  model: string;
  content: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    thoughts_tokens: number;
  };
}> {
  const normalizedModel = normalizeAiModelId(model);
  const { systemInstruction, contents } = toGeminiContents(messages);
  const thinking = resolveGeminiThinkingConfig({
    model: normalizedModel,
    effort,
  });

  log.debug(
    `[gemini-client] respondWithGeminiWebSearch model=${normalizedModel} thinkingLevel=${thinking.thinkingLevel}`
  );

  const requestBody: Record<string, unknown> = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    tools: [{ google_search: {} }],
    generationConfig: {
      maxOutputTokens: thinking.maxTokens,
      thinkingConfig: {
        thinkingLevel: thinking.thinkingLevel,
      },
    },
  };

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
  const response = await fetchGeminiJson({
    url,
    apiKey,
    body: requestBody,
    timeoutMs: GEMINI_REQUEST_TIMEOUT_MS,
    signal,
  });

  const { textContent } = assertGeminiCompletion(response, {
    requireToolCall: false,
  });
  const trimmed = textContent.trim();
  if (!trimmed) {
    throw new GeminiIncompleteResponseError('empty', 'web search empty');
  }
  onTextDelta?.(trimmed);

  return {
    model: normalizedModel,
    content: trimmed,
    choices: [
      {
        message: {
          role: 'assistant',
          content: trimmed,
        },
      },
    ],
    usage: extractGeminiUsage(response?.usageMetadata),
  };
}

/**
 * Zero-cost API key validation against Google's models metadata endpoint.
 * Confirms the key is valid and can access Gemini 4 Neon without spending tokens.
 */
export async function testGeminiApiKey(apiKey: string): Promise<void> {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) {
    throw new Error('Missing API key');
  }
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(AI_MODELS.GEMINI_NEON)}`;
  const data = await fetchGeminiJson({
    url,
    method: 'GET',
    apiKey: trimmed,
    timeoutMs: GEMINI_KEY_TEST_TIMEOUT_MS,
  });
  if (!data || typeof data.name !== 'string') {
    throw new Error('Unexpected response from Gemini API');
  }
}
