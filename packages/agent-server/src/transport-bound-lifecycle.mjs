const DEFAULT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
export const DEFAULT_EXPLICIT_SHUTDOWN_GRACE_MS = 10_000;

export function shouldForceDevelopmentShutdown(reason) {
  switch (reason) {
    case 'signal:SIGINT':
    case 'signal:SIGTERM':
    case 'signal:SIGHUP':
    case 'process:disconnect':
    case 'stdin:end':
    case 'stdin:close':
    case 'stdin:error':
    case 'readline:close':
    case 'output:close':
    case 'output:error':
    case 'transport:close':
    case 'owner-monitor:exit':
    case 'owner-monitor:control-error':
    case 'owner-monitor:process-error':
      return true;
    default:
      return false;
  }
}

function isTransportCloseAcknowledgement(reason) {
  switch (reason) {
    case 'stdin:end':
    case 'stdin:close':
    case 'stdin:error':
    case 'readline:close':
    case 'output:close':
    case 'output:error':
    case 'transport:close':
      return true;
    default:
      return false;
  }
}

/**
 * Binds a process-owned resource to the lifetime of its controlling stdio
 * transport. Normal shutdown awaits one close. Ownership-loss shutdown also
 * invokes that close once, but may finish through one explicit force path if
 * the close promise itself never settles.
 */
