import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** How near the end, in pixels, a reader still counts as at the end (owner, 28 November 2026). */
export const NEAR_END = 80;

/** Whether the person asked the system for reduced motion (`docs/design-system.md`, Motion). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const distanceToEnd = (box: HTMLElement): number =>
  box.scrollHeight - box.scrollTop - box.clientHeight;

/**
 * The messages of the chat follow their end (owner, 28 November 2026): a question sent scrolls to
 * the end; while an answer comes in or new messages arrive, the box follows the end only when the
 * reader is within `NEAR_END` of it, and otherwise `behind` asks for the "New messages" button.
 * `content` is any value that changes whenever what the box shows grows or changes.
 */
export function useFollowEnd(content: string): {
  box: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  behind: boolean;
  /** Scrolls to the end: smoothly unless reduced motion is asked for. */
  toEnd: () => void;
  /** A question is sent: the next change of `content` scrolls to the end wherever the reader is. */
  sending: () => void;
} {
  const box = useRef<HTMLDivElement>(null);
  // Where the reader was at the last scroll, before what arrives since.
  const near = useRef(true);
  const smoothNext = useRef(false);
  // A smooth scroll of ours is under way: its own scroll events are not the reader's.
  const moving = useRef<number | null>(null);
  const [behind, setBehind] = useState(false);

  const scrollToEnd = (smooth: boolean): void => {
    const element = box.current;
    if (element === null) return;
    near.current = true;
    setBehind(false);
    if (smooth && !prefersReducedMotion() && typeof element.scrollTo === 'function') {
      moving.current = distanceToEnd(element);
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    } else {
      moving.current = null;
      element.scrollTop = element.scrollHeight;
    }
  };

  const onScroll = (): void => {
    const element = box.current;
    if (element === null) return;
    const distance = distanceToEnd(element);
    if (moving.current !== null) {
      // Coming nearer the end is our own smooth scroll; moving away is the reader's.
      if (distance > 1 && distance <= moving.current) {
        moving.current = distance;
        return;
      }
      moving.current = null;
    }
    near.current = distance <= NEAR_END;
    if (near.current) setBehind(false);
  };

  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    if (near.current) {
      scrollToEnd(smoothNext.current);
      smoothNext.current = false;
    } else if (element.scrollHeight > element.clientHeight) {
      setBehind(true);
    }
  }, [content]);

  // The box itself changes height (the question box grows, the window turns): a reader at the end
  // stays at the end.
  useEffect(() => {
    const element = box.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (near.current && moving.current === null) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return {
    box,
    onScroll,
    behind,
    toEnd: () => {
      scrollToEnd(true);
    },
    sending: () => {
      near.current = true;
      smoothNext.current = true;
    },
  };
}

/** Whether the browser sizes a text area by its content itself (`field-sizing: content`). */
function sizesByContent(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('field-sizing', 'content')
  );
}

/**
 * A text area that grows with its text up to its CSS `max-height`, then scrolls inside (owner, 28
 * November 2026). Browsers with `field-sizing: content` do it from the class alone; elsewhere
 * (Firefox, Safari) the height is measured from `scrollHeight` on each change of `value`, and the
 * line of the caret stays in view.
 */
export function useGrowingField(value: string): RefObject<HTMLTextAreaElement | null> {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (element === null || sizesByContent()) return;
    const scrolled = element.scrollTop;
    element.style.height = 'auto';
    // `scrollHeight` holds the padding, not the border (`box-sizing: border-box`).
    const border = element.offsetHeight - element.clientHeight;
    element.style.height = `${String(element.scrollHeight + border)}px`;
    element.scrollTop = scrolled;
    // Typing at the end, as most do: the caret's line is the last one.
    if (element.selectionEnd === element.value.length) element.scrollTop = element.scrollHeight;
  }, [value]);
  return field;
}
