/**
 * Where keyboard focus goes when a dialog or popup closes: back to whatever
 * opened it. Openers are often menu items that unmount as the dialog opens
 * (⋯ → "Report issue"), so focus is tracked as it moves and an opener that
 * lived inside a menu or listbox falls back to that popup's trigger button.
 */

import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

const POPUP_SELECTOR = '[role="menu"], [role="listbox"]';
const OPEN_TRIGGER_SELECTOR = '[aria-haspopup][aria-expanded="true"]';

/** The button that opened the menu/listbox `el` sits in, if any. */
export function popupTriggerFor(el: Element | null): HTMLElement | null {
  const popup = el?.closest?.(POPUP_SELECTOR);
  if (!popup) return null;
  // Menus here render next to their trigger inside one wrapper.
  let scope: Element | null = popup.parentElement;
  while (scope && scope !== document.body) {
    const trigger = scope.querySelector<HTMLElement>(OPEN_TRIGGER_SELECTOR);
    if (trigger && !popup.contains(trigger)) return trigger;
    scope = scope.parentElement;
  }
  return document.querySelector<HTMLElement>(OPEN_TRIGGER_SELECTOR);
}

interface FocusRecord {
  element: HTMLElement;
  // Resolved when focus arrives, while the popup is still open and its
  // trigger still reads aria-expanded="true".
  fallback: HTMLElement | null;
}

// Most recent last. A few entries, because a dialog may already have pulled
// focus inside itself (an autoFocus field) by the time it asks for its opener.
const history: FocusRecord[] = [];
const HISTORY_SIZE = 8;

/** Exported for tests; the app records through the document listeners below. */
export function recordFocus(el: HTMLElement): void {
  const last = history[history.length - 1];
  const fallback = popupTriggerFor(el);
  if (last?.element === el) {
    if (fallback) last.fallback = fallback;
    return;
  }
  history.push({ element: el, fallback });
  if (history.length > HISTORY_SIZE) history.shift();
}

/** Exported for tests. */
export function clearFocusHistory(): void {
  history.length = 0;
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    event => {
      if (event.target instanceof HTMLElement) recordFocus(event.target);
    },
    true
  );
  // A click doesn't always move focus (macOS buttons), so a menu item picked
  // with the mouse is recorded as it is pressed, with its menu's trigger.
  document.addEventListener(
    'pointerdown',
    event => {
      const target = event.target instanceof Element ? event.target : null;
      const item = target?.closest<HTMLElement>(
        '[role="menuitem"], [role="option"], button, a[href]'
      );
      if (item) recordFocus(item);
    },
    true
  );
}

export interface FocusReturnTarget {
  element: HTMLElement | null;
  fallback: HTMLElement | null;
}

/**
 * Call as a dialog opens. Pass the dialog's own node so focus that already
 * moved inside it (autoFocus) isn't mistaken for the opener.
 */
export function captureFocusReturnTarget(
  container?: HTMLElement | null
): FocusReturnTarget {
  const inside = (el: Element | null) =>
    Boolean(el && container && container.contains(el));
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    !inside(active)
  ) {
    const last = history[history.length - 1];
    const fallback =
      popupTriggerFor(active) ??
      (last?.element === active ? last.fallback : null);
    return { element: active, fallback };
  }
  // The opener already unmounted (a menu closed in the same click), or the
  // dialog took focus first: use the latest focus from outside the dialog.
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const record = history[i];
    if (inside(record.element)) continue;
    return { element: record.element, fallback: record.fallback };
  }
  return { element: null, fallback: null };
}

function focusable(el: HTMLElement | null): el is HTMLElement {
  return Boolean(
    el &&
    el.isConnected &&
    !el.hasAttribute('disabled') &&
    el.getClientRects().length > 0
  );
}

/**
 * Call as the dialog closes. Only moves focus when it was lost (on the body,
 * or still inside the closing dialog), so a click elsewhere is respected.
 */
export function restoreFocus(
  target: FocusReturnTarget,
  container?: HTMLElement | null
): void {
  const active = document.activeElement;
  const lost =
    !active ||
    active === document.body ||
    !active.isConnected ||
    Boolean(container && container.contains(active));
  if (!lost) return;
  for (const el of [target.element, target.fallback]) {
    if (!focusable(el)) continue;
    el.focus();
    if (document.activeElement === el) return;
  }
}

/**
 * For popups and dialogs: remember the opener while `open`, and give focus
 * back to it when the popup closes or unmounts.
 */
export function useReturnFocusWhenClosed(
  open: boolean,
  containerRef?: RefObject<HTMLElement | null>
): void {
  useLayoutEffect(() => {
    if (!open) return;
    const container = containerRef?.current ?? null;
    const returnTo = captureFocusReturnTarget(container);
    return () => {
      window.setTimeout(() => restoreFocus(returnTo, container), 0);
    };
  }, [open, containerRef]);
}
