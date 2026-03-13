import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSampleTimes,
  buildVerticalReframePlan,
  computeVerticalCropWidth,
} from '../services/highlight-smart-reframe-core.js';

test('computeVerticalCropWidth uses a filled 9:16 crop', () => {
  assert.equal(computeVerticalCropWidth(1920, 1080), 608);
  assert.equal(computeVerticalCropWidth(1080, 1920), null);
});

test('buildVerticalReframePlan falls back to a centered crop when no face is tracked', () => {
  const sampleTimes = buildSampleTimes(5.5);
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 5.5,
    samples: sampleTimes.map(timeSeconds => ({
      timeSeconds,
      centerX: null,
      confidence: 0,
    })),
  });

  assert.ok(plan);
  assert.equal(plan?.strategy, 'center');
  assert.equal(plan?.cropWidth, 608);
  assert.equal(plan?.detectedSamples, 0);
  assert.equal(new Set(plan?.keyframes.map(keyframe => keyframe.x)).size, 1);
});

test('buildVerticalReframePlan smooths tracked movement inside crop bounds', () => {
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 4,
    samples: [
      { timeSeconds: 0, centerX: 420, confidence: 0.9 },
      { timeSeconds: 1, centerX: 620, confidence: 0.91 },
      { timeSeconds: 2, centerX: 980, confidence: 0.92 },
      { timeSeconds: 3, centerX: 1340, confidence: 0.93 },
      { timeSeconds: 4, centerX: 1540, confidence: 0.94 },
    ],
  });

  assert.ok(plan);
  assert.equal(plan?.strategy, 'tracked-face');
  assert.equal(plan?.detectedSamples, 5);
  assert.equal(plan?.keyframes.length, 5);

  const maxX = 1920 - 608;
  const xValues = plan?.keyframes.map(keyframe => keyframe.x) ?? [];
  assert.ok(xValues.every(value => value >= 0 && value <= maxX));
  for (let index = 1; index < xValues.length; index += 1) {
    assert.ok(xValues[index] >= xValues[index - 1]);
  }
});
