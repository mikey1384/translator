import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'yaml';
import {
  fileInventory,
  hashFile,
  repository,
  sourceIdentity,
  verifyHandoff,
} from './windows-token-handoff.mjs';

export const publisher = 'Stage5 Tools LLC';
export const updateUrl = 'https://downloads.stage5.tools/win/latest/';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${path.basename(command)} failed; stopped without retrying`
  );
}

function signerCommand() {
  const command =
    process.env.TRANSLATOR_SIGN_COMMAND ||
    path.join(os.homedir(), '.local/bin/translator-sign');
  assert.ok(
    path.isAbsolute(command),
    'TRANSLATOR_SIGN_COMMAND must be an absolute path'
  );
  fs.accessSync(command, fs.constants.X_OK);
  return command;
}

export function signFile(file, signer, execute = run) {
  assert.ok(
    fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink()
  );
  const temporary = fs.mkdtempSync(
    path.join(path.dirname(file), '.token-sign-')
  );
  const signed = path.join(temporary, path.basename(file));
  try {
    execute(signer, ['sign', file, signed]);
    execute(signer, ['verify', signed]);
    fs.renameSync(signed, file); // Only replace this disposable build copy after verification.
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function signedUpdaterConfig(text) {
  const config = yaml.parse(text);
  assert.equal(config.provider, 'generic');
  assert.equal(config.url, updateUrl);
  assert.ok(
    !config.publisherName ||
      JSON.stringify(config.publisherName) === JSON.stringify([publisher]),
    'Unexpected updater publisher'
  );
  return yaml.stringify({ ...config, publisherName: [publisher] });
}

export function assertPayloadChanges(before, after) {
  assert.deepEqual(
    after.map(file => file.path),
    before.map(file => file.path),
    'Payload files were added or removed'
  );
  for (let index = 0; index < before.length; index++) {
    const file = before[index];
    if (file.path.endsWith('.exe') || file.path === 'resources/app-update.yml')
      continue;
    assert.deepEqual(
      after[index],
      file,
      `Non-signing payload changed: ${file.path}`
    );
  }
}

export async function verifyMetadata(root, identity) {
  const name = `Translator-Setup-${identity.version}.exe`;
  const installer = path.join(root, 'dist', name);
  const info = yaml.parse(
    fs.readFileSync(path.join(root, 'dist/latest.yml'), 'utf8'),
    { uniqueKeys: true }
  );
  const sha512 = await hashFile(installer, 'sha512', 'base64');
  assert.equal(info.version, identity.version);
  assert.equal(info.path, name);
  assert.equal(info.sha512, sha512);
  assert.equal(info.files.length, 1);
  assert.equal(info.files[0].url, name);
  assert.equal(info.files[0].sha512, sha512);
  // electron-builder may omit size when differential packages are disabled.
  // The SHA512 remains mandatory; a size field, when present, must be exact.
  if (Object.hasOwn(info.files[0], 'size'))
    assert.equal(info.files[0].size, fs.statSync(installer).size);
  assert.equal(info.releaseName, identity.tag);
  assert.equal(info.releaseNotes.trim(), identity.notes);
  return installer;
}

function ghJson(...args) {
  return JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8' }));
}

async function download(root, tag, runId) {
  const identity = sourceIdentity(root, tag);
  const ciRun = ghJson(`repos/${repository}/actions/runs/${runId}`);
  assert.equal(ciRun.status, 'completed');
  assert.equal(ciRun.conclusion, 'success');
  const name = `windows-unsigned-${tag}-${runId}-${ciRun.run_attempt}`;
  const artifacts = ghJson(
    `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`
  );
  const matches = artifacts.artifacts.filter(
    artifact => artifact.name === name && !artifact.expired
  );
  assert.equal(
    matches.length,
    1,
    'Expected exactly one non-expired handoff artifact'
  );
  const handoff = path.join(root, 'dist/token-handoff');
  assert.ok(
    !fs.existsSync(handoff),
    'Handoff already exists; use a fresh release checkout'
  );
  fs.mkdirSync(handoff, { recursive: true });
  run('gh', [
    'run',
    'download',
    runId,
    '--repo',
    repository,
    '--name',
    name,
    '--dir',
    handoff,
  ]);
  await verifyHandoff(root, handoff, tag, ciRun, runId);
  console.log(
    `Verified Windows build ${runId} for ${identity.tag} (${identity.commit}).`
  );
}

export function localBuilderConfig(root, sign) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name)));
  const base = read('electron-builder.base.json');
  const windows = read('electron-builder.win.json');
  const lock = read('package-lock.json');
  const config = { ...base, ...windows };
  delete config.extends;
  config.electronVersion = lock.packages['node_modules/electron'].version;
  config.npmRebuild = false;
  config.buildDependenciesFromSource = false;
  config.forceCodeSigning = true;
  config.afterPack = null; // --prepackaged skips this hook; all payload EXEs are explicitly signed below.
  config.directories = {
    ...base.directories,
    output: path.join(root, 'dist'),
    buildResources: path.join(root, 'build'),
  };
  config.icon = path.join(root, 'build/file_icon.ico');
  config.win = {
    ...windows.win,
    signExecutable: true,
    signtoolOptions: {
      sign,
      signingHashAlgorithms: ['sha256'],
      publisherName: [publisher],
    },
  };
  config.nsis = {
    ...windows.nsis,
    include: path.join(root, 'installer-override.nsh'),
  };
  return config;
}

async function build(root, tag, runId) {
  assert.equal(process.platform, 'linux', 'Use the Linux token signing host');
  assert.ok(
    process.stdin.isTTY && process.stdout.isTTY,
    'Run build in your local terminal; never send the PIN through an agent'
  );
  assert.ok(
    !process.env.STAGE5_SIGN_PIN,
    'Remove the PIN environment variable before signing'
  );
  const signer = signerCommand();
  run(signer, ['check']);
  const identity = sourceIdentity(root, tag);
  const handoff = path.join(root, 'dist/token-handoff');
  const ciRun = ghJson(`repos/${repository}/actions/runs/${runId}`);
  const manifest = await verifyHandoff(root, handoff, tag, ciRun, runId);
  const app = path.join(root, 'dist/win-unpacked');
  const audit = path.join(root, 'dist/token-audit');
  for (const target of [
    app,
    audit,
    path.join(root, 'build'),
    path.join(root, `dist/Translator-Setup-${identity.version}.exe`),
    path.join(root, 'dist/latest.yml'),
  ]) {
    assert.ok(
      !fs.existsSync(target),
      `Refusing to overwrite ${target}; use a fresh release checkout`
    );
  }
  fs.mkdirSync(audit);
  fs.cpSync(path.join(handoff, 'win-unpacked'), app, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  fs.cpSync(path.join(handoff, 'build'), path.join(root, 'build'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const before = await fileInventory(app);
  const updater = path.join(app, 'resources/app-update.yml');
  fs.writeFileSync(
    updater,
    signedUpdaterConfig(fs.readFileSync(updater, 'utf8'))
  );
  const elevationHelper = 'resources/elevate.exe';
  // NSIS always recopies this helper for per-machine installers. Its signing
  // belongs in the builder hook, after that copy and before app compression.
  const executables = before.filter(
    file => file.path.endsWith('.exe') && file.path !== elevationHelper
  );
  console.log(
    `Signing ${executables.length} Windows executables, then the elevation helper, uninstaller and installer. Each signature may prompt for the PIN. No automatic PIN retries.`
  );
  for (const file of executables) signFile(path.join(app, file.path), signer);
  const signedPayload = await fileInventory(app);
  assertPayloadChanges(before, signedPayload);
  const installerName = `Translator-Setup-${identity.version}.exe`;
  const signedInstallerParts = [];
  const config = localBuilderConfig(root, async options => {
    assert.equal(options.hash, 'sha256');
    assert.equal(options.isNest, false);
    if (options.path === path.join(app, elevationHelper)) {
      const index = signedPayload.findIndex(
        file => file.path === elevationHelper
      );
      assert.ok(index >= 0, 'CI must include the elevation helper');
      assert.equal(
        await hashFile(options.path),
        before.find(file => file.path === elevationHelper).sha256,
        'Local NSIS elevation helper differs from the Windows CI build'
      );
      signFile(options.path, signer);
      signedPayload[index] = {
        path: elevationHelper,
        size: fs.statSync(options.path).size,
        sha256: await hashFile(options.path),
      };
      signedInstallerParts.push('elevate.exe');
      return;
    }
    const name = path.basename(options.path);
    assert.ok(
      name === installerName ||
        name === installerName.slice(0, -3) + '__uninstaller.exe',
      `Unexpected installer signing request: ${name}`
    );
    assert.equal(path.dirname(options.path), path.join(root, 'dist'));
    signFile(options.path, signer);
    signedInstallerParts.push(name);
    if (name.endsWith('__uninstaller.exe')) {
      fs.copyFileSync(
        options.path,
        path.join(audit, 'signed-uninstaller.exe'),
        fs.constants.COPYFILE_EXCL
      );
    }
  });
  // --prepackaged never rebuilds Windows native modules on Linux.
  const {
    build: electronBuild,
    Platform,
    Arch,
  } = await import('electron-builder');
  await electronBuild({
    projectDir: root,
    prepackaged: app,
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    config,
    publish: 'never',
  });
  assert.deepEqual(signedInstallerParts, [
    'elevate.exe',
    installerName.slice(0, -3) + '__uninstaller.exe',
    installerName,
  ]);
  assert.deepEqual(
    await fileInventory(app),
    signedPayload,
    'Packaging changed the signed app'
  );
  const notesPath = path.join(root, 'dist/release-notes.txt');
  fs.writeFileSync(notesPath, `${identity.notes}\n`, { flag: 'wx' });
  run(process.execPath, [
    path.join(import.meta.dirname, 'inject-update-release-notes.mjs'),
    '--yaml',
    path.join(root, 'dist/latest.yml'),
    '--version',
    identity.version,
    '--release-notes-file',
    notesPath,
  ]);
  const installer = await verifyMetadata(root, identity);
  run(signer, ['verify', installer]);
  const receipt = {
    schema: 1,
    tag,
    commit: identity.commit,
    runId,
    workflowCommit: manifest.workflowCommit,
    signedPayload,
    installerSha256: await hashFile(installer),
    uninstallerSha256: await hashFile(
      path.join(audit, 'signed-uninstaller.exe')
    ),
  };
  fs.writeFileSync(
    path.join(audit, 'receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: 'wx' }
  );
  sourceIdentity(root, tag);
  console.log(
    `Signed and verified ${installer}. Nothing has been uploaded or published.`
  );
}

async function verifySigned(root, tag, runId) {
  const identity = sourceIdentity(root, tag);
  const manifest = await verifyHandoff(
    root,
    path.join(root, 'dist/token-handoff'),
    tag,
    ghJson(`repos/${repository}/actions/runs/${runId}`),
    runId
  );
  const audit = path.join(root, 'dist/token-audit');
  const receipt = JSON.parse(fs.readFileSync(path.join(audit, 'receipt.json')));
  assert.equal(receipt.schema, 1);
  assert.equal(receipt.tag, tag);
  assert.equal(receipt.runId, runId);
  assert.equal(receipt.commit, identity.commit);
  assert.equal(receipt.workflowCommit, manifest.workflowCommit);
  const app = path.join(root, 'dist/win-unpacked');
  const before = manifest.files
    .filter(file => file.path.startsWith('win-unpacked/'))
    .map(file => ({ ...file, path: file.path.slice('win-unpacked/'.length) }));
  const after = await fileInventory(app);
  assertPayloadChanges(before, after);
  assert.deepEqual(after, receipt.signedPayload);
  const originalUpdater = fs.readFileSync(
    path.join(root, 'dist/token-handoff/win-unpacked/resources/app-update.yml'),
    'utf8'
  );
  assert.equal(
    fs.readFileSync(path.join(app, 'resources/app-update.yml'), 'utf8'),
    signedUpdaterConfig(originalUpdater)
  );
  const signer = signerCommand();
  for (const file of after.filter(file => file.path.endsWith('.exe')))
    run(signer, ['verify', path.join(app, file.path)]);
  const installer = await verifyMetadata(root, identity);
  assert.equal(await hashFile(installer), receipt.installerSha256);
  const uninstaller = path.join(audit, 'signed-uninstaller.exe');
  assert.equal(await hashFile(uninstaller), receipt.uninstallerSha256);
  run(signer, ['verify', uninstaller]);
  run(signer, ['verify', installer]);
  console.log(
    'Signed payload, installer, uninstaller, provenance, and updater metadata verified.'
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [command, tag, runId, root, ...extra] = process.argv.slice(2);
  assert.ok(
    ['download', 'build', 'verify-signed'].includes(command) &&
      root &&
      !extra.length,
    'Usage: windows-token-release.mjs download|build|verify-signed TAG RUN_ID CLEAN_RELEASE_ROOT'
  );
  assert.match(tag, /^v\d+\.\d+\.\d+$/);
  assert.match(runId, /^\d+$/);
  await { download, build, 'verify-signed': verifySigned }[command](
    path.resolve(root),
    tag,
    runId
  );
}
