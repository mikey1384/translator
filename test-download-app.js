import { youtubeDl } from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Define quality type and mapping
const qualityFormatMap = {
  high: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
  mid: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]',
  low: 'best[height<=480]',
};

async function downloadVideoFromPlatform(url, outputDir, quality = 'high') {
  console.log(`Starting download for URL: ${url}`);
  console.log(`Output directory: ${outputDir}`);
  console.log(`Requested quality: ${quality}`);

  const formatString = qualityFormatMap[quality] || qualityFormatMap.high;

  // Use a temporary unique filename pattern for yt-dlp
  const tempFilenamePattern = path.join(
    outputDir,
    `download_${Date.now()}_%(id)s.%(ext)s`
  );
  console.log(`Using temporary filename pattern: ${tempFilenamePattern}`);

  try {
    console.log('Initiating download...');

    const options = {
      output: tempFilenamePattern,
      format: formatString,
      noCheckCertificates: true,
      noWarnings: true,
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      ],
      printJson: true,
    };

    console.log('Calling youtube-dl-exec with options:', options);

    // Execute and capture JSON output
    const outputJson = await youtubeDl(url, options);

    console.log('youtube-dl-exec call finished.');

    if (!outputJson) {
      throw new Error('youtube-dl-exec did not return any output.');
    }

    // Check if the output is already an object
    const downloadInfo =
      typeof outputJson === 'string' ? JSON.parse(outputJson) : outputJson;

    if (!downloadInfo || typeof downloadInfo !== 'object') {
      throw new Error('Failed to parse JSON output from youtube-dl-exec');
    }

    // Get the definitive filename from the JSON
    const finalFilepath = downloadInfo._filename;

    if (!finalFilepath || typeof finalFilepath !== 'string') {
      console.error('JSON output missing _filename property.', downloadInfo);
      throw new Error(
        'Downloaded video information is incomplete (missing _filename in JSON).'
      );
    }

    // Verify the file exists
    console.log(`Verifying existence of final file: ${finalFilepath}`);
    if (!fs.existsSync(finalFilepath)) {
      console.error(
        `Critical: File specified in JSON does not exist: ${finalFilepath}`
      );
      console.error(`Listing contents of output directory (${outputDir}):`);
      try {
        const files = fs.readdirSync(outputDir);
        console.error(`Files found: ${files.join(', ')}`);
      } catch (readErr) {
        console.error(`Failed to list output directory: ${readErr}`);
      }
      throw new Error(
        `Downloaded video file not found at expected path: ${finalFilepath}`
      );
    }

    const stats = fs.statSync(finalFilepath);
    if (stats.size === 0) {
      console.error(`Critical: Downloaded file is empty: ${finalFilepath}`);
      throw new Error(`Downloaded video file is empty: ${finalFilepath}`);
    }

    console.log(`Download successful. File path: ${finalFilepath}`);
    console.log(`File size: ${stats.size} bytes`);

    return { filepath: finalFilepath, info: downloadInfo };
  } catch (error) {
    console.error('Error during downloadVideoFromPlatform:', error);
    throw new Error(`Video download failed: ${error.message || String(error)}`);
  }
}

// Main function
async function main() {
  const tempDir = os.tmpdir();
  // Testing two different URLs
  const urls = [
    'https://www.youtube.com/watch?v=jNQXAC9IVRw', // YouTube - Me at the zoo
    'https://vimeo.com/148751763', // Vimeo - Sample video
  ];

  for (const url of urls) {
    try {
      console.log(`\n\nTesting URL: ${url}`);
      const result = await downloadVideoFromPlatform(url, tempDir, 'high');
      console.log('Download result:', result);
    } catch (error) {
      console.error(`Failed to download ${url}:`, error.message);
    }
  }
}

main();
