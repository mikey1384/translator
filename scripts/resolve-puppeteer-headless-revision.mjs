import { fileURLToPath } from 'node:url';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js';

export function resolvePuppeteerHeadlessRevision() {
  const revision = PUPPETEER_REVISIONS['chrome-headless-shell'];
  if (typeof revision !== 'string' || !/^[0-9A-Za-z._-]+$/.test(revision)) {
    throw new Error(
      'Puppeteer did not expose a valid headless-shell revision.'
    );
  }
  return revision;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(process.argv[1], 'file:'))
) {
  process.stdout.write(`${resolvePuppeteerHeadlessRevision()}\n`);
}
