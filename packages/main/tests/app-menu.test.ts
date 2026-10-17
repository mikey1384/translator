import test from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import {
  buildAppMenuTemplate,
  buildContextMenuLabels,
  newTabShortcutLabel,
  type MenuT,
} from '../app-menu.js';

const noop = () => {};
const actions = {
  newTab: noop,
  closeTab: noop,
  selectRelativeTab: noop,
  selectTabAtIndex: noop,
  showFindBar: noop,
};

// A fake translator that marks every string it produced.
const t: MenuT = (key, vars, fallback) =>
  `«${key}»${String(fallback ?? '').replace(/\{\{(\w+)\}\}/g, (_m, k) =>
    String(vars?.[k] ?? '')
  )}`;

function walk(
  items: MenuItemConstructorOptions[]
): MenuItemConstructorOptions[] {
  return items.flatMap(item => [
    item,
    ...(Array.isArray(item.submenu) ? walk(item.submenu) : []),
  ]);
}

for (const platform of ['darwin', 'win32'] as const) {
  test(`every visible ${platform} menu item has a translated label`, () => {
    const template = buildAppMenuTemplate({
      platform,
      isDev: false,
      appName: 'Translator',
      t,
      actions,
    });
    for (const item of walk(template)) {
      if (item.type === 'separator' || item.role === 'window') continue;
      if (item.label === 'Translator') continue; // the app's name
      assert.ok(
        typeof item.label === 'string' && item.label.startsWith('«menu.'),
        `untranslated item: ${JSON.stringify({ role: item.role, label: item.label })}`
      );
    }
  });
}

test('the app name fills the macOS About/Hide/Quit labels', () => {
  const [appMenu] = buildAppMenuTemplate({
    platform: 'darwin',
    isDev: false,
    appName: 'Translator',
    t,
    actions,
  });
  const labels = walk([appMenu]).map(item => item.label);
  assert.ok(labels.includes('«menu.quit»Quit Translator'));
});

test('context menu labels are translated', () => {
  const labels = buildContextMenuLabels(t);
  for (const key of [
    'cut',
    'copy',
    'paste',
    'lookUpSelection',
    'searchWithGoogle',
  ]) {
    assert.ok(labels[key].startsWith('«menu.'), key);
  }
  assert.ok(labels.lookUpSelection.includes('{selection}'));
});

test('the new-tab shortcut matches the platform', () => {
  assert.equal(newTabShortcutLabel('darwin'), '⌘T');
  assert.equal(newTabShortcutLabel('win32'), 'Ctrl+T');
});
