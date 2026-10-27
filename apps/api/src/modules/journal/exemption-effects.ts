import type { ErrorDetail, ExemptionChoice, ExemptionPreviewLesson } from '@sodiq/shared';
import { schoolDateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { notFound } from '../setup/setup-refusals.js';
import { accountOfStaff } from '../access/request-posts.js';
import type { Notifications } from '../notifications/notifications.service.js';

/**
 * What a change of exemptions does to the journal (task 8.5, pull request
 * #223; `07`, Problem cases; `edge/exemptions`, rows 1, 4 and 5; decision 2).
 *
 * Every writer of exemptions (create, edit, end, void, a batch, a confirmed
 * move offer) runs its write between `lockStudents` and `settle`:
 *
 * - `lockStudents` takes the students' cells `for update` in the order of
 *   `saveCells`, then their class and group rows `for no key update` in the
 *   order of the id, before anything is read: a cell save updates its cell
 *   first and its trigger (`journal_cells_write`, 0108) then takes the
 *   memberships `for share`, so a cell save and an exemption write never pass
 *   each other and never deadlock (the plan's lock, spec review of the plan
 *   must-fix 4; spec review of the code, must-fix 1). A cell inserted meanwhile
 *   waits at the memberships, and no writer here touches a cell it did not lock.
 * - `expectedIn` reads who is expected in the held lessons of the window,
 *   before the write and again after it (`lesson_student_expected`, 0123).
 * - `settle` compares the two: a lesson that stopped expecting the student and
 *   holds a "present" or "late" mark or a number needs a choice ("keep": a
 *   skip of the lesson; "exempt": its values cleared and kept in
 *   `exemption_clears`); a lesson that expects the student again gets back
 *   what an exemption cleared there, and its cells are stored as reopened
 *   (`edge/journal`, Locks).
 */

/** One student's window of dates, in the branch. */
export interface StudentWindow {
  readonly studentId: string;
  readonly from: string;
  readonly until: string;
}

/** A held lesson of a student's window, with the student's values there. */
export interface WindowLesson {
  readonly lessonId: string;
  readonly studentId: string;
  readonly date: string;
  readonly start: string;
  readonly subject: { uz: string; ru: string; en: string };
  readonly teacherId: string | null;
  readonly expected: boolean;
  readonly mark: number | null;
  readonly numbers: number;
  readonly locked: boolean;
}

export const NIL_SUBJECT = '00000000-0000-0000-0000-000000000000';

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The time zone of the branch. */
export async function zoneOfBranch(transaction: Transaction, branchId: string): Promise<string> {
  const row = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return row.time_zone;
}

/** Today in the branch, at the transaction's moment. */
export async function todayIn(transaction: Transaction, branchId: string): Promise<string> {
  return schoolDateOf(
    await transactionMoment(transaction),
    await zoneOfBranch(transaction, branchId),
  );
}

/**
 * Locks the students' journal cells of the years not closed `for update`, in
 * the order of `saveCells` (lesson, student, the attendance cell first, the
 * works by id), then their class and group rows `for no key update` in the
 * order of the id, each table in a statement of its own (see the file's
 * comment).
 */
export async function lockStudents(
  transaction: Transaction,
  studentIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(studentIds)].sort();
  if (ids.length === 0) return;
  await sql`
    select 1 from journal_cells c
    join lessons l on l.id = c.lesson_id
    where c.student_id = any(${ids}::uuid[])
      and exists (
        select 1 from academic_years y
        where y.branch_id = l.branch_id and y.status <> 'closed'
          and l.lesson_date between y.start_date and y.end_date
      )
    order by c.lesson_id, c.student_id, c.work_id nulls first
    for update of c
  `.execute(transaction);
  await sql`
    select 1 from class_memberships m
    where m.student_id = any(${ids}::uuid[])
    order by m.id
    for no key update
  `.execute(transaction);
  await sql`
    select 1 from group_memberships m
    where m.student_id = any(${ids}::uuid[])
    order by m.id
    for no key update
  `.execute(transaction);
}

