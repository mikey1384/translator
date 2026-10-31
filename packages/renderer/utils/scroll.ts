export function smoothScrollTo(y: number) {
  const root = (document.scrollingElement ||
    document.documentElement) as HTMLElement;
  root.style.scrollBehavior = 'smooth';
  root.scrollTo({ top: y });
  setTimeout(() => {
    root.style.scrollBehavior = 'auto';
  }, 600);
}

export function scrollPrecisely(
  el: HTMLElement,
  smooth = false,
  extraOffset = 0
) {
  const offset = getHeaderOffset() + extraOffset;
  const absoluteY = window.scrollY + el.getBoundingClientRect().top - offset;

  if (smooth) {
    smoothScrollTo(absoluteY);
  } else {
    window.scrollTo({ top: absoluteY, behavior: 'auto' });
  }

  function getHeaderOffset() {
    const header = document.querySelector('.fixed-video-container');
    return header?.getBoundingClientRect().height ?? 0;
  }
}

export function flashSubtitle(node: HTMLElement | null) {
  if (!node) return;

  node.classList.remove('highlight-subtitle');
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  node.offsetWidth;
  node.classList.add('highlight-subtitle');

  function handleEnd() {
    if (node) {
      node.classList.remove('highlight-subtitle');
      node.removeEventListener('animationend', handleEnd);
    }
  }
  node.addEventListener('animationend', handleEnd);
}

/**
 * Bring `el` to a third of the way down its scroll area (the nearest
 * scrolling ancestor, or the window) and keep it there for a few frames.
 * The editor renders far-away rows as short placeholders and grows them to
 * full height once they come into view, which pushes a target measured in
 * the first frame off screen; re-measuring until it settles lands on it.
 */
export function settleIntoView(el: HTMLElement, maxFrames = 30) {
  let scroller: HTMLElement | null = el.parentElement;
  while (
    scroller &&
    !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
  ) {
    scroller = scroller.parentElement;
  }
  const step = () => {
    if (!document.contains(el)) return 0;
    const rect = el.getBoundingClientRect();
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const delta = rect.top - box.top - scroller.clientHeight / 3;
      if (Math.abs(delta) > 2) scroller.scrollTop += delta;
      return delta;
    }
    const delta = rect.top - window.innerHeight / 3;
    if (Math.abs(delta) > 2) {
      window.scrollTo({ top: window.scrollY + delta, behavior: 'auto' });
    }
    return delta;
  };
  step();
  let frames = 0;
  let stable = 0;
  const tick = () => {
    frames++;
    const delta = step();
    stable = Math.abs(delta) <= 2 ? stable + 1 : 0;
    if (stable < 3 && frames < maxFrames) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
