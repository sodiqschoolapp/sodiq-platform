import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EXEMPTION_FILE_TYPES,
  classDisplayName,
  exemptionCategorySchema,
  exemptionKindSchema,
  exemptionSchema,
  type ErrorCode,
  type ErrorDetail,
  type Exemption,
  type ExemptionAbsences,
  type ExemptionBatchChanged,
  type ExemptionBatchEnd,
  type ExemptionBatchVoid,
  type ExemptionChoice,
  type ExemptionCreate,
  type ExemptionCreated,
  type ExemptionEdit,
  type ExemptionEnd,
  type ExemptionList,
  type ExemptionMoveConfirm,
  type ExemptionMoveOffers,
  type ExemptionPreview,
  type ExemptionReason,
  type ExemptionsQuery,
  type ExemptionVoid,
  type ExemptionsToday,
  type PlanFileType,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import type { JsonValue } from '../../database/types.generated.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { StoredFile } from '../../http/stored-file.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { PHOTO_STORE, type PhotoStore } from '../people/photo-store.js';
import { fileMatchesType } from '../plans/file-type.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { namedAccounts } from './cell-lines.query.js';
import {
  NIL_SUBJECT,
  addDays,
  expectedIn,
  lockStudents,
  noticeReopened,
  settle,
  todayIn,
  toldOf,
  withActor,
  type Settled,
  type StudentWindow,
} from './exemption-effects.js';

/**
 * Exemptions (task 8.5, pull request #223; `07`, Exemptions; `edge/exemptions`).
 * The Academic Vice Principal and the Super Admin enter them (area
 * `exemptions`, decision 1); the database keeps the overlap rule, the shape,
 * the year's end and what changes after the start (0123). Every change runs
 * through `exemption-effects.ts`, which settles what it does to the cells; a
 * preview runs the same change and rolls it back.
 */

/** The refusals of 0123, as error codes. */
export const EXEMPTION_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  exemption_spans_no_overlap: 'exemption_overlap',
  exemption_outside_year: 'exemption_outside_year',
  exemption_full_end: 'exemption_outside_year',
  exemption_closed_year: 'exemption_closed_year',
  exemption_started: 'exemption_started',
  exemption_voided: 'exemption_voided',
  exemption_subjects_state: 'exemption_started',
  exemptions_dates_check: 'exemption_end_before_start',
};

/** The stored key of an exemption's document, or of a reason of absence's file. */
export const exemptionFileKey = (exemptionId: string, fileId: string) =>
  `exemptions/${exemptionId}/${fileId}`;

const asciiOf = (name: string) => name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_') || 'file';

/** Carries a preview's answer out of the transaction it rolls back. */
class PreviewDone extends Error {
  constructor(readonly answer: ExemptionPreview) {
    super('preview');
  }
}

interface Cover {
  readonly kind: 'temporary' | 'full';
  readonly allSubjects: boolean;
  readonly subjectIds: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
}

interface StoredRow {
  id: string;
  branch_id: string;
  student_id: string;
  year_id: string;
  batch_id: string;
  kind: string;
  all_subjects: boolean;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  category: string;
  detail: string;
  document_key: string | null;
  document_type: string | null;
  document_name: string | null;
  voided_at: Date | null;
  version: number;
}

/** The local span of a cover, as `exemption_span_of` (0123) writes it. */
const spanOf = (cover: Cover): string =>
  cover.startTime === null || cover.endTime === null
    ? `[${cover.startDate} 00:00:00,${addDays(cover.endDate, 1)} 00:00:00)`
    : `[${cover.startDate} ${cover.startTime}:00,${cover.startDate} ${cover.endTime}:00)`;

const timeOf = (value: string | null): string | null => (value === null ? null : value.slice(0, 5));

const slotsOf = (cover: { startTime: string | null; endTime: string | null }) =>
  cover.startTime === null || cover.endTime === null
    ? null
    : { start: cover.startTime, end: cover.endTime };

const coverOfRow = async (transaction: Transaction, row: StoredRow): Promise<Cover> => ({
  kind: exemptionKindSchema.parse(row.kind),
  allSubjects: row.all_subjects,
  subjectIds: row.all_subjects
    ? []
    : (
        await transaction
          .selectFrom('exemption_subjects')
          .select('subject_id')
          .where('exemption_id', '=', row.id)
          .orderBy('subject_id')
          .execute()
      ).map((one) => one.subject_id),
  startDate: row.start_date,
  endDate: row.end_date,
  startTime: timeOf(row.start_time),
  endTime: timeOf(row.end_time),
});

const STORED_COLUMNS = [
  'id',
  'branch_id',
  'student_id',
  'year_id',
  'batch_id',
  'kind',
  'all_subjects',
  sql<string>`start_date::text`.as('start_date'),
  sql<string>`end_date::text`.as('end_date'),
  sql<string | null>`start_time::text`.as('start_time'),
  sql<string | null>`end_time::text`.as('end_time'),
  'category',
  'detail',
  'document_key',
  'document_type',
  'document_name',
  'voided_at',
  'version',
] as const;

@Injectable()
export class Exemptions {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(Notifications) private readonly notifications: Notifications,
    @Inject(RequestKeys) private readonly requestKeys: RequestKeys,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads.