/**
 * A choice names a lesson and a student by id in the body: a lesson the branch does not hold, a
 * student never a member of a class or a group of the branch, or an unknown one, is 404 before any
 * lock or write (permission review 9; `.claude/rules/api.md`: one 404 per body id). The student
 * is looked up by the memberships of the branch, as a choice is only needed where the student was
 * a member: one who has left the branch since still has them (task 10.3b). Both are read for
 * the branch of the request by name, not only through the row filter.
 */
export async function refuseForeignChoices(
  transaction: Transaction,
  branchId: string,
  choices: readonly ExemptionChoice[],
): Promise<void> {
  const ids = [...new Set(choices.map((one) => one.lessonId.toLowerCase()))];
  if (ids.length === 0) return;
  const found = await transaction
    .selectFrom('lessons')
    .select('id')
    .where('id', 'in', ids)
    .where('branch_id', '=', branchId)
    .execute();
  if (found.length !== ids.length) throw notFound();
  const students = [...new Set(choices.map((one) => one.studentId.toLowerCase()))];
  const members = await sql<{ student_id: string }>`
    select m.student_id from class_memberships m
    where m.branch_id = ${branchId}::uuid and m.student_id = any(${students}::uuid[])
    union
    select g.student_id from group_memberships g
    where g.branch_id = ${branchId}::uuid and g.student_id = any(${students}::uuid[])
  `.execute(transaction);
  if (members.rows.length !== students.length) throw notFound();
}

/**
 * The held lessons (started, not cancelled) of the branch in each student's
 * window where the student is a member on the date, with whether the student
 * is expected there now and the student's values.
 */
export async function expectedIn(
  transaction: Transaction,
  branchId: string,
  windows: readonly StudentWindow[],
): Promise<WindowLesson[]> {
  if (windows.length === 0) return [];
  const now = await transactionMoment(transaction);
  const found = await sql<{
    lesson_id: string;
    student_id: string;
    date: string;
    start: string;
    name_uz: string;
    name_ru: string;
    name_en: string;
    teacher_id: string | null;
    expected: boolean;
    mark: number | null;
    numbers: number;
    locked: boolean;
  }>`
    with windows as (
      select * from unnest(
        ${windows.map((one) => one.studentId)}::uuid[],
        ${windows.map((one) => one.from)}::date[],
        ${windows.map((one) => one.until)}::date[]
      ) as w(student_id, from_date, until_date)
    ),
    found as (
      select distinct l.id as lesson_id, w.student_id
      from windows w
      join lessons l on l.branch_id = ${branchId}::uuid
        and l.lesson_date between w.from_date and w.until_date
        and l.cancel_cause is null
        and l.starts_at <= ${now}::timestamptz
      where exists (
          select 1 from class_memberships m
          where m.class_id = l.class_id and m.student_id = w.student_id
            and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
        )
        or exists (
          select 1 from group_memberships m
          where m.group_id = l.group_id and m.student_id = w.student_id
            and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
        )
    )
    select f.lesson_id, f.student_id, l.lesson_date::text as date,
      to_char(l.starts_at at time zone b.time_zone, 'HH24:MI') as start,
      s.name_uz, s.name_ru, s.name_en, l.teacher_id,
      lesson_student_expected(f.lesson_id, f.student_id) as expected,
      (select c.mark from journal_cells c
        where c.lesson_id = f.lesson_id and c.student_id = f.student_id and c.work_id is null) as mark,
      (select count(*)::int from journal_cells c
        where c.lesson_id = f.lesson_id and c.student_id = f.student_id
          and c.work_id is not null and c.score is not null) as numbers,
      coalesce(journal_lesson_lock(f.lesson_id) <= ${now}::timestamptz, false) as locked
    from found f
    join lessons l on l.id = f.lesson_id
    join branches b on b.id = l.branch_id
    join subjects s on s.id = l.subject_id
    order by l.starts_at, f.lesson_id, f.student_id
  `.execute(transaction);
  return found.rows.map((row) => ({
    lessonId: row.lesson_id,
    studentId: row.student_id,
    date: row.date,
    start: row.start,
    subject: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
    teacherId: row.teacher_id,
    expected: row.expected,
    mark: row.mark,
    numbers: row.numbers,
    locked: row.locked,
  }));
}

const keyOf = (lessonId: string, studentId: string) => `${lessonId}|${studentId}`;

