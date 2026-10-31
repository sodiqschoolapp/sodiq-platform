import { CLOSING_BLOCKING, CLOSING_LOCK_NOW, type ClosingItemKind } from '@sodiq/shared';

/**
 * What an item of the closing checklist does to the close (`07`, Closing a quarter).
 * `edge/journal`: lessons still inside the edit period block closing "unless the Academic Vice
 * Principal chooses 'lock now and close'". Those items (`CLOSING_LOCK_NOW`) are shown apart
 * from the other blocking items, so the page never says "Nothing blocks closing" above rows
 * that say "Blocks closing" (the owner, 31 October 2026).
 */
export type ClosingEffect = 'blocking' | 'lock_now' | 'warning';

export function closingEffect(kind: ClosingItemKind): ClosingEffect {
  if (CLOSING_LOCK_NOW.includes(kind)) {
    return 'lock_now';
  }
  return CLOSING_BLOCKING.includes(kind) ? 'blocking' : 'warning';
}

/** The items of a checklist counted by their effect. */
export function closingCounts(items: readonly { kind: ClosingItemKind }[]): {
  blocking: number;
  lockNow: number;
  warnings: number;
} {
  const effects = items.map((item) => closingEffect(item.kind));
  return {
    blocking: effects.filter((effect) => effect === 'blocking').length,
    lockNow: effects.filter((effect) => effect === 'lock_now').length,
    warnings: effects.filter((effect) => effect === 'warning').length,
  };
}
