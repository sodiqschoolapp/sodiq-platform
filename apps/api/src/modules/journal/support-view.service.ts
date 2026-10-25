import { Injectable } from '@nestjs/common';
import {
  journalSupportSchema,
  ratingEntryValueSchema,
  type AccountNamed,
  type JournalSupport,
  type JournalSupportQuery,
  type RatingEntryValue,
  type SupportLine,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { cellChange, lineValues, namedAccounts } from './cell-lines.query.js';
import { journalRows } from './journal-grid.query.js';
import { JournalGridReader } from './journal-grid.service.js';
import { workChangeSchema } from '@sodiq/shared';

/**
 * The support view of one student, journal and date (task 8.9, pull request
 * #227; `edge/journal`, "My grade disappeared": "A support view for one
 * student, journal and date shows every save, every refusal and every such
 * event in order, with how the result was calculated"). One transaction
 * reads the journal's grid as the reader's (the Super Admin's or the
 * Academic Vice Principal's, `journal_support`: every journal whole), the
 * lessons dated that date, the stored values, every history line of the
 * student's cells there, the refusals, the clears and give-backs of
 * exemptions, the voids and their give-backs, the work and delivery lines,
 * and the rating entry's lines on the exam's date (decision 13). The figures
 * are the grid's, which come from `packages/calc`: nothing is calculated
 * here. One audit entry per opening (decision 14). The student is found among
 * the grid's members of the quarter, a former member now in another branch
 * included (decision 15).
 */

const unknownAccount = (accountId: string): AccountNamed => ({
  accountId,
  login: null,
  name: null,
});

const VOID_SOURCES = [
  ['move_id', 'move'],
  ['leaving_id', 'leaving'],
  ['branch_move_id', 'branch_move'],
  ['return_status_id', 'return'],
  ['merge_id', 'merge'],
] as const;

function ratingValue(kind: string | null, score: number | null): RatingEntryValue | null {
  if (kind === null) return null;
  const parsed = ratingEntryValueSchema.safeParse(
    kind === 'score' ? { kind, score: score ?? 0 } : { kind },
  );
  return parsed.success ? parsed.data : null;
}

@Injectable()
export class SupportView {
  constructor(
    private readonly transactions: Transactions,
    private readonly grids: JournalGridReader,
    private readonly audit: Audit,
  ) {}

  read(access: Access, query: JournalSupportQuery, requestId: string): Promise<JournalSupport> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const [journal] = await journalRows(transaction, branchId, { journalId: query.journalId });
      if (journal === undefined) throw notFound();
      const quarter = await transaction
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', journal.academicYearId)
        .where('start_date', '<=', query.date)
        .where('end_date', '>=', query.date)
        .executeTakeFirst();
      if (quarter === undefined) throw new ApiException('journal_no_quarter', 409);
      const grid = await this.grids.gridIn(transaction, access, branchId, journal.id, {
        quarterId: quarter.id,
      });
      const studentId = query.studentId.toLowerCase();
      const student = grid.students.find((one) => one.id.toLowerCase() === studentId);
      if (student === undefined) throw notFound();
      const dated = grid.lessons.flatMap((lesson, index) =>
        lesson.date === query.date ? [{ lesson, index }] : [],
      );
      const lessonIds = dated.map((one) => one.lesson.id);
      const works = new Map(
        dated.flatMap(({ lesson }) =>
          [...lesson.works, ...lesson.notHeldWorks].flatMap((work) =>
            work.id === null ? [] : [[work.id, work] as const],
          ),
        ),
      );
      const lineWork = (workId: string | null) => {
        if (workId === null) return null;
        const work = works.get(workId);
        return work === undefined ? null : { id: workId, kind: work.kind, title: work.title };
      };
      const stored =
        lessonIds.length === 0
          ? []
          : await transaction
              .selectFrom('journal_cells')
              .select(['id', 'lesson_id', 'work_id', 'mark', 'score'])
              .where('lesson_id', 'in', lessonIds)
              .where('student_id', '=', student.id)
              .execute();
      const lessons = dated.map(({ lesson, index }) => {
        const cell = student.cells[index];
        if (cell === undefined) throw new Error('The grid has no cell for a lesson it lists.');
        const own = stored.filter((one) => one.lesson_id === lesson.id);
        const mark = own.find((one) => one.work_id === null)?.mark ?? null;
        const scores = own.flatMap((one) =>
          one.work_id === null ? [] : [{ workId: one.work_id, score: one.score }],
        );
        const holds = mark !== null || scores.some((one) => one.score !== null);
        // "and also what hid it": the exemption in force that day, by its kind and dates.
        const exemption =
          cell.exempt === null
            ? undefined
            : student.exemptions.find(
                (one) =>
                  one.kind === cell.exempt &&
                  one.startDate <= query.date &&
                  query.date <= one.endDate,
              );
        return {
          lesson,
          cell,
          stored: { mark, works: scores },
          hiddenBy:
            exemption === undefined || !holds
              ? null
              : {
                  kind: exemption.kind,
                  startDate: exemption.startDate,
                  endDate: exemption.endDate,
                },
        };
      });
      const ratingDate = grid.rating?.date ?? null;
      const onRatingDay = ratingDate === query.date;
      const lines = await this.linesOf(transaction, {
        journalId: journal.id,
        quarterId: quarter.id,
        studentId: student.id,
        lessonIds,
        cellIds: stored.map((one) => one.id),
        onRatingDay,
        lineWork,
      });
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'journal.support_view',
        record: { type: 'journal', id: journal.id },
        details: { studentId: student.id, date: query.date, lines: lines.length },
        requestId,
      });
      return journalSupportSchema.parse({
        student: {
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          paternalName: student.paternalName,
          uid: student.uid,
          folded: student.folded,
        },
        journal: { id: grid.journal.id, unit: grid.journal.unit, subject: grid.journal.subject },
        quarter: { id: grid.quarter.id, number: grid.quarter.number },
        date: query.date,
        lessons,
        figures: student.quarter,
        ratingDate,
        legend: grid.legend,
        lines,
      });
    });
  }

  private async linesOf(
    transaction: Transaction,
    scope: {
      journalId: string;
      quarterId: string;
      studentId: string;
      lessonIds: readonly string[];
      cellIds: readonly string[];
      onRatingDay: boolean;
      lineWork: (
        workId: string | null,
      ) => { id: string; kind: 'classwork' | 'homework'; title: string | null } | null;
    },
  ): Promise<SupportLine[]> {
    const { lessonIds, studentId } = scope;
    const hasLessons = lessonIds.length > 0;
    const cells = hasLessons
      ? await transaction
          .selectFrom('journal_cell_history')
          .selectAll()
          .where('lesson_id', 'in', [...lessonIds])
          .where('student_id', '=', studentId)
          .orderBy('changed_at')
          .orderBy('version')
          .execute()
      : [];
    const unlockIds = cells.flatMap((one) => (one.unlock_id === null ? [] : [one.unlock_id]));
    const unlocks =
      unlockIds.length === 0
        ? []
        : await transaction
            .selectFrom('journal_unlocks')
            .select(['id', 'decided_by'])
            .where('id', 'in', unlockIds)
            .execute();
    const approverOf = new Map(unlocks.map((one) => [one.id, one.decided_by]));
    const workHistory = hasLessons
      ? await transaction
          .selectFrom('journal_work_history')
          .selectAll()
          .where('lesson_id', 'in', [...lessonIds])
          .orderBy('changed_at')
          .orderBy('version')
          .execute()
      : [];
    // A work no longer shown on the date (removed, force-deleted, carried or moved away) is
    // still named by the kind its history keeps (0119), so none of its lines is lost.
    const unknown = [
      ...new Set(
        [...cells.map((one) => one.work_id), ...workHistory.map((one) => one.work_id)].filter(
          (id): id is string => id !== null && scope.lineWork(id) === null,
        ),
      ),
    ];
    const kinds = new Map(
      (unknown.length === 0
        ? []
        : await transaction
            .selectFrom('journal_work_history')
            .select(['work_id', 'kind'])
            .where('work_id', 'in', unknown)
            .execute()
      ).map((one) => [
        one.work_id,
        one.kind === 'homework' ? ('homework' as const) : ('classwork' as const),
      ]),
    );
    const lineWork = (workId: string | null) => {
      if (workId === null) return null;
      const shown = scope.lineWork(workId);
      if (shown !== null) return shown;
      const kind = kinds.get(workId);
      return kind === undefined ? null : { id: workId, kind, title: null };
    };
    const deliveries = hasLessons
      ? await transaction
          .selectFrom('journal_delivery_history')
          .selectAll()
          .where('lesson_id', 'in', [...lessonIds])
          .where('journal_id', '=', scope.journalId)
          .orderBy('changed_at')
          .execute()
      : [];
    let refusalQuery = transaction
      .selectFrom('journal_save_refusals')
      .selectAll()
      .where('journal_id', '=', scope.journalId)
      .where('student_id', '=', studentId);
    refusalQuery = refusalQuery.where((builder) =>
      builder.or([
        ...(hasLessons ? [builder('lesson_id', 'in', [...lessonIds])] : []),
        ...(scope.onRatingDay
          ? [
              builder.and([
                builder('kind', '=', 'rating'),
                builder('quarter_id', '=', scope.quarterId),
              ]),
            ]
          : []),
        // Nothing else: a refusal of another date is not this view's.
        sql<boolean>`false`,
      ]),
    );
    const refusals = await refusalQuery.orderBy('refused_at').execute();
    const clears = hasLessons
      ? await transaction
          .selectFrom('exemption_clears')
          .innerJoin('exemptions', 'exemptions.id', 'exemption_clears.exemption_id')
          .innerJoin('journal_cells', 'journal_cells.id', 'exemption_clears.cell_id')
          .select([
            'exemption_clears.id',
            'exemption_clears.cell_id',
            'exemption_clears.lesson_id',
            'exemption_clears.mark',
            'exemption_clears.score',
            'exemption_clears.cleared_version',
            'exemption_clears.given_back_at',
            'journal_cells.work_id',
            'exemptions.kind',
            sql<string>`exemptions.start_date::text`.as('start_date'),
            sql<string>`exemptions.end_date::text`.as('end_date'),
          ])
          .where('exemption_clears.lesson_id', 'in', [...lessonIds])
          .where('exemption_clears.student_id', '=', studentId)
          .execute()
      : [];
    // The moment of a clear is that of the history line its version wrote.
    const clearedAt = (cellId: string, version: number) =>
      cells.find((one) => one.cell_id === cellId && one.version === version)?.changed_at ?? null;
    const ratingEntry = scope.onRatingDay
      ? await transaction
          .selectFrom('journal_rating_entries')
          .innerJoin(
            'journal_rating_exams',
            'journal_rating_exams.id',
            'journal_rating_entries.rating_exam_id',
          )
          .select('journal_rating_entries.id')
          .where('journal_rating_exams.journal_id', '=', scope.journalId)
          .where('journal_rating_exams.quarter_id', '=', scope.quarterId)
          .where('journal_rating_entries.student_id', '=', studentId)
          .executeTakeFirst()
      : undefined;
    const voidTargets = [...scope.cellIds];
    const voids =
      voidTargets.length === 0 && ratingEntry === undefined
        ? []
        : await transaction
            .selectFrom('journal_voids')
            .selectAll()
            .where('student_id', '=', studentId)
            .where((builder) =>
              builder.or([
                ...(voidTargets.length === 0 ? [] : [builder('cell_id', 'in', voidTargets)]),
                ...(ratingEntry === undefined
                  ? []
                  : [builder('rating_entry_id', '=', ratingEntry.id)]),
              ]),
            )
            .orderBy('voided_at')
            .execute();
    const cellLessons = new Map(
      cells.map((one) => [one.cell_id, { lessonId: one.lesson_id, workId: one.work_id }]),
    );
    const ratingLines = scope.onRatingDay
      ? await transaction
          .selectFrom('journal_rating_history')
          .selectAll()
          .where('journal_id', '=', scope.journalId)
          .where('quarter_id', '=', scope.quarterId)
          .where('student_id', '=', studentId)
          .orderBy('changed_at')
          .orderBy('version')
          .execute()
      : [];
    const names = await namedAccounts(transaction, [
      ...cells.map((one) => one.changed_by),
      ...unlocks.map((one) => one.decided_by),
      ...workHistory.map((one) => one.changed_by),
      ...deliveries.map((one) => one.changed_by),
      ...refusals.map((one) => one.account_id),
      ...voids.flatMap((one) => [one.voided_by, one.given_back_by]),
      ...ratingLines.map((one) => one.changed_by),
    ]);
    const named = (id: string) => names.get(id) ?? unknownAccount(id);
    const at = (moment: Date | string) => new Date(moment).toISOString();
    const lines: SupportLine[] = [];
    for (const one of cells) {
      const approver = one.unlock_id === null ? null : (approverOf.get(one.unlock_id) ?? null);
      lines.push({
        kind: 'cell',
        at: at(one.changed_at),
        lessonId: one.lesson_id,
        work: lineWork(one.work_id),
        version: one.version,
        ...lineValues(one),
        notGradedBefore: one.not_graded_before,
        notGradedAfter: one.not_graded_after,
        how: cellChange(one.changed_how),
        by: named(one.changed_by),
        reason: one.reason,
        approvedBy: approver === null ? null : named(approver),
        orphanAssignment: one.orphan_assignment_id !== null,
      });
    }
    for (const one of workHistory) {
      const work = lineWork(one.work_id);
      if (work === null) continue;
      lines.push({
        kind: 'work',
        at: at(one.changed_at),
        lessonId: one.lesson_id,
        work,
        totalBefore: one.total_before,
        totalAfter: one.total_after,
        notHeldBefore: one.not_held_before,
        notHeldAfter: one.not_held_after,
        how: workChangeSchema.parse(one.changed_how),
        by: one.changed_by === null ? null : named(one.changed_by),
      });
    }
    for (const one of deliveries) {
      lines.push({
        kind: 'delivery',
        at: at(one.changed_at),
        lessonId: one.lesson_id,
        mark: one.kind === 'homework' ? 'homework' : 'topic',
        before: one.marked_before,
        after: one.marked_after,
        how: one.changed_how,
        by: one.changed_by === null ? null : named(one.changed_by),
      });
    }
    for (const one of refusals) {
      lines.push({
        kind: 'refusal',
        at: at(one.refused_at),
        lessonId: one.lesson_id,
        field: one.kind === 'rating' ? 'rating' : one.kind === 'score' ? 'score' : 'attendance',
        work: lineWork(one.work_id),
        valueSent: one.value_sent,
        versionSent: one.version_sent,
        code: one.code,
        by: named(one.account_id),
      });
    }
    for (const one of clears) {
      const value = one.work_id === null ? one.mark : one.score;
      if (value === null) continue;
      const exemption = {
        kind: one.kind === 'full' ? ('full' as const) : ('temporary' as const),
        startDate: one.start_date,
        endDate: one.end_date,
      };
      const moment = clearedAt(one.cell_id, one.cleared_version);
      if (moment !== null) {
        lines.push({
          kind: 'exemption_clear',
          at: at(moment),
          lessonId: one.lesson_id,
          work: lineWork(one.work_id),
          value,
          exemption,
        });
      }
      if (one.given_back_at !== null) {
        lines.push({
          kind: 'exemption_give_back',
          at: at(one.given_back_at),
          lessonId: one.lesson_id,
          work: lineWork(one.work_id),
          value,
          exemption,
        });
      }
    }
    for (const one of voids) {
      const source = VOID_SOURCES.find(([column]) => one[column] !== null)?.[1] ?? 'move';
      const target =
        one.cell_id !== null ? 'cell' : one.rating_entry_id !== null ? 'rating' : 'comment';
      const place = one.cell_id === null ? undefined : cellLessons.get(one.cell_id);
      const value = target === 'rating' ? one.score : (one.mark ?? one.score);
      const common = {
        lessonId: place?.lessonId ?? null,
        work: lineWork(place?.workId ?? null),
        target,
        value,
        source,
      } as const;
      lines.push({
        kind: 'void',
        at: at(one.voided_at),
        ...common,
        reason: one.reason,
        by: named(one.voided_by),
      });
      if (one.given_back_at !== null && one.given_back_by !== null) {
        lines.push({
          kind: 'void_give_back',
          at: at(one.given_back_at),
          ...common,
          by: named(one.given_back_by),
        });
      }
    }
    for (const one of ratingLines) {
      lines.push({
        kind: 'rating',
        at: at(one.changed_at),
        before: ratingValue(one.kind_before, one.score_before),
        after: ratingValue(one.kind_after, one.score_after),
        reason: one.reason,
        how: one.changed_how,
        by: named(one.changed_by),
      });
    }
    // Every line in time order; lines of one moment keep the order they were read in.
    return lines
      .map((line, index) => ({ line, index }))
      .sort((a, b) => a.line.at.localeCompare(b.line.at) || a.index - b.index)
      .map((one) => one.line);
  }
}
