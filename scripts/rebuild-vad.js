#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.log('[postinstall] Skip VAD rebuild – not macOS');
  process.exit(0);
}

const targetArch = process.env.TARGET_ARCH || process.arch; // 'x64' or 'arm64'
console.log(`[postinstall] Rebuilding webrtcvad for ${targetArch}…`);

const res = spawnSync(
  'npx',
  [
    'electron-rebuild',
    '--arch',
    targetArch,
    '--platform=darwin',
    '--force',
    '--only',
    'webrtcvad',
  ],
  { stdio: 'inherit' }
);

if (res.status !== 0) {
  console.error('❌ webrtcvad rebuild failed');
  process.exit(res.status);
}
console.log('✅ webrtcvad rebuild complete');
