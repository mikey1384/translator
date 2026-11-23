import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  jobDetailsHeaders,
  runWithJobDetails,
} from '../services/job-details.js';
import { runWithConcurrencySerialFallback } from '../services/subtitle-processing/concurrency.js';
import { WIRE_JOB_DETAILS_HEADER } from '../../shared/constants/wire-protocol.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 2));
const sent = () => {
  const header = jobDetailsHeaders()[WIRE_JOB_DETAILS_HEADER];
  return header ? JSON.parse(header) : null;
};

test('requests outside a job carry no details', () => {
  assert.deepEqual(jobDetailsHeaders(), {});
});

test('requests deep inside a job carry its cleaned details', async () => {
  const seen = await runWithJobDetails(
    {
      sourceLanguage: 'EN',
      targetLanguage: 'korean',
      videoSeconds: 1234.4,
      sourceSite: 'youtube.com',
      title: 'never sent',
    } as any,
    async () => {
      await tick();
      return (async () => {
        await tick();
        return sent();
      })();
    }
  );
  assert.deepEqual(seen, {
    sourceLanguage: 'en',
    targetLanguage: 'korean',
    videoSeconds: 1234,
    sourceSite: 'youtube.com',
  });
  assert.deepEqual(jobDetailsHeaders(), {});
});

test('a job with nothing valid to say sends nothing', async () => {
  const seen = await runWithJobDetails(
    { targetLanguage: 'original' },
    async () => sent()
  );
  assert.equal(seen, null);
});

test('details survive the translation batch pool, parallel and serial', async () => {
  const seen: Array<{ phase: string; site: string | undefined }> = [];
  let refusedOnce = false;
  await runWithJobDetails(
    { targetLanguage: 'korean', sourceSite: 'vimeo.com' },
    () =>
      runWithConcurrencySerialFallback({
        taskCount: 6,
        concurrency: 3,
        runTask: async (index, phase) => {
          await tick();
          if (index === 4 && !refusedOnce) {
            refusedOnce = true;
            throw new Error('deferred');
          }
          seen.push({ phase, site: sent()?.sourceSite });
        },
        isDeferrable: error => (error as Error).message === 'deferred',
      })
  );
  assert.equal(seen.length, 6);
  assert.ok(seen.some(entry => entry.phase === 'serial'));
  assert.ok(seen.every(entry => entry.site === 'vimeo.com'));
});

test('two jobs running at once keep their own details', async () => {
  const run = (site: string) =>
    runWithJobDetails({ sourceSite: site as any }, async () => {
      await tick();
      await tick();
      return sent()?.sourceSite;
    });
  assert.deepEqual(await Promise.all([run('vimeo.com'), run('tiktok.com')]), [
    'vimeo.com',
    'tiktok.com',
  ]);
});

test('only credit transcription and translation requests attach the header', () => {
  const source = fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../services/stage5-client.ts'
    ),
    'utf8'
  );
  const attached = [...source.matchAll(/\.\.\.jobDetailsHeaders\(\)/g)].map(
    match => {
      const before = source.slice(0, match.index);
      const posts = [
        ...before.matchAll(/axios\.post\(\s*`\$\{(\w+)\}([^`]*)`/g),
      ];
      const last = posts.at(-1)!;
      return `${last[1]}${last[2]}`;
    }
  );
  assert.deepEqual(attached, [
    'STAGE5_API_URL/transcribe/process/${jobId}',
    'STAGE5_API_URL/transcribe',
    'STAGE5_API_URL/translate',
    'RELAY_URL/translate-direct',
  ]);
});
