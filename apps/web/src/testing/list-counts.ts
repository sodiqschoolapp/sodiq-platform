import { within } from '@testing-library/react';
import type { CountKind } from '@/components/list/list-state';
import { en } from '@/i18n/locales/en';

/**
 * A number of the counts beside the filters of a list, in English ("3 left"):
 * the list opens on its records in use and names the others, each one a click
 * away (owner, 28 November 2026).
 */
export const countText = (kind: CountKind, n: number): string =>
  en.list.counts[`${kind}_${n === 1 ? 'one' : 'other'}`].replace('{{n}}', String(n));

/** The counts beside the filters as they read together ("2 current·1 left"), or `null`. */
export const countsDrawn = (): string | null =>
  document.querySelector('[data-slot="archive-counts"]')?.textContent ?? null;

/** The button of one number of the counts. */
export const countButton = (kind: CountKind, n: number): HTMLElement => {
  const counts = document.querySelector<HTMLElement>('[data-slot="archive-counts"]');
  if (counts === null) throw new Error('No counts beside the filters');
  return within(counts).getByRole('button', { name: countText(kind, n) });
};
