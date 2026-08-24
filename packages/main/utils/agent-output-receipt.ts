import { createHash, randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_RECEIPT_BYTES = 16 * 1024;
const TEMPORARY_OUTPUT_RESERVATION_KIND = 'temporary_master_reservation';
const MAX_AGENT_OUTPUT_BASE_NAME_UTF8_BYTES = 160;
const WINDOWS_RESERVED_BASENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function cleanAgentOutputBaseName(
  value: unknown,
  fallback = 'translator-output'
): string {
  let cleaned =
    String(value || fallback)
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim() || fallback;
  if (WINDOWS_RESERVED_BASENAME.test(cleaned)) cleaned = `_${cleaned}`;
  const segments = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  }).segment(cleaned);
  let result = '';
  let bytes = 0;
  for (const { segment } of segments) {
    const segmentBytes = Buffer.byteLength(segment);
    if (bytes + segmentBytes > MAX_AGENT_OUTPUT_BASE_NAME_UTF8_BYTES) break;
    result += segment;
    bytes += segmentBytes;
  }
  return result || fallback;
}

export function assertAgentOperationId(value: unknown): string {
  const operationId = String(value || '').trim();
  if (
    !operationId ||
    operationId.length > 200 ||
    /[\p{Cc}]/u.test(operationId)
  ) {
    throw new Error(
      'Agent operation ID must contain between 1 and 200 printable characters.'
    );
  }
  return operationId;
}

