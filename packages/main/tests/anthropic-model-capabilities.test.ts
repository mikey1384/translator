// BYO Anthropic requests must use the shape each Claude model accepts (new
// models 400 on older thinking/tool_choice settings), and non-answers
// (refusal, truncation, missing required tool call) must surface as errors.
// Anthropic HTTP is stubbed through globalThis.fetch; nothing hits the API.
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  AnthropicIncompleteResponseError,
  getClaudeModelCapabilities,
  resolveAnthropicThinkingConfig,
  respondWithAnthropicWebSearch,
  testAnthropicApiKey,
  translateWithAnthropic,
} from '../services/anthropic-client.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubAnthropic(responseBody: Record<string, unknown> = {}) {
  const requests: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'stub',
        stop_reason: 'end_turn',
        stop_details: null,
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        ...responseBody,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as typeof fetch;
  return requests;
}

function stubAnthropicStream(
  text: string,
  stopReason = 'end_turn',
  stopDetails: unknown = null
) {
  const requests: any[] = [];
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'stub',
        content: [],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    ...(text
      ? [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text },
          },
          { type: 'content_block_stop', index: 0 },
        ]
      : []),
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_details: stopDetails },
      usage: { output_tokens: 5 },
    },
    { type: 'message_stop' },
  ];
  const body = events
    .map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
  globalThis.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(init.body));
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;
  return requests;
}

const tool = {
  type: 'function' as const,
  function: {
    name: 'submit',
    parameters: { type: 'object', properties: {} },
  },
};
const msgs = [
  { role: 'system', content: 'Translate.' },
  { role: 'user', content: 'Hello' },
];
const toolUseReply = {
  content: [{ type: 'tool_use', id: 't1', name: 'submit', input: {} }],
  stop_reason: 'tool_use',
};

test('capability table matches the relay', () => {
  assert.deepEqual(getClaudeModelCapabilities('claude-opus-5-5'), {
    thinking: 'adaptive-always',
    forcedToolChoice: false,
    webSearchTool: 'web_search_20260209',
  });
  assert.deepEqual(getClaudeModelCapabilities('claude-sonnet-5-5'), {
    thinking: 'between-tools-off',
    forcedToolChoice: false,
    webSearchTool: 'web_search_20260209',
  });
  assert.deepEqual(getClaudeModelCapabilities('claude-haiku-5-5'), {
    thinking: 'disabled-off',
    forcedToolChoice: true,
    webSearchTool: 'web_search_20250305',
  });
  assert.equal(
    getClaudeModelCapabilities('claude-haiku-4-5').thinking,
    'budget'
  );
});

test('Opus 4.8 / Sonnet 5 keep optional adaptive thinking, off by omission', () => {
  for (const model of ['claude-opus-4-8', 'claude-sonnet-5']) {
    const off = resolveAnthropicThinkingConfig({ model });
    assert.equal(off.thinkingOn, false);
    assert.equal(off.apply, undefined);

    const params: any = {};
    const on = resolveAnthropicThinkingConfig({ model, effort: 'high' });
    on.apply!(params);
    assert.deepEqual(params.thinking, { type: 'adaptive' });
    assert.equal(params.output_config.effort, 'high');
    assert(on.maxTokens >= 32000);

    const forced = resolveAnthropicThinkingConfig({
      model,
      effort: 'high',
      forceToolUse: true,
    });
    assert.equal(forced.thinkingOn, false);
    assert.equal(forced.apply, undefined);
  }
});

