import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldBlockFileNavigation } from '../utils/file-navigation-guard.js';

const app = 'file:///Applications/Translator.app/renderer/dist/index.html';

test('a reload of the renderer document is allowed', () => {
  assert.equal(shouldBlockFileNavigation(app, app), false);
  assert.equal(shouldBlockFileNavigation(app, `${app}#/settings`), false);
  assert.equal(shouldBlockFileNavigation(`${app}?tab=2`, app), false);
});

test('a dropped file never replaces the app', () => {
  assert.equal(
    shouldBlockFileNavigation('file:///Users/me/Movies/clip.mp4', app),
    true
  );
});

test('non-file navigations are left to other handlers', () => {
  assert.equal(shouldBlockFileNavigation('http://localhost:5173/', app), false);
});
