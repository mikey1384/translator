import Anthropic from '@anthropic-ai/sdk';
import log from 'electron-log';
import { AI_MODELS, normalizeAiModelId } from '@shared/constants';

const ANTHROPIC_MAX_TOKENS = 16000;
const ANTHROPIC_MAX_TOKENS_WITH_THINKING = 32000;

type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh';

// Legacy extended thinking budget tokens for Claude models that still support
// budget_tokens. Claude Opus 4.7 uses adaptive thinking instead.
const THINKING_BUDGET: Record<'low' | 'medium' | 'high', number> = {
  low: 0, // No extended thinking
  medium: 8000, // Moderate reasoning
  high: 16000, // Deep reasoning
};

type AnthropicThinkingConfig =
  | { enabled: false; maxTokens: number }
  | {
      enabled: true;
      maxTokens: number;
      apply: (requestParams: any) => void;
      logMessage: string;
    };

function resolveAnthropicThinkingConfig(
  normalizedModel: string,
  effort?: AnthropicEffort
): AnthropicThinkingConfig {
  if (!effort || effort === 'low') {
    return { enabled: false, maxTokens: ANTHROPIC_MAX_TOKENS };
  }

  if (normalizedModel === AI_MODELS.CLAUDE_OPUS) {
    return {
      enabled: true,
      maxTokens: ANTHROPIC_MAX_TOKENS_WITH_THINKING,
      apply: (requestParams) => {
        requestParams.thinking = { type: 'adaptive' };
        requestParams.output_config = {
          ...(requestParams.output_config || {}),
          effort,
        };
      },
      logMessage: `[anthropic-client] Adaptive thinking enabled with effort: ${effort}`,
    };
  }

  const legacyEffort = effort === 'xhigh' ? 'high' : effort;
  const budgetTokens = THINKING_BUDGET[legacyEffort];
  return {
    enabled: true,
    maxTokens: ANTHROPIC_MAX_TOKENS_WITH_THINKING,
    apply: (requestParams) => {
      requestParams.thinking = {
        type: 'enabled',
        budget_tokens: budgetTokens,
      };
    },
    logMessage: `[anthropic-client] Extended thinking enabled with budget: ${budgetTokens} tokens`,
  };
}

export interface AnthropicTranslateOptions {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
  effort?: AnthropicEffort;
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
}: AnthropicTranslateOptions): Promise<any> {
  const normalizedModel = normalizeAiModelId(model);
  const client = makeAnthropic(apiKey);

  // Extract system message if present
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

  // Ensure first message is from user (Anthropic requirement)
  if (userMessages.length === 0 || userMessages[0].role !== 'user') {
    userMessages.unshift({ role: 'user', content: 'Please proceed.' });
  }

  const thinkingConfig = resolveAnthropicThinkingConfig(
    normalizedModel,
    effort
  );

  // Build request parameters
  const requestParams: Anthropic.MessageCreateParams = {
    model: normalizedModel,
    max_tokens: thinkingConfig.maxTokens,
    messages: userMessages,
  };

  // Add system prompt if present (not compatible with extended thinking in some cases)
  if (systemPrompt && !thinkingConfig.enabled) {
    requestParams.system = systemPrompt;
  } else if (systemPrompt && thinkingConfig.enabled) {
    // Prepend system context to first user message when using extended thinking
    userMessages[0].content = `${systemPrompt}\n\n${userMessages[0].content}`;
  }

  if (thinkingConfig.enabled) {
    thinkingConfig.apply(requestParams);
    log.debug(thinkingConfig.logMessage);
  }

  const response = await client.messages.create(requestParams, { signal });

  // Extract text content, handling both regular and thinking responses
  let textContent = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      textContent += block.text;
    }
    // Skip 'thinking' blocks - they contain internal reasoning
  }

  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: textContent,
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

  const thinkingConfig = resolveAnthropicThinkingConfig(
    normalizedModel,
    effort
  );

  const requestParams: any = {
    model: normalizedModel,
    max_tokens: thinkingConfig.maxTokens,
    messages: userMessages,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
      },
    ],
  };

  if (systemPrompt && !thinkingConfig.enabled) {
    requestParams.system = systemPrompt;
  } else if (systemPrompt && thinkingConfig.enabled) {
    userMessages[0].content = `${systemPrompt}\n\n${userMessages[0].content}`;
  }

  if (thinkingConfig.enabled) {
    thinkingConfig.apply(requestParams);
  }

  let textContent = '';
  const stream = await client.messages.create(
    {
      ...requestParams,
      stream: true,
    },
    { signal }
  );

  for await (const event of stream as any) {
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
    // Make a minimal request to verify the key
    await client.messages.create(
      {
        model: AI_MODELS.CLAUDE_OPUS,
        max_tokens: 10,
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
