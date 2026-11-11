import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = await build({
  entryPoints: [path.join(root, 'services/subtitle-processing/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'synthetic-only',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^electron-log$|\/ai-provider\.js$|(?:^\.\/|\/)ai-client\.js$|\/pipeline\/(prepare-audio|transcribe-pass)\.js$/,
          },
          a => ({ path: a.path, namespace: 'fixture' })
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({
          loader: 'js',
          contents:
            a.path === 'electron-log'
              ? 'export default {info(){},warn(){},error(){},debug(){}};'
              : a.path.endsWith('ai-provider.js')
                ? 'export const getActiveProvider=()=>"stage5";export const resolveTranslationDraftModel=()=>"claude-haiku-5-5";export const resolveTranslationReviewModel=()=>({model:"claude-opus-5-5"});export const assertTranscriptionAvailable=()=>{throw Error("No paid transcription")};'
                : a.path.endsWith('ai-client.js')
                  ? 'export const callAIModel=o=>globalThis.__creditRecoveryModel(o);'
                  : 'export const prepareAudio=()=>{throw Error("No audio")};export const transcribePass=prepareAudio;',
        }));
      },
    },
  ],
});
const { translateSubtitlesFromSrt } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(built.outputFiles[0].text).toString('base64')
);
let calls, paid, respond, controller, progress;
const credits = () =>
  Object.assign(new Error('insufficient-credits'), {
    response: { status: 402 },
  });
const text = ids =>
  ids.map(id => `@@SUB_LINE@@ ${id}: Traducción ${id}`).join('\n');
const cues = Array.from({ length: 40 }, (_, i) => ({
  id: `source-${i + 1}`,
  index: i + 1,
  start: i * 4,
  end: i * 4 + 3,
  original: `Please check shipment ${i + 1} and confirm its label.`,
  sourceCueIds: [`raw-${i + 1}`],
}));
beforeEach(() => {
  calls = [];
  paid = [];
  progress = [];
  controller = new AbortController();
  respond = async ({ ids }) => text(ids);
  globalThis.__creditRecoveryModel = async options => {
    const prompt = options.messages.at(-1).content;
    const phase = options.translationPhase;
    const section =
      phase === 'review'
        ? prompt.split('SOURCE:\n')[1].split('CTX AFTER:')[0]
        : prompt.includes('SUBTITLES TO TRANSLATE:')
          ? prompt.split('SUBTITLES TO TRANSLATE:')[1].split('CONTEXT AFTER')[0]
          : prompt;
    const ids = [
      ...section.matchAll(
        phase === 'review' ? /^\[(\d+)\]/gm : /^Line (\d+):/gm
      ),
    ].map(m => Number(m[1]));
    const call = { ...options, ids, prompt };
    calls.push(call);
    const output = await respond(call);
    paid.push(call);
    return output;
  };
});
const run = (options = {}) =>
  translateSubtitlesFromSrt({
    inputSegments: cues,
    srtContent: 'unused',
    targetLanguage: 'Spanish',
    operationId: 'credit-recovery-fixture',
    signal: controller.signal,
    fileManager: {
      writeTempFile() {
        throw Error('No scratch copies');
      },
    },
    progressCallback: p => progress.push(p),
    ...options,
  });

test('serial refusals split disjoint targets and count each completed cue once', async () => {
  respond = async ({ ids }) => {
    if (ids.length > 10) throw credits();
    return text(ids);
  };
  const result = await run();
  assert.deepEqual(
    calls.slice(0, 2).map(c => c.ids.length),
    [40, 40],
    'normal parallel then serial attempt happen first'
  );
  assert.deepEqual(
    paid.map(c => c.ids),
    [
      Array.from({ length: 10 }, (_, i) => i + 1),
      Array.from({ length: 10 }, (_, i) => i + 11),
      Array.from({ length: 10 }, (_, i) => i + 21),
      Array.from({ length: 10 }, (_, i) => i + 31),
    ]
  );
  assert.equal(new Set(paid.flatMap(c => c.ids)).size, 40);
  assert.equal(result.segments.length, 40);
  assert.deepEqual(
    result.segments.map(s => s.id),
    cues.map(s => s.id)
  );
  assert.deepEqual(
    result.segments.map(s => s.sourceCueIds),
    cues.map(s => s.sourceCueIds)
  );
  const counts = progress
    .filter(p => p.phaseKey === 'translate')
    .map(p => p.current);
  assert.deepEqual(counts, [10, 20, 30, 40]);
});

