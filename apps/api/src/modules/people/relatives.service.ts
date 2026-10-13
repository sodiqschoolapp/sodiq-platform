import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  type Action,
  relativeNameKey,
  spellingKey,
  type Relationship,
  type RelativeDetail,
  type RelativeIdentity,
  type RelativeLinkEdit,
  type RelativeLinkInput,
  type RelativeList,
  type RelativeListItem,
  type RelativeListQuery,
  type RelativePhoneMatchResult,
  type RelativeRecord,
  type RelativeStudent,
  type RelativeUnlink,
  type StudentRelatives,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { decide } from '../access/permission-check.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { changesOf, notFound } from '../setup/setup-refusals.js';
import { linkValueOf, RelativeWrites, recordOf, writingPhone } from './relative-writes.js';
import { Students } from './students.service.js';

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A relative route works for the branch of the request.');
  }
  return access.branchId;
}

/** The assignment that gives the account an action of an area in the branch of the request. */
const holderOf = (access: Access, area: string, action: Action): string | undefined =>
  decide({ area, action, branch: 'request' }, access.assignments, access.branchId, PERMISSIONS)?.id;

/** A current Principal assignment of the account in the branch of the request. */
const principalOf = (access: Access): string | undefined =>
  access.assignments.find(
    (assignment) => assignment.role === 'principal' && assignment.branchId === access.branchId,
  )?.id;

/**
 * Workplace and email are read as Identity (decision 5, Look first): the
 * Super Admin and the Academic Vice Principal; the Principal sees them hidden,
 * with a logged show.
 */
const readsIdentity = (access: Access): boolean =>
  holderOf(access, 'student_identity', 'view') !== undefined;

/**
 * Close relatives, the Parents (docs/spec/04-people.md, Close relatives;
 * edge/close-relatives; task 2.5a, pull request #72). A relative is opened in
 * a branch only while a student of that branch is linked live (decision 2);
 * every other id is 404. The links of a student are written under `students`
 * `edit`, with the student's row locked first. Every change writes its audit
 * entry in its transaction: the record entries school-wide, the link entries
 * in the branch (correction 1).
 */
