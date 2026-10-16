import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/lib/puppeteer/revisions.js';

// Release prerequisite: verify the public bytes, not only a successful upload.
const manifest = JSON.parse(await readFile(new URL('../packages/main/services/headless-chrome-manifest.json', import.meta.url), 'utf8'));
if (manifest.buildId !== PUPPETEER_REVISIONS['chrome-headless-shell']) {
  throw new Error('Pinned video export tools must match the installed Puppeteer revision.');
}
const platforms = process.argv.slice(2);
if (!platforms.length || platforms.some(platform => !Object.hasOwn(manifest.archives, platform))) {
  throw new Error('Specify one or more pinned platforms: mac_arm, mac, win64.');
}
for (const platform of platforms) {
  const archive = manifest.archives[platform];
  const url = `${manifest.baseUrl}/${archive.path}`;
  const response = await fetch(url, {signal: AbortSignal.timeout(10 * 60_000)});
  if (!response.ok || !response.body) throw new Error(`Hosted export tools unavailable for ${platform}: HTTP ${response.status}`);
  let size = 0;
  const hash = createHash('sha256');
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > archive.size) throw new Error(`Hosted export tools exceed the pinned size for ${platform}`);
    hash.update(chunk);
  }
  if (size !== archive.size || hash.digest('hex') !== archive.sha256) {
    throw new Error(`Hosted export tools checksum mismatch for ${platform}`);
  }
  console.log(`Hosted export tools verified: ${platform}, ${manifest.buildId}, ${size} bytes.`);
}
