import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCloseGuardPrompt, needsCloseGuard } from '../close-guard.js';

// Echo translator: returns the English default with variables filled in,
// prefixed by the key so tests can see which strings were used.
const t = (
  key: string,
  vars?: Record<string, string | number | null | undefined>,
  fallback?: string
) =>
  `${key}|${String(fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_m, k) =>
    String(vars?.[k] ?? '')
  )}`;

const idle = { title: 'a.mp4', running: false, unsaved: false, job: null };

test('nothing to ask when no tab runs a job or holds unsaved edits', () => {
  assert.equal(needsCloseGuard(idle), false);
  assert.equal(buildCloseGuardPrompt('tab', [idle], t, 'Translator'), null);
  assert.equal(
    buildCloseGuardPrompt('quit', [idle, idle], t, 'Translator'),
    null
  );
});

test('closing a tab with a running translation defaults to Cancel', () => {
  const prompt = buildCloseGuardPrompt(
    'tab',
    [{ ...idle, running: true, job: 'translation' }],
    t,
    'Translator'
  )!;
  assert.match(prompt.message, /^dialogs\.closeGuard\.job\.translation\|/);
  assert.deepEqual(prompt.actions, ['close', 'cancel']);
  assert.equal(
    prompt.buttons[prompt.defaultId],
    prompt.buttons[prompt.cancelId]
  );
  assert.match(prompt.buttons[0], /dialogs\.closeGuard\.stopAndClose/);
});

test('closing a tab with unsaved edits offers Save / Close without saving / Cancel', () => {
  const prompt = buildCloseGuardPrompt(
    'tab',
    [{ ...idle, unsaved: true }],
    t,
    'Translator'
  )!;
  assert.deepEqual(prompt.actions, ['save', 'close', 'cancel']);
  assert.equal(prompt.defaultId, 0);
  assert.equal(prompt.cancelId, 2);
  assert.match(prompt.message, /dialogs\.closeGuard\.unsavedMessage/);
});

test('quitting lists every unfinished tab and names the app', () => {
  const prompt = buildCloseGuardPrompt(
    'quit',
    [
      { ...idle, title: 'one.mp4', running: true, job: 'dubbing' },
      idle,
      { ...idle, title: 'two.mp4', unsaved: true },
    ],
    t,
    'Translator'
  )!;
  assert.match(prompt.message, /Quit Translator\?/);
  assert.match(prompt.detail, /one\.mp4: dialogs\.closeGuard\.job\.dubbing/);
  assert.match(prompt.detail, /two\.mp4: dialogs\.closeGuard\.unsavedLine/);
  assert.doesNotMatch(prompt.detail, /a\.mp4/);
  assert.match(prompt.buttons[0], /saveAndQuit/);
});

test('an unknown job kind still gets a sentence', () => {
  const prompt = buildCloseGuardPrompt(
    'tab',
    [{ ...idle, running: true, job: 'mystery' }],
    t,
    'Translator'
  )!;
  assert.match(
    prompt.message,
    /dialogs\.closeGuard\.job\.generic\|A job is still running\./
  );
});

test('quitting with only unsaved edits does not mention running jobs', () => {
  const prompt = buildCloseGuardPrompt(
    'quit',
    [{ ...idle, title: 'two.mp4', unsaved: true }],
    t,
    'Translator'
  )!;
  assert.match(prompt.detail, /dialogs\.closeGuard\.unsavedOnlyDetail/);
  assert.doesNotMatch(prompt.detail, /unsavedWithJobsDetail|jobsDetail/);
  const withJob = buildCloseGuardPrompt(
    'window',
    [
      { ...idle, title: 'one.mp4', running: true, job: 'dubbing' },
      { ...idle, title: 'two.mp4', unsaved: true },
    ],
    t,
    'Translator'
  )!;
  assert.match(withJob.detail, /dialogs\.closeGuard\.unsavedWithJobsDetail/);
});
