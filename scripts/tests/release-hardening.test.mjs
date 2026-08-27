import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BrowserPlatform } from '@puppeteer/browsers';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/lib/puppeteer/revisions.js';
import yaml from 'yaml';

const { parse: parseYaml } = yaml;
import { requiresExecutablePermission } from '../install-pinned-headless-chrome.mjs';
import {
  isDirectInvocation,
  resolvePuppeteerHeadlessRevision,
} from '../resolve-puppeteer-headless-revision.mjs';

const require = createRequire(import.meta.url);
const { doMergeConfigs } = require('app-builder-lib/out/util/config/config.js');
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = relativePath =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const readJson = relativePath => JSON.parse(read(relativePath));

test('packaged apps carry each platform resource exactly once', () => {
  const base = readJson('electron-builder.base.json');
  const x64 = readJson('electron-builder.x64.json');
  const win = readJson('electron-builder.win.json');

  assert.equal(
    base.directories.app,
    undefined,
    'the default project app directory must not be redundantly re-declared'
  );
  const effectiveConfig = child =>
    doMergeConfigs([structuredClone(base), structuredClone(child)]);
  const effectiveResources = (child, platform, arch) => {
    const config = effectiveConfig(child);
    return [
      ...(config.extraResources || []),
      ...(config[platform]?.extraResources || []),
    ].map(entry => ({
      from: entry.from?.replaceAll('${arch}', arch),
      to: entry.to?.replaceAll('${arch}', arch),
    }));
  };
  const assertUniqueDestinations = resources => {
    const destinations = resources.map(entry => entry.to);
    assert.equal(
      new Set(destinations).size,
      destinations.length,
      `duplicate extraResources destinations: ${destinations.join(', ')}`
    );
  };

  const combinedMac = effectiveResources({}, 'mac', 'x64');
  const intelMac = effectiveResources(x64, 'mac', 'x64');
  const windows = effectiveResources(win, 'win', 'x64');
  const intelConfig = effectiveConfig(x64);
  const windowsConfig = effectiveConfig(win);

  assertUniqueDestinations(combinedMac);
  assertUniqueDestinations(intelMac);
  assertUniqueDestinations(windows);
  assert.equal(intelConfig.mac.fileAssociations.length, 1);
  assert.deepEqual(intelConfig.mac.target, [
    { target: 'dmg', arch: ['x64'] },
    { target: 'zip', arch: ['x64'] },
  ]);
  assert.deepEqual(windowsConfig.win.target, [
    { target: 'nsis', arch: ['x64'] },
  ]);
  assert.equal(
    windowsConfig.nsis.artifactName,
    '${productName}-Setup-${version}.${ext}',
    'the physical installer and generic updater metadata must share one URL-safe name'
  );
  assert.deepEqual(windowsConfig.win.publish, [
    {
      provider: 'generic',
      url: 'https://downloads.stage5.tools/win/latest/',
    },
  ]);
  assert.equal(
    windowsConfig.publish,
    undefined,
    'Windows must not inherit the macOS GitHub publisher'
  );

  assert.equal(
    windows.filter(entry => entry.from === 'vendor/headless-x64').length,
    1
  );
  assert.equal(
    windows.filter(
      entry =>
        entry.from ===
        'packages/agent-server/bin/translator-owner-supervisor.exe'
    ).length,
    1
  );
  assert.equal(
    windows.some(
      entry =>
        entry.from === 'packages/agent-server/bin/translator-owner-supervisor'
    ),
    false,
    'Windows must not inherit the Unix owner supervisor'
  );
  assert.equal(
    windows.some(
      entry => entry.from === 'packages/agent-server/bin/translator-mcp'
    ),
    false,
    'Windows must not inherit the Unix launcher'
  );
  assert.equal(
    combinedMac.filter(entry => entry.from === 'vendor/headless-x64').length,
    1
  );
  for (const [platformName, resources] of [
    ['combined macOS', combinedMac],
    ['Intel macOS', intelMac],
    ['Windows', windows],
  ]) {
    assert.equal(
      resources.filter(
        entry =>
          entry.from === 'packages/renderer/dist/assets' &&
          entry.to === 'assets'
      ).length,
      1,
      `${platformName} must ship the renderer font assets exactly once`
    );
  }
  assert.equal(
    combinedMac.some(entry => entry.from?.endsWith('.exe')),
    false,
    'macOS must not inherit Windows executables'
  );

  const verifier = read('scripts/verify-architectures.sh');
  assert.match(verifier, /Unexpected non-target headless browser payload/);
  assert.match(verifier, /verify_macho_arch "\$headless_binary"/);
});

