import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeTranslationCoverage,
  parseTranslationLines,
  IncompleteTranslationError,
} from '../services/subtitle-processing/translation-coverage.js';
const segments = Array.from({ length: 3 }, (_, i) => ({
  id: `source-${i}`,
  sourceCueIds: [`raw-${i}`],
  index: i + 1,
  start: i * 3,
  end: i * 3 + 2,
  original: `Source ${i + 1}`,
}));

test('numbered output cannot shift a neighbouring cue, context or duplicate into a missing translation', () => {
  const parsed = parseTranslationLines(
    '@@SUB_LINE@@ 10: context\n@@SUB_LINE@@ 11: first\n@@SUB_LINE@@ 11: duplicate\n@@SUB_LINE@@ 13: third\nSome commentary',
    [11, 12, 13]
  );
  assert.deepEqual([...parsed], [[13, 'third']]);
  assert.equal(parseTranslationLines('one\ntwo\nthree', [11, 12, 13]).size, 0);
});
test('standard draft repairs only missing IDs and preserves timing, provenance and successful translations', async () => {
  const requests: unknown[] = [];
  const result = await completeTranslationCoverage({
    segments,
    startIndex: 10,
    draft: '@@SUB_LINE@@ 11: 하나\n@@SUB_LINE@@ 13: 셋',
    repair: async missing => {
      requests.push(missing);
      return '@@SUB_LINE@@ 12: 둘\n@@SUB_LINE@@ 11: must not overwrite';
    },
  });
  assert.deepEqual(requests, [[{ id: 12, original: 'Source 2' }]]);
  assert.deepEqual(
    result.map(s => s.translation),
    ['하나', '둘', '셋']
  );
  assert.deepEqual(
    result.map(({ translation: _, ...s }) => s),
    segments
  );
});
test('partial or malformed repairs fail explicitly, never report original text as a translation', async () => {
  let calls = 0;
  await assert.rejects(
    completeTranslationCoverage({
      segments,
      startIndex: 10,
      draft: '@@SUB_LINE@@ 11: 하나',
      repair: async missing => {
        calls++;
        assert.equal(missing[0].id, 12);
        return '@@SUB_LINE@@ 13: 셋';
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof IncompleteTranslationError);
      assert.deepEqual(
        error.partialSegments.map(s => s.translation),
        ['하나', '', '셋']
      );
      return true;
    }
  );
  assert.equal(calls, 2);
});
test('provider and cancellation failures propagate without silent successful fallback', async () => {
  const failure = new Error('provider unavailable');
  await assert.rejects(
    completeTranslationCoverage({
      segments,
      startIndex: 0,
      draft: '',
      repair: async () => {
        throw failure;
      },
    }),
    error => error === failure
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    completeTranslationCoverage({
      segments,
      startIndex: 0,
      draft: '',
      signal: controller.signal,
      repair: async () => {
        assert.fail('must not call model');
      },
    })
  );
});

test('cancellation retains already-paid draft and repair responses without reporting success', async () => {
  for (const cancelDuringRepair of [false, true]) {
    const controller = new AbortController();
    if (!cancelDuringRepair) controller.abort();
    let repairCalls = 0;
    await assert.rejects(
      completeTranslationCoverage({
        segments,
        startIndex: 0,
        draft: '@@SUB_LINE@@ 1: 하나',
        signal: controller.signal,
        repair: async () => {
          repairCalls++;
          controller.abort();
          return '@@SUB_LINE@@ 2: 둘\n@@SUB_LINE@@ 3: 셋';
        },
      }),
      (error: any) => {
        assert.equal(error.name, 'AbortError');
        assert.deepEqual(
          error.partialSegments.map(
            (s: { translation: string }) => s.translation
          ),
          cancelDuringRepair ? ['하나', '둘', '셋'] : ['하나', '', '']
        );
        return true;
      }
    );
    assert.equal(repairCalls, cancelDuringRepair ? 1 : 0);
  }
});
