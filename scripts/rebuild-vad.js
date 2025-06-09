#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.log('[postinstall] Skip VAD rebuild – not macOS');
  process.exit(0);
}

const targetArch = process.env.TARGET_ARCH || process.arch; // 'x64' or 'arm64'

console.log(`[postinstall] Rebuilding webrtcvad for ${targetArch}…`);
const useBunx = process.platform === 'darwin';
const cmd = useBunx ? 'bunx' : 'npx';
const args = useBunx
  ? [
      'electron-rebuild',
      'webrtcvad',
      `--arch=${targetArch}`,
      '--platform=darwin',
    ]
  : [
      'electron-rebuild',
      'webrtcvad',
      `--arch=${targetArch}`,
      '--platform=darwin',
    ];
const res = spawnSync(cmd, args, { stdio: 'inherit' });

if (res.status !== 0) {
  console.error('❌ webrtcvad rebuild failed');
  process.exit(res.status);
}
console.log('✅ webrtcvad rebuild complete');
