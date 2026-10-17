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
  focusTabStrip: noop,
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
      if (item.type === 'separator') continue;
      if (item.label === 'Translator') continue; // the app's name
      assert.ok(
        typeof item.label === 'string' && item.label.startsWith('«menu.'),
        `untranslated item: ${JSON.stringify({ role: item.role, label: item.label })}`
      );
    }
  });
}

test('the macOS Window menu lists windows without a stray English item', () => {
  const template = buildAppMenuTemplate({
    platform: 'darwin',
    isDev: false,
    appName: 'Translator',
    t,
    actions,
  });
  const windowMenu = template.find(item => item.role === 'window');
  assert.ok(windowMenu, 'the top-level Window menu carries role window');
  assert.ok(String(windowMenu.label).startsWith('«menu.window»'));
  const inner = walk(windowMenu.submenu as MenuItemConstructorOptions[]);
  assert.ok(!inner.some(item => item.role === 'window'));
});

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

test('F6 moves focus to the tab strip on every platform', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    let calls = 0;
    const template = buildAppMenuTemplate({
      platform,
      isDev: false,
      appName: 'Translator',
      t,
      actions: { ...actions, focusTabStrip: () => calls++ },
    });
    const item = walk(template).find(entry => entry.accelerator === 'F6');
    assert.ok(item, `no F6 item on ${platform}`);
    (item!.click as () => void)();
    assert.equal(calls, 1);
  }
});
