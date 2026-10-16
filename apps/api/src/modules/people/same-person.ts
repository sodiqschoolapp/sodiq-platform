import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import type { Audit } from '../audit/audit.service.js';

/**
 * The mark "same person" between a staff record and a relative, read from the
 * phones (`edge/close-relatives`, "A teacher is also a parent": "The mark
 * compares current phone numbers only"; issue #42, L81; task 3.6b-1, decision
 * 3, Look first). Nothing stores it: a write of a phone changes it, and its
 * audit entries say so (`markChanges`).
 */

/** Why a mark changed, as its entry names it. */
export type SamePersonCause =
  | 'relative_created'
  | 'relative_phone'
  | 'phone_released'
  | 'merge'
  | 'staff_created'
  | 'staff_phone';

/**
 * Takes `phone_owner_lock` of 0063 for each phone, in the order of the
 * phones, before a write of a relative's main phone or a staff phone: a
 * same-moment write of the other table waits, so the mark read before and
 * after each write is right for its entry.
 */
export async function lockPhones(
  transaction: Transaction,
  phones: readonly (string | null | undefined)[],
): Promise<void> {
  const sorted = [
    ...new Set(phones.filter((phone): phone is string => typeof phone === 'string')),
  ].sort();
  for (const phone of sorted) {
    await sql`select phone_owner_lock(${phone})`.execute(transaction);
  }
}

/** The staff record each relative is the same person as, in any branch. */
export async function staffOfRelatives(
  transaction: Transaction,
  relativeIds: readonly string[],
): Promise<Map<string, string>> {
  if (relativeIds.length === 0) {
    return new Map();
  }
  const found = await sql<{ relative_id: string; staff_id: string }>`
    select relative_id, staff_id from same_person_staff(${[...relativeIds]}::uuid[])
  `.execute(transaction);
  return new Map(found.rows.map((row) => [row.relative_id, row.staff_id]));
}

/** The relative each staff record is the same person as, in any branch. */
export async function relativesOfStaff(
  transaction: Transaction,
  staffIds: readonly string[],
): Promise<Map<string, string>> {
  if (staffIds.length === 0) {
    return new Map();
  }
  const found = await sql<{ staff_id: string; relative_id: string }>`
    select staff_id, relative_id from same_person_relative(${[...staffIds]}::uuid[])
  `.execute(transaction);
  return new Map(found.rows.map((row) => [row.staff_id, row.relative_id]));
}

/** The marks of some relatives and of some staff records, as relative id to staff id. */
export interface Marks {
  readonly byRelative: ReadonlyMap<string, string>;
}

/**
 * The marks that a write of the phones of these records can change: those of
 * the relatives named and those of the staff records named, by relative.
 */
export async function marksOf(
  transaction: Transaction,
  records: { relativeIds?: readonly string[]; staffIds?: readonly string[] },
): Promise<Marks> {
  const byRelative = new Map(await staffOfRelatives(transaction, records.relativeIds ?? []));
  for (const [staffId, relativeId] of await relativesOfStaff(transaction, records.staffIds ?? [])) {
    byRelative.set(relativeId, staffId);
  }
  return { byRelative };
}

/** One relative whose mark changed: the staff record before and after. */
export interface MarkChange {
  relativeId: string;
  before: string | null;
  after: string | null;
}

/**
 * The marks that differ between two reads around a write. A relative found on
 * one side only had no mark on the other: both phone indexes are unique, so a
 * phone the write gave a record held no mark before, and a phone it took away
 * holds none after.
 */
export function changesBetween(before: Marks, after: Marks): MarkChange[] {
  const ids = [...new Set([...before.byRelative.keys(), ...after.byRelative.keys()])].sort();
  const changes: MarkChange[] = [];
  for (const relativeId of ids) {
    const was = before.byRelative.get(relativeId) ?? null;
    const is = after.byRelative.get(relativeId) ?? null;
    if (was !== is) {
      changes.push({ relativeId, before: was, after: is });
    }
  }
  return changes;
}

/**
 * The school-wide entry of each changed mark, as the hand mark of 2.5b-2 wrote
 * it, so that the personal-data report keeps finding the mark's history
 * (`details.staffId`, the new mark or the one that went), with the cause.
 */
export async function recordMarkChanges(
  transaction: Transaction,
  audit: Audit,
  access: Access,
  changes: readonly MarkChange[],
  cause: SamePersonCause,
  requestId: string,
  assignmentId: string | undefined = access.assignmentId,
): Promise<void> {
  for (const change of changes) {
    await audit.record(transaction, {
      branchId: null,
      actorId: access.accountId,
      assignmentId,
      action: change.after === null ? 'relative.same_person_removed' : 'relative.same_person',
      record: { type: 'relative', id: change.relativeId },
      oldValue: { staffId: change.before },
      newValue: { staffId: change.after },
      details: { branchId: access.branchId, staffId: change.after ?? change.before, cause },
      requestId,
    });
  }
}

/**
 * The `samePerson` of the entry of a write on a relative: the staff record
 * before and after, or nothing when the mark did not change.
 */
export function relativeMarkDetail(
  changes: readonly MarkChange[],
  relativeId: string,
): { samePerson: { before: string | null; after: string | null } } | Record<string, never> {
  const change = changes.find((one) => one.relativeId === relativeId);
  return change === undefined ? {} : { samePerson: { before: change.before, after: change.after } };
}

/**
 * The `samePerson` of the entry of a write on a staff record: the relative
 * before and after, or nothing when the mark did not change.
 */
export function staffMarkDetail(
  changes: readonly MarkChange[],
  staffId: string,
): { samePerson: { before: string | null; after: string | null } } | Record<string, never> {
  const lost = changes.find((one) => one.before === staffId);
  const won = changes.find((one) => one.after === staffId);
  if (lost === undefined && won === undefined) {
    return {};
  }
  return {
    samePerson: { before: lost?.relativeId ?? null, after: won?.relativeId ?? null },
  };
}