test('Opus 5.5 always sends adaptive thinking with explicit low effort by default', async () => {
  const requests = stubAnthropic();
  await translateWithAnthropic({
    messages: msgs,
    model: 'claude-opus-5-5',
    apiKey: 'k',
  });
  const req = requests[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.equal(req.output_config.effort, 'low');
  assert(req.max_tokens >= 32000);
  assert.equal(req.system, 'Translate.');
  assert.equal(req.messages[0].content, 'Hello');
});

test('Opus 5.5 forced tool use: auto + instruction, thinking stays adaptive', async () => {
  const requests = stubAnthropic(toolUseReply);
  const result = await translateWithAnthropic({
    messages: msgs,
    model: 'claude-opus-5-5',
    apiKey: 'k',
    effort: 'high',
    tools: [tool],
    toolChoice: 'required',
  });
  const req = requests[0];
  assert.equal(req.tool_choice, undefined);
  assert.match(String(req.system), /^Translate\.\n\n/);
  assert.match(
    String(req.system),
    /Respond by calling one of the provided tools/
  );
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.equal(req.output_config.effort, 'high');
  assert.equal(result.choices[0].message.tool_calls[0].function.name, 'submit');
});

test('Sonnet 5.5 keeps thinking off with between_tools and nothing else', async () => {
  const requests = stubAnthropic();
  await translateWithAnthropic({
    messages: msgs,
    model: 'claude-sonnet-5-5',
    apiKey: 'k',
  });
  assert.deepEqual(requests[0].thinking, { type: 'between_tools' });
  assert.equal(requests[0].output_config, undefined);
  assert.equal(requests[0].max_tokens, 16000);

  const deep = stubAnthropic();
  await translateWithAnthropic({
    messages: msgs,
    model: 'claude-sonnet-5-5',
    apiKey: 'k',
    effort: 'xhigh',
  });
  assert.deepEqual(deep[0].thinking, { type: 'adaptive' });
  assert.equal(deep[0].output_config.effort, 'xhigh');
  // New models keep the system prompt as `system`, never folded.
  assert.equal(deep[0].system, 'Translate.');
});

test('Sonnet 5.5 forced tool use: auto + instruction + between_tools', async () => {
  const requests = stubAnthropic(toolUseReply);
  await translateWithAnthropic({
    messages: msgs,
    model: 'claude-sonnet-5-5',
    apiKey: 'k',
    effort: 'high',
    tools: [tool],
    toolChoice: 'required',
  });
  assert.equal(requests[0].tool_choice, undefined);
  assert.match(
    String(requests[0].system),
    /Respond by calling one of the provided tools/
  );
  assert.deepEqual(requests[0].thinking, { type: 'between_tools' });
  assert.equal(requests[0].output_config, undefined);
});

test('Haiku 5.5 disables thinking explicitly and keeps forced tool_choice', async () => {
  let requests = stubAnthropic();
  await translateWithAnthropic({
    messages: msgs,
    model: 'claude-haiku-5-5',
    apiKey: 'k',
  });
  assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  assert.equal(requests[0].output_config, undefined);

  requests = stubAnthropic();
  await translateWithAnthropic({
    messages: msgs,
    model: 'claude-haiku-5-5',
    apiKey: 'k',
    effort: 'medium',
  });
  assert.deepEqual(requests[0].thinking, { type: 'adaptive' });
  assert.equal(requests[0].output_config.effort, 'medium');

  requests = stubAnthropic(toolUseReply);
  await translateWithAnthropic({
    messages: msgs,
    model: 'claude-haiku-5-5',
    apiKey: 'k',
    effort: 'high',
    tools: [tool],
    toolChoice: 'required',
  });
  assert.deepEqual(requests[0].tool_choice, { type: 'any' });
  assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  assert.equal(requests[0].system, 'Translate.');
});

test('saved legacy ids normalize to the current model shape', async () => {
  const requests = stubAnthropic();
  await translateWithAnthropic({
    messages: msgs,
    model: 'claude-opus-4-8',
    apiKey: 'k',
  });
  assert.equal(requests[0].model, 'claude-opus-5-5');
  assert.deepEqual(requests[0].thinking, { type: 'adaptive' });
});

test('missing required tool call is an error', async () => {
  stubAnthropic({ content: [{ type: 'text', text: 'here you go' }] });
  await assert.rejects(
    translateWithAnthropic({
      messages: msgs,
      model: 'claude-sonnet-5-5',
      apiKey: 'k',
      tools: [tool],
      toolChoice: 'required',
    }),
    (err: any) =>
      err instanceof AnthropicIncompleteResponseError &&
      err.reason === 'missing_tool_call'
  );
});

test('refusal and max_tokens are errors, never an empty success', async () => {
  stubAnthropic({
    stop_reason: 'refusal',
    stop_details: { type: 'refusal', category: 'cyber' },
    content: [],
  });
  await assert.rejects(
    translateWithAnthropic({
      messages: msgs,
      model: 'claude-opus-5-5',
      apiKey: 'k',
    }),
    (err: any) => err.reason === 'refusal' && /cyber/.test(err.message)
  );

  stubAnthropic({ stop_reason: 'max_tokens' });
  await assert.rejects(
    translateWithAnthropic({
      messages: msgs,
      model: 'claude-haiku-5-5',
      apiKey: 'k',
    }),
    (err: any) => err.reason === 'max_tokens'
  );
});

test('web search picks the tool type and thinking shape per model', async () => {
  let requests = stubAnthropicStream('answer');
  const res = await respondWithAnthropicWebSearch({
    messages: msgs,
    model: 'claude-opus-5-5',
    apiKey: 'k',
  });
  assert.equal(res.choices[0].message.content, 'answer');
  assert.equal(requests[0].tools[0].type, 'web_search_20260209');
  assert.deepEqual(requests[0].thinking, { type: 'adaptive' });
  assert.equal(requests[0].output_config.effort, 'low');
  assert.equal(requests[0].system, 'Translate.');

  requests = stubAnthropicStream('answer');
  await respondWithAnthropicWebSearch({
    messages: msgs,
    model: 'claude-sonnet-5-5',
    apiKey: 'k',
  });
  assert.equal(requests[0].tools[0].type, 'web_search_20260209');
  assert.deepEqual(requests[0].thinking, { type: 'between_tools' });

  requests = stubAnthropicStream('answer');
  await respondWithAnthropicWebSearch({
    messages: msgs,
    model: 'claude-haiku-5-5',
    apiKey: 'k',
  });
  assert.equal(requests[0].tools[0].type, 'web_search_20250305');
  assert.deepEqual(requests[0].thinking, { type: 'disabled' });
});

test('web search stream refusal / max_tokens are errors', async () => {
  stubAnthropicStream('', 'refusal', { type: 'refusal', category: 'bio' });
  await assert.rejects(
    respondWithAnthropicWebSearch({
      messages: msgs,
      model: 'claude-opus-5-5',
      apiKey: 'k',
    }),
    (err: any) => err.reason === 'refusal' && /bio/.test(err.message)
  );
  stubAnthropicStream('partial', 'max_tokens');
  await assert.rejects(
    respondWithAnthropicWebSearch({
      messages: msgs,
      model: 'claude-opus-5-5',
      apiKey: 'k',
    }),
    (err: any) => err.reason === 'max_tokens'
  );
});

test('key test uses Haiku with thinking disabled; max_tokens stop still passes', async () => {
  const requests = stubAnthropic({ stop_reason: 'max_tokens' });
  assert.equal(await testAnthropicApiKey('k'), true);
  assert.equal(requests[0].model, 'claude-haiku-5-5');
  assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  assert(requests[0].max_tokens <= 32);
});
