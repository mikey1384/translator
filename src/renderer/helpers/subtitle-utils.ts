import { SrtSegment } from "../App";

/**
 * Parse SRT content to an array of segments
 */
export function parseSrt(srtString: string): SrtSegment[] {
  if (!srtString) return [];

  const segments: SrtSegment[] = [];
  const blocks = srtString.trim().split(/\r?\n\r?\n/);

  blocks.forEach((block) => {
    const lines = block.split(/\r?\n/);
    if (lines.length < 3) return;

    // Parse index (first line)
    const index = parseInt(lines[0].trim(), 10);

    // Parse timestamp (second line)
    const timeMatch = lines[1].match(
      /(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/
    );
    if (!timeMatch) return;

    const startTime = srtTimeToSeconds(timeMatch[1]);
    const endTime = srtTimeToSeconds(timeMatch[2]);

    // Get subtitle text (remaining lines)
    const text = lines.slice(2).join("\n");

    segments.push({
      index,
      start: startTime,
      end: endTime,
      text,
    });
  });

  // Validate and fix any timing issues
  return validateSubtitleTimings(segments);
}

/**
 * Validates subtitle timings and fixes any issues
 * This ensures that:
 * 1. No subtitle has end time before start time
 * 2. No subtitle has negative start time
 * 3. Subtitles don't overlap (if fixOverlaps is true)
 */
export function validateSubtitleTimings(
  subtitles: SrtSegment[],
  fixOverlaps: boolean = true
): SrtSegment[] {
  if (!subtitles || subtitles.length === 0) return [];

  // First pass: fix basic timing issues (negative times, end before start)
  const fixedSubtitles = subtitles.map((subtitle) => {
    // Create a new object to avoid mutating the original
    const fixed = { ...subtitle };

    // Fix negative start time
    if (fixed.start < 0) {
      fixed.start = 0;
    }

    // Fix end time before or equal to start time
    if (fixed.end <= fixed.start) {
      // Make the subtitle last at least 0.5 seconds
      fixed.end = fixed.start + 0.5;
    }

    return fixed;
  });

  // Second pass: fix overlaps if requested
  if (fixOverlaps) {
    // Sort by start time
    fixedSubtitles.sort((a, b) => a.start - b.start);

    for (let i = 0; i < fixedSubtitles.length - 1; i++) {
      const current = fixedSubtitles[i];
      const next = fixedSubtitles[i + 1];

      // Check for overlap
      if (current.end > next.start) {
        // Find a middle point
        const midPoint = (current.end + next.start) / 2;

        // Adjust times - ensure minimum duration of 0.5s
        const newCurrentEnd = Math.min(midPoint, next.start - 0.1);
        const minCurrentEnd = current.start + 0.5;

        if (newCurrentEnd >= minCurrentEnd) {
          current.end = newCurrentEnd;
        } else {
          // If we can't maintain minimum duration, adjust the next subtitle instead
          next.start = current.start + 0.5;
          current.end = current.start + 0.4;
        }
      }
    }

    // Re-index based on start time
    fixedSubtitles.forEach((subtitle, index) => {
      subtitle.index = index + 1;
    });
  }

  return fixedSubtitles;
}

/**
 * Build SRT content from segments
 */
export function buildSrt(segments: SrtSegment[]): string {
  if (segments.length === 0) return "";

  return segments
    .map((segment, i) => {
      const index = segment.index || i + 1;
      const startTime = secondsToSrtTime(segment.start);
      const endTime = secondsToSrtTime(segment.end);
      return `${index}\n${startTime} --> ${endTime}\n${segment.text}`;
    })
    .join("\n\n");
}

/**
 * Convert SRT time format (00:00:00,000) to seconds
 */
export function srtTimeToSeconds(timeString: string): number {
  const parts = timeString.split(",");
  const timeParts = parts[0].split(":");

  const hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  const seconds = parseInt(timeParts[2], 10);
  const milliseconds = parseInt(parts[1], 10);

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

/**
 * Convert seconds to SRT time format (00:00:00,000)
 */
export function secondsToSrtTime(totalSeconds: number): string {
  if (isNaN(totalSeconds)) return "00:00:00,000";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds - hours * 3600) / 60);
  const seconds = Math.floor(totalSeconds - hours * 3600 - minutes * 60);
  const milliseconds = Math.round(
    (totalSeconds - Math.floor(totalSeconds)) * 1000
  );

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(
    3,
    "0"
  )}`;
}

/**
 * Adjust SRT time by a specified offset (in seconds)
 */
export function adjustTimeString(
  timeString: string,
  offsetSeconds: number
): string {
  if (!timeString) return "00:00:00,000";

  const seconds = srtTimeToSeconds(timeString);
  const adjustedSeconds = Math.max(0, seconds + offsetSeconds);
  return secondsToSrtTime(adjustedSeconds);
}

/**
 * Check if two time ranges overlap
 */
export function doTimeRangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return Math.max(startA, startB) < Math.min(endA, endB);
}

/**
 * Format a time for display (compact format)
 */
export function formatTimeForDisplay(seconds: number): string {
  if (isNaN(seconds)) return "00:00";

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Check for and fix overlapping segments
 */
export function fixOverlappingSegments(segments: SrtSegment[]): SrtSegment[] {
  if (!segments || segments.length <= 1) return segments;

  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sortedSegments.length - 1; i++) {
    const current = sortedSegments[i];
    const next = sortedSegments[i + 1];

    if (current.end > next.start) {
      // Adjust the current segment's end time to match the next segment's start time
      // with a small buffer
      current.end = Math.max(current.start + 0.1, next.start - 0.05);
    }
  }

  return sortedSegments;
}

/**
 * Load SRT file content using Electron's native file dialog if available,
 * or fall back to traditional browser file input.
 * This combines the functionality of loading SRT files across the application.
 */
export async function loadSrtFile(
  file?: File,
  onContentLoaded?: (
    content: string,
    segments: SrtSegment[],
    filePath?: string
  ) => void,
  onError?: (error: string) => void
): Promise<{
  content?: string;
  segments?: SrtSegment[];
  filePath?: string;
  error?: string;
}> {
  console.log(
    "💥 [PATH DEBUG] loadSrtFile called with file:",
    file ? file.name : "no file"
  );
  console.log(
    "💥 [PATH DEBUG] localStorage at start:",
    Object.keys(localStorage)
      .filter((key) => key.includes("path"))
      .reduce((obj, key) => ({ ...obj, [key]: localStorage.getItem(key) }), {})
  );

  try {
    // Try to use Electron's open file dialog if no file is provided
    if (!file && window.electron?.openFile) {
      try {
        console.log("💥 [PATH DEBUG] Using Electron's open file dialog");
        const result = await window.electron.openFile({
          title: "Open SRT File",
          filters: [{ name: "SRT Files", extensions: ["srt"] }],
        });

        // Log result for debugging
        console.log("💥 [PATH DEBUG] Electron openFile result:", {
          hasResult: Boolean(result),
          resultKeys: result ? Object.keys(result) : [],
          filePaths: result?.filePaths,
          fileContentsExist: Boolean(result?.fileContents),
          fileContentsLength: result?.fileContents?.length,
          error: result?.error,
          canceled: result?.canceled,
        });

        // Handle cancellation
        if (result.canceled) {
          console.log("File dialog was canceled");
          return { error: "Operation canceled" };
        }

        // Handle errors
        if (result.error) {
          console.error("Error in openFile:", result.error);
          if (onError) onError(result.error);
          return { error: result.error };
        }

        // Make sure we have path and content
        if (!result.filePaths || !result.filePaths.length) {
          console.error("No file path returned");
          if (onError) onError("No file was selected");
          return { error: "No file was selected" };
        }

        if (!result.fileContents || !result.fileContents.length) {
          console.error("No file content returned");
          if (onError) onError("Could not read file content");
          return { error: "Could not read file content" };
        }

        // Get file path and content
        const filePath = result.filePaths[0];
        const content = result.fileContents[0];
        console.log(
          `SRT loaded from ${filePath}, content length: ${content.length}`
        );

        // Store the actual file path in localStorage for saving back to the same location
        localStorage.setItem("targetPath", filePath);
        console.log(
          "💥 [PATH DEBUG] Stored REAL file path in targetPath:",
          filePath
        );
        localStorage.setItem("originalLoadPath", filePath);
        console.log(
          "💥 [PATH DEBUG] Stored REAL file path in originalLoadPath:",
          filePath
        );

        // Parse content
        const segments = parseSrt(content);
        console.log(`Parsed ${segments.length} segments`);

        // Call callback if provided
        if (onContentLoaded) {
          onContentLoaded(content, segments, filePath);
        }

        return {
          content,
          segments,
          filePath,
        };
      } catch (error) {
        console.error("Error using Electron's file dialog:", error);
        // Fall through to browser file input if there's an error
      }
    }

    // Traditional browser file input handling if a file is provided
    if (file) {
      console.log(
        "💥 [PATH DEBUG] Using browser file input with file:",
        file.name
      );
      console.log(
        "💥 [PATH DEBUG] File object has these properties:",
        Object.keys(file)
      );
      console.log(
        "💥 [PATH DEBUG] File object prototype chain:",
        Object.getPrototypeOf(file)
      );

      // Check if we have a real path (Electron can provide this)
      console.log("💥 [PATH DEBUG] Checking if file has a real path property");
      for (const key in file) {
        if (key.includes("path")) {
          console.log(
            `💥 [PATH DEBUG] Found path-like property: ${key} = ${
              (file as any)[key]
            }`
          );
        }
      }

      const realPath = (file as any).path;
      if (realPath) {
        console.log("💥 [PATH DEBUG] Found real file path:", realPath);
        localStorage.setItem("targetPath", realPath);
        console.log(
          "💥 [PATH DEBUG] Stored file's real path in targetPath:",
          realPath
        );
        localStorage.setItem("originalLoadPath", realPath);
        console.log(
          "💥 [PATH DEBUG] Stored file's real path in originalLoadPath:",
          realPath
        );
      } else {
        console.log(
          "💥 [PATH DEBUG] File has NO real path - this is a browser file input"
        );
      }

      // For browser files, we need to create a synthetic path for direct saving later
      // On desktop app, we create a path in the app's data directory
      // This isn't a real file path that can be used directly, but it helps with app flow
      const fakePath = `/temp/${file.name}`;
      console.log("Creating synthetic path for browser file:", fakePath);

      // Immediately store in localStorage to ensure cross-component accessibility
      localStorage.setItem("originalSrtPath", fakePath);
      console.log(
        "subtitle-utils: Storing originalSrtPath in localStorage:",
        fakePath
      );

      return new Promise((resolve) => {
        const reader = new FileReader();

        reader.onload = function (e) {
          try {
            // Get content
            const content = e.target?.result as string;
            if (!content) {
              console.error("No content from FileReader");
              if (onError) onError("Could not read file content");
              resolve({ error: "Could not read file content" });
              return;
            }

            console.log(`SRT file read, content length: ${content.length}`);

            // Parse content
            const segments = parseSrt(content);
            console.log(`Parsed ${segments.length} segments`);

            // Call callback if provided - now always pass a path
            if (onContentLoaded) {
              onContentLoaded(content, segments, fakePath);
            }

            resolve({
              content,
              segments,
              filePath: fakePath,
            });
          } catch (parseError) {
            console.error("Error parsing SRT:", parseError);
            if (onError) onError("Invalid SRT file");
            resolve({ error: "Invalid SRT file" });
          }
        };

        reader.onerror = function () {
          console.error("Error reading file");
          if (onError) onError("Error reading SRT file");
          resolve({ error: "Error reading SRT file" });
        };

        reader.readAsText(file);
      });
    }

    console.error("No file provided and Electron API not available");
    if (onError) onError("No file was provided");
    return { error: "No file was provided" };
  } catch (error) {
    console.error("Unexpected error in loadSrtFile:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (onError) onError(errorMessage);
    return { error: errorMessage };
  }
}

/**
 * Safely call Electron IPC with retries to handle "No handler registered" errors
 */
export async function retryElectronCall<T>(
  method: string,
  args: any,
  maxRetries = 5,
  initialDelay = 300
): Promise<T> {
  if (!window.electron) {
    throw new Error("Electron API not available");
  }

  // Get the method from electron
  const electronMethod = (window.electron as any)[method];
  if (!electronMethod) {
    throw new Error(`Method ${method} not available in Electron API`);
  }

  try {
    // First attempt
    return await electronMethod(args);
  } catch (error: any) {
    console.error(`Error in ${method}:`, error);

    // Only retry for "No handler registered" errors
    if (!error.message?.includes("No handler registered")) {
      throw error;
    }

    // Retry with increasing delays
    let delay = initialDelay;
    for (let i = 0; i < maxRetries; i++) {
      console.log(
        `Retry ${i + 1}/${maxRetries} for ${method} after ${delay}ms...`
      );

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        return await electronMethod(args);
      } catch (retryError: any) {
        console.error(`Retry ${i + 1} failed:`, retryError);

        // If not a "No handler registered" error, rethrow
        if (!retryError.message?.includes("No handler registered")) {
          throw retryError;
        }

        // Increase delay for next retry
        delay *= 1.5;
      }
    }

    // If we reach here, all retries failed
    throw new Error(`Failed to call ${method} after ${maxRetries} retries`);
  }
}

/**
 * Opens a subtitle file using Electron's native file dialog
 * This is a centralized helper to be used by all components
 */
export async function openSubtitleWithElectron(
  onSuccess?: (
    file: File,
    content: string,
    segments: SrtSegment[],
    filePath: string
  ) => void,
  onError?: (error: string) => void
): Promise<{
  file?: File;
  content?: string;
  segments?: SrtSegment[];
  filePath?: string;
  error?: string;
}> {
  console.log(
    "🚨 CENTRAL HELPER: Using Electron's native file dialog to open SRT file"
  );

  try {
    // Use Electron's native file dialog
    const result = await window.electron.openFile({
      filters: [{ name: "Subtitle Files", extensions: ["srt"] }],
      title: "Open Subtitle File",
    });

    if (
      result.canceled ||
      !result.filePaths?.length ||
      !result.fileContents?.length
    ) {
      console.log(
        "🚨 CENTRAL HELPER: File dialog was canceled or no file selected"
      );
      return { error: "File selection was canceled" };
    }

    // Get the real file path and content
    const filePath = result.filePaths[0];
    const content = result.fileContents[0];

    console.log(
      "🚨 CENTRAL HELPER: SRT file selected with REAL PATH:",
      filePath
    );

    // Create a File object from the content for compatibility
    const filename = filePath.split("/").pop() || "subtitles.srt";
    const file = new File([content], filename, {
      type: "text/plain",
    });

    // Store the real filename and path in localStorage AND global state variables
    localStorage.setItem("loadedSrtFileName", filename);
    localStorage.setItem("originalSrtPath", filePath);
    localStorage.setItem("originalLoadPath", filePath); // Add this key too
    console.log("🚨 CENTRAL HELPER: Stored paths in localStorage:", {
      loadedSrtFileName: filename,
      originalSrtPath: filePath,
      originalLoadPath: filePath,
    });

    // Parse the SRT content
    const segments = parseSrt(content);
    console.log(
      `🚨 CENTRAL HELPER: SRT file loaded with ${segments.length} segments`
    );

    // Call success callback if provided
    if (onSuccess) {
      console.log(
        "🚨 CENTRAL HELPER: Calling onSuccess callback with file, content, segments, and filePath"
      );
      onSuccess(file, content, segments, filePath);
    }

    return {
      file,
      content,
      segments,
      filePath,
    };
  } catch (error) {
    console.error(
      "🚨 CENTRAL HELPER: Error opening file with Electron dialog:",
      error
    );

    if (onError) {
      onError(String(error));
    }

    return { error: String(error) };
  }
}
