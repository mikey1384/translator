import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertAgentOutputDoesNotReferenceProtectedInputs,
  assertAgentOperationId,
  cleanAgentOutputBaseName,
  fingerprintAgentOutputFile,
  getAgentOutputReceiptPath,
  isAgentTemporaryMasterPath,
  normalizeAgentOutputPathIdentity,
  pathsReferenceSameFile,
  publishAgentOutputFile,
  readAgentOutputReceipt,
  readStableBoundedUtf8File,
  readAgentTemporaryOutputReservation,
  sha256File,
  writeAgentOutputReceipt,
  writeAgentTemporaryOutputReservation,
} from '../utils/agent-output-receipt.js';

test('agent output base names preserve Unicode safely and avoid Windows devices', () => {
  assert.equal(cleanAgentOutputBaseName('한국어 미리보기'), '한국어 미리보기');
  assert.equal(cleanAgentOutputBaseName('CON'), '_CON');
  assert.equal(cleanAgentOutputBaseName('bad/name?.mp4 '), 'bad-name-.mp4');
  const emoji = cleanAgentOutputBaseName('😀'.repeat(180));
  assert.ok(Buffer.byteLength(emoji) <= 160);
  assert.equal([...emoji].length, 40);
  assert.equal(emoji.endsWith('\ud83d'), false);
});

test('case-insensitive platform output identities fold filesystem aliases', () => {
  assert.equal(
    normalizeAgentOutputPathIdentity('C:\\Output\\Video.MP4', 'win32'),
    normalizeAgentOutputPathIdentity('c:\\output\\video.mp4', 'win32')
  );
  assert.equal(
    normalizeAgentOutputPathIdentity('/Output/Caf\u00e9.MP4', 'darwin'),
    normalizeAgentOutputPathIdentity('/output/Cafe\u0301.mp4', 'darwin')
  );
  assert.notEqual(
    normalizeAgentOutputPathIdentity('/Output/Video.MP4', 'linux'),
    normalizeAgentOutputPathIdentity('/output/video.mp4', 'linux')
  );
});

test('temporary-master deletion identities are exact and bounded', () => {
  const operationId = 'mcp-v2:job:render_outputs';
  const suffix = createHash('sha256')
    .update(operationId)
    .digest('hex')
    .slice(0, 24);
  const ownedPath = `/tmp/movie.mcp-master-${suffix}.mp4`;
  assert.equal(isAgentTemporaryMasterPath(ownedPath), true);
  assert.equal(isAgentTemporaryMasterPath(ownedPath, operationId), true);
  assert.equal(
    isAgentTemporaryMasterPath(ownedPath, 'mcp-v2:another-job:render_outputs'),
    false
  );
  assert.equal(
    isAgentTemporaryMasterPath('/tmp/movie.mcp-master-user-backup.mp4'),
    false
  );
  assert.equal(
    isAgentTemporaryMasterPath(
      '/tmp/movie.mcp-master-0123456789abcdef01234567.mp4.bak'
    ),
    false
  );
});

test('source-output identity detects symlink and hard-link aliases', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-identity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.mp4');
  const distinct = path.join(root, 'distinct.mp4');
  const hardLink = path.join(root, 'hard-link.mp4');
  const symbolicLink = path.join(root, 'symbolic-link.mp4');
  await fs.writeFile(source, 'source');
  await fs.writeFile(distinct, 'distinct');
  await fs.link(source, hardLink);
  const symbolicLinkCreated = await fs
    .symlink(source, symbolicLink)
    .then(() => true)
    .catch(error => {
      if (['EACCES', 'EPERM'].includes(String(error?.code || ''))) return false;
      throw error;
    });

  assert.equal(await pathsReferenceSameFile(source, source), true);
  assert.equal(await pathsReferenceSameFile(source, hardLink), true);
  if (symbolicLinkCreated) {
    assert.equal(await pathsReferenceSameFile(source, symbolicLink), true);
  }
  assert.equal(await pathsReferenceSameFile(source, distinct), false);
  assert.equal(
    await pathsReferenceSameFile(source, path.join(root, 'missing.mp4')),
    false
  );
  await assert.rejects(
    () => assertAgentOutputDoesNotReferenceProtectedInputs(hardLink, [source]),
    /cannot overwrite workflow input/i
  );
  await assert.doesNotReject(() =>
    assertAgentOutputDoesNotReferenceProtectedInputs(distinct, [source])
  );
  await assert.rejects(
    () =>
      assertAgentOutputDoesNotReferenceProtectedInputs(distinct, [
        ...Array.from({ length: 17 }, () => source),
      ]),
    /at most 16 paths/i
  );
});

