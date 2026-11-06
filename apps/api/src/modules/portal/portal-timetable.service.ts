import { Injectable } from '@nestjs/common';
import {
  portalWeekSchema,
  subjectColourSchema,
  type PortalDay,
  type PortalExam,
  type PortalLesson,
  type PortalWeek,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { TimetableViews } from '../timetable/views.service.js';
import { childUnits } from './child-units.js';
import { childWeekScope, inSpan, type ChildSpan } from './portal-scope.js';

/** The causes of a cancel by an exam (`06`, Exam; an exam week with no regular lessons). */
const EXAM_CAUSES: readonly string[] = ['exam', 'exam_week'];

/**
 * The timetable page of the portal (task 11.2, pull request #294; `10`, What parents see:
 * "The child's week, with rooms and teachers, and changes marked"). Read through the one view
 * builder of the timetable (`TimetableViews.childWeekIn`), each part of the week in the
 * branch of the child's class on those dates (decision 6), and answered in a narrow shape for
 * families: no staff id, no typed reason of a cancel, no lesson status (decision 7).
 */
@Injectable()
export class PortalTimetable {
  constructor(
    private readonly transactions: Transactions,
    private readonly views: TimetableViews,
  ) {}

  async week(accountId: string, studentId: string, date: string | undefined): Promise<PortalWeek> {
    const scope = await this.transactions.run([], (transaction) =>
      childWeekScope(transaction, accountId, studentId, date),
    );
    const days: PortalDay[] = [];
    const lessons: PortalLesson[] = [];
    const exams: PortalExam[] = [];
    for (const span of scope.spans) {
      const part = await this.transactions.run([span.branchId], (transaction) =>
        this.spanOf(transaction, accountId, studentId, span),
      );
      days.push(...part.days);
      lessons.push(...part.lessons);
      exams.push(...part.exams);
    }
    // A date with no class of the child (before it joined, after the year) is outside the
    // school year for the family: nothing is shown on it.
    for (const day of scope.dates) {
      if (!scope.spans.some((span) => inSpan(span, day))) {
        days.push({ date: day, outsideYear: true, dayOff: null });
      }
    }
    days.sort((a, b) => a.date.localeCompare(b.date));
    lessons.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    exams.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    return portalWeekSchema.parse({
      today: scope.today,
      monday: scope.dates[0] ?? scope.today,
      days,
      lessons,
      exams,
    });
  }

  private async spanOf(
    transaction: Transaction,
    accountId: string,
    studentId: string,
    span: ChildSpan,
  ): Promise<{ days: PortalDay[]; lessons: PortalLesson[]; exams: PortalExam[] }> {
    const units = await childUnits(transaction, studentId, span);
    const firstClass = units.classIds[0];
    if (firstClass === undefined) return { days: [], lessons: [], exams: [] };
    const keptOut = await keptOutLessons(transaction, units.classIds, span);
    const view = await this.views.childWeekIn(transaction, accountId, span.branchId, {
      date: span.from,
      classId: units.classOn(span.from) ?? firstClass,
      classOn: units.classOn,
      lesson: (lesson) =>
        inSpan(span, lesson.date) &&
        isChildLesson(lesson, units.classOn(lesson.date), units.groupsOn(lesson.date), keptOut),
      examRooms: (rooms, day) =>
        inSpan(span, day) ? childExamRooms(rooms, units.classOn(day), units.groupsOn(day)) : [],
    });
    const subjectIds = [
      ...new Set([
        ...view.lessons.map((one) => one.subject.id),
        ...view.exams.flatMap((one) => (one.subject === null ? [] : [one.subject.id])),
      ]),
    ];
    const colourOf = new Map(
      (subjectIds.length === 0
        ? []
        : await transaction
            .selectFrom('subjects')
            .select(['id', 'colour'])
            .where('id', 'in', subjectIds)
            .execute()
      ).map((one) => [one.id, one.colour]),
    );
    const subjectOf = (one: { id: string; names: { uz: string; ru: string; en: string } }) => ({
      id: one.id,
      names: one.names,
      colour: subjectColourSchema.parse(colourOf.get(one.id)),
    });
    return {
      days: view.days
        .filter((day) => inSpan(span, day.date))
        .map((day) => ({ date: day.date, outsideYear: day.outsideYear, dayOff: day.dayOff })),
      lessons: view.lessons.map((lesson) => ({
        date: lesson.date,
        start: lesson.start,
        end: lesson.end,
        lessonNumber: lesson.lessonNumber,
        subject: subjectOf(lesson.subject),
        // A vacancy is "to be named" like no teacher: its label is the school's (should-fix 6).
        teacher: lesson.teacher?.kind === 'person' ? lesson.teacher.name : null,
        room: lesson.room?.name ?? null,
        state:
          lesson.cancelCause !== null ? 'cancelled' : lesson.state === 'held' ? 'held' : 'planned',
        exam: lesson.cancelCause !== null && EXAM_CAUSES.includes(lesson.cancelCause),
        changed: lesson.changed,
      })),
      exams: view.exams.map((exam) => ({
        date: exam.date,
        start: exam.start,
        end: exam.end,
        title: exam.title,
        subject: exam.subject === null ? null : subjectOf(exam.subject),
        room: exam.rooms[0]?.room.name ?? null,
      })),
    };
  }
}

/**
 * Whether a lesson of the view is the child's on its date: its unit is the child's class, or a
 * group the child is in, and no standing exam keeps the child's class out of its block
 * (`edge/timetable`, Exams: the child sits the exam, not the lesson kept for the others).
 */
export function isChildLesson(
  lesson: { readonly id: string; readonly unit: { readonly kind: string; readonly id: string } },
  classId: string | undefined,
  groups: ReadonlySet<string>,
  keptOut: ReadonlySet<string>,
): boolean {
  if (classId !== undefined && keptOut.has(`${lesson.id}|${classId}`)) return false;
  return lesson.unit.kind === 'class' ? lesson.unit.id === classId : groups.has(lesson.unit.id);
}

/**
 * The room of an exam that holds the child: the one naming the child's class, or a group the
 * child is in, by the classes and groups the room names itself, never a group folded into its
 * classes, so a group's exam never reaches a classmate of another group (review must-fix 2b).
 */
export function childExamRooms<
  T extends { readonly ownClassIds: readonly string[]; readonly groupIds: readonly string[] },
>(rooms: readonly T[], classId: string | undefined, groups: ReadonlySet<string>): T[] {
  const room = rooms.find(
    (one) =>
      (classId !== undefined && one.ownClassIds.includes(classId)) ||
      one.groupIds.some((id) => groups.has(id)),
  );
  return room === undefined ? [] : [room];
}

/**
 * The lessons of the span a standing exam keeps a class of the child out of
 * (`lesson_block_class_outs`, 0060), as `<lesson>|<class>`; honoured only while the exam stands.
 */
async function keptOutLessons(
  transaction: Transaction,
  classIds: readonly string[],
  span: ChildSpan,
): Promise<ReadonlySet<string>> {
  if (classIds.length === 0) return new Set();
  const rows = await transaction
    .selectFrom('lessons')
    .innerJoin('lesson_block_class_outs as outs', 'outs.block_id', 'lessons.block_id')
    .innerJoin('exams', 'exams.id', 'outs.exam_id')
    .select(['lessons.id', 'outs.class_id'])
    .where('lessons.branch_id', '=', span.branchId)
    .where('outs.class_id', 'in', classIds)
    .where('exams.cancel_cause', 'is', null)
    .where(sql<boolean>`lessons.lesson_date >= ${span.from}::date`)
    .where(sql<boolean>`lessons.lesson_date < ${span.until}::date`)
    .execute();
  return new Set(rows.map((row) => `${row.id}|${row.class_id}`));
}
