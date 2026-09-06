const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function assertWindowsX64Executable(binaryPath) {
  const fd = fs.openSync(binaryPath, 'r');
  try {
    const dos = Buffer.alloc(64);
    assert.equal(fs.readSync(fd, dos, 0, dos.length, 0), dos.length);
    assert.equal(dos.toString('ascii', 0, 2), 'MZ', 'not a Windows executable');
    const pe = Buffer.alloc(6);
    assert.equal(
      fs.readSync(fd, pe, 0, pe.length, dos.readUInt32LE(60)),
      pe.length
    );
    assert.equal(pe.readUInt32LE(0), 0x00004550, 'invalid PE header');
    assert.equal(pe.readUInt16LE(4), 0x8664, 'not an x64 Windows executable');
  } catch (error) {
    throw new Error(
      `Invalid packaged media executable ${binaryPath}: ${error.message}`
    );
  } finally {
    fs.closeSync(fd);
  }
}

function run(binaryPath, args) {
  const result = spawnSync(binaryPath, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Packaged media smoke test failed: ${binaryPath}: ${result.error?.message || result.stderr || result.status}`
    );
  }
  return result.stdout;
}

function verifyWindowsMedia(appOutDir) {
  if (process.platform !== 'win32') {
    throw new Error(
      'Windows media smoke tests must run on Windows before release.'
    );
  }
  const mediaDir = path.join(
    path.resolve(appOutDir),
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'ffmpeg-ffprobe-static'
  );
  const ffmpeg = path.join(mediaDir, 'ffmpeg.exe');
  const ffprobe = path.join(mediaDir, 'ffprobe.exe');
  for (const [name, binaryPath] of [
    ['ffmpeg', ffmpeg],
    ['ffprobe', ffprobe],
  ]) {
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Missing packaged ${name} executable: ${binaryPath}`);
    }
    assertWindowsX64Executable(binaryPath);
    assert.match(
      run(binaryPath, ['-version']),
      new RegExp(`^${name} version `)
    );
  }

  // Execute the exact unpacked payload, without falling back to the host PATH.
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'translator-media-smoke-')
  );
  try {
    const videoPath = path.join(tempDir, 'smoke.mp4');
    run(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=64x64:rate=5',
      '-t',
      '0.4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      videoPath,
    ]);
    const metadata = JSON.parse(
      run(ffprobe, [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        videoPath,
      ])
    );
    const video = metadata.streams.find(
      stream => stream.codec_type === 'video'
    );
    assert.equal(video?.codec_name, 'h264');
    assert.equal(video.width, 64);
    assert.equal(video.height, 64);
    assert.ok(
      Number(metadata.format.duration) > 0,
      'encoded video has no duration'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log(
    'Packaged Windows FFmpeg/FFprobe passed x64, launch, encode and probe checks.'
  );
}

module.exports = { assertWindowsX64Executable, verifyWindowsMedia };

if (require.main === module) {
  try {
    verifyWindowsMedia(process.argv[2] || 'dist/win-unpacked');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
