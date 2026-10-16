import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import type { Browser, Page } from 'puppeteer-core';
import { app } from 'electron';
import log from 'electron-log';
import { getHeadlessChromePath } from '../../services/headless-chrome-installer.js';
import type { HeadlessChromeProgress } from '../../services/headless-chrome-installer.js';
import { assertSubtitleRenderFontReadable } from '../../utils/subtitle-render-font.js';

/* ───────── helpers ───────── */

function getRenderHostPath(): string {
  const dev = path.resolve(__dirname, 'render-host.html');
  if (fs.existsSync(dev)) return dev;
  // The development driver launches packages/main, while the render host is
  // built at the workspace root alongside its script bundle.
  if (!app.isPackaged) {
    const workspaceHost = path.resolve(
      app.getAppPath(),
      '../..',
      'render-host.html'
    );
    if (fs.existsSync(workspaceHost)) return workspaceHost;
  }
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
  signal,
  onPreparationProgress,
}: {
  operationId: string;
  videoWidth: number;
  videoHeight: number;
  fontRegular: string;
  fontSizePx?: number;
  stylePreset?: unknown;
  signal?: AbortSignal;
  onPreparationProgress?: (progress: HeadlessChromeProgress) => void;
}): Promise<{ browser: Browser; page: Page }> {
  const hostHtml = getRenderHostPath();
  const hostUrl = url.pathToFileURL(hostHtml).toString();
  const renderFont = await assertSubtitleRenderFontReadable(fontRegular);
  // Pretendard ships beside Noto Sans and leads the landscape subtitle stack.
  const pretendardUrl = url
    .pathToFileURL(
      path.join(path.dirname(renderFont.path), 'PretendardVariable.woff2')
    )
    .toString();

  log.info('[Puppeteer]', { hostHtml });
  log.info(`[Puppeteer:${operationId}] Render host URL: ${hostUrl}`);
  log.info(
    `[Puppeteer:${operationId}] Font asset accessible at ${renderFont.path}`
  );

  // choose package + executable ------------------------------------------
  const isDev = !app.isPackaged;
  const { default: puppeteer } = isDev
    ? await import('puppeteer')
    : await import('puppeteer-core');

  const executablePath = await getHeadlessChromePath({
    signal,
    onProgress: onPreparationProgress,
  });
  signal?.throwIfAborted();
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

  if (signal?.aborted) {
    await browser.close();
    signal.throwIfAborted();
  }

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
        src: url("${renderFont.url}") format("truetype");
        font-weight: 400;
        font-style: normal;
      }
      @font-face {
        font-family: "Noto Sans";
        src: url("${renderFont.url}") format("truetype");
        font-weight: 700;
        font-style: normal;
      }
      @font-face {
        font-family: "Pretendard Variable";
        src: url("${pretendardUrl}") format("woff2-variations");
        font-weight: 45 920;
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
