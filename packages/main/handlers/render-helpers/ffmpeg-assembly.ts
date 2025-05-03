import path from 'path';
import fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import log from 'electron-log';

type Progress = (d: { percent: number; stage: string; error?: string }) => void;

export async function assembleClipsFromStates({
  statePngs,
  outputPath,
  frameRate,
  operationId,
  progressCallback,
  registerProcess,
}: {
  statePngs: Array<{ path: string; duration: number }>;
  outputPath: string;
  frameRate: number;
  operationId: string;
  progressCallback?: Progress;
  registerProcess?: (p: ChildProcess) => void;
}): Promise<{ success: boolean; outputPath: string; error?: string }> {
  log.info(`[ffmpeg-assembly ${operationId}] Starting assembly...`);

  if (!statePngs.length) {
    progressCallback?.({ percent: 40, stage: 'No states to assemble' });
    return { success: true, outputPath };
  }

  const dir = path.dirname(outputPath);
  const listPath = path.join(dir, `concat_${operationId}.txt`);

  let concat = 'ffconcat version 1.0\n\n';
  for (const s of statePngs) {
    concat += `file '${path.relative(dir, s.path).replace(/\\/g, '/')}'\n`;
    concat += `duration ${s.duration.toFixed(6)}\n\n`;
  }
  concat += `file '${path.relative(dir, statePngs.at(-1)!.path).replace(/\\/g, '/')}'\n`;

  await fs.writeFile(listPath, concat, 'utf8');

  return new Promise(res => {
    const ff = spawn('ffmpeg', [
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-progress',
      'pipe:1',
      '-nostats',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '4444',
      '-pix_fmt',
      'yuva444p10le',
      '-r',
      frameRate.toString(),
      '-y',
      outputPath,
    ]);

    registerProcess?.(ff);

    let stdoutData = '';
    let lastProgressReportTime = 0;
    const progressUpdateInterval = 500; // ms
    const totalConcatDuration = statePngs.reduce(
      (sum, st) => sum + st.duration,
      0
    );
    const ASSEMBLY_START_PERCENT = 10;
    const ASSEMBLY_END_PERCENT = 40;
    const ASSEMBLY_PROGRESS_RANGE =
      ASSEMBLY_END_PERCENT - ASSEMBLY_START_PERCENT;

    ff.stdout.on('data', (data: Buffer) => {
      stdoutData += data.toString();
      const lines = stdoutData.split('\n');
      stdoutData = lines.pop() || ''; // Keep partial line

      lines.forEach(line => {
        if (line.startsWith('out_time_ms=')) {
          const timeMs = parseInt(line.split('=')[1], 10);
          if (!isNaN(timeMs) && totalConcatDuration > 0) {
            const currentTime = timeMs / 1_000_000;
            const currentProgress = (currentTime / totalConcatDuration) * 100;
            const overallPercent = Math.round(
              ASSEMBLY_START_PERCENT +
                (currentProgress * ASSEMBLY_PROGRESS_RANGE) / 100
            );
            const now = Date.now();
            if (
              now - lastProgressReportTime > progressUpdateInterval ||
              overallPercent >= ASSEMBLY_END_PERCENT
            ) {
              lastProgressReportTime = now;
              progressCallback?.({
                percent: Math.min(ASSEMBLY_END_PERCENT, overallPercent),
                stage: `Assembling overlay video... (${Math.round(
                  currentProgress
                )}%)`,
              });
            }
          }
        }
      });
    });

    ff.once('close', code => {
      fs.unlink(listPath).catch(() => void 0);
      if (code === 0) {
        progressCallback?.({ percent: 40, stage: 'Overlay assembly complete' });
        res({ success: true, outputPath });
      } else {
        const err = `ffmpeg exited with ${code}`;
        progressCallback?.({
          percent: 40,
          stage: 'Assembly failed',
          error: err,
        });
        res({ success: false, outputPath, error: err });
      }
    });
  });
}
