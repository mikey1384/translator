/** Reveal a pointer-selected URL without redirecting a held keyboard gesture. */
export function focusExampleUrl(
  input: HTMLInputElement | null,
  url: string,
  pointerActivation: boolean
): void {
  // Enter activates a button on keydown. Moving focus to the form input here
  // would turn its repeated keydowns into implicit Translate submissions.
  // Keyboard/assistive activation keeps focus on the example button instead.
  if (!input || !pointerActivation) return;
  const doc = input.ownerDocument;
  const previousFocus = doc.activeElement;
  doc.defaultView?.requestAnimationFrame(() => {
    if (
      !input.isConnected ||
      input.disabled ||
      input.value !== url ||
      !input.getClientRects().length ||
      doc.activeElement !== previousFocus
    ) {
      return;
    }
    input.focus();
    input.select();
    input.scrollLeft = 0;
  });
}
