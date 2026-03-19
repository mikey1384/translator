import type { TFunction } from 'i18next';
import type { TranslationTask } from '../../state/task-store';
import { translateTranscriptionStageLabel } from '../../components/ProgressAreas/transcription-stage-label.js';
import { translateStageLabel } from '../../components/TranscriptSummaryPanel/TranscriptSummaryPanel.helpers.js';
import type { HighlightWorkflowRuntime } from '../../state/highlight-workflow-store';

type HighlightWorkflowProgressState = {
  percent: number;
  stage: string;
};

type HighlightWorkflowProgressRuntime = Pick<
  HighlightWorkflowRuntime,
  | 'running'
  | 'requiresTranscription'
  | 'transcriptionOperationId'
  | 'awaitingSummaryStart'
>;

export function deriveHighlightWorkflowState({
  runtime,
  summaryOperationId,
  transcriptionTask,
  summaryTask,
  t,
}: {
  runtime: HighlightWorkflowProgressRuntime;
  summaryOperationId: string | null;
  transcriptionTask: TranslationTask;
  summaryTask: TranslationTask;
  t: TFunction;
}): {
  highlightSummaryActive: boolean;
  highlightTranscriptionActive: boolean;
  progress: HighlightWorkflowProgressState;
} {
  const highlightSummaryActive =
    Boolean(summaryOperationId) &&
    summaryTask.inProgress &&
    summaryTask.id === summaryOperationId;

  const highlightTranscriptionActive =
    runtime.running &&
    runtime.requiresTranscription &&
    transcriptionTask.inProgress &&
    transcriptionTask.id === runtime.transcriptionOperationId;

  if (highlightTranscriptionActive) {
    const transcribePercent = Math.max(
      0,
      Math.min(100, Number(transcriptionTask.percent) || 0)
    );
    return {
      highlightSummaryActive,
      highlightTranscriptionActive,
      progress: {
        percent: Math.round(transcribePercent * 0.5),
        stage: translateTranscriptionStageLabel(transcriptionTask.stage, t),
      },
    };
  }

  if (runtime.awaitingSummaryStart || !highlightSummaryActive) {
    const stage = t('summary.status.preparing');
    return {
      highlightSummaryActive,
      highlightTranscriptionActive,
      progress: runtime.requiresTranscription
        ? { percent: 50, stage }
        : { percent: 0, stage },
    };
  }

  const summaryPercent = Math.max(
    0,
    Math.min(100, Number(summaryTask.percent) || 0)
  );
  const summaryStage = summaryTask.stage
    ? translateStageLabel(summaryTask.stage, t)
    : t('summary.status.preparing');

  return {
    highlightSummaryActive,
    highlightTranscriptionActive,
    progress: runtime.requiresTranscription
      ? {
          percent: 50 + Math.round(summaryPercent * 0.5),
          stage: summaryStage,
        }
      : {
          percent: summaryPercent,
          stage: summaryStage,
        },
  };
}