test('packaging installs the lockfile-pinned headless browser revision', () => {
  const workflow = read('.github/workflows/release-mac.yml');
  const installer = read('scripts/install-pinned-headless-chrome.mjs');
  const packageJson = readJson('package.json');

  assert.match(
    packageJson.scripts['package:mac'],
    /install-pinned-headless-chrome\.mjs mac_arm mac/
  );
  assert.match(
    packageJson.scripts['package:arm'],
    /install-pinned-headless-chrome\.mjs mac_arm/
  );
  assert.match(
    packageJson.scripts['package:intel'],
    /install-pinned-headless-chrome\.mjs mac/
  );
  assert.match(installer, /resolvePuppeteerHeadlessRevision\(\)/);
  assert.match(installer, /browser: Browser\.CHROMEHEADLESSSHELL/);
  assert.match(installer, /computeExecutablePath\(\{/);
  assert.match(
    installer,
    /fs\.rm\(target\.cacheDir, \{ recursive: true, force: true \}\)/
  );
  assert.doesNotMatch(workflow, /npx puppeteer@/);
  assert.doesNotMatch(workflow, /chrome-headless-shell@stable/);
});

test('headless revision resolver accepts an absolute Windows drive path', () => {
  const scriptName = 'resolve-puppeteer-headless-revision.mjs';
  const windowsRoot = String.raw`C:\Users\mikey\Developer\translator`;
  const argvPath = path.win32.join(windowsRoot, 'scripts', scriptName);
  const moduleUrl = `file:///C:/Users/mikey/Developer/translator/scripts/${scriptName}`;

  assert.equal(
    isDirectInvocation({
      argvPath,
      moduleUrl,
      platform: 'win32',
      cwd: windowsRoot,
    }),
    true
  );
  assert.equal(
    isDirectInvocation({
      argvPath: argvPath.toUpperCase(),
      moduleUrl,
      platform: 'win32',
      cwd: windowsRoot,
    }),
    true,
    'Windows path comparison must remain case-insensitive'
  );
  assert.equal(
    isDirectInvocation({
      argvPath: path.win32.join(windowsRoot, 'scripts', 'other.mjs'),
      moduleUrl,
      platform: 'win32',
      cwd: windowsRoot,
    }),
    false
  );
});

test('headless revision resolver runs successfully as a CLI', () => {
  const resolver = path.join(
    repoRoot,
    'scripts/resolve-puppeteer-headless-revision.mjs'
  );
  const result = spawnSync(process.execPath, [resolver], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim(), resolvePuppeteerHeadlessRevision());
});

test('headless artifact permissions follow the target rather than the host', () => {
  assert.equal(requiresExecutablePermission(BrowserPlatform.WIN32), false);
  assert.equal(requiresExecutablePermission(BrowserPlatform.WIN64), false);
  assert.equal(requiresExecutablePermission(BrowserPlatform.MAC), true);
  assert.equal(requiresExecutablePermission(BrowserPlatform.MAC_ARM), true);
  assert.equal(requiresExecutablePermission(BrowserPlatform.LINUX), true);
  assert.equal(requiresExecutablePermission(BrowserPlatform.LINUX_ARM), true);
});

test('macOS publication waits for the complete Windows package preflight', () => {
  const workflow = parseYaml(read('.github/workflows/release-mac.yml'));
  const windowsJob = workflow.jobs['windows-preflight'];
  const windowsCommands = windowsJob.steps
    .map(step => step.run)
    .filter(command => typeof command === 'string')
    .join('\n');

  assert.equal(windowsJob['runs-on'], 'windows-2022');
  assert.match(windowsCommands, /npm ci --ignore-scripts/);
  assert.match(windowsCommands, /npm run package:win:preflight/);
  assert.equal(workflow.jobs['mac-build'].needs, 'windows-preflight');
  assert.equal(
    workflow.jobs['mac-build'].if,
    "github.event_name == 'push' && github.ref_type == 'tag'",
    'manual workflow dispatch must never enter the publishing job'
  );
});

test('headless browser installer rejects ambiguous or unsupported targets', () => {
  const installer = path.join(
    repoRoot,
    'scripts/install-pinned-headless-chrome.mjs'
  );
  for (const args of [[], ['unsupported'], ['mac', 'mac'], ['mac', 'win64']]) {
    const result = spawnSync(process.execPath, [installer, ...args], {
      encoding: 'utf8',
    });
    assert.notEqual(
      result.status,
      0,
      `installer unexpectedly accepted ${args}`
    );
  }
});

test('macOS release actions are pinned to immutable revisions', () => {
  const workflow = read('.github/workflows/release-mac.yml');
  const actionUses = [...workflow.matchAll(/^\s*- uses:\s*(\S+)/gm)].map(
    match => match[1]
  );

  assert.ok(actionUses.length > 0);
  for (const action of actionUses) {
    assert.match(
      action,
      /^[^@]+@[a-f0-9]{40}$/,
      `action reference must use a full commit SHA: ${action}`
    );
  }

  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /secrets\.GH_TOKEN/);
});

test('macOS release pins and verifies the privileged AWS CLI installer', () => {
  const workflow = read('.github/workflows/release-mac.yml');

  assert.match(workflow, /AWS_CLI_VERSION="\d+\.\d+\.\d+"/);
  assert.match(workflow, /AWS_CLI_SHA256="[a-f0-9]{64}"/);
  assert.match(workflow, /AWSCLIV2-\$\{AWS_CLI_VERSION\}\.pkg/);
  assert.match(workflow, /shasum -a 256 --check/);
  assert.match(workflow, /aws-cli\/\$\{AWS_CLI_VERSION\}/);
  assert.doesNotMatch(workflow, /AWSCLIV2\.pkg/);
});

test(
  'macOS release shell steps are syntactically valid Bash',
  { skip: process.platform === 'win32' },
  () => {
    const workflow = parseYaml(read('.github/workflows/release-mac.yml'));
    const steps = workflow.jobs['mac-build'].steps;

    for (const step of steps) {
      if (typeof step.run !== 'string') continue;
      const syntax = spawnSync('bash', ['-n'], {
        encoding: 'utf8',
        input: step.run,
      });
      assert.equal(
        syntax.status,
        0,
        `${step.name || step.run}: ${syntax.stderr || syntax.stdout}`
      );
    }
  }
);

test(
  'release cleanup preserves failures on the runner Bash',
  { skip: process.platform === 'win32' },
  () => {
    const helper = path.join(repoRoot, 'scripts/release-shell-cleanup.sh');
    const shell = fs.existsSync('/bin/bash') ? '/bin/bash' : 'bash';
    const cleanupRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'translator-release-cleanup-')
    );
    const cleanupTarget = path.join(cleanupRoot, 'temporary');
    fs.writeFileSync(cleanupTarget, 'temporary');

    const nounsetFailure = spawnSync(
      shell,
      [
        '-c',
        `set -euo pipefail
. "$1"
cleanup_target="$2"
cleanup_test_file() { rm -f "$cleanup_target"; }
RELEASE_STEP_COMPLETED=false
trap 'release_cleanup_and_exit "$?" "\${RELEASE_STEP_COMPLETED:-false}" cleanup_test_file' EXIT
unset missing_release_value
printf '%s\\n' "$missing_release_value"
`,
        'release-cleanup-test',
        helper,
        cleanupTarget,
      ],
      { encoding: 'utf8' }
    );

    assert.equal(nounsetFailure.status, 1, nounsetFailure.stderr);
    assert.equal(fs.existsSync(cleanupTarget), false);

    const cleanupFailure = spawnSync(
      shell,
      [
        '-c',
        `set -euo pipefail
. "$1"
RELEASE_STEP_COMPLETED=true
trap 'release_cleanup_and_exit "$?" "\${RELEASE_STEP_COMPLETED:-false}" false' EXIT
true
`,
        'release-cleanup-test',
        helper,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(cleanupFailure.status, 1, cleanupFailure.stderr);

    const originalFailure = spawnSync(
      shell,
      [
        '-c',
        `set -euo pipefail
. "$1"
RELEASE_STEP_COMPLETED=false
trap 'release_cleanup_and_exit "$?" "\${RELEASE_STEP_COMPLETED:-false}" false' EXIT
exit 23
`,
        'release-cleanup-test',
        helper,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(originalFailure.status, 23, originalFailure.stderr);

    const fatalCleanup = spawnSync(
      shell,
      [
        '-c',
        `set -euo pipefail
. "$1"
RELEASE_STEP_COMPLETED=false
cleanup_with_nounset() {
  unset missing_cleanup_value
  printf '%s\\n' "$missing_cleanup_value"
}
trap 'release_cleanup_and_exit "$?" "\${RELEASE_STEP_COMPLETED:-false}" cleanup_with_nounset' EXIT
exit 23
`,
        'release-cleanup-test',
        helper,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(fatalCleanup.status, 23, fatalCleanup.stderr);

    fs.rmSync(cleanupRoot, { recursive: true, force: true });
  }
);

test('macOS R2 promotion cannot mask an absent retention record', () => {
  const workflow = parseYaml(read('.github/workflows/release-mac.yml'));
  const steps = workflow.jobs['mac-build'].steps;
  const promotion = steps.find(
    step => step.name === 'Promote artefacts to latest/'
  );
  const publication = steps.find(
    step => step.name === 'Publish GitHub Release'
  );
  const upload = read('scripts/upload-github-mac-release-assets.sh');

  assert.ok(promotion);
  assert.ok(publication);
  assert.doesNotMatch(promotion.run, /retention_args/);
  assert.match(
    promotion.run,
    /else\s+node scripts\/release-storage-policy\.mjs prepare-retention/
  );
  assert.match(promotion.run, /release_cleanup_and_exit/);
  assert.match(promotion.run, /RELEASE_STEP_COMPLETED=true\s*$/);
  assert.match(publication.run, /release_cleanup_and_exit/);
  assert.match(publication.run, /RELEASE_STEP_COMPLETED=true\s*$/);
  assert.equal(publication.if, "github.ref_type == 'tag' && success()");
  assert.match(upload, /release_cleanup_and_exit/);
  assert.match(upload, /RELEASE_STEP_COMPLETED=true\s*$/);
  assert.doesNotMatch(
    `${promotion.run}\n${publication.run}\n${upload}`,
    /trap\s+['"]rm\s+-[fr]+[^\n]*EXIT/
  );
});

test('Windows headless download cannot report success with stale output', () => {
  const script = read('scripts/download-headless-win.bat');
  const installer = read('scripts/install-pinned-headless-chrome.mjs');

  assert.match(
    script,
    /node scripts\\install-pinned-headless-chrome\.mjs win64/i
  );
  assert.match(installer, /fs\.rm\(target\.cacheDir/);
  assert.match(
    installer,
    /await validateExecutable\(expectedExecutable, target\.platform\)/
  );
  assert.doesNotMatch(script, /\bnpx\b/i);
  assert.doesNotMatch(script, /copy \/y/i);
  assert.doesNotMatch(script, /chrome-headless-shell@stable/i);
  assert.match(script, /if errorlevel 1 exit \/b !errorlevel!/i);
  assert.equal(
    resolvePuppeteerHeadlessRevision(),
    PUPPETEER_REVISIONS['chrome-headless-shell']
  );
});

test('Windows release wrappers propagate package and upload failures', () => {
  const batch = read('Release-Windows-OneClick.bat');
  const release = read('scripts/release-windows-oneclick.ps1');
  const upload = read('scripts/upload-to-r2-win.ps1');
  const purge = read('scripts/purge-cloudflare-cache.ps1');
  const identity = read('scripts/assert-windows-release-identity.ps1');
  const worktreeTest = read('scripts/test-windows-release-worktree.ps1');
  const gitAttributes = read('.gitattributes');
  const packageJson = readJson('package.json');
  const preflight = read('scripts/package-windows-preflight.bat');
  const preflightConfig = readJson('electron-builder.win.preflight.json');
  const packageTest = read('scripts/test-windows-package.bat');
  const updaterTest = read('scripts/test-windows-updater-metadata.ps1');
  const distribution = read('scripts/update-distribution-manifests.mjs');
  const artifacts = read('scripts/windows-release-artifacts.ps1');
  const legacyBatch = read('Inform-Windows-Legacy-Users.bat');
  const legacyRelease = read('scripts/inform-windows-legacy.ps1');
  const githubBridge = read('scripts/bridge-windows-to-github.ps1');
  const baseConfig = readJson('electron-builder.base.json');
  const winConfig = readJson('electron-builder.win.json');
  const effectivePreflightConfig = doMergeConfigs([
    structuredClone(baseConfig),
    structuredClone(winConfig),
    structuredClone(preflightConfig),
  ]);

  assert.match(batch, /set "RELEASE_EXIT=%ERRORLEVEL%"/i);
  assert.match(batch, /endlocal & exit \/b %RELEASE_EXIT%/i);
  assert.match(legacyBatch, /set "LEGACY_RELEASE_EXIT=%ERRORLEVEL%"/i);
  assert.match(legacyBatch, /inform-windows-legacy\.ps1" -NoPause/i);
  assert.match(legacyBatch, /endlocal & exit \/b %LEGACY_RELEASE_EXIT%/i);
  assert.match(release, /npm run package:win failed with exit code/);
  assert.match(
    packageJson.scripts['package:win'],
    /npm run build:owner-supervisor/
  );
  assert.match(preflight, /npm run download:headless-win/i);
  assert.match(preflight, /npm run build:owner-supervisor/i);
  assert.match(preflight, /npm run test:release/i);
  assert.match(preflight, /electron-builder\.win\.preflight\.json/i);
  assert.match(
    preflight,
    /test-windows-package\.bat --no-launch --allow-unsigned/i
  );
  assert.match(preflight, /test-windows-updater-metadata\.ps1/i);
  assert.match(preflight, /test-windows-release-worktree\.ps1/i);
  assert.equal(preflightConfig.forceCodeSigning, false);
  assert.equal(preflightConfig.win.target, undefined);
  assert.deepEqual(effectivePreflightConfig.win.target, [
    { target: 'nsis', arch: ['x64'] },
  ]);
  assert.equal(preflightConfig.win.signExecutable, false);
  assert.equal(preflightConfig.win.signtoolOptions, null);
  assert.equal(
    winConfig.nsis.artifactName,
    '${productName}-Setup-${version}.${ext}'
  );
  assert.match(packageTest, /Unknown argument/i);
  assert.match(packageTest, /REQUIRE_SIGNATURES/);
  assert.match(release, /exit \$exitCode/);
  assert.match(artifacts, /Get-AuthenticodeSignature/);
  assert.match(artifacts, /System\.Security\.Cryptography\.SHA256/);
  assert.match(release, /Assert-WindowsInstallerSignature/);
  assert.match(release, /test-windows-package\.bat --no-launch/i);
  assert.match(release, /Ensure-Tool -tool 'gh'/);
  assert.match(release, /gh auth status/);
  assert.match(release, /bridge-windows-to-github\.ps1/);
  assert.ok(
    release.indexOf("Write-Stage 'Archiving verified artifacts on GitHub'") >
      release.indexOf("Write-Stage 'Uploading to Cloudflare R2'"),
    'Windows metadata must be finalized before the exact files are archived'
  );
  assert.ok(
    release.indexOf("Write-Stage 'Archiving verified artifacts on GitHub'") <
      release.indexOf("Write-Stage 'Purging Cloudflare cache'"),
    'the immutable GitHub archive must be verified before cache purge completes the release'
  );
  assert.match(upload, /Assert-WindowsUpdaterMetadataMatchesInstaller/);
  assert.match(purge, /Get-WindowsInstallerFileName -Version \$ver/);
  assert.match(updaterTest, /Assert-WindowsUpdaterMetadataMatchesInstaller/);
  assert.match(artifacts, /latest\.yml sha512 mismatch/);
  assert.match(artifacts, /latest\.yml top-level sha512 mismatch/);
  assert.match(artifacts, /if \(\$sizeFields\.Count -eq 1\)/);
  assert.doesNotMatch(artifacts, /-replace ' ', '-'/);
  assert.doesNotMatch(upload, /-replace ' ', '-'/);
  assert.doesNotMatch(release, /-replace ' ', '-'/);
  assert.match(artifacts, /Translator-Setup-\$Version\.exe/);
  assert.match(legacyRelease, /bridge-windows-to-github\.ps1/);
  assert.match(legacyRelease, /& \$bridgeScript -Repo \$Repo/);
  assert.doesNotMatch(legacyRelease, /gh release (?:create|upload)/);
  assert.match(legacyRelease, /exit \$exitCode/);
  assert.match(githubBridge, /Assert-WindowsReleaseIdentity/);
  assert.match(githubBridge, /Assert-WindowsInstallerSignature/);
  assert.match(githubBridge, /Enter-WindowsReleaseMutex/);
  assert.match(githubBridge, /Exit-WindowsReleaseMutex/);
  assert.match(githubBridge, /releases\?per_page=100&page=\$page/);
  assert.match(
    githubBridge,
    /\[string\]\$candidate\.tag_name -ceq \$ReleaseTag/
  );
  assert.doesNotMatch(githubBridge, /--jq/);
  assert.doesNotMatch(githubBridge, /@base64/);
  assert.doesNotMatch(githubBridge, /--paginate/);
  assert.doesNotMatch(githubBridge, /'--slurp'/);
  assert.match(githubBridge, /\$tag = "v\$ver"/);
  assert.doesNotMatch(githubBridge, /TagSuffix/);
  assert.match(githubBridge, /Assert-CanonicalReleaseAssets/);
  assert.match(githubBridge, /Get-RequiredMacAssetNames/);
  assert.match(githubBridge, /latest-mac\.yml/);
  assert.match(githubBridge, /\.published_at/);
  assert.match(githubBridge, /\.digest/);
  assert.match(githubBridge, /\.state/);
  assert.match(githubBridge, /Assert-RemoteTagCommit/);
  assert.match(githubBridge, /Assert-ReleaseIsLatest/);
  assert.doesNotMatch(githubBridge, /make_latest/);
  assert.doesNotMatch(githubBridge, /'PATCH'/);
  assert.doesNotMatch(githubBridge, /'POST'/);
  assert.ok(
    githubBridge.indexOf('Uploading missing immutable Windows payloads') <
      githubBridge.indexOf('Uploading latest.yml as the final Windows pointer'),
    'legacy Windows payloads must upload before their public manifest'
  );
  assert.match(githubBridge, /\$LASTEXITCODE -ne 0/);
  assert.doesNotMatch(legacyRelease, /--clobber/);
  assert.doesNotMatch(githubBridge, /--clobber/);
  assert.match(release, /Assert-WindowsReleaseIdentity -Version \$version/);
  assert.match(upload, /Assert-WindowsReleaseIdentity -Version \$Version/);
  assert.match(identity, /Release tag \$tag points to/);
  assert.match(identity, /'diff', '--cached'/);
  assert.match(identity, /'diff', '--no-ext-diff'/);
  assert.match(identity, /'ls-files', '--others', '--exclude-standard'/);
  assert.doesNotMatch(identity, /git status --porcelain/);
  assert.match(identity, /staged: \$line/);
  assert.match(identity, /unstaged: \$line/);
  assert.match(identity, /untracked: \$line/);
  assert.match(identity, /Use a clean release checkout/);
  assert.match(worktreeTest, /Assert-WindowsReleaseWorktree/);
  assert.match(gitAttributes, /^\/render-host-script\.js text eol=lf$/m);
  assert.match(identity, /System\.Threading\.Mutex/);
  assert.match(
    identity,
    /Another Windows release transaction is already running/
  );
  assert.match(release, /Enter-WindowsReleaseMutex/);
  assert.match(upload, /Enter-WindowsReleaseMutex/);
  assert.match(upload, /\[Guid\]::NewGuid\(\)/);
  assert.match(upload, /Exit-WindowsReleaseMutex -Mutex \$releaseMutex/);
  assert.match(upload, /Assert-RemoteMatchesLocal/);
  assert.match(upload, /Remote SHA256 mismatch/);
  assert.doesNotMatch(upload, /exit code \$LASTEXITCODE:/);
  assert.match(upload, /refs\/tags\/\$\{tag\}:refs\/tags\/\$\{tag\}/);
  assert.doesNotMatch(upload, /Invoke-RcloneCopyImmutable/);
  assert.doesNotMatch(upload, /\$BucketBase\/\$Version/);
  assert.doesNotMatch(upload, /destUpdaterVersion/);
  assert.doesNotMatch(upload, /destVersion/);
  assert.doesNotMatch(upload, /destVersionYaml/);
  assert.doesNotMatch(upload, /destBlockmapVersion/);
  assert.match(
    upload,
    /Invoke-RcloneCopyAlways -from \$latestYaml -to \$destLatestYaml/
  );
  assert.doesNotMatch(upload, /--size-only/);
  assert.match(
    upload,
    /\$blockmapFileName = "\$updaterInstallerName\.blockmap"/
  );
  assert.ok(
    upload.lastIndexOf(
      'Invoke-RcloneCopyAlways -from $latestYaml -to $destLatestYaml'
    ) >
      upload.indexOf(
        'Invoke-RcloneCopyTo -from $blockmap -to $destBlockmapLatest'
      ),
    'Windows latest.yml must be uploaded after every optional updater payload'
  );
  assert.equal(
    (upload.match(/rclone .*failed with exit code/g) || []).length,
    3,
    'every rclone upload mode must turn native failures into terminating errors'
  );
  assert.match(upload, /release-storage-policy\.mjs/);
  assert.match(upload, /prepare-retention/);
  assert.match(upload, /release-retention\.json/);
  assert.match(upload, /--retention \$retentionStatePath/);
  assert.match(upload, /Remove-StaleLatestObjects/);
  assert.match(
    distribution,
    /github\.com\/mikey1384\/translator\/releases\/download\/v\$\{version\}/
  );
  assert.doesNotMatch(
    distribution,
    /downloads\.stage5\.tools\/win\/\$\{version\}/
  );
  assert.ok(
    upload.lastIndexOf('Remove-StaleLatestObjects') >
      upload.lastIndexOf(
        'Invoke-RcloneCopyAlways -from $latestYaml -to $destLatestYaml'
      ),
    'stale Windows payloads must be pruned only after the new manifest is verified'
  );
});

test(
  'Windows release PowerShell scripts parse before packaging',
  { skip: process.platform !== 'win32' },
  () => {
    for (const relativePath of [
      'scripts/windows-release-artifacts.ps1',
      'scripts/assert-windows-release-identity.ps1',
      'scripts/test-windows-release-worktree.ps1',
      'scripts/test-windows-updater-metadata.ps1',
      'scripts/release-windows-oneclick.ps1',
      'scripts/upload-to-r2-win.ps1',
      'scripts/purge-cloudflare-cache.ps1',
      'scripts/bridge-windows-to-github.ps1',
      'scripts/inform-windows-legacy.ps1',
    ]) {
      const scriptPath = path.join(repoRoot, relativePath);
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          [
            '$tokens = $null',
            '$errors = $null',
            `[void][System.Management.Automation.Language.Parser]::ParseFile('${scriptPath.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)`,
            'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }',
          ].join('; '),
        ],
        { encoding: 'utf8' }
      );
      assert.equal(
        result.status,
        0,
        `${relativePath}: ${result.stderr || result.stdout}`
      );
    }
  }
);

test(
  'Windows release worktree check accepts normalized line endings and reports real drift',
  { skip: process.platform !== 'win32' },
  () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'translator-windows-release-worktree-')
    );
    const fixtureRepo = path.join(tempRoot, 'repo');
    const generatedPath = path.join(fixtureRepo, 'generated.js');
    const untrackedPath = path.join(fixtureRepo, 'local-notes.txt');
    const helperPath = path
      .join(repoRoot, 'scripts/assert-windows-release-identity.ps1')
      .replaceAll("'", "''");
    const psRepo = fixtureRepo.replaceAll("'", "''");
    const git = (...args) => {
      const result = spawnSync('git', args, {
        cwd: fixtureRepo,
        encoding: 'utf8',
      });
      assert.equal(
        result.status,
        0,
        `git ${args.join(' ')}: ${result.stderr || result.stdout}`
      );
    };
    const assertWorktree = () =>
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          [
            "$ErrorActionPreference = 'Stop'",
            `. '${helperPath}'`,
            `Assert-WindowsReleaseWorktree -ExpectedCommit 'HEAD' -RepoRoot '${psRepo}'`,
          ].join('; '),
        ],
        { encoding: 'utf8' }
      );
    const combinedOutput = result =>
      `${result.stdout || ''}\n${result.stderr || ''}`;

    try {
      fs.mkdirSync(fixtureRepo);
      git('init');
      git('config', 'user.name', 'Translator Release Test');
      git('config', 'user.email', 'release-test@stage5.tools');
      git('config', 'core.autocrlf', 'true');
      fs.writeFileSync(generatedPath, 'const value = 1;\n');
      git('add', 'generated.js');
      git('commit', '-m', 'fixture');

      fs.rmSync(generatedPath);
      git('restore', '--source=HEAD', '--worktree', '--', 'generated.js');
      assert.match(fs.readFileSync(generatedPath, 'utf8'), /\r\n/);

      // Simulate esbuild replacing a CRLF checkout with equivalent LF output.
      fs.writeFileSync(generatedPath, 'const value = 1;\n');
      const normalizedOnly = assertWorktree();
      assert.equal(normalizedOnly.status, 0, combinedOutput(normalizedOnly));

      fs.writeFileSync(generatedPath, 'const value = 2;\n');
      const unstaged = assertWorktree();
      assert.notEqual(unstaged.status, 0);
      assert.match(combinedOutput(unstaged), /unstaged: M\s+generated\.js/);

      git('add', 'generated.js');
      const staged = assertWorktree();
      assert.notEqual(staged.status, 0);
      assert.match(combinedOutput(staged), /staged: M\s+generated\.js/);

      git(
        'restore',
        '--source=HEAD',
        '--staged',
        '--worktree',
        '--',
        'generated.js'
      );
      fs.writeFileSync(untrackedPath, 'do not publish\n');
      const untracked = assertWorktree();
      assert.notEqual(untracked.status, 0);
      assert.match(combinedOutput(untracked), /untracked: local-notes\.txt/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
);

test(
  'Windows updater metadata validator accepts size-less manifests and rejects drift',
  { skip: process.platform !== 'win32' },
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'translator-windows-updater-metadata-')
    );
    const version = '9.8.7';
    const installerName = `Translator-Setup-${version}.exe`;
    const installerPath = path.join(tempDir, installerName);
    const latestYamlPath = path.join(tempDir, 'latest.yml');
    const invocationPath = path.join(tempDir, 'validate.ps1');
    const helperPath = path
      .join(repoRoot, 'scripts/windows-release-artifacts.ps1')
      .replaceAll("'", "''");
    const psInstallerPath = installerPath.replaceAll("'", "''");
    const psLatestYamlPath = latestYamlPath.replaceAll("'", "''");

    const payload = Buffer.from('signed-installer-fixture');
    const sha512 = crypto.createHash('sha512').update(payload).digest('base64');
    const manifest = ({ entrySha = sha512, topSha = sha512, size } = {}) =>
      [
        `version: ${version}`,
        'files:',
        `  - url: ${installerName}`,
        `    sha512: ${entrySha}`,
        ...(size == null ? [] : [`    size: ${size}`]),
        `path: ${installerName}`,
        `sha512: ${topSha}`,
      ].join('\n');

    const validate = yamlText => {
      fs.writeFileSync(latestYamlPath, yamlText);
      return spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          invocationPath,
        ],
        { encoding: 'utf8' }
      );
    };

    try {
      fs.writeFileSync(installerPath, payload);
      fs.writeFileSync(
        invocationPath,
        [
          "$ErrorActionPreference = 'Stop'",
          `. '${helperPath}'`,
          `Assert-WindowsUpdaterMetadataMatchesInstaller -LatestYamlPath '${psLatestYamlPath}' -InstallerPath '${psInstallerPath}' -Version '${version}'`,
        ].join('\r\n')
      );

      const withoutSize = validate(manifest());
      assert.equal(
        withoutSize.status,
        0,
        withoutSize.stderr || withoutSize.stdout
      );

      const providerDependentName = validate(
        manifest().replace(
          `url: ${installerName}`,
          `url: Translator Setup ${version}.exe`
        )
      );
      assert.notEqual(providerDependentName.status, 0);
      assert.match(
        `${providerDependentName.stdout}\n${providerDependentName.stderr}`,
        /exactly one updater entry/
      );

      const wrongEntryHash = validate(manifest({ entrySha: 'wrong' }));
      assert.notEqual(wrongEntryHash.status, 0);
      assert.match(
        `${wrongEntryHash.stdout}\n${wrongEntryHash.stderr}`,
        /sha512 mismatch/
      );

      const wrongTopHash = validate(manifest({ topSha: 'wrong' }));
      assert.notEqual(wrongTopHash.status, 0);
      assert.match(
        `${wrongTopHash.stdout}\n${wrongTopHash.stderr}`,
        /top-level sha512 mismatch/
      );

      const wrongSize = validate(manifest({ size: payload.length + 1 }));
      assert.notEqual(wrongSize.status, 0);
      assert.match(`${wrongSize.stdout}\n${wrongSize.stderr}`, /size mismatch/);

      const malformedSize = validate(manifest({ size: 'not-a-number' }));
      assert.notEqual(malformedSize.status, 0);
      assert.match(
        `${malformedSize.stdout}\n${malformedSize.stderr}`,
        /invalid size field/
      );

      const extraEntry = validate(
        manifest().replace(
          `path: ${installerName}`,
          `  - url: unexpected.exe\n    sha512: ${sha512}\npath: ${installerName}`
        )
      );
      assert.notEqual(extraEntry.status, 0);
      assert.match(
        `${extraEntry.stdout}\n${extraEntry.stderr}`,
        /exactly one updater entry/
      );

      const duplicatePath = validate(`${manifest()}\npath: ${installerName}`);
      assert.notEqual(duplicatePath.status, 0);
      assert.match(
        `${duplicatePath.stdout}\n${duplicatePath.stderr}`,
        /exactly one top-level path/
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
);

test(
  'Windows GitHub bridge preserves Mac assets and publishes its manifest last',
  { skip: process.platform !== 'win32' },
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'translator-windows-github-bridge-')
    );
    const binDir = path.join(tempDir, 'bin');
    const distDir = path.join(tempDir, 'dist');
    const version = '9.8.7';
    const tag = `v${version}`;
    const commit = '1234567890abcdef1234567890abcdef12345678';
    const installerName = `Translator-Setup-${version}.exe`;
    const installerPath = path.join(distDir, installerName);
    const latestYamlPath = path.join(distDir, 'latest.yml');
    const statePath = path.join(tempDir, 'github-state.json');
    const harnessPath = path.join(tempDir, 'run-bridge.ps1');
    const fakeGitPath = path.join(binDir, 'fake-git.mjs');
    const fakeGhPath = path.join(binDir, 'fake-gh.mjs');
    const bridgePath = path
      .join(repoRoot, 'scripts/bridge-windows-to-github.ps1')
      .replaceAll("'", "''");
    const payload = Buffer.from('signed-windows-installer');
    const sha512 = crypto.createHash('sha512').update(payload).digest('base64');
    const requiredMacNames = ['arm64', 'x64'].flatMap(arch =>
      ['dmg', 'dmg.blockmap', 'zip', 'zip.blockmap'].map(
        suffix => `Translator-${version}-darwin-${arch}.${suffix}`
      )
    );
    requiredMacNames.push('latest-mac.yml');

    try {
      fs.mkdirSync(binDir);
      fs.mkdirSync(distDir);
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ version })
      );
      fs.writeFileSync(installerPath, payload);
      fs.writeFileSync(
        latestYamlPath,
        [
          `version: ${version}`,
          'files:',
          `  - url: ${installerName}`,
          `    sha512: ${sha512}`,
          `path: ${installerName}`,
          `sha512: ${sha512}`,
        ].join('\n')
      );
      fs.writeFileSync(
        statePath,
        JSON.stringify({
          uploads: [],
          assets: requiredMacNames.map((name, index) => ({
            name,
            size: index + 1,
            state: 'uploaded',
            digest: `sha256:${'a'.repeat(64)}`,
          })),
        })
      );

      fs.writeFileSync(
        fakeGitPath,
        `const args = process.argv.slice(2);
const commit = process.env.FAKE_RELEASE_COMMIT;
if (args[0] === 'cat-file' && args[1] === '-t') {
  process.stdout.write('tag\\n');
} else if (args[0] === 'rev-parse') {
  process.stdout.write(commit + '\\n');
} else if (args[0] === 'status' || args[0] === 'diff' || args[0] === 'ls-files') {
  // A clean worktree intentionally has no output.
} else {
  process.stderr.write('unexpected fake git invocation: ' + args.join(' ') + '\\n');
  process.exit(64);
}
`
      );
      fs.writeFileSync(
        fakeGhPath,
        `import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const statePath = process.env.FAKE_GH_STATE;
const version = process.env.FAKE_RELEASE_VERSION;
const tag = 'v' + version;
const commit = process.env.FAKE_RELEASE_COMMIT;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const release = () => ({
  id: 42,
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: '2026-08-23T00:00:00Z',
  assets: state.assets,
});

if (args[0] === 'auth' && args[1] === 'status') process.exit(0);

if (args[0] === 'release' && args[1] === 'upload') {
  const repoIndex = args.indexOf('--repo');
  const assetPaths = args.slice(3).filter((value, index, values) => {
    if (value === '--repo') return false;
    if (index > 0 && values[index - 1] === '--repo') return false;
    return true;
  });
  if (repoIndex < 0 || assetPaths.length === 0) process.exit(65);
  const names = [];
  for (const assetPath of assetPaths) {
    const bytes = fs.readFileSync(assetPath);
    const name = path.basename(assetPath);
    if (state.assets.some(asset => asset.name === name)) process.exit(66);
    state.assets.push({
      name,
      size: bytes.length,
      state: 'uploaded',
      digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'),
    });
    names.push(name);
  }
  state.uploads.push(names);
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.exit(0);
}

if (args[0] !== 'api') process.exit(67);
const endpoint = args.find(value => value.startsWith('repos/')) || '';
if (endpoint.includes('/releases?')) {
  if (args.includes('--jq') || args.includes('--paginate')) process.exit(69);
  const page = Number(new URL('https://example.test/' + endpoint).searchParams.get('page'));
  if (page === 1) {
    process.stdout.write(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
      id: 1000 + index,
      tag_name: 'v0.0.' + index,
    }))));
  } else if (page === 2) {
    process.stdout.write(JSON.stringify([{ id: 42, tag_name: tag }]));
  } else {
    process.stdout.write('[]');
  }
} else if (endpoint.includes('/commits/')) {
  process.stdout.write(JSON.stringify({ sha: commit }));
} else if (endpoint.endsWith('/releases/latest') || endpoint.endsWith('/releases/42')) {
  process.stdout.write(JSON.stringify(release()));
} else {
  process.stderr.write('unexpected fake gh endpoint: ' + endpoint + '\\n');
  process.exit(68);
}
`
      );
      fs.writeFileSync(
        harnessPath,
        [
          "$ErrorActionPreference = 'Stop'",
          'function global:git {',
          `  & node '${fakeGitPath.replaceAll("'", "''")}' @args`,
          '}',
          'function global:gh {',
          `  & node '${fakeGhPath.replaceAll("'", "''")}' @args`,
          '}',
          'function global:Get-AuthenticodeSignature {',
          '  param([string]$LiteralPath)',
          '  return [PSCustomObject]@{',
          '    Status = [System.Management.Automation.SignatureStatus]::Valid',
          "    SignerCertificate = [PSCustomObject]@{ Subject = 'CN=Stage5 Tools LLC, O=Stage5 Tools LLC' }",
          '  }',
          '}',
          `& '${bridgePath}' -Version '${version}' -Repo 'owner/repo'`,
        ].join('\r\n')
      );

      const environment = {
        ...process.env,
        FAKE_GH_STATE: statePath,
        FAKE_RELEASE_COMMIT: commit,
        FAKE_RELEASE_VERSION: version,
      };
      const runBridge = () =>
        spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            harnessPath,
          ],
          { cwd: tempDir, env: environment, encoding: 'utf8' }
        );

      const first = runBridge();
      assert.equal(first.status, 0, first.stderr || first.stdout);
      let state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.deepEqual(state.uploads, [[installerName], ['latest.yml']]);

      const second = runBridge();
      assert.equal(second.status, 0, second.stderr || second.stdout);
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.deepEqual(
        state.uploads,
        [[installerName], ['latest.yml']],
        'an idempotent rerun must upload nothing'
      );

      const installerAsset = state.assets.find(
        asset => asset.name === installerName
      );
      installerAsset.digest = `sha256:${'0'.repeat(64)}`;
      fs.writeFileSync(statePath, JSON.stringify(state));
      const drift = runBridge();
      assert.notEqual(drift.status, 0);
      assert.match(`${drift.stdout}\n${drift.stderr}`, /digest differs/);
      const driftedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.deepEqual(driftedState.uploads, [[installerName], ['latest.yml']]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
);

