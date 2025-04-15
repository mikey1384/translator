import { execa } from 'execa';

// Define the type for the download process object using ReturnType
export type DownloadProcessType = ReturnType<typeof execa>;

// Map to store active yt-dlp download processes, keyed by operationId
// Use export to make it available for import in other modules
export const downloadProcesses = new Map<string, DownloadProcessType>();

// You can add other process maps here later if needed
// export const ffmpegProcesses = new Map<string, SomeOtherProcessType>();
