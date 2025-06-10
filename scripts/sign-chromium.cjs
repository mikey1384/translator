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

  for (const headlessDir of headlessDirectories) {
    if (!fs.existsSync(headlessDir)) {
      console.log(`[sign-chromium] ${headlessDir} not found – skipping`);
      continue;
    }

    const headlessShellPath = path.join(headlessDir, 'headless_shell');
    if (!fs.existsSync(headlessShellPath)) {
      console.log(
        `[sign-chromium] headless_shell not found in ${headlessDir} – skipping`
      );
      continue;
    }

    console.log(`[sign-chromium] signing ${headlessShellPath}`);

    try {
      // 1) Remove any existing signature
      execaSync('codesign', ['--remove-signature', headlessShellPath]);
    } catch {}

    // 2) Ensure executable bit
    fs.chmodSync(headlessShellPath, 0o755);

    // 3) Sign with hardened runtime
    const args = [
      '--force',
      '--sign',
      id,
      '--timestamp',
      '--options',
      'runtime',
      headlessShellPath,
    ];

    try {
      execaSync('codesign', args, { stdio: 'inherit' });
      console.log(`[sign-chromium] successfully signed ${headlessShellPath}`);
    } catch (e) {
      console.error(`[sign-chromium] FAILED: ${headlessShellPath}`);
      throw e; // abort build—safer than continuing
    }
  }

  console.log('[sign-chromium] complete');
};
