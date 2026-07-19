import * as UrlIPC from '../ipc/url.js';
import {
  MountedDownloadLeaseCoordinator,
  type ReleaseMountedDownloadLease,
} from './mounted-download-lease-coordinator.js';

const coordinator = new MountedDownloadLeaseCoordinator({
  reportPaths: async filePaths => {
    const result = await UrlIPC.setMountedUrlDownloadLibraryPaths({
      filePaths,
    });
    if (!result.success) {
      throw new Error(
        result.error || 'Mounted download leases could not be updated'
      );
    }
  },
  onBackgroundError: error => {
    console.warn('[download-history] Failed to report mounted media:', error);
  },
});

export function updateMountedUrlDownloadLibraryPaths(
  filePaths: string[]
): void {
  coordinator.updateMountedPaths(filePaths);
}

export function includeProvisionalUrlDownloadLibraryPaths(
  filePaths: string[]
): string[] {
  return coordinator.includeProvisionalPaths(filePaths);
}

export function acquireProvisionalUrlDownloadLibraryPath(
  filePath: string
): Promise<ReleaseMountedDownloadLease> {
  return coordinator.acquire(filePath);
}
