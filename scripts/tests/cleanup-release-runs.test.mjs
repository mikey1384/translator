import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupReleaseRuns, requiredMacAssets } from '../cleanup-release-runs.mjs';

function fixture() {
  const commit = 'a'.repeat(40);
  const create = (id, file, extra = {}) => ({ id, path: `.github/workflows/${file}`,
    status: 'completed', conclusion: 'success', event: 'push', head_branch: 'v1.2.3',
    head_sha: commit, run_attempt: 1, updated_at: '2026-11-05T00:00:00Z',
    repository: { full_name: 'mikey1384/translator' }, head_repository: { full_name: 'mikey1384/translator' }, ...extra });
  const success = create(11, 'release-mac.yml');
  const priorFailure = create(12, 'release-mac.yml', { conclusion: 'failure' });
  const unresolved = create(13, 'release-mac.yml', { conclusion: 'failure', head_branch: 'v1.2.2' });
  const priorClean = create(22, 'cleanup-release-runs.yml');
  const activeClean = create(99, 'cleanup-release-runs.yml', { status: 'in_progress' });
  const lists = { 'release-mac.yml': [success, priorFailure, unresolved],
    'cleanup-release-runs.yml': [priorClean, activeClean] };
  const release = { tag_name: 'v1.2.3', draft: false, prerelease: false, published_at: '2026-11-05T00:00:00Z',
    assets: requiredMacAssets('v1.2.3').map((name) => ({ name, state: 'uploaded', size: 123, digest: 'sha256:' + 'f'.repeat(64) })) };
  const removed = new Set(), events = [];
  const deps = { currentRunId: '99', wait: () => {},
    github(endpoint) {
      const listing = endpoint.match(/workflows\/([^/]+)\/runs\?/);
      if (listing) return { workflow_runs: lists[listing[1]] };
      if (endpoint.endsWith('/releases/tags/v1.2.3')) return release;
      if (endpoint.endsWith('/git/ref/tags/v1.2.3')) return { object: { type: 'tag', sha: 'b'.repeat(40) } };
      if (endpoint.includes('/git/tags/')) return { object: { type: 'commit', sha: commit } };
      if (endpoint.endsWith('/artifacts?per_page=100')) return { total_count: 0 };
      const id = Number(endpoint.match(/\/actions\/runs\/(\d+)$/)?.[1]);
      if (removed.has(id)) throw Object.assign(new Error('not found'), { httpStatus: 404 });
      const run = Object.values(lists).flat().find((item) => item.id === id);
      assert(run, `unexpected endpoint ${endpoint}`);
      return { ...run };
    },
    deleteRun(id) { events.push(id); removed.add(Number(id)); }
  };
  return { deps, lists, success, release, events, removed };
}

test('cleans a verified release, its superseded failure and prior cleanup while retaining unresolved failures', () => {
  const f = fixture();
  assert.deepEqual(cleanupReleaseRuns(f.deps), { deferred: false, deleted: ['11', '12', '22'], requiresReview: [] });
  assert.deepEqual(f.events, [11, 12, 22]);
  assert(!f.removed.has(13));
});

test('an active release, missing asset or altered release tag prevents unsafe removal', () => {
  const active = fixture(); active.success.status = 'in_progress';
  assert.equal(cleanupReleaseRuns(active.deps).deferred, true);
  assert.deepEqual(active.events, []);
  const bad = fixture(); bad.release.assets.pop();
  assert.deepEqual(cleanupReleaseRuns(bad.deps).requiresReview, ['11']);
  assert(!bad.removed.has(11)); assert(!bad.removed.has(12));
  const moved = fixture();
  const gh = moved.deps.github;
  moved.deps.github = (endpoint) => endpoint.includes('/git/tags/') ? { object: { type: 'commit', sha: 'b'.repeat(40) } } : gh(endpoint);
  assert.deepEqual(cleanupReleaseRuns(moved.deps).requiresReview, ['11']);
  assert(!moved.removed.has(11));
});

test('refuses unexpected artifacts and never repeats an ambiguous delete', () => {
  const artifact = fixture();
  const gh = artifact.deps.github;
  artifact.deps.github = (endpoint) => endpoint.includes('/runs/11/artifacts') ? { total_count: 1 } : gh(endpoint);
  assert.deepEqual(cleanupReleaseRuns(artifact.deps).requiresReview, ['11']);
  assert(!artifact.removed.has(11));
  const ambiguous = fixture();
  ambiguous.deps.deleteRun = (id) => { ambiguous.events.push(id); throw new Error('lost response'); };
  assert.throws(() => cleanupReleaseRuns(ambiguous.deps), /lost response/);
  assert.deepEqual(ambiguous.events, [11]);
});

test('asset identities are version-bound and restricted to the documented tag forms', () => {
  assert(requiredMacAssets('v1.2.3-mac').includes('Translator-1.2.3-darwin-arm64.dmg'));
  assert.throws(() => requiredMacAssets('v1.2.3/other'));
});
