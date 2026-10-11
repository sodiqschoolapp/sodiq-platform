export const ACCOUNTS_VARIABLE = 'SODIQ_E2E_ACCOUNTS';

/** A seeded account that nobody signed in to yet: its first password is still valid. */
export interface Credentials {
  login: string;
  password: string;
}

/** The keys of apps/api/src/testing/e2e/seed.ts. Each test has an account of its own. */
export type AccountKey =
  | 'uz'
  | 'ru'
  | 'en'
  | 'wrongPassword'
  | 'trust'
  | 'patterns'
  | 'forms'
  | 'vicePrincipal'
  | 'superAdmin'
  | 'divisions'
  | 'years'
  | 'templates'
  | 'calendar'
  | 'settings'
  | 'shellTools'
  | 'switchers'
  | 'account'
  | 'accountSecondStep'
  | 'notifications';

/** Invented for the tests. */
export const NEW_PASSWORD = 'a-new-password-73';

export function accountOf(key: AccountKey): Credentials {
  const seeded: unknown = JSON.parse(process.env[ACCOUNTS_VARIABLE] ?? '{}');
  const account =
    typeof seeded === 'object' && seeded !== null
      ? (seeded as Record<string, Partial<Credentials> | undefined>)[key]
      : undefined;
  if (typeof account?.login !== 'string' || typeof account.password !== 'string') {
    throw new Error(`The seed command created no account "${key}".`);
  }
  return { login: account.login, password: account.password };
}
