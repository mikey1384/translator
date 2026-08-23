import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/lib/puppeteer/revisions.js';

export function resolvePuppeteerHeadlessRevision() {
  const revision = PUPPETEER_REVISIONS['chrome-headless-shell'];
  if (typeof revision !== 'string' || !/^[0-9A-Za-z._-]+$/.test(revision)) {
    throw new Error(
      'Puppeteer did not expose a valid headless-shell revision.'
    );
  }
  return revision;
}

export function isDirectInvocation({
  argvPath = process.argv[1],
  moduleUrl = import.meta.url,
  platform = process.platform,
  cwd = process.cwd(),
} = {}) {
  if (!argvPath) return false;

  const windows = platform === 'win32';
  const pathApi = windows ? path.win32 : path.posix;
  const invokedPath = pathApi.resolve(cwd, argvPath);
  const modulePath = pathApi.normalize(fileURLToPath(moduleUrl, { windows }));

  // Windows path identity is case-insensitive. Compare filesystem paths, not
  // URL constructors: a drive path such as C:\\repo\\script.mjs is otherwise
  // parsed as a URL whose scheme is "c:" and fileURLToPath rejects it.
  return windows
    ? invokedPath.toLowerCase() === modulePath.toLowerCase()
    : invokedPath === modulePath;
}

if (isDirectInvocation()) {
  process.stdout.write(`${resolvePuppeteerHeadlessRevision()}\n`);
}
