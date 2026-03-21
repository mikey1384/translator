type AutoCancelTarget = {
  once: (event: string, listener: (...args: any[]) => void) => unknown;
  removeListener: (
    event: string,
    listener: (...args: any[]) => void
  ) => unknown;
};

export type AutoCancelBoundEntry = {
  autoCancelCleanup?: () => void;
};

export type AutoCancelLogger = {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
};

export function attachAutoCancelListeners(
  target: AutoCancelTarget,
  operationId: string,
  cancel: () => void,
  logger?: AutoCancelLogger
): () => void {
  const cancelOnce = () => {
    cancel();
  };
  const handleNavigation = (
    _e: unknown,
    _url: unknown,
    _isInPlace: unknown,
    _isMainFrame: unknown,
    _frameId: unknown,
    _parentFrameId: unknown,
    details: unknown
  ) => {
    if ((details as any)?.isReload) {
      logger?.info?.(
        `[registry] Cancelling due to reload for operation ${operationId}`
      );
      cancelOnce();
    }
  };

  target.once('destroyed', cancelOnce);
  target.once('render-process-gone', cancelOnce);
  target.once('will-navigate', cancelOnce);
  target.once('did-start-navigation', handleNavigation);

  return () => {
    target.removeListener('destroyed', cancelOnce);
    target.removeListener('render-process-gone', cancelOnce);
    target.removeListener('will-navigate', cancelOnce);
    target.removeListener('did-start-navigation', handleNavigation);
  };
}

export function clearAutoCancelListeners(
  entry: AutoCancelBoundEntry | undefined,
  logger?: AutoCancelLogger
): void {
  if (!entry?.autoCancelCleanup) return;
  try {
    entry.autoCancelCleanup();
  } catch (error) {
    logger?.warn?.('[registry] Failed to remove auto-cancel listeners:', error);
  } finally {
    entry.autoCancelCleanup = undefined;
  }
}

export function rebindAutoCancelListeners(
  entry: AutoCancelBoundEntry,
  target: AutoCancelTarget,
  operationId: string,
  cancel: () => void,
  logger?: AutoCancelLogger
): void {
  clearAutoCancelListeners(entry, logger);
  entry.autoCancelCleanup = attachAutoCancelListeners(
    target,
    operationId,
    cancel,
    logger
  );
}
