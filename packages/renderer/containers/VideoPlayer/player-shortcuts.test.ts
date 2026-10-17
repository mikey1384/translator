import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTextEntryTarget,
  resolvePlayerShortcut,
  shouldHandlePlayerShortcut,
  type ShortcutTarget,
} from './player-shortcuts';
import {
  clampVolume,
  readStoredVolume,
  toggledMute,
  withVolume,
  writeStoredVolume,
  VOLUME_STORAGE_KEY,
} from './player-volume';

// A tiny element stand-in: `matches` lists the selectors (comma parts) that
// this element or an ancestor matches.
function el(
  tagName: string,
  {
    type,
    matches = [],
    editable = false,
  }: { type?: string; matches?: string[]; editable?: boolean } = {}
): ShortcutTarget {
  return {
    tagName,
    isContentEditable: editable,
    getAttribute: name => (name === 'type' ? (type ?? null) : null),
    closest: selector =>
      selector
        .split(',')
        .map(part => part.trim())
        .some(part => matches.includes(part))
        ? {}
        : null,
  };
}

const press = (key: string, target: ShortcutTarget | null, extra = {}) =>
  shouldHandlePlayerShortcut({ key, target, ...extra });

test('maps player keys to actions', () => {
  assert.equal(resolvePlayerShortcut(' '), 'toggle-play');
  assert.equal(resolvePlayerShortcut('K'), 'toggle-play');
  assert.equal(resolvePlayerShortcut('ArrowRight'), 'seek-forward');
  assert.equal(resolvePlayerShortcut('ArrowUp'), 'volume-up');
  assert.equal(resolvePlayerShortcut('m'), 'toggle-mute');
  assert.equal(resolvePlayerShortcut('x'), null);
});

test('typing targets never trigger shortcuts', () => {
  assert.equal(isTextEntryTarget(el('INPUT')), true);
  assert.equal(isTextEntryTarget(el('INPUT', { type: 'search' })), true);
  assert.equal(isTextEntryTarget(el('INPUT', { type: 'range' })), false);
  assert.equal(isTextEntryTarget(el('TEXTAREA')), true);
  assert.equal(isTextEntryTarget(el('SELECT')), true);
  assert.equal(isTextEntryTarget(el('DIV', { editable: true })), true);
  assert.equal(press('k', el('TEXTAREA')), false);
  assert.equal(press(' ', el('INPUT')), false);
});

test('works from the page and from a clicked subtitle row', () => {
  assert.equal(press(' ', el('BODY')), true);
  assert.equal(press(' ', null), true);
  // A row button is excluded from native Space activation on purpose.
  const row = el('BUTTON', { matches: [] });
  assert.equal(press(' ', row), true);
  assert.equal(press('ArrowLeft', row), true);
  assert.equal(press('k', row), true);
});

test('Space on other buttons keeps its native click', () => {
  const button = el('BUTTON', {
    matches: ['button:not([data-cue-id])'],
  });
  assert.equal(press(' ', button), false);
  assert.equal(press('k', button), true);
  assert.equal(press('m', button), true);
});

test('arrows stay with radio groups, sliders and menus', () => {
  const radio = el('BUTTON', {
    matches: ['[role="radiogroup"]', '[role="radio"]'],
  });
  assert.equal(press('ArrowRight', radio), false);
  assert.equal(press('k', radio), true);
  const range = el('INPUT', {
    type: 'range',
    matches: ['input[type="range"]'],
  });
  assert.equal(press('ArrowLeft', range), false);
  assert.equal(press(' ', range), true);
  const menu = el('BUTTON', { matches: ['[role="menu"]'] });
  assert.equal(press('k', menu), false);
});

test('modifiers, handled events and open modals are left alone', () => {
  assert.equal(press('k', null, { metaKey: true }), false);
  assert.equal(press('ArrowRight', null, { altKey: true }), false);
  assert.equal(press(' ', null, { defaultPrevented: true }), false);
  assert.equal(
    shouldHandlePlayerShortcut({ key: ' ', target: null }, { modalOpen: true }),
    false
  );
});

test('volume clamps, toggles and persists', () => {
  assert.equal(clampVolume(1.4), 1);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(Number.NaN), 1);
  assert.equal(clampVolume(0.333), 0.33);

  assert.deepEqual(toggledMute({ volume: 0.8, muted: false }), {
    volume: 0.8,
    muted: true,
  });
  assert.deepEqual(toggledMute({ volume: 0.8, muted: true }), {
    volume: 0.8,
    muted: false,
  });
  // Unmuting at zero comes back audible.
  assert.deepEqual(toggledMute({ volume: 0, muted: true }), {
    volume: 0.5,
    muted: false,
  });
  assert.deepEqual(withVolume({ volume: 0.2, muted: true }, 0.6), {
    volume: 0.6,
    muted: false,
  });

  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  assert.deepEqual(readStoredVolume(storage), { volume: 1, muted: false });
  writeStoredVolume({ volume: 0.4, muted: true }, storage);
  assert.deepEqual(readStoredVolume(storage), { volume: 0.4, muted: true });
  data.set(VOLUME_STORAGE_KEY, '{bad json');
  assert.deepEqual(readStoredVolume(storage), { volume: 1, muted: false });
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(readStoredVolume(throwing), { volume: 1, muted: false });
  assert.doesNotThrow(() =>
    writeStoredVolume({ volume: 1, muted: false }, throwing)
  );
});
