import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentSourceBindingIdentitiesMatch,
  agentSourceBindingsMatch,
  parseAgentSourceBinding,
  projectAgentWorkspaceSnapshot,
} from './agent-processing-source-binding';

const planned = {
  source_key: 'media:sha256:planned-source',
  source_kind: 'url',
  planned_duration_seconds: 18_951,
  state: 'preparing',
};

const staleWorkspace = {
  source: {
    videoPath: '/old/workspace.mp4',
    videoReady: true,
    durationSeconds: 1_026,
  },
  subtitles: {
    cueCount: 331,
    translatedCueCount: 331,
    targetLanguage: 'Korean',
    activeFilePath: '/old/workspace.srt',
  },
  outputs: {
    dubbedVideoPath: '/old/dubbed.mp4',
    dubbedAudioPath: null,
    downloadedFilePath: '/old/workspace.mp4',
  },
};

test('a preparing source binding suppresses the tab workspace until mount', () => {
  const binding = parseAgentSourceBinding(planned);
  assert.ok(binding);
  const snapshot = projectAgentWorkspaceSnapshot(binding, staleWorkspace);

  assert.equal(snapshot.source.videoPath, null);
  assert.equal(snapshot.source.durationSeconds, 18_951);
  assert.equal(snapshot.subtitles.cueCount, null);
  assert.equal(snapshot.outputs.downloadedFilePath, null);
  assert.deepEqual(snapshot.source_binding, planned);
});

test('the exact mounted binding exposes the newly mounted workspace', () => {
  const preparing = parseAgentSourceBinding(planned);
  const mounted = parseAgentSourceBinding({ ...planned, state: 'mounted' });
  assert.ok(preparing);
  assert.ok(mounted);
  assert.equal(agentSourceBindingsMatch(preparing, mounted), false);
  assert.equal(agentSourceBindingIdentitiesMatch(preparing, mounted), true);

  const snapshot = projectAgentWorkspaceSnapshot(mounted, staleWorkspace);
  assert.equal(snapshot.source.videoPath, '/old/workspace.mp4');
  assert.equal(snapshot.subtitles.cueCount, 331);
  assert.equal(snapshot.source_binding?.state, 'mounted');
});

test('source identity comparison still rejects a different planned source', () => {
  const preparing = parseAgentSourceBinding(planned);
  const other = parseAgentSourceBinding({
    ...planned,
    source_key: 'media:sha256:different-source',
    state: 'mounted',
  });

  assert.ok(preparing);
  assert.ok(other);
  assert.equal(agentSourceBindingIdentitiesMatch(preparing, other), false);
});

test('malformed source bindings are rejected', () => {
  assert.equal(
    parseAgentSourceBinding({ ...planned, source_key: 'bad\nkey' }),
    null
  );
  assert.equal(
    parseAgentSourceBinding({ ...planned, source_kind: 'unknown' }),
    null
  );
  assert.equal(
    parseAgentSourceBinding({ ...planned, planned_duration_seconds: -1 }),
    null
  );
});