test('output fingerprints reject symbolic links instead of following them', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-fingerprint-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'target.mp4');
  const symbolicLink = path.join(root, 'symbolic-link.mp4');
  await fs.writeFile(target, 'target');
  const created = await fs
    .symlink(target, symbolicLink)
    .then(() => true)
    .catch(error => {
      if (['EACCES', 'EPERM'].includes(String(error?.code || ''))) return false;
      throw error;
    });
  if (!created) return;

  await assert.rejects(
    () => fingerprintAgentOutputFile(symbolicLink),
    /not a regular file/i
  );
});

test('output fingerprints accept ctime-only churn only after a stable second hash', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-fingerprint-metadata-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, 'metadata-churn.mp4');
  await fs.writeFile(outputPath, 'stable output');

  const originalLstat = fs.lstat;
  let outputLstatCalls = 0;
  (fs as any).lstat = async (...args: any[]) => {
    const stat = await originalLstat(args[0], args[1]);
    if (String(args[0]) !== outputPath) return stat;
    outputLstatCalls += 1;
    if (outputLstatCalls !== 2 || typeof stat.ctimeNs !== 'bigint') {
      return stat;
    }
    return new Proxy(stat, {
      get(target, property, receiver) {
        if (property === 'ctimeNs') return target.ctimeNs + 1n;
        return Reflect.get(target, property, receiver);
      },
    });
  };
  try {
    assert.deepEqual(await fingerprintAgentOutputFile(outputPath), {
      sha256: createHash('sha256').update('stable output').digest('hex'),
      bytes: Buffer.byteLength('stable output'),
    });
  } finally {
    (fs as any).lstat = originalLstat;
  }
  assert.ok(outputLstatCalls >= 4, 'metadata churn must force a second pass');
});

test('output fingerprints reject a same-size rewrite between stability passes', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-fingerprint-rewrite-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, 'rewritten.mp4');
  const fixedTime = new Date('2024-01-01T00:00:00.000Z');
  await fs.writeFile(outputPath, 'AAAA');
  await fs.utimes(outputPath, fixedTime, fixedTime);

  const originalLstat = fs.lstat;
  let outputLstatCalls = 0;
  (fs as any).lstat = async (...args: any[]) => {
    if (String(args[0]) === outputPath) {
      outputLstatCalls += 1;
      if (outputLstatCalls === 2) {
        await fs.writeFile(outputPath, 'BBBB');
        await fs.utimes(outputPath, fixedTime, fixedTime);
      }
    }
    return originalLstat(args[0], args[1]);
  };
  try {
    await assert.rejects(
      () => fingerprintAgentOutputFile(outputPath),
      /changed while its integrity was being verified/i
    );
  } finally {
    (fs as any).lstat = originalLstat;
  }
  assert.ok(outputLstatCalls >= 3, 'the rewrite must reach a second pass');
});

