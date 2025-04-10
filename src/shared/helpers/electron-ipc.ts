export async function retryElectronCall<T>(
  method: string,
  args: any,
  maxRetries = 10,
  initialDelay = 300
): Promise<T> {
  if (!window.electron) {
    throw new Error('Electron API not available');
  }

  // Get the method from electron
  const electronMethod = (window.electron as any)[method];
  if (!electronMethod) {
    throw new Error(`Method ${method} not available in Electron API`);
  }

  try {
    // First attempt
    const result = await electronMethod(args);
    return result;
  } catch (error: any) {
    // Only retry for "No handler registered" errors
    if (!error.message?.includes('No handler registered')) {
      throw error;
    }

    // Retry with increasing delays
    let delay = initialDelay;
    for (let i = 0; i < maxRetries; i++) {
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));

      try {
        const result = await electronMethod(args);
        return result;
      } catch (retryError: any) {
        // If not a "No handler registered" error, rethrow
        if (!retryError.message?.includes('No handler registered')) {
          throw retryError;
        }

        // Increase delay for next retry (more gradually)
        delay *= 1.3;
      }
    }

    // If we reach here, all retries failed
    throw new Error(
      `Failed to call ${method} after ${maxRetries} retries. The main process may not be fully initialized or there's an issue with IPC communication.`
    );
  }
}

/**
 * Browser-based file download fallback when Electron IPC fails
 */
function downloadFile(content: string, filename: string): string {
  try {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    return filename;
  } catch (error) {
    throw new Error(
      `Browser download failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Save file with retry mechanism and fallback to browser download
 */
export async function saveFileWithRetry(options: {
  content: string;
  defaultPath?: string;
  filePath?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
  originalLoadPath?: string;
  targetPath?: string;
  forceDialog?: boolean;
}): Promise<{ filePath?: string; error?: string }> {
  // Get the original file paths if they exist and weren't passed in
  const storedTargetPath = localStorage.getItem('targetPath');
  const storedOriginalLoadPath = localStorage.getItem('originalLoadPath');

  // Use passed values or fall back to stored values, but respect forceDialog
  const targetPath = options.forceDialog
    ? undefined
    : options.targetPath || storedTargetPath;
  const originalLoadPath = options.forceDialog
    ? undefined
    : options.originalLoadPath || storedOriginalLoadPath;
  const filePath = options.forceDialog ? undefined : options.filePath;

  try {
    const saveOptions = {
      ...options,
      targetPath,
      originalLoadPath,
      filePath,
      forceDialog: options.forceDialog,
    };

    const result = await retryElectronCall<{
      filePath?: string;
      error?: string;
    }>('saveFile', saveOptions);

    // Update our path information if the save was successful
    if (result?.filePath && !result.error) {
      // Store the successful path for future use
      localStorage.setItem('targetPath', result.filePath);
    }

    return result;
  } catch (error: any) {
    // Try browser fallback if electron method failed
    try {
      const filename =
        options.defaultPath ||
        options.filePath?.split('/').pop() ||
        'download.srt';
      const downloadedFilename = downloadFile(options.content, filename);
      return {
        filePath: downloadedFilename,
        error: `Electron save failed, used browser download as fallback: ${
          error.message || String(error)
        }`,
      };
    } catch (fallbackError: any) {
      return {
        error: `All save methods failed. Main error: ${
          error.message || String(error)
        }. Fallback error: ${fallbackError.message || String(fallbackError)}`,
      };
    }
  }
}

/**
 * Open file with retry mechanism
 */
export async function openFileWithRetry(options: {
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
  title?: string;
}): Promise<{
  filePaths: string[];
  fileContents?: string[];
  error?: string;
  canceled?: boolean;
}> {
  try {
    const result = await retryElectronCall<{
      filePaths: string[];
      fileContents?: string[];
      error?: string;
      canceled?: boolean;
    }>('openFile', options);
    return result;
  } catch (error: any) {
    return {
      filePaths: [],
      error: error.message || String(error),
    };
  }
}

export function registerSubtitleStreamListeners(
  partialResultCallback: (result: {
    partialResult: string;
    percent: number;
    stage: string;
    current?: number;
    total?: number;
  }) => void,
  type: 'generate' | 'translate' = 'generate'
): () => void {
  // This variable will hold the function so we can remove it later
  let listener: ((event: any, progress: any) => void) | null = null;

  if (window.electron) {
    // Handler for progress events
    listener = (_: any, progress: any) => {
      // Always provide default values to avoid undefined properties
      const safeProgress = {
        partialResult: progress?.partialResult || '',
        percent: progress?.percent || 0,
        stage:
          progress?.stage ||
          (type === 'generate' ? 'Processing' : 'Translating'),
        current: progress?.current || 0,
        total: progress?.total || 0,
      };

      partialResultCallback(safeProgress);
    };

    if (type === 'generate') {
      window.electron.onGenerateSubtitlesProgress(listener);
    } else {
      window.electron.onTranslateSubtitlesProgress(listener);
    }
  }

  return () => {
    if (window.electron && listener) {
      if (type === 'generate') {
        window.electron.onGenerateSubtitlesProgress(null);
      } else {
        window.electron.onTranslateSubtitlesProgress(null);
      }
    }
  };
}
