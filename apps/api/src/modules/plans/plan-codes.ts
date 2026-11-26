import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';

/**
 * Codes for topics and works (task 11.27; `09`, Codes). The two rules every reader and writer of
 * a code follows; `plan-codes-readers.test.ts` pins the files that name the code columns.
 *
 * - Read: "Switching codes off for a subject hides every code of that subject everywhere, exports
 *   and the API included, and keeps them": a code is answered only while its subject's codes are
 *   on, `null` otherwise, the same `null` as "no code" (plan decision 4).
 * - Write: "While a subject's codes are off, no code can be set in it": a code a person, the
 *   assistant or a key sends that differs from the code it was read as is refused
 *   `plan_codes_off`; one left out, or equal to its base, leaves the stored code as it is, so a
 *   hidden code is kept. The system's own copies carry the stored codes whatever the switch
 *   (plan decision 2).
 */

/** The code a reader sees: the stored code while the subject's codes are on, else `null`. */
export const shownCode = (codesOn: boolean, code: string | null): string | null =>
  codesOn ? code : null;

/** An id no row has, for an `any` over an empty list. */
const NO_ID = '00000000-0000-0000-0000-000000000000';

/** The codes switch of each subject named (`false` for an unknown one). */
export async function codesOnOfSubjects(
  transaction: Transaction,
  subjectIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (subjectIds.length === 0) return new Set();
  const rows = await transaction
    .selectFrom('subjects')
    .select('id')
    .where('id', 'in', [...new Set(subjectIds)])
    .where('codes_on', '=', true)
    .execute();
  return new Set(rows.map((row) => row.id));
}

/** The codes switch of the subject of each plan named, by plan. */
export async function codesOnOfPlans(
  transaction: Transaction,
  planIds: readonly string[],
): Promise<ReadonlyMap<string, boolean>> {
  if (planIds.length === 0) return new Map();
  const { rows } = await sql<{ id: string; codes_on: boolean }>`
    select p.id, s.codes_on
    from lesson_plans p
    join subjects s on s.id = p.subject_id
    where p.id = any(${[...new Set(planIds), NO_ID]}::uuid[])
  `.execute(transaction);
  return new Map(rows.map((row) => [row.id, row.codes_on]));
}

/** The codes switch of the subject of an item's plan. */
export async function codesOnOfItem(transaction: Transaction, itemId: string): Promise<boolean> {
  const { rows } = await sql<{ codes_on: boolean }>`
    select s.codes_on
    from lesson_plan_items i
    join lesson_plans p on p.id = i.plan_id
    join subjects s on s.id = p.subject_id
    where i.id = ${itemId}
  `.execute(transaction);
  return rows[0]?.codes_on ?? false;
}

/** The codes switch of a master's subject. */
export async function codesOnOfMaster(
  transaction: Transaction,
  masterId: string,
): Promise<boolean> {
  const { rows } = await sql<{ codes_on: boolean }>`
    select s.codes_on
    from lesson_plan_masters m
    join subjects s on s.id = m.subject_id
    where m.id = ${masterId}
  `.execute(transaction);
  return rows[0]?.codes_on ?? false;
}

/** The codes switch of a journal's subject. */
export async function codesOnOfJournal(
  transaction: Transaction,
  journalId: string,
): Promise<boolean> {
  const { rows } = await sql<{ codes_on: boolean }>`
    select s.codes_on
    from journals j
    join subjects s on s.id = j.subject_id
    where j.id = ${journalId}
  `.execute(transaction);
  return rows[0]?.codes_on ?? false;
}

/** The refusal of a code sent while the subject's codes are off; `path` names the field. */
export const codesOffRefusal = (path: string): ApiException =>
  new ApiException('plan_codes_off', 409, undefined, [
    {
      path,
      code: 'plan_codes_off',
      message: "The subject's codes for topics and works are off.",
    },
  ]);

/**
 * The write rule. `sent` is the code of the request (`undefined`: left out), `base` the code the
 * client read (`undefined`: it never read one; taken as the code shown now). Answers `undefined`
 * when the stored code stays as it is, else the code to write (`null` clears it); refuses a
 * change while the subject's codes are off.
 */
export function codeToWrite(input: {
  readonly sent: string | null | undefined;
  readonly base: string | null | undefined;
  readonly shown: string | null;
  readonly codesOn: boolean;
  readonly path: string;
}): { readonly value: string | null } | undefined {
  if (input.sent === undefined) return undefined;
  const base = input.base === undefined ? input.shown : input.base;
  if (input.sent === base) return undefined;
  if (!input.codesOn) throw codesOffRefusal(input.path);
  return { value: input.sent };
}

/**
 * A code sent with something new (a new item or work, a work added in the journal): written as
 * sent while on; refused while off, unless no code is sent.
 */
export function newCode(
  sent: string | null | undefined,
  codesOn: boolean,
  path: string,
): string | null {
  if (sent === undefined || sent === null) return null;
  if (!codesOn) throw codesOffRefusal(path);
  return sent;
}

/** The keys of an audit entry's values that hold a code (hidden on read while off). */
export const CODE_KEYS: ReadonlySet<string> = new Set(['topicCode', 'code']);
