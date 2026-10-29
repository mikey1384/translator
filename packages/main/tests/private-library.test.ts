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
