import path from 'path';
import fs from 'fs/promises';
import { Page } from 'puppeteer';
import log from 'electron-log';

export async function generateStatePngs({
  page,
  events,
  tempDirPath,
  videoWidth,
  videoHeight,
  fps,
  fontSizePx,
  stylePreset,
  operationId,
  progress,
  signal,
}: {
  page: Page;
  events: Array<{ timeMs: number; text: string }>;
  tempDirPath: string;
  videoWidth: number;
  videoHeight: number;
  fps: number;
  fontSizePx?: number;
  stylePreset?: unknown;
  operationId: string;
  progress: (d: { percent: number; stage: string }) => void;
  signal?: AbortSignal;
}): Promise<Array<{ path: string; duration: number }>> {
  const pngs: Array<{ path: string; duration: number }> = [];
  const total = events.length;
  const STAGE_PERCENT = 10;
  const STEP = Math.max(1, Math.floor(total / 200));

  const abortCleanups: (() => void)[] = [];
  if (signal) {
    const onAbort = () => {
      log.info(
        `[state-generator ${operationId}] Closing page to cancel screenshot operation`
      );
      page.close({ runBeforeUnload: false }).catch(() => {});
      progress({ percent: 0, stage: 'Cancelled' });
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    abortCleanups.push(() => signal.removeEventListener('abort', onAbort));
  }

  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) {
        throw new Error('Cancelled');
      }

      const ev = events[i];
      const nextTime =
        i + 1 < total ? events[i + 1].timeMs : events[total - 1].timeMs;
      const durMs = nextTime - ev.timeMs;
      if (durMs < 1) continue;

      const frames = Math.max(1, Math.round((durMs / 1000) * fps));
      const duration = frames / fps;
      const file = path.join(
        tempDirPath,
        `state_${String(i).padStart(5, '0')}.png`
      );
      const durationToUse =
        i === 0 && ev.text ? Math.max(duration, 2 / fps) : duration;

      await page.evaluate(
        ({ txt, size, preset }) => {
          // @ts-expect-error supplied by render host
          window.updateSubtitle(txt, { fontSizePx: size, stylePreset: preset });
        },
        { txt: ev.text, size: fontSizePx, preset: stylePreset }
      );

      try {
        await page.screenshot({
          path: file,
          omitBackground: true,
          clip: {
            x: 0,
            y: 0,
            width: videoWidth > 0 ? videoWidth : 1280,
            height: videoHeight > 0 ? videoHeight : 720,
          },
          type: 'png',
        });
      } catch (err) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.message?.includes('Target closed'))
        ) {
          throw new Error('Cancelled');
        }
        throw err;
      }

      pngs.push({ path: file, duration: durationToUse });

      if (i % STEP === 0 || i === total - 1) {
        const pct = Math.round(((i + 1) / total) * STAGE_PERCENT);
        progress({
          percent: pct,
          stage: `Rendering subtitles ${i + 1}/${total}`,
        });
      }
    }

    log.info(`[state-generator ${operationId}] captured ${pngs.length} PNGs`);
    return pngs;
  } catch (err) {
    if (err instanceof Error && err.message === 'Cancelled') {
      await Promise.all(
        pngs.map(async ({ path: file }) => {
          try {
            await fs.rm(file, { force: true });
          } catch (cleanupErr) {
            log.warn(
              `[state-generator ${operationId}] Failed to cleanup PNG ${file}:`,
              cleanupErr
            );
          }
        })
      );
      const lastPct = Math.round((pngs.length / total) * STAGE_PERCENT);
      progress({ percent: lastPct, stage: 'Cancelled' });
    }
    throw err;
  } finally {
    abortCleanups.forEach(cleanup => cleanup());
  }
}
