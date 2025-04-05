import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { youtubeDl } from 'youtube-dl-exec';
import log from 'electron-log';
import { FFmpegService } from './ffmpeg-service.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

// Promisify execFile for async/await usage
const execFileAsync = promisify(execFile);

// Define quality type and mapping
export type VideoQuality = 'low' | 'mid' | 'high';
const qualityFormatMap: Record<VideoQuality, string> = {
  high: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
  mid: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]',
  low: 'best[height<=480]',
};

interface ProgressCallback {
  (progress: { percent: number; stage: string; error?: string | null }): void;
}

// Function to update yt-dlp binary to the latest version
export async function updateYtDlp(): Promise<boolean> {
  try {
    log.info('[URLProcessor] Attempting to update yt-dlp to latest version...');

    // ESM-compatible way to find the module path
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));

    // Try to locate the yt-dlp binary
    const possibleBinPaths = [
      // In node_modules (for development)
      path.join(
        moduleDir,
        '..',
        '..',
        'node_modules',
        'youtube-dl-exec',
        'bin',
        'yt-dlp'
      ),
      // In electron resources (for packaged app)
      path.join(moduleDir, '..', '..', 'bin', 'yt-dlp'),
    ];

    let binPath = '';

    // Find the first path that exists
    for (const testPath of possibleBinPaths) {
      log.info(`[URLProcessor] Testing yt-dlp binary path: ${testPath}`);
      if (fs.existsSync(testPath)) {
        binPath = testPath;
        break;
      }
    }

    if (!binPath) {
      log.error(
        '[URLProcessor] yt-dlp binary not found in any expected location'
      );
      return false;
    }

    log.info('[URLProcessor] Found yt-dlp binary at:', binPath);

    // Run the self-update command
    const { stdout, stderr } = await execFileAsync(binPath, ['--update']);

    log.info('[URLProcessor] yt-dlp update stdout:', stdout);

    if (stderr) {
      log.warn('[URLProcessor] yt-dlp update stderr:', stderr);
    }

    if (stdout.includes('up to date') || stdout.includes('updated')) {
      log.info('[URLProcessor] yt-dlp update successful');
      return true;
    } else {
      log.warn('[URLProcessor] yt-dlp update did not report success:', stdout);
      return false;
    }
  } catch (error) {
    log.error('[URLProcessor] Failed to update yt-dlp:', error);
    return false;
  }
}

