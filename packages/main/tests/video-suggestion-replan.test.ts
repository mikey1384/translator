import test from 'node:test';
import assert from 'node:assert/strict';
import { appendExhaustedSearchMoreTurn } from '../services/video-suggestions/planner.js';

test('exhausted search replanning always ends with an explicit user turn', () => {
  const history = [
    { role: 'user' as const, content: 'Find early AI interviews' },
    { role: 'assistant' as const, content: 'Here are the first results.' },
  ];

  const replanningHistory = appendExhaustedSearchMoreTurn(
    history,
    'Find early AI interviews'
  );

  assert.deepEqual(replanningHistory.slice(0, -1), history);
  assert.equal(replanningHistory.at(-1)?.role, 'user');
  assert.match(replanningHistory.at(-1)?.content || '', /more distinct/i);
  assert.match(
    replanningHistory.at(-1)?.content || '',
    /Find early AI interviews/
  );
});
