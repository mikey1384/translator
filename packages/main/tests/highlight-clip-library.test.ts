import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  highlightClipSourceKey,
  listHighlightClips,
  recordHighlightClip,
  sweepOrphanHighlightClips,
} from '../services/highlight-clip-library.js';
import {
  highlightCaptionSignature,
  highlightClipArtifactKey,
  highlightClipCaptionSignature,
  highlightClipSourceIdentity,
} from '../../shared/helpers/highlight-clips.js';

async function withTempDir<T>(fn: (rootDir: string) => Promise<T>): Promise<T> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'stage5-highlight-clips-')
  );
  try {
    return await fn(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function writeClip(rootDir: string, name: string): Promise<string> {
  const filePath = path.join(rootDir, name);
  await fs.writeFile(filePath, 'mp4');
  return filePath;
}

const SOURCE = 'asset:file:123' + '["dual","Cinema",38,[]]';

test('a rendered clip is listed again for the same source and captions', async () => {
  await withTempDir(async rootDir => {
    const videoPath = await writeClip(rootDir, 'a.mp4');
    await recordHighlightClip(
      {
        sourceIdentity: SOURCE,
        kind: 'single',
        artifactKey: '1000-5000|null',
        aspectMode: 'vertical_fit',
        videoPath,
      },
      rootDir
    );

    const clips = await listHighlightClips({ sourceIdentity: SOURCE }, rootDir);
    assert.equal(clips.length, 1);
    assert.deepEqual(
      { ...clips[0], createdAt: undefined },
      {
        kind: 'single',
        artifactKey: '1000-5000|null',
        aspectMode: 'vertical_fit',
        videoPath,
        createdAt: undefined,
      }
    );

    const raw = JSON.parse(
      await fs.readFile(path.join(rootDir, 'clip-index.json'), 'utf8')
    );
    // The index stores a digest, never the full caption signature.
    assert.equal(raw.clips[0].sourceKey, highlightClipSourceKey(SOURCE));
    assert.ok(!JSON.stringify(raw).includes('Cinema'));
  });
});

test('changed captions or another source do not see the clip', async () => {
  await withTempDir(async rootDir => {
    const videoPath = await writeClip(rootDir, 'a.mp4');
    await recordHighlightClip(
      {
        sourceIdentity: SOURCE,
        kind: 'single',
        artifactKey: '1000-5000|null',
        aspectMode: 'original',
        videoPath,
      },
      rootDir
    );
    assert.deepEqual(
      await listHighlightClips(
        { sourceIdentity: 'asset:file:123["dual","Cinema",40,[]]' },
        rootDir
      ),
      []
    );
    assert.deepEqual(
      await listHighlightClips({ sourceIdentity: 'asset:file:999' }, rootDir),
      []
    );
    assert.deepEqual(
      await listHighlightClips({ sourceIdentity: '' }, rootDir),
      []
    );
  });
});

test('clips whose file was deleted are forgotten but nothing is deleted', async () => {
  await withTempDir(async rootDir => {
    const kept = await writeClip(rootDir, 'kept.mp4');
    const gone = await writeClip(rootDir, 'gone.mp4');
    for (const [artifactKey, videoPath] of [
      ['0-1000|null', kept],
      ['2000-3000|null', gone],
    ]) {
      await recordHighlightClip(
        {
          sourceIdentity: SOURCE,
          kind: 'single',
          artifactKey,
          aspectMode: 'vertical_reframe',
          videoPath,
        },
        rootDir
      );
    }
    await fs.rm(gone);

    const clips = await listHighlightClips({ sourceIdentity: SOURCE }, rootDir);
    assert.deepEqual(
      clips.map(clip => clip.videoPath),
      [kept]
    );
    const raw = JSON.parse(
      await fs.readFile(path.join(rootDir, 'clip-index.json'), 'utf8')
    );
    assert.equal(raw.clips.length, 1);
    assert.equal(await fs.readFile(kept, 'utf8'), 'mp4');
  });
});

test('a re-render replaces the entry, newest first, and deletes the old file', async () => {
  await withTempDir(async rootDir => {
    const first = await writeClip(rootDir, 'first.mp4');
    const second = await writeClip(rootDir, 'second.mp4');
    const combined = await writeClip(rootDir, 'combined.mp4');
    const base = {
      sourceIdentity: SOURCE,
      kind: 'single' as const,
      artifactKey: '0-1000|null',
      aspectMode: 'vertical_reframe' as const,
    };
    await recordHighlightClip({ ...base, videoPath: first }, rootDir);
    await recordHighlightClip(
      {
        ...base,
        kind: 'combined',
        artifactKey: '0-1000|null|2000-3000|null',
        videoPath: combined,
      },
      rootDir
    );
    await recordHighlightClip({ ...base, videoPath: second }, rootDir);

    const clips = await listHighlightClips({ sourceIdentity: SOURCE }, rootDir);
    assert.deepEqual(
      clips.map(clip => [clip.kind, clip.videoPath]),
      [
        ['single', second],
        ['combined', combined],
      ]
    );
    await assert.rejects(fs.stat(first));
    assert.equal(await fs.readFile(second, 'utf8'), 'mp4');
  });
});

test('invalid records are rejected', async () => {
  await withTempDir(async rootDir => {
    const videoPath = await writeClip(rootDir, 'a.mp4');
    const valid = {
      sourceIdentity: SOURCE,
      kind: 'single' as const,
      artifactKey: '0-1000|null',
      aspectMode: 'original' as const,
      videoPath,
    };
    for (const invalid of [
      { ...valid, sourceIdentity: '' },
      { ...valid, artifactKey: '' },
      { ...valid, aspectMode: 'vertical' as any },
      { ...valid, kind: 'other' as any },
      { ...valid, videoPath: 'relative.mp4' },
      { ...valid, videoPath: path.join(rootDir, 'a.mov') },
      { ...valid, videoPath: path.join(rootDir, 'missing.mp4') },
    ]) {
      await assert.rejects(recordHighlightClip(invalid, rootDir));
    }
    assert.deepEqual(
      await listHighlightClips({ sourceIdentity: SOURCE }, rootDir),
      []
    );
  });
});

test('a corrupt index reads as empty and is rewritten', async () => {
  await withTempDir(async rootDir => {
    await fs.writeFile(path.join(rootDir, 'clip-index.json'), '{not json');
    const videoPath = await writeClip(rootDir, 'a.mp4');
    assert.deepEqual(
      await listHighlightClips({ sourceIdentity: SOURCE }, rootDir),
      []
    );
    await recordHighlightClip(
      {
        sourceIdentity: SOURCE,
        kind: 'single',
        artifactKey: '0-1000|null',
        aspectMode: 'original',
        videoPath,
      },
      rootDir
    );
    assert.equal(
      (await listHighlightClips({ sourceIdentity: SOURCE }, rootDir)).length,
      1
    );
  });
});

test('reparsed captions keep the same clip key; edits and faces do not', () => {
  const cue = (id: string, original: string) => ({
    id,
    index: 1,
    start: 1,
    end: 2,
    original,
    translation: '번역',
  });
  const identity = highlightClipSourceIdentity({
    fallbackVideoAssetIdentity: null,
    fallbackVideoPath: null,
    originalVideoPath: '/Videos/Talk.MP4',
    sourceAssetIdentity: null,
    sourceUrl: null,
    libraryEntryId: null,
  });
  assert.equal(identity, 'path:/videos/talk.mp4');
  const first = highlightCaptionSignature(
    [cue('a', 'Hi')],
    'dual',
    'Cinema',
    38
  );
  assert.equal(
    first,
    highlightCaptionSignature([cue('b', 'Hi')], 'dual', 'Cinema', 38)
  );
  assert.notEqual(
    first,
    highlightCaptionSignature([cue('a', 'Hey')], 'dual', 'Cinema', 38)
  );
  assert.notEqual(
    first,
    highlightCaptionSignature([cue('a', 'Hi')], 'dual', 'Cinema', 38, 'serif')
  );
  assert.equal(
    highlightClipArtifactKey({ start: 1.0004, end: 2.5 }),
    '1000-2500|null'
  );
});

test('the clip keeps its caption signature and a re-cut with new captions replaces it', async () => {
  await withTempDir(async rootDir => {
    const before = await writeClip(rootDir, 'before.mp4');
    const after = await writeClip(rootDir, 'after.mp4');
    const base = {
      sourceIdentity: 'path:/videos/talk.mp4',
      kind: 'single' as const,
      artifactKey: '1000-5000|null',
      aspectMode: 'vertical_reframe' as const,
    };
    await recordHighlightClip(
      { ...base, videoPath: before, captionSignature: 'clip1:aaa' },
      rootDir
    );
    let clips = await listHighlightClips(
      { sourceIdentity: base.sourceIdentity },
      rootDir
    );
    assert.equal(clips[0].captionSignature, 'clip1:aaa');

    await recordHighlightClip(
      { ...base, videoPath: after, captionSignature: 'clip1:bbb' },
      rootDir
    );
    clips = await listHighlightClips(
      { sourceIdentity: base.sourceIdentity },
      rootDir
    );
    assert.deepEqual(
      clips.map(clip => [clip.videoPath, clip.captionSignature]),
      [[after, 'clip1:bbb']]
    );
    await assert.rejects(fs.stat(before));
  });
});

test('files outside the clips folder are never deleted', async () => {
  await withTempDir(async rootDir => {
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'stage5-outside-')
    );
    try {
      const outside = path.join(outsideDir, 'user.mp4');
      await fs.writeFile(outside, 'mp4');
      const inside = await writeClip(rootDir, 'inside.mp4');
      const base = {
        sourceIdentity: SOURCE,
        kind: 'single' as const,
        artifactKey: '0-1000|null',
        aspectMode: 'original' as const,
      };
      await recordHighlightClip({ ...base, videoPath: outside }, rootDir);
      await recordHighlightClip({ ...base, videoPath: inside }, rootDir);
      assert.equal(await fs.readFile(outside, 'utf8'), 'mp4');
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});

test('the sweep removes old unreferenced clip files only', async () => {
  await withTempDir(async rootDir => {
    const referenced = await writeClip(rootDir, 'referenced.mp4');
    const orphanOld = await writeClip(rootDir, 'orphan-old.mp4');
    const orphanNew = await writeClip(rootDir, 'orphan-new.mp4');
    await fs.writeFile(path.join(rootDir, 'notes.txt'), 'keep');
    await recordHighlightClip(
      {
        sourceIdentity: SOURCE,
        kind: 'single',
        artifactKey: '0-1000|null',
        aspectMode: 'original',
        videoPath: referenced,
      },
      rootDir
    );
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const file of [referenced, orphanOld]) {
      await fs.utimes(file, twoHoursAgo, twoHoursAgo);
    }

    const removed = await sweepOrphanHighlightClips(rootDir);
    assert.deepEqual(removed, [path.resolve(orphanOld)]);
    assert.equal(await fs.readFile(referenced, 'utf8'), 'mp4');
    // A file this young may belong to a render that is finishing now.
    assert.equal(await fs.readFile(orphanNew, 'utf8'), 'mp4');
    assert.equal(
      await fs.readFile(path.join(rootDir, 'notes.txt'), 'utf8'),
      'keep'
    );
  });
});

test('a clip signature covers only the cues inside the clip', () => {
  const cue = (id: string, start: number, end: number, original: string) => ({
    id,
    index: 1,
    start,
    end,
    original,
    translation: '',
  });
  const transcript = [cue('a', 0, 2, 'Hello'), cue('b', 10, 12, 'Later')];
  const clip = [{ start: 0, end: 5 }];
  const signature = highlightClipCaptionSignature(
    transcript,
    clip,
    'dual',
    'Cinema',
    38
  );
  // An edit outside the clip leaves it current.
  assert.equal(
    signature,
    highlightClipCaptionSignature(
      [transcript[0], cue('b', 10, 12, 'Changed later line')],
      clip,
      'dual',
      'Cinema',
      38
    )
  );
  // An edit inside it, or a new size or face, does not.
  assert.notEqual(
    signature,
    highlightClipCaptionSignature(
      [cue('a', 0, 2, 'Hi'), transcript[1]],
      clip,
      'dual',
      'Cinema',
      38
    )
  );
  assert.notEqual(
    signature,
    highlightClipCaptionSignature(transcript, clip, 'dual', 'Cinema', 40)
  );
  assert.notEqual(
    signature,
    highlightClipCaptionSignature(
      transcript,
      clip,
      'dual',
      'Cinema',
      38,
      'serif'
    )
  );
  // Reparsed cue ids do not matter.
  assert.equal(
    signature,
    highlightClipCaptionSignature(
      [cue('x', 0, 2, 'Hello'), transcript[1]],
      clip,
      'dual',
      'Cinema',
      38
    )
  );
});
