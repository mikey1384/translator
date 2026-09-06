import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yaml from 'yaml';
import {
  assertLockfileHash,
  fileInventory,
  safeRelativePath,
  validateRun,
  workflowPath,
  repository,
} from '../windows-token-handoff.mjs';
import {
  assertPayloadChanges,
  localBuilderConfig,
  signFile,
  signedUpdaterConfig,
  verifyMetadata,
} from '../windows-token-release.mjs';

const repo = path.resolve(import.meta.dirname, '../..');
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'translator-token-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('lockfile verification allows only LF/CRLF checkout differences', () => {
  const lf = '{\n  "version": "1.2.3"\n}\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const digest = contents =>
    createHash('sha256').update(contents).digest('hex');
  for (const local of [lf, crlf]) {
    for (const remote of [lf, crlf]) assertLockfileHash(local, digest(remote));
    for (const modified of [
      lf.replace('1.2.3', '1.2.4'),
      lf.replace('  ', ' '),
      lf + ' ',
    ]) {
      assert.throws(
        () => assertLockfileHash(local, digest(modified)),
        /lockfile contents differ/
      );
    }
    assert.throws(() => assertLockfileHash(local, undefined));
  }
});

test('handoff rejects escaping, ambiguous, and unexpected paths', () => {
  for (const name of [
    '../file',
    '/win-unpacked/a',
    'win-unpacked/../a',
    'win-unpacked//a',
    'win-unpacked/a:b',
    'win-unpacked/a\\b',
    'other/file',
    'win-unpacked/./a',
  ]) {
    assert.throws(() => safeRelativePath(name), name);
  }
  assert.equal(
    safeRelativePath('win-unpacked/resources/app.asar'),
    'win-unpacked/resources/app.asar'
  );
});

test(
  'handoff inventory refuses symlinks and detects changed bytes',
  { skip: process.platform === 'win32' },
  async t => {
    const root = temporary(t);
    fs.writeFileSync(path.join(root, 'file'), 'original');
    const before = await fileInventory(root);
    fs.writeFileSync(path.join(root, 'file'), 'modified');
    assert.notDeepEqual(await fileInventory(root), before);
    fs.symlinkSync(path.join(root, 'file'), path.join(root, 'link'));
    await assert.rejects(fileInventory(root), /Symlinks/);
  }
);

test('CI provenance rejects wrong repository, workflow, attempt, commit, or result', () => {
  const run = {
    id: 42,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    path: workflowPath,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_sha: 'a'.repeat(40),
    run_attempt: 2,
  };
  const manifest = {
    repository,
    runId: '42',
    runAttempt: '2',
    workflowCommit: run.head_sha,
  };
  validateRun(run, manifest, '42');
  for (const patch of [
    { id: 43 },
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { event: 'pull_request' },
    { head_sha: 'b'.repeat(40) },
    { run_attempt: 3 },
    { path: 'other.yml' },
    { head_repository: { full_name: 'attacker/fork' } },
    { repository: { full_name: 'other/repo' } },
  ])
    assert.throws(() => validateRun({ ...run, ...patch }, manifest, '42'));
});

test('token signing never replaces a file on signing or verification failure', t => {
  const root = temporary(t);
  const file = path.join(root, 'app.exe');
  fs.writeFileSync(file, 'unsigned');
  for (const failingStep of ['sign', 'verify']) {
    const calls = [];
    assert.throws(
      () =>
        signFile(file, '/trusted/signer', (command, args) => {
          assert.equal(command, '/trusted/signer');
          calls.push(args[0]);
          if (args[0] === failingStep) throw new Error('signing failed');
          if (args[0] === 'sign') fs.writeFileSync(args[2], 'signed');
        }),
      /signing failed/
    );
    assert.equal(fs.readFileSync(file, 'utf8'), 'unsigned');
    assert.deepEqual(
      calls,
      failingStep === 'sign' ? ['sign'] : ['sign', 'verify']
    );
    assert.deepEqual(fs.readdirSync(root), ['app.exe']);
  }
  signFile(file, '/trusted/signer', (_, args) => {
    if (args[0] === 'sign') fs.writeFileSync(args[2], 'signed');
  });
  assert.equal(fs.readFileSync(file, 'utf8'), 'signed');
});

test('updater retains its pinned channel and requires the Stage5 publisher', () => {
  const original =
    'provider: generic\nurl: https://downloads.stage5.tools/win/latest/\nupdaterCacheDirName: translator-updater\n';
  assert.deepEqual(yaml.parse(signedUpdaterConfig(original)), {
    provider: 'generic',
    url: 'https://downloads.stage5.tools/win/latest/',
    updaterCacheDirName: 'translator-updater',
    publisherName: ['Stage5 Tools LLC'],
  });
  assert.throws(() =>
    signedUpdaterConfig(
      original.replace('downloads.stage5.tools', 'example.com')
    )
  );
  assert.throws(() =>
    signedUpdaterConfig(original + 'publisherName: [Someone Else]\n')
  );
});

