import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(
  path.join(root, 'handlers/subtitle-handlers.ts'),
  'utf8'
);
const body = source.slice(
  source.indexOf('export async function handleTranslateOneLine('),
  source.indexOf('export async function handleTranscribeOneLine(')
);
const prelude = `
import {withTranslationReview,translationReviewStatus} from '../shared/helpers/translation-review.ts';
import {isInsufficientCreditsError} from './services/subtitle-processing/errors.ts';
const registerAutoCancel=()=>{};const addSubtitle=(id,c)=>{globalThis.fixtureController=c};const registryFinish=()=>{};
const translateBatch=o=>globalThis.fixtureDraft(o);const reviewTranslationBatch=o=>globalThis.fixtureReview(o);
const getReviewModel=()=>({model:'claude-opus-5-5'}); const getExactAiModelDisplayName=m=>m;
const describeTaskFailure=e=>({cancelled:e.name==='AbortError',stage:'error',error:e.message});
const log={debug(){}};
`;
const built = await build({
  stdin: { contents: prelude + body, loader: 'ts', resolveDir: root },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { handleTranslateOneLine } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(built.outputFiles[0].text).toString('base64')
);
const segment = {
  id: 'single',
  index: 17,
  start: 0,
  end: 3,
  original: 'Check the label.',
};
async function run(review) {
  const progress = [];
  globalThis.fixtureDraft = async ({ batch }) => {
    assert.equal(batch.startIndex, 16);
    return [{ ...segment, translation: 'Compruebe la etiqueta.' }];
  };
  globalThis.fixtureReview = review;
  const result = await handleTranslateOneLine(
    { sender: { send: (channel, p) => progress.push(p) } },
    { segment, targetLanguage: 'Spanish' },
    'translate-single-fixture'
  );
  return { result, progress };
}
test('single cue credit/provider review failure preserves draft with explicit pending review', async () => {
  for (const error of [
    Object.assign(new Error('insufficient-credits'), { status: 402 }),
    new Error('synthetic provider failure'),
  ]) {
    const { result, progress } = await run(async () => {
      throw error;
    });
    assert.equal(result.success, true);
    assert.equal(result.translation, 'Compruebe la etiqueta.');
    assert.equal(result.translationReview.status, 'pending');
    assert.equal(result.review.status, 'incomplete');
    assert.equal(
      progress.at(-1).stage,
      '__i18n__:translationReview.incomplete'
    );
  }
});
test('single cue omitted review stays pending and cancellation keeps the paid draft', async () => {
  const omitted = await run(async ({ batch }) => batch.segments);
  assert.equal(omitted.result.review.status, 'incomplete');
  const cancelled = await run(async () => {
    globalThis.fixtureController.abort();
    throw new DOMException('Cancelled', 'AbortError');
  });
  assert.equal(cancelled.result.cancelled, true);
  assert.equal(cancelled.result.success, false);
  assert.equal(cancelled.result.translationReview.status, 'pending');
  assert(cancelled.result.translation);
});

test('single cue cancellation racing a paid draft preserves coverage partials', async () => {
  globalThis.fixtureDraft = async () => {
    throw Object.assign(new DOMException('Cancelled', 'AbortError'), {
      partialSegments: [{ ...segment, translation: 'Paid draft' }],
    });
  };
  const result = await handleTranslateOneLine(
    { sender: { send() {} } },
    { segment, targetLanguage: 'Spanish' },
    'translate-cancel-partial'
  );
  assert.equal(result.cancelled, true);
  assert.equal(result.translation, 'Paid draft');
  assert.equal(result.translationReview.status, 'pending');
});