  list(access: Access, query: ExemptionsQuery): Promise<ExemptionList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await todayIn(transaction, branchId);
      let rows = transaction
        .selectFrom('exemptions')
        .select('exemptions.id')
        .where('exemptions.branch_id', '=', branchId);
      if (query.kind !== undefined) rows = rows.where('exemptions.kind', '=', query.kind);
      if (query.studentId !== undefined)
        rows = rows.where('exemptions.student_id', '=', query.studentId);
      if (query.batchId !== undefined) rows = rows.where('exemptions.batch_id', '=', query.batchId);
      if (query.subjectId !== undefined) {
        const subjectId = query.subjectId;
        rows = rows.where((where) =>
          where.or([
            where('exemptions.all_subjects', '=', true),
            where.exists(
              where
                .selectFrom('exemption_subjects')
                .select('exemption_subjects.subject_id')
                .whereRef('exemption_subjects.exemption_id', '=', 'exemptions.id')
                .where('exemption_subjects.subject_id', '=', subjectId),
            ),
          ]),
        );
      }
      if (query.classId !== undefined) {
        const classId = query.classId;
        rows = rows.where((where) =>
          where.exists(
            where
              .selectFrom('class_memberships')
              .select('class_memberships.id')
              .whereRef('class_memberships.student_id', '=', 'exemptions.student_id')
              .where('class_memberships.class_id', '=', classId)
              .whereRef('class_memberships.valid_from', '<=', 'exemptions.end_date')
              .whereRef('class_memberships.valid_until', '>', 'exemptions.start_date'),
          ),
        );
      }
      const sunday = addDays(today, (7 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7);
      switch (query.state ?? 'all') {
        case 'in_force':
          rows = rows
            .where('exemptions.voided_at', 'is', null)
            .where('exemptions.start_date', '<=', today)
            .where('exemptions.end_date', '>=', today);
          break;
        case 'ending_this_week':
          rows = rows
            .where('exemptions.voided_at', 'is', null)
            .where('exemptions.end_date', '>=', today)
            .where('exemptions.end_date', '<=', sunday);
          break;
        case 'coming':
          rows = rows
            .where('exemptions.voided_at', 'is', null)
            .where('exemptions.start_date', '>', today);
          break;
        case 'ended':
          rows = rows
            .where('exemptions.voided_at', 'is', null)
            .where('exemptions.end_date', '<', today);
          break;
        case 'voided':
          rows = rows.where('exemptions.voided_at', 'is not', null);
          break;
        case 'all':
          break;
      }
      const found = await rows
        .orderBy('exemptions.start_date', 'desc')
        .orderBy('exemptions.id')
        .limit(501)
        .execute();
      const items = await exemptionsOf(
        transaction,
        branchId,
        found.slice(0, 500).map((row) => row.id),
      );
      return { items, more: Math.max(0, found.length - 500) };
    });
  }

  one(access: Access, id: string): Promise<Exemption> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const [found] = await exemptionsOf(transaction, branchId, [id]);
      if (found === undefined) throw notFound();
      return found;
    });
  }

  /** The detail of the reason; every opening is logged (`edge/exemptions`, row 10). */
  reason(access: Access, id: string, requestId: string | undefined): Promise<ExemptionReason> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await transaction
        .selectFrom('exemptions')
        .select(['id', 'student_id', 'category', 'detail'])
        .where('id', '=', id)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (row === undefined) throw notFound();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'exemption.reason_open',
        record: { type: 'student', id: row.student_id },
        details: { exemptionId: row.id },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return {
        id: row.id,
        category: exemptionCategorySchema.parse(row.category),
        detail: row.detail,
      };
    });
  }

  /** The document; every opening is logged (`edge/exemptions`, row 10). */
  async document(access: Access, id: string, requestId: string | undefined): Promise<StoredFile> {
    const branchId = branchOf(access);
    const row = await this.transactions.run(access.branchIds, async (transaction) => {
      const found = await transaction
        .selectFrom('exemptions')
        .select(['id', 'student_id', 'document_key', 'document_type', 'document_name'])
        .where('id', '=', id)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (found?.document_key === null || found === undefined) throw notFound();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'exemption.document_open',
        record: { type: 'student', id: found.student_id },
        details: { exemptionId: found.id },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return found;
    });
    return readStored(
      this.store,
      row.document_key ?? '',
      row.document_type ?? '',
      row.document_name ?? '',
    );
  }

  /**
   * The teaching home's cards (`edge/exemptions`: "The Tutor's home page shows 'exempt
   * today'"; `07`, Problem cases: "The student's Tutor and teachers see 'back from
   * exemption' on that day"): the students of the reader's own classes (rows of a Tutor in
   * force now), with the category, and the students of the reader's lessons today.
   */
  today(access: Access): Promise<ExemptionsToday> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await todayIn(transaction, branchId);
      const own = [
        ...new Set(
          access.permitting
            .filter((one) => one.role === 'tutor')
            .flatMap((one) => one.classIds.map((id) => id.toLowerCase())),
        ),
      ];
      const staff = await transaction
        .selectFrom('staff')
        .select('id')
        .where('account_id', '=', access.accountId)
        .executeTakeFirst();
      const found = await sql<{
        student_id: string;
        tutor: boolean;
        kind: 'temporary' | 'full';
        start_date: string;
        end_date: string;
        start_time: string | null;
        end_time: string | null;
        category: string;
        back: boolean;
      }>`
        with mine as (
          select m.student_id, true as tutor
          from class_memberships m
          where m.class_id = any(${own}::uuid[])
            and m.valid_from <= ${today}::date and ${today}::date < m.valid_until
          union
          select m.student_id, false
          from lessons l
          join class_memberships m on m.class_id = l.class_id
            and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
          where l.branch_id = ${branchId}::uuid and l.lesson_date = ${today}::date
            and l.cancel_cause is null and l.teacher_id = ${staff?.id ?? null}::uuid
          union
          select m.student_id, false
          from lessons l
          join group_memberships m on m.group_id = l.group_id
            and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
          where l.branch_id = ${branchId}::uuid and l.lesson_date = ${today}::date
            and l.cancel_cause is null and l.teacher_id = ${staff?.id ?? null}::uuid
        ),
        readers as (
          select student_id, bool_or(tutor) as tutor from mine group by student_id
        )
        select r.student_id, r.tutor, e.kind, e.start_date::text as start_date,
          e.end_date::text as end_date, to_char(e.start_time, 'HH24:MI') as start_time,
          to_char(e.end_time, 'HH24:MI') as end_time, e.category,
          e.end_date < ${today}::date as back
        from readers r
        join exemptions e on e.student_id = r.student_id and e.branch_id = ${branchId}::uuid
          and e.voided_at is null
          and (
            (r.tutor and e.start_date <= ${today}::date and e.end_date >= ${today}::date)
            or (
              e.end_date = ${today}::date - 1
              and not exists (
                select 1 from exemptions o
                where o.student_id = e.student_id and o.voided_at is null
                  and o.start_date <= ${today}::date and o.end_date >= ${today}::date
              )
            )
          )
        order by e.start_date, e.id
      `.execute(transaction);
      const students = await studentsOf(
        transaction,
        found.rows.map((row) => ({ id: row.student_id, on: today })),
      );
      const lineOf = (row: (typeof found.rows)[number]) => {
        const student = students.get(`${row.student_id}|${today}`);
        return student === undefined
          ? []
          : [
              {
                student,
                kind: row.kind,
                startDate: row.start_date,
                endDate: row.end_date,
                slots: slotsOf({ startTime: row.start_time, endTime: row.end_time }),
                category: row.tutor ? exemptionCategorySchema.parse(row.category) : null,
              },
            ];
      };
      return {
        date: today,
        exemptToday: found.rows.filter((row) => !row.back).flatMap(lineOf),
        backToday: found.rows.filter((row) => row.back).flatMap(lineOf),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Create.

  async preview(access: Access, input: ExemptionCreate): Promise<ExemptionPreview> {
    return this.previewOf(access, (transaction) =>
      this.createRun(transaction, access, { ...input, choices: [] }, undefined, true),
    );
  }

  create(
    access: Access,
    input: ExemptionCreate,
    key: string,
    requestId: string | undefined,
  ): Promise<ExemptionCreated> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          // The ids before the key: a repeat with another branch's student is 404 (api rules).
          await this.refuseForeign(transaction, input.studentIds, input.subjectIds);
          const once = await this.requestKeys.runOnce(
            transaction,
            {
              key,
              scope: 'exemptions.create',
              accountId: access.accountId,
              input: { body: JSON.stringify(input) },
            },
            async () => {
              const made = await this.createRun(transaction, access, input, requestId, false);
              return made;
            },
          );
          const stored = once.result;
          return {
            batchId: stored.batchId,
            exemptions: await exemptionsOf(transaction, branchId, stored.ids),
          };
        }),
      EXEMPTION_REFUSALS,
    );
  }

  private async refuseForeign(
    transaction: Transaction,
    studentIds: readonly string[],
    subjectIds: readonly string[] | null,
  ): Promise<void> {
    const students = await transaction
      .selectFrom('students')
      .select('id')
      .where('id', 'in', [...studentIds])
      .execute();
    if (students.length !== new Set(studentIds.map((id) => id.toLowerCase())).size)
      throw notFound();
    if (subjectIds !== null) {
      const subjects = await transaction
        .selectFrom('subjects')
        .select('id')
        .where('id', 'in', [...subjectIds])
        .where('archived_at', 'is', null)
        .execute();
      if (subjects.length !== subjectIds.length) throw notFound();
    }
  }

  /** The year of the branch holding the start, with its last day and state. */
  private async yearOf(
    transaction: Transaction,
    branchId: string,
    date: string,
  ): Promise<{ id: string; end: string; status: string }> {
    const year = await transaction
      .selectFrom('academic_years')
      .select(['id', sql<string>`end_date::text`.as('end'), 'status'])
      .where('branch_id', '=', branchId)
      .where('start_date', '<=', date)
      .where('end_date', '>=', date)
      .executeTakeFirst();
    if (year === undefined) throw new ApiException('exemption_outside_year', 409);
    if (year.status === 'closed') throw new ApiException('exemption_closed_year', 409);
    return year;
  }

  /** The other exemption a cover would meet, of the branch only; `undefined` when none here. */
  private async overlapOf(
    transaction: Transaction,
    studentId: string,
    cover: Cover,
    self: string | null,
  ) {
    const keys = cover.allSubjects ? [NIL_SUBJECT] : [...cover.subjectIds];
    const found = await sql<{
      id: string;
      kind: string;
      start_date: string;
      end_date: string;
      version: number;
    }>`
      select e.id, e.kind, e.start_date::text as start_date, e.end_date::text as end_date, e.version
      from exemption_spans s
      join exemptions e on e.id = s.exemption_id
      where s.student_id = ${studentId}::uuid and s.live
        and s.subject_key = any(${keys}::uuid[])
        and s.span && ${spanOf(cover)}::tsrange
        and (${self}::uuid is null or e.id <> ${self}::uuid)
      order by e.start_date, e.id
      limit 1
    `.execute(transaction);
    return found.rows[0];
  }

  private async createRun(
    transaction: Transaction,
    access: Access,
    input: ExemptionCreate,
    requestId: string | undefined,
    preview: boolean,
  ): Promise<{ batchId: string; ids: string[] }> {
    const branchId = branchOf(access);
    await withActor(transaction, access.accountId);
    await this.refuseForeign(transaction, input.studentIds, input.subjectIds);
    const year = await this.yearOf(transaction, branchId, input.startDate);
    const cover: Cover = {
      kind: input.kind,
      allSubjects: input.subjectIds === null,
      subjectIds: input.subjectIds ?? [],
      startDate: input.startDate,
      endDate: input.kind === 'full' ? year.end : (input.endDate ?? input.startDate),
      startTime: input.slots?.start ?? null,
      endTime: input.slots?.end ?? null,
    };
    if (cover.endDate > year.end) throw new ApiException('exemption_outside_year', 409);
    const students = [...input.studentIds].sort();
    await lockStudents(transaction, students);
    const windows: StudentWindow[] = students.map((studentId) => ({
      studentId,
      from: cover.startDate,
      until: cover.endDate,
    }));
    const before = await expectedIn(transaction, branchId, windows);
    const overlaps = new Map<string, Awaited<ReturnType<Exemptions['overlapOf']>>>();
    const refused: ErrorDetail[] = [];
    for (const studentId of students) {
      const met = await this.overlapOf(transaction, studentId, cover, null);
      if (met !== undefined) {
        overlaps.set(studentId, met);
        refused.push({
          path: `studentIds.${studentId}`,
          code: 'exemption_overlap',
          message: 'Another exemption of the student covers that time.',
          recordId: studentId,
          exemption: {
            id: met.id,
            startDate: met.start_date,
            endDate: met.end_date,
            version: met.version,
          },
        });
      }
    }
    if (!preview && refused.length > 0) {
      throw new ApiException('exemption_overlap', 409, undefined, refused);
    }
    const batchId = randomUUID();
    const idOf = new Map<string, string>();
    for (const studentId of students) {
      if (overlaps.has(studentId)) continue;
      idOf.set(
        studentId,
        await this.insert(transaction, access, studentId, year.id, batchId, cover, input),
      );
    }
    const settled = await settle(transaction, {
      branchId,
      before,
      windows: windows.filter((one) => idOf.has(one.studentId)),
      choices: input.choices,
      exemptionOf: (studentId) => Promise.resolve(idOf.get(studentId) ?? null),
      preview,
    });
    if (preview) {
      throw new PreviewDone({
        yearEnd: year.end,
        students: students.map((studentId) => {
          const effect = settled.effects.get(studentId);
          const met = overlaps.get(studentId);
          return {
            studentId,
            auto: effect?.auto ?? [],
            choose: effect?.choose ?? [],
            reopen: [],
            overlap:
              met === undefined
                ? null
                : {
                    exemption: {
                      id: met.id,
                      kind: exemptionKindSchema.parse(met.kind),
                      startDate: met.start_date,
                      endDate: met.end_date,
                      version: met.version,
                      started: met.start_date <= input.startDate,
                    },
                  },
          };
        }),
      });
    }
    const names = await studentNames(transaction, students);
    for (const studentId of students) {
      const id = idOf.get(studentId) ?? '';
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'exemption.create',
        record: { type: 'student', id: studentId },
        oldValue: null,
        newValue: {
          exemptionId: id,
          batchId,
          kind: cover.kind,
          subjectIds: cover.allSubjects ? null : [...cover.subjectIds],
          startDate: cover.startDate,
          endDate: cover.endDate,
          slots: slotsOf(cover),
          category: input.category,
        },
        details: effectDetails(settled, studentId),
        ...(requestId === undefined ? {} : { requestId }),
      });
      await this.tell(transaction, access, studentId, names, cover, null);
    }
    return { batchId, ids: students.map((studentId) => idOf.get(studentId) ?? '') };
  }

  private async insert(
    transaction: Transaction,
    access: Access,
    studentId: string,
    yearId: string,
    batchId: string,
    cover: Cover,
    reason: { category: string; detail: string },
    extra: { movedFromId?: string; document?: { key: string; type: string; name: string } } = {},
  ): Promise<string> {
    const branchId = branchOf(access);
    const row = await transaction
      .insertInto('exemptions')
      .values({
        branch_id: branchId,
        student_id: studentId,
        year_id: yearId,
        batch_id: batchId,
        kind: cover.kind,
        all_subjects: cover.allSubjects,
        start_date: cover.startDate,
        end_date: cover.endDate,
        start_time: cover.startTime,
        end_time: cover.endTime,
        category: reason.category,
        detail: reason.detail,
        document_key: extra.document?.key ?? null,
        document_type: extra.document?.type ?? null,
        document_name: extra.document?.name ?? null,
        granted_by: access.accountId,
        assignment_id: access.assignmentId,
        moved_from_id: extra.movedFromId ?? null,
        // Written by exemptions_write.
        granted_at: new Date(0),
        version: 0,
        changed_at: new Date(0),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const subjectId of cover.subjectIds) {
      await transaction
        .insertInto('exemption_subjects')
        .values({ branch_id: branchId, exemption_id: row.id, subject_id: subjectId })
        .execute();
    }
    return row.id;
  }

  /** The notice of a grant or a change, to the Tutor and the teachers of the window, without the reason. */
  private async tell(
    transaction: Transaction,
    access: Access,
    studentId: string,
    names: ReadonlyMap<string, string>,
    cover: Cover,
    change: 'edited' | 'ended' | 'voided' | null,
    window: { from: string; until: string } = { from: cover.startDate, until: cover.endDate },
  ): Promise<void> {
    const branchId = branchOf(access);
    const accounts = await toldOf(transaction, {
      branchId,
      studentId,
      from: window.from,
      until: window.until,
      actorId: access.accountId,
    });
    if (accounts.length === 0) return;
    const base = {
      student: names.get(studentId) || '—',
      kind: cover.kind,
      from: cover.startDate,
      until: cover.endDate,
      times:
        cover.startTime === null || cover.endTime === null
          ? ''
          : `${cover.startTime}–${cover.endTime}`,
    };
    if (change === null) {
      await this.notifications.send(transaction, {
        kind: 'journal.exemption_granted',
        branchId,
        accountIds: accounts,
        data: base,
      });
    } else {
      await this.notifications.send(transaction, {
        kind: 'journal.exemption_changed',
        branchId,
        accountIds: accounts,
        data: { ...base, change },
      });
    }
  }

  private async previewOf(
    access: Access,
    work: (transaction: Transaction) => Promise<unknown>,
  ): Promise<ExemptionPreview> {
    try {
      await refusingConstraints(
        () => this.transactions.run(access.branchIds, work),
        EXEMPTION_REFUSALS,
      );
    } catch (error) {
      if (error instanceof PreviewDone) return error.answer;
      throw error;
    }
    throw new Error('A preview ends with its answer.');
  }

  // ---------------------------------------------------------------------------
  // Changes of one exemption.

  /** The stored row, locked, of the branch; checks the version when given. */
  private async locked(
    transaction: Transaction,
    branchId: string,
    id: string,
    version: number | null,
  ): Promise<StoredRow> {
    const row = await transaction
      .selectFrom('exemptions')
      .select(STORED_COLUMNS)
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) throw notFound();
    if (row.voided_at !== null) throw new ApiException('exemption_voided', 409);
    if (version !== null && row.version !== version) throw new ApiException('exemption_stale', 409);
    return row;
  }

  editPreview(access: Access, id: string, input: ExemptionEdit): Promise<ExemptionPreview> {
    return this.previewOf(access, (transaction) =>
      this.editRun(transaction, access, id, { ...input, choices: [] }, undefined, true),
    );
  }

  edit(
    access: Access,
    id: string,
    input: ExemptionEdit,
    requestId: string | undefined,
  ): Promise<Exemption> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.editRun(transaction, access, id, input, requestId, false);
          const [found] = await exemptionsOf(transaction, branchId, [id]);
          if (found === undefined) throw notFound();
          return found;
        }),
      EXEMPTION_REFUSALS,
    );
  }

  private async editRun(
    transaction: Transaction,
    access: Access,
    id: string,
    input: ExemptionEdit,
    requestId: string | undefined,
    preview: boolean,
  ): Promise<void> {
    const branchId = branchOf(access);
    await withActor(transaction, access.accountId);
    const exists = await transaction
      .selectFrom('exemptions')
      .select(['student_id'])
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (exists === undefined) throw notFound();
    if (input.subjectIds !== null)
      await this.refuseForeign(transaction, [exists.student_id], input.subjectIds);
    await lockStudents(transaction, [exists.student_id]);
    const row = await this.locked(transaction, branchId, id, input.version);
    const today = await todayIn(transaction, branchId);
    // edge/exemptions, row 4: "Before the start date every field can be changed".
    if (row.start_date <= today) throw new ApiException('exemption_started', 409);
    const year = await this.yearOf(transaction, branchId, input.startDate);
    // The year stays: an exemption of another year is entered on its own.
    if (year.id !== row.year_id) throw new ApiException('exemption_outside_year', 409);
    const old = await coverOfRow(transaction, row);
    const cover: Cover = {
      kind: input.kind,
      allSubjects: input.subjectIds === null,
      subjectIds: input.subjectIds ?? [],
      startDate: input.startDate,
      endDate: input.kind === 'full' ? year.end : (input.endDate ?? input.startDate),
      startTime: input.slots?.start ?? null,
      endTime: input.slots?.end ?? null,
    };
    if (cover.endDate > year.end) throw new ApiException('exemption_outside_year', 409);
    const window = {
      studentId: row.student_id,
      from: old.startDate < cover.startDate ? old.startDate : cover.startDate,
      until: old.endDate > cover.endDate ? old.endDate : cover.endDate,
    };
    const before = await expectedIn(transaction, branchId, [window]);
    const met = await this.overlapOf(transaction, row.student_id, cover, id);
    if (met !== undefined) throw overlapRefusal(row.student_id, met);
    await transaction.deleteFrom('exemption_subjects').where('exemption_id', '=', id).execute();
    await transaction
      .updateTable('exemptions')
      .set({
        kind: cover.kind,
        all_subjects: cover.allSubjects,
        start_date: cover.startDate,
        end_date: cover.endDate,
        start_time: cover.startTime,
        end_time: cover.endTime,
        category: input.category,
        detail: input.detail,
      })
      .where('id', '=', id)
      .execute();
    for (const subjectId of cover.subjectIds) {
      await transaction
        .insertInto('exemption_subjects')
        .values({ branch_id: branchId, exemption_id: id, subject_id: subjectId })
        .execute();
    }
    const settled = await settle(transaction, {
      branchId,
      before,
      windows: [window],
      choices: input.choices,
      exemptionOf: () => Promise.resolve(id),
      preview,
    });
    if (preview) throw new PreviewDone(previewAnswer(settled, [row.student_id], year.end));
    const names = await studentNames(transaction, [row.student_id]);
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'exemption.edit',
      record: { type: 'student', id: row.student_id },
      oldValue: coverValue(old, row.category),
      newValue: coverValue(cover, input.category),
      details: { exemptionId: id, ...effectDetails(settled, row.student_id) },
      ...(requestId === undefined ? {} : { requestId }),
    });
    await this.tell(transaction, access, row.student_id, names, cover, 'edited', window);
    await noticeReopened(transaction, this.notifications, {
      branchId,
      reopened: settled.reopenedLocked,
      names,
      actorId: access.accountId,
    });
  }

  endPreview(access: Access, id: string, input: ExemptionEnd): Promise<ExemptionPreview> {
    return this.previewOf(access, async (transaction) => {
      const settled = await this.endRun(
        transaction,
        access,
        [id],
        input.endDate,
        [],
        undefined,
        true,
        input.version,
      );
      throw new PreviewDone(settled);
    });
  }

  end(
    access: Access,
    id: string,
    input: ExemptionEnd,
    requestId: string | undefined,
  ): Promise<Exemption> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.endRun(
            transaction,
            access,
            [id],
            input.endDate,
            input.choices,
            requestId,
            false,
            input.version,
          );
          const [found] = await exemptionsOf(transaction, branchId, [id]);
          if (found === undefined) throw notFound();
          return found;
        }),
      EXEMPTION_REFUSALS,
    );
  }

  /** A new end of each exemption named ("End" from a date, or longer); one of a batch takes no version. */
  private async endRun(
    transaction: Transaction,
    access: Access,
    ids: readonly string[],
    endDate: string,
    choices: readonly ExemptionChoice[],
    requestId: string | undefined,
    preview: boolean,
    version: number | null,
  ): Promise<ExemptionPreview> {
    const branchId = branchOf(access);
    await withActor(transaction, access.accountId);
    const heads = await transaction
      .selectFrom('exemptions')
      .select(['id', 'student_id'])
      .where('id', 'in', [...ids])
      .where('branch_id', '=', branchId)
      .execute();
    if (heads.length !== ids.length) throw notFound();
    await lockStudents(
      transaction,
      heads.map((one) => one.student_id),
    );
    const rows: StoredRow[] = [];
    for (const id of [...ids].sort())
      rows.push(await this.locked(transaction, branchId, id, version));
    const windows: StudentWindow[] = [];
    const covers = new Map<string, Cover>();
    let yearEnd = endDate;
    for (const row of rows) {
      if (endDate < row.start_date) throw new ApiException('exemption_end_before_start', 409);
      const cover = await coverOfRow(transaction, row);
      covers.set(row.id, cover);
      const year = await transaction
        .selectFrom('academic_years')
        .select(sql<string>`end_date::text`.as('end'))
        .where('id', '=', row.year_id)
        .executeTakeFirstOrThrow();
      yearEnd = year.end;
      if (endDate > year.end) throw new ApiException('exemption_outside_year', 409);
      const longer = endDate > row.end_date;
      if (longer) {
        const met = await this.overlapOf(
          transaction,
          row.student_id,
          { ...cover, endDate },
          row.id,
        );
        if (met !== undefined) throw overlapRefusal(row.student_id, met);
      }
      windows.push({
        studentId: row.student_id,
        from: row.start_date,
        until: longer ? endDate : row.end_date,
      });
    }
    const before = await expectedIn(transaction, branchId, windows);
    for (const row of rows) {
      await transaction
        .updateTable('exemptions')
        .set({ end_date: endDate, end_cause: 'end' })
        .where('id', '=', row.id)
        .execute();
    }
    const exemptionOfStudent = new Map(rows.map((row) => [row.student_id, row.id]));
    const settled = await settle(transaction, {
      branchId,
      before,
      windows,
      choices,
      exemptionOf: (studentId) => Promise.resolve(exemptionOfStudent.get(studentId) ?? null),
      preview,
    });
    const answer = previewAnswer(
      settled,
      rows.map((row) => row.student_id),
      yearEnd,
    );
    if (preview) return answer;
    const names = await studentNames(
      transaction,
      rows.map((row) => row.student_id),
    );
    for (const row of rows) {
      const cover = covers.get(row.id);
      if (cover === undefined) continue;
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'exemption.end',
        record: { type: 'student', id: row.student_id },
        oldValue: { exemptionId: row.id, endDate: row.end_date },
        newValue: { exemptionId: row.id, endDate },
        details: { batchId: row.batch_id, ...effectDetails(settled, row.student_id) },
        ...(requestId === undefined ? {} : { requestId }),
      });
      await this.tell(transaction, access, row.student_id, names, { ...cover, endDate }, 'ended', {
        from: row.start_date,
        until: endDate > row.end_date ? endDate : row.end_date,
      });
    }
    await noticeReopened(transaction, this.notifications, {
      branchId,
      reopened: settled.reopenedLocked,
      names,
      actorId: access.accountId,
    });
    return answer;
  }

  voidPreview(access: Access, id: string, version: number): Promise<ExemptionPreview> {
    return this.previewOf(access, async (transaction) => {
      throw new PreviewDone(
        await this.voidRun(transaction, access, [id], 'preview', undefined, true, version),
      );
    });
  }

  void(
    access: Access,
    id: string,
    input: ExemptionVoid,
    requestId: string | undefined,
  ): Promise<Exemption> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.voidRun(
            transaction,
            access,
            [id],
            input.reason,
            requestId,
            false,
            input.version,
          );
          const [found] = await exemptionsOf(transaction, branchId, [id]);
          if (found === undefined) throw notFound();
          return found;
        }),
      EXEMPTION_REFUSALS,
    );
  }

  /** "Void, entered in error" with a reason (`edge/exemptions`, row 4). */
  private async voidRun(
    transaction: Transaction,
    access: Access,
    ids: readonly string[],
    reason: string,
    requestId: string | undefined,
    preview: boolean,
    version: number | null,
  ): Promise<ExemptionPreview> {
    const branchId = branchOf(access);
    await withActor(transaction, access.accountId);
    const heads = await transaction
      .selectFrom('exemptions')
      .select(['id', 'student_id'])
      .where('id', 'in', [...ids])
      .where('branch_id', '=', branchId)
      .execute();
    if (heads.length !== ids.length) throw notFound();
    await lockStudents(
      transaction,
      heads.map((one) => one.student_id),
    );
    const rows: StoredRow[] = [];
    for (const id of [...ids].sort())
      rows.push(await this.locked(transaction, branchId, id, version));
    const windows = rows.map((row) => ({
      studentId: row.student_id,
      from: row.start_date,
      until: row.end_date,
    }));
    const before = await expectedIn(transaction, branchId, windows);
    const moment = await transactionMoment(transaction);
    for (const row of rows) {
      await transaction
        .updateTable('exemptions')
        .set({
          voided_at: moment,
          voided_by: access.accountId,
          void_cause: 'error',
          void_reason: reason,
        })
        .where('id', '=', row.id)
        .execute();
    }
    const exemptionOfStudent = new Map(rows.map((row) => [row.student_id, row.id]));
    const settled = await settle(transaction, {
      branchId,
      before,
      windows,
      choices: [],
      exemptionOf: (studentId) => Promise.resolve(exemptionOfStudent.get(studentId) ?? null),
      preview,
    });
    const yearEnd = rows[0]?.end_date ?? '';
    const answer = previewAnswer(
      settled,
      rows.map((row) => row.student_id),
      yearEnd,
    );
    if (preview) return answer;
    const names = await studentNames(
      transaction,
      rows.map((row) => row.student_id),
    );
    for (const row of rows) {
      const cover = await coverOfRow(transaction, row);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'exemption.void',
        record: { type: 'student', id: row.student_id },
        oldValue: { exemptionId: row.id, ...coverValue(cover, row.category) },
        newValue: null,
        reason,
        details: { batchId: row.batch_id, ...effectDetails(settled, row.student_id) },
        ...(requestId === undefined ? {} : { requestId }),
      });
      await this.tell(transaction, access, row.student_id, names, cover, 'voided');
    }
    await noticeReopened(transaction, this.notifications, {
      branchId,
      reopened: settled.reopenedLocked,
      names,
      actorId: access.accountId,
    });
    return answer;
  }

  // ---------------------------------------------------------------------------
  // Batches (`edge/exemptions`, row 8: "a batch that can be ended or voided together").

  private async liveOfBatch(
    transaction: Transaction,
    branchId: string,
    batchId: string,
  ): Promise<string[]> {
    const rows = await transaction
      .selectFrom('exemptions')
      .select('id')
      .where('batch_id', '=', batchId)
      .where('branch_id', '=', branchId)
      .execute();
    if (rows.length === 0) throw notFound();
    const live = await transaction
      .selectFrom('exemptions')
      .select('id')
      .where('batch_id', '=', batchId)
      .where('branch_id', '=', branchId)
      .where('voided_at', 'is', null)
      .orderBy('id')
      .execute();
    if (live.length === 0) throw new ApiException('exemption_batch_empty', 409);
    return live.map((row) => row.id);
  }

  batchEndPreview(
    access: Access,
    batchId: string,
    input: ExemptionBatchEnd,
  ): Promise<ExemptionPreview> {
    const branchId = branchOf(access);
    return this.previewOf(access, async (transaction) => {
      const ids = await this.liveOfBatch(transaction, branchId, batchId);
      throw new PreviewDone(
        await this.endRun(transaction, access, ids, input.endDate, [], undefined, true, null),
      );
    });
  }

  batchEnd(
    access: Access,
    batchId: string,
    input: ExemptionBatchEnd,
    requestId: string | undefined,
  ): Promise<ExemptionBatchChanged> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const ids = await this.liveOfBatch(transaction, branchId, batchId);
          await this.endRun(
            transaction,
            access,
            ids,
            input.endDate,
            input.choices,
            requestId,
            false,
            null,
          );
          return { exemptions: await exemptionsOf(transaction, branchId, ids) };
        }),
      EXEMPTION_REFUSALS,
    );
  }

  batchVoidPreview(access: Access, batchId: string): Promise<ExemptionPreview> {
    const branchId = branchOf(access);
    return this.previewOf(access, async (transaction) => {
      const ids = await this.liveOfBatch(transaction, branchId, batchId);
      throw new PreviewDone(
        await this.voidRun(transaction, access, ids, 'preview', undefined, true, null),
      );
    });
  }

  batchVoid(
    access: Access,
    batchId: string,
    input: ExemptionBatchVoid,
    requestId: string | undefined,
  ): Promise<ExemptionBatchChanged> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const ids = await this.liveOfBatch(transaction, branchId, batchId);
          await this.voidRun(transaction, access, ids, input.reason, requestId, false, null);
          return { exemptions: await exemptionsOf(transaction, branchId, ids) };
        }),
      EXEMPTION_REFUSALS,
    );
  }

  // ---------------------------------------------------------------------------
  // The document (decision 17).

  async putDocument(
    access: Access,
    id: string,
    name: string,
    file: UploadedFile | null,
    requestId: string | undefined,
  ): Promise<Exemption> {
    const branchId = branchOf(access);
    await this.transactions.run(access.branchIds, async (transaction) => {
      const found = await transaction
        .selectFrom('exemptions')
        .select('voided_at')
        .where('id', '=', id)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (found === undefined) throw notFound();
      if (found.voided_at !== null) throw new ApiException('exemption_voided', 409);
    });
    const type = checkedFile(this.store, file);
    const fileId = randomUUID();
    await putStored(this.store, exemptionFileKey(id, fileId), file, type);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const row = await this.locked(transaction, branchId, id, null);
          await transaction
            .updateTable('exemptions')
            .set({
              document_key: exemptionFileKey(id, fileId),
              document_type: type,
              document_name: name,
            })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'exemption.document_add',
            record: { type: 'student', id: row.student_id },
            oldValue: row.document_name === null ? null : { name: row.document_name },
            newValue: { exemptionId: id, name, type, bytes: file?.bytes.length ?? 0 },
            ...(requestId === undefined ? {} : { requestId }),
          });
          const [answer] = await exemptionsOf(transaction, branchId, [id]);
          if (answer === undefined) throw notFound();
          return answer;
        }),
      EXEMPTION_REFUSALS,
    );
  }

  removeDocument(access: Access, id: string, requestId: string | undefined): Promise<Exemption> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const row = await this.locked(transaction, branchId, id, null);
          if (row.document_key === null) throw notFound();
          await transaction
            .updateTable('exemptions')
            .set({ document_key: null, document_type: null, document_name: null })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'exemption.document_remove',
            record: { type: 'student', id: row.student_id },
            oldValue: { exemptionId: id, name: row.document_name },
            newValue: null,
            ...(requestId === undefined ? {} : { requestId }),
          });
          const [answer] = await exemptionsOf(transaction, branchId, [id]);
          if (answer === undefined) throw notFound();
          return answer;
        }),
      EXEMPTION_REFUSALS,
    );
  }

  // ---------------------------------------------------------------------------
  // The absences with a Tutor's reason and no exemption (`edge/exemptions`, row 9; decision 16).

  absencesWithout(access: Access): Promise<ExemptionAbsences> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await sql<{
        student_id: string;
        date: string;
        category: 'illness' | 'family' | 'school_permitted';
        note: string;
      }>`
        select r.student_id, r.absence_date::text as date, r.category, r.note
        from student_absence_reasons r
        where r.branch_id = ${branchId}::uuid
          and r.category in ('illness', 'family', 'school_permitted')
          and not exists (
            select 1 from exemption_spans s
            where s.student_id = r.student_id and s.live
              and s.span && tsrange(r.absence_date::timestamp, (r.absence_date + 1)::timestamp, '[)')
          )
        order by r.absence_date desc, r.student_id
        limit 500
      `.execute(transaction);
      const students = await studentsOf(
        transaction,
        found.rows.map((row) => ({ id: row.student_id, on: row.date })),
      );
      return {
        items: found.rows.flatMap((row) => {
          const student = students.get(`${row.student_id}|${row.date}`);
          return student === undefined
            ? []
            : [{ student, date: row.date, category: row.category, note: row.note }];
        }),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // The offers of a branch move (decision 3).

  offers(access: Access): Promise<ExemptionMoveOffers> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, (transaction) =>
      offersIn(transaction, branchId),
    );
  }

  private async lockedOffer(transaction: Transaction, branchId: string, id: string) {
    const row = await transaction
      .selectFrom('exemption_move_offers')
      .select([
        'id',
        'student_id',
        'source_id',
        'kind',
        'all_subjects',
        'subject_ids',
        sql<string>`start_date::text`.as('start_date'),
        sql<string>`end_date::text`.as('end_date'),
        sql<string | null>`start_time::text`.as('start_time'),
        sql<string | null>`end_time::text`.as('end_time'),
        'category',
        'detail',
        'document_key',
        'document_type',
        'document_name',
        'decision',
      ])
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) throw notFound();
    if (row.decision !== null) throw new ApiException('exemption_offer_decided', 409);
    return row;
  }

  confirmPreview(access: Access, id: string): Promise<ExemptionPreview> {
    return this.previewOf(access, async (transaction) => {
      throw new PreviewDone(await this.confirmRun(transaction, access, id, [], undefined, true));
    });
  }

  confirm(
    access: Access,
    id: string,
    input: ExemptionMoveConfirm,
    requestId: string | undefined,
  ): Promise<Exemption> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.confirmRun(transaction, access, id, input.choices, requestId, false);
          const offer = await transaction
            .selectFrom('exemption_move_offers')
            .select('exemption_id')
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
          const [found] = await exemptionsOf(transaction, branchId, [offer.exemption_id ?? '']);
          if (found === undefined) throw notFound();
          return found;
        }),
      EXEMPTION_REFUSALS,
    );
  }

  private async confirmRun(
    transaction: Transaction,
    access: Access,
    id: string,
    choices: readonly ExemptionChoice[],
    requestId: string | undefined,
    preview: boolean,
  ): Promise<ExemptionPreview> {
    const branchId = branchOf(access);
    await withActor(transaction, access.accountId);
    const head = await transaction
      .selectFrom('exemption_move_offers')
      .select('student_id')
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (head === undefined) throw notFound();
    await lockStudents(transaction, [head.student_id]);
    const offer = await this.lockedOffer(transaction, branchId, id);
    const year = await this.yearOf(transaction, branchId, offer.start_date);
    const kind = exemptionKindSchema.parse(offer.kind);
    const cover: Cover = {
      kind,
      allSubjects: offer.all_subjects,
      subjectIds: offer.all_subjects ? [] : [...offer.subject_ids].sort(),
      startDate: offer.start_date,
      endDate: kind === 'full' || offer.end_date > year.end ? year.end : offer.end_date,
      startTime: timeOf(offer.start_time),
      endTime: timeOf(offer.end_time),
    };
    const window = { studentId: offer.student_id, from: cover.startDate, until: cover.endDate };
    const before = await expectedIn(transaction, branchId, [window]);
    const met = await this.overlapOf(transaction, offer.student_id, cover, null);
    if (met !== undefined) throw overlapRefusal(offer.student_id, met);
    const exemptionId = await this.insert(
      transaction,
      access,
      offer.student_id,
      year.id,
      randomUUID(),
      cover,
      { category: offer.category, detail: offer.detail },
      {
        movedFromId: offer.source_id,
        ...(offer.document_key === null
          ? {}
          : {
              document: {
                key: offer.document_key,
                type: offer.document_type ?? '',
                name: offer.document_name ?? '',
              },
            }),
      },
    );
    const settled = await settle(transaction, {
      branchId,
      before,
      windows: [window],
      choices,
      exemptionOf: () => Promise.resolve(exemptionId),
      preview,
    });
    const answer = previewAnswer(settled, [offer.student_id], year.end);
    if (preview) return answer;
    await transaction
      .updateTable('exemption_move_offers')
      .set({
        decision: 'confirm',
        decided_by: access.accountId,
        decided_at: await transactionMoment(transaction),
        exemption_id: exemptionId,
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'exemption.offer_confirm',
      record: { type: 'student', id: offer.student_id },
      oldValue: null,
      newValue: { offerId: id, exemptionId, ...coverValue(cover, offer.category) },
      details: effectDetails(settled, offer.student_id),
      ...(requestId === undefined ? {} : { requestId }),
    });
    const names = await studentNames(transaction, [offer.student_id]);
    await this.tell(transaction, access, offer.student_id, names, cover, null);
    return answer;
  }

  drop(access: Access, id: string, requestId: string | undefined): Promise<ExemptionMoveOffers> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const offer = await this.lockedOffer(transaction, branchId, id);
      await transaction
        .updateTable('exemption_move_offers')
        .set({
          decision: 'drop',
          decided_by: access.accountId,
          decided_at: await transactionMoment(transaction),
        })
        .where('id', '=', id)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'exemption.offer_drop',
        record: { type: 'student', id: offer.student_id },
        oldValue: { offerId: id },
        newValue: null,
        ...(requestId === undefined ? {} : { requestId }),
      });
      return offersIn(transaction, branchId);
    });
  }
}

