import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assertWindowsX64Executable,
  verifyWindowsMedia,
} = require('../verify-windows-media.cjs');

test('media validation rejects missing, Linux, wrong-architecture and truncated executables', () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'translator-media-test-')
  );
  const binary = path.join(tempDir, 'ffmpeg.exe');
  try {
    assert.throws(() => assertWindowsX64Executable(binary));
    const header = Buffer.alloc(128);
    header.write('\x7fELF');
    fs.writeFileSync(binary, header);
    assert.throws(
      () => assertWindowsX64Executable(binary),
      /not a Windows executable/
    );
    header.write('MZ');
    header.writeUInt32LE(64, 60);
    header.writeUInt32LE(0x4550, 64);
    header.writeUInt16LE(0x14c, 68);
    fs.writeFileSync(binary, header);
    assert.throws(() => assertWindowsX64Executable(binary), /not an x64/);
    header.writeUInt16LE(0x8664, 68);
    fs.writeFileSync(binary, header);
    assert.doesNotThrow(() => assertWindowsX64Executable(binary));
    fs.writeFileSync(binary, header.subarray(0, 66));
    assert.throws(
      () => assertWindowsX64Executable(binary),
      /Invalid packaged media/
    );
    if (process.platform === 'win32') {
      assert.throws(
        () => verifyWindowsMedia(tempDir),
        /Missing packaged ffmpeg/
      );
    } else {
      assert.throws(() => verifyWindowsMedia(tempDir), /must run on Windows/);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
