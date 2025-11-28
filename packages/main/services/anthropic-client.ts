import Anthropic from '@anthropic-ai/sdk';
import log from 'electron-log';
import { AI_MODELS } from '@shared/constants';

const ANTHROPIC_MAX_TOKENS = 16000;
const ANTHROPIC_MAX_TOKENS_WITH_THINKING = 32000;

// Extended thinking budget tokens by effort level
const THINKING_BUDGET: Record<'low' | 'medium' | 'high', number> = {
  low: 0, // No extended thinking
  medium: 8000, // Moderate reasoning
  high: 16000, // Deep reasoning
};

export interface AnthropicTranslateOptions {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
  effort?: 'low' | 'medium' | 'high';
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

  // Determine if extended thinking should be enabled
  const budgetTokens = effort ? THINKING_BUDGET[effort] : 0;
  const useExtendedThinking = budgetTokens > 0;

  // Build request parameters
  const requestParams: Anthropic.MessageCreateParams = {
    model,
    max_tokens: useExtendedThinking
      ? ANTHROPIC_MAX_TOKENS_WITH_THINKING
      : ANTHROPIC_MAX_TOKENS,
    messages: userMessages,
  };

  // Add system prompt if present (not compatible with extended thinking in some cases)
  if (systemPrompt && !useExtendedThinking) {
    requestParams.system = systemPrompt;
  } else if (systemPrompt && useExtendedThinking) {
    // Prepend system context to first user message when using extended thinking
    userMessages[0].content = `${systemPrompt}\n\n${userMessages[0].content}`;
  }

  // Add extended thinking configuration
  if (useExtendedThinking) {
    (requestParams as any).thinking = {
      type: 'enabled',
      budget_tokens: budgetTokens,
    };
    log.debug(
      `[anthropic-client] Extended thinking enabled with budget: ${budgetTokens} tokens`
    );
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
