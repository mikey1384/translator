/**
 * Utility functions for reliable IPC communication with Electron main process
 */

/**
 * DIAGNOSTIC TOOL - Test save functionality directly
 */
export function testSaveFile(method: "direct" | "dialog" = "direct") {
  console.log(`🔍 DIAGNOSTIC: Starting ${method} save file test`);

  if (!window.electron?.saveFile) {
    console.error(
      "🔍 DIAGNOSTIC ERROR: window.electron.saveFile not available!",
      window.electron
    );
    return "ERROR: saveFile method not available";
  }

  // Create test options based on save method
  let saveOptions;
  if (method === "direct") {
    // Direct save with filePath
    const userDataPath = localStorage.getItem("userData") || "";
    const testPath = `${userDataPath}/temp/diagnostic-test-${Date.now()}.txt`;
    saveOptions = {
      content:
        "This is a direct save test file.\nCreated for diagnostic purposes.",
      filePath: testPath,
    };
    console.log("🔍 DIAGNOSTIC: Attempting direct save to:", testPath);
  } else {
    // Dialog save with just defaultPath
    saveOptions = {
      content:
        "This is a dialog save test file.\nCreated for diagnostic purposes.",
      defaultPath: "diagnostic-test.txt",
    };
    console.log("🔍 DIAGNOSTIC: Attempting save with dialog");
  }

  return window.electron
    .saveFile(saveOptions)
    .then((result) => {
      console.log(
        `🔍 DIAGNOSTIC SUCCESS: ${method} save completed with result:`,
        result
      );
      return `SUCCESS: ${JSON.stringify(result)}`;
    })
    .catch((error) => {
      console.error(`🔍 DIAGNOSTIC ERROR: ${method} save failed:`, error);
      return `ERROR: ${error.message || String(error)}`;
    });
}

// Make diagnostic function globally available
if (typeof window !== "undefined") {
  (window as any).testSaveFile = testSaveFile;
  (window as any).testDirectSave = () => testSaveFile("direct");
  (window as any).testDialogSave = () => testSaveFile("dialog");
  // Make it more visible for direct testing
  console.log("🔍 DIAGNOSTIC: Save test functions available as:");
  console.log("  - window.testSaveFile() - Default direct save test");
  console.log("  - window.testDirectSave() - Test direct save with filePath");
  console.log("  - window.testDialogSave() - Test save with dialog");
}

/**
 * Safely call Electron IPC with extended retries to handle "No handler registered" errors
 */
export async function retryElectronCall<T>(
  method: string,
  args: any,
  maxRetries = 10,
  initialDelay = 300
): Promise<T> {
  // Log if Electron API is available
  console.log(
    `LIFECYCLE: [${method}] Step 1 - Checking Electron API availability...`,
    {
      electronAvailable: Boolean(window.electron),
      hasSaveFile: Boolean(window.electron?.saveFile),
      hasOpenFile: Boolean(window.electron?.openFile),
    }
  );

  if (!window.electron) {
    console.error(
      "LIFECYCLE: [${method}] ERROR - Electron API not available at all!"
    );
    throw new Error("Electron API not available");
  }

  // Get the method from electron
  const electronMethod = (window.electron as any)[method];
  if (!electronMethod) {
    console.error(
      `LIFECYCLE: [${method}] ERROR - Method ${method} not available in Electron API!`
    );
    throw new Error(`Method ${method} not available in Electron API`);
  }

  console.log(
    `LIFECYCLE: [${method}] Step 2 - Electron API checks passed, proceeding with call`
  );

  try {
    // First attempt - log before invoking
    console.log(
      `LIFECYCLE: [${method}] Step 3 - Making initial call attempt...`
    );
    const result = await electronMethod(args);
    console.log(`LIFECYCLE: [${method}] Step 4 - Initial call SUCCEEDED!`);
    return result;
  } catch (error: any) {
    console.error(`LIFECYCLE: [${method}] ERROR - Initial call failed:`, error);

    // Only retry for "No handler registered" errors
    if (!error.message?.includes("No handler registered")) {
      console.error(
        `LIFECYCLE: [${method}] ERROR - Non-recoverable error, not retrying:`,
        error.message
      );
      throw error;
    }

    console.log(
      `LIFECYCLE: [${method}] Step 5 - Going to retry ${method} up to ${maxRetries} times due to "No handler registered" error`
    );

    // Retry with increasing delays
    let delay = initialDelay;
    for (let i = 0; i < maxRetries; i++) {
      console.log(
        `LIFECYCLE: [${method}] Step 5.${i + 1} - Retry ${
          i + 1
        }/${maxRetries} after ${delay}ms...`
      );

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        console.log(
          `LIFECYCLE: [${method}] Step 5.${i + 1}.1 - Executing retry ${
            i + 1
          }...`
        );
        const result = await electronMethod(args);
        console.log(
          `LIFECYCLE: [${method}] Step 6 - Retry ${i + 1} SUCCEEDED!`
        );
        return result;
      } catch (retryError: any) {
        console.error(
          `LIFECYCLE: [${method}] ERROR - Retry ${i + 1} failed:`,
          retryError
        );

        // If not a "No handler registered" error, rethrow
        if (!retryError.message?.includes("No handler registered")) {
          console.error(
            `LIFECYCLE: [${method}] ERROR - New non-recoverable error during retry ${
              i + 1
            }:`,
            retryError.message
          );
          throw retryError;
        }

        // Increase delay for next retry (more gradually)
        delay *= 1.3;
      }
    }

    // If we reach here, all retries failed
    console.error(
      `LIFECYCLE: [${method}] FATAL ERROR - All ${maxRetries} retries failed. Check if the main process has registered the handler.`
    );
    throw new Error(
      `Failed to call ${method} after ${maxRetries} retries. The main process may not be fully initialized or there's an issue with IPC communication.`
    );
  }
}

