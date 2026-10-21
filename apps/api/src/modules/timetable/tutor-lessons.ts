/**
 * Tutor lessons follow the Tutor (task 3.6c-2, pull request #125; owner's
 * answer 2 of 15 October 2026 and answer 1 of 16 October 2026 on issue #42;
 * docs/spec/edge-cases/timetable.md, Structure, "The Homework slot and
 * Ma'naviyat soati").
 *
 * "Their teacher is always the class's Tutor in force on the lesson's date
 * (the acting Tutor while one is set); nobody picks it by hand. When a class
 * gets a new Tutor, its future Ma'naviyat soati and Homework slot lessons go
 * to the new Tutor from that date, and held lessons keep the person who held
 * them. A new Tutor's appointment is never refused for a clash: the class's
 * Tutor lessons that clash with the new Tutor's other lessons, from the
 * appointment's start, ... go to 'needs a teacher'."
 *
 * One function, called in the transaction of every change of `class_tutors`
 * (a give, an end, an archive, a role end or its taking back, a leaving or its
 * taking back), and by a draft's start-date change and copy for the drafts
 * part. Each caller puts what it returns in its own audit entry (decision 2).
 */
import { checkTeacherTime, tutorAt, type Placement } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { readTutorRows, versionTutorMoment } from './load-facts.js';
import { substitutionsInForce } from './substitutions-read.js';

/** A busy time of the new Tutor that keeps a lesson from following (moments and branch only). */
export interface TutorClash {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly branchId: string;
}

/** What a follow changed; ids only go into an audit entry (`auditOf`). */
export interface TutorFollow {
  /** Lessons given to the Tutor in force at their start. */
  readonly moved: { lessonId: string; from: string | null; to: string }[];
  /** Lessons set to "needs a teacher": no Tutor then, or a clash (`clashes`). */
  readonly needsTeacher: { lessonId: string; from: string | null; clashes: TutorClash[] }[];
  /** Draft Tutor rows re-pointed to the Tutor of their version. */
  readonly draftRows: { rowId: string; versionId: string; from: string; to: string }[];
  /** Draft Tutor rows the database would not re-point (a status, a language); they show their problem. */
  readonly draftRowsKept: string[];
  /** Draft pattern entries removed because the new Tutor holds that time in the draft. */
  readonly draftEntriesRemoved: string[];
}

export const emptyFollow = (): TutorFollow => ({
  moved: [],
  needsTeacher: [],
  draftRows: [],
  draftRowsKept: [],
  draftEntriesRemoved: [],
});

/** Whether a follow changed anything. */
export const followChanged = (follow: TutorFollow): boolean =>
  follow.moved.length > 0 ||
  follow.needsTeacher.length > 0 ||
  follow.draftRows.length > 0 ||
  follow.draftRowsKept.length > 0 ||
  follow.draftEntriesRemoved.length > 0;

/** The part of an audit entry that names what a follow changed (ids only). */
export function auditOf(follow: TutorFollow) {
  return {
    moved: follow.moved.map(({ lessonId, from, to }) => ({ lessonId, from, to })),
    needsTeacher: follow.needsTeacher.map(({ lessonId, from }) => ({ lessonId, from })),
    draftRows: follow.draftRows.map(({ rowId, from, to }) => ({ rowId, from, to })),
    draftRowsKept: [...follow.draftRowsKept],
    draftEntriesRemoved: [...follow.draftEntriesRemoved],
  };
}

const EXCLUSION_VIOLATION = '23P01';
const CHECK_VIOLATION = '23514';

const codeOf = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;

/** Runs a write under a savepoint; a refusal of the database (`codes`) rolls it back and answers `false`. */
async function underSavepoint(
  transaction: Transaction,
  name: string,
  codes: readonly string[],
  write: () => Promise<void>,
): Promise<boolean> {
  await sql`savepoint ${sql.raw(name)}`.execute(transaction);
  try {
    await write();
  } catch (error) {
    if (!codes.includes(codeOf(error) ?? '')) {
      throw error;
    }
    await sql`rollback to savepoint ${sql.raw(name)}`.execute(transaction);
    return false;
  }
  await sql`release savepoint ${sql.raw(name)}`.execute(transaction);
  return true;
}

