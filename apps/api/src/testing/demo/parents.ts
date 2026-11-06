import { printedParentSlipsSchema } from '@sodiq/shared';
import type { Database } from '../../database/database.js';
import { hashPassword } from '../../modules/auth/password-hash.js';
import type { DemoSchool } from './school.js';

/**
 * The Parent accounts of the demo school (task 11.1, decision 17 of pull request #292): the
 * Academic Vice Principal of each branch prints the slips of every class but the first, through
 * the real route, and each of those parents then holds the demo password as if they had signed
 * in and chosen it. The parents of the first class of each branch keep no account, so that its
 * slips can be printed by hand. The names are the demo's own, invented.
 */
export async function seedParents(input: {
  migrator: Database;
  school: DemoSchool;
  password: string;
  /** The seed's clock: the moment the parents chose the password. */
  now: Date;
  say: (line: string) => void;
}): Promise<void> {
  const { migrator, school, password, now, say } = input;
  const hash = await hashPassword(password);
  for (const branch of school.branches) {
    let accounts = 0;
    for (const [index, schoolClass] of branch.classes.entries()) {
      if (index === 0) {
        say(
          `${branch.name}: the parents of ${String(schoolClass.grade)} ${schoolClass.name} keep no account (their slips are printed by hand)`,
        );
        continue;
      }
      const printed = printedParentSlipsSchema.parse(
        await branch.vice.caller
          .in(branch.id)
          .post(`/api/people/classes/${schoolClass.id}/parent-slips`, {
            language: 'uz',
            printAgain: [],
          }),
      );
      const logins = printed.slips.map((slip) => slip.login);
      if (logins.length === 0) continue;
      await migrator
        .updateTable('accounts')
        .set({
          password_hash: hash,
          must_change_password: false,
          password_expires_at: null,
          password_changed_at: now,
        })
        .where('login', 'in', logins)
        .execute();
      accounts += logins.length;
    }
    say(`${branch.name}: ${String(accounts)} Parent accounts with the demo password`);
  }
}
