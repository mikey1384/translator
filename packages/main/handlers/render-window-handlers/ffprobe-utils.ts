import { spawn } from 'child_process';
import log from 'electron-log';

export async function probeFps(file: string): Promise<number> {
  log.info(`[ffprobe-utils] Probing FPS for ${file}`);
  return await new Promise((resolve, reject) => {
    const p = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=avg_frame_rate',
      '-of',
      'default=nw=1:nk=1',
      file,
    ]);
    let out = '';
    let err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));

    p.on('close', code => {
      if (code !== 0 || !out.trim()) {
        log.error(
          `[ffprobe-utils] Failed to probe FPS for ${file}. Code: ${code}, Stderr: ${err}`
        );
        return reject(
          new Error(`ffprobe failed (code ${code}): ${err || 'No output'}`)
        );
      }
      try {
        const [num, den] = out.trim().split('/').map(Number);
        if (isNaN(num) || isNaN(den) || den === 0) {
          log.error(
            `[ffprobe-utils] Invalid FPS format from ffprobe: ${out.trim()}`
          );
          return reject(
            new Error(`Invalid FPS format from ffprobe: ${out.trim()}`)
          );
        }
        const fps = num / den;
        log.info(`[ffprobe-utils] Detected FPS: ${fps} for ${file}`);
        resolve(fps);
      } catch (parseError: any) {
        log.error(
          `[ffprobe-utils] Error parsing ffprobe output: ${parseError.message}`
        );
        reject(
          new Error(`Error parsing ffprobe output: ${parseError.message}`)
        );
      }
    });

    p.on('error', spawnError => {
      log.error(
        `[ffprobe-utils] Spawn error for ffprobe: ${spawnError.message}`
      );
      reject(new Error(`Failed to spawn ffprobe: ${spawnError.message}`));
    });
  });
}