test('an exact output receipt makes a completed operation safely reusable', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-receipt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const preparedPath = path.join(root, 'prepared.mp4');
  const outputPath = path.join(root, 'finished.mp4');
  const operationId = 'mcp-v2:job-1:render-encode-1';
  await fs.writeFile(preparedPath, 'encoded artifact');
  const bytes = (await fs.stat(preparedPath)).size;
  const sha256 = await sha256File(preparedPath);

  const receiptPath = await writeAgentOutputReceipt({
    outputPath,
    operationId,
    kind: 'youtube_1080p',
    bytes,
    sha256,
  });
  await fs.copyFile(preparedPath, outputPath);
  const reusable = await readAgentOutputReceipt({
    outputPath,
    operationId,
    kind: 'youtube_1080p',
  });
  assert.deepEqual(reusable, {
    sha256,
    bytes,
  });
  assert.equal(receiptPath, getAgentOutputReceiptPath(outputPath, operationId));
});

test('receipt reads reject a sidecar replaced between path check and handle open', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-receipt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, 'finished.mp4');
  const operationId = 'mcp-v2:job-race:render-encode-1';
  await fs.writeFile(outputPath, 'encoded artifact');
  const bytes = (await fs.stat(outputPath)).size;
  const sha256 = await sha256File(outputPath);
  const receiptPath = await writeAgentOutputReceipt({
    outputPath,
    operationId,
    kind: 'youtube_1080p',
    bytes,
    sha256,
  });
  const replacementPath = `${receiptPath}.replacement`;
  const displacedPath = `${receiptPath}.displaced`;
  await fs.copyFile(receiptPath, replacementPath);

  const originalLstat = fs.lstat;
  let swapped = false;
  (fs as any).lstat = async (...args: any[]) => {
    const stat = await originalLstat(args[0], args[1]);
    if (!swapped && String(args[0]) === receiptPath) {
      swapped = true;
      await fs.rename(receiptPath, displacedPath);
      await fs.rename(replacementPath, receiptPath);
    }
    return stat;
  };
  let raced;
  try {
    raced = await readAgentOutputReceipt({
      outputPath,
      operationId,
      kind: 'youtube_1080p',
    });
  } finally {
    (fs as any).lstat = originalLstat;
  }

  assert.equal(swapped, true);
  assert.equal(raced, null);
  assert.deepEqual(
    await readAgentOutputReceipt({
      outputPath,
      operationId,
      kind: 'youtube_1080p',
    }),
    { bytes, sha256 }
  );
});

test('bounded text reads reject a file replaced between path check and handle open', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-text-read-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const textPath = path.join(root, 'manifest.json');
  const replacementPath = path.join(root, 'replacement.json');
  const displacedPath = path.join(root, 'displaced.json');
  await fs.writeFile(textPath, '{"stable":true}');
  await fs.writeFile(replacementPath, '{"attacker":true}');

  const originalLstat = fs.lstat;
  let swapped = false;
  (fs as any).lstat = async (...args: any[]) => {
    const stat = await originalLstat(args[0], args[1]);
    if (!swapped && String(args[0]) === textPath) {
      swapped = true;
      await fs.rename(textPath, displacedPath);
      await fs.rename(replacementPath, textPath);
    }
    return stat;
  };
  try {
    await assert.rejects(
      () => readStableBoundedUtf8File(textPath, 1024),
      /changed before it was opened/i
    );
  } finally {
    (fs as any).lstat = originalLstat;
  }

  assert.equal(swapped, true);
  assert.equal(
    await readStableBoundedUtf8File(textPath, 1024),
    '{"attacker":true}'
  );
  await assert.rejects(
    () => readStableBoundedUtf8File(textPath, 4),
    /exceeds its limit/i
  );
});