/**
 * The Tutor rows and Tutor lessons of the classes follow their Tutors.
 *
 * - Drafts (decision 5): every draft version of a class's year re-points its
 *   Tutor rows to the Tutor of the version (`tutorAt` at the last moment of
 *   the later of its start date and today). A pattern entry of the row that
 *   the new Tutor's other entries of the draft hold the time of is removed
 *   first; a row the database refuses stays as it is and is listed.
 * - Published versions keep their rows and entries (decision 6).
 * - Dated lessons (decisions 3, 4, 7, 8 and 12): each lesson of a Tutor row
 *   of the class, not cancelled, dated after today and starting at or after
 *   `from`, in the order of its start and id, takes the Tutor in force at its
 *   start; with none, or a clash of time or travel with the Tutor's other
 *   lessons and exams in every branch, it needs a teacher.
 *
 * The lessons are locked FOR UPDATE before `class_tutors` is read, in a
 * statement of its own, so a change of the same class's Tutors committed
 * first is seen (spec review of the plan, must-fix 3).
 */
export async function followTutors(
  transaction: Transaction,
  classIds: readonly string[],
  from: Date,
): Promise<TutorFollow> {
  const follow = emptyFollow();
  const wanted = [...new Set(classIds.map((id) => id.toLowerCase()))].sort();
  if (wanted.length === 0) {
    return follow;
  }
  await lockYearVersions(transaction, wanted);
  await followDrafts(transaction, wanted, null, follow);
  await followLessons(transaction, wanted, from, follow);
  return follow;
}

/**
 * Every version of the classes' years, drafts and published, `for no key
 * update` in the order of their id after the years `for share`: the locks a
 * publish takes before it reads the Tutors and writes the dated lessons
 * (task 5.5b-1, decision 11). A change of Tutor and a publish then run one
 * after the other: the later reads what the earlier wrote, the Tutors or the
 * lessons. A caller that follows several classes one by one takes it once
 * for all of them first (`followTutorEnds`, spec review should-fix 4).
 */
export async function lockYearVersions(
  transaction: Transaction,
  classIds: readonly string[],
): Promise<void> {
  if (classIds.length === 0) return;
  const years = await transaction
    .selectFrom('classes')
    .select('academic_year_id')
    .distinct()
    .where('id', 'in', classIds)
    .orderBy('academic_year_id')
    .execute();
  const yearIds = years.map((one) => one.academic_year_id);
  if (yearIds.length === 0) return;
  await transaction
    .selectFrom('academic_years')
    .select('id')
    .where('id', 'in', yearIds)
    .orderBy('id')
    .forShare()
    .execute();
  await transaction
    .selectFrom('timetable_versions')
    .select('id')
    .where('academic_year_id', 'in', yearIds)
    .orderBy('id')
    .forNoKeyUpdate()
    .execute();
}

/**
 * The drafts part alone, for one version (its start date changed, or it was
 * copied): its Tutor rows take the Tutor of the version.
 */
export async function followVersion(
  transaction: Transaction,
  versionId: string,
): Promise<TutorFollow> {
  const follow = emptyFollow();
  const classes = await transaction
    .selectFrom('teaching_load_rows')
    .select('class_id')
    .where('version_id', '=', versionId)
    .where('class_id', 'is not', null)
    .execute();
  const wanted = [
    ...new Set(classes.flatMap((row) => (row.class_id === null ? [] : [row.class_id]))),
  ].sort();
  if (wanted.length > 0) {
    await followDrafts(transaction, wanted, versionId, follow);
  }
  return follow;
}

