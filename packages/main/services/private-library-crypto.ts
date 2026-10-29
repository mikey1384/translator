import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  scrypt,
} from 'node:crypto';
import { constants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';

const CHUNK_SIZE = 1024 * 1024;
const HEADER_SIZE = 52;
const TAG_SIZE = 16;
const MAGIC = Buffer.from('S5VAULT1');
const MAX_FILE_SIZE = 512 * 1024 ** 3;
const MAX_JSON_SIZE = 32 * 1024 ** 2;

export class PrivateLibraryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PrivateLibraryError';
  }
}

export type WrappedPrivateKey = {
  version: 1;
  salt: string;
  wrappedKey: string;
};

function envelopeKey(key: Buffer, salt: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', key, salt, purpose, 32));
}

function sealBytes(key: Buffer, plaintext: Buffer, context: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

function openBytes(key: Buffer, sealed: Buffer, context: string): Buffer {
  if (sealed.length < 28) throw new PrivateLibraryError('corrupt');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(sealed.subarray(12, 28));
  // Never publish unauthenticated plaintext from decipher.update().
  const pending = decipher.update(sealed.subarray(28));
  try {
    return Buffer.concat([pending, decipher.final()]);
  } finally {
    pending.fill(0);
  }
}

async function passwordKey(password: string, salt: Buffer): Promise<Buffer> {
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    Buffer.byteLength(password) > 1024
  )
    throw new PrivateLibraryError('password_length');
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      32,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 ** 2 },
      (error, key) =>
        error ? reject(new PrivateLibraryError('crypto_failed')) : resolve(key)
    )
  );
}

export async function wrapPrivateKey(
  folderId: string,
  password: string,
  key: Buffer = randomBytes(32)
): Promise<{ config: WrappedPrivateKey; key: Buffer }> {
  if (key.length !== 32) throw new PrivateLibraryError('corrupt');
  const salt = randomBytes(32);
  const derived = await passwordKey(password, salt);
  try {
    return {
      config: {
        version: 1,
        salt: salt.toString('base64'),
        wrappedKey: sealBytes(
          derived,
          key,
          `stage5-private-key-v1:${folderId}`
        ).toString('base64'),
      },
      key,
    };
  } finally {
    derived.fill(0);
  }
}

export async function unlockPrivateKey(
  folderId: string,
  password: string,
  config: WrappedPrivateKey
): Promise<Buffer> {
  if (
    config?.version !== 1 ||
    typeof config.salt !== 'string' ||
    config.salt.length !== 44 ||
    typeof config.wrappedKey !== 'string' ||
    config.wrappedKey.length !== 80
  )
    throw new PrivateLibraryError('corrupt');
  const salt = Buffer.from(config.salt, 'base64');
  const wrapped = Buffer.from(config.wrappedKey, 'base64');
  if (salt.length !== 32 || wrapped.length !== 60)
    throw new PrivateLibraryError('corrupt');
  const derived = await passwordKey(password, salt);
  try {
    return openBytes(derived, wrapped, `stage5-private-key-v1:${folderId}`);
  } catch {
    throw new PrivateLibraryError('incorrect_password');
  } finally {
    derived.fill(0);
  }
}

export function sealPrivateJson(
  key: Buffer,
  value: unknown,
  context: string
): Buffer {
  const plaintext = Buffer.from(JSON.stringify(value));
  try {
    if (plaintext.length > MAX_JSON_SIZE)
      throw new PrivateLibraryError('too_large');
    return sealBytes(key, plaintext, `stage5-private-json-v1:${context}`);
  } finally {
    plaintext.fill(0);
  }
}

export function openPrivateJson<T>(
  key: Buffer,
  sealed: Buffer,
  context: string
): T {
  if (sealed.length > MAX_JSON_SIZE + 28)
    throw new PrivateLibraryError('too_large');
  let plaintext: Buffer | undefined;
  try {
    plaintext = openBytes(key, sealed, `stage5-private-json-v1:${context}`);
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    throw new PrivateLibraryError('corrupt');
  } finally {
    plaintext?.fill(0);
  }
}

function chunkNonce(index: number): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeUInt32BE(index, 8);
  return nonce;
}

function chunkAad(header: Buffer, index: number): Buffer {
  const number = Buffer.alloc(4);
  number.writeUInt32BE(index);
  return Buffer.concat([header, number]);
}

async function readExact(
  file: FileHandle,
  length: number,
  position: number
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let received = 0;
  while (received < length) {
    const { bytesRead } = await file.read(
      buffer,
      received,
      length - received,
      position + received
    );
    if (!bytesRead) throw new PrivateLibraryError('corrupt');
    received += bytesRead;
  }
  return buffer;
}

async function writeAll(file: FileHandle, buffer: Buffer): Promise<void> {
  let written = 0;
  while (written < buffer.length) {
    const { bytesWritten } = await file.write(
      buffer,
      written,
      buffer.length - written
    );
    if (!bytesWritten) throw new PrivateLibraryError('storage_failed');
    written += bytesWritten;
  }
}

