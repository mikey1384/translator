type AutoCancelTarget = {
  on: (event: string, listener: (...args: any[]) => void) => unknown;
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
  let cancelled = false;
  const cancelOnce = () => {
    if (cancelled) return;
    cancelled = true;
    cancel();
  };
  const handleNavigation = (details: unknown) => {
    const navigation = details as {
      isMainFrame?: boolean;
      isSameDocument?: boolean;
    };
    if (navigation?.isMainFrame && !navigation.isSameDocument) {
      logger?.info?.(
        `[registry] Cancelling due to main-frame navigation for operation ${operationId}`
      );
      cancelOnce();
    }
  };

  target.once('destroyed', cancelOnce);
  target.once('render-process-gone', cancelOnce);
  target.once('will-navigate', cancelOnce);
  // Subframe and same-document events must not consume the listener before a
  // later reload or document replacement reaches this WebContents.
  target.on('did-start-navigation', handleNavigation);

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
