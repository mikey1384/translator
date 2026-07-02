import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractAnthropicToolCalls,
  toAnthropicMessages,
  toAnthropicTools,
} from '../services/anthropic-client.js';

test('toAnthropicMessages maps assistant tool calls to tool_use blocks', () => {
  const { systemPrompt, anthropicMessages } = toAnthropicMessages([
    { role: 'system', content: 'You are a recommender.' },
    { role: 'user', content: 'find me cooking videos' },
    {
      role: 'assistant',
      content: null,
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
  ]);

  assert.equal(systemPrompt, 'You are a recommender.');
  assert.equal(anthropicMessages.length, 3);
  assert.deepEqual(anthropicMessages[1], {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'search_youtube',
        input: { queries: ['korean cooking'] },
      },
    ],
  });
  assert.deepEqual(anthropicMessages[2], {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'call_1', content: '{"ok":true}' },
    ],
  });
});

test('toAnthropicMessages merges parallel tool results into one user message', () => {
  const { anthropicMessages } = toAnthropicMessages([
    { role: 'user', content: 'hi' },
    {
      role: 'assistant',
      content: 'Searching now.',
      tool_calls: [
        {
          id: 'a',
          type: 'function',
          function: { name: 'search_youtube', arguments: '{}' },
        },
        {
          id: 'b',
          type: 'function',
          function: { name: 'search_youtube', arguments: '{}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'a', content: '1' },
    { role: 'tool', tool_call_id: 'b', content: '2' },
  ]);

  const last = anthropicMessages[anthropicMessages.length - 1];
  assert.equal(last.role, 'user');
  assert.equal(last.content.length, 2);
  assert.equal(last.content[0].tool_use_id, 'a');
  assert.equal(last.content[1].tool_use_id, 'b');
  // Assistant text and tool_use share one assistant message.
  const assistant = anthropicMessages[1];
  assert.equal(assistant.content[0].type, 'text');
  assert.equal(assistant.content[1].type, 'tool_use');
  assert.equal(assistant.content[2].type, 'tool_use');
});

test('toAnthropicMessages tolerates malformed tool arguments', () => {
  const { anthropicMessages } = toAnthropicMessages([
    { role: 'user', content: 'hi' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'x',
          type: 'function',
          function: { name: 'search_youtube', arguments: 'not-json{{' },
        },
      ],
    },
  ]);
  assert.deepEqual(anthropicMessages[1].content[0].input, {});
});

test('toAnthropicMessages ensures the first message is from the user', () => {
  const { anthropicMessages } = toAnthropicMessages([
    { role: 'assistant', content: 'Hello, what do you want to watch?' },
  ]);
  assert.equal(anthropicMessages[0].role, 'user');
});

test('toAnthropicTools converts chat-completions schemas to input_schema', () => {
  const tools = toAnthropicTools([
    {
      type: 'function',
      function: {
        name: 'search_youtube',
        description: 'Search.',
        parameters: { type: 'object', properties: {} },
      },
    },
  ]);
  assert.deepEqual(tools, [
    {
      name: 'search_youtube',
      description: 'Search.',
      input_schema: { type: 'object', properties: {} },
    },
  ]);
});

test('extractAnthropicToolCalls converts tool_use blocks and skips text', () => {
  const calls = extractAnthropicToolCalls([
    { type: 'text', text: 'Let me search.' },
    {
      type: 'tool_use',
      id: 'toolu_1',
      name: 'present_results',
      input: { videoUrls: ['https://youtube.com/watch?v=abc'] },
    },
  ] as any);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'toolu_1');
  assert.equal(calls[0].function.name, 'present_results');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), {
    videoUrls: ['https://youtube.com/watch?v=abc'],
  });
});
