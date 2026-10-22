import { Inject, Injectable } from '@nestjs/common';
import {
  PERSONAL_DATA_ENTRY_LIMIT,
  STUDENT_MERGE_FIELDS,
  scholarshipSchema,
  relationshipSchema,
  roleSchema,
  type AuditAction,
  type Clock,
  type PersonalDataKind,
  type RelativeReport,
  type StaffReport,
  type StudentReport,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import { entryAnswers } from '../audit/audit-entries.service.js';
import { Audit } from '../audit/audit.service.js';
import { ApiException } from '../../http/api-exception.js';
import { notFound } from '../setup/setup-refusals.js';
import { departmentInForce, todayOf } from './department-moves.js';
import { studentJournal } from '../journal/student-cells.query.js';
import { readPersonEntries, type ReportPerson } from './personal-data.query.js';
import { branchOf, neverUsedAccounts } from './staff-account-records.js';
import { FIELD_COLUMNS, textOf } from './student-merges.js';
import { relativesOfStaff, staffOfRelatives } from './same-person.js';

/** An open end is stored as `infinity` (`staff_availability.valid_until`, 0025). */
const openEnd = (date: string): string | null => (date === 'infinity' ? null : date);

const iso = (moment: Date | null): string | null => (moment === null ? null : moment.toISOString());

/** The shared part of every report: the moment, the producer, the branch and the entries. */
interface ReportFrame {
  producedAt: string;
  producedBy: string | null;
  branch: { id: string; name: string; timeZone: string };
  entries: StudentReport['entries'];
  entriesLeftOut: StudentReport['entriesLeftOut'];
}

/**
 * The personal data report per person (task 2.6b, pull request #76;
 * edge-cases/people-roles-accounts, Personal data and the audit log: "The
 * Super Admin can produce a personal data report per person"). Each route
 * checks the person against the branch of the request first (decision 4),
 * then reads every field of the record and its history in a transaction that
 * holds every branch (decision 1: a staff member works in several, a relative
 * is linked in several), with the audit entries about the person (decision 7
 * as changed by correction 1), and writes one export entry in the same
 * transaction (decision 5). Only the Super Admin reaches the routes (decision
 * 3), so every group is answered plainly.
 */
@Injectable()
export class PersonalData {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The current Super Admin assignment, which the entry names, and every
   * branch: the report reads the person's rows of all of them (decision 1).
   * Decided from every current assignment (`.claude/rules/api.md`), so that a
   * later widening of the area never opens every branch to another role.
   */
  private async reach(access: Access): Promise<{ assignmentId: string; branches: string[] }> {
    const superAdmin = access.assignments.find((assignment) => assignment.role === 'super_admin');
    if (superAdmin === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    return { assignmentId: superAdmin.id, branches: await this.everyBranch() };
  }

  private async everyBranch(): Promise<string[]> {
    return this.transactions.run([], async (transaction) =>
      (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
        (row) => row.id,
      ),
    );
  }

  async student(access: Access, id: string, requestId: string): Promise<StudentReport> {
    const branchId = branchOf(access);
    const { assignmentId, branches } = await this.reach(access);
    return this.transactions.run(branches, async (transaction) => {
      // The row filter holds every branch here: the branch of the request is
      // checked in the query (`.claude/rules/api.md`, the 2.5b-1 rule), before
      // `personal_data_relatives` is called (decision 2).
      const student = await transaction
        .selectFrom('students')
        .selectAll()
        .where('id', '=', id)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (student === undefined) {
        throw notFound();
      }
      const uids = await transaction
        .selectFrom('student_uids')
        .select(['uid', 'held_from', 'released_at'])
        .where('student_id', '=', id)
        .orderBy('held_from')
        .execute();
      const contracts = await transaction
        .selectFrom('student_contracts')
        .select(['number', 'signed_on'])
        .where('student_id', '=', id)
        .orderBy('signed_on', 'desc')
        .orderBy('created_at', 'desc')
        .execute();
      const statuses = await transaction
        .selectFrom('student_statuses')
        .select(['status', 'valid_from', 'valid_until', 'cause', 'reason'])
        .where('student_id', '=', id)
        .orderBy('valid_from')
        .orderBy('created_at')
        .execute();
      // The records merged into this one, archived on each merge (task 3.3d).
      const merges = await transaction
        .selectFrom('student_merges')
        .select(['merged_uids', 'merged_at', 'reason', 'merged_record'])
        .where('kept_id', '=', id)
        .orderBy('merged_at')
        .orderBy('id')
        .execute();
      const account = await transaction
        .selectFrom('student_accounts')
        .select(['created_at', 'switched_on_at'])
        .where('student_id', '=', id)
        .executeTakeFirst();
      const links = await transaction
        .selectFrom('student_relatives')
        .select([
          'relative_id',
          'relationship',
          'main_contact',
          'portal_access',
          'receives_notices',
          'linked_at',
          'unlinked_at',
        ])
        .where('student_id', '=', id)
        .orderBy('linked_at')
        .orderBy('id')
        .execute();
      const relatives = await sql<{
        id: string;
        full_name: string;
        phone: string | null;
        extra_phones: string[];
        workplace: string | null;
        email: string | null;
        phone_invalid_since: Date | null;
        archived_at: Date | null;
        merged_into: string | null;
        account_created_at: Date | null;
        account_switched_on_at: Date | null;
      }>`select * from personal_data_relatives(${id}::uuid)`.execute(transaction);
      const journal = await studentJournal(transaction, id);
      const frame = await this.frame(
        transaction,
        access,
        assignmentId,
        branches,
        { kind: 'student', id, accountId: null, assignmentIds: [] },
        requestId,
        // Task 6.1c: the counts of the cells and lines, not their values.
        {
          cells: journal.cells.length,
          cellLines: journal.history.length,
          cellLinesLeftOut: journal.historyLeftOut?.count ?? 0,
        },
      );
      // A relative with no live link left is hidden from `entryAnswers`'s
      // name lookup; its name comes from `personal_data_relatives` (decision 2).
      const relativeNames = new Map(relatives.rows.map((row) => [row.id, row.full_name]));
      const entries = frame.entries.map((entry) =>
        entry.record?.type === 'relative' && entry.record.name === null
          ? {
              ...entry,
              record: { ...entry.record, name: relativeNames.get(entry.record.id) ?? null },
            }
          : entry,
      );
      return {
        kind: 'student',
        ...frame,
        entries,
        journal,
        student: {
          id: student.id,
          uid: student.uid,
          uids: uids.map((row) => ({
            uid: row.uid,
            heldFrom: row.held_from.toISOString(),
            releasedAt: iso(row.released_at),
          })),
          firstName: student.first_name,
          lastName: student.last_name,
          paternalName: student.paternal_name,
          sex: student.sex as StudentReport['student']['sex'],
          grade: student.grade,
          startsOn: student.starts_on,
          photoId: student.photo_id,
          phone: student.phone,
          email: student.email,
          birthDate: student.birth_date,
          documentType: student.document_type as StudentReport['student']['documentType'],
          documentNumber: student.document_number,
          jshshir: student.jshshir,
          address: student.address,
          region: student.region as StudentReport['student']['region'],
          previousSchool: student.previous_school,
          diagnosticScore: student.diagnostic_score,
          consentSignedOn: student.consent_signed_on,
          scholarship: scholarshipSchema.parse({
            type: student.scholarship_type,
            coverage: student.scholarship_coverage,
            amount: student.scholarship_amount,
          }),
          contracts: contracts.map((row) => ({ number: row.number, signedOn: row.signed_on })),
          merged: merges.map((row) => {
            const record = row.merged_record as Record<string, unknown>;
            return {
              uids: row.merged_uids,
              mergedAt: row.merged_at.toISOString(),
              reason: row.reason,
              values: STUDENT_MERGE_FIELDS.flatMap((field) => {
                const value = textOf(record, FIELD_COLUMNS[field]);
                return value === null ? [] : [{ field, value }];
              }),
            };
          }),
          statuses: statuses.map((row) => ({
            status: row.status as StudentReport['student']['statuses'][number]['status'],
            from: row.valid_from,
            until: row.valid_until,
            cause: row.cause as StudentReport['student']['statuses'][number]['cause'],
            reason: row.reason,
          })),
          account:
            account === undefined
              ? null
              : {
                  createdAt: account.created_at.toISOString(),
                  switchedOn: account.switched_on_at !== null,
                },
        },
        relatives: relatives.rows.map((relative) => ({
          id: relative.id,
          fullName: relative.full_name,
          phone: relative.phone,
          extraPhones: relative.extra_phones,
          workplace: relative.workplace,
          email: relative.email,
          phoneInvalidSince: iso(relative.phone_invalid_since),
          archivedAt: iso(relative.archived_at),
          merged: relative.merged_into !== null,
          account:
            relative.account_created_at === null
              ? null
              : {
                  createdAt: relative.account_created_at.toISOString(),
                  switchedOn: relative.account_switched_on_at !== null,
                },
          links: links
            .filter((link) => link.relative_id === relative.id)
            .map((link) => ({
              relationship: relationshipSchema.parse(link.relationship),
              mainContact: link.main_contact,
              portalAccess: link.portal_access,
              receivesNotices: link.receives_notices,
              linkedAt: link.linked_at.toISOString(),
              unlinkedAt: iso(link.unlinked_at),
            })),
        })),
      };
    });
  }

  async staff(access: Access, id: string, requestId: string): Promise<StaffReport> {
    const branchId = branchOf(access);
    const { assignmentId, branches } = await this.reach(access);
    return this.transactions.run(branches, async (transaction) => {
      // A person linked to the branch of the request; a vacancy and another
      // branch's record are 404 (`findPerson`, decision 4).
      const linked = await transaction
        .selectFrom('staff_branches')
        .select('staff_id')
        .where('staff_id', '=', id)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      const person = await transaction
        .selectFrom('staff')
        .selectAll()
        .where('id', '=', id)
        .where('kind', '=', 'person')
        .executeTakeFirst();
      if (linked === undefined || person === undefined || person.staff_id === null) {
        throw notFound();
      }
      const branchRows = await transaction
        .selectFrom('staff_branches as l')
        .innerJoin('branches as b', 'b.id', 'l.branch_id')
        .select(['b.name', 'l.is_main'])
        .where('l.staff_id', '=', id)
        .orderBy('l.is_main', 'desc')
        .orderBy('b.name')
        .execute();
      const divisionRows = await transaction
        .selectFrom('staff_divisions as d')
        .innerJoin('divisions as v', 'v.id', 'd.division_id')
        .select([
          'v.name_uz as division_uz',
          'v.name_ru as division_ru',
          'v.name_en as division_en',
          'd.department_id',
          'd.department_since',
          'd.department_before',
          'd.department_before_since',
          'd.is_main',
        ])
        .where('d.staff_id', '=', id)
        .orderBy('d.is_main', 'desc')
        .orderBy('v.name_en')
        .execute();
      // The department in force today in the branch time of the request, as
      // the record shows it (task 3.6b-3, L195).
      const today = await todayOf(transaction, branchId);
      const shownIds = divisionRows.flatMap((row) => {
        const shown = departmentInForce(row, today).departmentId;
        return shown === null ? [] : [shown];
      });
      const departmentNames =
        shownIds.length === 0
          ? []
          : await transaction
              .selectFrom('departments')
              .select(['id', 'name_uz', 'name_ru', 'name_en'])
              .where('id', 'in', shownIds)
              .execute();
      const divisions = divisionRows.map((row) => {
        const shown = departmentInForce(row, today).departmentId;
        const department = departmentNames.find((one) => one.id === shown);
        return {
          ...row,
          department_uz: department?.name_uz ?? null,
          department_ru: department?.name_ru ?? null,
          department_en: department?.name_en ?? null,
        };
      });
      const subjects = await transaction
        .selectFrom('staff_subjects as s')
        .innerJoin('subjects as j', 'j.id', 's.subject_id')
        .select(['j.name_uz', 'j.name_ru', 'j.name_en', 's.grades'])
        .where('s.staff_id', '=', id)
        .orderBy('j.name_en')
        .execute();
      const languages = await transaction
        .selectFrom('staff_languages')
        .select('language')
        .where('staff_id', '=', id)
        .orderBy('language')
        .execute();
      const statuses = await transaction
        .selectFrom('staff_statuses')
        .select(['status', 'valid_from', 'valid_until'])
        .where('staff_id', '=', id)
        .orderBy('valid_from')
        .orderBy('created_at')
        .execute();
      // Task 5.7a-1 (spec review should-fix 6): the absences held about the
      // person, withdrawn ones too.
      const absences = await transaction
        .selectFrom('absences')
        .select(['starts_on', 'ends_on', 'reason', 'withdrawn_at'])
        .where('staff_id', '=', id)
        .orderBy('starts_on')
        .orderBy('id')
        .execute();
      const availability = await transaction
        .selectFrom('staff_availability as a')
        .innerJoin('branches as b', 'b.id', 'a.branch_id')
        .select(['a.id', 'b.name', 'a.valid_from', 'a.valid_until'])
        .where('a.staff_id', '=', id)
        .orderBy('b.name')
        .orderBy('a.valid_from')
        .execute();
      const ranges = await transaction
        .selectFrom('staff_availability_ranges')
        .select(['entry_id', 'weekday', 'start_minutes', 'end_minutes'])
        .where('staff_id', '=', id)
        .orderBy('weekday')
        .orderBy('start_minutes')
        .execute();
      // The mark is read from the phones (task 3.6b-1, decision 3); the
      // relative is named when the transaction sees it, as before.
      const sameAsId = (await relativesOfStaff(transaction, [id])).get(id);
      const sameAs =
        sameAsId === undefined
          ? undefined
          : await transaction
              .selectFrom('relatives')
              .select(['id', 'full_name'])
              .where('id', '=', sameAsId)
              .executeTakeFirst();
      const account =
        person.account_id === null
          ? undefined
          : await transaction
              .selectFrom('accounts')
              .select([
                'login',
                'created_at',
                'language',
                'locked_at',
                'lock_reason',
                'must_change_password',
                'password_changed_at',
                'password_reset_at',
              ])
              .where('id', '=', person.account_id)
              .executeTakeFirst();
      // `assignments` has no row filter; these are the person's own, every
      // branch (decision 1: the Super Admin reads all).
      const roles =
        person.account_id === null
          ? []
          : await transaction
              .selectFrom('assignments as a')
              .leftJoin('branches as b', 'b.id', 'a.branch_id')
              .select(['a.id', 'a.role', 'b.name as branch', 'a.valid_from', 'a.valid_until'])
              .where('a.account_id', '=', person.account_id)
              .orderBy('a.valid_from')
              .orderBy('a.id')
              .execute();
      const roleSubjects =
        roles.length === 0
          ? []
          : await transaction
              .selectFrom('assignment_subjects as s')
              .innerJoin('subjects as j', 'j.id', 's.subject_id')
              .select([
                's.assignment_id',
                'j.name_uz',
                'j.name_ru',
                'j.name_en',
                's.valid_from',
                's.valid_until',
              ])
              .where(
                's.assignment_id',
                'in',
                roles.map((role) => role.id),
              )
              .orderBy('s.valid_from')
              .orderBy('j.name_en')
              .execute();
      // The latest sign-in, and "never used" as the account section and the
      // report of accounts never used say it (task 2.3c-1).
      const lastSession =
        person.account_id === null
          ? undefined
          : await transaction
              .selectFrom('sessions')
              .select((eb) => eb.fn.max('created_at').as('at'))
              .where('account_id', '=', person.account_id)
              .executeTakeFirst();
      const neverUsed =
        person.account_id !== null &&
        (await neverUsedAccounts(transaction, [{ staffId: id, accountId: person.account_id }])).has(
          person.account_id,
        );
      const secondStep =
        person.account_id === null
          ? undefined
          : await transaction
              .selectFrom('account_second_steps')
              .select('confirmed_at')
              .where('account_id', '=', person.account_id)
              .executeTakeFirst();
      const frame = await this.frame(
        transaction,
        access,
        assignmentId,
        branches,
        {
          kind: 'staff',
          id,
          accountId: person.account_id,
          assignmentIds: roles.map((role) => role.id),
        },
        requestId,
      );
      return {
        kind: 'staff',
        ...frame,
        staff: {
          id: person.id,
          staffId: person.staff_id,
          firstName: person.first_name ?? '',
          lastName: person.last_name ?? '',
          fatherName: person.father_name,
          sex: person.sex as StaffReport['staff']['sex'],
          birthDate: person.birth_date,
          jshshir: person.jshshir,
          educationLevel: person.education_level as StaffReport['staff']['educationLevel'],
          phone: person.phone,
          email: person.email,
          admissionDate: person.admission_date,
          contractType: person.contract_type as StaffReport['staff']['contractType'],
          contractDate: person.contract_date,
          weeklyLessons: person.weekly_lessons,
          dailyLessons: person.daily_lessons,
          photoId: person.photo_id,
          branches: branchRows.map((row) => ({ name: row.name, main: row.is_main })),
          divisions: divisions.map((row) => ({
            division: { uz: row.division_uz, ru: row.division_ru, en: row.division_en },
            department:
              row.department_uz === null || row.department_ru === null || row.department_en === null
                ? null
                : { uz: row.department_uz, ru: row.department_ru, en: row.department_en },
            main: row.is_main,
          })),
          subjects: subjects.map((row) => ({
            subject: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
            grades: row.grades,
          })),
          languages: languages.map(
            (row) => row.language as StaffReport['staff']['languages'][number],
          ),
          statuses: statuses.map((row) => ({
            status: row.status as StaffReport['staff']['statuses'][number]['status'],
            from: row.valid_from,
            until: row.valid_until,
          })),
          availability: availability.map((entry) => ({
            branch: entry.name,
            from: entry.valid_from,
            until: openEnd(entry.valid_until),
            ranges: ranges
              .filter((range) => range.entry_id === entry.id)
              .map((range) => ({
                weekday: range.weekday,
                startMinutes: range.start_minutes,
                endMinutes: range.end_minutes,
              })),
          })),
          absences: absences.map((row) => ({
            from: row.starts_on,
            until: row.ends_on,
            reason: row.reason,
            withdrawn: row.withdrawn_at !== null,
          })),
        },
        sameAsRelative: sameAs === undefined ? null : { id: sameAs.id, fullName: sameAs.full_name },
        account:
          account === undefined
            ? null
            : {
                login: account.login,
                createdAt: account.created_at.toISOString(),
                lastSignInAt:
                  lastSession?.at === null || lastSession?.at === undefined
                    ? null
                    : new Date(lastSession.at).toISOString(),
                neverUsed,
                language: account.language,
                lockedAt: iso(account.locked_at),
                lockReason: account.lock_reason,
                mustChangePassword: account.must_change_password,
                passwordChangedAt: iso(account.password_changed_at),
                passwordResetAt: iso(account.password_reset_at),
                secondStepOn: secondStep?.confirmed_at !== null && secondStep !== undefined,
                roles: roles.map((role) => ({
                  role: roleSchema.parse(role.role),
                  branch: role.branch,
                  from: role.valid_from.toISOString(),
                  until: iso(role.valid_until),
                  subjects: roleSubjects
                    .filter((subject) => subject.assignment_id === role.id)
                    .map((subject) => ({
                      subject: { uz: subject.name_uz, ru: subject.name_ru, en: subject.name_en },
                      from: subject.valid_from.toISOString(),
                      until: iso(subject.valid_until),
                    })),
                })),
              },
      };
    });
  }

  async relative(access: Access, id: string, requestId: string): Promise<RelativeReport> {
    const branchId = branchOf(access);
    const { assignmentId, branches } = await this.reach(access);
    return this.transactions.run(branches, async (transaction) => {
      // A relative live-linked to a student of the branch of the request, as
      // the record opens today (decision 4).
      const linked = await transaction
        .selectFrom('student_relatives')
        .select('id')
        .where('relative_id', '=', id)
        .where('branch_id', '=', branchId)
        .where('unlinked_at', 'is', null)
        .executeTakeFirst();
      const relative = await transaction
        .selectFrom('relatives')
        .select([
          'id',
          'full_name',
          'phone',
          'extra_phones',
          'workplace',
          'email',
          'phone_invalid_since',
          'archived_at',
        ])
        .where('id', '=', id)
        .executeTakeFirst();
      if (linked === undefined || relative === undefined) {
        throw notFound();
      }
      const account = await transaction
        .selectFrom('relative_accounts')
        .select(['created_at', 'switched_on_at'])
        .where('relative_id', '=', id)
        .executeTakeFirst();
      const samePersonId = (await staffOfRelatives(transaction, [id])).get(id);
      const samePerson =
        samePersonId === undefined
          ? undefined
          : await transaction
              .selectFrom('staff')
              .select(['id', 'first_name', 'last_name', 'staff_id'])
              .where('id', '=', samePersonId)
              .executeTakeFirst();
      const links = await transaction
        .selectFrom('student_relatives as l')
        .innerJoin('students as s', 's.id', 'l.student_id')
        .innerJoin('branches as b', 'b.id', 'l.branch_id')
        .select([
          's.id as student_id',
          's.uid',
          's.first_name',
          's.last_name',
          'b.name as branch',
          'l.relationship',
          'l.main_contact',
          'l.portal_access',
          'l.receives_notices',
          'l.linked_at',
          'l.unlinked_at',
        ])
        .where('l.relative_id', '=', id)
        .orderBy('l.linked_at')
        .orderBy('l.id')
        .execute();
      const frame = await this.frame(
        transaction,
        access,
        assignmentId,
        branches,
        { kind: 'relative', id, accountId: null, assignmentIds: [] },
        requestId,
      );
      return {
        kind: 'relative',
        ...frame,
        relative: {
          id: relative.id,
          fullName: relative.full_name,
          phone: relative.phone,
          extraPhones: relative.extra_phones,
          workplace: relative.workplace,
          email: relative.email,
          phoneInvalidSince: iso(relative.phone_invalid_since),
          archivedAt: iso(relative.archived_at),
          account:
            account === undefined
              ? null
              : {
                  createdAt: account.created_at.toISOString(),
                  switchedOn: account.switched_on_at !== null,
                },
        },
        samePerson:
          samePerson === undefined
            ? null
            : {
                id: samePerson.id,
                name: [samePerson.last_name, samePerson.first_name].filter(Boolean).join(' '),
                staffId: samePerson.staff_id,
              },
        links: links.map((link) => ({
          student: {
            id: link.student_id,
            uid: link.uid,
            firstName: link.first_name,
            lastName: link.last_name,
            branch: link.branch,
          },
          relationship: relationshipSchema.parse(link.relationship),
          mainContact: link.main_contact,
          portalAccess: link.portal_access,
          receivesNotices: link.receives_notices,
          linkedAt: link.linked_at.toISOString(),
          unlinkedAt: iso(link.unlinked_at),
        })),
      };
    });
  }

  /**
   * The moment, the producer, the branch and the entries about the person
   * (decisions 7 and 11), and the one export entry of the report (decision 5):
   * in the log of the branch of the request, with the person's record and
   * id, the parts and the counts; written after the reads, in the same
   * transaction.
   */
  private async frame(
    transaction: Transaction,
    access: Access,
    assignmentId: string,
    branches: readonly string[],
    person: ReportPerson,
    requestId: string,
    counts: Readonly<Record<string, number>> = {},
  ): Promise<ReportFrame> {
    const branchId = branchOf(access);
    const branch = await transaction
      .selectFrom('branches')
      .select(['id', 'name', 'time_zone'])
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const found = await readPersonEntries(transaction, person, PERSONAL_DATA_ENTRY_LIMIT);
    // In a relative's report, an entry whose record is another relative (a
    // phone given to someone else, a merge) is about this person through its
    // details only: its values and its name are the other person's and are
    // left out.
    const entries = (await entryAnswers(transaction, branches, found.rows, false)).map((entry) =>
      person.kind === 'relative' &&
      entry.record !== null &&
      entry.record.type === 'relative' &&
      entry.record.id !== person.id
        ? { ...entry, record: { ...entry.record, name: null }, oldValue: null, newValue: null }
        : entry,
    );
    const leftOut = found.total - found.rows.length;
    const producer = await sql<{ first_name: string | null; last_name: string | null }>`
      select first_name, last_name from audit_names(${[access.accountId]}::uuid[])
    `.execute(transaction);
    const name = producer.rows[0];
    const action: AuditAction =
      `${person.kind}.personal_data_report` satisfies `${PersonalDataKind}.personal_data_report`;
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId,
      action,
      record: { type: person.kind, id: person.id },
      personId: person.id,
      details: {
        sections: [...SECTIONS[person.kind]],
        entries: found.rows.length,
        entriesLeftOut: leftOut,
        ...counts,
      },
      requestId,
    });
    return {
      producedAt: this.clock.now().toISOString(),
      producedBy:
        name === undefined ? null : [name.last_name, name.first_name].filter(Boolean).join(' '),
      branch: { id: branch.id, name: branch.name, timeZone: branch.time_zone },
      entries,
      entriesLeftOut:
        leftOut > 0 && found.oldestAt !== null
          ? { count: leftOut, oldestAt: found.oldestAt.toISOString() }
          : null,
    };
  }
}

/** The parts of each report, named in its audit entry (decision 5). */
const SECTIONS: Readonly<Record<PersonalDataKind, readonly string[]>> = {
  student: [
    'record',
    'uids',
    'contracts',
    'statuses',
    'account',
    'relatives',
    'photo',
    'journal',
    'entries',
  ],
  staff: [
    'record',
    'branches',
    'divisions',
    'subjects',
    'languages',
    'statuses',
    'availability',
    'sameAsRelative',
    'account',
    'roles',
    'photo',
    'entries',
  ],
  relative: ['record', 'account', 'samePerson', 'links', 'entries'],
};
