import { useAiStore } from '../state/ai-store';
import { useSubStore } from '../state/subtitle-store';
import { useTaskStore, type TranslationTask } from '../state/task-store';
import { useUIStore } from '../state/ui-store';
import { useVideoStore } from '../state/video-store';
import { useEtaCalibrationStore } from '../state/eta-calibration-store';
import {
  resolveDubbingCreditProvider,
  resolveDubbingProvider,
  resolveTranscriptionProvider,
  resolveTranslationDraftProvider,
  resolveTranslationReviewProvider,
  type ByoRuntimeState,
} from '../state/byo-runtime';
import {
  estimateExpectedPhaseSeconds,
  getCalibrationBucketKey,
  type OperationEtaInput,
} from '../utils/progressEta';

type OperationKind = 'translation' | 'transcription' | 'dubbing';

type TaskSnapshot = Pick<
  TranslationTask,
  | 'id'
  | 'stage'
  | 'percent'
  | 'inProgress'
  | 'isCompleted'
  | 'model'
  | 'phaseKey'
  | 'current'
  | 'total'
  | 'startedAt'
  | 'phaseStartedAt'
>;

type RunContext = Pick<
  OperationEtaInput,
  | 'operationType'
  | 'segmentCount'
  | 'videoDurationSec'
  | 'qualityTranslation'
  | 'qualityTranscription'
  | 'translationDraftProvider'
  | 'translationReviewProvider'
  | 'transcriptionProvider'
  | 'dubbingProvider'
>;

interface Tracker {
  operationId: string;
  context: RunContext;
}

const trackers = new Map<string, Tracker>();

function buildRuntimeState(): ByoRuntimeState {
  const ai = useAiStore.getState();
  return {
    useApiKeysMode: ai.useApiKeysMode,
    byoUnlocked: ai.byoUnlocked,
    byoAnthropicUnlocked: ai.byoAnthropicUnlocked,
    byoElevenLabsUnlocked: ai.byoElevenLabsUnlocked,
    stage5AnthropicReviewAvailable: ai.stage5AnthropicReviewAvailable,
    useByo: ai.useByo,
    useByoAnthropic: ai.useByoAnthropic,
    useByoElevenLabs: ai.useByoElevenLabs,
    keyPresent: ai.keyPresent,
    anthropicKeyPresent: ai.anthropicKeyPresent,
    elevenLabsKeyPresent: ai.elevenLabsKeyPresent,
    preferClaudeTranslation: ai.preferClaudeTranslation,
    preferClaudeReview: ai.preferClaudeReview,
    preferClaudeSummary: ai.preferClaudeSummary,
    preferredTranscriptionProvider: ai.preferredTranscriptionProvider,
    preferredDubbingProvider: ai.preferredDubbingProvider,
    stage5DubbingTtsProvider: ai.stage5DubbingTtsProvider,
  };
}

function buildRunContext(operationType: OperationKind): RunContext {
  const runtimeState = buildRuntimeState();
  const ui = useUIStore.getState();
  const videoDurationSec = useVideoStore.getState().meta?.duration ?? null;
  const segmentCount = useSubStore.getState().order.length;

  const resolvedTranscriptionProvider =
    resolveTranscriptionProvider(runtimeState);
  const transcriptionProviderHint =
    resolvedTranscriptionProvider === 'stage5'
      ? runtimeState.preferredTranscriptionProvider === 'openai'
        ? 'openai'
        : 'elevenlabs'
      : resolvedTranscriptionProvider;
  const resolvedDubbingProvider = resolveDubbingProvider(runtimeState);
  const dubbingProviderHint =
    resolvedDubbingProvider === 'stage5'
      ? resolveDubbingCreditProvider(runtimeState)
      : resolvedDubbingProvider === 'elevenlabs'
        ? 'elevenlabs'
        : 'openai';

  return {
    operationType,
    segmentCount,
    videoDurationSec,
    qualityTranslation: ui.qualityTranslation,
    qualityTranscription: ui.qualityTranscription,
    translationDraftProvider: resolveTranslationDraftProvider(runtimeState),
    translationReviewProvider: resolveTranslationReviewProvider(runtimeState),
    transcriptionProvider: transcriptionProviderHint,
    dubbingProvider: dubbingProviderHint,
  };
}

