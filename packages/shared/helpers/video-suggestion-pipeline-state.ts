import type {
  VideoSuggestionProgress,
  VideoSuggestionStageKey,
  VideoSuggestionStageState,
} from '@shared-types/app';

export type VideoSuggestionPipelineStage = {
  key: VideoSuggestionStageKey;
  index: number;
  state: VideoSuggestionStageState;
  outcome: string;
};

const PIPELINE_STAGE_KEYS: VideoSuggestionStageKey[] = [
  'answerer',
  'planner',
  'retrieval',
];

export function createInitialVideoSuggestionPipelineStages(): VideoSuggestionPipelineStage[] {
  return PIPELINE_STAGE_KEYS.map((key, index) => ({
    key,
    index: index + 1,
    state: 'pending',
    outcome: '',
  }));
}

function isPipelineStageKey(value: unknown): value is VideoSuggestionStageKey {
  return (
    typeof value === 'string' &&
    PIPELINE_STAGE_KEYS.includes(value as VideoSuggestionStageKey)
  );
}

function inferStageFromMessage(
  message: string
): { key: VideoSuggestionStageKey; state: VideoSuggestionStageState } | null {
  const match = message.match(/step\s*([1-3])\s*\/\s*3/i);
  if (!match) return null;
  const index = Number(match[1]);
  if (!Number.isFinite(index) || index < 1 || index > 3) return null;
  return {
    key: PIPELINE_STAGE_KEYS[index - 1],
    state: /cleared/i.test(message) ? 'cleared' : 'running',
  };
}

export function applyVideoSuggestionPipelineProgress(
  stages: VideoSuggestionPipelineStage[],
  progress: VideoSuggestionProgress,
  progressMessage: string
): VideoSuggestionPipelineStage[] {
  const currentStages = progress.resetPipelineStages
    ? createInitialVideoSuggestionPipelineStages()
    : stages;
  const stageFromPayload = isPipelineStageKey(progress.stageKey)
    ? {
        key: progress.stageKey,
        state:
          progress.stageState === 'cleared'
            ? ('cleared' as const)
            : progress.stageState === 'running'
              ? ('running' as const)
              : ('pending' as const),
      }
    : null;
  const stageFromMessage =
    !stageFromPayload && progressMessage
      ? inferStageFromMessage(progressMessage)
      : null;
  const stageUpdate = stageFromPayload || stageFromMessage;
  if (!stageUpdate) return currentStages;

  const outcomeRaw =
    typeof progress.stageOutcome === 'string'
      ? progress.stageOutcome.trim()
      : '';
  const outcome =
    outcomeRaw || (stageUpdate.state === 'cleared' ? progressMessage : '');

  return currentStages.map(stage => {
    if (stage.key !== stageUpdate.key) return stage;
    if (stage.state === 'cleared' && stageUpdate.state !== 'cleared') {
      return stage;
    }
    return {
      ...stage,
      state: stageUpdate.state,
      outcome: outcome || stage.outcome,
    };
  });
}
