import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const calls = [];
let omit = false;
let cancelReview = false;
globalThis.__pipelineModel = async options => {
  calls.push(options);
  if (cancelReview && options.translationPhase === 'review')
    throw new DOMException('Cancelled by user', 'AbortError');
  const prompt = options.messages.at(-1).content;
  const source = prompt.includes('SUBTITLES TO TRANSLATE:')
    ? prompt.split('SUBTITLES TO TRANSLATE:')[1].split('CONTEXT AFTER')[0]
    : prompt;
  const ids = [...source.matchAll(/^Line (\d+):/gm)].map(x => Number(x[1]));
  return ids
    .filter(id => !omit || id !== 7)
    .map(id => `@@SUB_LINE@@ ${id}: 번역 ${id}`)
    .join('\n');
};
const output = await build({
  entryPoints: [path.join(root, 'services/subtitle-processing/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'no-paid-work',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^electron-log$|\/ai-provider\.js$|(?:^\.\/|\/)ai-client\.js$|\/pipeline\/(prepare-audio|transcribe-pass)\.js$/,
          },
          a => ({ path: a.path, namespace: 'test' })
        );
        b.onLoad({ filter: /.*/, namespace: 'test' }, a => ({
          loader: 'js',
          contents:
            a.path === 'electron-log'
              ? 'export default {info(){},warn(){},error(){},debug(){}};'
              : a.path.endsWith('ai-provider.js')
                ? 'export const resolveTranslationDraftModel=()=>"light-draft-model";export const resolveTranslationReviewModel=()=>({model:"review-model"});export const assertTranscriptionAvailable=()=>{throw new Error("No transcription in tests")};'
                : a.path.endsWith('ai-client.js')
                  ? 'export const callAIModel=o=>globalThis.__pipelineModel(o);'
                  : 'export const prepareAudio=()=>{throw new Error("No audio in tests")};export const transcribePass=prepareAudio;',
        }));
      },
    },
  ],
});
const { translateSubtitlesFromSrt } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(output.outputFiles[0].text).toString('base64')
);
const cues = Array.from({ length: 93 }, (_, i) => ({
  id: `source-${i}`,
  index: i + 1,
  start: i * 4,
  end: i * 4 + 3,
  original: `First line ${i + 1}\nSecond line ${i + 1}`,
  sourceCueIds: [`raw-${i}`],
}));
const progress = [];
const run = (qualityTranslation = false) =>
  translateSubtitlesFromSrt({
    inputSegments: cues,
    srtContent: 'deliberately unused legacy text',
    targetLanguage: 'Korean',
    operationId: 'pipeline-fixture',
    signal: new AbortController().signal,
    fileManager: {
      writeTempFile() {
        throw new Error('No scratch copies');
      },
    },
    qualityTranslation,
    progressCallback: payload => progress.push(payload),
  });

test('the full production pipeline batches text once and preserves multiline source, IDs and provenance', async () => {
  calls.length = 0;
  omit = false;
  progress.length = 0;
  const result = await run();
  assert.equal(calls.length, 3);
  assert.equal(result.segments.length, cues.length);
  for (const [i, s] of result.segments.entries()) {
    assert.equal(s.original, cues[i].original);
    assert.equal(s.id, cues[i].id);
    assert.deepEqual(s.sourceCueIds, cues[i].sourceCueIds);
    assert.equal(s.translation, `번역 ${i + 1}`);
  }
  assert.match(calls[0].messages.at(-1).content, /First line 1\nSecond line 1/);
  for (const update of progress.filter(p => p.partialSegments)) {
    assert.equal(update.partialSegments[0].id, cues[0].id);
    assert.equal(update.partialSegments[0].original, cues[0].original);
  }
});
test('an omitted translation cannot become success; the final failure retains every completed concurrent cue', async () => {
  calls.length = 0;
  omit = true;
  await assert.rejects(run(), e => {
    assert.match(e.message, /translationIncomplete/);
    assert.equal(e.partialSegments.length, 93);
    assert.equal(e.partialSegments[6].translation ?? '', '');
    assert.equal(
      e.partialSegments.filter(s => s.translation?.trim()).length,
      92
    );
    assert.equal(Object.keys(e).includes('partialSegments'), false);
    return true;
  });
  assert.equal(calls.length, 5);
  const repairs = calls.filter(
    c => !c.messages.at(-1).content.includes('SUBTITLES TO TRANSLATE:')
  );
  assert.equal(repairs.length, 2);
  assert.ok(repairs.every(c => c.messages.at(-1).content.includes('Line 7:')));
});

test('cancelling quality review preserves the complete draft and cannot report success', async () => {
  calls.length = 0;
  omit = false;
  cancelReview = true;
  try {
    await assert.rejects(run(true), error => {
      assert.equal(error.name, 'AbortError');
      assert.equal(
        error.partialSegments.filter(s => s.translation).length,
        cues.length
      );
      return true;
    });
  } finally {
    cancelReview = false;
  }
});
