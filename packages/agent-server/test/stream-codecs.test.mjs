import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContentLengthDecoder,
  McpStdioDecoder,
  Utf8LineDecoder,
} from '../src/stream-codecs.mjs';

test('Content-Length decoder counts UTF-8 bytes across arbitrary chunks', () => {
  const payloads = [
    JSON.stringify({ text: '한국어 자막 🎬' }),
    JSON.stringify({ text: 'second frame' }),
  ];
  const framed = Buffer.concat(
    payloads.map(payload => {
      const body = Buffer.from(payload, 'utf8');
      return Buffer.concat([
        Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
        body,
      ]);
    })
  );
  const splitInsideEmoji = framed.indexOf(Buffer.from('🎬')) + 2;
  const decoder = new ContentLengthDecoder();

  const first = decoder.write(framed.subarray(0, splitInsideEmoji));
  const second = decoder.write(framed.subarray(splitInsideEmoji));

  assert.deepEqual(first, { messages: [], errors: [] });
  assert.deepEqual(
    second.messages.map(message => message.toString('utf8')),
    payloads
  );
  assert.deepEqual(second.errors, []);
});

test('Content-Length decoder rejects malformed headers without losing the next frame', () => {
  const payload = Buffer.from('{"ok":true}', 'utf8');
  const decoder = new ContentLengthDecoder();
  const invalid = decoder.write(Buffer.from('Not-Length: 3\r\n\r\n', 'ascii'));
  const recovered = decoder.write(
    Buffer.concat([
      Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'ascii'),
      payload,
    ])
  );

  assert.equal(invalid.errors.length, 1);
  assert.deepEqual(invalid.messages, []);
  assert.deepEqual(
    recovered.messages.map(message => message.toString('utf8')),
    [payload.toString('utf8')]
  );
  assert.deepEqual(recovered.errors, []);
});

test('Content-Length decoder rejects ambiguous duplicate length headers', () => {
  const decoder = new ContentLengthDecoder();
  const result = decoder.write(
    Buffer.from(
      'Content-Length: 2\r\nContent-Length: 4\r\n\r\nContent-Length: 2\r\n\r\n{}',
      'ascii'
    )
  );

  assert.equal(result.errors.length, 1);
  assert.deepEqual(
    result.messages.map(message => message.toString()),
    ['{}']
  );
});

test('Content-Length decoder bounds incomplete headers and then recovers', () => {
  const decoder = new ContentLengthDecoder({ maxHeaderBytes: 32 });
  const rejected = decoder.write(Buffer.alloc(33, 'x'));
  const payload = Buffer.from('{}');
  const recovered = decoder.write(
    Buffer.concat([
      Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`),
      payload,
    ])
  );

  assert.equal(rejected.errors.length, 1);
  assert.match(rejected.errors[0].message, /header exceeds/);
  assert.deepEqual(
    recovered.messages.map(message => message.toString()),
    ['{}']
  );
});

test('Content-Length decoder discards an oversized body without retaining it', () => {
  const decoder = new ContentLengthDecoder({ maxContentBytes: 4 });
  const first = decoder.write(
    Buffer.from('Content-Length: 6\r\n\r\nabc', 'ascii')
  );
  const second = decoder.write(
    Buffer.from('defContent-Length: 2\r\n\r\n{}', 'ascii')
  );

  assert.equal(first.errors.length, 1);
  assert.match(first.errors[0].message, /body exceeds/);
  assert.deepEqual(first.messages, []);
  assert.deepEqual(
    second.messages.map(message => message.toString()),
    ['{}']
  );
});

test('UTF-8 line decoder preserves split multibyte code points', () => {
  const input = Buffer.from('첫 줄 🎬\nsecond\r\n마지막', 'utf8');
  const emojiOffset = input.indexOf(Buffer.from('🎬'));
  const decoder = new Utf8LineDecoder();

  assert.deepEqual(decoder.write(input.subarray(0, emojiOffset + 1)), []);
  assert.deepEqual(decoder.write(input.subarray(emojiOffset + 1, -2)), [
    '첫 줄 🎬',
    'second',
  ]);
  assert.deepEqual(decoder.end(input.subarray(-2)), ['마지막']);
});

test('UTF-8 line decoder bounds an unterminated line and recovers', () => {
  const decoder = new Utf8LineDecoder({ maxPendingCharacters: 4 });

  assert.throws(() => decoder.write(Buffer.from('12345')), /size limit/);
  assert.deepEqual(decoder.write(Buffer.from('ok\n')), ['ok']);
});

test('MCP stdio decoder selects newline framing across split UTF-8 chunks', () => {
  const decoder = new McpStdioDecoder();
  const body = Buffer.from(
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: '완료' })}\n`,
    'utf8'
  );
  const split = body.indexOf(Buffer.from('완')) + 1;

  assert.deepEqual(decoder.write(body.subarray(0, split)).messages, []);
  const decoded = decoder.write(body.subarray(split));
  assert.equal(decoded.framing, 'newline');
  assert.deepEqual(JSON.parse(decoded.messages[0].toString('utf8')), {
    jsonrpc: '2.0',
    id: 1,
    result: '완료',
  });
});

test('MCP stdio decoder selects legacy Content-Length framing exactly once', () => {
  const decoder = new McpStdioDecoder();
  assert.equal(decoder.write(Buffer.from('Content-')).framing, null);
  const decoded = decoder.write(Buffer.from('Length: 2\r\n\r\n{}', 'ascii'));

  assert.equal(decoded.framing, 'content-length');
  assert.equal(decoded.messages[0].toString('utf8'), '{}');
});