test('changed content, another operation, or another preset cannot reuse an output', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-receipt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, 'finished.mp4');
  const operationId = 'mcp-v2:job-2:render-encode-1';
  await fs.writeFile(outputPath, 'original');
  await writeAgentOutputReceipt({
    outputPath,
    operationId,
    kind: 'x_long_video_720p',
    bytes: (await fs.stat(outputPath)).size,
    sha256: await sha256File(outputPath),
  });

  assert.equal(
    await readAgentOutputReceipt({
      outputPath,
      operationId: 'mcp-v2:another-job:render-encode-1',
      kind: 'x_long_video_720p',
    }),
    null
  );
  assert.equal(
    await readAgentOutputReceipt({
      outputPath,
      operationId,
      kind: 'youtube_1080p',
    }),
    null
  );
  await fs.writeFile(outputPath, 'tampered');
  assert.equal(
    await readAgentOutputReceipt({
      outputPath,
      operationId,
      kind: 'x_long_video_720p',
    }),
    null
  );
});

test('receipt publication never overwrites unrelated sidecar content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-receipt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, 'finished.mp4');
  const operationId = 'mcp-v2:job-3:render-encode-1';
  await fs.writeFile(outputPath, 'encoded');
  const receiptPath = getAgentOutputReceiptPath(outputPath, operationId);
  await fs.writeFile(receiptPath, 'user-owned sidecar content');
  const outputBytes = (await fs.stat(outputPath)).size;
  const outputSha256 = await sha256File(outputPath);

  await assert.rejects(
    () =>
      writeAgentOutputReceipt({
        outputPath,
        operationId,
        kind: 'youtube_1080p',
        bytes: outputBytes,
        sha256: outputSha256,
      }),
    /unrelated data/i
  );
  assert.equal(
    await fs.readFile(receiptPath, 'utf8'),
    'user-owned sidecar content'
  );
});

test('maximum-length outputs use bounded private receipt and replacement names', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-receipt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, `${'a'.repeat(160)}-verified-1.png`);
  const operationId = 'mcp-v2:job-long-name:verified-output-frame-1';
  await fs.writeFile(outputPath, 'first');
  let fingerprint = await fingerprintAgentOutputFile(outputPath);
  const receiptPath = await writeAgentOutputReceipt({
    outputPath,
    operationId,
    kind: 'verified_output_frame_1',
    ...fingerprint,
  });
  assert.ok(Buffer.byteLength(path.basename(receiptPath)) <= 255);

  await fs.writeFile(outputPath, 'second');
  fingerprint = await fingerprintAgentOutputFile(outputPath);
  await writeAgentOutputReceipt({
    outputPath,
    operationId,
    kind: 'verified_output_frame_1',
    ...fingerprint,
  });
  assert.deepEqual(
    await readAgentOutputReceipt({
      outputPath,
      operationId,
      kind: 'verified_output_frame_1',
    }),
    fingerprint
  );

  const replacementPath = path.join(root, `${'b'.repeat(240)}.mp4`);
  const replacementTemp = path.join(root, 'replacement.tmp');
  await fs.writeFile(replacementPath, 'old');
  await fs.writeFile(replacementTemp, 'new');
  const originalRename = fs.rename;
  let forcedWindowsFallback = false;
  fs.rename = async (...args) => {
    if (
      !forcedWindowsFallback &&
      args[0] === replacementTemp &&
      args[1] === replacementPath
    ) {
      forcedWindowsFallback = true;
      const error = new Error('simulated Windows replacement') as Error & {
        code?: string;
      };
      error.code = 'EPERM';
      throw error;
    }
    return originalRename(...args);
  };
  try {
    await publishAgentOutputFile({
      temporaryPath: replacementTemp,
      outputPath: replacementPath,
      overwrite: true,
    });
  } finally {
    fs.rename = originalRename;
  }
  assert.equal(forcedWindowsFallback, true);
  assert.equal(await fs.readFile(replacementPath, 'utf8'), 'new');
  assert.deepEqual(
    (await fs.readdir(root)).filter(name => name.endsWith('.replaced')),
    []
  );
});

