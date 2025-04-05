import { youtubeDl } from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tempDir = os.tmpdir();
const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // Just a simple test video (Me at the zoo)

console.log('Starting download test...');
console.log(`Output directory: ${tempDir}`);

const tempFilenamePattern = path.join(tempDir, `download_test_%(id)s.%(ext)s`);

const options = {
  output: tempFilenamePattern,
  format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
  noCheckCertificates: true,
  noWarnings: true,
  addHeader: [
    'referer:youtube.com',
    'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  ],
  printJson: true,
};

console.log('Calling youtube-dl-exec with options:', options);

async function testDownload() {
  try {
    const outputJson = await youtubeDl(testUrl, options);
    console.log('youtube-dl-exec call finished.');

    if (!outputJson) {
      throw new Error('youtube-dl-exec did not return any output.');
    }

    const downloadInfo =
      typeof outputJson === 'string' ? JSON.parse(outputJson) : outputJson;

    if (!downloadInfo || typeof downloadInfo !== 'object') {
      throw new Error('Failed to parse JSON output from youtube-dl-exec');
    }

    const finalFilepath = downloadInfo._filename;

    if (!finalFilepath || typeof finalFilepath !== 'string') {
      console.error('JSON output missing _filename property.', downloadInfo);
      throw new Error(
        'Downloaded video information is incomplete (missing _filename in JSON).'
      );
    }

    if (!fs.existsSync(finalFilepath)) {
      console.error(`File specified in JSON does not exist: ${finalFilepath}`);
      const files = fs.readdirSync(tempDir);
      console.error(`Files found in temp dir: ${files.join(', ')}`);
      throw new Error(
        `Downloaded video file not found at expected path: ${finalFilepath}`
      );
    }

    const stats = fs.statSync(finalFilepath);
    if (stats.size === 0) {
      console.error(`Downloaded file is empty: ${finalFilepath}`);
      throw new Error(`Downloaded video file is empty: ${finalFilepath}`);
    }

    console.log(`Download successful. File path: ${finalFilepath}`);
    console.log(`File size: ${stats.size} bytes`);
  } catch (error) {
    console.error('Error during test download:', error);
  }
}

testDownload();
