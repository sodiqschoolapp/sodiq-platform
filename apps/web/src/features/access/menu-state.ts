import { useSyncExternalStore } from 'react';

/**
 * docs/design-system.md, Layout shell, Menu: the menu "can collapse to a
 * 72-wide rail of icons with the shield logo; the choice is kept in the
 * browser" ("Decided ahead for tasks 2.2d and 2.7", item 5: `localStorage`,
 * key `sodiq.menu`, like the theme). Nothing else reads or writes the key.
 */
export const MENU_STORAGE_KEY = 'sodiq.menu';

export type MenuShape = 'open' | 'rail';

const DEFAULT_SHAPE: MenuShape = 'open';

// A browser may refuse storage (private mode, settings): the choice then lasts
// for the visit only, as with the theme.
let unstored: MenuShape = DEFAULT_SHAPE;

function snapshot(): MenuShape {
  try {
    return window.localStorage.getItem(MENU_STORAGE_KEY) === 'rail' ? 'rail' : DEFAULT_SHAPE;
  } catch {
    return unstored;
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setShape(next: MenuShape): void {
  unstored = next;
  try {
    window.localStorage.setItem(MENU_STORAGE_KEY, next);
  } catch {
    // Nothing to do: see above.
  }
  for (const listener of listeners) {
    listener();
  }
}

/** The shape of the menu and a way to change it. */
export function useMenuShape(): { shape: MenuShape; setShape: (next: MenuShape) => void } {
  return { shape: useSyncExternalStore(subscribe, snapshot), setShape };
}
