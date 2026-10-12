import type { Kysely } from 'kysely';
import type { DB } from '../database/types.generated.js';

let made = 0;

/**
 * A subject of the STEAM department for a test, written as the migrator. The
 * names are made unique, because two active subjects never share a name.
 */
export async function insertSubject(
  migrator: Kysely<DB>,
  name = 'Subject',
  archived?: Date,
): Promise<string> {
  made += 1;
  const unique = `${name} ${String(made)}`;
  const steam = await migrator
    .selectFrom('departments')
    .select('id')
    .where('name_en', '=', 'STEAM')
    .executeTakeFirstOrThrow();
  const inserted = await migrator
    .insertInto('subjects')
    .values({
      name_uz: unique,
      name_ru: unique,
      name_en: unique,
      department_id: steam.id,
      grades: [7, 8, 9],
      colour: 'blue',
      journal_type: 'graded',
      ...(archived === undefined ? {} : { archived_at: archived }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return inserted.id;
}