// Enhanced download function with fallback mechanisms and better error handling
async function downloadVideoFromPlatform(
  url: string,
  outputDir: string,
  quality: VideoQuality = 'high',
  progressCallback?: ProgressCallback
): Promise<{ filepath: string; info: any }> {
  progressCallback?.({
    percent: 25,
    stage: 'Preparing video download...',
  });
  log.info(`[URLProcessor] Starting download for URL: ${url}`);
  log.info(`[URLProcessor] Output directory: ${outputDir}`);
  log.info(`[URLProcessor] Requested quality: ${quality}`);

  // Ensure output directory exists
  try {
    await fsp.mkdir(outputDir, { recursive: true });
    log.info(`[URLProcessor] Ensured output directory exists: ${outputDir}`);
  } catch (error) {
    log.error(
      `[URLProcessor] Failed to create output directory: ${outputDir}`,
      error
    );
    throw new Error(
      `Failed to create output directory: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Check if directory is writable
  try {
    const testFile = path.join(outputDir, `test_${Date.now()}.tmp`);
    await fsp.writeFile(testFile, 'test');
    await fsp.unlink(testFile);
    log.info(
      `[URLProcessor] Verified output directory is writable: ${outputDir}`
    );
  } catch (error) {
    log.error(
      `[URLProcessor] Output directory is not writable: ${outputDir}`,
      error
    );
    throw new Error(
      `Output directory is not writable: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const formatString = qualityFormatMap[quality] || qualityFormatMap.high;

  // Use a temporary unique filename pattern for yt-dlp
  const tempFilenamePattern = path.join(
    outputDir,
    `download_${Date.now()}_%(id)s.%(ext)s`
  );
  log.info(
    `[URLProcessor] Using temporary filename pattern: ${tempFilenamePattern}`
  );

  try {
    progressCallback?.({
      percent: 30,
      stage: 'Initiating download...',
    });

    // Try the standard options first
    const standardOptions: any = {
      output: tempFilenamePattern,
      format: formatString,
      noCheckCertificates: true,
      noWarnings: true,
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      ],
      printJson: true,
      progress: true, // Enable progress reporting from yt-dlp
    };

    log.info('[URLProcessor] Calling youtube-dl-exec with standard options');

    try {
      // Set up a timer to provide artificial progress updates during download
      let currentProgress = 30;
      const progressInterval = setInterval(() => {
        currentProgress += 5;
        if (currentProgress < 90) {
          progressCallback?.({
            percent: currentProgress,
            stage: 'Downloading video...',
          });
        }
      }, 1000); // Update every second

      // First attempt with standard options
      const outputJson = await youtubeDl(url, standardOptions);

      // Clear the progress interval
      clearInterval(progressInterval);

      log.info('[URLProcessor] youtube-dl-exec call finished successfully.');

      if (!outputJson) {
        throw new Error('youtube-dl-exec did not return any output.');
      }

      // Process the successful result
      const downloadInfo =
        typeof outputJson === 'string' ? JSON.parse(outputJson) : outputJson;

      if (!downloadInfo || typeof downloadInfo !== 'object') {
        throw new Error('Failed to parse JSON output from youtube-dl-exec');
      }

      const finalFilepath = downloadInfo._filename;

      if (!finalFilepath || typeof finalFilepath !== 'string') {
        log.error(
          '[URLProcessor] Critical: JSON output missing _filename property.',
          downloadInfo
        );
        throw new Error(
          'Downloaded video information is incomplete (missing _filename in JSON).'
        );
      }

      // Verify the file exists at the path specified in JSON
      log.info(
        `[URLProcessor] Verifying existence of final file: ${finalFilepath}`
      );
      if (!fs.existsSync(finalFilepath)) {
        log.error(
          `[URLProcessor] Critical: File specified in JSON does not exist: ${finalFilepath}`
        );
        log.error(
          `[URLProcessor] Listing contents of output directory (${outputDir}):`
        );
        try {
          const files = await fsp.readdir(outputDir);
          log.error(`[URLProcessor] Files found: ${files.join(', ')}`);
        } catch (readErr) {
          log.error(
            `[URLProcessor] Failed to list output directory: ${readErr}`
          );
        }
        throw new Error(
          `Downloaded video file not found at expected path: ${finalFilepath}`
        );
      }

      const stats = await fsp.stat(finalFilepath);
      if (stats.size === 0) {
        log.error(
          `[URLProcessor] Critical: Downloaded file is empty: ${finalFilepath}`
        );
        throw new Error(`Downloaded video file is empty: ${finalFilepath}`);
      }

      log.info(
        `[URLProcessor] Download successful. File path: ${finalFilepath}`
      );
      progressCallback?.({
        percent: 90,
        stage: 'Download complete, verifying...',
      });

      return { filepath: finalFilepath, info: downloadInfo };
    } catch (standardError) {
      // Log the standard approach error
      log.warn(
        '[URLProcessor] Standard download approach failed:',
        standardError
      );
      log.info('[URLProcessor] Trying fallback download approach...');

      progressCallback?.({
        percent: 40,
        stage: 'First download attempt failed, trying alternative method...',
      });

      // If standard approach fails, try with simplified options
      const fallbackOptions: any = {
        output: tempFilenamePattern,
        format: 'best', // Simplified format string
        noWarnings: true,
        noCheckCertificates: true,
        printJson: true,
      };

      log.info('[URLProcessor] Calling youtube-dl-exec with fallback options');

      // Execute with fallback options
      const fallbackOutputJson = await youtubeDl(url, fallbackOptions);

      if (!fallbackOutputJson) {
        throw new Error('Fallback download attempt did not return any output.');
      }

      // Process the fallback result
      const fallbackDownloadInfo =
        typeof fallbackOutputJson === 'string'
          ? JSON.parse(fallbackOutputJson)
          : fallbackOutputJson;

      if (!fallbackDownloadInfo || typeof fallbackDownloadInfo !== 'object') {
        throw new Error(
          'Failed to parse JSON output from fallback download attempt'
        );
      }

      const fallbackFilepath = fallbackDownloadInfo._filename;

      if (!fallbackFilepath || typeof fallbackFilepath !== 'string') {
        log.error(
          '[URLProcessor] Critical: Fallback JSON output missing _filename property.',
          fallbackDownloadInfo
        );
        throw new Error(
          'Fallback download information is incomplete (missing _filename in JSON).'
        );
      }

      // Verify the fallback file exists
      log.info(
        `[URLProcessor] Verifying existence of fallback file: ${fallbackFilepath}`
      );
      if (!fs.existsSync(fallbackFilepath)) {
        log.error(
          `[URLProcessor] Critical: Fallback file specified in JSON does not exist: ${fallbackFilepath}`
        );
        throw new Error(
          `Fallback downloaded video file not found at expected path: ${fallbackFilepath}`
        );
      }

      const fallbackStats = await fsp.stat(fallbackFilepath);
      if (fallbackStats.size === 0) {
        log.error(
          `[URLProcessor] Critical: Fallback downloaded file is empty: ${fallbackFilepath}`
        );
        throw new Error(
          `Fallback downloaded video file is empty: ${fallbackFilepath}`
        );
      }

      log.info(
        `[URLProcessor] Fallback download successful. File path: ${fallbackFilepath}`
      );
      progressCallback?.({
        percent: 90,
        stage: 'Alternative download complete, verifying...',
      });

      return { filepath: fallbackFilepath, info: fallbackDownloadInfo };
    }
  } catch (error: any) {
    // Capture detailed error information
    log.error('[URLProcessor] Error during downloadVideoFromPlatform:', error);

    // Log additional details if it's a ChildProcessError from youtube-dl-exec
    if (error.stderr) {
      log.error('[URLProcessor] youtube-dl-exec stderr:', error.stderr);
    }
    if (error.stdout) {
      log.error('[URLProcessor] youtube-dl-exec stdout:', error.stdout);
    }
    if (error.command) {
      log.error('[URLProcessor] youtube-dl-exec command:', error.command);
    }

    progressCallback?.({
      percent: 0, // Reset progress on error
      stage: 'Download failed',
      error: error.message || String(error),
    });

    // Check for common error patterns and provide more helpful messages
    let errorMessage = error.message || String(error);

    if (
      errorMessage.includes('HTTP Error 403') ||
      errorMessage.includes('Forbidden')
    ) {
      errorMessage =
        'Access to this video is forbidden. It might be private or region-restricted.';
    } else if (
      errorMessage.includes('HTTP Error 404') ||
      errorMessage.includes('Not Found')
    ) {
      errorMessage =
        'Video not found. The URL might be incorrect or the video has been removed.';
    } else if (errorMessage.includes('Unable to download JSON metadata')) {
      errorMessage =
        'Unable to retrieve video metadata. The video might be private or the platform might be blocking access.';
    } else if (
      errorMessage.includes('ffmpeg') ||
      errorMessage.includes('postprocessor')
    ) {
      errorMessage =
        'Error processing video. This might be due to an unsupported format or corrupted download.';
    }

    // Rethrow the error to be caught by the caller
    throw new Error(`Video download failed: ${errorMessage}`);
  }
}

export async function processVideoUrl(
  url: string,
  quality: VideoQuality = 'high',
  progressCallback?: ProgressCallback
): Promise<{
  videoPath: string; // This will be the final, confirmed path
  filename: string; // Base filename
  size: number;
  fileUrl: string; // Original URL
  originalVideoPath: string; // Same as videoPath in this simplified version
}> {
  // Ensure FFmpegService is available for temp dir (or use another way to get temp dir)
  const ffmpegService = new FFmpegService(); // Or get singleton instance
  const tempDir = ffmpegService.getTempDir(); // Use the consistent temp directory

  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL provided');
  }

  // Basic URL validation
  try {
    new URL(url); // Will throw if URL is invalid
  } catch (error) {
    throw new Error('Invalid URL format. Please provide a valid URL.');
  }

  log.info(`[processVideoUrl] Processing URL: ${url}`);
  progressCallback?.({ percent: 10, stage: 'Starting URL processing...' });

  try {
    // Call the enhanced download function
    const { filepath } = await downloadVideoFromPlatform(
      url,
      tempDir, // Pass the application's temp directory
      quality,
      progressCallback
    );

    // Get file stats
    const stats = await fsp.stat(filepath);
    const finalFilename = path.basename(filepath);

    log.info(`[processVideoUrl] Processing complete for: ${finalFilename}`);

    // Ensure we have a valid path and filename before returning
    if (!filepath || !finalFilename) {
      throw new Error(
        'Downloaded video information is incomplete (missing path or filename).'
      );
    }

    // Double-check file exists again
    if (!fs.existsSync(filepath)) {
      throw new Error(
        `Downloaded video file does not exist at path: ${filepath}`
      );
    }

    // Create a file:// URL for the file
    const fileUrl = `file://${filepath}`;

    progressCallback?.({ percent: 100, stage: 'URL processing complete' });

    return {
      videoPath: filepath, // The confirmed path from downloadInfo._filename
      filename: finalFilename,
      size: stats.size,
      fileUrl: fileUrl, // Use proper file:// URL instead of the original web URL
      originalVideoPath: filepath, // Path is determined by yt-dlp, no separate original path needed
    };
  } catch (error) {
    log.error('[processVideoUrl] Error:', error);
    // Ensure progress reflects failure
    progressCallback?.({
      percent: 0, // Or keep last known progress? Resetting seems clearer.
      stage: 'Error processing URL',
      error: error instanceof Error ? error.message : String(error),
    });
    // Rethrow the error
    throw error;
  }
}