/** A choice is needed for a "present" or "late" mark, or any number (`07`, Problem cases). */
export const needsChoice = (lesson: WindowLesson): boolean =>
  lesson.mark === 1 || lesson.mark === 2 || lesson.numbers > 0;

const previewLesson = (lesson: WindowLesson): ExemptionPreviewLesson => ({
  lessonId: lesson.lessonId,
  date: lesson.date,
  start: lesson.start,
  subject: lesson.subject,
  mark: lesson.mark,
  numbers: lesson.numbers,
  locked: lesson.locked,
});

export interface StudentEffect {
  studentId: string;
  auto: ExemptionPreviewLesson[];
  choose: ExemptionPreviewLesson[];
  reopen: (ExemptionPreviewLesson & { givesBack: boolean })[];
}

export interface Settled {
  effects: Map<string, StudentEffect>;
  /** The lessons whose cells reopened in a locked lesson, by teacher, for the notice. */
  reopenedLocked: { teacherId: string | null; studentId: string; lessonId: string }[];
  cleared: number;
  givenBack: number;
  skipped: number;
}

/**
 * Compares who is expected before and after the write and settles it (see
 * the file's comment). `exemptionOf` names the exemption that takes a skip or
 * a clear of a student's lesson, and the one a reopened cell is stored under.
 * With `preview`, nothing is written and no choice is required.
 */
export async function settle(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly before: readonly WindowLesson[];
    readonly windows: readonly StudentWindow[];
    readonly choices: readonly ExemptionChoice[];
    readonly exemptionOf: (studentId: string, lessonId: string) => Promise<string | null>;
    readonly preview: boolean;
  },
): Promise<Settled> {
  const after = await expectedIn(transaction, input.branchId, input.windows);
  const afterOf = new Map(after.map((one) => [keyOf(one.lessonId, one.studentId), one]));
  const effects = new Map<string, StudentEffect>();
  const effectOf = (studentId: string) => {
    let found = effects.get(studentId);
    if (found === undefined) {
      found = { studentId, auto: [], choose: [], reopen: [] };
      effects.set(studentId, found);
    }
    return found;
  };
  for (const window of input.windows) effectOf(window.studentId);
  const choiceOf = new Map(
    input.choices.map((one) => [
      keyOf(one.lessonId.toLowerCase(), one.studentId.toLowerCase()),
      one,
    ]),
  );
  const covered: WindowLesson[] = [];
  const reopened: WindowLesson[] = [];
  for (const one of input.before) {
    const now = afterOf.get(keyOf(one.lessonId, one.studentId));
    if (now === undefined) continue;
    if (one.expected && !now.expected) covered.push(one);
    if (!one.expected && now.expected) reopened.push(now);
  }
  const missing: ErrorDetail[] = [];
  const used = new Set<string>();
  const toChoose = covered.filter(needsChoice);
  for (const lesson of covered) {
    const effect = effectOf(lesson.studentId);
    if (!needsChoice(lesson)) {
      effect.auto.push(previewLesson(lesson));
      continue;
    }
    effect.choose.push(previewLesson(lesson));
  }
  const settled: Settled = { effects, reopenedLocked: [], cleared: 0, givenBack: 0, skipped: 0 };
  if (input.preview) {
    for (const lesson of reopened) {
      effectOf(lesson.studentId).reopen.push({
        ...previewLesson(lesson),
        givesBack: await hasClears(transaction, lesson.lessonId, lesson.studentId),
      });
    }
    return settled;
  }
  for (const lesson of toChoose) {
    const key = keyOf(lesson.lessonId.toLowerCase(), lesson.studentId.toLowerCase());
    const choice = choiceOf.get(key);
    if (choice === undefined) {
      missing.push({
        path: `choices.${lesson.studentId}.${lesson.lessonId}`,
        code: 'exemption_choice_missing',
        message: 'A lesson with a present or late mark or a number needs a choice.',
        recordId: lesson.lessonId,
      });
      continue;
    }
    used.add(key);
  }
  if (missing.length > 0)
    throw new ApiException('exemption_choice_missing', 409, undefined, missing);
  const unknown = [...choiceOf.keys()].filter((key) => !used.has(key));
  if (unknown.length > 0) {
    throw new ApiException(
      'exemption_choice_unknown',
      409,
      undefined,
      unknown.map((key) => ({
        path: `choices.${key.replace('|', '.')}`,
        code: 'exemption_choice_unknown',
        message: 'A choice for a lesson that needs none.',
      })),
    );
  }
  // The choices, in the order of the lesson and the student (the order of `saveCells`).
  const ordered = [...toChoose].sort(
    (one, other) =>
      one.lessonId.localeCompare(other.lessonId) || one.studentId.localeCompare(other.studentId),
  );
  for (const lesson of ordered) {
    const choice = choiceOf.get(
      keyOf(lesson.lessonId.toLowerCase(), lesson.studentId.toLowerCase()),
    );
    const exemptionId = await input.exemptionOf(lesson.studentId, lesson.lessonId);
    if (choice === undefined || exemptionId === null) continue;
    if (choice.choice === 'keep') {
      await transaction
        .insertInto('exemption_skips')
        .values({
          branch_id: input.branchId,
          exemption_id: exemptionId,
          lesson_id: lesson.lessonId,
        })
        .onConflict((conflict) => conflict.columns(['exemption_id', 'lesson_id']).doNothing())
        .execute();
      settled.skipped += 1;
    } else {
      settled.cleared += await clearCells(
        transaction,
        input.branchId,
        exemptionId,
        lesson.lessonId,
        lesson.studentId,
      );
    }
  }
  // A skip makes the student expected again in that lesson: it is no cover.
  for (const lesson of reopened) {
    effectOf(lesson.studentId).reopen.push({
      ...previewLesson(lesson),
      givesBack: await hasClears(transaction, lesson.lessonId, lesson.studentId),
    });
    settled.givenBack += await giveBack(transaction, lesson.lessonId, lesson.studentId);
    const exemptionId = await input.exemptionOf(lesson.studentId, lesson.lessonId);
    if (exemptionId !== null) {
      await storeReopened(
        transaction,
        input.branchId,
        exemptionId,
        lesson.lessonId,
        lesson.studentId,
      );
    }
    if (lesson.locked) {
      settled.reopenedLocked.push({
        teacherId: lesson.teacherId,
        studentId: lesson.studentId,
        lessonId: lesson.lessonId,
      });
    }
  }
  return settled;
}

