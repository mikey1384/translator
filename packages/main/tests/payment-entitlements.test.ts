import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasUnlockedCheckoutEntitlement,
  normalizeCheckoutEntitlement,
} from '../utils/payment-entitlements.ts';

test('normalizeCheckoutEntitlement only accepts known checkout entitlements', () => {
  assert.equal(normalizeCheckoutEntitlement('byo_openai'), 'byo_openai');
  assert.equal(normalizeCheckoutEntitlement('byo_anthropic'), 'byo_anthropic');
  assert.equal(
    normalizeCheckoutEntitlement('byo_elevenlabs'),
    'byo_elevenlabs'
  );
  assert.equal(normalizeCheckoutEntitlement('byo_other'), null);
  assert.equal(normalizeCheckoutEntitlement(null), null);
});

test('BYO OpenAI confirmation requires the OpenAI entitlement specifically', () => {
  assert.equal(
    hasUnlockedCheckoutEntitlement(
      {
        byoOpenAi: false,
        byoAnthropic: true,
        byoElevenLabs: true,
      },
      'byo_openai'
    ),
    false
  );

  assert.equal(
    hasUnlockedCheckoutEntitlement(
      {
        byoOpenAi: true,
        byoAnthropic: true,
        byoElevenLabs: true,
      },
      'byo_openai'
    ),
    true
  );
});

test('provider-specific confirmation follows the requested entitlement', () => {
  assert.equal(
    hasUnlockedCheckoutEntitlement(
      {
        byoOpenAi: false,
        byoAnthropic: true,
        byoElevenLabs: false,
      },
      'byo_anthropic'
    ),
    true
  );
  assert.equal(
    hasUnlockedCheckoutEntitlement(
      {
        byoOpenAi: false,
        byoAnthropic: false,
        byoElevenLabs: true,
      },
      'byo_elevenlabs'
    ),
    true
  );
  assert.equal(hasUnlockedCheckoutEntitlement(null, 'byo_openai'), false);
});