/**
 * Browser-based file download fallback when Electron IPC fails
 */
function downloadFile(content: string, filename: string): string {
  console.log("LIFECYCLE: [FALLBACK] Using browser download API as fallback");
  try {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    console.log(
      "LIFECYCLE: [FALLBACK] Browser download initiated successfully"
    );
    return filename;
  } catch (error) {
    console.error("LIFECYCLE: [FALLBACK] Browser download failed:", error);
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
}): Promise<{ filePath?: string; error?: string }> {
  // Get the original file paths if they exist and weren't passed in
  const storedTargetPath = localStorage.getItem("targetPath");
  const storedOriginalLoadPath = localStorage.getItem("originalLoadPath");

  // Use passed values or fall back to stored values
  const targetPath = options.targetPath || storedTargetPath;
  const originalLoadPath = options.originalLoadPath || storedOriginalLoadPath;

  // Log all path information for debugging
  console.log("💥 [PATH DEBUG] saveFileWithRetry called with all path info:", {
    options,
    targetPath,
    originalLoadPath,
    allLocalStorageKeys: Object.keys(localStorage).join(", "),
    pathRelatedStorage: Object.keys(localStorage)
      .filter((key) => key.includes("path"))
      .reduce((obj, key) => ({ ...obj, [key]: localStorage.getItem(key) }), {}),
  });

  console.log(
    "LIFECYCLE: [saveFile] Started saveFileWithRetry with all path info:",
    {
      hasContent: Boolean(options.content),
      contentLength: options.content?.length,
      defaultPath: options.defaultPath,
      filePath: options.filePath,
      targetPath,
      originalLoadPath,
      localStorage: Object.keys(localStorage)
        .filter((key) => key.includes("path"))
        .reduce(
          (obj, key) => ({ ...obj, [key]: localStorage.getItem(key) }),
          {}
        ),
    }
  );

  try {
    console.log(
      "LIFECYCLE: [saveFile] Calling retryElectronCall with 'saveFile' method"
    );

    // Pass all path information to the main process
    console.log("💥 [PATH DEBUG] Preparing options for main process:", {
      ...options,
      targetPath,
      originalLoadPath,
    });

    const saveOptions = {
      ...options,
      targetPath,
      originalLoadPath,
    };

    console.log(
      "💥 [PATH DEBUG] Final options being sent to main process:",
      saveOptions
    );

    const result = await retryElectronCall<{
      filePath?: string;
      error?: string;
    }>("saveFile", saveOptions);

    console.log("💥 [PATH DEBUG] Received result from main process:", result);

    console.log("LIFECYCLE: [saveFile] Successfully completed with result:", {
      hasFilePath: Boolean(result?.filePath),
      filePath: result?.filePath,
      hasError: Boolean(result?.error),
      error: result?.error,
    });

    // Update our path information if the save was successful
    if (result?.filePath && !result.error) {
      // Store the successful path for future use
      localStorage.setItem("targetPath", result.filePath);
      console.log(
        "LIFECYCLE: [saveFile] Updated targetPath for future saves:",
        result.filePath
      );
    }

    return result;
  } catch (error: any) {
    console.error(
      "LIFECYCLE: [saveFile] ERROR - Save operation failed:",
      error
    );

    // Try browser fallback if electron method failed
    try {
      console.log("LIFECYCLE: [saveFile] Attempting browser download fallback");
      const filename =
        options.defaultPath ||
        options.filePath?.split("/").pop() ||
        "download.srt";
      const downloadedFilename = downloadFile(options.content, filename);
      console.log(
        "LIFECYCLE: [saveFile] Browser fallback succeeded with filename:",
        downloadedFilename
      );
      return {
        filePath: downloadedFilename,
        error: `Electron save failed, used browser download as fallback: ${
          error.message || String(error)
        }`,
      };
    } catch (fallbackError: any) {
      console.error(
        "LIFECYCLE: [saveFile] CRITICAL: Both Electron and browser fallback failed:",
        fallbackError
      );
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
  console.log(
    "LIFECYCLE: [openFile] Started openFileWithRetry with options:",
    options
  );

  try {
    console.log(
      "LIFECYCLE: [openFile] Calling retryElectronCall with 'openFile' method"
    );
    const result = await retryElectronCall<{
      filePaths: string[];
      fileContents?: string[];
      error?: string;
      canceled?: boolean;
    }>("openFile", options);
    console.log("LIFECYCLE: [openFile] Successfully completed with result:", {
      filePathsCount: result?.filePaths?.length,
      fileContentsCount: result?.fileContents?.length,
      canceled: result?.canceled,
      error: result?.error,
    });
    return result;
  } catch (error: any) {
    console.error(
      "LIFECYCLE: [openFile] ERROR - Open operation failed:",
      error
    );
    return {
      filePaths: [],
      error: error.message || String(error),
    };
  }
}
