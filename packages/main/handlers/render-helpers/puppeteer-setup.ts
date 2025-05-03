import path from 'path';
import url from 'url';
import { Browser, Page, launch } from 'puppeteer';
import { app } from 'electron';
import log from 'electron-log';

/* internal helper – resolves dist / dev HTML */
const getRenderHostPath = (): string => {
  const appPath = app.getAppPath();
  return app.isPackaged
    ? path.join(appPath, 'dist', 'render-host.html')
    : path.join(appPath, '..', '..', 'render-host.html');
};

export async function initPuppeteer({
  operationId,
  videoWidth,
  videoHeight,
  fontRegular,
  fontSizePx,
  stylePreset,
}: {
  operationId: string;
  videoWidth: number;
  videoHeight: number;
  fontRegular: string;
  fontSizePx?: number;
  stylePreset?: unknown;
}): Promise<{ browser: Browser; page: Page }> {
  const hostHtml = getRenderHostPath();
  const hostUrl = url.pathToFileURL(hostHtml).toString();

  const browser = await launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
      '--disable-web-security',
    ],
  });

  const page = await browser.newPage();
  page.on('console', msg =>
    log.info(`[Puppeteer:${operationId}][${msg.type()}] ${msg.text()}`)
  );
  page.setViewport({ width: videoWidth, height: videoHeight });
  await page.goto(hostUrl, { waitUntil: 'networkidle0' });

  /* embed font + preset before first screenshot */
  if (fontSizePx) {
    await page.addStyleTag({
      content: `
        @font-face {
          font-family: "Noto Sans";
          src: url("${fontRegular}") format("truetype");
          font-weight: normal;
        }`,
    });
    await page.evaluate(() => document.fonts.ready);
  }
  if (stylePreset) {
    await page.evaluate(p => {
      // @ts-expect-error defined in render-host-script
      window.applySubtitlePreset?.(p);
    }, stylePreset);
  }

  /* ensure render-host script exported updateSubtitle */
  await page.waitForFunction('typeof window.updateSubtitle === "function"', {
    timeout: 5_000,
  });

  log.info(`[Puppeteer:${operationId}] ready`);
  return { browser, page };
}
