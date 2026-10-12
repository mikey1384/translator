import test from 'node:test';
import assert from 'node:assert/strict';
import { CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR } from '../../shared/constants';
import {
  creditOfferBasis,
  creditRefusalForOperation,
  describeCreditShortfall,
  registerFullTranscriptionSeconds,
  transcriptionMinutesForCredits,
} from './creditShortfall';

test('quotes required credits when a whole video needs more than the balance', () => {
  const seconds = 2622;
  const expected = Math.ceil((seconds * CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR) / 3600);
  assert.ok(expected > 15_000);
  assert.deepEqual(
    describeCreditShortfall({ availableCredits: 15_000, transcriptionSeconds: seconds }),
    { requiredCredits: expected, availableCredits: 15_000 }
  );
  assert.equal(
    transcriptionMinutesForCredits(15_000),
    Math.floor((15_000 / CREDITS_PER_TRANSCRIPTION_AUDIO_HOUR) * 60)
  );
});

test('keeps ran-out wording when balance is zero or unknown', () => {
  assert.equal(describeCreditShortfall({ availableCredits: 0 }), null);
  assert.equal(describeCreditShortfall({ availableCredits: null }), null);
});

test('omits a requirement that would contradict the refusal', () => {
  assert.deepEqual(
    describeCreditShortfall({ availableCredits: 50_000, transcriptionSeconds: 60 }),
    { requiredCredits: null, availableCredits: 50_000 }
  );
});

test('only whole-file transcriptions carry a duration', () => {
  registerFullTranscriptionSeconds('transcribe-1-full', 2622);
  assert.deepEqual(creditRefusalForOperation('transcribe-1-full'), {
    kind: 'transcription',
    transcriptionSeconds: 2622,
  });
  // Tail and single-line runs never register, so they are never quoted.
  assert.deepEqual(creditRefusalForOperation('transcribe-2-tail'), {
    kind: 'transcription',
    transcriptionSeconds: null,
  });
  assert.deepEqual(creditRefusalForOperation('agent-op-transcribe'), {
    kind: 'transcription',
    transcriptionSeconds: null,
  });
  registerFullTranscriptionSeconds('transcribe-3', 0);
  assert.equal(creditRefusalForOperation('transcribe-3').transcriptionSeconds, null);
});

test('describes the $1 pack in the unit of the refused work', () => {
  assert.equal(creditOfferBasis(creditRefusalForOperation('transcribe-9')), 'transcription');
  assert.equal(creditOfferBasis(creditRefusalForOperation('translate-9')), 'translation');
  assert.equal(creditOfferBasis(creditRefusalForOperation('dub-9')), 'none');
  assert.equal(creditOfferBasis(null), 'none');
});
