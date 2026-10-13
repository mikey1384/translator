import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import axios from 'axios';

import {
  buildOpenAiWebSearchPayload,
  resolveOpenAiReasoningEffort,
  testOpenAiApiKey,
  translateWithOpenAi,
} from '../services/openai-client.js';

type Captured = { url: string; payload: any };

const originalPost = axios.post;
const originalGet = axios.get;

afterEach(() => {
  (axios as any).post = originalPost;
  (axios as any).get = originalGet;
});

function stubPost(responseData: any): Captured[] {
  const calls: Captured[] = [];
  (axios as any).post = async (url: string, payload: any) => {
    calls.push({ url, payload });
    return { data: responseData };
  };
  return calls;
}

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_youtube',
      description: 'Search YouTube',
      parameters: {
        type: 'object',
        properties: { queries: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
];

const TOOL_CONVERSATION = [
  { role: 'system', content: 'You are a recommender.' },
  { role: 'user', content: 'find me cooking videos' },
  {
    role: 'assistant',
    content: 'Searching.',
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'search_youtube',
          arguments: '{"queries":["korean cooking"]}',
        },
      },
    ],
  },
  { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
];

test('gpt-6.1-sol tool calls go through the Responses API with mapped shapes', async () => {
  const calls = stubPost({
    id: 'resp_1',
    model: 'gpt-6.1-sol',
    status: 'completed',
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Here you go.' }],
      },
      {
        type: 'function_call',
        id: 'fc_9',
        call_id: 'call_2',
        name: 'search_youtube',
        arguments: '{"queries":["kimchi"]}',
      },
    ],
    usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165 },
  });

  const result = await translateWithOpenAi({
    messages: TOOL_CONVERSATION,
    model: 'gpt-6.1-sol',
    apiKey: 'sk-test',
    tools: TOOLS,
    toolChoice: 'required',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  const payload = calls[0].payload;
  assert.equal(payload.model, 'gpt-6.1-sol');
  assert.equal(payload.messages, undefined);
  assert.equal(payload.tool_choice, 'required');
  assert.deepEqual(payload.reasoning, { effort: 'low' });
  assert.equal(payload.reasoning_effort, undefined);
  assert.equal(payload.max_output_tokens, undefined);
  assert.deepEqual(payload.tools, [
    {
      type: 'function',
      name: 'search_youtube',
      description: 'Search YouTube',
      parameters: TOOLS[0].function.parameters,
      strict: false,
    },
  ]);
  assert.deepEqual(payload.input, [
    { role: 'system', content: 'You are a recommender.' },
    { role: 'user', content: 'find me cooking videos' },
    { role: 'assistant', content: 'Searching.' },
    {
      type: 'function_call',
      call_id: 'call_1',
      name: 'search_youtube',
      arguments: '{"queries":["korean cooking"]}',
    },
    { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
  ]);

  assert.equal(result.model, 'gpt-6.1-sol');
  assert.equal(result.choices[0].message.content, 'Here you go.');
  assert.deepEqual(result.choices[0].message.tool_calls, [
    {
      id: 'call_2',
      type: 'function',
      function: { name: 'search_youtube', arguments: '{"queries":["kimchi"]}' },
    },
  ]);
  assert.equal(result.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(result.usage, {
    prompt_tokens: 120,
    completion_tokens: 45,
    total_tokens: 165,
  });
});

test('gpt-6.1-sol tool-only turn maps to null content and auto tool_choice', async () => {
  const calls = stubPost({
    id: 'resp_2',
    model: 'gpt-6.1-sol',
    output: [
      {
        type: 'function_call',
        call_id: 'call_x',
        name: 'search_youtube',
        arguments: '{}',
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  const result = await translateWithOpenAi({
    messages: [{ role: 'user', content: 'hi' }],
    model: 'gpt-6.1-sol',
    apiKey: 'sk-test',
    reasoning: { effort: 'high' },
    tools: TOOLS,
  });

  assert.equal(calls[0].payload.tool_choice, 'auto');
  assert.deepEqual(calls[0].payload.reasoning, { effort: 'high' });
  assert.equal(result.choices[0].message.content, null);
  assert.equal(result.choices[0].message.tool_calls[0].id, 'call_x');
  assert.equal(result.usage.total_tokens, 15);
});

test('gpt-6.1-sol never sends none/minimal reasoning effort', async () => {
  for (const effort of ['none', 'minimal', undefined] as const) {
    const calls = stubPost({ choices: [{ message: { content: 'ok' } }] });
    await translateWithOpenAi({
      messages: [{ role: 'user', content: 'translate' }],
      model: 'gpt-6.1-sol',
      apiKey: 'sk-test',
      reasoning: effort ? { effort } : undefined,
    });
    assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(calls[0].payload.reasoning_effort, 'low');
  }

  assert.equal(resolveOpenAiReasoningEffort('gpt-6.1-sol', 'medium'), 'medium');
  assert.equal(resolveOpenAiReasoningEffort('gpt-6.1-sol', 'xhigh'), 'xhigh');
  assert.equal(resolveOpenAiReasoningEffort('gpt-6.1-sol', 'none'), 'low');
  assert.equal(resolveOpenAiReasoningEffort('gpt-5.5', undefined), undefined);
});

test('saved gpt-5.1 normalizes to gpt-6.1-sol and gets a supported effort', async () => {
  const calls = stubPost({ choices: [{ message: { content: 'ok' } }] });
  await translateWithOpenAi({
    messages: [{ role: 'user', content: 'translate' }],
    model: 'gpt-5.1',
    apiKey: 'sk-test',
  });
  assert.equal(calls[0].payload.model, 'gpt-6.1-sol');
  assert.equal(calls[0].payload.reasoning_effort, 'low');
});

test('gpt-5.5 request shapes are unchanged (chat completions, tools inline)', async () => {
  const calls = stubPost({ choices: [{ message: { content: 'ok' } }] });
  const messages = [{ role: 'user', content: 'hi' }];
  await translateWithOpenAi({
    messages,
    model: 'gpt-5.5',
    apiKey: 'sk-test',
    tools: TOOLS,
    toolChoice: 'required',
  });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.deepEqual(calls[0].payload, {
    model: 'gpt-5.5',
    messages,
    tools: TOOLS,
    tool_choice: 'required',
  });

  const calls2 = stubPost({ choices: [{ message: { content: 'ok' } }] });
  await translateWithOpenAi({
    messages,
    model: 'gpt-5.5',
    apiKey: 'sk-test',
    reasoning: { effort: 'medium' },
  });
  assert.deepEqual(calls2[0].payload, {
    model: 'gpt-5.5',
    messages,
    reasoning_effort: 'medium',
  });
});

test('web search payload resolves gpt-6 effort to >= low and keeps gpt-5.5 as-is', () => {
  const messages = [{ role: 'user', content: 'find videos' }];
  const gpt6 = buildOpenAiWebSearchPayload({ messages, model: 'gpt-6.1-sol' });
  assert.deepEqual(gpt6.reasoning, { effort: 'low' });
  // OpenAI: `web_search` for new integrations; `web_search_preview` is legacy.
  assert.deepEqual(gpt6.tools, [{ type: 'web_search' }]);

  const gpt6High = buildOpenAiWebSearchPayload({
    messages,
    model: 'gpt-6.1-sol',
    reasoning: { effort: 'high' },
  });
  assert.deepEqual(gpt6High.reasoning, { effort: 'high' });

  const gpt55 = buildOpenAiWebSearchPayload({ messages, model: 'gpt-5.5' });
  assert.equal(gpt55.reasoning, undefined);
  assert.deepEqual(gpt55.tools, [{ type: 'web_search_preview' }]);
});

test('API key test retrieves the current GPT model, falling back to the model list on 404', async () => {
  const urls: string[] = [];
  (axios as any).get = async (url: string) => {
    urls.push(url);
    return { data: {} };
  };
  assert.equal(await testOpenAiApiKey('sk-test'), true);
  assert.deepEqual(urls, ['https://api.openai.com/v1/models/gpt-6.1-sol']);

  urls.length = 0;
  (axios as any).get = async (url: string) => {
    urls.push(url);
    if (url.endsWith('/models/gpt-6.1-sol')) {
      throw Object.assign(new Error('not found'), {
        response: { status: 404 },
      });
    }
    return { data: { data: [] } };
  };
  assert.equal(await testOpenAiApiKey('sk-test'), true);
  assert.deepEqual(urls, [
    'https://api.openai.com/v1/models/gpt-6.1-sol',
    'https://api.openai.com/v1/models',
  ]);

  (axios as any).get = async () => {
    throw Object.assign(new Error('unauthorized'), {
      response: { status: 401 },
    });
  };
  await assert.rejects(() => testOpenAiApiKey('sk-bad'));
});
