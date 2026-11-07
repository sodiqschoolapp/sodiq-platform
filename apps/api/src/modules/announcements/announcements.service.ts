import { Injectable } from '@nestjs/common';
import {
  announcementListSchema,
  announcementMonthSchema,
  classDisplayName,
  monthDates,
  OWN_CLASS_ROLES,
  schoolDateOf,
  type Announcement,
  type AnnouncementEdit,
  type AnnouncementList,
  type AnnouncementMonth,
  type AnnouncementRecord,
  type AnnouncementsQuery,
  type AnnouncementView,
  type Role,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { JsonValue } from '../../database/types.generated.js';
import { RequestKeys } from '../../database/request-keys.js';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { tutorClassesAt } from '../access/class-scope.js';
import type { Access } from '../access/permission.guard.js';
import { taughtAt } from '../access/taught-scope.js';
import { Audit } from '../audit/audit.service.js';
import { portalChild } from '../portal/portal-scope.js';
import { notFound } from '../setup/setup-refusals.js';
import { announcementFanOutJob } from './announcement-jobs.js';

/**
 * Task 11.7 (pull request #306; `11`, Announcements and events). The authors' list and writes
 * under `announcements`, what is addressed to a staff member under `announcements_feed`, and the
 * portal's page of a child. `announcements` is a branch-or-school table (0163): a transaction of
 * the branch of the request reads that branch's rows and the school's.
 */

/** The roles that answer for every class and grade of their branch (plan decision 4). */
const BRANCH_WIDE_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
];

type Row = {
  id: string;
  branch_id: string | null;
  kind: string;
  title: string;
  body: string;
  audience: string;
  grades: number[] | null;
  for_staff: boolean;
  for_parents: boolean;
  first_date: string | null;
  last_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  place: string | null;
  published_at: Date;
  edited_at: Date | null;
  version: number;
  archived_at: Date | null;
};

const COLUMNS = sql`a.id, a.branch_id, a.kind, a.title, a.body, a.audience, a.grades, a.for_staff,
  a.for_parents, a.first_date::text as first_date, a.last_date::text as last_date,
  to_char(a.starts_at, 'HH24:MI') as starts_at, to_char(a.ends_at, 'HH24:MI') as ends_at,
  a.place, a.published_at, a.edited_at, a.version, a.archived_at`;

function viewOf(row: Row): AnnouncementView {
  return {
    id: row.id,
    kind: row.kind === 'event' ? 'event' : 'news',
    title: row.title,
    body: row.body,
    event:
      row.kind === 'event' && row.first_date !== null && row.last_date !== null
        ? {
            firstDate: row.first_date,
            lastDate: row.last_date,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            place: row.place,
          }
        : null,
    schoolWide: row.branch_id === null,
    publishedAt: row.published_at.toISOString(),
    editedAt: row.edited_at?.toISOString() ?? null,
  };
}

/** Whether any current assignment of the account is the Super Admin's. */
const writesSchool = (access: Access): boolean =>
  access.assignments.some((assignment) => assignment.role === 'super_admin');

const branchOf = (access: Access): string => {
  // A `@Requires` route without `branch: 'none'` always has the branch of the request.
  if (access.branchId === null) throw notFound();
  return access.branchId;
};

