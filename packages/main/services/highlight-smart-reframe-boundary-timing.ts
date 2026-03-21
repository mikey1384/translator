import type { FaceTrackSample } from './highlight-smart-reframe-core.js';

export type ShotBoundaryAuditResult = {
  boundaryIndex: number;
  previousShotId: number | null;
  shotId: number | null;
  sampledBoundaryTimeSeconds: number;
  exactBoundaryFrameTimeSeconds: number | null;
};

export type AppliedShotBoundaryTimingCorrection = {
  boundaryIndex: number;
  previousShotId: number | null;
  shotId: number | null;
  fromTimeSeconds: number;
  toTimeSeconds: number;
};

export function applyShotBoundaryTimeCorrections({
  samples,
  durationSeconds,
  boundaryAudits,
}: {
  samples: ReadonlyArray<FaceTrackSample>;
  durationSeconds: number;
  boundaryAudits: ReadonlyArray<ShotBoundaryAuditResult>;
}): {
  samples: FaceTrackSample[];
  corrections: AppliedShotBoundaryTimingCorrection[];
} {
  if (samples.length === 0 || boundaryAudits.length === 0) {
    return {
      samples: [...samples],
      corrections: [],
    };
  }

  const correctedSamples = samples.map(sample => ({ ...sample }));
  const corrections: AppliedShotBoundaryTimingCorrection[] = [];

  for (const audit of boundaryAudits) {
    const exactBoundaryTimeSeconds = audit.exactBoundaryFrameTimeSeconds;
    if (
      exactBoundaryTimeSeconds == null ||
      !Number.isFinite(exactBoundaryTimeSeconds)
    ) {
      continue;
    }

    const boundarySample = correctedSamples[audit.boundaryIndex];
    if (!boundarySample) {
      continue;
    }

    const sampledBoundaryTimeSeconds = boundarySample.timeSeconds;
    if (exactBoundaryTimeSeconds >= sampledBoundaryTimeSeconds) {
      continue;
    }

    const previousTimeSeconds =
      audit.boundaryIndex > 0
        ? (correctedSamples[audit.boundaryIndex - 1]?.timeSeconds ?? 0)
        : 0;
    const nextTimeSeconds =
      audit.boundaryIndex + 1 < correctedSamples.length
        ? (correctedSamples[audit.boundaryIndex + 1]?.timeSeconds ??
          durationSeconds)
        : durationSeconds;
    const minimumAllowedTimeSeconds =
      audit.boundaryIndex > 0 ? previousTimeSeconds + 0.001 : 0;
    const maximumAllowedTimeSeconds =
      nextTimeSeconds > minimumAllowedTimeSeconds
        ? nextTimeSeconds - 0.001
        : sampledBoundaryTimeSeconds;
    const correctedTimeSeconds = roundTo(
      clamp(
        exactBoundaryTimeSeconds,
        minimumAllowedTimeSeconds,
        maximumAllowedTimeSeconds
      ),
      3
    );

    if (
      correctedTimeSeconds >= sampledBoundaryTimeSeconds ||
      correctedTimeSeconds <= previousTimeSeconds
    ) {
      continue;
    }

    correctedSamples[audit.boundaryIndex] = {
      ...boundarySample,
      timeSeconds: correctedTimeSeconds,
    };
    corrections.push({
      boundaryIndex: audit.boundaryIndex,
      previousShotId: audit.previousShotId,
      shotId: audit.shotId,
      fromTimeSeconds: roundTo(sampledBoundaryTimeSeconds, 3),
      toTimeSeconds: correctedTimeSeconds,
    });
  }

  return {
    samples: correctedSamples,
    corrections,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
