import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlannerPayload } from '../services/video-suggestions/planner.ts';

test('parsePlannerPayload preserves top-level inferred preference slots', () => {
  const parsed = parsePlannerPayload(
    JSON.stringify({
      assistantMessage: 'Searching now.',
      needsMoreContext: false,
      searchQuery: 'mai kuraki interviews',
      topic: 'japanese celebs',
      creator: 'Mai Kuraki',
      genre: 'female',
    })
  );

  assert.deepEqual(parsed?.capturedPreferences, {
    topic: 'japanese celebs',
    creator: 'Mai Kuraki',
    subtopic: 'female',
  });
});
