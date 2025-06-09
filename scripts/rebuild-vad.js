#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.log('[postinstall] Skip VAD rebuild – not macOS');
  process.exit(0);
}

const targetArch = process.env.TARGET_ARCH || process.arch; // 'x64' or 'arm64'
console.log(`[postinstall] Rebuilding webrtcvad for ${targetArch}…`);

const runner = process.platform === 'darwin' ? 'bunx' : 'npx';

/**
 * 👉  electron-rebuild syntax
 *     -f  = force rebuild
 *     -w  = rebuild only the named module (webrtcvad)
 */
const res = spawnSync(
  runner,
  [
    'electron-rebuild',
    `--arch=${targetArch}`,
    '--platform=darwin',
    '-f', // force
    '-w',
    'webrtcvad', // whitelist webrtcvad only
  ],
  { stdio: 'inherit' }
);

if (res.status !== 0) {
  console.error('❌ webrtcvad rebuild failed');
  process.exit(res.status);
}
console.log('✅ webrtcvad rebuild complete');
