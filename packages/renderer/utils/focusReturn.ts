/**
 * Where keyboard focus goes when a dialog or popup closes: back to whatever
 * opened it. Openers are often menu items that unmount as the dialog opens
 * (⋯ → "Report issue"), so focus is tracked as it moves and an opener that
 * lived inside a menu or listbox falls back to that popup's trigger button.
 */

import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

let lastFocused: HTMLElement | null = null;
let lastPopupTrigger: HTMLElement | null = null;

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

if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    event => {
      if (!(event.target instanceof HTMLElement)) return;
      lastFocused = event.target;
      lastPopupTrigger = popupTriggerFor(event.target);
    },
    true
  );
}

export interface FocusReturnTarget {
  element: HTMLElement | null;
  fallback: HTMLElement | null;
}

/** Call as a dialog opens, before it moves focus inside itself. */
export function captureFocusReturnTarget(): FocusReturnTarget {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    return { element: active, fallback: popupTriggerFor(active) };
  }
  // The opener already unmounted (a menu closed in the same click).
  return { element: lastFocused, fallback: lastPopupTrigger };
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
    const returnTo = captureFocusReturnTarget();
    const container = containerRef?.current ?? null;
    return () => {
      window.setTimeout(() => restoreFocus(returnTo, container), 0);
    };
  }, [open, containerRef]);
}