async function hasClears(
  transaction: Transaction,
  lessonId: string,
  studentId: string,
): Promise<boolean> {
  const found = await transaction
    .selectFrom('exemption_clears')
    .select('id')
    .where('lesson_id', '=', lessonId)
    .where('student_id', '=', studentId)
    .where('given_back_at', 'is', null)
    .executeTakeFirst();
  return found !== undefined;
}

/**
 * Clears the student's values of the lesson with `changed_how` `exemption`,
 * the attendance cell first and the works by id (the order of `saveCells`),
 * and keeps them in `exemption_clears`. Returns how many cells it cleared.
 */
async function clearCells(
  transaction: Transaction,
  branchId: string,
  exemptionId: string,
  lessonId: string,
  studentId: string,
): Promise<number> {
  const cells = await transaction
    .selectFrom('journal_cells')
    .select(['id', 'work_id', 'mark', 'score'])
    .where('lesson_id', '=', lessonId)
    .where('student_id', '=', studentId)
    .where((where) => where.or([where('mark', 'is not', null), where('score', 'is not', null)]))
    .orderBy(sql`work_id nulls first`)
    .orderBy('work_id')
    .forUpdate()
    .execute();
  for (const cell of cells) {
    const row = await transaction
      .updateTable('journal_cells')
      .set({
        mark: null,
        score: null,
        changed_by: await actorOf(transaction),
        changed_how: 'exemption',
      })
      .where('id', '=', cell.id)
      .returning('version')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('exemption_clears')
      .values({
        branch_id: branchId,
        exemption_id: exemptionId,
        cell_id: cell.id,
        lesson_id: lessonId,
        student_id: studentId,
        mark: cell.mark,
        score: cell.score,
        cleared_version: row.version,
      })
      .execute();
  }
  return cells.length;
}

/**
 * Gives back what exemptions cleared in the lesson for the student: each cell
 * not changed since its clear takes its value again (`changed_how`
 * `exemption`); a number the work no longer takes (a lower total, "not held")
 * stays cleared, and its row is given back all the same. Returns how many.
 */
