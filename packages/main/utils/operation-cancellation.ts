import { CancelledError } from '../../shared/cancelled-error.js';
import { consumeCancelMarker } from './cancel-markers.js';

type OperationCancellationOptions = {
  signal?: AbortSignal;
  operationId?: string;
  context?: string;
  log?: {
    info?: (...args: any[]) => void;
  };
  onCancel?: () => void | Promise<void>;
  pollMs?: number;
};

function logCancellation(
  options: OperationCancellationOptions,
  source: 'signal' | 'marker'
): void {
  const { operationId, context, log } = options;
  const contextLabel = context ? ` (${context})` : '';
  const operationLabel = operationId ? ` (Op ID: ${operationId})` : '';
  log?.info?.(
    `[cancel] Operation cancelled via ${source}${contextLabel}${operationLabel}`
  );
}

async function invokeOnCancel(
  options: OperationCancellationOptions
): Promise<void> {
  if (!options.onCancel) return;
  try {
    await options.onCancel();
  } catch {
    // Ignore cleanup failures during cancellation.
  }
}

function invokeOnCancelSync(options: OperationCancellationOptions): void {
  void invokeOnCancel(options);
}

async function throwIfOperationCancelledAsync(
  options: OperationCancellationOptions = {}
): Promise<void> {
  if (options.signal?.aborted) {
    logCancellation(options, 'signal');
    await invokeOnCancel(options);
    throw new CancelledError();
  }

  if (options.operationId && consumeCancelMarker(options.operationId)) {
    logCancellation(options, 'marker');
    await invokeOnCancel(options);
    throw new CancelledError();
  }
}

export function throwIfOperationCancelled(
  options: OperationCancellationOptions = {}
): void {
  if (options.signal?.aborted) {
    logCancellation(options, 'signal');
    invokeOnCancelSync(options);
    throw new CancelledError();
  }

  if (options.operationId && consumeCancelMarker(options.operationId)) {
    logCancellation(options, 'marker');
    invokeOnCancelSync(options);
    throw new CancelledError();
  }
}

export function rethrowIfCancelled(error: unknown): void {
  if (error instanceof CancelledError) {
    throw error;
  }
}

export async function raceOperationCancellation<T>(
  promise: Promise<T>,
  options: OperationCancellationOptions = {}
): Promise<T> {
  await throwIfOperationCancelledAsync(options);

  const { signal, operationId, pollMs = 200 } = options;
  if (!signal && !operationId) {
    return promise;
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let markerTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (markerTimer) {
        clearInterval(markerTimer);
        markerTimer = null;
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const rejectCancelled = (source: 'signal' | 'marker') => {
      if (settled) return;
      settled = true;
      cleanup();
      void (async () => {
        logCancellation(options, source);
        await invokeOnCancel(options);
        reject(new CancelledError());
      })();
    };

    const onAbort = () => rejectCancelled('signal');

    if (signal) {
      if (signal.aborted) {
        rejectCancelled('signal');
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (operationId) {
      markerTimer = setInterval(() => {
        if (consumeCancelMarker(operationId)) {
          rejectCancelled('marker');
        }
      }, pollMs);
    }

    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error))
    );
  });
}

export async function sleepWithOperationCancellation(
  ms: number,
  options: OperationCancellationOptions = {}
): Promise<void> {
  if (ms <= 0) {
    throwIfOperationCancelled(options);
    return;
  }

  const sliceMs = Math.max(1, options.pollMs ?? 200);
  let remainingMs = ms;
  while (remainingMs > 0) {
    throwIfOperationCancelled(options);
    const nextSliceMs = Math.min(sliceMs, remainingMs);
    await raceOperationCancellation(
      new Promise<void>(resolve => {
        setTimeout(resolve, nextSliceMs);
      }),
      {
        ...options,
        operationId: undefined,
      }
    );
    remainingMs -= nextSliceMs;
  }

  throwIfOperationCancelled(options);
}
