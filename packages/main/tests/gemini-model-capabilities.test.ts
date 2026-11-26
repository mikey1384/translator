// BYO Google Gemini requests must use the thinkingLevel shape each model
// accepts (Gemini 4 rejects `minimal` and `thinkingBudget` with HTTP 400),
// sum candidates + thoughts tokens, strip thought parts, validate keys at $0
// via GET /v1beta/models/gemini-4-neon, and throw on incomplete answers.
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  GeminiIncompleteResponseError,
  assertGeminiCompletion,
  extractGeminiUsage,
  getGeminiModelCapabilities,
  resolveGeminiThinkingConfig,
  respondWithGeminiWebSearch,
  testGeminiApiKey,
  translateWithGemini,
} from '../services/gemini-client.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubGemini(responseBody: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; method: string; headers: any; body: any }> =
    [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({
      url: String(url),
      method: init?.method || 'GET',
      headers: init?.headers || {},
      body: init?.body ? JSON.parse(init.body) : null,
    });
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              role: 'model',
              parts: [{ text: 'translated text' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 40,
          thoughtsTokenCount: 25,
          totalTokenCount: 165,
        },
        ...responseBody,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as typeof fetch;
  return calls;
}

const msgs = [
  { role: 'system', content: 'Translate subtitles.' },
  { role: 'user', content: 'Hello world' },
];

const tool = {
  type: 'function' as const,
  function: {
    name: 'submit_translations',
    description: 'Submit translated cues',
    parameters: { type: 'object', properties: {} },
  },
};

test('capability table matches Gemini 3.5 Flash-Lite vs Gemini 4 tiers', () => {
  assert.deepEqual(getGeminiModelCapabilities('gemini-3.5-flash-lite'), {
    thinking: 'level-minimal',
    defaultLevel: 'minimal',
    supportedLevels: ['minimal', 'low', 'medium', 'high'],
  });
  for (const model of [
    'gemini-4-hydrogen',
    'gemini-4-neon',
    'gemini-4-carbon',
  ]) {
    assert.deepEqual(getGeminiModelCapabilities(model), {
      thinking: 'level-always',
      defaultLevel: 'low',
      supportedLevels: ['low', 'medium', 'high', 'xhigh'],
    });
  }
});

test('thinkingConfig sends minimal on Flash-Lite and explicit low on Gemini 4 (never thinkingBudget)', () => {
  const flashDefault = resolveGeminiThinkingConfig({
    model: 'gemini-3.5-flash-lite',
  });
  assert.equal(flashDefault.thinkingOn, false);
  assert.equal(flashDefault.thinkingLevel, 'minimal');

  const flashClamped = resolveGeminiThinkingConfig({
    model: 'gemini-3.5-flash-lite',
    effort: 'xhigh',
  });
  assert.equal(flashClamped.thinkingOn, true);
  assert.equal(flashClamped.thinkingLevel, 'high');

  for (const model of [
    'gemini-4-hydrogen',
    'gemini-4-neon',
    'gemini-4-carbon',
  ]) {
    const def = resolveGeminiThinkingConfig({ model });
    assert.equal(def.thinkingOn, true);
    assert.equal(def.thinkingLevel, 'low');
    assert.ok(def.maxTokens >= 32_000);

    const xhigh = resolveGeminiThinkingConfig({ model, effort: 'xhigh' });
    assert.equal(xhigh.thinkingLevel, 'xhigh');
  }
});

test('translateWithGemini sends x-goog-api-key, thinkingLevel, strips thoughts, and sums usage', async () => {
  const calls = stubGemini({
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: [
            { text: 'internal chain of thought', thought: true },
            { text: 'Bonjour le monde' },
          ],
        },
      },
    ],
  });

  const res = await translateWithGemini({
    messages: msgs,
    model: 'gemini-4-hydrogen',
    apiKey: 'AIza-test-key',
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/models\/gemini-4-hydrogen:generateContent$/);
  assert.equal(calls[0].headers['x-goog-api-key'], 'AIza-test-key');
  assert.equal(
    calls[0].body.generationConfig.thinkingConfig.thinkingLevel,
    'low'
  );
  assert.equal(
    calls[0].body.generationConfig.thinkingConfig.thinkingBudget,
    undefined
  );
  assert.equal(
    calls[0].body.systemInstruction.parts[0].text,
    'Translate subtitles.'
  );
  assert.equal(res.choices[0].message.content, 'Bonjour le monde');
  assert.deepEqual(res.usage, {
    prompt_tokens: 100,
    completion_tokens: 65,
    thoughts_tokens: 25,
  });
});

