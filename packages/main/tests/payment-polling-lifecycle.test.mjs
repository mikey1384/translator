import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const creditHandlerSource = readFileSync(
  new URL('../handlers/credit-handlers.ts', import.meta.url),
  'utf8'
);

test('payment settlement uses bounded polling and never opens an always-on stream', () => {
  assert.doesNotMatch(creditHandlerSource, /payments\/events/);
  assert.doesNotMatch(creditHandlerSource, /text\/event-stream/);
  assert.doesNotMatch(creditHandlerSource, /PaymentEventStream/);
  assert.doesNotMatch(creditHandlerSource, /setInterval\s*\(/);

  assert.match(
    creditHandlerSource,
    /CHECKOUT_SETTLEMENT_POLL_INTERVAL_MS\s*=\s*2_000/
  );
  assert.match(
    creditHandlerSource,
    /CHECKOUT_SETTLEMENT_MAX_WAIT_MS\s*=\s*5\s*\*\s*60_000/
  );
  assert.match(
    creditHandlerSource,
    /payments\/session\/\$\{encodeURIComponent\(sessionId\)\}/
  );
  assert.match(
    creditHandlerSource,
    /Date\.now\(\)\s*-\s*startedAt\s*<\s*maxWaitMs/
  );
});
