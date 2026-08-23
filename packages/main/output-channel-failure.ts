export interface OutputFailureLogger {
  transports: {
    console: {
      level: string | false;
      writeFn: (...args: unknown[]) => unknown;
    };
  };
  processInternalErrorFn: (error: unknown) => void;
  error: (...data: unknown[]) => void;
}

interface ErrorEmitter {
  on(event: 'error', listener: (error: unknown) => void): unknown;
  off(event: 'error', listener: (error: unknown) => void): unknown;
}

interface OutputChannelFailureGuardOptions {
  logger: OutputFailureLogger;
  stdout?: ErrorEmitter;
  stderr?: ErrorEmitter;
  onFailure?: (error: NodeJS.ErrnoException) => void;
  requestShutdown: (error: NodeJS.ErrnoException) => unknown;
}

/** Coordinates terminal requests that can arrive from independent failures. */
export function createIdempotentShutdownRequest<T>(
  requestShutdown: (value: T) => unknown
): (value: T) => boolean {
  let requested = false;

  return value => {
    if (requested) return false;
    requested = true;
    requestShutdown(value);
    return true;
  };
}

export function isBrokenPipeError(
  error: unknown
): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EPIPE'
  );
}

/**
 * Contains a failed stdout/stderr channel before electron-log can report its
 * own console-transport failure through that same channel.
 */
export function installOutputChannelFailureGuard({
  logger,
  stdout,
  stderr,
  onFailure,
  requestShutdown,
}: OutputChannelFailureGuardOptions) {
  const consoleTransport = logger.transports.console;
  const originalConsoleWrite = consoleTransport.writeFn;
  const originalInternalError = logger.processInternalErrorFn;
  let failed = false;
  let shutdownRequested = false;

  const requestShutdownSafely = (error: NodeJS.ErrnoException) => {
    if (shutdownRequested) return;
    // Claim the request before invoking user code: app.exit(), telemetry, or
    // test doubles can synchronously surface another queued EPIPE.
    shutdownRequested = true;
    try {
      const shutdownResult = requestShutdown(error);
      void Promise.resolve(shutdownResult).catch(() => {});
    } catch {
      // The failed output remains contained. The terminal callback is never
      // re-entered through a later queued EPIPE.
    }
  };

  const handle = (error: unknown): boolean => {
    if (!isBrokenPipeError(error)) return false;
    if (failed) {
      requestShutdownSafely(error);
      return true;
    }

    // This must happen before telemetry, file logging, or shutdown callbacks:
    // none of those paths may fall back to the failed console transport.
    failed = true;
    consoleTransport.level = false;

    try {
      onFailure?.(error);
    } catch {
      // The output channel is already unavailable; there is nowhere safe to
      // report a secondary failure from failure bookkeeping.
    }

    try {
      logger.error(
        '[main.ts] stdout/stderr closed (EPIPE); console logging disabled and shutdown requested.'
      );
    } catch {
      // File logging is best-effort here. Never fall back to the failed pipe.
    }

    requestShutdownSafely(error);

    return true;
  };

  const guardedConsoleWrite = (...args: unknown[]) => {
    try {
      return originalConsoleWrite.apply(consoleTransport, args);
    } catch (error) {
      if (handle(error)) return undefined;
      throw error;
    }
  };

  const guardedInternalError = (error: unknown) => {
    if (failed) return;
    originalInternalError.call(logger, error);
  };

  const streamErrorListener = (error: unknown) => {
    if (!handle(error)) throw error;
  };

  consoleTransport.writeFn = guardedConsoleWrite;
  logger.processInternalErrorFn = guardedInternalError;
  stdout?.on('error', streamErrorListener);
  stderr?.on('error', streamErrorListener);

  return {
    handle,
    hasFailed: () => failed,
    shouldSuppressUnhandled(error: unknown) {
      // Global exception/rejection handlers do not identify the originating
      // descriptor. Only suppress a queued EPIPE after this guard has already
      // observed failure at the console transport or stdout/stderr itself.
      // A first EPIPE from an unrelated socket retains normal handling.
      return failed && isBrokenPipeError(error);
    },
    dispose() {
      stdout?.off('error', streamErrorListener);
      stderr?.off('error', streamErrorListener);
      if (consoleTransport.writeFn === guardedConsoleWrite) {
        consoleTransport.writeFn = originalConsoleWrite;
      }
      if (logger.processInternalErrorFn === guardedInternalError) {
        logger.processInternalErrorFn = originalInternalError;
      }
    },
  };
}