async function followDrafts(
  transaction: Transaction,
  classIds: readonly string[],
  onlyVersion: string | null,
  follow: TutorFollow,
): Promise<void> {
  const versions = await transaction
    .selectFrom('timetable_versions')
    .innerJoin('classes', (join) =>
      join.onRef('classes.academic_year_id', '=', 'timetable_versions.academic_year_id'),
    )
    .select(['timetable_versions.id', 'timetable_versions.academic_year_id'])
    .distinct()
    .where('classes.id', 'in', classIds)
    .where('timetable_versions.status', '=', 'draft')
    .$if(onlyVersion !== null, (query) =>
      query.where('timetable_versions.id', '=', onlyVersion ?? ''),
    )
    .orderBy('timetable_versions.id')
    .execute();
  if (versions.length === 0) {
    return;
  }
  // The lock order of a load write: the year FOR SHARE, then the version FOR
  // NO KEY UPDATE (3.4a, 5.5a-3b-1), so an edit of the draft at the same moment waits or is
  // waited for.
  const years = [...new Set(versions.map((one) => one.academic_year_id))].sort();
  await transaction
    .selectFrom('academic_years')
    .select('id')
    .where('id', 'in', years)
    .orderBy('id')
    .forShare()
    .execute();
  await transaction
    .selectFrom('timetable_versions')
    .select('id')
    .where(
      'id',
      'in',
      versions.map((one) => one.id),
    )
    .orderBy('id')
    // Task 5.5a-3b-1, decision 8: a cause's foreign key is not blocked.
    .forNoKeyUpdate()
    .execute();
  const tutors = await readTutorRows(transaction, classIds);
  for (const version of versions) {
    const state = await transaction
      .selectFrom('timetable_versions')
      .innerJoin('branches', 'branches.id', 'timetable_versions.branch_id')
      .select(['timetable_versions.status', 'timetable_versions.starts_on', 'branches.time_zone'])
      .where('timetable_versions.id', '=', version.id)
      .executeTakeFirstOrThrow();
    if (state.status !== 'draft') continue;
    const statusOn = await statusDayOf(transaction, state.starts_on, state.time_zone);
    const moment = await versionTutorMoment(transaction, { statusOn, timeZone: state.time_zone });
    const rows = await transaction
      .selectFrom('teaching_load_rows')
      .innerJoin('subjects', 'subjects.id', 'teaching_load_rows.subject_id')
      .innerJoin('departments', 'departments.id', 'subjects.department_id')
      .select([
        'teaching_load_rows.id',
        'teaching_load_rows.class_id',
        'teaching_load_rows.subject_id',
        'teaching_load_rows.teacher_id',
      ])
      .where('teaching_load_rows.version_id', '=', version.id)
      .where('teaching_load_rows.class_id', 'in', classIds)
      .where('departments.tutors', '=', true)
      .orderBy('teaching_load_rows.id')
      .execute();
    // The subjects FOR KEY SHARE in the order of their id, as a load write
    // locks them (3.4c, decision 6): a subject leaving the Tutors department
    // at the same moment waits for the re-point or is waited for.
    const subjects = [...new Set(rows.map((row) => row.subject_id))].sort();
    if (subjects.length > 0) {
      await transaction
        .selectFrom('subjects')
        .select('id')
        .where('id', 'in', subjects)
        .orderBy('id')
        .forKeyShare()
        .execute();
    }
    for (const row of rows) {
      const target = tutorAt(tutors.get(row.class_id ?? '') ?? [], moment);
      // No Tutor: the row keeps its teacher and shows `load_no_tutor`.
      if (target === null || target === row.teacher_id) continue;
      // The entries of the row whose time the Tutor holds in the draft.
      const clashing = await sql<{ id: string }>`
        select e.id
        from pattern_entries e
        where e.load_row_id = ${row.id}
          and exists (
            select 1 from pattern_entries o
            where o.version_id = e.version_id
              and o.weekday = e.weekday
              and o.teacher_id = ${target}
              and o.load_row_id <> e.load_row_id
              and int4range(o.start_minutes, o.end_minutes)
                && int4range(e.start_minutes, e.end_minutes)
          )
        order by e.id
      `.execute(transaction);
      const removed = clashing.rows.map((one) => one.id);
      const done = await underSavepoint(
        transaction,
        'tutor_draft_row',
        [CHECK_VIOLATION, EXCLUSION_VIOLATION],
        async () => {
          if (removed.length > 0) {
            await transaction.deleteFrom('pattern_entries').where('id', 'in', removed).execute();
          }
          await transaction
            .updateTable('teaching_load_rows')
            .set({ teacher_id: target })
            .where('id', '=', row.id)
            .execute();
        },
      );
      if (done) {
        follow.draftRows.push({
          rowId: row.id,
          versionId: version.id,
          from: row.teacher_id,
          to: target,
        });
        follow.draftEntriesRemoved.push(...removed);
      } else {
        follow.draftRowsKept.push(row.id);
      }
    }
  }
}

