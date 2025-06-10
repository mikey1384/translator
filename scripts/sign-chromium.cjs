// scripts/sign-chromium.js
const { execaSync } = require('execa');
const path = require('path');
const fs = require('fs');

module.exports = async ({ appOutDir, packager }) => {
  const id = packager.platformSpecificBuildOptions.identity;
  const ent = packager.platformSpecificBuildOptions.entitlements;

  // Sign vendored headless_shell binaries
  const resourcesPath = path.join(
    appOutDir,
    'Translator.app',
    'Contents',
    'Resources'
  );

  const headlessDirectories = [
    path.join(resourcesPath, 'headless-arm64'),
    path.join(resourcesPath, 'headless-x64'),
  ];

  console.log('[sign-chromium] signing vendored headless_shell binaries');

  function signBinary(binaryPath) {
    console.log(`[sign-chromium] signing ${binaryPath}`);

    try {
      // 1) Remove any existing signature
      execaSync('codesign', ['--remove-signature', binaryPath]);
    } catch {}

    // 2) Ensure executable bit
    fs.chmodSync(binaryPath, 0o755);

    // 3) Sign with hardened runtime
    const args = [
      '--force',
      '--sign',
      id,
      '--timestamp',
      '--options',
      'runtime',
      binaryPath,
    ];

    try {
      execaSync('codesign', args, { stdio: 'inherit' });
      console.log(`[sign-chromium] successfully signed ${binaryPath}`);
    } catch (e) {
      console.error(`[sign-chromium] FAILED: ${binaryPath}`);
      throw e; // abort build—safer than continuing
    }
  }

  function walkAndSign(dir) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        const stat = fs.lstatSync(fullPath);

        if (stat.isDirectory()) {
          walkAndSign(fullPath);
        } else if (
          entry === 'chrome-headless-shell' ||
          entry === 'headless_shell'
        ) {
          signBinary(fullPath);
        }
      }
    } catch (error) {
      console.log(`[sign-chromium] Error walking ${dir}: ${error.message}`);
    }
  }

  for (const headlessDir of headlessDirectories) {
    if (!fs.existsSync(headlessDir)) {
      console.log(`[sign-chromium] ${headlessDir} not found – skipping`);
      continue;
    }

    console.log(`[sign-chromium] walking ${headlessDir} for binaries to sign`);
    walkAndSign(headlessDir);
  }

  console.log('[sign-chromium] complete');
};
