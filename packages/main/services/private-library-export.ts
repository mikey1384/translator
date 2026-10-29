import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DownloadFolders } from './private-library.js';
import { buildSrt } from '../../shared/helpers/index.js';

/** An explicit, unencrypted recovery copy. The protected original stays put.
 * Only a new exclusive directory is written; lock/failure removes partials. */
export async function exportPrivateEntry(
  folders: DownloadFolders,
  owner: number,
  folderId: string,
  entryId: string,
  destination: string
): Promise<string> {
  const entry = await folders.entry(owner, folderId, entryId);
  const directory = path.join(
    destination,
    `Translator-${randomUUID().slice(0, 8)}`
  );
  await fs.mkdir(directory, { mode: 0o700 });
  try {
    const files: { name: string; originalName: string; kind: string }[] = [];
    for (const [index, asset] of entry.assets.entries()) {
      const originalName = path.basename(asset.sourcePath);
      const name = `${String(index + 1).padStart(3, '0')}-${originalName.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(-160) || 'file'}`;
      const media = await folders.media(
        owner,
        folderId,
        entryId,
        asset.id,
        undefined,
        undefined,
        true
      );
      const output = await fs.open(path.join(directory, name), 'wx', 0o600);
      try {
        for await (const chunk of media.stream) {
          media.signal.throwIfAborted();
          try {
            await output.writeFile(chunk);
          } finally {
            chunk.fill(0);
          }
        }
        media.signal.throwIfAborted();
        await output.sync();
      } finally {
        await output.close();
      }
      files.push({ name, originalName, kind: asset.kind });
      // Keep the original document for recovery and provide a normal SRT too.
      if (
        asset.mime === 'application/x-stage5-subtitle-document' &&
        asset.size <= 32 * 1024 ** 2
      ) {
        const document = JSON.parse(
          await fs.readFile(path.join(directory, name), 'utf8')
        );
        await fs.writeFile(
          path.join(directory, `${name}.srt`),
          buildSrt({
            segments: document.segments,
            mode: 'translation',
            noWrap: true,
          }),
          { flag: 'wx', mode: 0o600 }
        );
      }
    }
    folders.touch(folderId, owner);
    await fs.writeFile(
      path.join(directory, 'recovery.json'),
      JSON.stringify({ version: 1, files, entry }, null, 2),
      { flag: 'wx', mode: 0o600 }
    );
    folders.touch(folderId, owner);
    return directory;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
