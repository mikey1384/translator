#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const mode = process.argv[2] || '--check';

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Package version must be SemVer, received ${version}`);
}
if (!['--check', '--write'].includes(mode)) {
  throw new Error('Usage: node scripts/update-distribution-manifests.mjs [--check|--write]');
}

async function fetchOk(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'stage5-translator-distribution-validator',
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${url} returned ${response.status}`);
  }
  return response;
}

const release = await (
  await fetchOk(
    `https://api.github.com/repos/mikey1384/translator/releases/tags/v${version}`,
  )
).json();

function releaseDigest(name) {
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) throw new Error(`GitHub release is missing ${name}`);
  const match = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '');
  if (!match) throw new Error(`GitHub release has no SHA256 digest for ${name}`);
  return match[1].toLowerCase();
}

const macArmName = `Translator-${version}-darwin-arm64.zip`;
const macIntelName = `Translator-${version}-darwin-x64.zip`;
const macArmSha256 = releaseDigest(macArmName);
const macIntelSha256 = releaseDigest(macIntelName);
const windowsName = `Translator-Setup-${version}.exe`;
const windowsSha256 = releaseDigest(windowsName).toUpperCase();
const windowsUrl =
  `https://github.com/mikey1384/translator/releases/download/v${version}/` +
  windowsName;

const immutableUrls = [
  `https://github.com/mikey1384/translator/releases/download/v${version}/${macArmName}`,
  `https://github.com/mikey1384/translator/releases/download/v${version}/${macIntelName}`,
  windowsUrl,
];
await Promise.all(immutableUrls.map((url) => fetchOk(url, { method: 'HEAD' })));

const cask = `cask "stage5-translator" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${macArmSha256}",
         intel: "${macIntelSha256}"

  url "https://github.com/mikey1384/translator/releases/download/v#{version}/Translator-#{version}-darwin-#{arch}.zip",
      verified: "github.com/mikey1384/translator/"
  name "Translator"
  desc "Video discovery, subtitle translation, editing, dubbing, and export workstation"
  homepage "https://translator.tools/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :monterey

  app "Translator.app"
end
`;

const wingetVersion = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.12.0.schema.json
# Created from publisher-owned immutable artifacts by scripts/update-distribution-manifests.mjs
PackageIdentifier: Stage5Tools.Translator
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.12.0
`;

const wingetInstaller = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.12.0.schema.json
# Created from publisher-owned immutable artifacts by scripts/update-distribution-manifests.mjs
PackageIdentifier: Stage5Tools.Translator
PackageVersion: ${version}
InstallerType: nullsoft
Scope: machine
InstallModes:
  - interactive
  - silent
  - silentWithProgress
InstallerSwitches:
  Silent: /S
  SilentWithProgress: /S
UpgradeBehavior: install
ElevationRequirement: elevatesSelf
FileExtensions:
  - avi
  - mkv
  - mov
  - mp4
  - webm
Installers:
  - Architecture: x64
    InstallerUrl: ${windowsUrl}
    InstallerSha256: ${windowsSha256}
    AppsAndFeaturesEntries:
      - DisplayName: Translator
        Publisher: Mikey Lee
        InstallerType: nullsoft
ManifestType: installer
ManifestVersion: 1.12.0
`;

const wingetLocale = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.12.0.schema.json
# Created from publisher-owned immutable artifacts by scripts/update-distribution-manifests.mjs
PackageIdentifier: Stage5Tools.Translator
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Mikey Lee
PublisherUrl: https://stage5.tools/
PublisherSupportUrl: https://github.com/mikey1384/translator/issues
PrivacyUrl: https://translator.tools/privacy
Author: Stage5 Tools LLC
PackageName: Translator
PackageUrl: https://translator.tools/
License: MIT
LicenseUrl: https://github.com/mikey1384/translator/blob/v${version}/LICENSE
Copyright: Copyright (c) 2025 Mikey Lee
ShortDescription: Open-source desktop workstation for finding videos, translating and editing subtitles, dubbing, and export.
Description: Translator keeps video discovery, downloads, transcription, subtitle translation and review, styling, dubbing, and export together in a multi-tab desktop workspace.
Moniker: translator
Tags:
  - captions
  - dubbing
  - subtitles
  - transcription
  - translation
  - video
ReleaseNotesUrl: https://github.com/mikey1384/translator/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: 1.12.0
`;

const files = new Map([
  ['distribution/homebrew/stage5-translator.rb', cask],
  [
    `distribution/winget/manifests/s/Stage5Tools/Translator/${version}/Stage5Tools.Translator.yaml`,
    wingetVersion,
  ],
  [
    `distribution/winget/manifests/s/Stage5Tools/Translator/${version}/Stage5Tools.Translator.installer.yaml`,
    wingetInstaller,
  ],
  [
    `distribution/winget/manifests/s/Stage5Tools/Translator/${version}/Stage5Tools.Translator.locale.en-US.yaml`,
    wingetLocale,
  ],
]);

if (mode === '--write') {
  for (const [relativePath, contents] of files) {
    const path = resolve(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
} else {
  const mismatches = [];
  for (const [relativePath, expected] of files) {
    let actual = '';
    try {
      actual = await readFile(resolve(root, relativePath), 'utf8');
    } catch {
      mismatches.push(`${relativePath} is missing`);
      continue;
    }
    if (actual !== expected) mismatches.push(`${relativePath} is stale`);
  }
  if (mismatches.length) {
    throw new Error(`${mismatches.join('; ')}. Run npm run distribution:update.`);
  }
}

console.log(
  JSON.stringify(
    {
      mode,
      version,
      release: release.html_url,
      homebrew: {
        arm64Sha256: macArmSha256,
        x64Sha256: macIntelSha256,
      },
      winget: {
        installerUrl: windowsUrl,
        installerSha256: windowsSha256,
        silentSwitch: '/S',
        smokeTestRequiredBeforeSubmission: true,
      },
      immutableUrlsVerified: immutableUrls.length,
    },
    null,
    2,
  ),
);