async function giveBack(
  transaction: Transaction,
  lessonId: string,
  studentId: string,
): Promise<number> {
  const moment = await transactionMoment(transaction);
  const rows = await transaction
    .selectFrom('exemption_clears')
    .innerJoin('journal_cells', 'journal_cells.id', 'exemption_clears.cell_id')
    .leftJoin('journal_works', 'journal_works.id', 'journal_cells.work_id')
    .select([
      'exemption_clears.id',
      'exemption_clears.cell_id',
      'exemption_clears.mark',
      'exemption_clears.score',
      'exemption_clears.cleared_version',
      'journal_cells.version',
      'journal_cells.work_id',
      'journal_works.total',
      'journal_works.not_held',
    ])
    .where('exemption_clears.lesson_id', '=', lessonId)
    .where('exemption_clears.student_id', '=', studentId)
    .where('exemption_clears.given_back_at', 'is', null)
    .orderBy(sql`journal_cells.work_id nulls first`)
    .orderBy('journal_cells.work_id')
    .forUpdate(['exemption_clears', 'journal_cells'])
    .execute();
  let given = 0;
  for (const row of rows) {
    const fits =
      row.work_id === null ||
      (row.not_held !== true && row.total !== null && (row.score ?? 0) <= row.total);
    if (row.version === row.cleared_version && fits) {
      await transaction
        .updateTable('journal_cells')
        .set({
          mark: row.work_id === null ? row.mark : null,
          score: row.work_id === null ? null : row.score,
          changed_by: await actorOf(transaction),
          changed_how: 'exemption',
        })
        .where('id', '=', row.cell_id)
        .execute();
      given += 1;
    }
    await transaction
      .updateTable('exemption_clears')
      .set({ given_back_at: moment })
      .where('id', '=', row.id)
      .execute();
  }
  return given;
}

/** 00:00 branch time after the third day following the day of the change (decision 5). */
export async function reopenedUntil(transaction: Transaction, branchId: string): Promise<Date> {
  const zone = await zoneOfBranch(transaction, branchId);
  const today = schoolDateOf(await transactionMoment(transaction), zone);
  const found = await sql<{ until: Date }>`
    select (${addDays(today, 4)}::date::timestamp at time zone ${zone}) as until
  `.execute(transaction);
  const until = found.rows[0]?.until;
  if (until === undefined) throw new Error('No moment for the reopened cells.');
  return new Date(until);
}

async function storeReopened(
  transaction: Transaction,
  branchId: string,
  exemptionId: string,
  lessonId: string,
  studentId: string,
): Promise<void> {
  await transaction
    .insertInto('exemption_reopened_cells')
    .values({
      branch_id: branchId,
      exemption_id: exemptionId,
      lesson_id: lessonId,
      student_id: studentId,
      reopened_at: await transactionMoment(transaction),
      open_until: await reopenedUntil(transaction, branchId),
    })
    .onConflict((conflict) =>
      conflict.columns(['exemption_id', 'lesson_id', 'student_id', 'reopened_at']).doNothing(),
    )
    .execute();
}

/** The account of the transaction's change, set by `withActor`. */
async function actorOf(transaction: Transaction): Promise<string> {
  const found = await sql<{ actor: string | null }>`
    select nullif(current_setting('app.exemption_actor', true), '') as actor
  `.execute(transaction);
  const actor = found.rows[0]?.actor;
  if (actor === null || actor === undefined) throw new Error('No actor for the exemption write.');
  return actor;
}

/** Names the account that writes the cells of the change (their `changed_by`). */
export async function withActor(transaction: Transaction, accountId: string): Promise<void> {
  await sql`select set_config('app.exemption_actor', ${accountId}, true)`.execute(transaction);
}

/** What an exemption covers, as the notice of a change sees it. */
export interface ExemptionScope {
  readonly allSubjects: boolean;
  readonly subjectIds: readonly string[];
  readonly startTime: string | null;
  readonly endTime: string | null;
}

/**
 * Who is told of a grant or a change (`edge/exemptions`, row 11: "the
 * student's Tutor and the teachers of the affected lessons"): the Tutors of
 * the student's classes in the window and the teachers of the student's lessons
 * there (held or to come, not cancelled) that the exemption meets, by subject
 * and, for chosen slots, by time (permission review 11); never the person who
 * made the change.
 */
