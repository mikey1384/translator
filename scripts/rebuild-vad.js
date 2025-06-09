#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const targetArch = process.env.TARGET_ARCH || process.arch; // 'x64' or 'arm64'

console.log(`[postinstall] Rebuilding webrtcvad for ${targetArch}…`);
const res = spawnSync(
  'npm',
  ['rebuild', 'webrtcvad', `--arch=${targetArch}`, '--platform=darwin'],
  { stdio: 'inherit' }
);

if (res.status !== 0) {
  console.error('❌ webrtcvad rebuild failed');
  process.exit(res.status);
}
console.log('✅ webrtcvad rebuild complete');
