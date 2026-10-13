import Anthropic from '@anthropic-ai/sdk';
import log from 'electron-log';
import type {
  ChatToolCall,
  ChatToolChoice,
  ChatToolDefinition,
} from '@shared-types/app';
import { AI_MODELS, normalizeAiModelId } from '@shared/constants';

const ANTHROPIC_MAX_TOKENS = 16000;
const ANTHROPIC_MAX_TOKENS_WITH_THINKING = 32000;
const ANTHROPIC_KEY_TEST_MAX_TOKENS = 16;

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh';

// Legacy extended thinking budget tokens for Claude models that still support
// budget_tokens.
const THINKING_BUDGET: Record<'low' | 'medium' | 'high', number> = {
  low: 0, // No extended thinking
  medium: 8000, // Moderate reasoning
  high: 16000, // Deep reasoning
};

/**
 * How each Claude model takes thinking and tool settings. Mirrors
 * openai-relay/anthropic-config.ts so BYO and credit requests share one
 * request shape per model:
 * - "budget": thinking via budget_tokens; off by omitting `thinking`.
 * - "adaptive-optional": adaptive thinking on request; off by omission.
 * - "adaptive-always": thinking can't be disabled (`disabled` and
 *   budget_tokens are 400s); effort is the only control (Opus 5.5).
 * - "between-tools-off": `disabled` is a 400; off is {type:"between_tools"},
 *   adaptive on request (Sonnet 5.5).
 * - "disabled-off": thinking runs unless turned off with {type:"disabled"},
 *   adaptive on request (Haiku 5.5).
 * forcedToolChoice=false: tool_choice any/tool is a 400; use auto plus an
 * instruction and verify a tool was called.
 */
export type ClaudeThinkingMode =
  | 'budget'
  | 'adaptive-optional'
  | 'adaptive-always'
  | 'between-tools-off'
  | 'disabled-off';

export interface ClaudeModelCapabilities {
  thinking: ClaudeThinkingMode;
  forcedToolChoice: boolean;
  webSearchTool: 'web_search_20250305' | 'web_search_20260209';
}

const LEGACY_CLAUDE_CAPABILITIES: ClaudeModelCapabilities = {
  thinking: 'budget',
  forcedToolChoice: true,
  webSearchTool: 'web_search_20250305',
};

const CLAUDE_MODEL_CAPABILITIES: Record<string, ClaudeModelCapabilities> = {
  'claude-opus-4-8': {
    thinking: 'adaptive-optional',
    forcedToolChoice: true,
    webSearchTool: 'web_search_20250305',
  },
  'claude-sonnet-5': {
    thinking: 'adaptive-optional',
    forcedToolChoice: true,
    webSearchTool: 'web_search_20250305',
  },
  'claude-opus-5-5': {
    thinking: 'adaptive-always',
    forcedToolChoice: false,
    webSearchTool: 'web_search_20260209',
  },
  'claude-sonnet-5-5': {
    thinking: 'between-tools-off',
    forcedToolChoice: false,
    webSearchTool: 'web_search_20260209',
  },
  'claude-haiku-5-5': {
    thinking: 'disabled-off',
    forcedToolChoice: true,
    webSearchTool: 'web_search_20250305',
  },
};

export function getClaudeModelCapabilities(
  model: string
): ClaudeModelCapabilities {
  return CLAUDE_MODEL_CAPABILITIES[model] ?? LEGACY_CLAUDE_CAPABILITIES;
}

export interface AnthropicThinkingConfig {
  // Whether reasoning tokens may be produced (affects max_tokens headroom and
  // the legacy system-prompt fold).
  thinkingOn: boolean;
  maxTokens: number;
  apply?: (requestParams: any) => void;
  logMessage?: string;
}

function adaptiveThinking(
  maxTokens: number,
  effort: AnthropicEffort,
  label: string
): AnthropicThinkingConfig {
  return {
    thinkingOn: true,
    maxTokens: Math.max(maxTokens, ANTHROPIC_MAX_TOKENS_WITH_THINKING),
    apply: requestParams => {
      requestParams.thinking = { type: 'adaptive' };
      requestParams.output_config = {
        ...(requestParams.output_config || {}),
        effort,
      };
    },
    logMessage: `[anthropic-client] Adaptive thinking (${label}) with effort: ${effort}`,
  };
}

