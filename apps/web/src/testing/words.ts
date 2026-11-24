/**
 * The words of an element as a person reads them, without the red asterisk of
 * a required field (`RequiredMark`, task 11.18), which is drawn inside a
 * group's legend and hidden from screen readers; exactly what is written
 * otherwise, nothing trimmed but the space before the mark.
 */
export function wordsOf(element: Element | null | undefined): string | undefined {
  if (element === null || element === undefined) {
    return undefined;
  }
  const copy = element.cloneNode(true) as Element;
  const marks = copy.querySelectorAll('[data-required-mark]');
  for (const mark of marks) {
    const before = mark.previousSibling;
    if (before !== null && before.nodeType === 3 && before.textContent === ' ') {
      before.remove();
    }
    mark.remove();
  }
  return copy.textContent ?? undefined;
}
