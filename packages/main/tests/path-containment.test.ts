import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  canonicalizeAgentOutputPath,
  isCanonicalPathInsideAllowedDirectories,
  isPathInsideAllowedDirectories,
} from '../utils/path-containment.js';

test('agent output containment accepts existing and new files under an allowed directory', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-path-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const allowed = path.join(root, 'allowed');
  await fs.mkdir(allowed);
  const existing = path.join(allowed, 'existing.srt');
  await fs.writeFile(existing, 'test');

  assert.equal(isPathInsideAllowedDirectories(existing, [allowed]), true);
  assert.equal(
    isPathInsideAllowedDirectories(path.join(allowed, 'new.srt'), [allowed]),
    true
  );
});

test('agent output containment rejects prefix lookalikes and missing parents', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-path-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const allowed = path.join(root, 'allowed');
  const lookalike = path.join(root, 'allowed-elsewhere');
  await Promise.all([fs.mkdir(allowed), fs.mkdir(lookalike)]);

  assert.equal(
    isPathInsideAllowedDirectories(path.join(lookalike, 'new.srt'), [allowed]),
    false
  );
  assert.equal(
    isPathInsideAllowedDirectories(
      path.join(allowed, 'missing-parent', 'new.srt'),
      [allowed]
    ),
    false
  );
});

test('agent output containment rejects an allowlist entry that is a file', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-path-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const allowedFile = path.join(root, 'not-a-directory');
  await fs.writeFile(allowedFile, 'test');

  assert.equal(
    isPathInsideAllowedDirectories(allowedFile, [allowedFile]),
    false
  );
});

test(
  'agent output containment rejects a new file beneath a symlink escaping the allowlist',
  { skip: process.platform === 'win32' },
  async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-path-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const allowed = path.join(root, 'allowed');
    const outside = path.join(root, 'outside');
    await Promise.all([fs.mkdir(allowed), fs.mkdir(outside)]);
    await fs.symlink(outside, path.join(allowed, 'escape'));

    assert.equal(
      isPathInsideAllowedDirectories(path.join(allowed, 'escape', 'new.srt'), [
        allowed,
      ]),
      false
    );
  }
);

test(
  'agent output authorization returns the stable canonical parent for an allowed symlink alias',
  { skip: process.platform === 'win32' },
  async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-path-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const allowed = path.join(root, 'allowed');
    const alias = path.join(root, 'allowed-alias');
    await fs.mkdir(allowed);
    await fs.symlink(allowed, alias);

    const requested = path.join(alias, 'new.srt');
    const canonical = canonicalizeAgentOutputPath(requested);
    assert.equal(canonical, path.join(await fs.realpath(allowed), 'new.srt'));
    assert.equal(
      canonical !== null &&
        isCanonicalPathInsideAllowedDirectories(canonical, [allowed]),
      true
    );
  }
);

test(
  'agent output containment rejects a dangling destination symlink escaping the allowlist',
  { skip: process.platform === 'win32' },
  async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-path-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const allowed = path.join(root, 'allowed');
    const outside = path.join(root, 'outside');
    await Promise.all([fs.mkdir(allowed), fs.mkdir(outside)]);
    const escapedOutput = path.join(outside, 'new.srt');
    const danglingOutput = path.join(allowed, 'new.srt');
    await fs.symlink(escapedOutput, danglingOutput);

    assert.equal(
      isPathInsideAllowedDirectories(danglingOutput, [allowed]),
      false
    );
  }
);