export function resolveAnthropicThinkingConfig({
  model,
  effort,
  forceToolUse = false,
  maxTokens = ANTHROPIC_MAX_TOKENS,
}: {
  model: string;
  effort?: AnthropicEffort;
  forceToolUse?: boolean;
  maxTokens?: number;
}): AnthropicThinkingConfig {
  const { thinking: mode } = getClaudeModelCapabilities(model);
  const wantsThinking = Boolean(effort && effort !== 'low');

  if (mode === 'adaptive-always') {
    return adaptiveThinking(maxTokens, effort ?? 'low', 'always on');
  }

  if (mode === 'disabled-off') {
    if (wantsThinking && !forceToolUse) {
      return adaptiveThinking(maxTokens, effort!, 'on request');
    }
    return {
      thinkingOn: false,
      maxTokens,
      apply: requestParams => {
        requestParams.thinking = { type: 'disabled' };
      },
    };
  }

  if (mode === 'between-tools-off') {
    if (wantsThinking && !forceToolUse) {
      return adaptiveThinking(maxTokens, effort!, 'on request');
    }
    // `between_tools` takes no other field and is valid only at effort high
    // or below (the default), so effort is not sent with it.
    return {
      thinkingOn: false,
      maxTokens,
      apply: requestParams => {
        requestParams.thinking = { type: 'between_tools' };
      },
    };
  }

  // Anthropic rejects forced tool_choice combined with thinking on models
  // that allow forcing. The tool contract wins: drop thinking for that call.
  if (!wantsThinking || forceToolUse) {
    return { thinkingOn: false, maxTokens };
  }

  if (mode === 'adaptive-optional') {
    return adaptiveThinking(maxTokens, effort!, 'on request');
  }

  const legacyEffort = effort === 'xhigh' ? 'high' : effort!;
  const budgetTokens = THINKING_BUDGET[legacyEffort as 'medium' | 'high'];
  return {
    thinkingOn: true,
    maxTokens: ANTHROPIC_MAX_TOKENS_WITH_THINKING,
    apply: requestParams => {
      requestParams.thinking = {
        type: 'enabled',
        budget_tokens: budgetTokens,
      };
    },
    logMessage: `[anthropic-client] Extended thinking enabled with budget: ${budgetTokens} tokens`,
  };
}

/** Older models take system context folded into the first user turn when thinking. */
function foldsSystemPromptWhenThinking(model: string): boolean {
  const mode = getClaudeModelCapabilities(model).thinking;
  return mode === 'budget' || mode === 'adaptive-optional';
}

export const REQUIRED_TOOL_INSTRUCTION =
  'Respond by calling one of the provided tools. Do not answer in plain text.';

/**
 * A response that is not a usable answer: a refusal (stop_reason
 * "refusal"), output cut off at max_tokens, or a required tool call that
 * never came. Thrown so callers never treat an empty refusal as success.
 */
export class AnthropicIncompleteResponseError extends Error {
  constructor(
    readonly reason: 'refusal' | 'max_tokens' | 'missing_tool_call',
    detail?: string
  ) {
    super(
      `Claude response not usable (${reason}${detail ? `: ${detail}` : ''})`
    );
    this.name = 'AnthropicIncompleteResponseError';
  }
}

export function assertAnthropicCompletion(
  response: {
    stop_reason?: string | null;
    stop_details?: any;
    content?: any[];
  },
  { requireToolCall = false }: { requireToolCall?: boolean } = {}
): void {
  if (response?.stop_reason === 'refusal') {
    throw new AnthropicIncompleteResponseError(
      'refusal',
      response?.stop_details?.category ?? undefined
    );
  }
  if (response?.stop_reason === 'max_tokens') {
    throw new AnthropicIncompleteResponseError('max_tokens');
  }
  if (
    requireToolCall &&
    !(response?.content || []).some((block: any) => block?.type === 'tool_use')
  ) {
    throw new AnthropicIncompleteResponseError('missing_tool_call');
  }
}

export interface AnthropicTranslateOptions {
  messages: Array<{
    role: string;
    content: string | null;
    tool_calls?: ChatToolCall[];
    tool_call_id?: string;
  }>;
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
  effort?: AnthropicEffort;
  tools?: ChatToolDefinition[];
  toolChoice?: ChatToolChoice;
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

/**
 * Map chat-completions-style messages (system/user/assistant with
 * tool_calls, and role:'tool' results) onto Anthropic Messages blocks.
 */
export function toAnthropicMessages(
  messages: AnthropicTranslateOptions['messages']
): {
  systemPrompt: string | undefined;
  anthropicMessages: Array<{ role: 'user' | 'assistant'; content: any }>;
} {
  let systemPrompt: string | undefined;
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: any }> =
    [];

