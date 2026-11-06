import { Injectable } from '@nestjs/common';
import {
  portalAttendanceWeekSchema,
  portalGradesSchema,
  subjectColourSchema,
  type PortalAttendanceWeek,
  type PortalGrades,
  type PortalMark,
  type PortalScore,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { StudentResultsService } from '../results/student-results.service.js';
import { childWeekScope, inSpan, portalChild } from './portal-scope.js';

/** A comment "visible to parents" with a body, by its target (decision 8). */
interface ParentsComment {
  readonly target: string;
  readonly lessonId: string | null;
  readonly workId: string | null;
  readonly body: string;
}

/**
 * Marks as a family reads them (`07`, Entering data; decision 7): 4 and 5, from an exemption in
 * force and worked out on read, are both `exempt`, never an absence (`07`, Effect on totals).
 */
const markOf = (mark: number | null): PortalMark => {
  switch (mark) {
    case null:
      return 'unmarked';
    case 1:
      return 'present';
    case 2:
      return 'late';
    case 0:
      return 'absent';
    case 3:
      return 'skipped';
    default:
      return 'exempt';
  }
};

/**
 * The comments "visible to parents" of the child on the lessons given, and on the rating exam
 * rows of the quarter and subjects given; filtered in SQL, so a staff-only comment, a cleared
 * one and another student's never leave the database (decision 8).
 */
async function parentsComments(
  transaction: Transaction,
  studentId: string,
  lessonIds: readonly string[],
): Promise<ParentsComment[]> {
  if (lessonIds.length === 0) return [];
  const rows = await transaction
    .selectFrom('journal_comments')
    .select(['target', 'lesson_id', 'work_id', 'body'])
    .where('student_id', '=', studentId)
    .where('visibility', '=', 'parents')
    .where('body', 'is not', null)
    .where('target', 'in', ['mark', 'work', 'note'])
    .where('lesson_id', 'in', [...lessonIds])
    .execute();
  return rows.flatMap((row) =>
    row.body === null
      ? []
      : [{ target: row.target, lessonId: row.lesson_id, workId: row.work_id, body: row.body }],
  );
}

/**
 * The Grades and Attendance pages of the parent portal (task 11.3, pull request #296; `10`,
 * What parents see). The child scope first, on every request (`portal-scope.ts`, 404 for any
 * refusal); then every figure, score and mark from the one staff reader
 * (`StudentResultsService`, `packages/calc` behind it), read as the family of the child reads
 * it (decision 1, Look first). Nothing is calculated here: this file only picks fields and joins
 * the comments visible to parents.
 */
@Injectable()
export class PortalGradesService {
  constructor(
    private readonly transactions: Transactions,
    private readonly results: StudentResultsService,
  ) {}

  async grades(
    accountId: string,
    studentId: string,
    quarterId: string | undefined,
  ): Promise<PortalGrades> {
    const child = await this.transactions.run([], (transaction) =>
      portalChild(transaction, accountId, studentId),
    );
    // Decision 3 (Look first): the results of the child's present branch.
    const found = await this.results.familyGrades(child.branchId, child.id, quarterId);
    const quarterShown = found.quarterId;
    const lessonIds = found.lessons.flatMap((one) => one.lessons.map((lesson) => lesson.lessonId));
    const comments = await this.transactions.run([child.branchId], async (transaction) => ({
      lessons: await parentsComments(transaction, child.id, lessonIds),
      rating:
        quarterShown === null
          ? []
          : await transaction
              .selectFrom('journal_comments')
              .innerJoin(
                'journal_rating_exams',
                'journal_rating_exams.id',
                'journal_comments.rating_exam_id',
              )
              .innerJoin('journals', 'journals.id', 'journal_rating_exams.journal_id')
              .select(['journals.subject_id', 'journal_comments.body'])
              .where('journal_comments.student_id', '=', child.id)
              .where('journal_comments.target', '=', 'rating')
              .where('journal_comments.visibility', '=', 'parents')
              .where('journal_comments.body', 'is not', null)
              .where('journal_rating_exams.quarter_id', '=', quarterShown)
              .orderBy('journal_comments.changed_at')
              .execute(),
    }));
    const workComment = new Map(
      comments.lessons
        .filter((one) => one.target === 'work')
        .map((one) => [`${one.lessonId ?? ''}|${one.workId ?? ''}`, one.body]),
    );
    const subjects = [];
    for (const subject of found.results.subjects) {
      const row = subject.quarters.find((one) => one.quarterId === quarterShown);
      if (row === undefined) continue;
      const lessons = found.lessons.find((one) => one.subject.id === subject.subject.id);
      const scores: PortalScore[] = [];
      for (const lesson of lessons?.lessons ?? []) {
        for (const [kind, works] of [
          ['classwork', lesson.classworks],
          ['homework', lesson.homeworks],
        ] as const) {
          for (const work of works) {
            // An empty or "not graded" cell is no score (decision 12).
            if (work.score === null || work.percent === null) continue;
            scores.push({
              date: lesson.date,
              kind,
              title: work.title,
              position: work.position,
              score: work.score,
              total: work.total,
              percent: work.percent,
              comment: workComment.get(`${lesson.lessonId}|${work.workId}`) ?? null,
            });
          }
        }
      }
      subjects.push({
        subject: {
          id: subject.subject.id,
          names: subject.subject.names,
          colour: subjectColourSchema.parse(subject.subject.colour),
        },
        attendanceOnly: false,
        figures: {
          attendance: row.attendance,
          classwork: row.classwork,
          homework: row.homework,
          ratingExam: row.ratingExam,
          ratingShown: row.ratingShown,
          outcome: row.outcome,
          basedOn: row.basedOn,
          countsFrom: row.countsFrom,
          leftSubjectOn: row.leftSubjectOn,
          atLeaving: row.atLeaving,
        },
        attendance: null,
        year: subject.year,
        scores,
        rating: lessons?.ratingExam ?? null,
        ratingComments: comments.rating
          .filter((one) => one.subject_id === subject.subject.id)
          .flatMap((one) => (one.body === null ? [] : [one.body])),
      });
    }
    // Review correction 1: an attendance-only subject with its attendance figure, no result.
    for (const subject of found.attendance.subjects) {
      const row = subject.quarters.find((one) => one.quarterId === quarterShown);
      if (row === undefined || !row.attendanceOnly) continue;
      subjects.push({
        subject: {
          id: subject.subject.id,
          names: subject.subject.names,
          colour: subjectColourSchema.parse(subject.subject.colour),
        },
        attendanceOnly: true,
        figures: null,
        attendance: row.average,
        year: null,
        scores: [],
        rating: null,
        ratingComments: [],
      });
    }
    subjects.sort((a, b) => a.subject.names.en.localeCompare(b.subject.names.en, 'en'));
    return portalGradesSchema.parse({
      quarters: found.results.quarters.map((quarter) => ({
        id: quarter.id,
        number: quarter.number,
        startDate: quarter.startDate,
        endDate: quarter.endDate,
        closed: quarter.closed,
        notInSystem: quarter.notInSystem,
        notOfficial: quarter.notOfficial,
      })),
      quarterId: quarterShown,
      subjects,
    });
  }

  async attendance(
    accountId: string,
    studentId: string,
    date: string | undefined,
  ): Promise<PortalAttendanceWeek> {
    const scope = await this.transactions.run([], (transaction) =>
      childWeekScope(transaction, accountId, studentId, date),
    );
    const first = scope.dates[0] ?? scope.today;
    const last = scope.dates[scope.dates.length - 1] ?? scope.today;
    const lessons = [];
    // Each date in the branch of the child's class membership on that date (11.2 decision 6).
    for (const span of scope.spans) {
      const found = (
        await this.results.familyLessons(span.branchId, scope.child.id, first, last)
      ).filter((one) => inSpan(span, one.date));
      if (found.length === 0) continue;
      const ids = found.map((one) => one.lessonId);
      const read = await this.transactions.run([span.branchId], async (transaction) => {
        const branch = await transaction
          .selectFrom('branches')
          .select('time_zone')
          .where('id', '=', span.branchId)
          .executeTakeFirstOrThrow();
        const times = await sql<{ id: string; start_minutes: number; end_minutes: number }>`
          select l.id,
            (extract(epoch from (l.starts_at at time zone ${branch.time_zone})
              - (l.starts_at at time zone ${branch.time_zone})::date::timestamp) / 60)::int as start_minutes,
            (extract(epoch from (l.ends_at at time zone ${branch.time_zone})
              - (l.starts_at at time zone ${branch.time_zone})::date::timestamp) / 60)::int as end_minutes
          from lessons l
          where l.id = any(${ids}::uuid[])
        `.execute(transaction);
        return {
          times: new Map(times.rows.map((row) => [row.id, row])),
          comments: await parentsComments(transaction, scope.child.id, ids),
        };
      });
      const commentOf = (target: string, lessonId: string) =>
        read.comments.find((one) => one.target === target && one.lessonId === lessonId)?.body ??
        null;
      for (const one of found) {
        const time = read.times.get(one.lessonId);
        if (time === undefined) continue;
        lessons.push({
          date: one.date,
          start: time.start_minutes,
          end: time.end_minutes,
          subject: {
            id: one.subject.id,
            names: one.subject.names,
            colour: subjectColourSchema.parse(one.subject.colour),
          },
          mark: markOf(one.mark),
          comment: commentOf('mark', one.lessonId),
          note: commentOf('note', one.lessonId),
        });
      }
    }
    lessons.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.start - b.start ||
        a.subject.names.en.localeCompare(b.subject.names.en, 'en'),
    );
    return portalAttendanceWeekSchema.parse({
      today: scope.today,
      monday: first,
      lessons,
    });
  }
}
