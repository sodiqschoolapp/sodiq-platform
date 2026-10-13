import { Injectable } from '@nestjs/common';
import {
  relativeNameKey,
  type ErrorDetail,
  type RelativeHolder,
  type RelativeLinkInput,
  type RelativeRecord,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { notFound } from '../setup/setup-refusals.js';

const UNIQUE_VIOLATION = '23505';

/**
 * A main phone refused by `relatives_phone_idx` (db/migrations/0036). The
 * write aborted its transaction, so the holder is looked up after it, in a
 * new one (as `refusingTaken` of the students service).
 */
export class PhoneHeld extends Error {
  constructor(
    readonly phone: string,
    readonly path: string,
    readonly code: 'relative_phone_taken' | 'relative_phone_exists',
  ) {
    super('The main phone belongs to another relative.');
  }
}

/** Runs a write of a main phone; the unique index of the phone becomes `PhoneHeld`. */
export async function writingPhone<T>(
  phone: string | null,
  path: string,
  code: PhoneHeld['code'],
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    if (
      phone !== null &&
      failure.code === UNIQUE_VIOLATION &&
      failure.constraint === 'relatives_phone_idx'
    ) {
      throw new PhoneHeld(phone, path, code);
    }
    throw error;
  }
}

/** A stored relative as the routes read it. */
export interface RelativeRow {
  id: string;
  full_name: string;
  phone: string | null;
  workplace: string | null;
  email: string | null;
}

/** The live link of a student as the routes read it. */
export interface LinkRow {
  id: string;
  relative_id: string;
  relationship: string;
  main_contact: boolean;
  portal_access: boolean;
  receives_notices: boolean;
}

/** The record fields of a relative as the audit entries compare them. */
export const recordOf = (row: RelativeRow): RelativeRecord => ({
  fullName: row.full_name,
  phone: row.phone,
  workplace: row.workplace,
  email: row.email,
});

/** The fields of a link as the audit entries hold them. */
export const linkValueOf = (studentId: string, link: LinkRow) => ({
  studentId,
  relationship: link.relationship,
  mainContact: link.main_contact,
  portalAccess: link.portal_access,
  receivesNotices: link.receives_notices,
});

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A relative route works for the branch of the request.');
  }
  return access.branchId;
}

/**
 * The writes of relatives and their links that the student create and the
 * Relatives routes share (task 2.5a, pull request #72). The record entries go
 * to the school-wide log with the branch of the request in `details`, the link
 * entries to the branch's log (correction 1). Lock order: the student, then
 * each relative in the order of its id (`relatives_follow_links` locks the
 * relative of each link it follows).
 */
@Injectable()
export class RelativeWrites {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  /**
   * The holder of an exact main phone, archived ones included (decision 3,
   * Look first): `relative_by_phone` of 0036.
   */
  async holderOf(transaction: Transaction, phone: string): Promise<RelativeHolder | null> {
    const found = await sql<{ id: string; full_name: string; students: string }>`
      select id, full_name, students from relative_by_phone(${phone})
    `.execute(transaction);
    const row = found.rows[0];
    return row === undefined
      ? null
      : { id: row.id, fullName: row.full_name, students: Number(row.students) };
  }

  /** The number of students of other branches linked live to a relative of the branch. */
  async elsewhere(transaction: Transaction, relativeId: string): Promise<number> {
    const found = await sql<{ count: string | null }>`
      select relative_links_elsewhere(${relativeId}::uuid) as count
    `.execute(transaction);
    return Number(found.rows[0]?.count ?? 0);
  }