  const pushToolResult = (toolCallId: string, content: string) => {
    const block = {
      type: 'tool_result',
      tool_use_id: toolCallId,
      content,
    };
    const last = anthropicMessages[anthropicMessages.length - 1];
    // Anthropic requires tool results for parallel tool calls to share
    // one user message.
    if (last && last.role === 'user' && Array.isArray(last.content)) {
      last.content.push(block);
      return;
    }
    anthropicMessages.push({ role: 'user', content: [block] });
  };

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = String(msg.content || '');
      continue;
    }
    if (msg.role === 'tool') {
      if (msg.tool_call_id) {
        pushToolResult(msg.tool_call_id, String(msg.content || ''));
      }
      continue;
    }
    if (msg.role === 'assistant') {
      const blocks: any[] = [];
      const text = String(msg.content || '');
      if (text.trim()) {
        blocks.push({ type: 'text', text });
      }
      for (const call of msg.tool_calls || []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: parseToolArguments(call.function.arguments),
        });
      }
      if (blocks.length > 0) {
        anthropicMessages.push({ role: 'assistant', content: blocks });
      }
      continue;
    }
    if (msg.role === 'user') {
      const text = String(msg.content || '');
      if (text.trim()) {
        anthropicMessages.push({ role: 'user', content: text });
      }
    }
  }

  if (anthropicMessages.length === 0 || anthropicMessages[0].role !== 'user') {
    anthropicMessages.unshift({ role: 'user', content: 'Please proceed.' });
  }

  return { systemPrompt, anthropicMessages };
}

export function toAnthropicTools(tools: ChatToolDefinition[]): Array<{
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}> {
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

export function extractAnthropicToolCalls(
  content: Array<{ type: string; [key: string]: unknown }>
): ChatToolCall[] {
  const toolCalls: ChatToolCall[] = [];
  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    toolCalls.push({
      id: String(block.id || ''),
      type: 'function',
      function: {
        name: String(block.name || ''),
        arguments: JSON.stringify(block.input ?? {}),
      },
    });
  }
  return toolCalls;
}

export interface AnthropicWebSearchOptions {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
  effort?: AnthropicEffort;
  onTextDelta?: (delta: string) => void;
}

function makeAnthropic(apiKey: string) {
  return new Anthropic({
    apiKey,
    timeout: 600_000,
    maxRetries: 3,
  });
}

export async function translateWithAnthropic({
  messages,
  model = AI_MODELS.CLAUDE_OPUS,
  apiKey,
  signal,
  effort,
  tools,
  toolChoice,
}: AnthropicTranslateOptions): Promise<any> {
  const normalizedModel = normalizeAiModelId(model);
  const client = makeAnthropic(apiKey);
  const hasTools = Array.isArray(tools) && tools.length > 0;
  const forceToolUse = hasTools && toolChoice === 'required';

  const capabilities = getClaudeModelCapabilities(normalizedModel);
  // Models that reject forced tool_choice get auto plus an instruction, and
  // the response is checked for the required call below.
  const instructToolUse = forceToolUse && !capabilities.forcedToolChoice;

  const { systemPrompt, anthropicMessages } = toAnthropicMessages(messages);

  const thinkingConfig = resolveAnthropicThinkingConfig({
    model: normalizedModel,
    effort,
    forceToolUse,
  });

  // Untyped: the installed SDK types predate adaptive/between_tools thinking
  // and output_config.
  const requestParams: Record<string, any> = {
    model: normalizedModel,
    max_tokens: thinkingConfig.maxTokens,
    messages: anthropicMessages,
  };

  const effectiveSystemPrompt = instructToolUse
    ? [systemPrompt, REQUIRED_TOOL_INSTRUCTION].filter(Boolean).join('\n\n')
    : systemPrompt;

  if (hasTools) {
    requestParams.tools = toAnthropicTools(tools);
    if (forceToolUse && capabilities.forcedToolChoice) {
      requestParams.tool_choice = { type: 'any' };
    }
    // Tool flows need the system prompt intact — never fold it into the
    // first user turn.
    if (effectiveSystemPrompt) {
      requestParams.system = effectiveSystemPrompt;
    }
  } else if (
    effectiveSystemPrompt &&
    thinkingConfig.thinkingOn &&
    foldsSystemPromptWhenThinking(normalizedModel)
  ) {
    // Older models: prepend system context to the first user message when
    // using extended thinking.
    const first = anthropicMessages[0];
    if (typeof first.content === 'string') {
      first.content = `${effectiveSystemPrompt}\n\n${first.content}`;
    } else {
      requestParams.system = effectiveSystemPrompt;
    }
  } else if (effectiveSystemPrompt) {
    requestParams.system = effectiveSystemPrompt;
  }

  if (thinkingConfig.apply) {
    thinkingConfig.apply(requestParams);
    if (thinkingConfig.logMessage) log.debug(thinkingConfig.logMessage);
  }

  const response = await client.messages.create(
    requestParams as Anthropic.MessageCreateParamsNonStreaming,
    { signal }
  );
  assertAnthropicCompletion(response as any, { requireToolCall: forceToolUse });

  // Extract text content, handling both regular and thinking responses
  let textContent = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      textContent += block.text;
    }
    // Skip 'thinking' blocks - they contain internal reasoning
  }

  const toolCalls = extractAnthropicToolCalls(response.content as any);

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
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
    },
  };
}

