import fs from 'fs';
import path from 'path';
import { FFmpegService } from './ffmpeg-service.js';
import youtubeDl from 'youtube-dl-exec';
import { exec } from 'child_process';
import os from 'os';

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

// Get path to the app's resources directory where bundled binaries are stored
function getResourcesPath(): string {
  // In development, we're in the node_modules directory
  if (process.env.NODE_ENV === 'development') {
    return path.join(process.cwd(), 'resources');
  }

  // In production, use the Electron resources path
  return process.resourcesPath;
}

// Automatically download the latest yt-dlp binary for the current platform
async function ensureYtDlpBinary(tempDir: string): Promise<string> {
  const platform = os.platform();
  const resourcesPath = getResourcesPath();
  const binDir = path.join(resourcesPath, 'bin');

  // Create the bin directory if it doesn't exist
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // Binary name depends on platform
  let binaryName = 'yt-dlp';
  let downloadUrl =
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

  if (platform === 'win32') {
    binaryName = 'yt-dlp.exe';
    downloadUrl =
      'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  }

  const binaryPath = path.join(binDir, binaryName);

  // If the binary already exists and is less than 30 days old, use it
  if (fs.existsSync(binaryPath)) {
    const stats = await fs.promises.stat(binaryPath);
    const ageInDays =
      (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

    if (ageInDays < 30) {
      console.log('Using existing yt-dlp binary');
      return binaryPath;
    }
  }

  // Download the latest binary
  console.log('Downloading latest yt-dlp binary...');
  const tempDownloadPath = path.join(tempDir, binaryName);

  try {
    // Download the binary
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download yt-dlp: ${response.statusText}`);
    }

    // Stream it to disk
    const fileStream = fs.createWriteStream(tempDownloadPath);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    await new Promise<void>((resolve, reject) => {
      function processChunk({
        done,
        value,
      }: ReadableStreamReadResult<Uint8Array>) {
        if (done) {
          fileStream.end();
          return resolve();
        }

        fileStream.write(value, error => {
          if (error) {
            return reject(new Error(`Error writing to file: ${error.message}`));
          }

          reader!.read().then(processChunk).catch(reject);
        });
      }

      reader.read().then(processChunk).catch(reject);
    });

    // Make the binary executable on Unix systems
    if (platform !== 'win32') {
      await fs.promises.chmod(tempDownloadPath, 0o755);
    }

    // Move to resources directory
    await fs.promises.rename(tempDownloadPath, binaryPath);

    console.log('Successfully downloaded and installed yt-dlp');
    return binaryPath;
  } catch (error) {
    console.error('Error downloading yt-dlp:', error);
    if (fs.existsSync(binaryPath)) {
      console.log('Using existing yt-dlp binary despite failed update');
      return binaryPath;
    }
    return '';
  }
}

// Download with yt-dlp using various fallback options to maximize success
async function downloadWithYtDlp(
  url: string,
  outputPath: string,
  ytDlpPath: string,
  quality: VideoQuality = 'high',
  progressCallback?: ProgressCallback
): Promise<boolean> {
  const formatString = qualityFormatMap[quality] || qualityFormatMap.high;
  console.log(`Using format string for quality '${quality}': ${formatString}`);

  // Check if URL is Twitter/X
  const isTwitterUrl = url.includes('twitter.com') || url.includes('x.com');
  if (isTwitterUrl) {
    console.log('Detected Twitter/X URL, omitting format specifier.');
  }

  // Conditionally add format string
  const buildArgs = (baseArgs: string): string => {
    let finalArgs = baseArgs;
    if (!isTwitterUrl) {
      finalArgs += ` --format "${formatString}"`; // Add format only if not Twitter
    }
    // Add other common arguments
    finalArgs += ' --no-check-certificates --no-warnings --newline --progress';
    return finalArgs;
  };

  // Build base parts of the command
  const baseCmd = `"${ytDlpPath}" "${url}" -o "${outputPath}"`;

  // Try various download options in a sequence
  const downloadOptions = [
    // Option 1: Try with a referer and user agent
    {
      name: 'with referer and user agent',
      args: buildArgs(
        `${baseCmd} --referer "https://www.youtube.com/" --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" --force-ipv4`
      ),
    },

    // Option 2: Try with different IP version
    {
      name: 'with IPv6',
      args: buildArgs(`${baseCmd} --force-ipv6`),
    },

    // Option 3: Just the video URL with minimal options
    {
      name: 'with minimal options',
      args: buildArgs(
        isTwitterUrl
          ? baseCmd // No format split for Twitter
          : `${baseCmd} --format "${formatString.includes('/') ? formatString.split('/')[1] : formatString}"`
      ),
    },

    // Option 4: With extra YouTube-specific options (Likely ineffective for Twitter, but kept as fallback)
    {
      name: 'with YouTube options',
      args: buildArgs(
        `${baseCmd} --extractor-args "youtube:player_client=web" --geo-bypass --no-playlist`
      ),
    },
  ];

  // Try each option until one succeeds
  for (const [index, option] of downloadOptions.entries()) {
    try {
      progressCallback?.({
        percent: 30 + Math.floor((index / downloadOptions.length) * 10),
        stage: `Trying download ${option.name}...`,
      });

      console.log(`Trying to download ${option.name}...`);

      // Execute yt-dlp command with progress tracking
      let lastProgressTime = Date.now();
      const reportedFinalProgress = false; // Flag to prevent multiple final updates

      await new Promise<void>((resolve, reject) => {
        console.log(`[downloadWithYtDlp] Executing: ${option.args}`);
        const childProcess = exec(option.args);
        let downloadPercent = 0;

        childProcess.stdout?.on('data', data => {
          const output = data.toString();
          console.log(`[downloadWithYtDlp] stdout: ${output.trim()}`);

          // Look for percentage indicators in yt-dlp output
          const percentMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
          if (percentMatch) {
            const newPercent = parseFloat(percentMatch[1]);
            // Ensure we don't go backwards or prematurely hit 100
            if (newPercent > downloadPercent && newPercent < 100) {
              downloadPercent = newPercent;

              const now = Date.now();
              if (now - lastProgressTime > 1000) {
                lastProgressTime = now;
                // Scale 0-100 download progress to 40%-80% UI progress
                const uiPercent = 40 + Math.floor(newPercent * 0.4);
                progressCallback?.({
                  percent: uiPercent,
                  stage: `Downloading video... ${newPercent.toFixed(1)}%`,
                });
              }
            }
          }
        });

        childProcess.stderr?.on('data', data => {
          const output = data.toString();
          console.error(`[downloadWithYtDlp] stderr: ${output.trim()}`);
        });

        childProcess.on('error', error => {
          console.error(
            `[downloadWithYtDlp] child process error event for ${option.name}:`,
            error
          );
          reject(error);
        });

        childProcess.on('close', code => {
          console.log(
            `[downloadWithYtDlp] child process close event for ${option.name}. Exit code: ${code}`
          );
          if (code === 0) {
            // ---- MOVED: Update progress to near-complete *after* successful close ----
            if (!reportedFinalProgress) {
              progressCallback?.({
                percent: 85, // Indicate download part is done, ready to finalize
                stage: `Download successful, finalizing...`,
              });
            }
            console.log(
              `[downloadWithYtDlp] Resolving promise for ${option.name} due to close code 0.`
            );
            resolve();
          } else {
            console.error(
              `[downloadWithYtDlp] Rejecting promise for ${option.name} due to close code ${code}.`
            );
            reject(new Error(`Process exited with code ${code}`));
          }
        });
      });

      console.log(
        `[downloadWithYtDlp] Promise settled for ${option.name}. Checking file existence...`
      );

      // Verify download was successful
      const fileExists = fs.existsSync(outputPath);
      const fileSize = fileExists ? fs.statSync(outputPath).size : 0;
      console.log(
        `[downloadWithYtDlp] File check: Exists=${fileExists}, Size=${fileSize}`
      );

      if (fileExists && fileSize > 0) {
        console.log(
          `[downloadWithYtDlp] Successfully downloaded video ${option.name}!`
        );
        return true;
      }
    } catch (error) {
      console.error(`Failed to download ${option.name}:`, error);
    }
  }

  // All options failed
  return false;
}

