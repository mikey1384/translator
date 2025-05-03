import path from 'path';
import { Page } from 'puppeteer';
import log from 'electron-log';

export async function generateStatePngs({
  page,
  events,
  tempDirPath,
  videoWidth,
  videoHeight,
  frameRate,
  fontSizePx,
  stylePreset,
  operationId,
  progress,
}: {
  page: Page;
  events: Array<{ timeMs: number; text: string }>;
  tempDirPath: string;
  videoWidth: number;
  videoHeight: number;
  frameRate: number;
  fontSizePx?: number;
  stylePreset?: unknown;
  operationId: string;
  progress: (d: { percent: number; stage: string }) => void;
}): Promise<Array<{ path: string; duration: number }>> {
  const pngs: Array<{ path: string; duration: number }> = [];
  const total = events.length;
  const STAGE_PERCENT = 10;
  const frameDur = 1 / frameRate;

  for (let i = 0; i < total; i++) {
    const ev = events[i];
    const nextTime =
      i + 1 < total ? events[i + 1].timeMs : events[total - 1].timeMs;
    const durMs = nextTime - ev.timeMs;
    if (durMs < 1) continue;

    const duration = Math.max(
      frameDur,
      Math.round(durMs / 1000 / frameDur) * frameDur
    );
    const file = path.join(
      tempDirPath,
      `state_${String(i).padStart(5, '0')}.png`
    );

    await page.evaluate(
      ({ txt, size, preset }) => {
        // @ts-expect-error supplied by render host
        window.updateSubtitle(txt, { fontSizePx: size, stylePreset: preset });
      },
      { txt: ev.text, size: fontSizePx, preset: stylePreset }
    );

    await page.screenshot({
      path: file,
      omitBackground: true,
      clip: { x: 0, y: 0, width: videoWidth, height: videoHeight },
      type: 'png',
    });

    pngs.push({ path: file, duration });
    const pct = Math.round(((i + 1) / total) * STAGE_PERCENT);
    if (i < 50 || (i + 1) % 10 === 0 || i === total - 1) {
      progress({
        percent: pct,
        stage: `Rendering subtitles ${i + 1}/${total}`,
      });
    }
  }

  log.info(`[state-generator ${operationId}] captured ${pngs.length} PNGs`);
  return pngs;
}
