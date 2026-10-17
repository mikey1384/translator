import assert from 'node:assert/strict';
import test from 'node:test';

// A tiny stand-in DOM: enough for focusReturn's lookups, no browser needed.
class FakeElement {
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  attrs: Record<string, string> = {};
  connected = true;
  constructor(public name: string) {}
  append(...kids: FakeElement[]) {
    for (const kid of kids) {
      kid.parent = this;
      this.children.push(kid);
    }
    return this;
  }
  get parentElement() {
    return this.parent;
  }
  get isConnected() {
    return this.connected;
  }
  hasAttribute(name: string) {
    return name in this.attrs;
  }
  getClientRects() {
    return this.connected ? [{}] : [];
  }
  contains(other: FakeElement | null): boolean {
    for (let el = other; el; el = el.parent) if (el === this) return true;
    return false;
  }
  matches(selector: string): boolean {
    if (selector.includes('role="menu"'))
      return this.attrs.role === 'menu' || this.attrs.role === 'listbox';
    if (selector.includes('aria-expanded="true"'))
      return (
        'aria-haspopup' in this.attrs && this.attrs['aria-expanded'] === 'true'
      );
    return false;
  }
  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    return this.parent ? this.parent.closest(selector) : null;
  }
  querySelector(selector: string): FakeElement | null {
    for (const kid of this.children) {
      if (kid.matches(selector)) return kid;
      const found = kid.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  focus() {
    fakeDocument.activeElement = this;
  }
}

const body = new FakeElement('body');
const fakeDocument = {
  body,
  activeElement: body as FakeElement,
  querySelector: (selector: string) => body.querySelector(selector),
  addEventListener: () => {},
};
(globalThis as any).HTMLElement = FakeElement;
(globalThis as any).Element = FakeElement;
(globalThis as any).document = fakeDocument;

const {
  captureFocusReturnTarget,
  clearFocusHistory,
  recordFocus,
  restoreFocus,
} = await import('./focusReturn');

function setup() {
  clearFocusHistory();
  body.children = [];
  const wrapper = new FakeElement('wrapper');
  const trigger = new FakeElement('trigger');
  trigger.attrs = { 'aria-haspopup': 'menu', 'aria-expanded': 'false' };
  const menu = new FakeElement('menu');
  menu.attrs = { role: 'menu' };
  const item = new FakeElement('report issue');
  menu.append(item);
  wrapper.append(trigger);
  body.append(wrapper);
  const dialog = new FakeElement('dialog');
  const textarea = new FakeElement('textarea');
  dialog.append(textarea);
  const focus = (el: FakeElement) => {
    fakeDocument.activeElement = el;
    recordFocus(el as unknown as HTMLElement);
  };
  const openMenu = () => {
    trigger.attrs['aria-expanded'] = 'true';
    wrapper.append(menu);
  };
  // The menu item picks the dialog: the menu unmounts, the trigger collapses
  // and the dialog autoFocuses its field before asking for its opener.
  const pickItemOpeningDialog = () => {
    wrapper.children = wrapper.children.filter(kid => kid !== menu);
    menu.connected = false;
    item.connected = false;
    trigger.attrs['aria-expanded'] = 'false';
    body.append(dialog);
    focus(textarea);
  };
  const closeDialog = () => {
    body.children = body.children.filter(kid => kid !== dialog);
    dialog.connected = false;
    textarea.connected = false;
    fakeDocument.activeElement = body;
  };
  return {
    trigger,
    item,
    dialog,
    focus,
    openMenu,
    pickItemOpeningDialog,
    closeDialog,
  };
}

test('a dialog opened from a ⋯ menu item returns focus to the ⋯ trigger', () => {
  const s = setup();
  s.focus(s.trigger);
  s.openMenu();
  s.focus(s.item);
  s.pickItemOpeningDialog();
  const target = captureFocusReturnTarget(s.dialog as unknown as HTMLElement);
  assert.equal(target.element, s.item);
  assert.equal(target.fallback, s.trigger);
  s.closeDialog();
  restoreFocus(target, s.dialog as unknown as HTMLElement);
  assert.equal(fakeDocument.activeElement, s.trigger);
});

test('a mouse pick that never focused the item still finds the trigger', () => {
  const s = setup();
  s.focus(s.trigger);
  s.openMenu();
  // pointerdown records the item without moving focus
  recordFocus(s.item as unknown as HTMLElement);
  s.pickItemOpeningDialog();
  const target = captureFocusReturnTarget(s.dialog as unknown as HTMLElement);
  s.closeDialog();
  restoreFocus(target, s.dialog as unknown as HTMLElement);
  assert.equal(fakeDocument.activeElement, s.trigger);
});

test('a plain button opener gets focus back directly', () => {
  const s = setup();
  s.focus(s.trigger);
  const target = captureFocusReturnTarget(s.dialog as unknown as HTMLElement);
  assert.equal(target.element, s.trigger);
  s.closeDialog();
  restoreFocus(target);
  assert.equal(fakeDocument.activeElement, s.trigger);
});