export async function respondWithAnthropicWebSearch({
  messages,
  model = AI_MODELS.CLAUDE_OPUS,
  apiKey,
  signal,
  effort,
  onTextDelta,
}: AnthropicWebSearchOptions): Promise<any> {
  const normalizedModel = normalizeAiModelId(model);
  const client = makeAnthropic(apiKey);

  let systemPrompt: string | undefined;
  const userMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
    [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      userMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }
  }

  if (userMessages.length === 0 || userMessages[0].role !== 'user') {
    userMessages.unshift({ role: 'user', content: 'Please proceed.' });
  }

  const thinkingConfig = resolveAnthropicThinkingConfig({
    model: normalizedModel,
    effort,
  });

  const requestParams: any = {
    model: normalizedModel,
    max_tokens: thinkingConfig.maxTokens,
    messages: userMessages,
    tools: [
      {
        type: getClaudeModelCapabilities(normalizedModel).webSearchTool,
        name: 'web_search',
      },
    ],
  };

  if (
    systemPrompt &&
    thinkingConfig.thinkingOn &&
    foldsSystemPromptWhenThinking(normalizedModel)
  ) {
    userMessages[0].content = `${systemPrompt}\n\n${userMessages[0].content}`;
  } else if (systemPrompt) {
    requestParams.system = systemPrompt;
  }

  if (thinkingConfig.apply) {
    thinkingConfig.apply(requestParams);
  }

  let textContent = '';
  let stopReason: string | null = null;
  let stopDetails: any = null;
  const stream = await client.messages.create(
    {
      ...requestParams,
      stream: true,
    },
    { signal }
  );

  for await (const event of stream as any) {
    if (event?.type === 'message_delta') {
      if (event?.delta?.stop_reason) stopReason = event.delta.stop_reason;
      if (event?.delta?.stop_details) stopDetails = event.delta.stop_details;
      continue;
    }
    if (
      event?.type === 'content_block_delta' &&
      event?.delta?.type === 'text_delta' &&
      typeof event?.delta?.text === 'string'
    ) {
      const delta = event.delta.text;
      textContent += delta;
      try {
        onTextDelta?.(delta);
      } catch {
        // Ignore observer callback errors.
      }
      continue;
    }
    if (
      event?.type === 'content_block_start' &&
      event?.content_block?.type === 'text' &&
      typeof event?.content_block?.text === 'string'
    ) {
      const initial = event.content_block.text;
      if (initial) {
        textContent += initial;
        try {
          onTextDelta?.(initial);
        } catch {
          // Ignore observer callback errors.
        }
      }
    }
  }

  assertAnthropicCompletion({
    stop_reason: stopReason,
    stop_details: stopDetails,
  });

  if (!textContent.trim()) {
    throw new Error('Anthropic web-search stream returned no text content.');
  }

  return {
    model: normalizedModel,
    choices: [
      {
        message: {
          role: 'assistant',
          content: textContent,
        },
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
    },
  };
}

export async function testAnthropicApiKey(
  apiKey: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const client = makeAnthropic(apiKey);
    // Make a minimal request to verify the key. Haiku with thinking
    // explicitly disabled keeps it cheap; any 200 proves the key works, so a
    // max_tokens (or other) stop reason is deliberately not checked here.
    await client.messages.create(
      {
        model: AI_MODELS.CLAUDE_HAIKU,
        max_tokens: ANTHROPIC_KEY_TEST_MAX_TOKENS,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: 'Hi' }],
      },
      { signal }
    );
    return true;
  } catch (err: any) {
    log.warn(
      '[anthropic-client] API key validation failed:',
      err?.message || err
    );
    throw err;
  }
}
