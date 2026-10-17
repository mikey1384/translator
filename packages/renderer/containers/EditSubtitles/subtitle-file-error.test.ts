import assert from 'node:assert/strict';
import test from 'node:test';

import { subtitleFileErrorMessage } from './subtitle-file-error';

const t = (key: string) => `t:${key}`;

test('opening an .srt never shows raw main-process text', () => {
  const cases: Array<[string, string]> = [
    [
      "ENOENT: no such file or directory, open '/x/a.srt'",
      't:subtitles.fileError.openMissing',
    ],
    [
      "EACCES: permission denied, open '/x/a.srt'",
      't:subtitles.fileError.openPermission',
    ],
    ['ENOSPC: no space left on device', 't:errors.diskSpace.export'],
    ['Failed to read file content.', 't:subtitles.fileError.openFailed'],
    ['', 't:subtitles.fileError.openFailed'],
  ];
  for (const [raw, expected] of cases) {
    const shown = subtitleFileErrorMessage(raw, t, 'open');
    if (expected === 't:errors.diskSpace.export') {
      assert.notEqual(shown, raw);
      assert.ok(shown.startsWith('t:'), shown);
    } else {
      assert.equal(shown, expected, raw);
    }
  }
});

test('saving an .srt never shows raw main-process text', () => {
  assert.equal(
    subtitleFileErrorMessage('Failed to save subtitle document.', t, 'save'),
    't:subtitles.fileError.saveFailed'
  );
  assert.equal(
    subtitleFileErrorMessage(
      new Error("EPERM: operation not permitted, open '/x'"),
      t,
      'save'
    ),
    't:dialogs.exportSaveFailedPermission'
  );
  // "not found" only means a missing file when opening one.
  assert.equal(
    subtitleFileErrorMessage('Document not found', t, 'save'),
    't:subtitles.fileError.saveFailed'
  );
});
