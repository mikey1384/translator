#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  await readFile(resolve(root, 'package.json'), 'utf8')
);
const usage =
  'Usage: node scripts/update-distribution-manifests.mjs [--check|--write] [--version <semver>] [--winget-only]';
let version = packageJson.version;
let mode = '--check';
let modeWasSet = false;
let wingetOnly = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (['--check', '--write'].includes(argument)) {
    if (modeWasSet && mode !== argument) throw new Error(usage);
    mode = argument;
    modeWasSet = true;
  } else if (argument === '--version') {
    version = process.argv[index + 1];
    index += 1;
  } else if (argument === '--winget-only') {
    wingetOnly = true;
  } else {
    throw new Error(usage);
  }
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Package version must be SemVer, received ${version}`);
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
    throw new Error(
      `${init.method || 'GET'} ${url} returned ${response.status}`
    );
  }
  return response;
}

const release = await (
  await fetchOk(
    `https://api.github.com/repos/mikey1384/translator/releases/tags/v${version}`
  )
).json();

function releaseAsset(name) {
  const asset = release.assets.find(candidate => candidate.name === name);
  if (!asset) throw new Error(`GitHub release is missing ${name}`);
  const match = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '');
  if (!match)
    throw new Error(`GitHub release has no SHA256 digest for ${name}`);
  const expectedUrl =
    `https://github.com/mikey1384/translator/releases/download/v${version}/` +
    name;
  if (asset.browser_download_url !== expectedUrl) {
    throw new Error(
      `Unexpected GitHub release URL for ${name}: ${asset.browser_download_url}`
    );
  }
  return {
    sha256: match[1].toLowerCase(),
    url: asset.browser_download_url,
  };
}

let macArmAsset;
let macIntelAsset;
let macArmSha256;
let macIntelSha256;
if (!wingetOnly) {
  const macArmName = `Translator-${version}-darwin-arm64.zip`;
  const macIntelName = `Translator-${version}-darwin-x64.zip`;
  macArmAsset = releaseAsset(macArmName);
  macIntelAsset = releaseAsset(macIntelName);
  macArmSha256 = macArmAsset.sha256;
  macIntelSha256 = macIntelAsset.sha256;
}

const legacyWingetAssets = new Map([
  [
    '1.16.6',
    {
      name: 'Translator-x64.exe',
      url: 'https://downloads.stage5.tools/win/1.16.6/Translator-x64.exe',
      sha256:
        'B7BE49BAD34BE5DE7A0474F13C4F4446EBF282B6A72D244AEB5197BE23A17610',
    },
  ],
]);

const legacyWingetAsset = legacyWingetAssets.get(version);
let windowsUrl;
let windowsSha256;
if (legacyWingetAsset) {
  windowsUrl = legacyWingetAsset.url;
  windowsSha256 = legacyWingetAsset.sha256;
  const checksum = (
    await (await fetchOk(`${windowsUrl}.sha256`)).text()
  ).trim();
  const checksumMatch = /^([a-f0-9]{64})(?:\s+\*?(.+))?$/i.exec(checksum);
  if (
    !checksumMatch ||
    checksumMatch[1].toUpperCase() !== windowsSha256 ||
    (checksumMatch[2] && checksumMatch[2] !== legacyWingetAsset.name)
  ) {
    throw new Error(`Published SHA256 sidecar does not match ${windowsUrl}`);
  }
} else {
  const windowsName = `Translator-Setup-${version}.exe`;
  const windowsAsset = releaseAsset(windowsName);
  windowsUrl = windowsAsset.url;
  windowsSha256 = windowsAsset.sha256.toUpperCase();
}
const productCode = '3934dcbd-1ef6-5ce0-b182-24803d0fbb8d';
const releaseDate = release.published_at?.slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate || '')) {
  throw new Error(
    `GitHub release has no valid published_at date: ${release.published_at}`
  );
}

const immutableUrls = [
  ...(wingetOnly ? [] : [macArmAsset.url, macIntelAsset.url]),
  windowsUrl,
];
await Promise.all(
  immutableUrls.map(url =>
    fetchOk(url, {
      method: 'HEAD',
      ...(url === legacyWingetAsset?.url ? { redirect: 'manual' } : {}),
    })
  )
);

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
InstallerLocale: en-US
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
ElevationRequirement: elevationRequired
FileExtensions:
  - avi
  - mkv
  - mov
  - mp4
  - webm
Protocols:
  - stage5-translator
ProductCode: ${productCode}
ReleaseDate: ${releaseDate}
AppsAndFeaturesEntries:
  - DisplayName: Translator
    Publisher: Mikey Lee
    ProductCode: ${productCode}
InstallationMetadata:
  DefaultInstallLocation: '%ProgramFiles%\\Video Tools\\Translator'
Installers:
  - Architecture: x64
    InstallerUrl: ${windowsUrl}
    InstallerSha256: ${windowsSha256}
ManifestType: installer
ManifestVersion: 1.12.0
`;

const wingetLocale = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.12.0.schema.json
# Created from publisher-owned immutable artifacts by scripts/update-distribution-manifests.mjs
PackageIdentifier: Stage5Tools.Translator
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Stage5 Tools LLC
PublisherUrl: https://stage5.tools/
PublisherSupportUrl: https://github.com/mikey1384/translator/issues
PrivacyUrl: https://translator.tools/privacy
Author: Mikey Lee
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
  ...(wingetOnly ? [] : [['distribution/homebrew/stage5-translator.rb', cask]]),
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
    throw new Error(
      `${mismatches.join('; ')}. Run npm run distribution:update.`
    );
  }
}

console.log(
  JSON.stringify(
    {
      mode,
      version,
      wingetOnly,
      release: release.html_url,
      ...(wingetOnly
        ? {}
        : {
            homebrew: {
              arm64Sha256: macArmSha256,
              x64Sha256: macIntelSha256,
            },
          }),
      winget: {
        installerUrl: windowsUrl,
        installerSha256: windowsSha256,
        silentSwitch: '/S',
        smokeTestRequiredBeforeSubmission: true,
      },
      immutableUrlsVerified: immutableUrls.length,
    },
    null,
    2
  )
);