/** Authenticated independent chunks allow seeking without plaintext files or
 * buffering an entire film. Each file has a fresh HKDF-derived key; each chunk
 * has a distinct nonce and authenticates the header and its position.
 */
export async function encryptPrivateFile(
  sourcePath: string,
  destinationPath: string,
  folderKey: Buffer,
  signal?: AbortSignal
): Promise<{ size: number }> {
  const source = await fs.open(
    sourcePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
  );
  let destination: FileHandle | undefined;
  let fileKey: Buffer | undefined;
  let complete = false;
  try {
    const before = await source.stat();
    if (!before.isFile() || before.size > MAX_FILE_SIZE)
      throw new PrivateLibraryError('unsupported_file');
    destination = await fs.open(destinationPath, 'wx', 0o600);
    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC.copy(header);
    randomBytes(32).copy(header, 8);
    header.writeBigUInt64BE(BigInt(before.size), 40);
    header.writeUInt32BE(CHUNK_SIZE, 48);
    fileKey = envelopeKey(
      folderKey,
      header.subarray(8, 40),
      'stage5-private-file-v1'
    );
    await writeAll(destination, header);
    const chunks = Math.max(1, Math.ceil(before.size / CHUNK_SIZE));
    for (let index = 0; index < chunks; index++) {
      signal?.throwIfAborted();
      const length = Math.min(CHUNK_SIZE, before.size - index * CHUNK_SIZE);
      const plaintext = await readExact(source, length, index * CHUNK_SIZE);
      try {
        const cipher = createCipheriv(
          'aes-256-gcm',
          fileKey,
          chunkNonce(index)
        );
        cipher.setAAD(chunkAad(header, index));
        await writeAll(
          destination,
          Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
            cipher.getAuthTag(),
          ])
        );
      } finally {
        plaintext.fill(0);
      }
    }
    const after = await source.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new PrivateLibraryError('source_changed');
    await destination.sync();
    complete = true;
    return { size: before.size };
  } finally {
    fileKey?.fill(0);
    try {
      await source.close();
    } finally {
      try {
        await destination?.close();
      } finally {
        if (destination && !complete)
          await fs.rm(destinationPath, { force: true });
      }
    }
  }
}

/** Every yielded byte has passed GCM authentication. Cancel/lock terminates
 * active streams; only small authenticated chunks exist in process memory.
 */
export async function* readPrivateFileRange(options: {
  filePath: string;
  key: Buffer;
  size: number;
  start?: number;
  end?: number;
  signal?: AbortSignal;
}): AsyncGenerator<Buffer> {
  const { filePath, key, size, signal } = options;
  const start = options.start ?? 0;
  const end = options.end ?? Math.max(0, size - 1);
  if (
    ![size, start, end].every(Number.isSafeInteger) ||
    size < 0 ||
    size > MAX_FILE_SIZE ||
    start < 0 ||
    end < start ||
    (size > 0 && end >= size) ||
    (size === 0 && (start || end))
  )
    throw new PrivateLibraryError('invalid_range');
  signal?.throwIfAborted();
  const file = await fs.open(
    filePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
  );
  let fileKey: Buffer | undefined;
  try {
    const header = await readExact(file, HEADER_SIZE, 0);
    const chunks = Math.max(1, Math.ceil(size / CHUNK_SIZE));
    if (
      !header.subarray(0, 8).equals(MAGIC) ||
      header.readBigUInt64BE(40) !== BigInt(size) ||
      header.readUInt32BE(48) !== CHUNK_SIZE ||
      (await file.stat()).size !== HEADER_SIZE + size + chunks * TAG_SIZE
    )
      throw new PrivateLibraryError('corrupt');
    fileKey = envelopeKey(
      key,
      header.subarray(8, 40),
      'stage5-private-file-v1'
    );
    for (
      let index = Math.floor(start / CHUNK_SIZE);
      index <= Math.floor(end / CHUNK_SIZE);
      index++
    ) {
      signal?.throwIfAborted();
      const length = Math.min(CHUNK_SIZE, size - index * CHUNK_SIZE);
      const sealed = await readExact(
        file,
        length + TAG_SIZE,
        HEADER_SIZE + index * (CHUNK_SIZE + TAG_SIZE)
      );
      const decipher = createDecipheriv(
        'aes-256-gcm',
        fileKey,
        chunkNonce(index)
      );
      decipher.setAAD(chunkAad(header, index));
      decipher.setAuthTag(sealed.subarray(length));
      const pending = decipher.update(sealed.subarray(0, length));
      let plaintext: Buffer | undefined;
      try {
        plaintext = Buffer.concat([pending, decipher.final()]);
        signal?.throwIfAborted();
        if (size)
          yield Buffer.from(
            plaintext.subarray(
              Math.max(0, start - index * CHUNK_SIZE),
              Math.min(length, end - index * CHUNK_SIZE + 1)
            )
          );
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof PrivateLibraryError) throw error;
        throw new PrivateLibraryError('corrupt');
      } finally {
        pending.fill(0);
        plaintext?.fill(0);
      }
    }
  } finally {
    fileKey?.fill(0);
    await file.close();
  }
}
