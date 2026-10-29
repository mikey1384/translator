import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  encryptPrivateFile,
  readPrivateFileRange,
  wrapPrivateKey,
  unlockPrivateKey,
  sealPrivateJson,
  openPrivateJson,
} from '../services/private-library-crypto.js';

test('password wrapping binds the key to its folder; JSON authenticates context and bytes', async () => {
  const { config, key } = await wrapPrivateKey(
    'folder-a',
    'correct horse battery staple'
  );
  assert.deepEqual(
    await unlockPrivateKey('folder-a', 'correct horse battery staple', config),
    key
  );
  for (const [id, password] of [
    ['folder-a', 'wrong password'],
    ['folder-b', 'correct horse battery staple'],
  ]) {
    await assert.rejects(
      unlockPrivateKey(id, password, config),
      /incorrect_password/
    );
  }
  const sealed = sealPrivateJson(
    key,
    { title: 'Private test title', subtitles: '자막' },
    'entry-a'
  );
  assert.equal(sealed.includes(Buffer.from('Private test title')), false);
  assert.deepEqual(openPrivateJson(key, sealed, 'entry-a'), {
    title: 'Private test title',
    subtitles: '자막',
  });
  assert.throws(() => openPrivateJson(key, sealed, 'entry-b'), /corrupt/);
  sealed[sealed.length - 1] ^= 1;
  assert.throws(() => openPrivateJson(key, sealed, 'entry-a'), /corrupt/);
});

test('encrypted media supports authenticated seeks, rejects corruption before yielding and aborts on lock', async () => {
  const root = path.resolve('.local/private-library-tests');
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'crypto-'));
  try {
    const source = path.join(dir, 'input');
    const target = path.join(dir, 'encrypted');
    const data = randomBytes(2 * 1024 * 1024 + 117);
    const key = randomBytes(32);
    await fs.writeFile(source, data);
    const { size } = await encryptPrivateFile(source, target, key);
    const read = async (start?: number, end?: number) => {
      const parts: Buffer[] = [];
      for await (const part of readPrivateFileRange({
        filePath: target,
        key,
        size,
        start,
        end,
      }))
        parts.push(part);
      return Buffer.concat(parts);
    };
    assert.deepEqual(await read(), data);
    for (const [start, end] of [
      [0, 0],
      [1024 * 1024 - 2, 1024 * 1024 + 2],
      [size - 1, size - 1],
      [0, size - 1],
    ]) {
      assert.deepEqual(await read(start, end), data.subarray(start, end + 1));
    }
    const controller = new AbortController();
    const stream = readPrivateFileRange({
      filePath: target,
      key,
      size,
      signal: controller.signal,
    });
    assert.equal((await stream.next()).value.length, 1024 * 1024);
    controller.abort();
    await assert.rejects(stream.next());
    await assert.rejects(read(-1, 100), /invalid_range/);
    const original = await fs.readFile(target);
    for (const offset of [0, 9, 40, 48, 52, 52 + 1024 * 1024]) {
      const damaged = Buffer.from(original);
      damaged[offset] ^= 1;
      await fs.writeFile(target, damaged);
      const iterator = readPrivateFileRange({ filePath: target, key, size });
      await assert.rejects(iterator.next(), /corrupt/);
    }
    await fs.writeFile(target, original.subarray(0, original.length - 1));
    await assert.rejects(read(), /corrupt/);
    await fs.writeFile(target, original);
    const wrong = readPrivateFileRange({
      filePath: target,
      key: randomBytes(32),
      size,
    });
    await assert.rejects(wrong.next(), /corrupt/);
    const empty = path.join(dir, 'empty');
    await fs.writeFile(empty, '');
    const sealedEmpty = path.join(dir, 'empty-sealed');
    await encryptPrivateFile(empty, sealedEmpty, key);
    const chunks = [];
    for await (const chunk of readPrivateFileRange({
      filePath: sealedEmpty,
      key,
      size: 0,
    }))
      chunks.push(chunk);
    assert.equal(chunks.length, 0);
    const link = path.join(dir, 'link');
    await fs.symlink(source, link);
    if (process.platform !== 'win32')
      await assert.rejects(
        encryptPrivateFile(link, path.join(dir, 'no-follow'), key)
      );
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      encryptPrivateFile(source, path.join(dir, 'aborted'), key, aborted.signal)
    );
    await assert.rejects(fs.access(path.join(dir, 'aborted')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
