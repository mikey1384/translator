import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPiecewiseLinearExpression,
  buildSampleTimes,
  buildVerticalReframePlan,
  computeVerticalCropWidth,
} from '../services/highlight-smart-reframe-core.js';

test('computeVerticalCropWidth uses a filled 9:16 crop', () => {
  assert.equal(computeVerticalCropWidth(1920, 1080), 608);
  assert.equal(computeVerticalCropWidth(1080, 1920), null);
});

test('buildPiecewiseLinearExpression supports interpolated transitions', () => {
  const expression = buildPiecewiseLinearExpression(
    [
      { timeSeconds: 0, x: 120 },
      { timeSeconds: 1, x: 260 },
    ],
    ['interpolate']
  );

  assert.ok(expression.includes('(t-0)'));
  assert.ok(expression.includes('120+(140)*(t-0)'));
});

test('buildPiecewiseLinearExpression keeps snapped transitions as holds', () => {
  const expression = buildPiecewiseLinearExpression(
    [
      { timeSeconds: 0, x: 120 },
      { timeSeconds: 1, x: 520 },
    ],
    ['snap']
  );

  assert.equal(expression, 'if(lt(t,1),120,520)');
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

test('buildVerticalReframePlan scales medium-move dwell by elapsed sample time', () => {
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 30,
    samples: [
      { timeSeconds: 0, centerX: 700, confidence: 0.95 },
      { timeSeconds: 2.7, centerX: 820, confidence: 0.95 },
      { timeSeconds: 5.4, centerX: 940, confidence: 0.95 },
      { timeSeconds: 8.1, centerX: 1060, confidence: 0.95 },
      { timeSeconds: 10.8, centerX: 1180, confidence: 0.95 },
    ],
  });

  assert.ok(plan);
  const xValues = plan?.keyframes.map(keyframe => keyframe.x) ?? [];
  assert.ok(xValues.length >= 3);
  assert.ok(xValues[1] > xValues[0]);
});

test('buildVerticalReframePlan still holds medium moves on dense samples', () => {
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 2.6,
    samples: [
      { timeSeconds: 0, centerX: 700, confidence: 0.95 },
      { timeSeconds: 0.65, centerX: 820, confidence: 0.95 },
      { timeSeconds: 1.3, centerX: 940, confidence: 0.95 },
      { timeSeconds: 1.95, centerX: 1060, confidence: 0.95 },
      { timeSeconds: 2.6, centerX: 1180, confidence: 0.95 },
    ],
  });

  assert.ok(plan);
  const xValues = plan?.keyframes.map(keyframe => keyframe.x) ?? [];
  assert.ok(xValues.length >= 3);
  assert.equal(xValues[1], xValues[0]);
  assert.ok(xValues[2] > xValues[1]);
});

test('buildVerticalReframePlan ignores slight speaker head movement', () => {
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 2.6,
    samples: [
      { timeSeconds: 0, centerX: 960, confidence: 0.95 },
      { timeSeconds: 0.65, centerX: 990, confidence: 0.95 },
      { timeSeconds: 1.3, centerX: 976, confidence: 0.95 },
      { timeSeconds: 1.95, centerX: 1002, confidence: 0.95 },
      { timeSeconds: 2.6, centerX: 982, confidence: 0.95 },
    ],
  });

  assert.ok(plan);
  const xValues = plan?.keyframes.map(keyframe => keyframe.x) ?? [];
  assert.ok(xValues.length >= 3);
  assert.equal(new Set(xValues).size, 1);
});

test('buildVerticalReframePlan keeps dwell-sized corrections as held transitions', () => {
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 2.6,
    samples: [
      { timeSeconds: 0, centerX: 700, confidence: 0.95 },
      { timeSeconds: 0.65, centerX: 820, confidence: 0.95 },
      { timeSeconds: 1.3, centerX: 940, confidence: 0.95 },
      { timeSeconds: 1.95, centerX: 1060, confidence: 0.95 },
      { timeSeconds: 2.6, centerX: 1180, confidence: 0.95 },
    ],
  });

  assert.ok(plan);
  assert.ok(!plan?.xExpression.includes('*(t-'));
});

test('buildVerticalReframePlan applies pending medium move on final sample', () => {
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 1.3,
    samples: [
      { timeSeconds: 0, centerX: 960, confidence: 0.95 },
      { timeSeconds: 0.65, centerX: 960, confidence: 0.95 },
      { timeSeconds: 1.3, centerX: 1120, confidence: 0.95 },
    ],
  });

  assert.ok(plan);
  const xValues = plan?.keyframes.map(keyframe => keyframe.x) ?? [];
  assert.equal(xValues.length, 3);
  assert.equal(xValues[0], 656);
  assert.equal(xValues[1], 656);
  assert.equal(xValues[2], 736);
});