// -----------------------------------------------------------------------------
// Helpers.

/** The offers of a branch move in the branch, undecided first (decision 3). */
async function offersIn(transaction: Transaction, branchId: string): Promise<ExemptionMoveOffers> {
  const rows = await transaction
    .selectFrom('exemption_move_offers')
    .innerJoin('student_branch_moves', 'student_branch_moves.id', 'exemption_move_offers.move_id')
    .select([
      'exemption_move_offers.id',
      'exemption_move_offers.student_id',
      'exemption_move_offers.kind',
      'exemption_move_offers.all_subjects',
      'exemption_move_offers.subject_ids',
      sql<string>`exemption_move_offers.start_date::text`.as('start_date'),
      sql<string>`exemption_move_offers.end_date::text`.as('end_date'),
      sql<string | null>`exemption_move_offers.start_time::text`.as('start_time'),
      sql<string | null>`exemption_move_offers.end_time::text`.as('end_time'),
      'exemption_move_offers.category',
      'exemption_move_offers.detail',
      'exemption_move_offers.document_key',
      'exemption_move_offers.decision',
      'exemption_move_offers.decided_at',
      'exemption_move_offers.exemption_id',
      'student_branch_moves.from_branch_id',
      sql<string>`student_branch_moves.effective_on::text`.as('moved_on'),
    ])
    .where('exemption_move_offers.branch_id', '=', branchId)
    .orderBy(sql`exemption_move_offers.decision is not null`)
    .orderBy('exemption_move_offers.offered_at', 'desc')
    .limit(500)
    .execute();
  const fromIds = [...new Set(rows.map((row) => row.from_branch_id))];
  const fromNames =
    fromIds.length === 0
      ? []
      : await transaction
          .selectFrom('branches')
          .select(['id', 'name'])
          .where('id', 'in', fromIds)
          .execute();
  const branchName = new Map(fromNames.map((row) => [row.id, row.name]));
  const subjects = await subjectNames(
    transaction,
    rows.flatMap((row) => row.subject_ids),
  );
  const students = await studentsOf(
    transaction,
    rows.map((row) => ({ id: row.student_id, on: row.start_date })),
  );
  return {
    items: rows.flatMap((row) => {
      const student = students.get(`${row.student_id}|${row.start_date}`);
      if (student === undefined) return [];
      return [
        {
          id: row.id,
          student,
          fromBranch: branchName.get(row.from_branch_id) ?? '—',
          movedOn: row.moved_on,
          kind: exemptionKindSchema.parse(row.kind),
          subjects: row.all_subjects
            ? null
            : row.subject_ids.map((subjectId) => ({
                id: subjectId,
                name: subjects.get(subjectId) ?? { uz: '—', ru: '—', en: '—' },
              })),
          startDate: row.start_date,
          endDate: row.end_date,
          slots: slotsOf({ startTime: timeOf(row.start_time), endTime: timeOf(row.end_time) }),
          category: exemptionCategorySchema.parse(row.category),
          detail: row.detail,
          hasDocument: row.document_key !== null,
          decision: row.decision === null ? null : (row.decision as 'confirm' | 'drop'),
          decidedAt: row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
          exemptionId: row.exemption_id,
        },
      ];
    }),
  };
}

