#!/usr/bin/env node
// Preserve published releases and unresolved failures, not completed run history.
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = 'mikey1384/translator';
const BASE = `repos/${REPO}`;
const RELEASE_WORKFLOW = '.github/workflows/release-mac.yml';
const CLEANUP_WORKFLOW = '.github/workflows/cleanup-release-runs.yml';

function runGh(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (cause) {
    const status = String(cause.stderr || '').match(/\(HTTP (\d{3})\)/)?.[1];
    throw Object.assign(new Error('GitHub release cleanup request failed'), status ? { httpStatus: Number(status) } : {});
  }
}
const api = (endpoint) => JSON.parse(runGh(['api', endpoint]));
const remove = (id) => runGh(['api', '--method', 'DELETE', `${BASE}/actions/runs/${id}`]);
const wait = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);

function list(workflow, gh) {
  const runs = [];
  for (let page = 1; page <= 100; page++) {
    const result = gh(`${BASE}/actions/workflows/${workflow}/runs?per_page=100&page=${page}`);
    assert(Array.isArray(result.workflow_runs), 'Invalid workflow listing');
    runs.push(...result.workflow_runs);
    if (result.workflow_runs.length < 100) return runs;
  }
  throw new Error('Workflow listing exceeded its bound');
}

export function requiredMacAssets(tag) {
  const match = /^v(\d+\.\d+\.\d+)(?:-mac)?$/.exec(tag || '');
  assert(match, 'Unsupported release tag');
  return ['latest-mac.yml', ...['arm64', 'x64'].flatMap((arch) =>
    ['dmg', 'dmg.blockmap', 'zip', 'zip.blockmap'].map((ext) =>
      `Translator-${match[1]}-darwin-${arch}.${ext}`))];
}

function verifyPublishedRelease(run, gh) {
  const tag = run.head_branch;
  const expected = requiredMacAssets(tag);
  const release = gh(`${BASE}/releases/tags/${tag}`);
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  assert(release.published_at && Array.isArray(release.assets));
  for (const name of expected) {
    const matches = release.assets.filter((asset) => asset.name === name);
    assert.equal(matches.length, 1, `Published release missing ${name}`);
    assert(matches[0].state === 'uploaded' && Number.isSafeInteger(matches[0].size) && matches[0].size > 0);
    assert.match(matches[0].digest || '', /^sha256:[a-f0-9]{64}$/);
  }
  let object = gh(`${BASE}/git/ref/tags/${tag}`).object;
  for (let i = 0; object?.type === 'tag' && i < 5; i++) object = gh(`${BASE}/git/tags/${object.sha}`).object;
  assert.equal(object?.type, 'commit');
  assert.equal(object.sha, run.head_sha, 'Release tag no longer identifies this run commit');
}

function unchanged(before, after) {
  return after?.status === 'completed' && String(after.id) === String(before.id) &&
    before.path === after.path && before.head_sha === after.head_sha &&
    before.run_attempt === after.run_attempt && before.updated_at === after.updated_at;
}

export function cleanupReleaseRuns(dependencies = {}) {
  const gh = dependencies.github || api;
  const del = dependencies.deleteRun || remove;
  const pause = dependencies.wait || wait;
  const current = String(dependencies.currentRunId || process.env.GITHUB_RUN_ID || '');
  assert.match(current, /^[1-9][0-9]*$/);
  const releases = list('release-mac.yml', gh);
  const cleaners = list('cleanup-release-runs.yml', gh);
  if (releases.some((run) => run.status !== 'completed')) return { deferred: true, deleted: [], requiresReview: [] };
  const deleted = [], requiresReview = [];
  const done = new Map();
  const deleteFinished = (run) => {
    const fresh = gh(`${BASE}/actions/runs/${run.id}`);
    if (!unchanged(run, fresh)) return;
    const artifacts = gh(`${BASE}/actions/runs/${run.id}/artifacts?per_page=100`);
    assert(Number.isSafeInteger(artifacts.total_count), 'Run artifact inventory unavailable');
    if (artifacts.total_count) { requiresReview.push(String(run.id)); return; }
    // A lost response is resolved by one read, never by replaying DELETE.
    try { del(run.id); }
    catch (error) {
      try { gh(`${BASE}/actions/runs/${run.id}`); } catch (check) {
        if (check.httpStatus === 404) { deleted.push(String(run.id)); return; }
        throw check;
      }
      throw error;
    }
    try { gh(`${BASE}/actions/runs/${run.id}`); }
    catch (error) {
      if (error.httpStatus === 404) { deleted.push(String(run.id)); pause(); return; }
      throw error;
    }
    throw new Error('Deleted run remains visible; inspect before retrying');
  };
  for (const candidate of releases.filter((run) => run.status === 'completed' && run.conclusion === 'success')) {
    assert.equal(candidate.path, RELEASE_WORKFLOW);
    const run = gh(`${BASE}/actions/runs/${candidate.id}`);
    if (!unchanged(candidate, run)) continue;
    if (run.repository?.full_name !== REPO || run.head_repository?.full_name !== REPO) {
      requiresReview.push(String(run.id)); continue;
    }
    try {
      if (run.event === 'push') verifyPublishedRelease(run, gh);
      else assert(run.event === 'workflow_dispatch' && run.head_branch === 'master');
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') { requiresReview.push(String(run.id)); continue; }
      throw error;
    }
    done.set(`${run.event}:${run.head_branch}:${run.head_sha}`, true);
    deleteFinished(run);
  }
  // A failed or canceled run is recoverable until a successful run of the
  // same source and tag has finished and its published assets were verified.
  for (const candidate of releases.filter((run) => run.status === 'completed' &&
    ['failure', 'cancelled', 'timed_out'].includes(run.conclusion))) {
    if (candidate.path !== RELEASE_WORKFLOW || !done.has(`${candidate.event}:${candidate.head_branch}:${candidate.head_sha}`)) continue;
    deleteFinished(candidate);
  }
  // The current cleanup is still running, so the next cleanup removes it.
  for (const run of cleaners.filter((item) => item.status === 'completed' &&
    ['success', 'skipped'].includes(item.conclusion) && String(item.id) !== current)) {
    assert.equal(run.path, CLEANUP_WORKFLOW);
    deleteFinished(run);
  }
  return { deferred: false, deleted, requiresReview };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.GITHUB_REPOSITORY, REPO);
    assert.equal(process.env.GITHUB_REF, 'refs/heads/master');
    assert.equal(process.env.GITHUB_WORKFLOW, 'Clean completed release runs');
    const result = cleanupReleaseRuns();
    console.log(JSON.stringify(result));
    if (result.requiresReview.length) process.exitCode = 1;
  } catch (error) { console.error(`Release run cleanup stopped: ${error.message}`); process.exitCode = 1; }
}
