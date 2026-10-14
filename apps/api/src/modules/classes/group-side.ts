import type { ErrorDetail, InstructionLanguage } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { classesOfGroups, sharedLanguageOf } from './group-rows.js';

/**
 * The other side of a group (task 3.2a, decisions 8 and 16 of pull request
 * #91): what a class's or a subject's change does to its active groups. The
 * database keeps the same rules (db/migrations/0046); these answer first, with
 * the groups named.
 */

/**
 * Before a class's language change: the class and every class of its active
 * groups, locked FOR UPDATE in the order of their id, before the class edit
 * locks its own row or a group (spec review of the build, must-fix 1). Two
 * language changes of two classes of one group then wait for each other in
 * one order, and a group write, which takes its classes FOR SHARE first,
 * waits for them both.
 *
 * The classes are read again after the lock, in a statement of their own: a
 * group created while this change waited brings classes the first read did
 * not see (code round 1 of pull request #91, finding 2). Then the locks of
 * the savepoint are given back and the whole set is locked again in the order
 * of the id, so that what is locked is the set the decision names and the
 * order holds for it; a lock taken out of that order would deadlock with a
 * language change of the new class.
 */
export async function lockClassesOfGroups(
  transaction: Transaction,
  classId: string,
): Promise<void> {
  await sql`savepoint class_language_locks`.execute(transaction);
  let ids = await classesOfActiveGroups(transaction, classId);
  for (;;) {
    await transaction
      .selectFrom('classes')
      .select('id')
      .where('id', 'in', ids)
      .orderBy('id')
      .forUpdate()
      .execute();
    const again = await classesOfActiveGroups(transaction, classId);
    if (again.every((id) => ids.includes(id))) {
      break;
    }
    await sql`rollback to savepoint class_language_locks`.execute(transaction);
    ids = [...new Set([...ids, ...again])].sort();
  }
  await sql`release savepoint class_language_locks`.execute(transaction);
}

/** The class and the classes of its active groups, sorted, each once; read without a lock. */
async function classesOfActiveGroups(transaction: Transaction, classId: string): Promise<string[]> {
  const related = await transaction
    .selectFrom('group_classes as mine')
    .innerJoin('groups', 'groups.id', 'mine.group_id')
    .innerJoin('group_classes as theirs', 'theirs.group_id', 'mine.group_id')
    .select('theirs.class_id')
    .where('mine.class_id', '=', classId)
    .where('groups.archived_at', 'is', null)
    .execute();
  return [...new Set([classId, ...related.map((row) => row.class_id)])].sort();
}

/** A group a class language change moved, or made mix languages. */
export type GroupLanguageChange = {
  id: string;
  name: string;
  from: string;
  to: string;
};

/**
 * A class's language change (decision 8): every active group of the class
 * whose classes then share one language takes it, in the same transaction; a
 * group of a subject under the language rule that the change makes mix
 * languages keeps its language and needs `confirmed` (409
 * `class_language_mixes_groups`, the groups named, otherwise). Runs under the
 * class's lock FOR UPDATE, taken before (correction 1); the groups are locked
 * FOR UPDATE in the order of their id. The answer is for the class's audit
 * entry.
 */
export async function followClassLanguage(
  transaction: Transaction,
  classId: string,
  language: InstructionLanguage,
  confirmed: boolean,
): Promise<{ moved: GroupLanguageChange[]; mixed: GroupLanguageChange[] }> {
  const groups = await transaction
    .selectFrom('group_classes')
    .innerJoin('groups', 'groups.id', 'group_classes.group_id')
    .innerJoin('subjects', 'subjects.id', 'groups.subject_id')
    .select(['groups.id', 'groups.name', 'groups.language', 'subjects.language_rule'])
    .where('group_classes.class_id', '=', classId)
    .where('groups.archived_at', 'is', null)
    .orderBy('groups.id')
    .forUpdate('groups')
    .execute();
  const classes = await classesOfGroups(
    transaction,
    groups.map((group) => group.id),
  );
  const moved: GroupLanguageChange[] = [];
  const mixed: GroupLanguageChange[] = [];
  for (const group of groups) {
    const before = classes.get(group.id) ?? [];
    const after = before.map((one) => (one.id === classId ? { ...one, language } : one));
    const shared = sharedLanguageOf(after);
    if (shared !== null) {
      if (shared !== group.language) {
        moved.push({ id: group.id, name: group.name, from: group.language, to: shared });
      }
    } else if (sharedLanguageOf(before) !== null && group.language_rule) {
      mixed.push({ id: group.id, name: group.name, from: group.language, to: group.language });
    }
  }
  if (mixed.length > 0 && !confirmed) {
    throw new ApiException(
      'class_language_mixes_groups',
      409,
      undefined,
      mixed.map((group): ErrorDetail => ({
        path: `group.${group.id}`,
        code: 'mixes',
        message: 'An active group of this class would mix languages.',
      })),
    );
  }
  for (const group of moved) {
    await transaction
      .updateTable('groups')
      .set({ language: group.to })
      .where('id', '=', group.id)
      .execute();
  }
  return { moved, mixed };
}

/**
 * A subject's change (decision 16): a grade leaves it, or it is archived,
 * while an active group needs it. The groups of the branch of the request are
 * named (`group.<id>`); those of other branches are counted
 * (`subject_groups_elsewhere`, 0047: a count only, decision 12), as the
 * teachers of `refuseTeachersOutside` are. `grades` is `null` for an archive.
 */
export async function refuseGroupsOfSubject(
  transaction: Transaction,
  subjectId: string,
  grades: readonly number[] | null,
): Promise<void> {
  const own = await transaction
    .selectFrom('groups')
    .select(['groups.id', 'groups.name'])
    .where('groups.subject_id', '=', subjectId)
    .where('groups.archived_at', 'is', null)
    .$if(grades !== null, (query) =>
      query.where((builder) =>
        builder.exists(
          builder
            .selectFrom('group_classes')
            .innerJoin('classes', 'classes.id', 'group_classes.class_id')
            .select('group_classes.class_id')
            .whereRef('group_classes.group_id', '=', 'groups.id')
            .where(
              'classes.grade',
              'not in',
              grades === null || grades.length === 0 ? [0] : grades,
            ),
        ),
      ),
    )
    .orderBy('groups.name_key')
    .orderBy('groups.id')
    .execute();
  const elsewhere = await sql<{ count: number }>`
    select subject_groups_elsewhere(
      ${subjectId}::uuid, ${grades ?? []}::smallint[], ${grades === null}
    ) as count
  `.execute(transaction);
  const count = elsewhere.rows[0]?.count ?? 0;
  if (own.length === 0 && count === 0) {
    return;
  }
  const details: ErrorDetail[] = own.map((group) => ({
    path: `group.${group.id}`,
    code: 'needs',
    message: 'An active group of this branch needs the subject.',
  }));
  if (count > 0) {
    details.push({
      path: 'elsewhere',
      code: String(count),
      message: 'The number of groups of other branches that need it.',
    });
  }
  throw new ApiException(
    grades === null ? 'subject_has_groups' : 'subject_grade_groups',
    409,
    undefined,
    details,
  );
}
