export type PlayerShortcut =
  | 'toggle-play'
  | 'seek-forward'
  | 'seek-back'
  | 'volume-up'
  | 'volume-down'
  | 'toggle-mute'
  | 'speed-up'
  | 'speed-down'
  | 'toggle-fullscreen';

/** The slice of a DOM element the shortcut checks read. */
export interface ShortcutTarget {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
  closest?(selector: string): unknown;
}

export interface ShortcutKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  target?: ShortcutTarget | null;
}

export function resolvePlayerShortcut(key: string): PlayerShortcut | null {
  switch (key) {
    case ' ':
    case 'Spacebar':
    case 'k':
    case 'K':
      return 'toggle-play';
    case 'ArrowRight':
      return 'seek-forward';
    case 'ArrowLeft':
      return 'seek-back';
    case 'ArrowUp':
      return 'volume-up';
    case 'ArrowDown':
      return 'volume-down';
    case 'm':
    case 'M':
      return 'toggle-mute';
    case 'f':
    case 'F':
      return 'toggle-fullscreen';
    case '>':
    case '.':
      return 'speed-up';
    case '<':
    case ',':
      return 'speed-down';
    default:
      return null;
  }
}

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'radio',
  'range',
  'reset',
  'submit',
  'color',
  'file',
  'image',
]);

/** Typing goes to the field: inputs, textareas, selects, contenteditable. */
export function isTextEntryTarget(target?: ShortcutTarget | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = String(target.getAttribute?.('type') || 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

// Widgets where arrows already mean something (move a radio, menu item,
// tab or slider).
const OWN_ARROWS_SELECTOR =
  '[role="radiogroup"], [role="radio"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="slider"], [role="tablist"], [role="tab"], [role="dialog"], input[type="range"], .captions-menu';

// Popups that own every key while focused.
const OWN_ALL_KEYS_SELECTOR =
  '[role="menu"], [role="listbox"], [role="dialog"], .captions-menu';

// Controls Space activates natively. A subtitle row is excluded: Space there
// plays/pauses instead of seeking to the line again.
const SPACE_ACTIVATES_SELECTOR =
  'button:not([data-cue-id]), a[href], input:not([type="range"]), [role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"]';

const isArrow = (key: string) => key.startsWith('Arrow');
const isSpace = (key: string) => key === ' ' || key === 'Spacebar';

/**
 * Whether a window keydown should drive the player. Player keys work wherever
 * focus is, except while typing, inside widgets that use the same keys, or
 * while a modal is open. Volume arrows only work on the player.
 */
export function shouldHandlePlayerShortcut(
  event: ShortcutKeyEvent,
  {
    modalOpen = false,
    inPlayer = false,
    fullscreen = false,
  }: {
    modalOpen?: boolean;
    /** Focus is on the player or one of its controls. */
    inPlayer?: boolean;
    fullscreen?: boolean;
  } = {}
): boolean {
  if (event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const action = resolvePlayerShortcut(event.key);
  if (!action) return false;
  if (modalOpen) return false;
  // ↑/↓ scroll the page and the subtitle list everywhere else; they change
  // the volume only on the player itself or in full screen.
  if (
    (action === 'volume-up' || action === 'volume-down') &&
    !inPlayer &&
    !fullscreen
  ) {
    return false;
  }
  const target = event.target ?? null;
  if (isTextEntryTarget(target)) return false;
  if (target?.closest?.(OWN_ALL_KEYS_SELECTOR)) return false;
  if (isArrow(event.key) && target?.closest?.(OWN_ARROWS_SELECTOR)) {
    return false;
  }
  if (isSpace(event.key) && target?.closest?.(SPACE_ACTIVATES_SELECTOR)) {
    return false;
  }
  return true;
}
