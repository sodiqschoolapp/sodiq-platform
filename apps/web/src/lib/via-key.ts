import type { TFunction } from 'i18next';

/**
 * Who made a change, with the integration key it was made through (task 10.10; `02`, Audit:
 * "recorded as the person's change, with the key named ('via English platform')").
 */
export function withViaKey(t: TFunction, who: string, viaKey: { name: string } | null): string {
  return viaKey === null ? who : t('audit.viaKey', { who, key: viaKey.name });
}

/**
 * Task 11.13: "<who> via assistant" for a change made through the assistant (`02`, Audit),
 * "<who> via <key>" for one made through a key, or the name alone.
 */
export function withVia(
  t: TFunction,
  who: string,
  viaKey: { name: string } | null,
  viaAssistant: { question: string } | null,
): string {
  return viaAssistant === null ? withViaKey(t, who, viaKey) : t('audit.viaAssistant', { who });
}
