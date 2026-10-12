import type { Actor } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';

/**
 * Who gave or ended roles: the login always, the name only when the staff
 * record of that account is in a branch this transaction may read (the
 * membership filter), never through a function that reads every branch
 * (correction 1 of the review of pull request #62).
 */
export async function actorsOf(
  transaction: Transaction,
  ids: readonly (string | null)[],
): Promise<Map<string, Actor>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const actors = new Map<string, Actor>();
  if (wanted.length === 0) {
    return actors;
  }
  const logins = await transaction
    .selectFrom('accounts')
    .select(['id', 'login'])
    .where('id', 'in', wanted)
    .execute();
  const names = await transaction
    .selectFrom('staff')
    .select(['account_id', 'first_name', 'last_name'])
    .where('account_id', 'in', wanted)
    .where('kind', '=', 'person')
    .execute();
  for (const row of logins) {
    const named = names.find((name) => name.account_id === row.id);
    actors.set(row.id, {
      login: row.login,
      name:
        named?.first_name == null || named.last_name == null
          ? null
          : { firstName: named.first_name, lastName: named.last_name },
    });
  }
  return actors;
}
