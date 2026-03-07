type EtaOperationType = 'transcription' | 'translation' | 'dubbing';
type ProviderHint = 'stage5' | 'openai' | 'anthropic' | 'elevenlabs';

export interface OperationEtaInput {
  operationType: EtaOperationType;
  percent: number;
  phaseKey?: string;
  current?: number;
  total?: number;
  etaSeconds?: number;
  startedAt?: number | null;
  phaseStartedAt?: number | null;
  model?: string;
  segmentCount?: number;
  videoDurationSec?: number | null;
  qualityTranslation?: boolean;
  qualityTranscription?: boolean;
  translationDraftProvider?: ProviderHint;
  translationReviewProvider?: ProviderHint;
  transcriptionProvider?: ProviderHint;
  dubbingProvider?: 'openai' | 'elevenlabs';
  nowMs?: number;
}

export interface EtaPhaseDuration {
  phaseKey: string;
  seconds: number;
}

export type EtaCalibrationLookup = (
  bucketKey: string | null | undefined
) => number;

const MIN_LIVE_PROGRESS_PCT = 8;
const MIN_LIVE_ELAPSED_SEC = 8;
const MAX_ETA_SECONDS = 48 * 60 * 60;

function positive(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeModelFamily(model?: string): string | undefined {
  if (!model) return undefined;
  const normalized = model.toLowerCase().replace(/\s*\(fallback\)\s*/g, '');
  if (normalized.includes('claude') && normalized.includes('opus')) {
    return 'claude-opus';
  }
  if (normalized.includes('claude') && normalized.includes('sonnet')) {
    return 'claude-sonnet';
  }
  if (normalized.includes('gpt-5.1')) return 'gpt-5.1';
  if (normalized.includes('gpt')) return 'gpt';
  if (normalized.includes('scribe')) return 'scribe';
  if (normalized.includes('whisper')) return 'whisper';
  if (normalized.includes('tts-1')) return 'tts-1';
  if (normalized.includes('eleven')) return 'elevenlabs';
  if (normalized.includes('openai')) return 'openai';
  return undefined;
}

function detectProviderFromModel(model?: string): ProviderHint | undefined {
  const family = normalizeModelFamily(model);
  if (!family) return undefined;
  if (family.startsWith('claude')) return 'anthropic';
  if (
    family === 'gpt' ||
    family === 'gpt-5.1' ||
    family === 'tts-1' ||
    family === 'whisper' ||
    family === 'openai'
  ) {
    return 'openai';
  }
  if (family === 'scribe' || family === 'elevenlabs') {
    return 'elevenlabs';
  }
  return undefined;
}

function estimateSegments(videoDurationSec?: number | null): number {
  const duration = positive(videoDurationSec);
  if (!duration) return 24;
  return Math.max(12, Math.round(duration / 8));
}

function estimateChunkCount(input: OperationEtaInput): number {
  const reported = positive(input.total);
  if (reported) return Math.round(reported);
  const duration = positive(input.videoDurationSec);
  if (!duration) return 4;
  return Math.max(1, Math.ceil(duration / 90));
}

function getTranslationDraftProvider(
  input: OperationEtaInput
): ProviderHint | undefined {
  return detectProviderFromModel(input.model) ?? input.translationDraftProvider;
}

function getTranslationReviewProvider(
  input: OperationEtaInput
): ProviderHint | undefined {
  return detectProviderFromModel(input.model) ?? input.translationReviewProvider;
}

function buildTranslationPhasePlan(input: OperationEtaInput): EtaPhaseDuration[] {
  const segmentCount =
    positive(input.segmentCount) ?? estimateSegments(input.videoDurationSec);
  const draftProvider = getTranslationDraftProvider(input);
  const reviewProvider = getTranslationReviewProvider(input);
  const draftRatePerSegment =
    draftProvider === 'anthropic'
      ? 1.35
      : draftProvider === 'openai'
        ? 1.0
        : 1.08;
  const reviewRatePerSegment =
    reviewProvider === 'anthropic'
      ? 2.75
      : reviewProvider === 'openai'
        ? 2.0
        : 2.15;
  const draftSeconds = Math.max(8, segmentCount * draftRatePerSegment);
  const reviewSeconds = input.qualityTranslation
    ? Math.max(12, segmentCount * reviewRatePerSegment)
    : 0;
  const finalizeSeconds = clamp(segmentCount * 0.06, 3, 20);

  return [
    { phaseKey: 'translate', seconds: draftSeconds },
    ...(reviewSeconds > 0
      ? [{ phaseKey: 'review', seconds: reviewSeconds }]
      : []),
    { phaseKey: 'finalize', seconds: finalizeSeconds },
  ];
}

function estimateVendorTranscriptionSeconds(durationSec: number): number {
  const bufferMultiplier = durationSec > 3600 ? 1.5 : 1.2;
  return Math.max(20, (durationSec / 8) * bufferMultiplier);
}

function buildTranscriptionPhasePlan(
  input: OperationEtaInput
): EtaPhaseDuration[] {
  const durationSec =
    positive(input.videoDurationSec) ??
    (positive(input.segmentCount) ?? 24) * 8;
  const provider =
    detectProviderFromModel(input.model) ?? input.transcriptionProvider;
  const chunkCount = estimateChunkCount(input);
  const prepareSeconds = Math.max(4, durationSec / 24);
  const analyzeSeconds = Math.max(5, durationSec / 50);
  const chunkAudioSeconds = clamp(chunkCount * 0.35, 2, 18);
  const transcribeChunkSeconds = input.qualityTranscription
    ? Math.max(18, durationSec / 3.4)
    : Math.max(15, durationSec / 4.2);
  const finalizeSeconds = 4;
  const vendorTotal = estimateVendorTranscriptionSeconds(durationSec);
  const includeUpload =
    (input.phaseKey === 'upload_audio' || durationSec >= 30 * 60) &&
    provider === 'elevenlabs';
  const uploadSeconds = includeUpload ? clamp(vendorTotal * 0.18, 4, 45) : 0;
  const vendorProcessSeconds = Math.max(10, vendorTotal - uploadSeconds);

  if (
    input.phaseKey === 'upload_audio' ||
    input.phaseKey === 'transcribe_vendor' ||
    provider === 'elevenlabs'
  ) {
    return [
      { phaseKey: 'prepare_audio', seconds: prepareSeconds },
      ...(includeUpload
        ? [{ phaseKey: 'upload_audio', seconds: uploadSeconds }]
        : []),
      { phaseKey: 'transcribe_vendor', seconds: vendorProcessSeconds },
    ];
  }

  return [
    { phaseKey: 'prepare_audio', seconds: prepareSeconds },
    { phaseKey: 'analyze_audio', seconds: analyzeSeconds },
    { phaseKey: 'chunk_audio', seconds: chunkAudioSeconds },
    { phaseKey: 'transcribe_chunks', seconds: transcribeChunkSeconds },
    { phaseKey: 'finalize', seconds: finalizeSeconds },
  ];
}

function buildDubbingPhasePlan(input: OperationEtaInput): EtaPhaseDuration[] {
  const segmentCount =
    positive(input.segmentCount) ?? estimateSegments(input.videoDurationSec);
  const durationSec = positive(input.videoDurationSec) ?? segmentCount * 6;
  const provider =
    detectProviderFromModel(input.model) ?? input.dubbingProvider ?? 'openai';
  const synthRatePerSegment = provider === 'elevenlabs' ? 1.15 : 0.75;
  const prepareSeconds = clamp(segmentCount * 0.04, 2, 15);
  const synthSeconds = Math.max(8, segmentCount * synthRatePerSegment);
  const alignSeconds = Math.max(3, segmentCount * 0.16);
  const combineSeconds = Math.max(3, durationSec / 45);
  const prepareOutputSeconds = 4;
  const muxSeconds = durationSec > 0 ? Math.max(6, durationSec / 18) : 0;

  return [
    { phaseKey: 'prepare_dub', seconds: prepareSeconds },
    { phaseKey: 'synthesize', seconds: synthSeconds },
    { phaseKey: 'align', seconds: alignSeconds },
    { phaseKey: 'combine_voice_track', seconds: combineSeconds },
    { phaseKey: 'prepare_output', seconds: prepareOutputSeconds },
    ...(positive(input.videoDurationSec)
      ? [{ phaseKey: 'mux', seconds: muxSeconds }]
      : []),
  ];
}

function buildUncalibratedPhasePlan(
  input: OperationEtaInput
): EtaPhaseDuration[] {
  switch (input.operationType) {
    case 'translation':
      return buildTranslationPhasePlan(input);
    case 'transcription':
      return buildTranscriptionPhasePlan(input);
    case 'dubbing':
      return buildDubbingPhasePlan(input);
    default:
      return [];
  }
}

function resolveBucketProvider(
  input: OperationEtaInput,
  phaseKey: string
): string | undefined {
  switch (input.operationType) {
    case 'translation':
      if (phaseKey === 'review') {
        return getTranslationReviewProvider(input);
      }
      return getTranslationDraftProvider(input);
    case 'transcription':
      return detectProviderFromModel(input.model) ?? input.transcriptionProvider;
    case 'dubbing':
      return detectProviderFromModel(input.model) ?? input.dubbingProvider;
    default:
      return undefined;
  }
}

export function getCalibrationBucketKey(
  input: OperationEtaInput,
  phaseKey: string
): string | null {
  if (!phaseKey) return null;

  const parts = ['v1', input.operationType, phaseKey];
  const provider = resolveBucketProvider(input, phaseKey);
  if (provider) {
    parts.push(`provider:${provider}`);
  }

  const modelFamily = normalizeModelFamily(input.model);
  if (
    modelFamily &&
    (phaseKey === 'review' ||
      phaseKey === 'transcribe_vendor' ||
      phaseKey === 'synthesize')
  ) {
    parts.push(`model:${modelFamily}`);
  }

  if (input.operationType === 'translation') {
    parts.push(`hq:${input.qualityTranslation ? '1' : '0'}`);
  }

  if (
    input.operationType === 'transcription' &&
    (phaseKey === 'analyze_audio' ||
      phaseKey === 'chunk_audio' ||
      phaseKey === 'transcribe_chunks')
  ) {
    parts.push(`quality:${input.qualityTranscription ? '1' : '0'}`);
  }

  return parts.join('|');
}

function applyCalibration(
  input: OperationEtaInput,
  phase: EtaPhaseDuration,
  lookup?: EtaCalibrationLookup
): EtaPhaseDuration {
  if (!lookup) return phase;
  const multiplier = lookup(getCalibrationBucketKey(input, phase.phaseKey));
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return phase;
  }
  return {
    ...phase,
    seconds: clamp(phase.seconds * multiplier, 1, MAX_ETA_SECONDS),
  };
}

