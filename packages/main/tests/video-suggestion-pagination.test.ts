import assert from 'node:assert/strict';
import test from 'node:test';

import { splitContinuationPageResults } from '../services/video-suggestions/pagination.ts';
import type { VideoSuggestionResultItem } from '@shared-types/app';

function buildResult(index: number): VideoSuggestionResultItem {
  return {
    id: `video-${index}`,
    title: `Video ${index}`,
    url: `https://www.youtube.com/watch?v=video${index}`,
    channel: `Channel ${index}`,
  };
}

test('splitContinuationPageResults keeps the first page and buffers the remainder', () => {
  const items = Array.from({ length: 45 }, (_, index) => buildResult(index + 1));
  const { pageResults, pendingResults } = splitContinuationPageResults({
    items,
    pageSize: 20,
  });

  assert.equal(pageResults.length, 20);
  assert.equal(pendingResults.length, 20);
  assert.equal(pageResults[0]?.url, items[0]?.url);
  assert.equal(pageResults[19]?.url, items[19]?.url);
  assert.equal(pendingResults[0]?.url, items[20]?.url);
  assert.equal(pendingResults[19]?.url, items[39]?.url);
});

test('splitContinuationPageResults de-duplicates buffered results by URL', () => {
  const items = [
    buildResult(1),
    buildResult(2),
    buildResult(2),
    {
      ...buildResult(3),
      url: '   ',
    },
    buildResult(4),
  ];

  const { pageResults, pendingResults } = splitContinuationPageResults({
    items,
    pageSize: 2,
  });

  assert.deepEqual(
    pageResults.map(item => item.url),
    [buildResult(1).url, buildResult(2).url]
  );
  assert.deepEqual(pendingResults.map(item => item.url), [buildResult(4).url]);
});
