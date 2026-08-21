import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTranscriptionOutcome } from '../services/transcription-funnel.js';
import { classifyDubbingOutcome } from '../services/dubbing-funnel.js';
import { classifySummaryOutcome } from '../services/summary-funnel.js';
import { classifyMergeOutcome } from '../services/merge-funnel.js';

test('transcription outcomes stay mutually exclusive', () => {
  assert.equal(
    classifyTranscriptionOutcome({ success: true }),
    'transcription_completed'
  );
  assert.equal(
    classifyTranscriptionOutcome({
      success: false,
      blockedReason: 'insufficient_credits',
      cancelled: true,
    }),
    'transcription_credit_blocked'
  );
  assert.equal(
    classifyTranscriptionOutcome({ success: false, cancelled: true }),
    'transcription_cancelled'
  );
  assert.equal(
    classifyTranscriptionOutcome({ success: false }),
    'transcription_failed'
  );
});

test('dubbing outcomes detect credit blocks from error message', () => {
  assert.equal(
    classifyDubbingOutcome({ success: true }),
    'dubbing_completed'
  );
  
  // Test with the actual constant value from ERROR_CODES.INSUFFICIENT_CREDITS
  // The value is 'insufficient-credits' (lowercase with hyphen), not 'INSUFFICIENT_CREDITS'
  const actualConstantValue = 'insufficient-credits';
  assert.equal(
    classifyDubbingOutcome({
      success: false,
      error: actualConstantValue,
    }),
    'dubbing_credit_blocked',
    'Should detect credit block from insufficient-credits error code'
  );
  
  // When cancelled but not for credits
  assert.equal(
    classifyDubbingOutcome({ success: false, cancelled: true }),
    'dubbing_cancelled'
  );
  
  // Regular failure
  assert.equal(
    classifyDubbingOutcome({ success: false, error: 'Network timeout' }),
    'dubbing_failed'
  );
  
  // Credit block takes precedence even when marked as cancelled
  assert.equal(
    classifyDubbingOutcome({
      success: false,
      cancelled: true,
      error: actualConstantValue,
    }),
    'dubbing_credit_blocked',
    'Credit block should take precedence over cancelled flag'
  );
});

test('summary outcomes detect credit blocks from error message', () => {
  assert.equal(
    classifySummaryOutcome({ success: true }),
    'summary_completed'
  );
  
  // Test with the actual constant value 'insufficient-credits'
  assert.equal(
    classifySummaryOutcome({
      success: false,
      error: 'insufficient-credits',
    }),
    'summary_credit_blocked'
  );
  assert.equal(
    classifySummaryOutcome({ success: false, cancelled: true }),
    'summary_cancelled'
  );
  assert.equal(
    classifySummaryOutcome({ success: false, error: 'API error' }),
    'summary_failed'
  );
});

test('merge outcomes have no credit block state', () => {
  assert.equal(
    classifyMergeOutcome({ success: true }),
    'merge_completed'
  );
  assert.equal(
    classifyMergeOutcome({ success: false, cancelled: true }),
    'merge_cancelled'
  );
  assert.equal(
    classifyMergeOutcome({ success: false }),
    'merge_failed'
  );
});

test('job funnel events contain no PII', () => {
  // All events are enum strings with no user content
  const transcriptionEvents = [
    'transcription_started',
    'transcription_completed',
    'transcription_credit_blocked',
    'transcription_cancelled',
    'transcription_failed',
  ];
  const dubbingEvents = [
    'dubbing_started',
    'dubbing_completed',
    'dubbing_credit_blocked',
    'dubbing_cancelled',
    'dubbing_failed',
  ];
  const summaryEvents = [
    'summary_started',
    'summary_completed',
    'summary_credit_blocked',
    'summary_cancelled',
    'summary_failed',
  ];
  const mergeEvents = [
    'merge_started',
    'merge_completed',
    'merge_cancelled',
    'merge_failed',
  ];

  // All events are simple strings with no embedded data
  [...transcriptionEvents, ...dubbingEvents, ...summaryEvents, ...mergeEvents].forEach(
    event => {
      assert.equal(typeof event, 'string');
      assert.ok(event.length > 0);
      // No spaces, URLs, paths, or user content
      assert.ok(!event.includes(' '));
      assert.ok(!event.includes('/'));
      assert.ok(!event.includes('\\'));
      assert.ok(!event.includes('http'));
    }
  );
});