test('translateWithGemini forces ANY function calling mode and returns tool_calls', async () => {
  const calls = stubGemini({
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'submit_translations',
                args: { items: ['Bonjour'] },
              },
            },
          ],
        },
      },
    ],
  });

  const res = await translateWithGemini({
    messages: msgs,
    model: 'gemini-4-neon',
    apiKey: 'AIza-test-key',
    tools: [tool],
    toolChoice: 'required',
  });

  assert.equal(calls[0].body.toolConfig.functionCallingConfig.mode, 'ANY');
  assert.equal(
    res.choices[0].message.tool_calls?.[0].function.name,
    'submit_translations'
  );
  assert.equal(
    res.choices[0].message.tool_calls?.[0].function.arguments,
    JSON.stringify({ items: ['Bonjour'] })
  );
});

test('incomplete responses (MAX_TOKENS, SAFETY, prompt block, missing tool call) throw GeminiIncompleteResponseError', () => {
  assert.throws(
    () =>
      assertGeminiCompletion({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }],
      }),
    (err: any) =>
      err instanceof GeminiIncompleteResponseError &&
      err.reason === 'max_tokens'
  );

  assert.throws(
    () =>
      assertGeminiCompletion({
        candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
      }),
    (err: any) =>
      err instanceof GeminiIncompleteResponseError && err.reason === 'refusal'
  );

  assert.throws(
    () =>
      assertGeminiCompletion({
        promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
      }),
    (err: any) =>
      err instanceof GeminiIncompleteResponseError && err.reason === 'refusal'
  );

  assert.throws(
    () =>
      assertGeminiCompletion(
        {
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: 'no tool call here' }] },
            },
          ],
        },
        { requireToolCall: true }
      ),
    (err: any) =>
      err instanceof GeminiIncompleteResponseError &&
      err.reason === 'missing_tool_call'
  );
});

test('extractGeminiUsage includes toolUsePromptTokenCount and thoughtsTokenCount', () => {
  assert.deepEqual(
    extractGeminiUsage({
      promptTokenCount: 200,
      toolUsePromptTokenCount: 50,
      candidatesTokenCount: 80,
      thoughtsTokenCount: 120,
      totalTokenCount: 450,
    }),
    {
      prompt_tokens: 250,
      completion_tokens: 200,
      thoughts_tokens: 120,
    }
  );
});

test('respondWithGeminiWebSearch sends google_search tool and streams text delta', async () => {
  const calls = stubGemini({
    candidates: [
      {
        finishReason: 'STOP',
        content: { parts: [{ text: 'Found 3 videos' }] },
      },
    ],
  });
  const deltas: string[] = [];
  const res = await respondWithGeminiWebSearch({
    messages: msgs,
    model: 'gemini-4-carbon',
    apiKey: 'AIza-test-key',
    onTextDelta: delta => deltas.push(delta),
  });

  assert.deepEqual(calls[0].body.tools, [{ google_search: {} }]);
  assert.equal(res.content, 'Found 3 videos');
  assert.deepEqual(deltas, ['Found 3 videos']);
});

test('testGeminiApiKey uses $0 GET metadata endpoint and never spends tokens', async () => {
  const calls: Array<{ url: string; method: string; headers: any }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({
      url: String(url),
      method: init?.method || 'GET',
      headers: init?.headers || {},
    });
    return new Response(
      JSON.stringify({
        name: 'models/gemini-4-neon',
        displayName: 'Gemini 4 Neon',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as typeof fetch;

  await testGeminiApiKey('AIza-valid');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/v1beta\/models\/gemini-4-neon$/);
  assert.equal(calls[0].headers['x-goog-api-key'], 'AIza-valid');

  await assert.rejects(() => testGeminiApiKey('   '), /Missing API key/);
});
