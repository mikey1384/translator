// No dependencies: this runs from the automation checkout before npm ci.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const repository = 'mikey1384/translator';
export const workflowPath = '.github/workflows/release-mac.yml';

export function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

export async function hashFile(file, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

export function sourceIdentity(root, tag) {
  assert.match(tag, /^v\d+\.\d+\.\d+(?:-mac)?$/, 'Use an exact release tag');
  const version = tag.slice(1).replace(/-mac$/, '');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
    version
  );
  assert.equal(
    git(root, 'cat-file', '-t', tag),
    'tag',
    'An annotated tag is required'
  );
  const commit = git(root, 'rev-parse', `${tag}^{commit}`);
  assert.equal(
    git(root, 'rev-parse', 'HEAD'),
    commit,
    'Checkout must match the tag'
  );
  assert.equal(
    git(root, 'status', '--porcelain', '--untracked-files=all'),
    '',
    'Use a clean release checkout'
  );
  const notes = git(
    root,
    'for-each-ref',
    '--format=%(contents:body)',
    `refs/tags/${tag}`
  );
  assert.ok(notes, 'The tag must contain release notes');
  return {
    tag,
    version,
    commit,
    tagObject: git(root, 'rev-parse', tag),
    notes,
  };
}

export function safeRelativePath(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value && !/[\\:\x00-\x1f]/.test(value), 'Unsafe handoff path');
  assert.ok(
    value.split('/').every(part => part && part !== '.' && part !== '..'),
    'Unsafe handoff path'
  );
  assert.ok(
    value.startsWith('win-unpacked/') || value.startsWith('build/'),
    'Unexpected handoff path'
  );
  return value;
}

export async function fileInventory(root, prefix = '') {
  assert.ok(fs.lstatSync(root).isDirectory(), `Not a real directory: ${root}`);
  const files = [];
  for (const entry of fs
    .readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    const stat = fs.lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(), `Symlinks are not allowed: ${relative}`);
    if (stat.isDirectory())
      files.push(...(await fileInventory(absolute, relative)));
    else {
      assert.ok(stat.isFile(), `Not a regular file: ${relative}`);
      files.push({
        path: relative,
        size: stat.size,
        sha256: await hashFile(absolute),
      });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function validateLayout(files) {
  const names = files.map(file => safeRelativePath(file.path));
  assert.equal(
    new Set(names.map(name => name.toLowerCase())).size,
    names.length,
    'Duplicate Windows paths'
  );
  for (const name of [
    'win-unpacked/Translator.exe',
    'win-unpacked/resources/app.asar',
    'win-unpacked/resources/app-update.yml',
    'win-unpacked/resources/elevate.exe',
    'win-unpacked/resources/translator-owner-supervisor.exe',
    'win-unpacked/resources/translator-mcp.cmd',
    'build/file_icon.ico',
  ])
    assert.ok(names.includes(name), `Missing payload: ${name}`);
  assert.equal(
    names.filter(
      name =>
        name.startsWith('win-unpacked/resources/headless-x64/') &&
        name.endsWith('/chrome-headless-shell.exe')
    ).length,
    1,
    'Expected one x64 headless browser'
  );
  assert.ok(
    !names.some(name =>
      name.startsWith('win-unpacked/resources/headless-arm64/')
    ),
    'Unexpected arm64 browser'
  );
  assert.ok(
    names.includes(
      'win-unpacked/resources/app.asar.unpacked/node_modules/webrtcvad/build/Release/vad.node'
    ),
    'Missing Windows native VAD module'
  );
  for (const file of files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.size) && file.size >= 0);
  }
}

export function validateRun(run, manifest, runId) {
  assert.match(String(runId), /^\d+$/);
  assert.equal(String(run.id), String(runId));
  assert.equal(run.repository.full_name, repository);
  assert.equal(run.head_repository.full_name, repository);
  assert.equal(run.path, workflowPath);
  assert.ok(
    ['workflow_dispatch', 'push'].includes(run.event),
    'Untrusted workflow event'
  );
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success', 'The complete workflow must succeed');
  assert.equal(manifest.repository, repository);
  assert.equal(manifest.runId, String(runId));
  assert.equal(manifest.runAttempt, String(run.run_attempt));
  assert.equal(manifest.workflowCommit, run.head_sha);
}

export async function verifyHandoff(root, handoff, tag, run, runId) {
  const identity = sourceIdentity(root, tag);
  assert.ok(fs.lstatSync(handoff).isDirectory());
  const manifestPath = path.join(handoff, 'handoff.json');
  assert.ok(
    fs.lstatSync(manifestPath).isFile() &&
      !fs.lstatSync(manifestPath).isSymbolicLink()
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  assert.equal(manifest.schema, 1);
  validateRun(run, manifest, runId);
  for (const key of ['tag', 'version', 'commit', 'tagObject'])
    assert.equal(manifest[key], identity[key], `Wrong ${key}`);
  assert.equal(
    manifest.lockfileSha256,
    await hashFile(path.join(root, 'package-lock.json'))
  );
  validateLayout(manifest.files);
  const actual = (await fileInventory(handoff)).filter(
    file => file.path !== 'handoff.json'
  );
  assert.deepEqual(
    actual,
    manifest.files,
    'Handoff content changed or contains unexpected files'
  );
  return manifest;
}

async function exportHandoff(root, tag) {
  assert.equal(
    process.platform,
    'win32',
    'Export requires the Windows preflight build'
  );
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  const identity = sourceIdentity(root, tag);
  const output = path.join(root, 'dist/token-handoff');
  fs.mkdirSync(output); // Never overwrite an earlier candidate.
  fs.cpSync(
    path.join(root, 'dist/win-unpacked'),
    path.join(output, 'win-unpacked'),
    { recursive: true }
  );
  fs.cpSync(path.join(root, 'build'), path.join(output, 'build'), {
    recursive: true,
  });
  const files = await fileInventory(output);
  validateLayout(files);
  const manifest = {
    schema: 1,
    repository,
    ...identity,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    workflowCommit: process.env.GITHUB_SHA,
    lockfileSha256: await hashFile(path.join(root, 'package-lock.json')),
    files,
  };
  fs.writeFileSync(
    path.join(output, 'handoff.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' }
  );
  sourceIdentity(root, tag);
  console.log(
    `Prepared ${files.length} checksummed files for local signing of ${tag}. Nothing published.`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [command, root, tag, ...extra] = process.argv.slice(2);
  assert.ok(
    root && tag && !extra.length,
    'Usage: windows-token-handoff.mjs source|export ROOT TAG'
  );
  if (command === 'source')
    console.log(
      JSON.stringify(sourceIdentity(path.resolve(root), tag), null, 2)
    );
  else if (command === 'export') await exportHandoff(path.resolve(root), tag);
  else throw new Error(`Unknown command: ${command}`);
}
