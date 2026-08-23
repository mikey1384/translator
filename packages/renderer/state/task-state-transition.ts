export interface TaskLifecycleSnapshot {
  inProgress: boolean;
  isCompleted?: boolean;
}

export interface TaskLifecycleState {
  inProgress: boolean;
  isCompleted: boolean;
}

export interface TaskLifecyclePatch {
  inProgress?: boolean;
  isCompleted?: boolean;
  percent?: number;
}

/**
 * Resolves task lifecycle only from explicit state. A percentage or a
 * human-readable/localized stage cannot distinguish success from failure.
 */
export function resolveTaskLifecycle(
  current: TaskLifecycleSnapshot,
  patch: TaskLifecyclePatch
): TaskLifecycleState {
  const hasCompletion = Object.prototype.hasOwnProperty.call(
    patch,
    'isCompleted'
  );
  let isCompleted = hasCompletion
    ? patch.isCompleted === true
    : current.isCompleted === true;

  let inProgress = current.inProgress;
  if (typeof patch.inProgress === 'boolean') {
    inProgress = patch.inProgress;
    if (patch.inProgress && !hasCompletion) isCompleted = false;
  } else if (hasCompletion) {
    inProgress = false;
  } else if (
    typeof patch.percent === 'number' &&
    Number.isFinite(patch.percent) &&
    patch.percent < 100
  ) {
    inProgress = true;
    isCompleted = false;
  }

  // Completion is terminal even if a malformed caller supplies contradictory
  // explicit flags. Never expose a task as completed and running together.
  if (isCompleted) inProgress = false;

  return { inProgress, isCompleted };
}
