import * as FileIPC from '../../renderer/ipc/file.js';
import { open } from '@ipc/file';

export async function retryCall<Fn extends (...a: any[]) => Promise<any>>(
  fn: Fn,
  ...rest: Parameters<Fn>
): Promise<Awaited<ReturnType<Fn>>> {
  const args = [...rest];
  let opts: any = {};
  const lastArg = args[args.length - 1];

  if (lastArg && typeof lastArg === 'object' && 'maxRetries' in lastArg) {
    opts = args.pop();
  }

  const maxRetries = opts.maxRetries ?? 10;
  let delay = opts.initialDelay ?? 300;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(...args);
    } catch (err: any) {
      if (
        !err.message?.includes('No handler registered') ||
        attempt === maxRetries
      ) {
        throw err;
      }
      await new Promise(r => setTimeout(r, delay));
      delay *= 1.3 * (1 + Math.random() * 0.2); // Add ±10% jitter
    }
  }
  throw new Error('Failed to complete IPC call after maximum retries');
}

/**
 * Browser-based file download fallback when Electron IPC fails.
 * @param content - The content to download as a string or other BlobPart.
 * @param filename - The name of the file to download.
 * @returns The filename used for the download.
 * @throws Error if the browser download fails.
 */
function downloadFile(
  content: BlobPart | BlobPart[],
  filename: string
): string {
  try {
    const blob = new Blob(Array.isArray(content) ? content : [content], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener'; // Security enhancement
    document.body.appendChild(a);
    try {
      requestAnimationFrame(() => {
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      });
    } catch (domError) {
      throw new Error(
        `DOM interaction failed: ${
          domError instanceof Error ? domError.message : String(domError)
        }`
      );
    }
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
 * Saves a file with retry mechanism and fallback to browser download.
 * @param options - Configuration for saving the file.
 * @returns Promise resolving to an object with filePath or error message.
 */
export async function saveFileWithRetry(options: {
  content: string; // Keeping as string to match SaveFileOptions, will adjust if IPC supports BlobPart
  defaultPath?: string;
  filePath?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
  originalLoadPath?: string;
  targetPath?: string;
  forceDialog?: boolean;
}): Promise<{ filePath?: string; error?: string; fallbackError?: string }> {
  const storedTargetPath = localStorage.getItem('subsapp.targetPath');
  const storedOriginalLoadPath = localStorage.getItem(
    'subsapp.originalLoadPath'
  );
  const targetPath = options.forceDialog
    ? undefined
    : options.targetPath || storedTargetPath;
  const originalLoadPath = options.forceDialog
    ? undefined
    : options.originalLoadPath || storedOriginalLoadPath;
  const filePath = options.forceDialog ? undefined : options.filePath;

  if (options.forceDialog) {
    localStorage.removeItem('subsapp.targetPath');
  }

  try {
    const saveOptions = {
      ...options,
      targetPath,
      originalLoadPath,
      filePath,
      forceDialog: options.forceDialog,
    };

    const result = await retryCall(FileIPC.save, saveOptions);

    if (result?.filePath && !result.error) {
      localStorage.setItem('subsapp.targetPath', result.filePath);
      if (originalLoadPath) {
        localStorage.setItem('subsapp.originalLoadPath', originalLoadPath);
      }
    }

    return result;
  } catch (error: any) {
    try {
      const filename =
        options.defaultPath ||
        options.filePath?.split('/').pop() ||
        'download.srt';
      const downloadedFilename = downloadFile(options.content, filename);
      return {
        filePath: downloadedFilename,
        error: `Electron save failed, used browser download as fallback.`,
        fallbackError: error.message || String(error),
      };
    } catch (fallbackError: any) {
      return {
        error: `All save methods failed.`,
        fallbackError: `Main error: ${error.message || String(error)}. Fallback error: ${fallbackError.message || String(fallbackError)}`,
      };
    }
  }
}

export async function openFileWithRetry(options: {
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
  title?: string;
}): Promise<{
  filePaths: string[];
  fileContents?: string[] | ArrayBuffer[] | undefined;
  error?: string;
  canceled?: boolean;
}> {
  try {
    const result = await retryCall(FileIPC.open, options);
    return result;
  } catch (error: any) {
    return {
      filePaths: [],
      error: error.message || String(error),
    };
  }
}

export { open as openFile };
