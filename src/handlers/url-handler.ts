import { IpcMainInvokeEvent } from 'electron';
import { processVideoUrl, VideoQuality } from '../services/url-processor.js';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';

// Define interfaces for clarity and type safety
// interface UrlProgress { ... }

interface ProcessUrlOptions {
  url: string;
  language?: string; // Language is not used by processVideoUrl directly, kept for future?
  quality?: VideoQuality;
  operationId?: string;
}

interface ProcessUrlResult {
  success: boolean;
  message?: string;
  filePath?: string; // Map from videoPath
  videoId?: string; // Not provided by processVideoUrl
  title?: string; // Not provided by processVideoUrl
  duration?: number; // Not provided by processVideoUrl
  filename?: string; // Provided by processVideoUrl
  size?: number; // Provided by processVideoUrl
  fileUrl?: string; // Provided by processVideoUrl
  originalVideoPath?: string; // Provided by processVideoUrl
  error?: string;
  operationId: string;
}

export async function handleProcessUrl(
  event: IpcMainInvokeEvent,
  options: ProcessUrlOptions
): Promise<ProcessUrlResult> {
  const operationId = options.operationId || uuidv4();
  log.info(
    `[url-handler] Starting process for URL: ${options.url}, Operation ID: ${operationId}`
  );

  // Use the specific inline type matching the service's callback definition
  const sendProgress = (progressData: {
    percent: number;
    stage: string;
    error?: string | null;
  }) => {
    log.debug(`[url-handler][${operationId}] Sending progress:`, progressData); // Added debug log
    event.sender.send('url-processing-progress', {
      ...progressData,
      operationId,
    });
  };

  if (!options || typeof options.url !== 'string' || !options.url.trim()) {
    log.warn('[url-handler] Invalid URL received');
    // Use sendProgress to report error to UI
    sendProgress({ percent: 0, stage: 'Error', error: 'Invalid URL provided' });
    return { success: false, error: 'Invalid URL provided', operationId };
  }

  const url = options.url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    log.warn(`[url-handler] URL does not start with http/https: ${url}`);
    sendProgress({ percent: 0, stage: 'Error', error: 'Invalid URL format' });
    return { success: false, error: 'Invalid URL format', operationId };
  }

  try {
    sendProgress({ percent: 0, stage: 'Validating' });

    log.info(
      `[url-handler] Calling processVideoUrl for Operation ID: ${operationId}`
    );

    // Call processVideoUrl with correct arguments (url, quality, progressCallback)
    const result = await processVideoUrl(
      url,
      options.quality, // Pass quality (defaults to 'high' in service if undefined)
      // Add specific type annotation matching url-processor's ProgressCallback
      (progress: { percent: number; stage: string; error?: string | null }) =>
        sendProgress(progress)
    );

    log.info(
      `[url-handler] processVideoUrl completed successfully for Operation ID: ${operationId}`
    );

    // Map the successful result to ProcessUrlResult format
    const successResult: ProcessUrlResult = {
      success: true,
      filePath: result.videoPath, // Map videoPath to filePath
      filename: result.filename,
      size: result.size,
      fileUrl: result.fileUrl,
      originalVideoPath: result.originalVideoPath,
      // videoId, title, duration are not available from processVideoUrl
      operationId,
    };
    sendProgress({ percent: 100, stage: 'Completed' });
    return successResult;
  } catch (error: any) {
    // Restore the catch block
    log.error(
      `[url-handler] Error processing URL ${url} (Op ID: ${operationId}):`,
      error
    );
    const errorMessage = error.message || 'An unknown error occurred';
    // Use sendProgress to report error
    sendProgress({ percent: 100, stage: 'Error', error: errorMessage });
    return { success: false, error: errorMessage, operationId };
  } // Restore the closing brace for try
} // Restore the closing brace for the function