/** The later of a start date and today in branch time (3.4a decision 11). */
async function statusDayOf(
  transaction: Transaction,
  startsOn: string,
  timeZone: string,
): Promise<string> {
  const now = await transactionMoment(transaction);
  const { rows } = await sql<{ day: string }>`
    select greatest(${startsOn}::date, (${now}::timestamptz at time zone ${timeZone})::date)::text as day
  `.execute(transaction);
  const day = rows[0]?.day;
  if (day === undefined) {
    throw new Error('statusDayOf: no answer');
  }
  return day;
}

interface LessonRow {
  id: string;
  branch_id: string;
  class_id: string;
  lesson_date: string;
  starts_at: Date;
  ends_at: Date;
  teacher_id: string | null;
  day_start: Date;
}

async function followLessons(
  transaction: Transaction,
  classIds: readonly string[],
  from: Date,
  follow: TutorFollow,
): Promise<void> {
  const now = await transactionMoment(transaction);
  // Decision 12: dated after today in the lesson's branch time, and from the
  // change's moment. The lessons FOR UPDATE in the order of their id.
  const lessons = await sql<LessonRow>`
    select l.id, l.branch_id, l.class_id, l.lesson_date::text as lesson_date, l.starts_at,
      l.ends_at, l.teacher_id,
      (l.lesson_date::timestamp at time zone b.time_zone) as day_start
    from lessons l
    join branches b on b.id = l.branch_id
    join subjects s on s.id = l.subject_id
    join departments d on d.id = s.department_id
    where l.class_id in (${sql.join(classIds)})
      and d.tutors
      and l.cancel_cause is null
      and l.starts_at >= ${from}
      and l.lesson_date > (${now}::timestamptz at time zone b.time_zone)::date
    order by l.id
    for update of l
  `.execute(transaction);
  if (lessons.rows.length === 0) {
    return;
  }
  // After the locks, in a statement of its own.
  const tutors = await readTutorRows(transaction, classIds);
  const travel = await readTravel(transaction);
  // Task 5.7b-1 (From 3.6c-2): a lesson with a substitution in force keeps its substitute.
  const substituted = await substitutionsInForce(
    transaction,
    lessons.rows.map((one) => ({ id: one.id, teacherId: one.teacher_id })),
  );
  const ordered = [...lessons.rows].filter((one) => !substituted.has(one.id)).sort(
    (a, b) => a.starts_at.getTime() - b.starts_at.getTime() || a.id.localeCompare(b.id),
  );
  for (const lesson of ordered) {
    const target = tutorAt(tutors.get(lesson.class_id) ?? [], lesson.starts_at);
    if (target === lesson.teacher_id) continue;
    if (target === null) {
      await setTeacher(transaction, lesson.id, null);
      follow.needsTeacher.push({ lessonId: lesson.id, from: lesson.teacher_id, clashes: [] });
      continue;
    }
    const clashes = await clashesOf(transaction, lesson, target, travel);
    if (clashes.length > 0) {
      await setTeacher(transaction, lesson.id, null);
      follow.needsTeacher.push({ lessonId: lesson.id, from: lesson.teacher_id, clashes });
      continue;
    }
    // The time-claim exclusion stays the guard: a clash written at the same
    // moment by another transaction refuses here, and the lesson needs a
    // teacher instead (the appointment is never refused for a clash).
    const given = await underSavepoint(transaction, 'tutor_lesson', [EXCLUSION_VIOLATION], () =>
      setTeacher(transaction, lesson.id, target),
    );
    if (given) {
      follow.moved.push({ lessonId: lesson.id, from: lesson.teacher_id, to: target });
    } else {
      await setTeacher(transaction, lesson.id, null);
      follow.needsTeacher.push({ lessonId: lesson.id, from: lesson.teacher_id, clashes: [] });
    }
  }
}