// Handle YouTube and other video platform downloads with various fallback methods
async function downloadVideoFromPlatform(
  url: string,
  tempVideoPath: string,
  quality: VideoQuality = 'high',
  progressCallback?: ProgressCallback
): Promise<boolean> {
  progressCallback?.({
    percent: 25,
    stage: 'Preparing video download tools...',
  });

  // First, try to get or download our bundled yt-dlp
  const ffmpegService = new FFmpegService();
  const tempDir = ffmpegService.getTempDir();

  let ytDlpPath = '';

  try {
    // Get or download our bundled yt-dlp
    ytDlpPath = await ensureYtDlpBinary(tempDir);

    if (ytDlpPath) {
      console.log('Using yt-dlp at:', ytDlpPath);

      // Try downloading with our bundled yt-dlp with various options
      const success = await downloadWithYtDlp(
        url,
        tempVideoPath,
        ytDlpPath,
        quality,
        progressCallback
      );

      if (success) {
        return true;
      }
    }
  } catch (ytDlpError) {
    console.error('Error with yt-dlp:', ytDlpError);
  }

  // If yt-dlp failed or we couldn't get it, try with youtube-dl-exec as fallback
  try {
    progressCallback?.({
      percent: 75,
      stage: 'Trying download with youtube-dl-exec...',
    });

    console.log('Falling back to youtube-dl-exec...');

    // Determine formats to try, prioritizing selected quality
    const selectedFormat = qualityFormatMap[quality] || qualityFormatMap.high;
    const fallbackFormats = [
      'mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      'mp4/best[ext=mp4]/best',
      'best',
    ];
    // Ensure selected format is tried first, avoid duplicates
    const formatsToTry = [
      selectedFormat,
      ...fallbackFormats.filter(f => f !== selectedFormat),
    ];

    console.log(
      `Trying youtube-dl-exec with formats (quality '${quality}'):`,
      formatsToTry
    );

    // Try various options with youtube-dl-exec
    for (const format of formatsToTry) {
      try {
        console.log(`Attempting youtube-dl-exec with format: ${format}`);
        // @ts-ignore - The type definition seems incorrect for ESM
        await youtubeDl(url, {
          output: tempVideoPath,
          format,
          noCheckCertificates: true,
          noWarnings: true,
          addHeader: [
            'referer:youtube.com',
            'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          ],
        });

        if (
          fs.existsSync(tempVideoPath) &&
          fs.statSync(tempVideoPath).size > 0
        ) {
          console.log('Successfully downloaded with youtube-dl-exec!');
          return true;
        }
      } catch (error) {
        console.error(`Failed with format ${format}:`, error);
      }
    }
  } catch (youtubeDlError) {
    console.error('Error with youtube-dl-exec:', youtubeDlError);
  }

  // Both methods failed
  return false;
}

export async function processVideoUrl(
  url: string,
  quality: VideoQuality = 'high',
  progressCallback?: ProgressCallback
): Promise<{
  videoPath: string;
  filename: string;
  size: number;
  fileUrl: string;
  originalVideoPath: string;
}> {
  const ffmpegService = new FFmpegService();
  const tempDir = ffmpegService.getTempDir();

  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL provided');
  }

  try {
    // Report initial progress
    progressCallback?.({ percent: 10, stage: 'Starting URL processing...' });

    // Validate URL format
    let validUrl: URL;
    try {
      validUrl = new URL(url);
    } catch (error) {
      throw new Error('Invalid URL format');
    }

    // Create a safe filename for our temporary download
    const timestampPrefix = Date.now();
    const tempVideoPath = path.join(tempDir, `download_${timestampPrefix}.mp4`);

    progressCallback?.({ percent: 20, stage: 'Analyzing video source...' });

    // --- MODIFIED: Always try yt-dlp first --- START ---
    const downloadSuccess = await downloadVideoFromPlatform(
      url,
      tempVideoPath,
      quality,
      progressCallback
    );

    if (!downloadSuccess) {
      // --- Optional: Fallback to fetch if yt-dlp fails --- START ---
      // console.warn('yt-dlp failed, attempting direct fetch as fallback...');
      // progressCallback?.({
      //   percent: 80, // Indicate fallback attempt
      //   stage: 'Attempting direct download...',
      // });
      // try {
      //   const response = await fetch(url);
      //   if (!response.ok) {
      //     throw new Error(`Fetch failed: ${response.statusText}`);
      //   }
      //   const fileStream = fs.createWriteStream(tempVideoPath);
      //   const reader = response.body?.getReader();
      //   if (!reader) throw new Error('Failed to get fetch reader');
      //   await new Promise<void>((resolve, reject) => { ... }); // Stream logic
      //   console.log('Direct fetch fallback successful.');
      // } catch (fetchError) {
      //   console.error('Direct fetch fallback also failed:', fetchError);
      //   throw new Error(
      //     'Failed to download video using both yt-dlp and direct fetch. URL might be invalid, protected, or require specific handling.'
      //   );
      // }
      // --- Optional: Fallback to fetch if yt-dlp fails --- END ---

      // If not using fetch fallback, throw error directly
      throw new Error(
        'Failed to download video using yt-dlp. URL might be invalid, protected, or require specific handling.'
      );
    }
    // --- MODIFIED: Always try yt-dlp first --- END ---

    // Verify the file exists and get its metadata
    if (!fs.existsSync(tempVideoPath)) {
      throw new Error(`Failed to create video file at ${tempVideoPath}`);
    }

    // Get file size and base filename
    const stats = await fs.promises.stat(tempVideoPath);
    const fileExtension = path.extname(tempVideoPath) || '.mp4';
    const originalFilename = path.basename(validUrl.pathname) || 'video';
    const safeFilename = `download_${timestampPrefix}_${originalFilename.replace(/[^a-zA-Z0-9.-]/g, '_')}${fileExtension}`;

    // If the file doesn't have the correct name, rename it
    const finalVideoPath = path.join(tempDir, safeFilename);
    if (tempVideoPath !== finalVideoPath) {
      await fs.promises.rename(tempVideoPath, finalVideoPath);
    }

    progressCallback?.({
      percent: 90,
      stage: 'Finalizing video processing...',
    });

    // Return the downloaded video information
    progressCallback?.({ percent: 100, stage: 'URL processing complete' });
    return {
      videoPath: finalVideoPath,
      filename: safeFilename,
      size: stats.size,
      fileUrl: url,
      originalVideoPath: finalVideoPath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    progressCallback?.({
      percent: 0,
      stage: 'Error processing URL',
      error: errorMessage,
    });
    throw error;
  }
}
