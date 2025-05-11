export function listenClose(
  menuSel: string,
  onClose: () => void,
  keepSel?: string
): () => void {
  const handler = (e: Event) => {
    const t = e.target as HTMLElement | null;

    if (e.type === 'click' || e.type === 'mousedown') {
      if (t?.closest(menuSel) || (keepSel && t?.closest(keepSel))) return;
      return onClose();
    }

    if (e.type === 'keydown') {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Escape') onClose();
    }
  };

  window.addEventListener('click', handler);
  window.addEventListener('keydown', handler);
  return () => {
    window.removeEventListener('click', handler);
    window.removeEventListener('keydown', handler);
  };
}