/** The event columns of a record or an edit. */
const eventColumns = (event: AnnouncementRecord['event']) => ({
  first_date: event?.firstDate ?? null,
  last_date: event?.lastDate ?? null,
  starts_at: event?.startsAt ?? null,
  ends_at: event?.endsAt ?? null,
  place: event?.place ?? null,
});

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
    private readonly requestKeys: RequestKeys,
  ) {}

  /** The authors' list: the branch's announcements and the school's, newest first. */
  list(access: Access, query: AnnouncementsQuery): Promise<AnnouncementList> {
    // No filter: every announcement, active and archived (the web's list filters by status).
    const archived = query.archived === undefined ? null : query.archived === 'true';
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rows = await sql<Row>`
        select ${COLUMNS} from announcements a
        where (${archived}::boolean is null or (a.archived_at is not null) = ${archived}::boolean)
        order by a.published_at desc, a.id
      `.execute(transaction);
      return announcementListSchema.parse({
        announcements: await this.withAudience(transaction, access, rows.rows),
        mayWriteSchool: writesSchool(access),
      });
    });
  }

  /** A new announcement, published at once (plan decision 11); its bot messages fanned out. */
  create(
    access: Access,
    record: AnnouncementRecord,
    key: string,
    requestId: string,
  ): Promise<Announcement> {
    const branchId = branchOf(access);
    // `11.7`, the owner's approval: a whole-school audience is the Super Admin's alone, decided
    // from every assignment (`.claude/rules/api.md`), before the request key.
    if (record.audience.kind === 'school' && !writesSchool(access)) {
      throw new ApiException('announcement_school_only', 403);
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      const classIds =
        record.audience.kind === 'classes'
          ? await this.checkClasses(transaction, record.audience.classIds)
          : [];
      const once = await this.requestKeys.runOnce(
        transaction,
        {
          key,
          scope: 'announcements.create',
          accountId: access.accountId,
          input: JSON.stringify(record),
        },
        async () => {
          const now = await transactionMoment(transaction);
          const made = await transaction
            .insertInto('announcements')
            .values({
              branch_id: record.audience.kind === 'school' ? null : branchId,
              kind: record.kind,
              title: record.title,
              body: record.body,
              audience: record.audience.kind,
              grades:
                record.audience.kind === 'grades'
                  ? [...record.audience.grades].sort((a, b) => a - b)
                  : null,
              for_staff: record.forStaff,
              for_parents: record.forParents,
              ...eventColumns(record.event),
              published_at: now,
              published_by: access.accountId,
            })
            .returning(['id', 'branch_id'])
            .executeTakeFirstOrThrow();
          if (classIds.length > 0) {
            await transaction
              .insertInto('announcement_classes')
              .values(
                classIds.map((classId) => ({
                  announcement_id: made.id,
                  class_id: classId,
                  branch_id: branchId,
                })),
              )
              .execute();
          }
          await this.audit.record(transaction, {
            branchId: made.branch_id,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'announcement.create',
            record: { type: 'announcement', id: made.id },
            newValue: { ...record, audience: { ...record.audience } } as unknown as JsonValue,
            requestId,
          });
          // `CLAUDE.md`, Jobs in the same transaction: the messages of the bot.
          if (record.forParents) {
            await this.jobs.enqueue(transaction, announcementFanOutJob, {
              branchIds: [],
              data: { announcementId: made.id },
            });
          }
          return { id: made.id };
        },
      );
      const id = (once.result as { id: string }).id;
      return this.one(transaction, access, id);
    });
  }

  /** The text and the event part (plan decision 5); the audience and the readers stay. */
  edit(
    access: Access,
    id: string,
    change: AnnouncementEdit,
    requestId: string,
  ): Promise<Announcement> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.locked(transaction, access, id, change.version);
      if (row.archived_at !== null) throw new ApiException('announcement_archived', 409);
      if ((row.kind === 'event') !== (change.event !== null)) {
        throw new ApiException('validation_failed', 400, undefined, [
          {
            path: 'event',
            code: 'custom',
            message:
              row.kind === 'event' ? 'An event has dates.' : 'News has no dates.',
          },
        ]);
      }
      const now = await transactionMoment(transaction);
      await transaction
        .updateTable('announcements')
        .set({
          title: change.title,
          body: change.body,
          ...eventColumns(change.event),
          edited_at: now,
          edited_by: access.accountId,
          version: row.version + 1,
        })
        .where('id', '=', row.id)
        .execute();
      await this.audit.record(transaction, {
        branchId: row.branch_id,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'announcement.edit',
        record: { type: 'announcement', id: row.id },
        oldValue: {
          title: row.title,
          body: row.body,
          event: viewOf(row).event,
        } as unknown as JsonValue,
        newValue: { title: change.title, body: change.body, event: change.event } as JsonValue,
        requestId,
      });
      return this.one(transaction, access, row.id);
    });
  }

  /** Archive: the messages still due are withdrawn (plan decision 6). */
  archive(access: Access, id: string, version: number, requestId: string): Promise<Announcement> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.locked(transaction, access, id, version);
      if (row.archived_at !== null) return this.one(transaction, access, row.id);
      const now = await transactionMoment(transaction);
      await transaction
        .updateTable('announcements')
        .set({ archived_at: now, archived_by: access.accountId, version: row.version + 1 })
        .where('id', '=', row.id)
        .execute();
      const withdrawn = await transaction
        .updateTable('announcement_deliveries')
        .set({ status: 'withdrawn' })
        .where('announcement_id', '=', row.id)
        .where('status', '=', 'due')
        .executeTakeFirst();
      await this.audit.record(transaction, {
        branchId: row.branch_id,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'announcement.archive',
        record: { type: 'announcement', id: row.id },
        details: { withdrawn: Number(withdrawn.numUpdatedRows) },
        requestId,
      });
      return this.one(transaction, access, row.id);
    });
  }

  /** Restore: nothing is sent again (plan decision 6). */
  restore(access: Access, id: string, version: number, requestId: string): Promise<Announcement> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.locked(transaction, access, id, version);
      if (row.archived_at === null) return this.one(transaction, access, row.id);
      await transaction
        .updateTable('announcements')
        .set({ archived_at: null, archived_by: null, version: row.version + 1 })
        .where('id', '=', row.id)
        .execute();
      await this.audit.record(transaction, {
        branchId: row.branch_id,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'announcement.restore',
        record: { type: 'announcement', id: row.id },
        requestId,
      });
      return this.one(transaction, access, row.id);
    });
  }

  /**
   * What is addressed to the account in the branch of the request (plan decision 4): for staff,
   * active, and the whole school, or this branch, or for a branch-wide reader any grade or class
   * of it, or a grade or class the account teaches (the teaching load in force) or holds as its
   * Tutor or Class teacher.
   */
  addressed(access: Access, month: string | undefined): Promise<AnnouncementMonth> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await this.todayIn(transaction, branchId);
      const shown = month ?? today.slice(0, 7);
      const branchWide = access.assignments.some(
        (assignment) =>
          BRANCH_WIDE_READERS.includes(assignment.role) &&
          (assignment.branchId === null || assignment.branchId === branchId),
      );
      const classIds = branchWide ? [] : await this.ownClasses(transaction, access, branchId);
      const { first, last } = monthDates(shown);
      const rows = await sql<Row>`
        select ${COLUMNS} from announcements a
        join branches b on b.id = ${branchId}
        where a.for_staff
          and a.archived_at is null
          and (a.branch_id is null or a.branch_id = ${branchId})
          and (
            a.audience in ('school', 'branch')
            or ${branchWide}
            or (a.audience = 'grades' and exists (
              select 1 from classes c
              where c.id = any (${classIds}::uuid[]) and c.grade = any (a.grades)
            ))
            or (a.audience = 'classes' and exists (
              select 1 from announcement_classes ac
              where ac.announcement_id = a.id and ac.class_id = any (${classIds}::uuid[])
            ))
          )
          and ${inMonth(first, last)}
        order by coalesce(a.first_date, (a.published_at at time zone b.time_zone)::date), a.published_at, a.id
      `.execute(transaction);
      return announcementMonthSchema.parse({
        month: shown,
        today,
        announcements: rows.rows.map(viewOf),
      });
    });
  }

  /**
   * The portal's page of a child (`@PortalChild()`): the child scope read first, the same 404
   * for every refusal (`portal-scope.ts`); then, in the child's branch, what is for parents and
   * reaches the child today: the whole school, the child's branch, its branch and grade (spec
   * review should-fix 2), its class.
   */
  async portal(
    accountId: string,
    studentId: string,
    month: string | undefined,
  ): Promise<AnnouncementMonth> {
    const place = await this.transactions.run([], async (transaction) => {
      const child = await portalChild(transaction, accountId, studentId);
      const at = await transactionMoment(transaction);
      const found = await sql<{ class_id: string | null; class_grade: number | null }>`
        select class_id, class_grade from portal_children(${accountId}::uuid, ${at})
        where student_id = ${child.id}::uuid
      `.execute(transaction);
      return {
        branchId: child.branchId,
        classId: found.rows[0]?.class_id ?? null,
        grade: found.rows[0]?.class_grade ?? null,
      };
    });
    return this.transactions.run([place.branchId], async (transaction) => {
      const today = await this.todayIn(transaction, place.branchId);
      const shown = month ?? today.slice(0, 7);
      const { first, last } = monthDates(shown);
      const rows = await sql<Row>`
        select ${COLUMNS} from announcements a
        join branches b on b.id = ${place.branchId}
        where a.for_parents
          and a.archived_at is null
          and (
            a.audience = 'school'
            or (a.branch_id = ${place.branchId} and (
              a.audience = 'branch'
              or (a.audience = 'grades' and ${place.grade}::smallint = any (a.grades))
              or (a.audience = 'classes' and exists (
                select 1 from announcement_classes ac
                where ac.announcement_id = a.id and ac.class_id = ${place.classId}::uuid
              ))
            ))
          )
          and ${inMonth(first, last)}
        order by coalesce(a.first_date, (a.published_at at time zone b.time_zone)::date), a.published_at, a.id
      `.execute(transaction);
      return announcementMonthSchema.parse({
        month: shown,
        today,
        announcements: rows.rows.map(viewOf),
      });
    });
  }

  private async todayIn(transaction: Transaction, branchId: string): Promise<string> {
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    return schoolDateOf(await transactionMoment(transaction), branch.time_zone);
  }

  /** The classes the account teaches (load in force, its groups' classes) or holds as Tutor. */
  private async ownClasses(
    transaction: Transaction,
    access: Access,
    branchId: string,
  ): Promise<string[]> {
    const taught = await taughtAt(transaction, access.accountId, branchId);
    const fromGroups =
      taught.groupIds.length === 0
        ? []
        : await transaction
            .selectFrom('group_classes')
            .select('class_id')
            .where('group_id', 'in', taught.groupIds)
            .execute();
    const tutors = await tutorClassesAt(
      transaction,
      access.assignments
        .filter(
          (assignment) =>
            OWN_CLASS_ROLES.some((role) => role === assignment.role) &&
            assignment.branchId === branchId,
        )
        .map((assignment) => assignment.id),
    );
    return [
      ...new Set([
        ...taught.classIds,
        ...fromGroups.map((row) => row.class_id.toLowerCase()),
        ...[...tutors.values()].flat(),
      ]),
    ].sort();
  }

  /**
   * The classes of a new announcement: of the branch of the request (the row filter: another
   * branch's or an unknown id is 404), active and of a year not closed (422).
   */
  private async checkClasses(transaction: Transaction, ids: readonly string[]): Promise<string[]> {
    const wanted = [...new Set(ids.map((id) => id.toLowerCase()))].sort();
    const found = await transaction
      .selectFrom('classes')
      .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
      .select(['classes.id', 'classes.archived_at', 'academic_years.status'])
      .where('classes.id', 'in', wanted)
      .forShare('classes')
      .execute();
    if (found.length !== wanted.length) throw notFound();
    if (found.some((row) => row.archived_at !== null || row.status === 'closed')) {
      throw new ApiException('announcement_class_unavailable', 422);
    }
    return wanted;
  }

  /**
   * The row of a change, locked: another branch's or an unknown id is 404 (the row filter); a
   * whole-school one is the Super Admin's alone (403); a version read before another change is
   * 409.
   */
  private async locked(
    transaction: Transaction,
    access: Access,
    id: string,
    version: number,
  ): Promise<Row> {
    const found = await sql<Row>`
      select ${COLUMNS} from announcements a where a.id = ${id}::uuid for update
    `.execute(transaction);
    const row = found.rows[0];
    if (row === undefined) throw notFound();
    if (row.branch_id === null && !writesSchool(access)) {
      throw new ApiException('announcement_school_only', 403);
    }
    if (row.version !== version) throw new ApiException('announcement_changed', 409);
    return row;
  }

  private async one(transaction: Transaction, access: Access, id: string): Promise<Announcement> {
    const found =
      await sql<Row>`select ${COLUMNS} from announcements a where a.id = ${id}::uuid`.execute(
        transaction,
      );
    const [one] = await this.withAudience(transaction, access, found.rows);
    if (one === undefined) throw notFound();
    return one;
  }

  /** The authors' rows: audience with class names, delivery counts, whether this author may change it. */
  private async withAudience(
    transaction: Transaction,
    access: Access,
    rows: readonly Row[],
  ): Promise<Announcement[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const classes = await transaction
      .selectFrom('announcement_classes')
      .innerJoin('classes', 'classes.id', 'announcement_classes.class_id')
      .select([
        'announcement_classes.announcement_id',
        'classes.id',
        'classes.grade',
        'classes.name',
      ])
      .where('announcement_classes.announcement_id', 'in', ids)
      .orderBy('classes.grade')
      .orderBy('classes.name')
      .execute();
    const counts = await transaction
      .selectFrom('announcement_deliveries')
      .select((builder) => [
        'announcement_id',
        builder.fn.countAll<string>().filterWhere('status', '=', 'due').as('due'),
        builder.fn.countAll<string>().filterWhere('status', '=', 'delivered').as('delivered'),
        builder.fn
          .countAll<string>()
          .filterWhere('status', 'not in', ['due', 'delivered'])
          .as('not_delivered'),
      ])
      .where('announcement_id', 'in', ids)
      .groupBy('announcement_id')
      .execute();
    const school = writesSchool(access);
    return rows.map((row) => {
      const count = counts.find((one) => one.announcement_id === row.id);
      const audience =
        row.audience === 'grades'
          ? { kind: 'grades' as const, grades: row.grades ?? [] }
          : row.audience === 'classes'
            ? {
                kind: 'classes' as const,
                classes: classes
                  .filter((one) => one.announcement_id === row.id)
                  .map((one) => ({ id: one.id, name: classDisplayName(one.grade, one.name) })),
              }
            : { kind: row.audience === 'school' ? ('school' as const) : ('branch' as const) };
      return {
        ...viewOf(row),
        audience,
        forStaff: row.for_staff,
        forParents: row.for_parents,
        version: row.version,
        archived: row.archived_at !== null,
        canChange: row.branch_id !== null || school,
        deliveries: {
          due: Number(count?.due ?? 0),
          delivered: Number(count?.delivered ?? 0),
          notDelivered: Number(count?.not_delivered ?? 0),
        },
      };
    });
  }
}

/** News published in the month (in the reading branch's time) and events touching it. */
const inMonth = (first: string, last: string) => sql<boolean>`(
  (a.kind = 'news' and (a.published_at at time zone b.time_zone)::date between ${first}::date and ${last}::date)
  or (a.kind = 'event' and a.first_date <= ${last}::date and a.last_date >= ${first}::date)
)`;