test('a later unfundable child preserves all successful earlier children', async () => {
  respond = async ({ ids }) => {
    if (ids.length > 10 || ids.some(id => id > 10)) throw credits();
    return text(ids);
  };
  await assert.rejects(run(), error => {
    assert.equal(error.message, 'insufficient-credits');
    assert.deepEqual(
      error.partialSegments.filter(s => s.translation).map(s => s.id),
      cues.slice(0, 10).map(s => s.id)
    );
    return true;
  });
  assert.equal(paid.length, 1);
  assert(
    calls.length <= 15,
    'recovery is bounded and stops at the first unfundable cue'
  );
  assert.deepEqual(calls.at(-1).ids, [11]);
  assert.match(
    calls.at(-1).prompt,
    /CONTEXT BEFORE \(do not translate\):\n\(none\)/
  );
  assert.match(
    calls.at(-1).prompt,
    /CONTEXT AFTER \(do not translate\):\n\(none\)/
  );
});

test('cancellation after one successful child preserves it and sends no further children', async () => {
  respond = async ({ ids }) => {
    if (ids.length > 10) throw credits();
    controller.abort();
    return text(ids);
  };
  await assert.rejects(run(), error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.partialSegments.filter(s => s.translation).length, 10);
    return true;
  });
  assert.equal(paid.length, 1);
});

test('a paid draft followed by repair402 is never split or submitted again', async () => {
  respond = async ({ ids, prompt }) => {
    if (!prompt.includes('SUBTITLES TO TRANSLATE:')) throw credits();
    return text(ids.filter(id => id !== 7));
  };
  await assert.rejects(run(), error => {
    assert.equal(error.partialSegments.filter(s => s.translation).length, 39);
    assert.equal(error.partialSegments[6].translation ?? '', '');
    return true;
  });
  assert.equal(calls.length, 2);
  assert.equal(paid.length, 1);
});

test('ambiguous transport and active-duplicate failures never trigger splitting', async () => {
  for (const status of [409, 503]) {
    calls = [];
    respond = async () => {
      throw Object.assign(
        new Error(`Request failed with status code ${status}`),
        { response: { status } }
      );
    };
    await assert.rejects(run(), new RegExp(String(status)));
    assert.equal(calls.length, 1);
  }
});

test('refused quality review returns a usable draft and explicit incomplete outcome', async () => {
  respond = async ({ ids, translationPhase }) => {
    if (translationPhase === 'review') throw credits();
    return text(ids);
  };
  const result = await run({ qualityTranslation: true });
  assert.deepEqual(result.review, {
    status: 'incomplete',
    completed: 0,
    total: 40,
    reason: 'insufficient_credits',
  });
  assert(
    result.segments.every(
      s => s.translation && s.translationReview.status === 'pending'
    )
  );
  assert(!progress.some(p => p.stage === 'Processing complete!'));
  assert.equal(progress.at(-1).stage, '__i18n__:translationReview.incomplete');
});

test('partial review checkpoints survive, then resume submits only missing review IDs', async () => {
  respond = async ({ ids, translationPhase }) =>
    text(translationPhase === 'review' ? ids.filter(id => id % 2 === 1) : ids);
  const first = await run({ qualityTranslation: true });
  assert.equal(first.review.completed, 20);
  assert.equal(first.review.status, 'incomplete');
  const completeIds = first.segments
    .filter(s => s.translationReview.status === 'complete')
    .map(s => s.id);
  calls = [];
  paid = [];
  respond = async ({ ids }) => text(ids);
  const second = await run({
    inputSegments: first.segments,
    qualityTranslation: true,
    reviewOnly: true,
  });
  assert(calls.every(c => c.translationPhase === 'review'));
  assert.deepEqual(
    calls.flatMap(c => c.ids),
    Array.from({ length: 20 }, (_, i) => (i + 1) * 2)
  );
  assert.equal(second.review.status, 'complete');
  assert.equal(second.review.completed, 40);
  for (const id of completeIds)
    assert.deepEqual(
      second.segments.find(s => s.id === id),
      first.segments.find(s => s.id === id)
    );
});

test('a successful review delivered during cancellation retains its checkpoint', async () => {
  respond = async ({ ids, translationPhase }) => {
    if (translationPhase === 'review') controller.abort();
    return text(ids);
  };
  await assert.rejects(run({ qualityTranslation: true }), error => {
    assert.equal(error.name, 'AbortError');
    assert(
      error.partialSegments.every(
        s => s.translationReview.status === 'complete'
      )
    );
    return true;
  });
});

