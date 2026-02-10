import path from 'path';
import fs from 'fs/promises';
import { Page } from 'puppeteer';
import log from 'electron-log';
import { HEARTBEAT_INTERVAL_MS } from '../../../shared/constants/runtime-config.js';

export async function generateStatePngs({
  page,
  events,
  tempDirPath,
  videoWidth,
  videoHeight,
  displayWidth,
  displayHeight,
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
  displayWidth?: number;
  displayHeight?: number;
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
  let processed = 0;
  let uniqueCaptured = 0;
  const stateCache = new Map<string, string>();
  const createdFiles = new Set<string>();

  // Bump the progress bar every 5s even if nothing else happens
  // This prevents client timeout during long PNG capture operations
  const heartbeat = setInterval(() => {
    const frac = processed / total;
    progress({
      percent: 2 + frac * 8, // Stay in the 0-10% bucket
      stage: `Capturing PNGs… (${processed}/${total})`,
    });
  }, HEARTBEAT_INTERVAL_MS);

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
      processed = i + 1;
      if (signal?.aborted) {
        throw new Error('Cancelled');
      }

      const ev = events[i];
      const nextTime =
        i + 1 < total ? events[i + 1].timeMs : events[total - 1].timeMs;
      const durMs = nextTime - ev.timeMs;
      if (durMs < 1) continue;

      // Use exact millisecond duration — do NOT quantize to whole frames.
      // Frame quantization introduces ±0.5/fps rounding error per event that
      // accumulates across hundreds of subtitle events, causing progressive
      // subtitle drift in the merged output (especially with VFR or non-integer
      // frame rates like 29.97fps where rounding has a systematic bias).
      // The concat demuxer with -vsync vfr handles fractional durations natively.
      const duration = durMs / 1000;
      const key = (ev.text || '').trim() ? ev.text : '';
      const durationToUse =
        i === 0 && key ? Math.max(duration, 2 / fps) : duration;
      let file = stateCache.get(key);
      if (!file) {
        file = path.join(
          tempDirPath,
          `state_${String(uniqueCaptured).padStart(5, '0')}.png`
        );
        uniqueCaptured++;
        createdFiles.add(file);
        stateCache.set(key, file);

        const scaledSize = fontSizePx ? Math.round(fontSizePx) : fontSizePx;

        await page.evaluate(
          ({ txt, size, preset, displayWidth: dw, displayHeight: dh }) => {
            // @ts-expect-error provided by render-host script
            window.updateSubtitle(txt, {
              fontSizePx: size,
              stylePreset: preset,
              videoWidthPx: dw,
              videoHeightPx: dh,
            });
          },
          {
            txt: key,
            size: scaledSize,
            preset: stylePreset,
            displayWidth,
            displayHeight,
          }
        );

        try {
          await page.screenshot({
            path: file as `${string}.png`,
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
      }

      pngs.push({ path: file, duration: durationToUse });

      // Coarser incremental updates (keeps the bar moving)
      if (processed % 100 === 0 || processed === total) {
        const frac = processed / total;
        progress({
          percent: 2 + frac * 8, // Stay in the 0-10% bucket
          stage: `Capturing PNGs… (${processed}/${total})`,
        });
      }
    }

    clearInterval(heartbeat);
    progress({ percent: 10, stage: 'Overlay concat ready' });
    log.info(
      `[state-generator ${operationId}] captured ${uniqueCaptured} unique PNGs for ${pngs.length} frames`
    );
    return pngs;
  } catch (err) {
    if (err instanceof Error && err.message === 'Cancelled') {
      await Promise.all(
        [...createdFiles].map(async file => {
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
      const lastPct = Math.round((processed / total) * STAGE_PERCENT);
      progress({ percent: lastPct, stage: 'Cancelled' });
    }
    throw err;
  } finally {
    abortCleanups.forEach(cleanup => cleanup());
    clearInterval(heartbeat);
  }
}
