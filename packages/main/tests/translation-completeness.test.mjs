import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Exercise the production orchestration with provider calls replaced at the
// module boundary. These checks cannot make paid or network requests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const calls = [];
let replies = [];
globalThis.__coverageTestCall = async options => {
  calls.push(options);
  const reply = replies.shift();
  if (reply instanceof Error) throw reply;
  if (typeof reply !== 'string') throw new Error('Unexpected model call');
  return reply;
};
const built = await build({
  entryPoints: [path.join(root, 'services/subtitle-processing/translator.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'isolated-model',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(electron-log|@shared\/constants)$|\/ai-provider\.js$|^\.\/ai-client\.js$/,
          },
          args => ({ path: args.path, namespace: 'mock' })
        );
        b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({
          contents:
            args.path === 'electron-log'
              ? 'export default {info(){},warn(){},error(){},debug(){}};'
              : args.path === '@shared/constants'
                ? 'export const ERROR_CODES = {INSUFFICIENT_CREDITS:"insufficient-credits",OPENAI_KEY_INVALID:"invalid-openai-key",ANTHROPIC_KEY_INVALID:"invalid-anthropic-key",ELEVENLABS_KEY_INVALID:"invalid-elevenlabs-key",OPENAI_RATE_LIMIT:"openai-rate-limit",ANTHROPIC_RATE_LIMIT:"anthropic-rate-limit",ELEVENLABS_RATE_LIMIT:"elevenlabs-rate-limit",OPENAI_INSUFFICIENT_QUOTA:"openai-quota",ANTHROPIC_INSUFFICIENT_QUOTA:"anthropic-quota",ELEVENLABS_INSUFFICIENT_QUOTA:"elevenlabs-quota"}; export const STAGE5_REVIEW_TRANSLATION_MODEL="review-model"; export const normalizeAiModelId=x=>x;'
                : args.path.endsWith('ai-provider.js')
                  ? 'export const resolveTranslationDraftModel=()=>"light-draft-model"; export const resolveTranslationReviewModel=()=>({model:"review-model"});'
                  : 'export const callAIModel=options=>globalThis.__coverageTestCall(options);',
          loader: 'js',
        }));
      },
    },
  ],
});
const { translateBatch, reviewTranslationBatch } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(built.outputFiles[0].text).toString('base64')
);
const segments = [1, 2, 3].map(i => ({
  id: String(i),
  index: i,
  start: i,
  end: i + 1,
  original: `Source ${i}`,
}));
const options = {
  batch: {
    segments,
    startIndex: 0,
    endIndex: 3,
    contextBefore: [],
    contextAfter: [],
  },
  targetLang: 'Korean',
  operationId: 'coverage-fixture',
  qualityMode: false,
};
const set = (...values) => {
  calls.length = 0;
  replies = values;
};

test('real draft entry point repairs omissions with standard mode and only requests absent cues', async () => {
  set('@@SUB_LINE@@ 1: 하나\n@@SUB_LINE@@ 3: 셋', '@@SUB_LINE@@ 2: 둘');
  const result = await translateBatch(options);
  assert.deepEqual(
    result.map(s => s.translation),
    ['하나', '둘', '셋']
  );
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(c => c.qualityMode === false && c.model === 'light-draft-model')
  );
  assert.match(calls[1].messages[1].content, /Line 2:/);
  assert.doesNotMatch(calls[1].messages[1].content, /Line [13]:/);
});
test('real draft entry point does not swallow provider errors or replace failed batches with original text', async () => {
  const failure = new Error('upstream unavailable');
  set(failure);
  await assert.rejects(translateBatch(options), error => error === failure);
  assert.equal(calls.length, 1);
  set('@@SUB_LINE@@ 1: 하나', '', '');
  await assert.rejects(translateBatch(options), /translationIncomplete/);
  assert.equal(calls.length, 3);
});
test('review cannot erase translations with blank or duplicate lines', async () => {
  set(
    '@@SUB_LINE@@ 1: \n@@SUB_LINE@@ 2: revised\n@@SUB_LINE@@ 2: duplicate\n@@SUB_LINE@@ 3: 개선'
  );
  const drafts = segments.map((s, i) => ({
    ...s,
    translation: ['하나', '둘', '셋'][i],
  }));
  const result = await reviewTranslationBatch({
    batch: { ...options.batch, segments: drafts, targetLang: 'Korean' },
    operationId: 'review-fixture',
    initialReviewConfig: { model: 'review-model' },
  });
  assert.deepEqual(
    result.map(s => s.translation),
    ['하나', '둘', '개선']
  );
});