export function buildPhaseDurationPlan(
  input: OperationEtaInput,
  calibrationLookup?: EtaCalibrationLookup
): EtaPhaseDuration[] {
  return buildUncalibratedPhasePlan(input)
    .map(phase => applyCalibration(input, phase, calibrationLookup))
    .filter(phase => phase.seconds > 0);
}

export function estimateExpectedPhaseSeconds(
  input: OperationEtaInput,
  phaseKey: string,
  calibrationLookup?: EtaCalibrationLookup
): number | null {
  const phase = buildPhaseDurationPlan(input, calibrationLookup).find(
    item => item.phaseKey === phaseKey
  );
  return phase ? phase.seconds : null;
}

function estimatePhaseRemainingSeconds(
  input: OperationEtaInput,
  nowMs: number
): number | null {
  const directEta = positive(input.etaSeconds);
  if (directEta) return directEta;

  const current = positive(input.current);
  const total = positive(input.total);
  const phaseStartedAt = positive(input.phaseStartedAt);
  if (!current || !total || !phaseStartedAt || current >= total) {
    return null;
  }

  const phaseElapsedSec = Math.max(1, (nowMs - phaseStartedAt) / 1000);
  const remainingUnits = total - current;
  return Math.max(1, (phaseElapsedSec / current) * remainingUnits);
}

