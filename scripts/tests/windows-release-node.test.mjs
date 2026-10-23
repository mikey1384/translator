import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import yaml from 'yaml';

const { parse } = yaml;

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const pin = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, 'scripts/windows-release-node.json'),
    'utf8'
  )
);
const quoted = value => `'${value.replaceAll("'", "''")}'`;
function fixture() {
  const scratch = path.join(repoRoot, '.local');
  fs.mkdirSync(scratch, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(scratch, 'windows-node-test-'));
  const root = path.join(tempRoot, "release [fixture] O'Brien");
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const file of [
    'check-security-runtime.mjs',
    'windows-release-node.ps1',
    'windows-release-node.json',
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, 'scripts', file),
      path.join(root, 'scripts', file)
    );
  }
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      type: 'module',
      devDependencies: { electron: '43.8.3' },
    })
  );
  return {
    root,
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
  };
}

test('manual Windows releases and CI pin the same Node runtime', () => {
  const workflow = parse(
    fs.readFileSync(
      path.join(repoRoot, '.github/workflows/release-mac.yml'),
      'utf8'
    )
  );
  const setupSteps = Object.values(workflow.jobs)
    .flatMap(job => job.steps)
    .filter(step => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(setupSteps.length, 2);
  for (const step of setupSteps)
    assert.equal(step.with['node-version'], pin.version);
  assert.match(pin.sha256, /^[a-f0-9]{64}$/);
});

test('build Node can be checked before installing Electron without weakening packaged checks', () => {
  const { root, cleanup } = fixture();
  const check = args =>
    spawnSync(
      process.execPath,
      [path.join(root, 'scripts/check-security-runtime.mjs'), ...args],
      { encoding: 'utf8' }
    );
  try {
    const nodeOnly = check(['--node-only']);
    assert.equal(nodeOnly.status, 0, nodeOnly.stderr);
    assert.match(nodeOnly.stdout, /Build Node: .*"patched":true/);
    assert.doesNotMatch(nodeOnly.stdout, /Electron:/);
    const missingElectron = check([
      '--electron',
      path.join(root, 'missing.exe'),
    ]);
    assert.notEqual(missingElectron.status, 0);
    assert.match(
      missingElectron.stderr,
      /Electron security check could not run/
    );
    const mixed = check(['--node-only', '--electron', 'missing.exe']);
    assert.notEqual(mixed.status, 0);
    assert.match(mixed.stderr, /Usage:/);
  } finally {
    cleanup();
  }
});

test(
  'Windows bootstrap replaces an unsuitable PATH and rejects corrupt or unpatched candidates',
  { skip: process.platform !== 'win32', timeout: 300_000 },
  () => {
    const { root, cleanup } = fixture();
    const fakeTools = path.join(root, 'unsuitable tools');
    fs.mkdirSync(fakeTools);
    for (const name of ['node', 'npm']) {
      fs.writeFileSync(
        path.join(fakeTools, `${name}.cmd`),
        '@echo off\r\necho WRONG BUILD RUNTIME\r\nexit /b 91\r\n'
      );
    }
    const program = `
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. ${quoted(path.join(root, 'scripts/windows-release-node.ps1'))}
$repo = ${quoted(root)}
$env:Path = ${quoted(fakeTools)} + ';' + $env:Path
$unsuitablePath = $env:Path
$context = $null
try {
  $context = Use-WindowsReleaseNode -RepoRoot $repo
  $selected = & node -p 'process.versions.node'
  if ($LASTEXITCODE -ne 0 -or $selected -cne ${quoted(pin.version)}) { throw 'Unsuitable Node was selected' }
  $npmVersion = & npm.cmd --version
  if ($LASTEXITCODE -ne 0 -or $npmVersion -notmatch '^\\d+\\.\\d+\\.\\d+$') { throw 'Unsuitable npm was selected' }
  $childVersion = & cmd.exe /d /s /c 'node --version'
  if ($LASTEXITCODE -ne 0 -or $childVersion -cne ${quoted(`v${pin.version}`)}) { throw 'Child did not inherit the pinned Node' }
} finally {
  if ($null -ne $context) { Restore-WindowsReleaseNode -Context $context }
}
if ($env:Path -cne $unsuitablePath -or (Test-Path -LiteralPath $context.Root)) { throw 'Bootstrap cleanup did not restore the process' }

# A verified archive can be reused without any network access.
function Save-WindowsReleaseNodeArchive { throw 'Unexpected network access for a valid cache' }
$context = Use-WindowsReleaseNode -RepoRoot $repo
Restore-WindowsReleaseNode -Context $context

# Passing the archive checksum and version is not enough: the decoder must pass.
[IO.File]::WriteAllText((Join-Path $repo 'scripts\\check-security-runtime.mjs'), 'process.exit(41);')
$rejected = $false
try { Use-WindowsReleaseNode -RepoRoot $repo | Out-Null } catch {
  if ($_.Exception.Message -notmatch 'failed its security check') { throw }
  $rejected = $true
}
if (-not $rejected -or $env:Path -cne $unsuitablePath) { throw 'A failed security check changed PATH' }

# Corrupt cached/downloaded bytes must be rejected before extraction/execution.
$archive = Join-Path $repo ${quoted(`.local\\release-node\\node-v${pin.version}-win-x64.zip`)}
[IO.File]::WriteAllText($archive, 'corrupt cache')
function Save-WindowsReleaseNodeArchive {
  param($Uri, $LiteralPath)
  if ($Uri -cne ${quoted(`https://nodejs.org/dist/v${pin.version}/node-v${pin.version}-win-x64.zip`)}) { throw 'Unexpected download destination' }
  [IO.File]::WriteAllText($LiteralPath, 'corrupt download')
}
$rejected = $false
try { Use-WindowsReleaseNode -RepoRoot $repo | Out-Null } catch {
  if ($_.Exception.Message -notmatch 'failed its SHA256 checksum') { throw }
  $rejected = $true
}
if (-not $rejected -or $env:Path -cne $unsuitablePath) { throw 'A checksum failure changed PATH' }
$leftovers = @(Get-ChildItem -LiteralPath (Join-Path $repo '.local\\release-node') -Directory)
if ($leftovers.Count -ne 0) { throw 'Bootstrap left an executable directory behind' }
Write-Output 'Windows pinned Node bootstrap behavioral checks passed.'
`;
    try {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          program,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, PSModulePath: '' },
          timeout: 290_000,
          maxBuffer: 1024 * 1024,
        }
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(
        result.stdout,
        /Windows pinned Node bootstrap behavioral checks passed/
      );
    } finally {
      cleanup();
    }
  }
);
