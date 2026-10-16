import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { BrowserPlatform } from '@puppeteer/browsers';
import { createHeadlessChromeRuntime } from '../services/headless-chrome-runtime.js';
import { downloadVerifiedBrowserArchive } from '../services/verified-browser-download.js';

const scratch = path.resolve(
  import.meta.dirname,
  '../../../.local/headless-runtime-tests'
);
const archive = await fs.readFile(
  path.join(import.meta.dirname, 'fixtures/headless-shell.zip')
);
const sha256 = createHash('sha256').update(archive).digest('hex');
const logger = { info() {}, warn() {}, error() {} };
const fixtureFetch: typeof fetch = async () => new Response(archive);

async function fixture(
  t: any,
  platform = BrowserPlatform.MAC_ARM,
  fetchArchive = fixtureFetch
) {
  await fs.mkdir(scratch, { recursive: true });
  const cacheDir = await fs.mkdtemp(path.join(scratch, 'case-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const options = {
    cacheDir,
    platform,
    buildId: '1.2.3.4',
    sha256,
    size: archive.length,
    baseUrl: 'https://downloads.example.test',
    fetchArchive,
    logger,
  };
  return { options, runtime: createHeadlessChromeRuntime(options) };
}

for (const platform of [
  BrowserPlatform.MAC_ARM,
  BrowserPlatform.MAC,
  BrowserPlatform.WIN64,
]) {
  test(`verified ${platform} install is atomic and reused offline`, async t => {
    let downloads = 0;
    const { runtime, options } = await fixture(t, platform, async () => {
      downloads++;
      return new Response(archive);
    });
    const stages: string[] = [];
    const [a, b] = await Promise.all([
      runtime.ensure({ onProgress: p => stages.push(p.stage) }),
      runtime.ensure(),
    ]);
    assert.equal(a, b);
    assert.equal(downloads, 1);
    assert.equal(await runtime.findReady(), a);
    assert.ok(stages.includes('downloading'));
    assert.ok(stages.includes('installing'));
    assert.equal(stages.at(-1), 'ready');
    const offline = createHeadlessChromeRuntime({
      ...options,
      fetchArchive: async () => {
        throw new Error('offline');
      },
    });
    assert.equal(await offline.ensure(), a);
    assert.ok(
      !(await fs.readdir(options.cacheDir)).some(p =>
        p.startsWith('.download-')
      )
    );
  });
}

test('a bad checksum never publishes a browser and releases the lock for retry', async t => {
  const { options } = await fixture(t);
  const broken = createHeadlessChromeRuntime({
    ...options,
    sha256: '0'.repeat(64),
  });
  await assert.rejects(broken.ensure(), /checksum/);
  assert.equal(await broken.findReady(), null);
  await assert.rejects(fs.stat(path.join(options.cacheDir, '.install-lock')), {
    code: 'ENOENT',
  });
  const retry = createHeadlessChromeRuntime(options);
  assert.equal(await retry.ensure(), await retry.findReady());
});

test('stale partial downloads are discarded, and separate runtimes share the install lock', async t => {
  let downloads = 0;
  const { options, runtime } = await fixture(
    t,
    BrowserPlatform.MAC_ARM,
    async () => {
      downloads++;
      await new Promise(resolve => setTimeout(resolve, 40));
      return new Response(archive);
    }
  );
  const stale = path.join(options.cacheDir, '.download-interrupted');
  await fs.mkdir(stale);
  await fs.writeFile(path.join(stale, 'partial.zip'), 'broken');
  const other = createHeadlessChromeRuntime(options);
  assert.deepEqual(await Promise.all([runtime.ensure(), other.ensure()]), [
    await runtime.findReady(),
    await runtime.findReady(),
  ]);
  assert.equal(downloads, 1);
  await assert.rejects(fs.stat(stale), { code: 'ENOENT' });
});

test('cancelling a render detaches its progress while background preparation completes', async t => {
  const { runtime } = await fixture(t, BrowserPlatform.MAC_ARM, async () => {
    await new Promise(resolve => setTimeout(resolve, 40));
    return new Response(archive);
  });
  const background = runtime.ensure();
  const controller = new AbortController();
  let callbacks = 0;
  const render = runtime.ensure({
    signal: controller.signal,
    onProgress: () => callbacks++,
  });
  controller.abort();
  await assert.rejects(render, { name: 'AbortError' });
  const before = callbacks;
  assert.equal(await background, await runtime.findReady());
  assert.equal(callbacks, before);
});

for (const bytes of [
  archive.subarray(0, 16),
  Buffer.concat([archive, Buffer.from('extra')]),
]) {
  test(`rejects an archive with unexpected length ${bytes.length}`, async t => {
    const { runtime } = await fixture(
      t,
      BrowserPlatform.MAC_ARM,
      async () => new Response(bytes)
    );
    await assert.rejects(runtime.ensure(), /checksum|pinned size/);
    assert.equal(await runtime.findReady(), null);
  });
}

test('a stalled network request times out instead of holding the installation indefinitely', async t => {
  const { options } = await fixture(t);
  const stalled: typeof fetch = async (_url, request) =>
    new Promise((_resolve, reject) => {
      const watchdog = setTimeout(
        () => reject(new Error('test deadline')),
        2000
      );
      request?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(watchdog);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    });
  await assert.rejects(
    downloadVerifiedBrowserArchive({
      url: 'https://downloads.example.test/archive.zip',
      destination: path.join(options.cacheDir, 'download.zip'),
      sha256,
      size: archive.length,
      onProgress() {},
      fetchArchive: stalled,
      idleTimeoutMs: 20,
    }),
    { name: 'AbortError' }
  );
});