test('Windows icon generation emits and validates every PNG frame', () => {
  const script = read('scripts/create-windows-icon.ps1');

  assert.match(script, /\$sizes = @\(16, 32, 48, 64, 128, 256\)/);
  assert.match(script, /\$writer\.Write\(\[UInt32\]\$frame\.Bytes\.Length\)/);
  assert.match(script, /foreach \(\$frame in \$frames\)/);
  assert.match(script, /Assert-IcoStructure/);
  assert.match(script, /ICO frame \$index points outside the output file/);
  assert.doesNotMatch(script, /copying PNG as ICO/i);
});

test('Windows package smoke test fails closed and checks the owner supervisor', () => {
  const script = read('scripts/test-windows-package.bat');
  const signingHook = read('scripts/sign-chromium.cjs');

  assert.match(script, /translator-owner-supervisor\.exe/i);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /!HEADLESS_BINARY!/i);
  assert.match(script, /CN=Stage5 Tools LLC/);
  assert.match(script, /headless-arm64/i);
  assert.match(script, /if exist "%%~fF"/i);
  assert.match(script, /HEADLESS_BINARY_COUNT/);
  assert.match(script, /Expected exactly one chrome-headless-shell\.exe/);
  assert.ok(
    script.indexOf('if not "!TEST_EXIT!"=="0" exit /b !TEST_EXIT!') <
      script.indexOf('if "!REQUIRE_SIGNATURES!"=="1"'),
    'structural package failures must stop before Authenticode validation'
  );
  assert.match(script, /exit \/b !TEST_EXIT!/i);
  assert.match(signingHook, /platformName === 'win32'/);
  assert.match(signingHook, /translator-owner-supervisor\.exe/);
  assert.match(signingHook, /await packager\.signIf\(supervisorPath\)/);
  assert.match(signingHook, /signed !== true/);
});