test('malformed duplicate review IDs remain pending; blank placeholders do not', async () => {
  respond = async ({ ids, translationPhase }) =>
    translationPhase === 'review' ? text([1, 1]) : text(ids);
  const input = [...cues.slice(0, 2), { ...cues[2], original: '' }];
  const result = await run({ inputSegments: input, qualityTranslation: true });
  // The blank source receives a synthetic translation here, so use a truly
  // blank draft result for the separate no-work check below.
  assert.equal(result.review.status, 'incomplete');
  assert(
    result.segments
      .filter(s => s.original)
      .every(s => s.translationReview.status === 'pending')
  );
  calls = [];
  respond = async () => '';
  const blank = await run({
    inputSegments: [{ ...cues[0], original: '' }],
    qualityTranslation: true,
  });
  assert.equal(blank.review.total, 0);
  assert.equal(blank.review.status, 'complete');
  assert(!calls.some(c => c.translationPhase === 'review'));
});

test('admission retry after a paid split child never resubmits completed cues', async () => {
  let refused = false;
  respond = async ({ ids }) => {
    if (ids.length > 2) throw credits();
    if (ids[0] === 3 && !refused) {
      refused = true;
      throw Object.assign(new Error('too-many-active-translations'), {
        retryAfterSec: 0.001,
      });
    }
    return text(ids);
  };
  const result = await run({ inputSegments: cues.slice(0, 4) });
  assert.deepEqual(
    paid.map(c => c.ids),
    [
      [1, 2],
      [3, 4],
    ]
  );
  assert.equal(result.segments.length, 4);
});

test('review-only skips unrelated untranslated cues in a partially translated document', async () => {
  const first = await run({
    inputSegments: cues.slice(0, 2),
    qualityTranslation: true,
  });
  const input = [
    ...first.segments,
    {
      ...cues[2],
      translation: 'Traducción 3',
      translationReview: {
        status: 'pending',
        targetLanguage: 'Spanish',
        contentFingerprint: '',
      },
    },
    cues[3],
  ];
  calls = [];
  paid = [];
  const result = await run({
    inputSegments: input,
    qualityTranslation: true,
    reviewOnly: true,
  });
  assert.deepEqual(
    calls.flatMap(c => c.ids),
    [3]
  );
  assert.equal(result.segments[3].translation, undefined);
  assert.equal(result.review.status, 'complete');
});

test('new partial draft text cannot retain an old-language review checkpoint', async () => {
  const input = cues.slice(0, 4).map(s => ({
    ...s,
    translation: 'Viejo',
    translationReview: {
      status: 'complete',
      targetLanguage: 'Spanish',
      contentFingerprint: 'old',
    },
  }));
  respond = async ({ ids }) => {
    if (ids.length > 2 || ids.some(id => id > 2)) throw credits();
    return text(ids);
  };
  await assert.rejects(
    run({ inputSegments: input, targetLanguage: 'Korean' }),
    error => {
      for (const segment of error.partialSegments.slice(0, 2))
        assert.equal(segment.translationReview, undefined);
      return true;
    }
  );
});

test('quality drafts retain current-language pending review after later credit refusal', async () => {
  respond = async ({ ids }) => {
    if (ids.length > 2 || ids.some(id => id > 2)) throw credits();
    return text(ids);
  };
  let partial;
  await assert.rejects(
    run({
      inputSegments: cues.slice(0, 4),
      qualityTranslation: true,
      targetLanguage: 'Korean',
    }),
    error => {
      partial = error.partialSegments;
      assert(
        partial
          .slice(0, 2)
          .every(
            s =>
              s.translationReview?.status === 'pending' &&
              s.translationReview.targetLanguage === 'Korean'
          )
      );
      return true;
    }
  );
  calls = [];
  paid = [];
  respond = async ({ ids }) => text(ids);
  const review = await run({
    inputSegments: partial,
    qualityTranslation: true,
    reviewOnly: true,
    targetLanguage: 'Korean',
  });
  assert.deepEqual(
    calls.flatMap(c => c.ids),
    [1, 2]
  );
  assert(calls.every(c => c.translationPhase === 'review'));
  assert.equal(review.segments[2].translation, undefined);
});
