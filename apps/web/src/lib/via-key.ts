import type { TFunction } from 'i18next';

/**
 * Who made a change, with the integration key it was made through (task 10.10; `02`, Audit:
 * "recorded as the person's change, with the key named ('via English platform')").
 */
export function withViaKey(t: TFunction, who: string, viaKey: { name: string } | null): string {
  return viaKey === null ? who : t('audit.viaKey', { who, key: viaKey.name });
}