export function getAgentOutputReceiptPath(
  outputPath: string,
  operationId: string
): string {
  const operationDigest = createHash('sha256')
    .update(operationId)
    .digest('hex')
    .slice(0, 20);
  return path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${operationDigest}.translator-mcp-output.json`
  );
}

export function normalizeAgentOutputPathIdentity(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const resolved = pathApi.resolve(filePath);
  if (platform === 'win32') return resolved.toLocaleLowerCase('en-US');
  if (platform === 'darwin') {
    // Default macOS volumes are case-insensitive and Unicode-normalization
    // insensitive. Conservatively coalesce these aliases even on a
    // case-sensitive APFS volume; over-serialization is safe.
    return resolved.normalize('NFD').toLocaleLowerCase('en-US');
  }
  return resolved;
}

export function isAgentTemporaryMasterPath(
  filePath: string,
  operationId?: string
): boolean {
  const basename = path.basename(filePath);
  if (!/^.+\.mcp-master-[a-f0-9]{24}\.mp4$/i.test(basename)) return false;
  if (operationId === undefined) return true;
  const expectedSuffix = createHash('sha256')
    .update(assertAgentOperationId(operationId))
    .digest('hex')
    .slice(0, 24);
  return basename.endsWith(`.mcp-master-${expectedSuffix}.mp4`);
}

export async function pathsReferenceSameFile(
  leftPath: string,
  rightPath: string
): Promise<boolean> {
  const [leftRealPath, rightRealPath] = await Promise.all([
    fs.realpath(leftPath),
    fs.realpath(rightPath).catch(error => {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw error;
    }),
  ]);
  if (!rightRealPath) return false;
  if (path.resolve(leftRealPath) === path.resolve(rightRealPath)) {
    return true;
  }
  const [left, right] = await Promise.all([
    fs.stat(leftRealPath, { bigint: true }),
    fs.stat(rightRealPath, { bigint: true }),
  ]);
  return (
    left.isFile() &&
    right.isFile() &&
    left.ino !== 0n &&
    right.ino !== 0n &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

export async function assertAgentOutputDoesNotReferenceProtectedInputs(
  outputPath: string,
  value: unknown
): Promise<void> {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error(
      'Protected input paths must be an array of at most 16 paths.'
    );
  }
  for (const item of value) {
    const inputPath = String(item || '').trim();
    if (!inputPath || inputPath.length > 4096) {
      throw new Error(
        'Protected input paths must be non-empty and at most 4096 characters.'
      );
    }
    if (await pathsReferenceSameFile(path.resolve(inputPath), outputPath)) {
      throw new Error(
        `Agent output cannot overwrite workflow input: ${outputPath}`
      );
    }
  }
}

function stableFileSnapshot(stat: fsSync.BigIntStats): string[] {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(
    value => String(value)
  );
}

function sameFileSnapshot(
  left: fsSync.BigIntStats,
  right: fsSync.BigIntStats
): boolean {
  const leftSnapshot = stableFileSnapshot(left);
  const rightSnapshot = stableFileSnapshot(right);
  return leftSnapshot.every((value, index) => value === rightSnapshot[index]);
}

function privateAgentSiblingPath(
  referencePath: string,
  purpose: 'receipt' | 'replaced',
  extension = '.tmp'
): string {
  const referenceDigest = createHash('sha256')
    .update(path.basename(referencePath))
    .digest('hex')
    .slice(0, 16);
  return path.join(
    path.dirname(referencePath),
    `.translator-mcp-${purpose}-${referenceDigest}-${process.pid}-${randomUUID()}${extension}`
  );
}

export async function readStableBoundedUtf8File(
  filePath: string,
  maxBytes: number
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('Stable file reads require a non-negative byte limit.');
  }
  const pathBefore = await fs.lstat(filePath, { bigint: true });
  if (
    !pathBefore.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.size > BigInt(maxBytes)
  ) {
    throw new Error('Stable file read target is invalid or exceeds its limit.');
  }
  const flags =
    fsSync.constants.O_RDONLY |
    (process.platform === 'win32' ? 0 : (fsSync.constants.O_NOFOLLOW ?? 0));
  const handle = await fs.open(filePath, flags);
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.size > BigInt(maxBytes) ||
      !sameFileSnapshot(pathBefore, before)
    ) {
      throw new Error('Stable file read target changed before it was opened.');
    }
    const bytes = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset
      );
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(filePath, { bigint: true });
    if (
      offset > maxBytes ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      !sameFileSnapshot(before, after) ||
      !sameFileSnapshot(after, pathAfter)
    ) {
      throw new Error('Stable file read target changed while it was read.');
    }
    return bytes.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readStableAgentOutputReceipt(
  receiptPath: string
): Promise<Record<string, unknown> | null> {
  const pathBefore = await fs
    .lstat(receiptPath, { bigint: true })
    .catch(() => null);
  if (
    !pathBefore?.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.size > BigInt(MAX_RECEIPT_BYTES)
  ) {
    return null;
  }
  const flags =
    fsSync.constants.O_RDONLY |
    (process.platform === 'win32' ? 0 : (fsSync.constants.O_NOFOLLOW ?? 0));
  const handle = await fs.open(receiptPath, flags).catch(() => null);
  if (!handle) return null;
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.size > BigInt(MAX_RECEIPT_BYTES) ||
      !sameFileSnapshot(pathBefore, before)
    ) {
      return null;
    }
    const bytes = Buffer.alloc(MAX_RECEIPT_BYTES + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset
      );
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs
      .lstat(receiptPath, { bigint: true })
      .catch(() => null);
    if (
      offset > MAX_RECEIPT_BYTES ||
      !pathAfter?.isFile() ||
      pathAfter.isSymbolicLink() ||
      !sameFileSnapshot(before, after) ||
      !sameFileSnapshot(after, pathAfter)
    ) {
      return null;
    }
    const parsed: unknown = JSON.parse(bytes.subarray(0, offset).toString());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function fingerprintAgentOutputFile(
  filePath: string
): Promise<{ sha256: string; bytes: number }> {
  const pathBefore = await fs.lstat(filePath, { bigint: true });
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    throw new Error('Agent output integrity target is not a regular file.');
  }
  const flags =
    fsSync.constants.O_RDONLY |
    (process.platform === 'win32' ? 0 : (fsSync.constants.O_NOFOLLOW ?? 0));
  const handle = await fs.open(filePath, flags);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFileSnapshot(pathBefore, before)) {
      throw new Error('Agent output integrity target is not a regular file.');
    }
    const sha256 = await new Promise<string>((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = handle.createReadStream({ autoClose: false });
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(filePath, { bigint: true });
    if (
      !after.isFile() ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      !sameFileSnapshot(before, after) ||
      !sameFileSnapshot(after, pathAfter)
    ) {
      throw new Error(
        'Agent output changed while its integrity was being verified.'
      );
    }
    const bytes = Number(after.size);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error('Agent output size exceeds the supported integer range.');
    }
    return { sha256, bytes };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function sha256File(filePath: string): Promise<string> {
  return (await fingerprintAgentOutputFile(filePath)).sha256;
}

export async function publishAgentOutputFile({
  temporaryPath,
  outputPath,
  overwrite,
}: {
  temporaryPath: string;
  outputPath: string;
  overwrite: boolean;
}): Promise<void> {
  const temporaryStat = await fs.lstat(temporaryPath);
  if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink()) {
    throw new Error('Agent output temporary path is not a regular file.');
  }
  if (!overwrite) {
    // Same-directory hard linking atomically publishes the complete file and
    // fails closed if another writer wins the destination race.
    await fs.link(temporaryPath, outputPath);
    return;
  }

  const existing = await fs.lstat(outputPath).catch(() => null);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error('Agent output destination is not a regular file.');
  }
  try {
    // POSIX replaces an existing regular file atomically and never follows a
    // destination symlink. Windows may require the guarded unlink fallback.
    await fs.rename(temporaryPath, outputPath);
    return;
  } catch (error) {
    if (
      !existing ||
      !['EACCES', 'EEXIST', 'EPERM'].includes(
        String((error as NodeJS.ErrnoException)?.code || '')
      )
    ) {
      throw error;
    }
  }

  const current = await fs.lstat(outputPath).catch(() => null);
  if (!current?.isFile() || current.isSymbolicLink()) {
    throw new Error('Agent output destination changed before replacement.');
  }
  const backupPath = privateAgentSiblingPath(
    outputPath,
    'replaced',
    '.replaced'
  );
  await fs.rename(outputPath, backupPath);
  try {
    await fs.rename(temporaryPath, outputPath);
  } catch (publishError) {
    try {
      await fs.rename(backupPath, outputPath);
    } catch (restoreError) {
      throw new AggregateError(
        [publishError, restoreError],
        `Agent output replacement failed and the prior file could not be restored automatically. It remains at ${backupPath}.`
      );
    }
    throw publishError;
  }
  try {
    await fs.unlink(backupPath);
  } catch (cleanupError) {
    const error = new Error(
      `The new agent output was published, but the prior file could not be removed. It remains at ${backupPath}.`
    ) as Error & { code?: string; cause?: unknown };
    error.code = 'OUTPUT_REPLACEMENT_CLEANUP_FAILED';
    error.cause = cleanupError;
    throw error;
  }
}

export async function readAgentOutputReceipt({
  outputPath,
  operationId,
  kind,
}: {
  outputPath: string;
  operationId: string;
  kind: string;
}): Promise<Record<string, unknown> | null> {
  const outputStat = await fs.lstat(outputPath).catch(() => null);
  if (!outputStat?.isFile() || outputStat.isSymbolicLink()) return null;
  const receiptPath = getAgentOutputReceiptPath(outputPath, operationId);
  const receipt = await readStableAgentOutputReceipt(receiptPath);
  if (!receipt) return null;
  if (
    receipt.schema_version !== 1 ||
    receipt.operation_id !== operationId ||
    receipt.kind !== kind ||
    receipt.output_path !== outputPath ||
    Number(receipt.bytes) !== outputStat.size ||
    !/^[a-f0-9]{64}$/.test(String(receipt.sha256 || ''))
  ) {
    return null;
  }
  const fingerprint = await fingerprintAgentOutputFile(outputPath);
  if (
    fingerprint.sha256 !== receipt.sha256 ||
    fingerprint.bytes !== Number(receipt.bytes)
  ) {
    return null;
  }
  return fingerprint;
}

async function readAgentOutputReceiptMetadata({
  outputPath,
  operationId,
  kind,
}: {
  outputPath: string;
  operationId: string;
  kind: string;
}): Promise<Record<string, unknown> | null> {
  const receiptPath = getAgentOutputReceiptPath(outputPath, operationId);
  const receipt = await readStableAgentOutputReceipt(receiptPath);
  return receipt?.schema_version === 1 &&
    receipt.operation_id === operationId &&
    receipt.kind === kind &&
    receipt.output_path === outputPath
    ? receipt
    : null;
}

export async function readAgentTemporaryOutputReservation({
  outputPath,
  operationId,
}: {
  outputPath: string;
  operationId: string;
}): Promise<Record<string, unknown> | null> {
  return readAgentOutputReceiptMetadata({
    outputPath,
    operationId,
    kind: TEMPORARY_OUTPUT_RESERVATION_KIND,
  });
}

export async function readAgentTemporaryOutputReceiptMetadata({
  outputPath,
  operationId,
}: {
  outputPath: string;
  operationId: string;
}): Promise<Record<string, unknown> | null> {
  return readAgentOutputReceiptMetadata({
    outputPath,
    operationId,
    kind: 'temporary_master',
  });
}

export async function writeAgentTemporaryOutputReservation({
  outputPath,
  operationId,
  authorizePath = value => value,
}: {
  outputPath: string;
  operationId: string;
  authorizePath?: (value: string, label: string) => string;
}): Promise<string> {
  const cleanOperationId = assertAgentOperationId(operationId);
  const receiptPath = authorizePath(
    getAgentOutputReceiptPath(outputPath, cleanOperationId),
    'Agent temporary-output reservation'
  );
  const existing = await fs.lstat(receiptPath).catch(() => null);
  if (existing) {
    const reservation = await readAgentTemporaryOutputReservation({
      outputPath,
      operationId: cleanOperationId,
    });
    if (reservation) return receiptPath;
    throw new Error(
      'Agent temporary-output reservation path contains unrelated data and will not be overwritten.'
    );
  }

  const temporaryPath = authorizePath(
    privateAgentSiblingPath(receiptPath, 'receipt'),
    'Agent temporary-output reservation temporary file'
  );
  const reservation = {
    schema_version: 1,
    operation_id: cleanOperationId,
    kind: TEMPORARY_OUTPUT_RESERVATION_KIND,
    output_path: outputPath,
  };
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(reservation)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    try {
      await publishAgentOutputFile({
        temporaryPath,
        outputPath: receiptPath,
        overwrite: false,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
      const concurrent = await readAgentTemporaryOutputReservation({
        outputPath,
        operationId: cleanOperationId,
      });
      if (!concurrent) throw error;
    }
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
  return receiptPath;
}

export async function writeAgentOutputReceipt({
  outputPath,
  operationId,
  kind,
  bytes,
  sha256,
  authorizePath = value => value,
  allowedPriorKinds = [],
}: {
  outputPath: string;
  operationId: string;
  kind: string;
  bytes: number;
  sha256: string;
  authorizePath?: (value: string, label: string) => string;
  allowedPriorKinds?: string[];
}): Promise<string> {
  const cleanOperationId = assertAgentOperationId(operationId);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(
      'Agent output receipt bytes must be a non-negative integer.'
    );
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Agent output receipt SHA-256 is invalid.');
  }
  const receiptPath = authorizePath(
    getAgentOutputReceiptPath(outputPath, cleanOperationId),
    'Agent output ownership receipt'
  );
  const temporaryPath = authorizePath(
    privateAgentSiblingPath(receiptPath, 'receipt'),
    'Agent output ownership receipt temporary file'
  );
  const receipt = {
    schema_version: 1,
    operation_id: cleanOperationId,
    kind,
    output_path: outputPath,
    bytes,
    sha256,
  };
  const existing = await fs.lstat(receiptPath).catch(() => null);
  if (existing) {
    if (
      !existing.isFile() ||
      existing.isSymbolicLink() ||
      existing.size > MAX_RECEIPT_BYTES
    ) {
      throw new Error(
        'Agent output receipt destination is not an owned regular receipt file.'
      );
    }
    const prior = await readStableAgentOutputReceipt(receiptPath);
    if (!prior) {
      throw new Error(
        'Agent output receipt destination contains unrelated data and will not be overwritten.'
      );
    }
    if (
      prior.schema_version !== 1 ||
      prior.operation_id !== cleanOperationId ||
      (prior.kind !== kind &&
        !allowedPriorKinds.includes(String(prior.kind))) ||
      prior.output_path !== outputPath
    ) {
      throw new Error(
        'Agent output receipt destination belongs to another operation and will not be overwritten.'
      );
    }
  }
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(receipt)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await publishAgentOutputFile({
      temporaryPath,
      outputPath: receiptPath,
      overwrite: true,
    });
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
  return receiptPath;
}