function estimateBaselineRemainingSeconds(
  input: OperationEtaInput,
  plan: EtaPhaseDuration[],
  nowMs: number
): number | null {
  if (!plan.length) return null;

  const currentIndex = input.phaseKey
    ? plan.findIndex(phase => phase.phaseKey === input.phaseKey)
    : -1;
  if (currentIndex === -1) {
    const totalSeconds = plan.reduce((sum, phase) => sum + phase.seconds, 0);
    return Math.max(1, totalSeconds * (1 - clamp(input.percent, 0, 100) / 100));
  }

  const currentPhase = plan[currentIndex];
  const laterSeconds = plan
    .slice(currentIndex + 1)
    .reduce((sum, phase) => sum + phase.seconds, 0);

  let currentRemaining = currentPhase.seconds;
  const current = positive(input.current);
  const total = positive(input.total);
  if (current && total) {
    currentRemaining =
      current >= total
        ? 0
        : currentPhase.seconds * clamp((total - current) / total, 0, 1);
  } else {
    const phaseStartedAt = positive(input.phaseStartedAt);
    if (phaseStartedAt) {
      const phaseElapsedSec = Math.max(0, (nowMs - phaseStartedAt) / 1000);
      currentRemaining = Math.max(0, currentPhase.seconds - phaseElapsedSec);
    }
  }

  return Math.max(1, currentRemaining + laterSeconds);
}