@Injectable()
export class Relatives {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly writes: RelativeWrites,
    private readonly students: Students,
  ) {}

  /**
   * The Parents list of the branch (`04`: "a Relatives list with search by
   * name and phone"). Search by phone is for the Super Admin and the Academic
   * Vice Principal (`edge/people-roles-accounts`, Ctrl+K row); others are
   * refused it.
   */
  list(access: Access, query: RelativeListQuery = {}): Promise<RelativeList> {
    const branchId = branchOf(access);
    const searchesPhone = holderOf(access, 'relatives', 'create') !== undefined;
    if (query.phone !== undefined && !searchesPhone) {
      throw new ApiException('permission_denied', 403);
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      let found = transaction
        .selectFrom('relatives')
        .select(['relatives.id', 'relatives.full_name', 'relatives.phone'])
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('student_relatives as l')
              .select('l.id')
              .whereRef('l.relative_id', '=', 'relatives.id')
              .where('l.branch_id', '=', branchId)
              .where('l.unlinked_at', 'is', null),
          ),
        );
      const search = spellingKey(query.search ?? '');
      if (search !== '') {
        found = found.where(sql<boolean>`strpos(relatives.name_key, ${search}) > 0`);
      }
      if (query.phone !== undefined && query.phone !== '') {
        found = found.where(sql<boolean>`strpos(relatives.phone, ${query.phone}) > 0`);
      }
      const rows = await found.orderBy('relatives.name_key').orderBy('relatives.id').execute();
      const students = await this.studentsOf(
        transaction,
        branchId,
        rows.map((row) => row.id),
      );
      const relatives: RelativeListItem[] = [];
      for (const row of rows) {
        relatives.push({
          id: row.id,
          fullName: row.full_name,
          phone: row.phone,
          students: students.get(row.id) ?? [],
          elsewhere: await this.writes.elsewhere(transaction, row.id),
        });
      }
      return {
        relatives,
        searchesPhone,
        canEdit: holderOf(access, 'relatives', 'edit') !== undefined,
      };
    });
  }

  /** A relative's page (`04`: "Shows the relative's data and all linked students"). */
  detail(access: Access, id: string): Promise<RelativeDetail> {
    return this.transactions.run(access.branchIds, (transaction) =>
      this.readDetail(transaction, access, id),
    );
  }

  /**
   * The phone typed first (`04`, Adding a relative): the holder of that exact
   * phone in any branch, archived ones included, with the name and a count
   * only (decision 3, Look first).
   */
  phoneMatch(access: Access, phone: string): Promise<RelativePhoneMatchResult> {
    return this.transactions.run(access.branchIds, async (transaction) => ({
      holder: await this.writes.holderOf(transaction, phone),
    }));
  }

  /**
   * The record of a relative, for every linked student (`04`: "Editing the
   * phone or name here changes it for every linked student"). A phone held by
   * another relative is refused with that relative shown (`04`, Changing a
   * phone).
   */
  edit(
    access: Access,
    id: string,
    record: RelativeRecord,
    requestId: string,
  ): Promise<RelativeDetail> {
    const branchId = branchOf(access);
    return this.writes.refusingHeldPhone(access, () =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await this.writes.lockRelative(transaction, branchId, id);
        const changes = changesOf({ ...recordOf(row) }, { ...record });
        if (changes === null) {
          return this.readDetail(transaction, access, id);
        }
        await writingPhone(record.phone, 'phone', 'relative_phone_taken', () =>
          transaction
            .updateTable('relatives')
            .set({
              full_name: record.fullName,
              name_key: relativeNameKey(record.fullName),
              phone: record.phone,
              workplace: record.workplace,
              email: record.email,
            })
            .where('id', '=', id)
            .execute(),
        );
        await this.audit.record(transaction, {
          branchId: null,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'relative.edit',
          record: { type: 'relative', id },
          oldValue: changes.oldValue,
          newValue: changes.newValue,
          details: { branchId },
          requestId,
        });
        return this.readDetail(transaction, access, id);
      }),
    );
  }

  /**
   * Workplace and email for the Principal, who sees them hidden (decision 5),
   * as the student's Identity show: every show is an audit entry.
   */
  show(access: Access, id: string, requestId: string): Promise<RelativeIdentity> {
    const branchId = branchOf(access);
    const principal = principalOf(access);
    if (readsIdentity(access) || principal === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.readRelative(transaction, branchId, id);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: principal,
        action: 'relative.show',
        record: { type: 'relative', id },
        requestId,
      });
      return { workplace: row.workplace, email: row.email };
    });
  }

  /**
   * The student's Relatives tab (`02`: "name, relationship and phones of a
   * relative"): the link switches for the `relatives` readers, workplace and
   * email for the Identity readers (decision 5).
   */
  ofStudent(access: Access, studentId: string): Promise<StudentRelatives> {
    return this.transactions.run(access.branchIds, (transaction) =>
      this.readStudentRelatives(transaction, access, studentId),
    );
  }

  /** Links a new relative or one found by phone to a student (`04`, Adding a relative). */
  link(
    access: Access,
    studentId: string,
    input: RelativeLinkInput,
    requestId: string,
  ): Promise<StudentRelatives> {
    return this.writes.refusingHeldPhone(access, () =>
      this.transactions.run(access.branchIds, async (transaction) => {
        await this.students.lockStudent(transaction, studentId);
        const links = await this.writes.linksOf(transaction, studentId);
        // A student's only relative is the main contact automatically (`edge`).
        const mainContact = input.mainContact || links.length === 0;
        await this.writes.link(
          transaction,
          access,
          studentId,
          { ...input, mainContact },
          'relative',
          requestId,
        );
        return this.readStudentRelatives(transaction, access, studentId);
      }),
    );
  }

  /**
   * Changes one link: relationship, the switches, and the main contact,
   * which moves to this link in one change (decision 12). Clearing the mark
   * of the main contact is refused: another link takes it.
   */
  editLink(
    access: Access,
    studentId: string,
    relativeId: string,
    input: RelativeLinkEdit,
    requestId: string,
  ): Promise<StudentRelatives> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.students.lockStudent(transaction, studentId);
      const links = await this.writes.linksOf(transaction, studentId);
      const link = links.find((one) => one.relative_id === relativeId);
      if (link === undefined) {
        throw notFound();
      }
      if (link.main_contact && !input.mainContact) {
        throw new ApiException('main_contact_needed', 422);
      }
      const before = linkValueOf(studentId, link);
      const after = linkValueOf(studentId, {
        ...link,
        relationship: input.relationship,
        main_contact: input.mainContact,
        portal_access: input.portalAccess,
        receives_notices: input.receivesNotices,
      });
      const changes = changesOf({ ...before }, { ...after });
      if (changes === null) {
        return this.readStudentRelatives(transaction, access, studentId);
      }
      if (input.mainContact && !link.main_contact) {
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: false })
          .where('student_id', '=', studentId)
          .where('main_contact', '=', true)
          .where('unlinked_at', 'is', null)
          .execute();
      }
      await transaction
        .updateTable('student_relatives')
        .set({
          relationship: input.relationship,
          main_contact: input.mainContact,
          portal_access: input.portalAccess,
          receives_notices: input.receivesNotices,
        })
        .where('id', '=', link.id)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'relative.link_edit',
        record: { type: 'relative', id: relativeId },
        oldValue: { ...changes.oldValue, studentId },
        newValue: { ...changes.newValue, studentId },
        requestId,
      });
      return this.readStudentRelatives(transaction, access, studentId);
    });
  }

  /**
   * Unlinks a relative from one student (`04`: "Unlinking a relative from one
   * student does not affect their other students"). The last relative stays
   * (`04`, Always connected); the main contact names the next one in the same
   * request (`edge`). A relative left with no live link anywhere is archived
   * by `relatives_follow_links`, and the entry says so.
   */
  unlink(
    access: Access,
    studentId: string,
    relativeId: string,
    input: RelativeUnlink,
    requestId: string,
  ): Promise<StudentRelatives> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.students.lockStudent(transaction, studentId);
      const links = await this.writes.linksOf(transaction, studentId);
      const link = links.find((one) => one.relative_id === relativeId);
      if (link === undefined) {
        throw notFound();
      }
      const next =
        input.newMainContactId === null
          ? undefined
          : links.find(
              (one) => one.relative_id === input.newMainContactId && one.relative_id !== relativeId,
            );
      if (input.newMainContactId !== null && next === undefined) {
        throw notFound();
      }
      if (links.length === 1) {
        throw new ApiException('last_relative', 409);
      }
      if (link.main_contact && next === undefined) {
        throw new ApiException('main_contact_needed', 422);
      }
      // The relative's row, then its live links in every branch, in statements
      // of their own (the order of `relatives_follow_links`).
      await this.writes.lockRelative(transaction, branchId, relativeId);
      const archives = (await this.writes.liveLinks(transaction, relativeId)) === 1;
      await transaction
        .updateTable('student_relatives')
        .set({ main_contact: false, unlinked_at: await transactionMoment(transaction) })
        .where('id', '=', link.id)
        .execute();
      if (link.main_contact && next !== undefined) {
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: true })
          .where('id', '=', next.id)
          .execute();
      }
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'relative.unlink',
        record: { type: 'relative', id: relativeId },
        oldValue: linkValueOf(studentId, link),
        newValue:
          link.main_contact && next !== undefined
            ? { studentId, newMainContactId: next.relative_id }
            : { studentId },
        requestId,
      });
      if (archives) {
        await this.audit.record(transaction, {
          branchId: null,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'relative.archive',
          record: { type: 'relative', id: relativeId },
          details: { branchId },
          requestId,
        });
      }
      return this.readStudentRelatives(transaction, access, studentId);
    });
  }

  // ---------------------------------------------------------------------------

  /** A relative linked live in the branch, or 404. */
  private async readRelative(transaction: Transaction, branchId: string, id: string) {
    const row = await transaction
      .selectFrom('relatives')
      .select(['id', 'full_name', 'phone', 'workplace', 'email'])
      .where('id', '=', id)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('student_relatives as l')
            .select('l.id')
            .whereRef('l.relative_id', '=', 'relatives.id')
            .where('l.branch_id', '=', branchId)
            .where('l.unlinked_at', 'is', null),
        ),
      )
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  private async readDetail(
    transaction: Transaction,
    access: Access,
    id: string,
  ): Promise<RelativeDetail> {
    const branchId = branchOf(access);
    const row = await this.readRelative(transaction, branchId, id);
    const students = await this.studentsOf(transaction, branchId, [id]);
    const identity = readsIdentity(access);
    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      students: students.get(id) ?? [],
      elsewhere: await this.writes.elsewhere(transaction, id),
      identity: identity ? { workplace: row.workplace, email: row.email } : null,
      identityHidden: !identity && principalOf(access) !== undefined,
      canEdit: holderOf(access, 'relatives', 'edit') !== undefined,
    };
  }

  /** The students of the branch linked live to each relative, by surname and first name. */
  private async studentsOf(
    transaction: Transaction,
    branchId: string,
    relativeIds: string[],
  ): Promise<Map<string, RelativeStudent[]>> {
    const result = new Map<string, RelativeStudent[]>();
    if (relativeIds.length === 0) {
      return result;
    }
    const rows = await transaction
      .selectFrom('student_relatives as l')
      .innerJoin('students as s', 's.id', 'l.student_id')
      .select([
        'l.relative_id',
        's.id',
        's.first_name',
        's.last_name',
        's.uid',
        'l.relationship',
        'l.main_contact',
      ])
      .where('l.relative_id', 'in', relativeIds)
      .where('l.branch_id', '=', branchId)
      .where('l.unlinked_at', 'is', null)
      .orderBy('s.last_name')
      .orderBy('s.first_name')
      .orderBy('s.uid')
      .execute();
    for (const row of rows) {
      const own = result.get(row.relative_id) ?? [];
      own.push({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        uid: row.uid,
        relationship: row.relationship as Relationship,
        mainContact: row.main_contact,
      });
      result.set(row.relative_id, own);
    }
    return result;
  }

  private async readStudentRelatives(
    transaction: Transaction,
    access: Access,
    studentId: string,
  ): Promise<StudentRelatives> {
    const branchId = branchOf(access);
    const student = await transaction
      .selectFrom('students')
      .select('id')
      .where('id', '=', studentId)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (student === undefined) {
      throw notFound();
    }
    const rows = await transaction
      .selectFrom('student_relatives as l')
      .innerJoin('relatives as r', 'r.id', 'l.relative_id')
      .select([
        'r.id',
        'r.full_name',
        'r.phone',
        'r.workplace',
        'r.email',
        'l.relationship',
        'l.main_contact',
        'l.portal_access',
        'l.receives_notices',
      ])
      .where('l.student_id', '=', studentId)
      .where('l.unlinked_at', 'is', null)
      .orderBy('l.main_contact', 'desc')
      .orderBy('l.linked_at')
      .orderBy('l.id')
      .execute();
    const switches = holderOf(access, 'relatives', 'view') !== undefined;
    const identity = readsIdentity(access);
    return {
      relatives: rows.map((row) => ({
        relativeId: row.id,
        fullName: row.full_name,
        phone: row.phone,
        relationship: row.relationship as Relationship,
        mainContact: row.main_contact,
        portalAccess: switches ? row.portal_access : null,
        receivesNotices: switches ? row.receives_notices : null,
        identity: identity ? { workplace: row.workplace, email: row.email } : null,
      })),
      canEdit: holderOf(access, 'students', 'edit') !== undefined,
    };
  }
}
