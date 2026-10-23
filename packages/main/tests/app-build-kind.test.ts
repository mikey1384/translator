import assert from 'node:assert/strict';
import test from 'node:test';
import { appBuildKind } from '../utils/app-build-kind.js';

test('only real installs report no build kind', () => {
  assert.equal(appBuildKind({ isPackaged: false, env: {} }), 'dev');
  assert.equal(
    appBuildKind({ isPackaged: false, env: { STAGE5_TEST_RUN: '1' } }),
    'dev'
  );
  assert.equal(
    appBuildKind({ isPackaged: true, env: { STAGE5_TEST_RUN: '1' } }),
    'test'
  );
  assert.equal(appBuildKind({ isPackaged: true, env: {} }), null);
});
