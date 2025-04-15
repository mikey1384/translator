import { execa } from 'execa';
import log from 'electron-log'; // Import log

// Define the type for the download process object using ReturnType
export type DownloadProcessType = ReturnType<typeof execa>;

// Map to store active yt-dlp download processes, keyed by operationId
const downloadProcesses = new Map<string, DownloadProcessType>();

// Export functions to manage the map, adding logging
export function addDownloadProcess(id: string, process: DownloadProcessType) {
  log.info(`[active-processes] Setting process for ID: ${id}`);
  downloadProcesses.set(id, process);
}

export function getDownloadProcess(
  id: string
): DownloadProcessType | undefined {
  const found = downloadProcesses.has(id);
  log.info(`[active-processes] Getting process for ID: ${id}. Found: ${found}`);
  return downloadProcesses.get(id);
}

export function hasDownloadProcess(id: string): boolean {
  const found = downloadProcesses.has(id);
  log.info(
    `[active-processes] Checking process for ID: ${id}. Found: ${found}`
  );
  return found;
}

export function removeDownloadProcess(id: string): boolean {
  const existed = downloadProcesses.has(id);
  const deleted = downloadProcesses.delete(id);
  log.info(
    `[active-processes] Deleting process for ID: ${id}. Existed: ${existed}, Deleted: ${deleted}`
  );
  return deleted;
}

// You can add other process maps here later if needed
// export const ffmpegProcesses = new Map<string, SomeOtherProcessType>();
