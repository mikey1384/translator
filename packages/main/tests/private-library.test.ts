import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DownloadFolders } from '../services/private-library.js';
import { exportPrivateEntry } from '../services/private-library-export.js';
import {
  collectPrivateAssets,
  cleanPrivateAssets,
  withPrivateAssetLocks,
} from '../services/private-library-assets.js';

async function fixture() {
  const root = path.resolve('.local/private-library-tests');
  await fs.mkdir(root, { recursive: true });
  const data = await fs.mkdtemp(path.join(root, 'vault-'));
  const video = path.join(data, 'downloaded-media', 'public-demo.mp4');
  await fs.mkdir(path.dirname(video), { recursive: true });
  await fs.writeFile(video, Buffer.alloc(1024 * 1024 + 317, 71));
  const item = {
    id: 'public-history',
    sourceUrl: 'https://example.com/demo',
    title: 'Private fixture title',
    downloadedAtIso: new Date().toISOString(),
    localPath: video,
  };
  return { data, video, item };
}

test('private transfer accepts the app directory case used by Electron on a case-insensitive filesystem', async t => {
  const { data, video, item } = await fixture();
  const alias = path.join(
    path.dirname(data),
    path.basename(data).toUpperCase()
  );
  let folders: DownloadFolders | undefined;
  try {
    try {
      await fs.access(alias);
    } catch {
      t.skip('filesystem has distinct directory names for different case');
      return;
    }
    assert.equal(await fs.realpath(alias), await fs.realpath(data));
    const aliasedVideo = path.join(
      alias,
      'downloaded-media',
      path.basename(video)
    );
    const subtitle = path.join(
      alias,
      'subtitle-history',
      'entries',
      'fixture.srt'
    );
    const subtitleText = '1\n00:00:00,000 --> 00:00:02,000\n안녕하세요\n';
    await fs.mkdir(path.dirname(subtitle), { recursive: true });
    await fs.writeFile(subtitle, subtitleText);
    await fs.writeFile(
      path.join(alias, 'subtitle-history', 'index.json'),
      JSON.stringify({
        version: 2,
        entries: [
          {
            id: 'case-fixture',
            filePath: subtitle,
            sourceVideoPaths: [aliasedVideo],
            targetLanguage: 'ko',
          },
        ],
      })
    );
    folders = new DownloadFolders(path.join(alias, 'private-library'));
    const folderId = await folders.create(
      1,
      'Case fixture',
      'fixture password only'
    );
    const aliasedItem = { ...item, localPath: aliasedVideo };
    const plan = await collectPrivateAssets(alias, aliasedItem);
    let historyRemoved = false;
    await folders.import(1, folderId, aliasedItem, plan, entry =>
      cleanPrivateAssets(alias, entry, () => {
        historyRemoved = true;
      })
    );
    assert.equal(historyRemoved, true);
    await assert.rejects(fs.access(video), { code: 'ENOENT' });
    await assert.rejects(fs.access(subtitle), { code: 'ENOENT' });
    folders.dispose();
    folders = new DownloadFolders(path.join(alias, 'private-library'));
    await folders.unlock(1, folderId, 'fixture password only');
    const [info] = await folders.entries(1, folderId);
    assert.equal(info.ready, true);
    const entry = await folders.entry(1, folderId, info.id);
    for (const asset of entry.assets) {
      const { stream } = await folders.media(1, folderId, info.id, asset.id);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert.deepEqual(
        Buffer.concat(chunks),
        asset.kind === 'video'
          ? Buffer.alloc(1024 * 1024 + 317, 71)
          : Buffer.from(subtitleText)
      );
    }
  } finally {
    folders?.dispose();
    await fs.rm(data, { recursive: true, force: true });
  }
});

