import { vi } from 'vitest';

/**
 * A window `pixels` wide for `useMinWidth` (task 2.7b-2): every
 * `(min-width: …px)` query answers by it. Unstubbed after each test
 * (test-setup.ts); without it a test's window counts as wide.
 */
export function setWindowWidth(pixels: number): void {
  vi.stubGlobal('matchMedia', (media: string) => {
    const found = /^\(min-width: (\d+)px\)$/.exec(media);
    return {
      matches: found === null ? false : pixels >= Number(found[1]),
      media,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
  });
}
