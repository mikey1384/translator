import Anthropic from '@anthropic-ai/sdk';
import log from 'electron-log';
import { AI_MODELS } from '@shared/constants';

const ANTHROPIC_MAX_TOKENS = 8192;

export interface AnthropicTranslateOptions {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  apiKey: string;
  signal?: AbortSignal;
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

  const response = await client.messages.create(
    {
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: systemPrompt,
      messages: userMessages,
    },
    { signal }
  );

  // Convert Anthropic response to OpenAI-compatible format
  const content =
    response.content[0]?.type === 'text' ? response.content[0].text : '';

  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
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
