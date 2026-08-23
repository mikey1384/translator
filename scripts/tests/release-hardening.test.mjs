import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = relativePath =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const readJson = relativePath => JSON.parse(read(relativePath));

test('packaged apps carry only their target headless-browser architecture', () => {
  const base = readJson('electron-builder.base.json');
  const x64 = readJson('electron-builder.x64.json');
  const win = readJson('electron-builder.win.json');

  const headlessSources = config =>
    config.extraResources
      .map(entry => entry.from)
      .filter(source => source.startsWith('vendor/headless-'));

  assert.deepEqual(headlessSources(base), ['vendor/headless-${arch}']);
  assert.deepEqual(headlessSources(x64), ['vendor/headless-x64']);
  assert.deepEqual(headlessSources(win), ['vendor/headless-x64']);

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

test('macOS publication waits for the real Windows browser preflight', () => {
  const workflow = parseYaml(read('.github/workflows/release-mac.yml'));
  const windowsJob = workflow.jobs['windows-preflight'];
  const windowsCommands = windowsJob.steps
    .map(step => step.run)
    .filter(command => typeof command === 'string')
    .join('\n');

  assert.equal(windowsJob['runs-on'], 'windows-2022');
  assert.match(windowsCommands, /npm ci --ignore-scripts/);
  assert.match(windowsCommands, /npm run download:headless-win/);
  assert.equal(workflow.jobs['mac-build'].needs, 'windows-preflight');
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
  const identity = read('scripts/assert-windows-release-identity.ps1');

  assert.match(batch, /set "RELEASE_EXIT=%ERRORLEVEL%"/i);
  assert.match(batch, /endlocal & exit \/b %RELEASE_EXIT%/i);
  assert.match(release, /npm run package:win failed with exit code/);
  assert.match(release, /exit \$exitCode/);
  assert.match(release, /Get-AuthenticodeSignature/);
  assert.match(release, /test-windows-package\.bat --no-launch/i);
  assert.match(upload, /Assert-UpdaterMetadataMatchesInstaller/);
  assert.match(upload, /latest\.yml sha512 mismatch/);
  assert.match(release, /Assert-WindowsReleaseIdentity -Version \$version/);
  assert.match(upload, /Assert-WindowsReleaseIdentity -Version \$Version/);
  assert.match(identity, /Release tag \$tag points to/);
  assert.match(identity, /git status --porcelain=v1 --untracked-files=all/);
  assert.match(identity, /Use a clean release checkout/);
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
  assert.match(upload, /function Invoke-RcloneCopyImmutable/);
  assert.match(upload, /function Invoke-RcloneCopyRemoteImmutable/);
  assert.match(upload, /'copyto', '--immutable'/);
  assert.match(upload, /cannot overwrite immutable versioned objects/);
  assert.match(
    upload,
    /Invoke-RcloneCopyImmutable -from \$src -to \$destHyphenVersion/
  );
  assert.match(
    upload,
    /Invoke-RcloneCopyRemoteImmutable -fromRemote \$destHyphenVersion -toRemote \$destVersion/
  );
  assert.match(
    upload,
    /Invoke-RcloneCopyImmutable -from \$latestYaml -to \$destVersionYaml/
  );
  assert.match(
    upload,
    /Invoke-RcloneCopyAlways -from \$latestYaml -to \$destLatestYaml/
  );
  assert.doesNotMatch(upload, /--size-only/);
  assert.match(upload, /\$blockmapFileName = "\$installerHyphen\.blockmap"/);
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
    5,
    'every rclone upload mode must turn native failures into terminating errors'
  );
});

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

  assert.match(script, /translator-owner-supervisor\.exe/i);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /%HEADLESS_BINARY%/i);
  assert.match(script, /CN=Stage5 Tools LLC/);
  assert.match(script, /headless-arm64/i);
  assert.match(script, /exit \/b !TEST_EXIT!/i);
});

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
  assert.ok(
    uploadStep < workflow.indexOf('- name: Upload to R2'),
    'the immutable GitHub draft must be established before any R2 mutation'
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