async function setTeacher(
  transaction: Transaction,
  lessonId: string,
  teacherId: string | null,
): Promise<void> {
  await transaction
    .updateTable('lessons')
    .set({ teacher_id: teacherId })
    .where('id', '=', lessonId)
    .execute();
}

/** The travel times of every pair of branches (`travel_times`, the lower id first). */
async function readTravel(
  transaction: Transaction,
): Promise<(a: string, b: string) => number | null> {
  const rows = await transaction
    .selectFrom('travel_times')
    .select(['branch_low', 'branch_high', 'minutes'])
    .execute();
  const pairs = new Map(rows.map((row) => [`${row.branch_low}|${row.branch_high}`, row.minutes]));
  return (a, b) => (a === b ? 0 : (pairs.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? null));
}

const MINUTE = 60_000;

/**
 * The Tutor's busy times of the lesson's day in every branch that keep it
 * from taking the lesson: the rule engine's teacher in one place and travel
 * time (decision 4), over the claims `teacher_claims_elsewhere` gives
 * (moments and branch only, decision 13).
 */
async function clashesOf(
  transaction: Transaction,
  lesson: LessonRow,
  teacherId: string,
  travelMinutes: (a: string, b: string) => number | null,
): Promise<TutorClash[]> {
  // The lesson's day in its branch time: travel time counts within a day.
  const dayBegin = lesson.day_start;
  const dayEnd = new Date(lesson.day_start.getTime() + 24 * 60 * MINUTE);
  const { rows } = await sql<{ starts_at: Date; ends_at: Date; branch_id: string }>`
    select starts_at, ends_at, branch_id
    from teacher_claims_elsewhere(
      ${lesson.branch_id}::uuid, ${teacherId}::uuid, ${dayBegin}::timestamptz, ${dayEnd}::timestamptz
    )
  `.execute(transaction);
  const minutesOf = (moment: Date) =>
    Math.round((moment.getTime() - lesson.day_start.getTime()) / MINUTE);
  const placement = (
    id: string,
    branchId: string,
    startsAt: Date,
    endsAt: Date,
    fixed: boolean,
  ): Placement => ({
    id,
    kind: 'lesson',
    branchId,
    day: lesson.lesson_date,
    start: minutesOf(startsAt),
    end: minutesOf(endsAt),
    blockId: null,
    doublePairId: null,
    classId: null,
    groupId: null,
    classIds: [],
    studentIds: [],
    exemptStudentIds: [],
    subjectId: null,
    loadRowId: null,
    teacherIds: [teacherId],
    substitute: false,
    roomId: null,
    examRooms: [],
    fixed,
  });
  const busy = rows.map((row, index) =>
    placement(`busy-${index}`, row.branch_id, row.starts_at, row.ends_at, true),
  );
  const results = checkTeacherTime(
    busy,
    placement(lesson.id, lesson.branch_id, lesson.starts_at, lesson.ends_at, false),
    travelMinutes,
  );
  const named = new Set(results.flatMap((result) => result.lessonIds));
  return rows
    .filter((_, index) => named.has(`busy-${index}`))
    .map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at, branchId: row.branch_id }));
}
