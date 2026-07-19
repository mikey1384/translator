import test from 'node:test';
import assert from 'node:assert/strict';
import type { VideoSuggestionResultItem } from '@shared-types/app';
import {
  applyVideoSuggestionPipelineProgress,
  createInitialVideoSuggestionPipelineStages,
} from '../../shared/helpers/video-suggestion-pipeline-state.js';
import { finalizeVideoSuggestionSearchMoreResults } from '../../shared/helpers/video-suggestion-result-state.js';
import { MountedDownloadLeaseCoordinator } from '../../renderer/listeners/mounted-download-lease-coordinator.js';

function result(id: string): VideoSuggestionResultItem {
  return {
    id,
    title: id,
    url: `https://example.com/watch/${id}`,
  };
}

test('an empty authoritative Search More reply restores the pre-stream baseline', () => {
  const baseline = [result('existing')];
  const finalState = finalizeVideoSuggestionSearchMoreResults(baseline, []);

  assert.deepEqual(finalState, {
    results: baseline,
    gainedResults: false,
  });
});

test('an exhausted replan reset permits cleared stages to run again', () => {
  const reusedStages = createInitialVideoSuggestionPipelineStages().map(
    stage =>
      stage.key === 'retrieval'
        ? { ...stage, state: 'running' as const }
        : {
            ...stage,
            state: 'cleared' as const,
            outcome: 'Reused the exhausted plan.',
          }
  );
  const resetStages = applyVideoSuggestionPipelineProgress(
    reusedStages,
    {
      operationId: 'search-more',
      phase: 'planning',
      resetPipelineStages: true,
    },
    'Planning fresh angles.'
  );
  const replanningStages = applyVideoSuggestionPipelineProgress(
    resetStages,
    {
      operationId: 'search-more',
      phase: 'planning',
      stageKey: 'planner',
      stageState: 'running',
    },
    'Choosing the best search strategy...'
  );

  assert.ok(resetStages.every(stage => stage.state === 'pending'));
  assert.ok(resetStages.every(stage => stage.outcome === ''));
  assert.equal(
    replanningStages.find(stage => stage.key === 'planner')?.state,
    'running'
  );
});

test('a provisional download lease is acknowledged before opening continues', async () => {
  const reports: string[][] = [];
  let acknowledge: (() => void) | null = null;
  const coordinator = new MountedDownloadLeaseCoordinator({
    reportPaths: filePaths => {
      reports.push(filePaths);
      return new Promise<void>(resolve => {
        acknowledge = resolve;
      });
    },
  });
  const filePath = '/app/downloaded-media/opening [now].mp4';
  let acquired = false;
  const acquisition = coordinator.acquire(filePath).then(release => {
    acquired = true;
    return release;
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reports, [[filePath]]);
  assert.equal(acquired, false);

  const acknowledgeAcquisition = acknowledge as (() => void) | null;
  assert.ok(acknowledgeAcquisition);
  acknowledgeAcquisition();
  const release = await acquisition;
  assert.equal(acquired, true);

  // Resolve the release report as well; it removes the provisional lease when
  // no normal mounted-state lease succeeded it.
  const releasePromise = release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reports, [[filePath], []]);
  const acknowledgeRelease = acknowledge as (() => void) | null;
  assert.ok(acknowledgeRelease);
  acknowledgeRelease();
  await releasePromise;
});

test('normal mounted state succeeds a provisional lease without an empty gap', async () => {
  const reports: string[][] = [];
  const coordinator = new MountedDownloadLeaseCoordinator({
    reportPaths: async filePaths => {
      reports.push(filePaths);
    },
  });
  const filePath = '/app/downloaded-media/mounted.mp4';

  const release = await coordinator.acquire(filePath);
  coordinator.updateMountedPaths([filePath]);
  await release();

  assert.deepEqual(reports, [[filePath]]);
});
