import { create } from 'zustand';

const STORAGE_KEY = 'stage5.etaCalibration.v1';
const MIN_MULTIPLIER = 0.35;
const MAX_MULTIPLIER = 3.5;

export interface EtaCalibrationRecord {
  sampleCount: number;
  averageMultiplier: number;
  updatedAt: number;
  lastObservedSeconds: number;
}

export interface EtaCalibrationObservation {
  bucketKey: string;
  observedSeconds: number;
  expectedSeconds: number;
}

interface EtaCalibrationState {
  records: Record<string, EtaCalibrationRecord>;
  version: number;
  recordObservation: (observation: EtaCalibrationObservation) => void;
  reset: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function loadRecords(): Record<string, EtaCalibrationRecord> {
  if (!canUseStorage()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, EtaCalibrationRecord>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function persistRecords(records: Record<string, EtaCalibrationRecord>) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota and serialization failures.
  }
}

function mergeObservation(
  existing: EtaCalibrationRecord | undefined,
  multiplier: number,
  observedSeconds: number
): EtaCalibrationRecord {
  const now = Date.now();
  if (!existing) {
    return {
      sampleCount: 1,
      averageMultiplier: multiplier,
      updatedAt: now,
      lastObservedSeconds: observedSeconds,
    };
  }

  const alpha = existing.sampleCount < 4 ? 0.35 : 0.2;
  return {
    sampleCount: existing.sampleCount + 1,
    averageMultiplier:
      existing.averageMultiplier +
      (multiplier - existing.averageMultiplier) * alpha,
    updatedAt: now,
    lastObservedSeconds: observedSeconds,
  };
}

export function getEffectiveCalibrationMultiplier(
  records: Record<string, EtaCalibrationRecord>,
  bucketKey: string | null | undefined
): number {
  if (!bucketKey) return 1;
  const record = records[bucketKey];
  if (!record) return 1;
  const confidence = Math.min(1, record.sampleCount / 4);
  return 1 + (record.averageMultiplier - 1) * confidence;
}

export const useEtaCalibrationStore = create<EtaCalibrationState>((set, get) => ({
  records: loadRecords(),
  version: 0,
  recordObservation: observation => {
    const expectedSeconds = Number(observation.expectedSeconds);
    const observedSeconds = Number(observation.observedSeconds);
    if (
      !observation.bucketKey ||
      !Number.isFinite(expectedSeconds) ||
      !Number.isFinite(observedSeconds) ||
      expectedSeconds < 1 ||
      observedSeconds < 1
    ) {
      return;
    }

    const multiplier = clamp(
      observedSeconds / expectedSeconds,
      MIN_MULTIPLIER,
      MAX_MULTIPLIER
    );
    const current = get().records;
    const next = {
      ...current,
      [observation.bucketKey]: mergeObservation(
        current[observation.bucketKey],
        multiplier,
        observedSeconds
      ),
    };
    persistRecords(next);
    set(state => ({
      records: next,
      version: state.version + 1,
    }));
  },
  reset: () => {
    persistRecords({});
    set(state => ({ records: {}, version: state.version + 1 }));
  },
}));
