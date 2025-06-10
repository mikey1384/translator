import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import type { Browser, Page } from 'puppeteer-core';
import { app } from 'electron';
import log from 'electron-log';

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

  log.info('[Puppeteer]', { hostHtml });
  log.info(`[Puppeteer:${operationId}] Render host URL: ${hostUrl}`);

  // choose package + executable ------------------------------------------
  const isDev = !app.isPackaged;
  const { default: puppeteer } = isDev
    ? await import('puppeteer')
    : await import('puppeteer-core');

  const executablePath = isDev
    ? undefined // dev → use Puppeteer's own Chrome
    : (() => {
        const headlessDir = path.join(
          process.resourcesPath,
          process.arch === 'arm64' ? 'headless-arm64' : 'headless-x64'
        );

        try {
          // Navigate the nested structure: headless-arm64/chrome-headless-shell/mac_arm-*/chrome-headless-shell-mac-arm64/chrome-headless-shell
          const chromeDir = path.join(headlessDir, 'chrome-headless-shell');
          if (fs.existsSync(chromeDir)) {
            const versionDirs = fs.readdirSync(chromeDir);
            const versionDir = versionDirs.find(dir =>
              dir.startsWith(process.arch === 'arm64' ? 'mac_arm-' : 'mac-')
            );
            if (versionDir) {
              const platformDir = path.join(chromeDir, versionDir);
              const platformDirs = fs.readdirSync(platformDir);
              const binaryDir = platformDirs.find(dir =>
                dir.startsWith('chrome-headless-shell-mac-')
              );
              if (binaryDir) {
                return path.join(
                  platformDir,
                  binaryDir,
                  'chrome-headless-shell'
                );
              }
            }
          }
        } catch (error) {
          log.warn(
            `[Puppeteer] Error finding headless shell in nested structure: ${error}`
          );
        }

        // Fallback to old path structure if new structure not found
        return path.join(headlessDir, 'headless_shell');
      })();
  // ----------------------------------------------------------------------

  if (executablePath && !isDev)
    log.info(
      `[Puppeteer:${operationId}] Using bundled headless_shell: ${executablePath}`
    );
  else
    log.info(
      `[Puppeteer:${operationId}] Using Puppeteer's own Chrome (dev mode)`
    );

  const browser = (await puppeteer.launch({
    executablePath,
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
        transform: translateX(-50%) !important;
      }
    `,
  });

  log.info(`[Puppeteer:${operationId}] ready`);
  return { browser, page };
}
