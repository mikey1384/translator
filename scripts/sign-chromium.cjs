// scripts/sign-chromium.cjs
const { execaSync } = require('execa');
const path = require('path');
const fs = require('fs');

module.exports = async ({ appOutDir, packager }) => {
  const platformName = packager.platform.nodeName;
  const platformOptions = packager.platformSpecificBuildOptions;

  if (platformName === 'win32') {
    // electron-builder signs executables discovered while recursively copying
    // directories, but its single-file extraResources copy path bypasses that
    // transformer. Sign the copied supervisor through the builder's own queue so
    // it uses the exact certificate, timestamp, retry, and force-signing policy
    // configured for the enclosing Windows package.
    if (
      platformOptions.signExecutable === false ||
      platformOptions.signAndEditExecutable === false
    ) {
      console.log(
        '[sign-chromium] Windows code signing disabled – leaving the owner supervisor unsigned'
      );
      return;
    }

    const supervisorPath = path.join(
      appOutDir,
      'resources',
      'translator-owner-supervisor.exe'
    );
    if (!fs.existsSync(supervisorPath)) {
      throw new Error(
        `[sign-chromium] Windows owner supervisor is missing: ${supervisorPath}`
      );
    }
    if (typeof packager.signIf !== 'function') {
      throw new Error(
        '[sign-chromium] electron-builder Windows signing API is unavailable'
      );
    }

    console.log(`[sign-chromium] signing ${supervisorPath}`);
    const signed = await packager.signIf(supervisorPath);
    if (signed !== true) {
      throw new Error(
        `[sign-chromium] failed to sign Windows owner supervisor: ${supervisorPath}`
      );
    }
    console.log(`[sign-chromium] successfully signed ${supervisorPath}`);
    return;
  }

  if (platformName !== 'darwin') {
    console.log(
      `[sign-chromium] no packaged binary signing required for ${platformName}`
    );
    return;
  }

  const id = platformOptions.identity;

  // electron-builder supports identity=null for unsigned directory builds.
  // Its CLI override may reach hooks as either null or the literal "null";
  // neither is a certificate name. Leave vendored binaries untouched when
  // the enclosing app is intentionally not being signed.
  if (id == null || id === false || id === '' || id === 'null') {
    console.log(
      '[sign-chromium] code signing disabled – leaving vendored binaries unsigned'
    );
    return;
  }

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
