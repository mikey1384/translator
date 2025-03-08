export function addEvent(
  elem: Window | Document | HTMLElement | null,
  type: string,
  eventHandle: any
): void {
  if (!elem) {
    return;
  }
  if (elem.addEventListener) {
    elem.addEventListener(type, eventHandle, false);
  } else if ((elem as any).attachEvent) {
    (elem as any).attachEvent('on' + type, eventHandle);
  } else {
    (elem as any)['on' + type] = eventHandle;
  }
}

export function removeEvent(
  elem: Window | Document | HTMLElement | null,
  type: string,
  eventHandle: any
): void {
  if (!elem) {
    return;
  }
  if (elem.removeEventListener) {
    elem.removeEventListener(type, eventHandle, false);
  } else if ((elem as any).detachEvent) {
    (elem as any).detachEvent('on' + type, eventHandle);
  } else {
    (elem as any)['on' + type] = null;
  }
}
