import { useCallback, useSyncExternalStore } from 'react';

/** The widths of `docs/design-system.md`, Breakpoints, as Tailwind names them. */
export const SM = 640;
export const LG = 1024;
export const XL = 1280;

const queryOf = (pixels: number): MediaQueryList | null =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia(`(min-width: ${String(pixels)}px)`)
    : null;

/**
 * Whether the window is at least `pixels` wide, following a resize. Where the
 * browser cannot say (a test without a stub), the window counts as wide: the
 * layout of a desktop, which every page has.
 */
export function useMinWidth(pixels: number): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const query = queryOf(pixels);
      query?.addEventListener('change', listener);
      return () => {
        query?.removeEventListener('change', listener);
      };
    },
    [pixels],
  );
  return useSyncExternalStore(subscribe, () => queryOf(pixels)?.matches ?? true);
}