test('asset collection resolves the configured app root but still rejects a child redirected outside it', async () => {
  const { data, video, item } = await fixture();
  const alias = `${data}-alias`;
  const outside = `${data}-outside`;
  try {
    await fs.symlink(
      data,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const plan = await collectPrivateAssets(alias, {
      ...item,
      localPath: path.join(alias, 'downloaded-media', path.basename(video)),
    });
    assert.equal(plan.files.length, 1);
    await fs.rename(path.join(data, 'downloaded-media'), outside);
    await fs.symlink(
      outside,
      path.join(data, 'downloaded-media'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await assert.rejects(
      collectPrivateAssets(alias, {
        ...item,
        localPath: path.join(alias, 'downloaded-media', path.basename(video)),
      }),
      /unsupported_file/
    );
    assert.equal(
      (await fs.stat(path.join(outside, path.basename(video)))).size,
      1024 * 1024 + 317
    );
  } finally {
    await fs.rm(alias, { recursive: true, force: true });
    await fs.rm(data, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('cleanup refuses a parent redirected outside the app after collection even when file identity is unchanged', async () => {
  const { data, video, item } = await fixture();
  const outside = `${data}-outside`;
  const folders = new DownloadFolders(path.join(data, 'private-library'));
  try {
    const folderId = await folders.create(
      1,
      'Redirect fixture',
      'fixture password only'
    );
    const plan = await collectPrivateAssets(data, item);
    let historyRemoved = false;
    await assert.rejects(
      folders.import(1, folderId, item, plan, async entry => {
        await fs.rename(path.dirname(video), outside);
        await fs.symlink(
          outside,
          path.dirname(video),
          process.platform === 'win32' ? 'junction' : 'dir'
        );
        await cleanPrivateAssets(data, entry, () => {
          historyRemoved = true;
        });
      }),
      /source_changed/
    );
    assert.equal(historyRemoved, false);
    assert.equal(
      (await fs.stat(path.join(outside, path.basename(video)))).size,
      1024 * 1024 + 317
    );
    assert.equal((await folders.entries(1, folderId))[0].ready, false);
  } finally {
    folders.dispose();
    await fs.rm(data, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('private transfer still refuses files with another hard link', async () => {
  const { data, video, item } = await fixture();
  try {
    const exported = path.join(data, 'exported-copy.mp4');
    await fs.link(video, exported);
    await assert.rejects(collectPrivateAssets(data, item), /unsupported_file/);
    assert.equal((await fs.stat(video)).nlink, 2);
    assert.equal((await fs.stat(exported)).size, 1024 * 1024 + 317);
  } finally {
    await fs.rm(data, { recursive: true, force: true });
  }
});

test('a large valid subtitle catalog does not block transferring a small selected document', async () => {
  const { data, video, item } = await fixture();
  const folders = new DownloadFolders(path.join(data, 'private-library'));
  try {
    const directory = path.join(data, 'subtitle-documents');
    const documentFile = path.join(directory, 'documents', 'selected.json');
    await fs.mkdir(path.dirname(documentFile), { recursive: true });
    const selected = {
      id: 'selected',
      sourceVideoPath: video,
      targetLanguage: 'ko',
    };
    await fs.writeFile(
      documentFile,
      JSON.stringify({
        ...selected,
        segments: [{ id: 'cue', start: 0, end: 1, translation: '안녕하세요' }],
      })
    );
    // The real catalog retains linked subtitle snapshots for many documents.
    // Only the selected records belong in the bounded encrypted entry JSON.
    const unrelated = Array.from({ length: 40 }, (_, index) => ({
      id: `other-${index}`,
      sourceVideoPath: path.join(data, `other-${index}.mp4`),
      linkedFiles: [
        {
          path: path.join(data, `other-${index}.srt`),
          segmentsSnapshot: [
            { id: 'cue', start: 0, end: 1, original: 'x'.repeat(900_000) },
          ],
        },
      ],
    }));
    const indexFile = path.join(directory, 'index.json');
    await fs.writeFile(
      indexFile,
      JSON.stringify({ version: 1, documents: [selected, ...unrelated] })
    );
    assert.ok((await fs.stat(indexFile)).size > 32 * 1024 ** 2);
    const plan = await collectPrivateAssets(data, item);
    assert.deepEqual(plan.indexes[0].records, [selected]);
    const folderId = await folders.create(
      1,
      'Large catalog',
      'fixture password only'
    );
    await folders.import(1, folderId, item, plan, entry =>
      cleanPrivateAssets(data, entry, () => {})
    );
    assert.equal((await folders.entries(1, folderId))[0].ready, true);
    await assert.rejects(fs.access(video), { code: 'ENOENT' });
    await assert.rejects(fs.access(documentFile), { code: 'ENOENT' });
    assert.deepEqual(
      JSON.parse(await fs.readFile(indexFile, 'utf8')).documents,
      unrelated
    );
  } finally {
    folders.dispose();
    await fs.rm(data, { recursive: true, force: true });
  }
});

test('obsolete source aliases do not block protection and remain recoverable in encrypted metadata', async () => {
  const { data, video, item } = await fixture();
  const folders = new DownloadFolders(path.join(data, 'private-library'));
  try {
    const subtitle = path.join(
      data,
      'subtitle-history',
      'entries',
      'fixture.srt'
    );
    const previousVideo = path.join(data, 'previous-location.mp4');
    const row = {
      id: 'moved-source',
      filePath: subtitle,
      sourceVideoPaths: [previousVideo, video],
    };
    await fs.mkdir(path.dirname(subtitle), { recursive: true });
    await fs.writeFile(
      subtitle,
      '1\n00:00:00,000 --> 00:00:02,000\n안녕하세요\n'
    );
    await fs.writeFile(
      path.join(data, 'subtitle-history', 'index.json'),
      JSON.stringify({ version: 2, entries: [row] })
    );
    const plan = await collectPrivateAssets(data, item);
    const folderId = await folders.create(
      1,
      'Moved fixture',
      'fixture password only'
    );
    await folders.import(1, folderId, item, plan, entry =>
      cleanPrivateAssets(data, entry, () => {})
    );
    const [entry] = await folders.entries(1, folderId);
    assert.equal(entry.ready, true);
    assert.deepEqual(
      (await folders.entry(1, folderId, entry.id)).plan.indexes[0].records,
      [row]
    );
    await assert.rejects(fs.access(video), { code: 'ENOENT' });
    await assert.rejects(fs.access(subtitle), { code: 'ENOENT' });
  } finally {
    folders.dispose();
    await fs.rm(data, { recursive: true, force: true });
  }
});

test('an existing source alias blocks collection, and an alias restored during encryption blocks cleanup', async () => {
  const { data, video, item } = await fixture();
  const folders = new DownloadFolders(path.join(data, 'private-library'));
  try {
    const subtitle = path.join(
      data,
      'subtitle-history',
      'entries',
      'fixture.srt'
    );
    const otherVideo = path.join(data, 'other-video.mp4');
    const row = {
      id: 'shared-source',
      filePath: subtitle,
      sourceVideoPaths: [otherVideo, video],
    };
    const indexFile = path.join(data, 'subtitle-history', 'index.json');
    await fs.mkdir(path.dirname(subtitle), { recursive: true });
    await fs.writeFile(
      subtitle,
      '1\n00:00:00,000 --> 00:00:02,000\n안녕하세요\n'
    );
    await fs.writeFile(
      indexFile,
      JSON.stringify({ version: 2, entries: [row] })
    );
    await fs.writeFile(otherVideo, 'other public fixture');
    await assert.rejects(collectPrivateAssets(data, item), /unsupported_file/);
    await fs.rm(otherVideo);
    const plan = await collectPrivateAssets(data, item);
    const folderId = await folders.create(
      1,
      'Shared fixture',
      'fixture password only'
    );
    let historyRemoved = false;
    await assert.rejects(
      folders.import(1, folderId, item, plan, async entry => {
        await fs.writeFile(otherVideo, 'restored public fixture');
        await cleanPrivateAssets(data, entry, () => {
          historyRemoved = true;
        });
      }),
      /source_changed/
    );
    assert.equal(historyRemoved, false);
    assert.equal((await folders.entries(1, folderId))[0].ready, false);
    assert.equal(
      await fs.readFile(otherVideo, 'utf8'),
      'restored public fixture'
    );
    await fs.access(video);
    await fs.access(subtitle);
    assert.deepEqual(JSON.parse(await fs.readFile(indexFile, 'utf8')).entries, [
      row,
    ]);
  } finally {
    folders.dispose();
    await fs.rm(data, { recursive: true, force: true });
  }
});

test('a lock immediately after durable catalog publication retains every encrypted asset', async t => {
  const { data, item } = await fixture();
  let folders = new DownloadFolders(path.join(data, 'private-library'));
  try {
    const id = await folders.create(
      1,
      'Recovery fixture',
      'fixture password only'
    );
    const rename = fs.rename;
    const injected = t.mock.method(
      fs,
      'rename',
      async (...[from, to]: Parameters<typeof fs.rename>) => {
        await rename(from, to);
        if (String(to) === path.join(folders.root, id, 'manifest.enc'))
          folders.lockAll();
      }
    );
    await assert.rejects(
      folders.import(
        1,
        id,
        item,
        await collectPrivateAssets(data, item),
        async () => assert.fail('lock must prevent cleanup')
      )
    );
    injected.mock.restore();
    folders.dispose();
    folders = new DownloadFolders(path.join(data, 'private-library'));
    await folders.unlock(1, id, 'fixture password only');
    const [entry] = await folders.entries(1, id);
    assert.equal(entry.ready, false);
    // A pending transfer can be recovered even if its source has changed.
    await fs.appendFile(item.localPath, 'new external edit');
    const recovered = await exportPrivateEntry(folders, 1, id, entry.id, data);
    const manifest = JSON.parse(
      await fs.readFile(path.join(recovered, 'recovery.json'), 'utf8')
    );
    assert.equal(
      (await fs.stat(path.join(recovered, manifest.files[0].name))).size,
      1024 * 1024 + 317
    );
    const record = await folders.entry(1, id, entry.id);
    await assert.rejects(
      folders.media(1, id, entry.id, record.assets[0].id),
      /pending/
    );
  } finally {
    t.mock.restoreAll();
    folders.dispose();
    await fs.rm(data, { recursive: true, force: true });
  }
});

test('an unlocked private video exports an explicit recovery copy without losing its protected original', async () => {
  const { data, item, video } = await fixture();
  const folders = new DownloadFolders(path.join(data, 'private-library'));
  try {
    const original = await fs.readFile(video);
    const id = await folders.create(1, 'Fixture', 'fixture password only');
    const plan = await collectPrivateAssets(data, item);
    await folders.import(1, id, item, plan, e =>
      cleanPrivateAssets(data, e, () => {})
    );
    const entry = (await folders.entries(1, id))[0];
    const output = await exportPrivateEntry(folders, 1, id, entry.id, data);
    const recovered = JSON.parse(
      await fs.readFile(path.join(output, 'recovery.json'), 'utf8')
    );
    assert.deepEqual(
      await fs.readFile(path.join(output, recovered.files[0].name)),
      original
    );
    assert.equal((await folders.entries(1, id)).length, 1);
    folders.lockAll();
    await assert.rejects(
      exportPrivateEntry(folders, 1, id, entry.id, data),
      /locked/
    );
  } finally {
    folders.dispose();
    await fs.rm(data, { recursive: true, force: true });
  }
});

test('locking during password derivation wins over the late unlock', async () => {
  const { data } = await fixture();
  const folders = new DownloadFolders(path.join(data, 'private-library'));
  try {
    const id = await folders.create(1, 'Fixture', 'fixture password only');
    folders.lock(id);
    const unlocking = folders.unlock(1, id, 'fixture password only');
    folders.lockAll();
    await assert.rejects(unlocking, /locked/);
    assert.equal((await folders.list(1))[0].locked, true);
  } finally {
    folders.dispose();
    await fs.rm(data, { recursive: true, force: true });
  }
});
async function filesUnder(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(p)));
    else out.push(p);
  }
  return out;
}

test('private transfer encrypts metadata and subtitles, survives restart and aborts active media on lock', async () => {
  const { data, video, item } = await fixture();
  let service = new DownloadFolders(path.join(data, 'private-library'));
  try {
    const subPath = path.join(
      data,
      'subtitle-history',
      'entries',
      'translation.srt'
    );
    await fs.mkdir(path.dirname(subPath), { recursive: true });
    await fs.writeFile(
      subPath,
      '1\n00:00:00,000 --> 00:00:02,000\n안녕하세요\n'
    );
    await fs.writeFile(
      path.join(data, 'subtitle-history', 'index.json'),
      JSON.stringify({
        version: 2,
        entries: [
          {
            id: 'sub-one',
            filePath: subPath,
            sourceVideoPaths: [video],
            sourceUrls: [item.sourceUrl],
            targetLanguage: 'ko',
          },
        ],
      })
    );
    const id = await service.create(
      1,
      'Private fixture folder',
      'correct horse battery staple'
    );
    assert.equal((await service.list(2))[0].name, undefined);
    await assert.rejects(service.entries(2, id), /locked/);
    let removed = false;
    const plan = await collectPrivateAssets(data, item);
    await service.import(1, id, item, plan, e =>
      withPrivateAssetLocks(() =>
        cleanPrivateAssets(data, e, () => {
          removed = true;
        })
      )
    );
    assert.equal(removed, true);
    await assert.rejects(fs.access(video));
    await assert.rejects(fs.access(subPath));
    assert.deepEqual(
      JSON.parse(
        await fs.readFile(
          path.join(data, 'subtitle-history', 'index.json'),
          'utf8'
        )
      ).entries,
      []
    );
    const [entryInfo] = await service.entries(1, id);
    assert.equal(entryInfo.ready, true);
    const entry = await service.entry(1, id, entryInfo.id);
    assert.equal(entry.assets.filter(a => a.kind === 'subtitle').length, 1);
    for (const file of await filesUnder(service.root)) {
      const bytes = await fs.readFile(file);
      assert.equal(bytes.includes(Buffer.from('Private fixture')), false, file);
      assert.equal(bytes.includes(Buffer.from('안녕하세요')), false, file);
      assert.equal(bytes.includes(Buffer.from(item.sourceUrl)), false, file);
    }
    const asset = entry.assets.find(a => a.kind === 'video')!;
    const { stream } = await service.media(1, id, entry.id, asset.id);
    assert.equal((await stream.next()).value.length, 1024 * 1024);
    service.lock(id);
    await assert.rejects(stream.next());
    await assert.rejects(service.entry(1, id, entry.id), /locked/);
    service.dispose();
    service = new DownloadFolders(path.join(data, 'private-library'));
    assert.equal((await service.list(1))[0].locked, true);
    await assert.rejects(
      service.unlock(1, id, 'incorrect password'),
      /incorrect_password/
    );
    await service.unlock(1, id, 'correct horse battery staple');
    const restored = await service.entry(1, id, entry.id);
    assert.equal(restored.item.title, item.title);
    await assert.rejects(service.removeFolder(1, id), /not_empty/);
    await service.removeEntry(1, id, entry.id);
    await service.removeFolder(1, id);
    assert.deepEqual(await service.list(1), []);
  } finally {
    service.dispose();
    await fs.rm(data, { recursive: true, force: true });
  }
});

test('interrupted cleanup stays pending and resumes after unlocking without encrypting missing originals again', async () => {
  const { data, item } = await fixture();
  let service = new DownloadFolders(path.join(data, 'private-library'));
  try {
    const id = await service.create(
      7,
      'Recovery fixture',
      'correct horse battery staple'
    );
    await assert.rejects(
      service.import(
        7,
        id,
        item,
        await collectPrivateAssets(data, item),
        async () => {
          throw new Error('simulated cleanup failure');
        }
      ),
      /simulated/
    );
    assert.equal((await service.entries(7, id))[0].ready, false);
    assert.equal((await service.list(7))[0].pending, true);
    service.dispose();
    service = new DownloadFolders(path.join(data, 'private-library'));
    await service.unlock(7, id, 'correct horse battery staple');
    await service.retryPending(7, id, e =>
      cleanPrivateAssets(data, e, () => {})
    );
    assert.equal((await service.entries(7, id))[0].ready, true);
  } finally {
    service.dispose();
    await fs.rm(data, { recursive: true, force: true });
  }
});

test('asset collection preserves unrelated videos on the same page; newer edits and symlinks fail closed', async () => {
  const { data, item } = await fixture();
  const service = new DownloadFolders(path.join(data, 'private-library'));
  try {
    const documents = path.join(data, 'subtitle-documents');
    await fs.mkdir(path.join(documents, 'documents'), { recursive: true });
    const record = {
      id: randomUUID(),
      sourceVideoPath: '/some/other/video.mp4',
      sourceUrl: item.sourceUrl,
    };
    await fs.writeFile(
      path.join(documents, 'index.json'),
      JSON.stringify({ version: 1, documents: [record] })
    );
    const plan = await collectPrivateAssets(data, {
      ...item,
      webVideoId: 'a'.repeat(32),
    });
    assert.equal(plan.indexes.length, 0);
    const id = await service.create(
      1,
      'Concurrent fixture',
      'correct horse battery staple'
    );
    await assert.rejects(
      service.import(1, id, item, plan, async entry => {
        await fs.appendFile(item.localPath, 'changed');
        await cleanPrivateAssets(data, entry, () =>
          assert.fail('must not remove history')
        );
      }),
      /source_changed/
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(documents, 'index.json'), 'utf8'))
        .documents,
      [record]
    );
    const link = path.join(data, 'downloaded-media', 'link.mp4');
    await fs.symlink(item.localPath, link);
    await assert.rejects(
      collectPrivateAssets(data, { ...item, localPath: link }),
      /unsupported_file/
    );
  } finally {
    service.dispose();
    await fs.rm(data, { recursive: true, force: true });
  }
});