export function installTransportBoundLifecycle({
  close,
  forceClose,
  forceOnFirstShutdown = () => false,
  closeTransport,
  processTarget = process,
  input = process.stdin,
  outputs = [process.stdout, process.stderr],
  readline = null,
  signals = DEFAULT_SIGNALS,
  gracefulShutdownTimeoutMs = DEFAULT_EXPLICIT_SHUTDOWN_GRACE_MS,
  shouldBoundGracefulShutdown = reason => reason === 'command:quit',
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = timer => clearTimeout(timer),
  exit = code => processTarget.exit(code),
  onError,
}) {
  const listeners = [];
  let shutdownPromise = null;
  let transportClosePromise = null;
  let forcePromise = null;
  let forceError = null;
  let exitPromise = null;
  let exitRequested = false;
  let requestedExitCode = 0;
  let closeSettled = false;
  let transportCloseStarted = false;
  let gracefulShutdownTimer = null;
  let resolveForceRequested = null;
  let resolveTransportDisconnected = null;
  const forceRequested = new Promise(resolve => {
    resolveForceRequested = resolve;
  });
  const transportDisconnected = new Promise(resolve => {
    resolveTransportDisconnected = resolve;
  });

  const requestForce = reason => {
    if (gracefulShutdownTimer) {
      clearTimer(gracefulShutdownTimer);
      gracefulShutdownTimer = null;
    }
    if (!forceClose || forcePromise) {
      return forcePromise ?? Promise.resolve();
    }

    forcePromise = Promise.resolve()
      .then(() => forceClose(reason))
      .catch(error => {
        forceError = error;
      });
    resolveForceRequested?.();
    resolveForceRequested = null;
    return forcePromise;
  };

  const scheduleGracefulShutdownDeadline = reason => {
    if (
      !forceClose ||
      gracefulShutdownTimer ||
      !shouldBoundGracefulShutdown(reason) ||
      !Number.isFinite(gracefulShutdownTimeoutMs) ||
      gracefulShutdownTimeoutMs < 0
    ) {
      return;
    }
    gracefulShutdownTimer = setTimer(() => {
      gracefulShutdownTimer = null;
      void requestForce(`deadline:${reason}`);
    }, gracefulShutdownTimeoutMs);
    gracefulShutdownTimer?.unref?.();
  };

  const shutdown = reason => {
    if (shutdownPromise) return shutdownPromise;

    // Defer the body by one microtask so shutdownPromise is assigned before a
    // resource close can synchronously emit another disconnect event.
    shutdownPromise = Promise.resolve().then(async () => {
      let firstError = null;
      try {
        await close(reason);
      } catch (error) {
        firstError = error;
      } finally {
        closeSettled = true;
      }

      if (firstError) throw firstError;
    });

    return shutdownPromise;
  };

  const closeTransportOnce = reason => {
    if (transportClosePromise) return transportClosePromise;
    // Invoke synchronously so a forced path starts transport teardown before
    // process.exit(). Preserve the original promise for graceful callers while
    // attaching a rejection observer for forced callers that intentionally do
    // not await a potentially hung transport implementation.
    transportCloseStarted = true;
    try {
      transportClosePromise = Promise.resolve(closeTransport?.(reason));
    } catch (error) {
      transportClosePromise = Promise.reject(error);
    }
    void transportClosePromise.catch(() => {});
    return transportClosePromise;
  };

  const requestShutdown = (reason, exitCode = 0) => {
    requestedExitCode = Math.max(requestedExitCode, exitCode);
    if (exitRequested) {
      if (
        closeSettled &&
        transportCloseStarted &&
        isTransportCloseAcknowledgement(reason)
      ) {
        // readline and SDK transports commonly emit their public close event
        // from the close we initiated. Treat that event as completion evidence,
        // not as a second request to force an already-closed application.
        resolveTransportDisconnected?.();
        resolveTransportDisconnected = null;
        return exitPromise ?? shutdownPromise ?? Promise.resolve();
      }
      // A second trigger is also allowed to escalate after the resource close
      // has settled: the transport's own close implementation may be the part
      // that is permanently pending.
      void requestForce(reason);
      return exitPromise ?? shutdownPromise ?? Promise.resolve();
    }

    exitRequested = true;
    const completion = shutdown(reason);
    const closeOutcome = completion.then(
      () => ({ forced: false, error: null }),
      error => ({ forced: false, error })
    );
    if (forceOnFirstShutdown(reason)) void requestForce(reason);
    else scheduleGracefulShutdownDeadline(reason);

    exitPromise = (async () => {
      const outcome = await Promise.race([
        closeOutcome,
        forceRequested.then(() => ({ forced: true, error: null })),
      ]);
      let firstError = outcome.error;
      let forced = outcome.forced;
      if (forced) {
        // A transport loss or repeated shutdown trigger is the deterministic
        // escalation point. Do not let a permanently pending Playwright close
        // keep the now-ownerless controller alive after its process was killed.
        await forcePromise;
        firstError ??= forceError;
      }

      const transportCompletion = closeTransportOnce(reason);
      if (!forced) {
        const transportOutcome = await Promise.race([
          transportCompletion.then(
            () => ({ forced: false, disconnected: false, error: null }),
            error => ({ forced: false, disconnected: false, error })
          ),
          transportDisconnected.then(() => ({
            forced: false,
            disconnected: true,
            error: null,
          })),
          forceRequested.then(() => ({
            forced: true,
            disconnected: false,
            error: null,
          })),
        ]);
        forced = transportOutcome.forced;
        firstError ??= transportOutcome.error;
        if (forced) {
          // closeTransportOnce() was started synchronously above, but a later
          // signal/disconnect must still be able to release a controller whose
          // transport close never resolves.
          await forcePromise;
          firstError ??= forceError;
        }
      }

      if (firstError) {
        try {
          onError?.(firstError, reason);
        } catch {
          // A failed controlling transport is not a safe reporting channel.
        }
      }

      if (gracefulShutdownTimer) {
        clearTimer(gracefulShutdownTimer);
        gracefulShutdownTimer = null;
      }
      return exit(requestedExitCode);
    })();
    return exitPromise;
  };

  const listen = (
    emitter,
    event,
    reason,
    { once = true, exitCode = 0 } = {}
  ) => {
    if (!emitter?.on) return;
    const listener = () => {
      void requestShutdown(reason, exitCode);
    };
    if (once) emitter.once(event, listener);
    else emitter.on(event, listener);
    listeners.push({ emitter, event, listener });
  };

  for (const signal of signals) {
    listen(processTarget, signal, `signal:${signal}`, { once: false });
  }
  listen(processTarget, 'disconnect', 'process:disconnect', { exitCode: 1 });
  listen(input, 'end', 'stdin:end');
  listen(input, 'close', 'stdin:close');
  listen(input, 'error', 'stdin:error', { exitCode: 1 });
  listen(readline, 'close', 'readline:close');
  for (const output of outputs) {
    listen(output, 'close', 'output:close');
    listen(output, 'error', 'output:error', { exitCode: 1 });
  }

  return {
    shutdown,
    forceShutdown: requestForce,
    requestShutdown,
    transportClosed: () => requestShutdown('transport:close'),
    dispose() {
      if (gracefulShutdownTimer) {
        clearTimer(gracefulShutdownTimer);
        gracefulShutdownTimer = null;
      }
      for (const { emitter, event, listener } of listeners) {
        if (emitter.off) emitter.off(event, listener);
        else emitter.removeListener?.(event, listener);
      }
      listeners.length = 0;
    },
  };
}
