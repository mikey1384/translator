import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { assertSubtitleRenderFontReadable } from '../utils/subtitle-render-font.js';

const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');

test('the source subtitle font passes the render preflight', async () => {
  const font = await assertSubtitleRenderFontReadable(
    path.join(projectRoot, 'assets', 'fonts', 'NotoSans-Regular.ttf')
  );

  assert.equal(path.basename(font.path), 'NotoSans-Regular.ttf');
  assert.match(font.url, /^file:/);
});

test('the render preflight fails closed before a missing font can fall back', async () => {
  await assert.rejects(
    () =>
      assertSubtitleRenderFontReadable(
        path.join(projectRoot, 'assets', 'fonts', 'missing-font.ttf')
      ),
    /requires the bundled Noto Sans font.*unreadable/i
  );
});
