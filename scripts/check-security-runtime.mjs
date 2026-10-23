import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const expectedElectron = require('../package.json').devDependencies.electron;

// Node's bounded regression vector for CVE-2026-111497. Check the actual
// decoder: Electron may backport Brotli fixes without changing its Node version.
// https://github.com/nodejs/node/commit/b5f41529df
async function verifyBrotli() {
  const assert = require('node:assert/strict');
  const zlib = require('node:zlib');
  const input = Buffer.from('200010414141fcffff07002228f00b60f7f41f000000', 'hex');
  const isPatchedRejection = error =>
    error.errno === -17 && error.code === 'ERR__ERROR_FORMAT_BLOCK_SWITCH';
  assert.throws(() => zlib.brotliDecompressSync(input), isPatchedRejection);
  await new Promise((resolve, reject) => {
    const decoder = zlib.createBrotliDecompress();
    decoder.on('error', error => {
      if (isPatchedRejection(error)) resolve();
      else reject(new Error('Streaming Brotli decoder lacks the security fix'));
    });
    decoder.on('end', () => reject(new Error('Invalid Brotli input was accepted')));
    decoder.resume();
    decoder.end(input);
  });
  const valid = Buffer.from('Translator runtime security check');
  assert.deepEqual(zlib.brotliDecompressSync(zlib.brotliCompressSync(valid)), valid);
  console.log(JSON.stringify({
    node: process.versions.node,
    electron: process.versions.electron,
    brotli: process.versions.brotli,
    architecture: process.arch,
    patched: true,
  }));
}

function check(executable, label) {
  const result = spawnSync(executable, ['-e', `(${verifyBrotli})().catch(() => process.exit(1))`], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  assert.equal(result.status, 0, `${label} failed the Brotli security regression check`);
  const proof = JSON.parse(result.stdout.trim());
  assert.equal(proof.patched, true);
  if (label === 'Electron') assert.equal(proof.electron, expectedElectron);
  console.log(`${label}: ${JSON.stringify(proof)}`);
}

const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--electron'),
  'Usage: node scripts/check-security-runtime.mjs [--electron executable]');
check(process.execPath, 'Build Node');
check(args.length ? path.resolve(args[1]) : require('electron'), 'Electron');