function estimateOverallRemainingSeconds(
  input: OperationEtaInput,
  nowMs: number
): number | null {
  const startedAt = positive(input.startedAt);
  if (!startedAt) return null;
  if (input.percent < MIN_LIVE_PROGRESS_PCT || input.percent >= 100) return null;

  const elapsedSec = Math.max(1, (nowMs - startedAt) / 1000);
  if (elapsedSec < MIN_LIVE_ELAPSED_SEC) return null;

  return (elapsedSec * (100 - input.percent)) / input.percent;
}

export function estimateRemainingSeconds(
  input: OperationEtaInput,
  calibrationLookup?: EtaCalibrationLookup
): number | null {
  if (!Number.isFinite(input.percent) || input.percent >= 100) {
    return null;
  }

  const nowMs = input.nowMs ?? Date.now();
  const plan = buildPhaseDurationPlan(input, calibrationLookup);
  const baselineRemaining = estimateBaselineRemainingSeconds(input, plan, nowMs);
  const phaseRemaining = estimatePhaseRemainingSeconds(input, nowMs);
  const overallRemaining = estimateOverallRemainingSeconds(input, nowMs);

  let remaining =
    overallRemaining != null && baselineRemaining != null
      ? overallRemaining * 0.75 + baselineRemaining * 0.25
      : overallRemaining ?? baselineRemaining ?? null;

  if (phaseRemaining != null) {
    remaining = remaining != null ? Math.max(remaining, phaseRemaining) : phaseRemaining;
  }

  if (!Number.isFinite(remaining) || remaining == null || remaining <= 0) {
    return null;
  }

  return clamp(Math.round(remaining), 5, MAX_ETA_SECONDS);
}

function roundEtaSeconds(seconds: number): number {
  if (seconds < 60) {
    return Math.ceil(seconds / 5) * 5;
  }
  if (seconds < 3600) {
    return Math.ceil(seconds / 30) * 30;
  }
  if (seconds < 24 * 3600) {
    return Math.ceil(seconds / 60) * 60;
  }
  return Math.ceil(seconds / 3600) * 3600;
}

export function formatEtaDuration(seconds: number): string {
  const rounded = roundEtaSeconds(Math.max(1, seconds));
  if (rounded < 60) {
    return `${rounded}s`;
  }

  const totalMinutes = Math.ceil(rounded / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remainingMinutes > 0
      ? `${totalHours}h ${remainingMinutes}m`
      : `${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
