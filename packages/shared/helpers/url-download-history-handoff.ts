export type PromotedDownloadHistoryHandoffResult =
  | { status: 'committed' }
  | { status: 'stale'; rollbackError?: unknown; cleanupError?: unknown }
  | { status: 'failed'; error: unknown; cleanupError?: unknown };

/**
 * Commits renderer-visible ownership of a promoted URL download, then checks
 * whether the originating operation is still current. A failed commit means
 * the file has no history owner and must be reclaimed; a stale successful
 * commit is rolled back through history so normal mounted-path safeguards
 * still apply.
 */
export async function handoffPromotedDownloadHistory(options: {
  persistHistory: () => Promise<void>;
  isStale: () => boolean;
  rollbackHistory: () => Promise<void>;
  cleanupUnownedFile: () => Promise<void>;
}): Promise<PromotedDownloadHistoryHandoffResult> {
  try {
    await options.persistHistory();
  } catch (error) {
    let cleanupError: unknown;
    try {
      await options.cleanupUnownedFile();
    } catch (caughtCleanupError) {
      cleanupError = caughtCleanupError;
    }
    if (options.isStale()) return { status: 'stale', cleanupError };
    return { status: 'failed', error, cleanupError };
  }

  if (!options.isStale()) return { status: 'committed' };

  try {
    await options.rollbackHistory();
    return { status: 'stale' };
  } catch (rollbackError) {
    // Keep the successfully persisted history ownership when rollback fails;
    // deleting the file directly would leave that durable entry dangling.
    return { status: 'stale', rollbackError };
  }
}
