import assert from 'node:assert/strict';
import test from 'node:test';

import {
  openDownloadSwitchConfirm,
  resolveDownloadSwitch,
  useModalStore,
} from './modal-store.js';

test('caption recovery uses distinct video-switch copy context and resets it', async () => {
  const decision = openDownloadSwitchConfirm('caption_recovery');

  assert.equal(useModalStore.getState().downloadSwitchOpen, true);
  assert.equal(
    useModalStore.getState().downloadSwitchContext,
    'caption_recovery'
  );

  resolveDownloadSwitch(false);

  assert.equal(await decision, false);
  assert.equal(useModalStore.getState().downloadSwitchOpen, false);
  assert.equal(
    useModalStore.getState().downloadSwitchContext,
    'downloaded_video'
  );
});
