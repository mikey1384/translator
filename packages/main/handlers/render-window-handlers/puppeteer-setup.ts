import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import type { Browser, Page } from 'puppeteer-core';
import { app } from 'electron';
import log from 'electron-log';
import { getHeadlessChromePath } from '../../services/headless-chrome-installer.js';

/* ───────── helpers ───────── */

function getRenderHostPath(): string {
  const dev = path.resolve(__dirname, 'render-host.html');
  if (fs.existsSync(dev)) return dev;
  const unpacked = path.join(
    path.dirname(app.getAppPath()),
    'app.asar.unpacked',
    'render-host.html'
  );
  if (fs.existsSync(unpacked)) return unpacked;

  const inAsar = path.join(app.getAppPath(), 'render-host.html');
  if (fs.existsSync(inAsar)) return inAsar;

  throw new Error(`render-host.html not found in any expected location`);
}

/* ───────── main entry ───────── */

export async function initPuppeteer({
  operationId,
  videoWidth,
  videoHeight,
  fontRegular,
  fontSizePx: _fontSizePx, // Reserved for future use
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

  log.info('[Puppeteer]', { hostHtml });
  log.info(`[Puppeteer:${operationId}] Render host URL: ${hostUrl}`);

  // choose package + executable ------------------------------------------
  const isDev = !app.isPackaged;
  const { default: puppeteer } = isDev
    ? await import('puppeteer')
    : await import('puppeteer-core');

  const executablePath = await getHeadlessChromePath();
  // ----------------------------------------------------------------------

  if (executablePath)
    log.info(
      `[Puppeteer:${operationId}] Using headless Chrome: ${executablePath}`
    );
  else
    log.info(
      `[Puppeteer:${operationId}] Using Puppeteer's own Chrome (dev mode)`
    );

  const browser = (await puppeteer.launch({
    ...(executablePath && { executablePath }),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
      '--disable-web-security',
    ],
  })) as Browser;

  const page = (await browser.newPage()) as Page;
  page.on('console', msg =>
    log.info(
      `[Puppeteer:${operationId}][${msg.type()}] ${msg.text().substring(0, 300)}`
    )
  );
  await page.setViewport({ width: videoWidth, height: videoHeight });
  await page.goto(hostUrl, { waitUntil: 'networkidle0' });

  /* ─── optional font & style helpers ─── */
  await page.addStyleTag({
    content: `
      @font-face {
        font-family: "Noto Sans";
        src: url("${fontRegular}") format("truetype");
        font-weight: 400;
        font-style: normal;
      }
      @font-face {
        font-family: "Noto Sans";
        src: url("${fontRegular}") format("truetype");
        font-weight: 700;
        font-style: normal;
      }
    `,
  });
  await page.evaluate(() => document.fonts.ready);

  if (stylePreset) {
    await page.evaluate(preset => {
      // @ts-expect-error injected by render-host-script
      window.applySubtitlePreset?.(preset);
    }, stylePreset);
  }

  await page.waitForFunction('typeof window.updateSubtitle === "function"', {
    timeout: 5_000,
  });

  if (fontRegular) {
    try {
      const fontPath = url.fileURLToPath(fontRegular);
      await fs.promises.access(fontPath, fs.constants.R_OK);
      log.info(
        `[Puppeteer:${operationId}] Font asset accessible at ${fontPath}`
      );
    } catch (err) {
      log.error(
        `[Puppeteer:${operationId}] Unable to access font asset ${fontRegular}:`,
        err
      );
    }
  } else {
    log.warn(`[Puppeteer:${operationId}] No font asset provided`);
  }

  await page.addStyleTag({
    content: `
      #subtitle,
      #subtitle.visible {
        transition: none !important;
        opacity: 1   !important;
      }
    `,
  });

  log.info(`[Puppeteer:${operationId}] ready`);
  return { browser, page };
}
