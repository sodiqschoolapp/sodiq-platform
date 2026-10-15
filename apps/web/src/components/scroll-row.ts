import { useEffect, type RefObject } from 'react';

/** Which side of a scrolling row is cut off, if any. */
export type Cut = 'start' | 'end' | 'both' | null;

/** The cut sides of a row from its scroll position (a pixel of rounding allowed). */
export function cutOf(row: { scrollLeft: number; scrollWidth: number; clientWidth: number }): Cut {
  const before = row.scrollLeft > 1;
  const after = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
  return before && after ? 'both' : before ? 'start' : after ? 'end' : null;
}

/**
 * Marks a `.scroll-row` with the sides that are cut (`data-cut`), on a scroll
 * and on a change of size, so the cut edge fades (issue #105, H15).
 */
export function useScrollRow(row: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = row.current;
    if (element === null) {
      return;
    }
    const mark = () => {
      const cut = cutOf(element);
      if (cut === null) {
        element.removeAttribute('data-cut');
      } else {
        element.setAttribute('data-cut', cut);
      }
    };
    mark();
    element.addEventListener('scroll', mark, { passive: true });
    // Not every browser of the tests has a ResizeObserver.
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(mark) : null;
    resized?.observe(element);
    return () => {
      element.removeEventListener('scroll', mark);
      resized?.disconnect();
    };
  });
}
