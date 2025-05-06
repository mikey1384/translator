export function flashSubtitle(node: HTMLElement | null) {
  if (!node) return;

  // restart the animation if the class was already there
  node.classList.remove('highlight-subtitle');
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  node.offsetWidth; // force reflow
  node.classList.add('highlight-subtitle');

  // clean-up after it finishes (600 ms defined in CSS)
  function handleEnd() {
    // Check node again inside the handler just in case, though unlikely
    if (node) {
      node.classList.remove('highlight-subtitle');
      node.removeEventListener('animationend', handleEnd);
    }
  }
  node.addEventListener('animationend', handleEnd);
}
