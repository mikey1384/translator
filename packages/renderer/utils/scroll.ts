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