function overlapRefusal(
  studentId: string,
  met: { id: string; start_date: string; end_date: string; version: number },
): ApiException {
  return new ApiException('exemption_overlap', 409, undefined, [
    {
      path: `studentIds.${studentId}`,
      code: 'exemption_overlap',
      message: 'Another exemption of the student covers that time.',
      recordId: studentId,
      exemption: {
        id: met.id,
        startDate: met.start_date,
        endDate: met.end_date,
        version: met.version,
      },
    },
  ]);
}

function previewAnswer(
  settled: Settled,
  studentIds: readonly string[],
  yearEnd: string,
): ExemptionPreview {
  return {
    yearEnd,
    students: [...new Set(studentIds)].map((studentId) => {
      const effect = settled.effects.get(studentId);
      return {
        studentId,
        auto: effect?.auto ?? [],
        choose: effect?.choose ?? [],
        reopen: effect?.reopen ?? [],
        overlap: null,
      };
    }),
  };
}

/** What the audit entry keeps of the change's effect on the cells: lessons by id only. */
function effectDetails(settled: Settled, studentId: string): Record<string, JsonValue> {
  const effect = settled.effects.get(studentId);
  return {
    autoLessons: (effect?.auto ?? []).map((one) => one.lessonId),
    chosenLessons: (effect?.choose ?? []).map((one) => one.lessonId),
    reopenedLessons: (effect?.reopen ?? []).map((one) => one.lessonId),
  };
}