test(
  'Windows package smoke test resolves only real nested headless executables',
  { skip: process.platform !== 'win32' },
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'translator-windows-package-smoke-')
    );
    const fixtureScript = path.join(
      tempDir,
      'scripts',
      'test-windows-package.bat'
    );
    const appDir = path.join(tempDir, 'dist', 'win-unpacked');
    const resourcesDir = path.join(appDir, 'resources');
    const headlessDir = path.join(resourcesDir, 'headless-x64');
    const nestedBinary = path.join(
      headlessDir,
      'chrome-headless-shell',
      'win64-fixture',
      'chrome-headless-shell-win64',
      'chrome-headless-shell.exe'
    );
    const requiredResources = [
      'packaged-mcp.mjs',
      'transport-bound-lifecycle.mjs',
      'native-owner-monitor.mjs',
      'packaged-agent-protocol.mjs',
      'stream-codecs.mjs',
      'packaged-tool-map.mjs',
      'canonical-json.mjs',
      'job-store.mjs',
      'job-owner-lease.mjs',
      'mcp-v2-contract.mjs',
      'mcp-v2-service.mjs',
      'render-checkpoint-recovery.mjs',
      'srt.mjs',
      'subtitle-quality.mjs',
      'tool-schema-validator.mjs',
      'packaged-socket-path.mjs',
      'translator-mcp.cmd',
      'translator-owner-supervisor.exe',
    ];
    const runValidator = () =>
      spawnSync(
        'cmd.exe',
        [
          '/d',
          '/s',
          '/c',
          'scripts\\test-windows-package.bat --no-launch --allow-unsigned',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );

    try {
      fs.mkdirSync(path.dirname(fixtureScript), { recursive: true });
      fs.copyFileSync(
        path.join(repoRoot, 'scripts', 'test-windows-package.bat'),
        fixtureScript
      );
      fs.mkdirSync(path.dirname(nestedBinary), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'Translator.exe'), 'fixture');
      fs.writeFileSync(nestedBinary, 'fixture');
      for (const fileName of requiredResources) {
        fs.writeFileSync(path.join(resourcesDir, fileName), 'fixture');
      }

      const nested = runValidator();
      assert.equal(nested.status, 0, nested.stderr || nested.stdout);
      assert.match(nested.stdout, /Headless shell: .*win64-fixture/i);

      fs.rmSync(nestedBinary);
      const missing = runValidator();
      assert.notEqual(missing.status, 0);
      assert.match(
        `${missing.stdout}\n${missing.stderr}`,
        /chrome-headless-shell\.exe is missing/
      );

      fs.writeFileSync(nestedBinary, 'fixture');
      const duplicateBinary = path.join(
        headlessDir,
        'duplicate',
        'chrome-headless-shell.exe'
      );
      fs.mkdirSync(path.dirname(duplicateBinary), { recursive: true });
      fs.writeFileSync(duplicateBinary, 'fixture');
      const duplicate = runValidator();
      assert.notEqual(duplicate.status, 0);
      assert.match(
        `${duplicate.stdout}\n${duplicate.stderr}`,
        /Expected exactly one chrome-headless-shell\.exe, found 2/
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
);

test('macOS release stays draft until every GitHub artifact is verified', () => {
  const workflow = read('.github/workflows/release-mac.yml');
  const githubUpload = read('scripts/upload-github-mac-release-assets.sh');
  const checklist = read('scripts/release-checklist.sh');
  const packageJson = readJson('package.json');
  const uploadStep = workflow.indexOf(
    '- name: Upload and verify GitHub release assets'
  );
  const promoteStep = workflow.indexOf('- name: Promote artefacts to latest/');
  const publishStep = workflow.indexOf('- name: Publish GitHub Release');

  assert.ok(uploadStep >= 0, 'the explicit GitHub asset gate must exist');
  assert.ok(
    promoteStep > uploadStep && publishStep > promoteStep,
    'GitHub assets must be complete before R2 promotion and release publication'
  );
  assert.match(packageJson.scripts['package:mac'], /--publish never/);
  assert.match(packageJson.scripts['package:arm'], /--publish never/);
  assert.match(packageJson.scripts['package:intel'], /--publish never/);
  assert.doesNotMatch(packageJson.scripts['package:mac'], /--publish onTag/);
  assert.match(checklist, /npm run package:mac/);
  assert.match(checklist, /tag-triggered GitHub Action/);
  assert.match(checklist, /never upload SemVer assets manually/);
  assert.doesNotMatch(checklist, /push tags and upload artifacts/i);
  assert.match(githubUpload, /Multiple GitHub releases already use/);
  assert.match(githubUpload, /already public; refusing to overwrite/);
  assert.match(githubUpload, /alternate release tag/);
  assert.match(githubUpload, /Existing GitHub draft asset differs/);
  assert.doesNotMatch(githubUpload, /--clobber/);
  assert.match(githubUpload, /--field draft=true/);
  assert.match(githubUpload, /releases\/\$\{RELEASE_ID\}/);
  assert.doesNotMatch(githubUpload, /gh api --paginate --slurp/);
  assert.match(workflow, /steps\.github_release\.outputs\.release_id/);
  assert.match(workflow, /releases\/tags\/\$\{GITHUB_REF_NAME\}/);
  assert.match(workflow, /--verify-only "\$RELEASE_ID" false/);
  assert.match(workflow, /\.body == \$body/);
  assert.match(workflow, /\.published_at != null/);
  assert.doesNotMatch(workflow, /gh release edit/);

  for (const arch of ['arm64', 'x64']) {
    for (const suffix of ['dmg', 'dmg.blockmap', 'zip', 'zip.blockmap']) {
      const artifact = `dist/Translator-\${APP_VERSION}-darwin-${arch}.${suffix}`;
      assert.match(
        githubUpload,
        new RegExp(artifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `the GitHub release gate must include the ${arch} ${suffix} artifact`
      );
    }
  }

  assert.match(githubUpload, /expected_digest="sha256:/);
  assert.match(
    githubUpload,
    /\.assets\[\] \| select\(\.name == \$name\) \| \.digest/
  );
  assert.match(githubUpload, /asset state mismatch.*expected uploaded/);
  assert.match(githubUpload, /asset inventory does not match the required set/);
  assert.match(workflow, /hdiutil verify "\$dmg_path"/);
  assert.match(workflow, /hdiutil attach -nobrowse -readonly/);
  assert.match(workflow, /verify_app "\$mount_dir\/Translator\.app"/);
  assert.match(workflow, /verify_dmg x64/);
  assert.match(workflow, /verify_dmg arm64/);
  const immutableArtifacts = workflow.indexOf('IMMUTABLE_ARTIFACTS=(');
  assert.ok(immutableArtifacts >= 0, 'the immutable payload set must exist');
  assert.ok(
    workflow.lastIndexOf('upload_latest_object "latest-mac.yml"') >
      immutableArtifacts,
    'the public updater manifest must be promoted after its payloads'
  );
  assert.match(workflow, /cmp -s latest\/latest-mac\.yml "\$public_manifest"/);
  assert.match(
    workflow,
    /expected_size=\$\(stat -f '%z' "latest\/\$artifact"\)/
  );
  assert.match(workflow, /Public R2 artifact size mismatch/);
  assert.match(workflow, /"Translator-arm64\.dmg"/);
  assert.match(workflow, /"Translator-x64\.dmg"/);
  assert.ok(
    workflow.lastIndexOf(
      'for artifact in "Translator-arm64.dmg" "Translator-x64.dmg"'
    ) > workflow.lastIndexOf('upload_latest_object "latest-mac.yml"'),
    'stable website aliases must switch only after the updater manifest'
  );
  assert.match(workflow, /group: mac-release\s+cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /- name: Upload to R2/);
  assert.doesNotMatch(workflow, /TARGET="mac\/\$\{APP_VERSION\}"/);
  assert.match(workflow, /release-storage-policy\.mjs plan-latest/);
  assert.match(workflow, /release-storage-policy\.mjs prepare-retention/);
  assert.match(workflow, /release-retention\.json/);
  assert.match(workflow, /--retention latest\/release-retention\.json/);
  assert.match(workflow, /aws s3api delete-object/);
  assert.ok(
    workflow.lastIndexOf('aws s3api delete-object') >
      workflow.lastIndexOf(
        'for artifact in "Translator-arm64.dmg" "Translator-x64.dmg"'
      ),
    'stale macOS payloads must be pruned only after stable aliases are verified'
  );
  assert.match(workflow, /aws s3api put-object/);
  assert.match(workflow, /aws s3api head-object/);
  assert.match(workflow, /--metadata "sha256=\$\{expected_sha256\}"/);
  assert.match(workflow, /--query 'Metadata\.sha256'/);
  assert.doesNotMatch(workflow, /--no-multipart/);
  assert.doesNotMatch(workflow, /AWS_MAX_CONCURRENCY/);
  assert.doesNotMatch(workflow, /AWS_S3_MULTI_PART_CHUNK_SIZE/);
});

test(
  'macOS GitHub asset verifier fails closed on inventory or digest drift',
  { skip: process.platform !== 'darwin' },
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'translator-github-release-assets-')
    );
    const binDir = path.join(tempDir, 'bin');
    const distDir = path.join(tempDir, 'dist');
    const version = '1.16.18';
    const assets = [
      `Translator-${version}-darwin-arm64.dmg`,
      `Translator-${version}-darwin-arm64.dmg.blockmap`,
      `Translator-${version}-darwin-arm64.zip`,
      `Translator-${version}-darwin-arm64.zip.blockmap`,
      `Translator-${version}-darwin-x64.dmg`,
      `Translator-${version}-darwin-x64.dmg.blockmap`,
      `Translator-${version}-darwin-x64.zip`,
      `Translator-${version}-darwin-x64.zip.blockmap`,
      'latest-mac.yml',
    ];

    try {
      fs.mkdirSync(binDir);
      fs.mkdirSync(distDir);
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ version })
      );
      for (const asset of assets) {
        fs.writeFileSync(path.join(distDir, asset), `verified:${asset}\n`);
      }

      const fakeGh = path.join(binDir, 'gh');
      fs.writeFileSync(
        fakeGh,
        `#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (args.includes('--slurp')) process.exit(65);
const dist = path.join(process.cwd(), 'dist');
const createdMarker = path.join(process.cwd(), '.release-created');
const uploadedMarker = path.join(process.cwd(), '.release-assets-uploaded');
if (args[0] === 'release' && args[1] === 'upload') {
  if (process.env.FAKE_FAIL_UPLOAD) process.exit(88);
  fs.writeFileSync(uploadedMarker, 'uploaded');
  process.exit(0);
}
if (args[0] !== 'api') process.exit(64);

const endpoint = args.find(arg => arg.startsWith('repos/')) || '';
const releaseMode = process.env.FAKE_RELEASE_MODE || 'draft';
const releaseId = 4242;

const baseRelease = draft => ({
  id: releaseId,
  tag_name: process.env.GITHUB_REF_NAME,
  draft,
  html_url: 'https://example.invalid/release',
});

if (endpoint.includes('/releases?')) {
  let releases;
  if (process.env.FAKE_ALTERNATE_RELEASE) {
    releases = [{ ...baseRelease(true), tag_name: process.env.GITHUB_REF_NAME + '-mac' }];
  } else if (releaseMode === 'duplicate') {
    releases = [baseRelease(true), { ...baseRelease(true), id: releaseId + 1 }];
  } else if (releaseMode === 'published') {
    releases = [baseRelease(false)];
  } else if (releaseMode === 'none' && !fs.existsSync(createdMarker)) {
    releases = [];
  } else {
    releases = [baseRelease(true)];
  }
  process.stdout.write(JSON.stringify(releases));
  process.exit(0);
}

if (args.includes('POST') && endpoint.endsWith('/releases')) {
  fs.writeFileSync(createdMarker, 'created');
  process.stdout.write(JSON.stringify(baseRelease(true)));
  process.exit(0);
}

let names = releaseMode === 'none' && !fs.existsSync(uploadedMarker)
  ? []
  : fs.readdirSync(dist).sort();
if (process.env.FAKE_OMIT_ASSET) {
  names = names.filter(name => name !== process.env.FAKE_OMIT_ASSET);
}
const release = {
  ...baseRelease(releaseMode !== 'published'),
  assets: names.map(name => {
    const data = fs.readFileSync(path.join(dist, name));
    const digest = crypto.createHash('sha256').update(data).digest('hex');
    return {
      name,
      size: data.length,
      state: 'uploaded',
      digest: name === process.env.FAKE_BAD_DIGEST
        ? 'sha256:incorrect'
        : \`sha256:\${digest}\`,
    };
  }),
};
process.stdout.write(JSON.stringify(release));
`
      );
      fs.chmodSync(fakeGh, 0o755);

      const runVerifier = (extraEnv, args = []) =>
        spawnSync(
          'bash',
          [
            path.join(repoRoot, 'scripts/upload-github-mac-release-assets.sh'),
            ...args,
          ],
          {
            cwd: tempDir,
            encoding: 'utf8',
            env: {
              ...process.env,
              PATH: `${binDir}:${process.env.PATH}`,
              GITHUB_REF_NAME: `v${version}`,
              GITHUB_REPOSITORY: 'stage5/translator-test',
              GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
              GITHUB_OUTPUT: path.join(tempDir, 'github-output'),
              ...extraEnv,
            },
          }
        );

      const valid = runVerifier({ FAKE_RELEASE_MODE: 'none' });
      assert.equal(valid.status, 0, valid.stderr || valid.stdout);

      const missing = runVerifier({ FAKE_OMIT_ASSET: assets[0] });
      assert.notEqual(missing.status, 0);
      assert.match(
        `${missing.stdout}\n${missing.stderr}`,
        /asset inventory does not match the required set/
      );

      const corrupted = runVerifier({ FAKE_BAD_DIGEST: assets[4] });
      assert.notEqual(corrupted.status, 0);
      assert.match(
        `${corrupted.stdout}\n${corrupted.stderr}`,
        /Existing GitHub draft asset differs/
      );

      const retained = runVerifier({ FAKE_FAIL_UPLOAD: 'true' });
      assert.equal(retained.status, 0, retained.stderr || retained.stdout);

      const duplicate = runVerifier({ FAKE_RELEASE_MODE: 'duplicate' });
      assert.notEqual(duplicate.status, 0);
      assert.match(
        `${duplicate.stdout}\n${duplicate.stderr}`,
        /Multiple GitHub releases already use/
      );

      const published = runVerifier({ FAKE_RELEASE_MODE: 'published' });
      assert.notEqual(published.status, 0);
      assert.match(
        `${published.stdout}\n${published.stderr}`,
        /already public; refusing to overwrite/
      );

      const alternate = runVerifier({ FAKE_ALTERNATE_RELEASE: 'true' });
      assert.notEqual(alternate.status, 0);
      assert.match(
        `${alternate.stdout}\n${alternate.stderr}`,
        /alternate release tag/
      );

      const verifiedPublic = runVerifier({ FAKE_RELEASE_MODE: 'published' }, [
        '--verify-only',
        '4242',
        'false',
      ]);
      assert.equal(
        verifiedPublic.status,
        0,
        verifiedPublic.stderr || verifiedPublic.stdout
      );

      const corruptedPublic = runVerifier(
        {
          FAKE_RELEASE_MODE: 'published',
          FAKE_BAD_DIGEST: assets[3],
        },
        ['--verify-only', '4242', 'false']
      );
      assert.notEqual(corruptedPublic.status, 0);
      assert.match(
        `${corruptedPublic.stdout}\n${corruptedPublic.stderr}`,
        /asset digest mismatch/
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
);