test('only executable signatures and external updater configuration may change', () => {
  const before = [
    'Translator.exe',
    'resources/app-update.yml',
    'resources/app.asar',
    'resources/vad.node',
  ].map(name => ({ path: name, size: 1, sha256: 'a' }));
  const after = structuredClone(before);
  after[0].sha256 = 'signed';
  after[1].sha256 = 'publisher';
  assertPayloadChanges(before, after);
  after[2].sha256 = 'tampered';
  assert.throws(
    () => assertPayloadChanges(before, after),
    /Non-signing payload changed/
  );
  assert.throws(
    () => assertPayloadChanges(before, before.slice(1)),
    /added or removed/
  );
});

test('local packaging forces token signing and disables native rebuilding, not signature checks', () => {
  const hook = () => {};
  const config = localBuilderConfig(repo, hook);
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.win.signExecutable, true);
  assert.equal(config.win.signtoolOptions.sign, hook);
  assert.deepEqual(config.win.signtoolOptions.signingHashAlgorithms, [
    'sha256',
  ]);
  assert.equal(
    config.win.signtoolOptions.certificateSha1,
    undefined,
    'Do not query a Windows certificate store on Linux'
  );
  assert.equal(config.npmRebuild, false);
  assert.equal(config.buildDependenciesFromSource, false);
  assert.equal(config.nsis.differentialPackage, false);
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64'] }]);
});

test('metadata verifier rejects unsigned-era or changed installer hashes', async t => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'dist'));
  const identity = { tag: 'v1.2.3', version: '1.2.3', notes: 'Release notes' };
  const installer = path.join(root, 'dist/Translator-Setup-1.2.3.exe');
  fs.writeFileSync(installer, 'signed installer');
  const { hashFile } = await import('../windows-token-handoff.mjs');
  const hash = await hashFile(installer, 'sha512', 'base64');
  const data = {
    version: '1.2.3',
    files: [{ url: path.basename(installer), sha512: hash, size: 16 }],
    path: path.basename(installer),
    sha512: hash,
    releaseName: 'v1.2.3',
    releaseNotes: identity.notes,
  };
  fs.writeFileSync(path.join(root, 'dist/latest.yml'), yaml.stringify(data));
  assert.equal(await verifyMetadata(root, identity), installer);
  delete data.files[0].size;
  fs.writeFileSync(path.join(root, 'dist/latest.yml'), yaml.stringify(data));
  assert.equal(await verifyMetadata(root, identity), installer);
  for (const invalidSize of [0, 15, 17, null, '16']) {
    data.files[0].size = invalidSize;
    fs.writeFileSync(path.join(root, 'dist/latest.yml'), yaml.stringify(data));
    await assert.rejects(verifyMetadata(root, identity));
  }
  delete data.files[0].size;
  fs.writeFileSync(path.join(root, 'dist/latest.yml'), yaml.stringify(data));
  fs.appendFileSync(installer, 'changed');
  await assert.rejects(verifyMetadata(root, identity));
});

test('Windows handoff uses read-only credentials and an immutable artifact action', () => {
  const workflow = yaml.parse(
    fs.readFileSync(path.join(repo, workflowPath), 'utf8')
  );
  const job = workflow.jobs['windows-preflight'];
  assert.deepEqual(job.permissions, { contents: 'read' });
  const checkouts = job.steps.filter(step =>
    step.uses?.startsWith('actions/checkout@')
  );
  assert.equal(checkouts.length, 2);
  for (const step of checkouts)
    assert.equal(step.with['persist-credentials'], false);
  const upload = job.steps.find(step =>
    step.uses?.startsWith('actions/upload-artifact@')
  );
  assert.match(upload.uses, /@[a-f0-9]{40}$/);
  assert.equal(upload.with['retention-days'], 7);
  assert.equal(upload.with.path, 'app/dist/token-handoff/');
  assert.ok(!JSON.stringify(job).includes('secrets.'));
  assert.equal(
    workflow.jobs['mac-build'].if,
    "github.event_name == 'push' && github.ref_type == 'tag'"
  );
});

test('publication checks the canonical GitHub release before changing the R2 channel', () => {
  const publish = fs.readFileSync(
    path.join(repo, 'scripts/publish-windows-token.ps1'),
    'utf8'
  );
  const bridge = fs.readFileSync(
    path.join(repo, 'scripts/bridge-windows-to-github.ps1'),
    'utf8'
  );
  const preflight = publish.indexOf(
    "'bridge-windows-to-github.ps1') -Version $version -VerifyOnly"
  );
  assert.ok(
    preflight > publish.indexOf('Signed candidate verification failed')
  );
  assert.ok(preflight < publish.indexOf("'upload-to-r2-win.ps1'"));
  const earlyReturn = bridge.indexOf('if ($VerifyOnly)');
  assert.ok(
    earlyReturn > bridge.indexOf('Assert-ReleaseIsLatest -Repository $Repo')
  );
  assert.ok(earlyReturn > bridge.indexOf('-AllowMissingWindows $true'));
  assert.ok(
    earlyReturn < bridge.indexOf("$uploadArguments = @('release', 'upload'")
  );
  assert.match(
    bridge.slice(earlyReturn),
    /if \(\$VerifyOnly\) \{[^}]*return\s*\}/
  );
});