test('temporary output reservation survives the pre-claim crash window', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-reserve-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const operationId = 'mcp-v2:job-4:render_outputs';
  const suffix = createHash('sha256')
    .update(operationId)
    .digest('hex')
    .slice(0, 24);
  const outputPath = path.join(root, `movie.mcp-master-${suffix}.mp4`);

  const receiptPath = await writeAgentTemporaryOutputReservation({
    outputPath,
    operationId,
  });
  assert.ok(
    await readAgentTemporaryOutputReservation({ outputPath, operationId })
  );

  // The renderer can finish the master before the main process receives its
  // final claim. The reservation remains an exact ownership checkpoint.
  await fs.writeFile(outputPath, 'completed subtitle master');
  assert.ok(
    await readAgentTemporaryOutputReservation({ outputPath, operationId })
  );

  const bytes = (await fs.stat(outputPath)).size;
  const sha256 = await sha256File(outputPath);
  await writeAgentOutputReceipt({
    outputPath,
    operationId,
    kind: 'temporary_master',
    bytes,
    sha256,
    allowedPriorKinds: ['temporary_master_reservation'],
  });
  assert.deepEqual(
    await readAgentOutputReceipt({
      outputPath,
      operationId,
      kind: 'temporary_master',
    }),
    { bytes, sha256 }
  );
  assert.equal(
    await readAgentTemporaryOutputReservation({ outputPath, operationId }),
    null
  );
  assert.equal(receiptPath, getAgentOutputReceiptPath(outputPath, operationId));
});

test('temporary reservations never overwrite another operation sidecar', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-reserve-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(
    root,
    'movie.mcp-master-0123456789abcdef01234567.mp4'
  );
  const operationId = 'mcp-v2:job-5:render_outputs';
  const receiptPath = getAgentOutputReceiptPath(outputPath, operationId);
  await fs.writeFile(receiptPath, 'unrelated sidecar');

  await assert.rejects(
    () => writeAgentTemporaryOutputReservation({ outputPath, operationId }),
    /unrelated data/i
  );
  assert.equal(await fs.readFile(receiptPath, 'utf8'), 'unrelated sidecar');
});

test('operation receipt identities are bounded printable values', () => {
  assert.equal(
    assertAgentOperationId(' stable-operation '),
    'stable-operation'
  );
  assert.throws(() => assertAgentOperationId(''), /between 1 and 200/);
  assert.throws(
    () => assertAgentOperationId(`bad\noperation`),
    /between 1 and 200/
  );
  assert.throws(
    () => assertAgentOperationId('x'.repeat(201)),
    /between 1 and 200/
  );
});

test('agent outputs publish complete temporary files without partial overwrite', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-publish-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, 'output.txt');
  const firstTemporary = path.join(root, 'first.tmp');
  await fs.writeFile(outputPath, 'old complete content');
  await fs.writeFile(firstTemporary, 'new complete content');

  await assert.rejects(
    () =>
      publishAgentOutputFile({
        temporaryPath: firstTemporary,
        outputPath,
        overwrite: false,
      }),
    error => (error as NodeJS.ErrnoException).code === 'EEXIST'
  );
  assert.equal(await fs.readFile(outputPath, 'utf8'), 'old complete content');

  const secondTemporary = path.join(root, 'second.tmp');
  await fs.writeFile(secondTemporary, 'new complete content');
  await publishAgentOutputFile({
    temporaryPath: secondTemporary,
    outputPath,
    overwrite: true,
  });
  assert.equal(await fs.readFile(outputPath, 'utf8'), 'new complete content');
  assert.equal(await fs.lstat(secondTemporary).catch(() => null), null);
});

test('agent output replacement refuses a non-regular destination', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translator-publish-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const temporaryPath = path.join(root, 'prepared.tmp');
  const outputPath = path.join(root, 'destination');
  await fs.writeFile(temporaryPath, 'prepared');
  await fs.mkdir(outputPath);
  await assert.rejects(
    () =>
      publishAgentOutputFile({
        temporaryPath,
        outputPath,
        overwrite: true,
      }),
    /destination is not a regular file/i
  );
  assert.equal(await fs.readFile(temporaryPath, 'utf8'), 'prepared');
});
