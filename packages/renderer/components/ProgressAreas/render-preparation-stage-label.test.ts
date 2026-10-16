import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import i18next from 'i18next';
import { renderPreparationStageLabel } from './render-preparation-stage-label.js';

test('every locale turns download progress into user-facing text without internal stages', async () => {
  const dir = new URL('../../locales/', import.meta.url);
  for (const name of await fs.readdir(dir)) {
    if (!/^[a-z]{2}(?:-[A-Z]{2})?\.json$/.test(name)) continue;
    const translation = JSON.parse(
      await fs.readFile(new URL(name, dir), 'utf8')
    );
    assert.ok(translation.progress.preparingVideoExport, name);
    assert.ok(
      translation.progress.downloadingVideoExportTools.includes('{{percent}}'),
      name
    );
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'test',
      resources: { test: { translation } },
      interpolation: { escapeValue: false },
    });
    for (const stage of ['waiting', 'downloading', 'installing', 'ready']) {
      const label = renderPreparationStageLabel(
        `render-tools:${stage}:42`,
        i18n.t
      );
      assert.ok(
        !label.includes('render-tools:') && !label.includes('{{'),
        `${name}: ${label}`
      );
      if (stage === 'downloading') assert.ok(label.includes('42'), name);
    }
    assert.equal(
      renderPreparationStageLabel('Rendering frames', i18n.t),
      'Rendering frames'
    );
  }
});
