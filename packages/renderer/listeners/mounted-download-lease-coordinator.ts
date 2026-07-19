import { sanitizeVideoSuggestionHistoryPath } from '../../shared/helpers/video-suggestion-sanitize.js';

type MountedDownloadLeaseCoordinatorOptions = {
  reportPaths: (filePaths: string[]) => Promise<void>;
  onBackgroundError?: (error: unknown) => void;
};

export type ReleaseMountedDownloadLease = () => Promise<void>;

function normalizePaths(filePaths: unknown[]): string[] {
  return Array.from(
    new Set(
      filePaths
        .map(value => sanitizeVideoSuggestionHistoryPath(value))
        .filter(Boolean)
    )
  ).sort();
}

export class MountedDownloadLeaseCoordinator {
  private readonly reportPaths: (filePaths: string[]) => Promise<void>;
  private readonly onBackgroundError?: (error: unknown) => void;
  private mountedPaths: string[] = [];
  private provisionalPaths = new Map<number, string>();
  private nextLeaseId = 1;
  private lastReportedKey = '';
  private reportQueue: Promise<void> = Promise.resolve();

  constructor(options: MountedDownloadLeaseCoordinatorOptions) {
    this.reportPaths = options.reportPaths;
    this.onBackgroundError = options.onBackgroundError;
  }

  updateMountedPaths(filePaths: string[]): void {
    this.mountedPaths = normalizePaths(
      Array.isArray(filePaths) ? filePaths : []
    );
    this.reportInBackground();
  }

  includeProvisionalPaths(filePaths: string[]): string[] {
    return normalizePaths([
      ...(Array.isArray(filePaths) ? filePaths : []),
      ...this.provisionalPaths.values(),
    ]);
  }

  async acquire(filePathValue: string): Promise<ReleaseMountedDownloadLease> {
    const filePath = sanitizeVideoSuggestionHistoryPath(filePathValue);
    if (!filePath) throw new Error('A download path is required for leasing.');

    const leaseId = this.nextLeaseId;
    this.nextLeaseId += 1;
    this.provisionalPaths.set(leaseId, filePath);
    try {
      // Opening must not begin until the main process has acknowledged this
      // path. Otherwise another renderer can end history ownership and unlink
      // the file during asynchronous identity/metadata work.
      await this.enqueueReport();
    } catch (error) {
      this.provisionalPaths.delete(leaseId);
      this.reportInBackground();
      throw error;
    }

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      this.provisionalPaths.delete(leaseId);
      await this.enqueueReport();
    };
  }

  private collectPaths(): string[] {
    return this.includeProvisionalPaths(this.mountedPaths);
  }

  private enqueueReport(): Promise<void> {
    const report = async () => {
      // Resolve paths when this queued report starts, not when it is queued.
      // This coalesces rapid store/provisional changes and prevents an older
      // async IPC response from overwriting a newer lease set.
      const filePaths = this.collectPaths();
      const key = JSON.stringify(filePaths);
      if (key === this.lastReportedKey) return;
      await this.reportPaths(filePaths);
      this.lastReportedKey = key;
    };
    const result = this.reportQueue.then(report, report);
    this.reportQueue = result.catch(() => undefined);
    return result;
  }

  private reportInBackground(): void {
    void this.enqueueReport().catch(error => {
      this.onBackgroundError?.(error);
    });
  }
}