export async function toldOf(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly studentId: string;
    readonly from: string;
    readonly until: string;
    readonly actorId: string;
    /** What the exemption covers (before and after a change): only lessons it meets are told. */
    readonly scopes: readonly ExemptionScope[];
  },
): Promise<string[]> {
  const scopes = input.scopes.map((scope) => ({
    all: scope.allSubjects,
    subjects: [...scope.subjectIds],
    start: scope.startTime ?? '00:00',
    end: scope.endTime ?? '24:00',
  }));
  const tutors = await sql<{ account_id: string }>`
    select distinct a.account_id
    from class_memberships m
    join class_tutors t on t.class_id = m.class_id
    join assignments a on a.id = t.assignment_id
    join branches b on b.id = m.branch_id
    where m.student_id = ${input.studentId}::uuid
      and m.branch_id = ${input.branchId}::uuid
      and m.valid_from <= ${input.until}::date and ${input.from}::date < m.valid_until
      and t.valid_from < ((${input.until}::date + 1)::timestamp at time zone b.time_zone)
      and (t.valid_until is null or t.valid_until > (${input.from}::date::timestamp at time zone b.time_zone))
  `.execute(transaction);
  const teachers = await sql<{ teacher_id: string }>`
    select distinct l.teacher_id
    from lessons l
    where l.branch_id = ${input.branchId}::uuid
      and l.lesson_date between ${input.from}::date and ${input.until}::date
      and l.cancel_cause is null
      and l.teacher_id is not null
      and exists (
        select 1 from branches b, jsonb_to_recordset(${JSON.stringify(scopes)}::jsonb)
          as s("all" boolean, subjects uuid[], start text, "end" text)
        where b.id = l.branch_id
          and (s."all" or l.subject_id = any(s.subjects))
          and (l.starts_at at time zone b.time_zone)::time < s."end"::time
          and s.start::time < (l.ends_at at time zone b.time_zone)::time
      )
      and (
        exists (
          select 1 from class_memberships m
          where m.class_id = l.class_id and m.student_id = ${input.studentId}::uuid
            and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
        )
        or exists (
          select 1 from group_memberships m
          where m.group_id = l.group_id and m.student_id = ${input.studentId}::uuid
            and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
        )
      )
  `.execute(transaction);
  const accounts = new Set(tutors.rows.map((row) => row.account_id));
  for (const row of teachers.rows) {
    const account = await accountOfStaff(transaction, row.teacher_id);
    if (account !== null) accounts.add(account);
  }
  accounts.delete(input.actorId);
  return [...accounts].sort();
}

/** The "reopened after exemption" notices: one per teacher and change (`edge/journal`, Locks). */
export async function noticeReopened(
  transaction: Transaction,
  notifications: Notifications,
  input: {
    readonly branchId: string;
    readonly reopened: Settled['reopenedLocked'];
    readonly names: ReadonlyMap<string, string>;
    readonly actorId: string;
  },
): Promise<void> {
  const byTeacher = new Map<string, Map<string, Set<string>>>();
  for (const one of input.reopened) {
    const account = await accountOfStaff(transaction, one.teacherId);
    if (account === null || account === input.actorId) continue;
    const students = byTeacher.get(account) ?? new Map<string, Set<string>>();
    const lessons = students.get(one.studentId) ?? new Set<string>();
    lessons.add(one.lessonId);
    students.set(one.studentId, lessons);
    byTeacher.set(account, students);
  }
  for (const [account, students] of [...byTeacher].sort(([one], [other]) =>
    one.localeCompare(other),
  )) {
    // One notice per teacher and change (spec review of the code, must-fix 4): the students by
    // name, the locked lessons counted once.
    const lessons = new Set([...students.values()].flatMap((one) => [...one]));
    const named = [...students.keys()]
      .map((studentId) => input.names.get(studentId) || '—')
      .sort((one, other) => one.localeCompare(other));
    await notifications.send(transaction, {
      kind: 'journal.exemption_reopened',
      branchId: input.branchId,
      accountIds: [account],
      data: { students: named.join(', '), lessons: lessons.size },
    });
  }
}