const coverValue = (cover: Cover, category: string): Record<string, JsonValue> => ({
  kind: cover.kind,
  subjectIds: cover.allSubjects ? null : [...cover.subjectIds],
  startDate: cover.startDate,
  endDate: cover.endDate,
  slots: slotsOf(cover),
  category,
});

async function studentNames(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('students')
    .select(['id', 'first_name', 'last_name'])
    .where('id', 'in', [...new Set(ids)])
    .execute();
  return new Map(rows.map((row) => [row.id, `${row.last_name} ${row.first_name}`.trim()]));
}

async function subjectNames(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, { uz: string; ru: string; en: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('subjects')
    .select(['id', 'name_uz', 'name_ru', 'name_en'])
    .where('id', 'in', [...new Set(ids)])
    .execute();
  return new Map(
    rows.map((row) => [row.id, { uz: row.name_uz, ru: row.name_ru, en: row.name_en }]),
  );
}

/** The students named, each with the class they were in on the date (or `null`). */
export async function studentsOf(
  transaction: Transaction,
  wanted: readonly { id: string; on: string }[],
): Promise<Map<string, Exemption['student']>> {
  if (wanted.length === 0) return new Map();
  const ids = [...new Set(wanted.map((one) => one.id))];
  const rows = await transaction
    .selectFrom('students')
    .select(['id', 'uid', 'first_name', 'last_name', 'paternal_name'])
    .where('id', 'in', ids)
    .execute();
  const classes = await transaction
    .selectFrom('class_memberships')
    .innerJoin('classes', 'classes.id', 'class_memberships.class_id')
    .select([
      'class_memberships.student_id',
      sql<string>`class_memberships.valid_from::text`.as('from'),
      sql<string>`class_memberships.valid_until::text`.as('until'),
      'classes.grade',
      'classes.name',
    ])
    .where('class_memberships.student_id', 'in', ids)
    .whereRef('class_memberships.valid_from', '<', 'class_memberships.valid_until')
    .execute();
  const answer = new Map<string, Exemption['student']>();
  for (const one of wanted) {
    const row = rows.find((candidate) => candidate.id === one.id);
    if (row === undefined) continue;
    const of = classes.filter((candidate) => candidate.student_id === one.id);
    const inClass =
      of.find((candidate) => candidate.from <= one.on && one.on < candidate.until) ??
      of.sort((a, b) => b.from.localeCompare(a.from))[0];
    answer.set(`${one.id}|${one.on}`, {
      id: row.id,
      uid: row.uid,
      firstName: row.first_name,
      lastName: row.last_name,
      paternalName: row.paternal_name,
      className: inClass === undefined ? null : classDisplayName(inClass.grade, inClass.name),
    });
  }
  return answer;
}

/** The exemptions named, of the branch, as the routes answer them, in the order given. */
export async function exemptionsOf(
  transaction: Transaction,
  branchId: string,
  ids: readonly string[],
): Promise<Exemption[]> {
  if (ids.length === 0) return [];
  const rows = await transaction
    .selectFrom('exemptions')
    .select([
      ...STORED_COLUMNS,
      'granted_by',
      'granted_at',
      'voided_by',
      'void_cause',
      'void_reason',
      'end_cause',
      'moved_from_id',
    ])
    .where('id', 'in', [...ids])
    .where('branch_id', '=', branchId)
    .execute();
  const today = await todayIn(transaction, branchId);
  const subjects = await transaction
    .selectFrom('exemption_subjects')
    .innerJoin('subjects', 'subjects.id', 'exemption_subjects.subject_id')
    .select([
      'exemption_subjects.exemption_id',
      'subjects.id',
      'subjects.name_uz',
      'subjects.name_ru',
      'subjects.name_en',
    ])
    .where('exemption_subjects.exemption_id', 'in', [...ids])
    .orderBy('subjects.name_en')
    .execute();
  const accounts = await namedAccounts(
    transaction,
    rows.flatMap((row) => [row.granted_by, row.voided_by]),
  );
  const students = await studentsOf(
    transaction,
    rows.map((row) => ({
      id: row.student_id,
      on: row.start_date > today ? row.start_date : today,
    })),
  );
  const named = (id: string) => accounts.get(id) ?? { accountId: id, login: null, name: null };
  const byId = new Map(
    rows.flatMap((row) => {
      const student = students.get(
        `${row.student_id}|${row.start_date > today ? row.start_date : today}`,
      );
      if (student === undefined) return [];
      const value: Exemption = exemptionSchema.parse({
        id: row.id,
        batchId: row.batch_id,
        student,
        kind: row.kind,
        subjects: row.all_subjects
          ? null
          : subjects
              .filter((one) => one.exemption_id === row.id)
              .map((one) => ({
                id: one.id,
                name: { uz: one.name_uz, ru: one.name_ru, en: one.name_en },
              })),
        startDate: row.start_date,
        endDate: row.end_date,
        slots: slotsOf({ startTime: timeOf(row.start_time), endTime: timeOf(row.end_time) }),
        category: row.category,
        document:
          row.document_name === null || row.document_type === null
            ? null
            : { name: row.document_name, type: row.document_type },
        grantedBy: named(row.granted_by),
        grantedAt: new Date(row.granted_at).toISOString(),
        state:
          row.voided_at !== null
            ? 'voided'
            : today < row.start_date
              ? 'coming'
              : today > row.end_date
                ? 'ended'
                : 'in_force',
        endCause: row.end_cause,
        voided:
          row.voided_at === null || row.void_cause === null || row.voided_by === null
            ? null
            : {
                at: new Date(row.voided_at).toISOString(),
                by: named(row.voided_by),
                cause: row.void_cause,
                reason: row.void_reason,
              },
        movedFrom: row.moved_from_id !== null,
        version: row.version,
      });
      return [[row.id, value] as const];
    }),
  );
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** The type of a file sent, checked against its bytes, or the refusal. */
export function checkedFile(store: PhotoStore, file: UploadedFile | null): PlanFileType {
  if (!store.configured) throw new ApiException('files_not_configured', 503);
  if (file === null) throw new ApiException('unsupported_media_type', 415);
  const type = EXEMPTION_FILE_TYPES.find((one) => one === file.type);
  if (type === undefined || !fileMatchesType(file.bytes, type)) {
    throw new ApiException('exemption_file_type', 400);
  }
  return type;
}

export async function putStored(
  store: PhotoStore,
  key: string,
  file: UploadedFile | null,
  type: PlanFileType,
): Promise<void> {
  try {
    await store.put(key, file?.bytes ?? Buffer.alloc(0), type);
  } catch {
    throw new ApiException('files_unavailable', 503);
  }
}

export async function readStored(
  store: PhotoStore,
  key: string,
  type: string,
  name: string,
): Promise<StoredFile> {
  if (!store.configured) throw new ApiException('files_not_configured', 503);
  let content: Buffer;
  try {
    content = await store.get(key);
  } catch {
    throw new ApiException('files_unavailable', 503);
  }
  return new StoredFile(type, name, asciiOf(name), content);
}
