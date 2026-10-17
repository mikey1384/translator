import assert from 'node:assert/strict';
import test from 'node:test';
import { taskOperationKind } from './operationKind.js';

test('app and assistant operation ids map to the same task slot', () => {
  assert.equal(taskOperationKind('dub-123'), 'dubbing');
  assert.equal(taskOperationKind('agent-dubbing-42-dub'), 'dubbing');
  assert.equal(taskOperationKind('translate-9'), 'translation');
  assert.equal(taskOperationKind('agent-7-translate'), 'translation');
  assert.equal(taskOperationKind('agent-7-translate-cue'), 'translation');
  assert.equal(taskOperationKind('transcribe-1'), 'transcription');
  assert.equal(taskOperationKind('agent-7-transcribe'), 'transcription');
  assert.equal(taskOperationKind('agent-7-summary'), null);
  assert.equal(taskOperationKind('agent-7-merge'), null);
  assert.equal(taskOperationKind(null), null);
});