test('buildVerticalReframePlan avoids midpoint framing when two far faces cannot fit in one crop', () => {
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 5,
    samples: [
      {
        timeSeconds: 0,
        centerX: 320,
        confidence: 0.93,
        candidates: [
          { x1: 170, y1: 180, x2: 450, y2: 680, score: 0.95 },
          { x1: 1470, y1: 190, x2: 1750, y2: 690, score: 0.94 },
          { x1: 860, y1: 320, x2: 1040, y2: 620, score: 0.79 },
        ],
      },
      {
        timeSeconds: 1,
        centerX: 1590,
        confidence: 0.92,
        candidates: [
          { x1: 180, y1: 190, x2: 460, y2: 690, score: 0.94 },
          { x1: 1460, y1: 180, x2: 1740, y2: 680, score: 0.95 },
          { x1: 860, y1: 320, x2: 1040, y2: 620, score: 0.78 },
        ],
      },
      {
        timeSeconds: 2,
        centerX: 330,
        confidence: 0.93,
        candidates: [
          { x1: 175, y1: 185, x2: 455, y2: 685, score: 0.95 },
          { x1: 1465, y1: 185, x2: 1745, y2: 685, score: 0.93 },
        ],
      },
      {
        timeSeconds: 3,
        centerX: 1600,
        confidence: 0.92,
        candidates: [
          { x1: 180, y1: 190, x2: 460, y2: 690, score: 0.93 },
          { x1: 1460, y1: 180, x2: 1740, y2: 680, score: 0.95 },
        ],
      },
      {
        timeSeconds: 4,
        centerX: 325,
        confidence: 0.93,
        candidates: [
          { x1: 170, y1: 180, x2: 450, y2: 680, score: 0.95 },
          { x1: 1470, y1: 190, x2: 1750, y2: 690, score: 0.93 },
        ],
      },
      {
        timeSeconds: 5,
        centerX: 1595,
        confidence: 0.92,
        candidates: [
          { x1: 180, y1: 190, x2: 460, y2: 690, score: 0.93 },
          { x1: 1460, y1: 180, x2: 1740, y2: 680, score: 0.95 },
        ],
      },
    ],
  });

  assert.ok(plan);
  const cropWidth = plan?.cropWidth ?? 0;
  const trackedCenters =
    plan?.keyframes.map(keyframe => keyframe.x + cropWidth / 2) ?? [];
  const hasMidSofaFrame = trackedCenters.some(
    centerX => centerX > 760 && centerX < 1160
  );
  assert.equal(hasMidSofaFrame, false);
});

test('buildVerticalReframePlan interpolates large single-subject movement', () => {
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 2,
    samples: [
      { timeSeconds: 0, centerX: 320, confidence: 0.95 },
      { timeSeconds: 1, centerX: 980, confidence: 0.95 },
      { timeSeconds: 2, centerX: 1580, confidence: 0.95 },
    ],
  });

  assert.ok(plan);
  assert.equal(plan?.strategy, 'tracked-face');
  assert.ok(plan?.xExpression.includes('(t-'));
});

test('buildVerticalReframePlan snaps when tracking is reacquired after a gap', () => {
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 2,
    samples: [
      { timeSeconds: 0, centerX: 340, confidence: 0.95 },
      { timeSeconds: 1, centerX: null, confidence: 0 },
      { timeSeconds: 2, centerX: 1540, confidence: 0.95 },
    ],
  });

  assert.ok(plan);
  assert.equal(plan?.strategy, 'tracked-face');
  assert.ok(!plan?.xExpression.includes('(t-'));
});

test('buildVerticalReframePlan accepts repeated normal-confidence large moves', () => {
  const plan = buildVerticalReframePlan({
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 3,
    samples: [
      { timeSeconds: 0, centerX: 320, confidence: 0.88 },
      { timeSeconds: 1, centerX: 1460, confidence: 0.84 },
      { timeSeconds: 2, centerX: 1470, confidence: 0.85 },
      { timeSeconds: 3, centerX: 1480, confidence: 0.86 },
    ],
  });

  assert.ok(plan);
  const xValues = plan?.keyframes.map(keyframe => keyframe.x) ?? [];
  assert.ok(xValues.some(value => value > 700));
  assert.ok((xValues[xValues.length - 1] ?? 0) > 700);
});
