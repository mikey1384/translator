import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPrintedYtDlpMetadataLine,
  buildYtDlpMetadataPrintArgs,
} from '../services/url-processor/download-metadata.ts';

test('buildYtDlpMetadataPrintArgs emits prefixed before-download metadata prints', () => {
  const args = buildYtDlpMetadataPrintArgs();

  assert.ok(args.includes('--print'));
  assert.ok(
    args.includes('before_dl:__stage5_meta__title\t%(title)s'),
    'title metadata print should be requested'
  );
  assert.ok(
    args.includes('before_dl:__stage5_meta__channel_url\t%(channel_url)s'),
    'channel_url metadata print should be requested'
  );
});

test('applyPrintedYtDlpMetadataLine accumulates supported metadata fields', () => {
  let info: Record<string, unknown> | null = null;

  info = applyPrintedYtDlpMetadataLine(
    info,
    '__stage5_meta__title\tExample video'
  );
  info = applyPrintedYtDlpMetadataLine(
    info,
    '__stage5_meta__channel\tExample channel'
  );
  info = applyPrintedYtDlpMetadataLine(
    info,
    '__stage5_meta__channel_url\thttps://www.youtube.com/@example'
  );

  assert.deepEqual(info, {
    title: 'Example video',
    channel: 'Example channel',
    channel_url: 'https://www.youtube.com/@example',
  });
});

test('applyPrintedYtDlpMetadataLine ignores blank placeholder values', () => {
  const seed = {
    title: 'Keep me',
  };

  const info = applyPrintedYtDlpMetadataLine(seed, '__stage5_meta__title\tNA');

  assert.deepEqual(info, seed);
});
