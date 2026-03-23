import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';

export type StepTwoWorkflowKind = 'translate' | 'highlight';
export type StepTwoWorkflowPhase = 'transcribing' | 'handoff' | 'running';

interface State {
  kind: StepTwoWorkflowKind | null;
  phase: StepTwoWorkflowPhase | null;
  transcriptionOperationId: string | null;
  followUpId: string | number | null;
  language: string | null;
  sourceKey: string | null;
  runToken: number;
}

interface WorkflowMutationOptions {
  expectedRunToken?: number;
  followUpId?: string | number | null;
}

interface Actions {
  startWorkflow(options: {
    kind: StepTwoWorkflowKind;
    language: string | null;
    sourceKey: string | null;
    transcriptionOperationId?: string | null;
    followUpId?: string | number | null;
  }): number;
  transitionToHandoff(options?: WorkflowMutationOptions): void;
  transitionToRunning(options?: WorkflowMutationOptions): void;
  clearWorkflow(options?: { expectedRunToken?: number }): void;
}

const initialState: Omit<State, 'runToken'> = {
  kind: null,
  phase: null,
  transcriptionOperationId: null,
  followUpId: null,
  language: null,
  sourceKey: null,
};

function matchesExpectedRunToken(
  state: State,
  expectedRunToken?: number
): boolean {
  return expectedRunToken == null || state.runToken === expectedRunToken;
}

function applyPhaseTransition(
  state: State,
  phase: StepTwoWorkflowPhase,
  options?: WorkflowMutationOptions
) {
  if (!matchesExpectedRunToken(state, options?.expectedRunToken)) return;
  state.phase = phase;
  if (Object.prototype.hasOwnProperty.call(options ?? {}, 'followUpId')) {
    state.followUpId = options?.followUpId ?? null;
  }
}

export const useStepTwoWorkflowStore = createWithEqualityFn<State & Actions>()(
  immer(set => ({
    ...initialState,
    runToken: 0,

    startWorkflow: options => {
      let nextRunToken = 0;
      set(state => {
        state.runToken += 1;
        nextRunToken = state.runToken;
        state.kind = options.kind;
        state.phase = options.transcriptionOperationId
          ? 'transcribing'
          : 'handoff';
        state.transcriptionOperationId =
          options.transcriptionOperationId ?? null;
        state.followUpId = options.followUpId ?? null;
        state.language = options.language ?? null;
        state.sourceKey = options.sourceKey ?? null;
      });
      return nextRunToken;
    },

    transitionToHandoff: options =>
      set(state => {
        applyPhaseTransition(state, 'handoff', options);
      }),

    transitionToRunning: options =>
      set(state => {
        applyPhaseTransition(state, 'running', options);
      }),

    clearWorkflow: options =>
      set(state => {
        if (!matchesExpectedRunToken(state, options?.expectedRunToken)) return;
        state.runToken += 1;
        Object.assign(state, {
          ...initialState,
          runToken: state.runToken,
        });
      }),
  }))
);