function trackerKey(operationType: OperationKind, operationId: string) {
  return `${operationType}:${operationId}`;
}

function getTracker(
  operationType: OperationKind,
  operationId: string
): Tracker {
  const key = trackerKey(operationType, operationId);
  let tracker = trackers.get(key);
  if (!tracker) {
    tracker = {
      operationId,
      context: buildRunContext(operationType),
    };
    trackers.set(key, tracker);
  }
  return tracker;
}

function dropTracker(operationType: OperationKind, operationId?: string | null) {
  if (!operationId) return;
  trackers.delete(trackerKey(operationType, operationId));
}

function isFailureLike(stage: string): boolean {
  return /(cancel|abort|error|fail|insufficient|quota|denied|invalid)/i.test(
    stage
  );
}

function shouldRecordTerminalPhase(
  current: TaskSnapshot,
  previous: TaskSnapshot
): boolean {
  const stage = String(current.stage || previous.stage || '');
  if (isFailureLike(stage)) return false;
  return Boolean(
    current.percent >= 100 ||
      previous.percent >= 100 ||
      current.isCompleted ||
      previous.isCompleted
  );
}

function recordPhaseObservation(
  operationType: OperationKind,
  tracker: Tracker,
  task: TaskSnapshot,
  endedAtMs: number
) {
  if (!task.phaseKey || !task.phaseStartedAt || !task.id) return;

  const observedSeconds = Math.max(0, (endedAtMs - task.phaseStartedAt) / 1000);
  if (!Number.isFinite(observedSeconds) || observedSeconds < 1) return;

  const input: OperationEtaInput = {
    ...tracker.context,
    percent: task.percent,
    phaseKey: task.phaseKey,
    current: task.current,
    total: task.total,
    model: task.model,
    startedAt: task.startedAt,
    phaseStartedAt: task.phaseStartedAt,
  };

  const expectedSeconds = estimateExpectedPhaseSeconds(input, task.phaseKey);
  const bucketKey = getCalibrationBucketKey(input, task.phaseKey);
  if (!expectedSeconds || !bucketKey) return;

  useEtaCalibrationStore.getState().recordObservation({
    bucketKey,
    observedSeconds,
    expectedSeconds,
  });
}

function handleTaskChange(
  operationType: OperationKind,
  current: TaskSnapshot,
  previous: TaskSnapshot
) {
  const currentId = current.id;
  const previousId = previous.id;

  if (current.inProgress && currentId) {
    getTracker(operationType, currentId);
  }

  if (!previous.inProgress || !previousId) {
    if (!current.inProgress && currentId) {
      dropTracker(operationType, currentId);
    }
    return;
  }

  const tracker = getTracker(operationType, previousId);

  const phaseChanged =
    previous.phaseKey &&
    current.inProgress &&
    currentId === previousId &&
    current.phaseKey !== previous.phaseKey;

  if (phaseChanged) {
    const endedAtMs = current.phaseStartedAt ?? Date.now();
    recordPhaseObservation(operationType, tracker, previous, endedAtMs);
    return;
  }

  const terminated = !current.inProgress || currentId !== previousId;
  if (!terminated) {
    return;
  }

  if (shouldRecordTerminalPhase(current, previous)) {
    recordPhaseObservation(operationType, tracker, previous, Date.now());
  }

  dropTracker(operationType, previousId);
}

useTaskStore.subscribe((state, previous) => {
  handleTaskChange('translation', state.translation, previous.translation);
  handleTaskChange('transcription', state.transcription, previous.transcription);
  handleTaskChange('dubbing', state.dubbing, previous.dubbing);
});