  /**
   * Turns a phone held by another relative into 409 with the holder named as
   * the phone match names it (decision 3); for a refused phone change the id
   * only when the holder is visible in the branch (correction 7 of the plan
   * review).
   */
  async refusingHeldPhone<T>(access: Access, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof PhoneHeld)) {
        throw error;
      }
      const branchId = branchOf(access);
      const detail = await this.transactions.run(access.branchIds, async (transaction) => {
        const holder = await this.holderOf(transaction, error.phone);
        if (holder === null) {
          return null;
        }
        const visible =
          error.code === 'relative_phone_exists' ||
          (await transaction
            .selectFrom('student_relatives')
            .select('id')
            .where('relative_id', '=', holder.id ?? '')
            .where('branch_id', '=', branchId)
            .where('unlinked_at', 'is', null)
            .executeTakeFirst()) !== undefined;
        const found: ErrorDetail = {
          path: error.path,
          code: 'already_exists',
          message: 'Another relative has this main phone.',
          holder: { fullName: holder.fullName, students: holder.students },
          ...(visible && holder.id !== null ? { recordId: holder.id } : {}),
        };
        return found;
      });
      // The holder changed its phone meanwhile: no claim about who holds it.
      throw new ApiException(error.code, 409, undefined, detail === null ? undefined : [detail]);
    }
  }

  /**
   * A new relative with its switched-off Parent account (`edge`: "Every
   * relative linked to a student has a Parent account"), and its school-wide
   * audit entry. The link that makes it visible follows in the same
   * transaction (correction 2 refuses a commit without one).
   */
  async createRelative(
    transaction: Transaction,
    access: Access,
    record: RelativeRecord,
    path: string,
    requestId: string,
  ): Promise<string> {
    const moment = await transactionMoment(transaction);
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    const id = found.rows[0]?.id;
    if (id === undefined) {
      throw new Error('No id for the new relative.');
    }
    await writingPhone(record.phone, path, 'relative_phone_exists', () =>
      transaction
        .insertInto('relatives')
        .values({
          id,
          full_name: record.fullName,
          name_key: relativeNameKey(record.fullName),
          phone: record.phone,
          workplace: record.workplace,
          email: record.email,
        })
        .execute(),
    );
    await transaction
      .insertInto('relative_accounts')
      .values({ relative_id: id, created_at: moment })
      .execute();
    await this.audit.record(transaction, {
      branchId: null,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'relative.create',
      record: { type: 'relative', id },
      newValue: record,
      details: { branchId: branchOf(access) },
      requestId,
    });
    return id;
  }

  /**
   * Links one relative, new or found by phone, to a student of the branch whose
   * row the caller locked. The main contact moves to a new main link in the
   * same change (decision 12): the old mark is cleared first, as the index of
   * one main contact wants. An archived relative found by phone comes back
   * (decision 14).
   */
  async link(
    transaction: Transaction,
    access: Access,
    studentId: string,
    input: RelativeLinkInput,
    path: string,
    requestId: string,
  ): Promise<string> {
    const branchId = branchOf(access);
    let relativeId: string;
    let created = false;
    if (input.kind === 'new') {
      relativeId = await this.createRelative(
        transaction,
        access,
        input.relative,
        `${path}.relative.phone`,
        requestId,
      );
      created = true;
    } else {
      const holder = await this.holderOf(transaction, input.phone);
      if (holder?.id !== input.relativeId) {
        throw new ApiException('relative_phone_changed', 409, undefined, [
          {
            path: `${path}.phone`,
            code: 'relative_phone_changed',
            message: 'The relative chosen no longer has this phone.',
          },
        ]);
      }
      relativeId = input.relativeId;
      const linked = await transaction
        .selectFrom('student_relatives')
        .select('id')
        .where('student_id', '=', studentId)
        .where('relative_id', '=', relativeId)
        .where('unlinked_at', 'is', null)
        .executeTakeFirst();
      if (linked !== undefined) {
        throw new ApiException('already_exists', 409, undefined, [
          { path, code: 'already_exists', message: 'The relative is linked to the student.' },
        ]);
      }
    }
    if (input.mainContact) {
      await transaction
        .updateTable('student_relatives')
        .set({ main_contact: false })
        .where('student_id', '=', studentId)
        .where('main_contact', '=', true)
        .where('unlinked_at', 'is', null)
        .execute();
    }
    const moment = await transactionMoment(transaction);
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    const linkId = found.rows[0]?.id;
    if (linkId === undefined) {
      throw new Error('No id for the new link.');
    }
    const link: LinkRow = {
      id: linkId,
      relative_id: relativeId,
      relationship: input.relationship,
      main_contact: input.mainContact,
      portal_access: input.portalAccess,
      receives_notices: input.receivesNotices,
    };
    // `relatives_follow_links` locks the relative and restores an archived one.
    await transaction
      .insertInto('student_relatives')
      .values({ ...link, student_id: studentId, branch_id: branchId, linked_at: moment })
      .execute();
    if (!created && (await this.liveLinks(transaction, relativeId)) === 1) {
      // Under the relative's lock: this link is its only live one, so it was archived.
      await this.audit.record(transaction, {
        branchId: null,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'relative.restore',
        record: { type: 'relative', id: relativeId },
        details: { branchId },
        requestId,
      });
    }
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'relative.link',
      record: { type: 'relative', id: relativeId },
      newValue: linkValueOf(studentId, link),
      requestId,
    });
    return relativeId;
  }

  /**
   * The live links of a relative in every branch: those of the branch, which
   * the transaction sees, and the count of the others.
   */
  async liveLinks(transaction: Transaction, relativeId: string): Promise<number> {
    const here = await transaction
      .selectFrom('student_relatives')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('relative_id', '=', relativeId)
      .where('unlinked_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(here.count) + (await this.elsewhere(transaction, relativeId));
  }

  /** The live links of a student of the branch, the main contact first. */
  async linksOf(transaction: Transaction, studentId: string): Promise<LinkRow[]> {
    return transaction
      .selectFrom('student_relatives')
      .select([
        'id',
        'relative_id',
        'relationship',
        'main_contact',
        'portal_access',
        'receives_notices',
      ])
      .where('student_id', '=', studentId)
      .where('unlinked_at', 'is', null)
      .orderBy('main_contact', 'desc')
      .orderBy('linked_at')
      .orderBy('id')
      .execute();
  }

  /** A relative linked live in the branch of the request, locked for a change; 404 otherwise. */
  async lockRelative(
    transaction: Transaction,
    branchId: string,
    relativeId: string,
  ): Promise<RelativeRow> {
    const linked = await transaction
      .selectFrom('student_relatives')
      .select('id')
      .where('relative_id', '=', relativeId)
      .where('branch_id', '=', branchId)
      .where('unlinked_at', 'is', null)
      .executeTakeFirst();
    if (linked === undefined) {
      throw notFound();
    }
    const row = await transaction
      .selectFrom('relatives')
      .select(['id', 'full_name', 'phone', 'workplace', 'email'])
      .where('id', '=', relativeId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }
}
