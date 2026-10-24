import type {
  ErrorCode,
  ErrorDetail,
  JournalEntriesChoice,
  JournalEntryDetail,
  JournalEntryKind,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { notFound } from '../setup/setup-refusals.js';

/**
 * What a move, a return, a leaving or a branch move does to the journal (task
 * 8.6, pull request #224; `edge/students-classes-groups`, the 11:00, a week
 * late, mistake and 1 October rows; decisions 4, 6, 9, 10 and 12).
 *
 * A writer runs its change between `followJournal` and `settle`:
 *
 * - `followJournal` locks the student's cells, comments and rating entries of
 *   the years not closed `for update` (the cells in the order of `saveCells`),
 *   then the class and group rows `for no key update`, before anything is
 *   read (`lockStudents` of 8.5, with the comments and rating entries whose
 *   triggers take the same rows `for share`, 0127). It then lists the
 *   student's entries dated on or after the date and the held lessons the
 *   student is a member of.
 * - `settle`, after the write, keeps the entries whose lesson (or rating exam)
 *   the student is no longer a member of: the leaving voids absences and
 *   zeros by itself (decision 6); the others need `journalEntries` with the
 *   list as it is now, or the change is refused `journal_entries`; a move
 *   dated today cannot void (`voidable: false`). Each void clears the value
 *   with `changed_how` `transfer` (or `leaving`), the reason in the history
 *   line (`app.void_reason`, 0127), and keeps it in `journal_voids`. The held
 *   lessons the student became a member of open as optional cells until 00:00
 *   of the day after the seventh day following today (decision 10).
 * - `giveBack` and `withdrawOptional` take a change back (a cancel, an undo):
 *   each voided value is written back where its row still holds the void's
 *   version and the student is expected again, else it stays voided and is
 *   marked given back (as 8.5 decision 26).
 */

/** The change that voids or opens, as `journal_voids` and `journal_optional_cells` name it. */
export type JournalSource =
  | { readonly moveId: string }
  | { readonly leavingId: string }
  | { readonly branchMoveId: string }
  | { readonly returnStatusId: string }
  | { readonly mergeId: string };

/** An entry of the student, with what the void keeps. */
export interface MetEntry {
  readonly kind: JournalEntryKind;
  readonly id: string;
  readonly branchId: string;
  readonly version: number;
  readonly date: string;
  readonly lessonId: string | null;
  readonly ratingExamId: string | null;
  readonly journalId: string | null;
  readonly unitName: string;
  readonly subject: { uz: string; ru: string; en: string };
  readonly mark: number | null;
  readonly score: number | null;
  readonly ratingKind: string | null;
  readonly body: string | null;
  readonly visibility: string | null;
}

/** What `settle` did, as the writer's audit entry names it. */
export interface JournalEffects {
  readonly journalVoids: { kind: JournalEntryKind; entryId: string; reason: string | null }[];
  readonly optionalCells: { lessonId: string; openUntil: string }[];
}

/** What a take-back did, as the writer's audit entry names it. */
export interface JournalGiveBack {
  readonly journalGivenBack: { kind: JournalEntryKind; entryId: string; written: boolean }[];
  readonly optionalWithdrawn: number;
}

interface EntryRow {
  kind: JournalEntryKind;
  id: string;
  branch_id: string;
  version: number;
  date: string;
  lesson_id: string | null;
  rating_exam_id: string | null;
  journal_id: string | null;
  unit_name: string;
  name_uz: string;
  name_ru: string;
  name_en: string;
  mark: number | null;
  score: number | null;
  rating_kind: string | null;
  body: string | null;
  visibility: string | null;
}

const toEntry = (row: EntryRow): MetEntry => ({
  kind: row.kind,
  id: row.id,
  branchId: row.branch_id,
  version: row.version,
  date: row.date,
  lessonId: row.lesson_id,
  ratingExamId: row.rating_exam_id,
  journalId: row.journal_id,
  unitName: row.unit_name,
  subject: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
  mark: row.mark,
  score: row.score,
  ratingKind: row.rating_kind,
  body: row.body,
  visibility: row.visibility,
});

/**
 * Locks the students' journal entries of the years not closed `for update`
 * (cells in the order of `saveCells`, then comments and rating entries by id),
 * then their class and group rows `for no key update` by id, each table in a
 * statement of its own (see the file's comment).
 */
export async function lockStudentEntries(
  transaction: Transaction,
  studentIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(studentIds.map((id) => id.toLowerCase()))].sort();
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
    select 1 from journal_comments c
    where c.student_id = any(${ids}::uuid[])
    order by c.id
    for update
  `.execute(transaction);
  await sql`
    select 1 from journal_rating_entries e
    where e.student_id = any(${ids}::uuid[])
    order by e.id
    for update
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
 * The student's journal data (`edge/00-definitions`, Data on a lesson: entered
 * by a person) dated on or after `from` in the years not closed of the
 * branches the transaction sees: cells with a mark or a number, comments with
 * a body, rating entries with a score or "did not sit" by the exam's date in
 * force. Cancelled lessons hold no figure and are left out. Ordered by date,
 * then kind and id.
 */
export async function entriesFrom(
  transaction: Transaction,
  studentId: string,
  from: string,
): Promise<MetEntry[]> {
  const rows = await sql<EntryRow>`
    with open_lessons as materialized (
      select l.id, l.branch_id, l.lesson_date, l.class_id, l.group_id, l.subject_id
      from lessons l
      where l.lesson_date >= ${from}::date
        and l.cancel_cause is null
        and exists (
          select 1 from academic_years y
          where y.branch_id = l.branch_id and y.status <> 'closed'
            and l.lesson_date between y.start_date and y.end_date
        )
    ),
    lesson_entries as (
      select 'cell'::text as kind, c.id, c.branch_id, c.version, c.lesson_id, null::uuid as rating_exam_id,
        c.mark::int as mark, c.score, null::text as rating_kind, null::text as body,
        null::text as visibility
      from journal_cells c
      where c.student_id = ${studentId}::uuid and (c.mark is not null or c.score is not null)
      union all
      select 'comment', c.id, c.branch_id, c.version, c.lesson_id, null, null, null, null,
        c.body, c.visibility
      from journal_comments c
      where c.student_id = ${studentId}::uuid and c.body is not null and c.lesson_id is not null
    )
    select e.kind, e.id, e.branch_id, e.version, l.lesson_date::text as date, e.lesson_id,
      e.rating_exam_id, j.id as journal_id,
      coalesce(cl.grade::text || ' ' || cl.name, g.name) as unit_name,
      s.name_uz, s.name_ru, s.name_en, e.mark, e.score, e.rating_kind, e.body, e.visibility
    from lesson_entries e
    join open_lessons l on l.id = e.lesson_id
    left join journals j on j.subject_id = l.subject_id
      and j.branch_id = l.branch_id
      and (j.class_id = l.class_id or j.group_id = l.group_id)
      and exists (
        select 1 from academic_years y
        where y.id = j.academic_year_id and l.lesson_date between y.start_date and y.end_date
      )
    join subjects s on s.id = l.subject_id
    left join classes cl on cl.id = l.class_id
    left join groups g on g.id = l.group_id
    union all
    select 'rating', e.id, e.branch_id, e.version,
      journal_rating_date(x.journal_id, x.quarter_id)::text, null, x.id, j.id,
      coalesce(cl.grade::text || ' ' || cl.name, g.name),
      s.name_uz, s.name_ru, s.name_en, null, e.score::int, e.kind, null, null
    from journal_rating_entries e
    join journal_rating_exams x on x.id = e.rating_exam_id
    join journals j on j.id = x.journal_id
    join academic_years y on y.id = j.academic_year_id and y.status <> 'closed'
    join subjects s on s.id = j.subject_id
    left join classes cl on cl.id = j.class_id
    left join groups g on g.id = j.group_id
    where e.student_id = ${studentId}::uuid
      and e.kind in ('score', 'did_not_sit')
      and journal_rating_date(x.journal_id, x.quarter_id) >= ${from}::date
    order by date, kind, id
  `.execute(transaction);
  return rows.rows.map(toEntry);
}

/**
 * The entries the student is no longer a member for: a cell's or comment's
 * lesson (`lesson_student_member`, 0127), a rating entry's journal on any day
 * from the exam's date in force to the quarter's end (the rule of
 * `journal_rating_entries_write`, 0120).
 */
export async function entriesLeft(
  transaction: Transaction,
  studentId: string,
  entries: readonly MetEntry[],
): Promise<MetEntry[]> {
  if (entries.length === 0) return [];
  const lessonIds = [
    ...new Set(entries.flatMap((entry) => (entry.lessonId === null ? [] : [entry.lessonId]))),
  ];
  const examIds = [
    ...new Set(
      entries.flatMap((entry) => (entry.ratingExamId === null ? [] : [entry.ratingExamId])),
    ),
  ];
  const memberLessons =
    lessonIds.length === 0
      ? []
      : (
          await sql<{ id: string }>`
            select l.id from unnest(${lessonIds}::uuid[]) as l(id)
            where lesson_student_member(l.id, ${studentId}::uuid)
          `.execute(transaction)
        ).rows;
  const memberExams =
    examIds.length === 0
      ? []
      : (
          await sql<{ id: string }>`
            select x.id from journal_rating_exams x
            join journals j on j.id = x.journal_id
            join quarters q on q.id = x.quarter_id
            where x.id = any(${examIds}::uuid[])
              and exists (
                select 1 from class_memberships m
                where j.class_id is not null and m.class_id = j.class_id
                  and m.student_id = ${studentId}::uuid
                  and m.valid_from <= q.end_date
                  and m.valid_until > journal_rating_date(x.journal_id, x.quarter_id)
                  and m.valid_from < m.valid_until
                union all
                select 1 from group_memberships m
                where j.group_id is not null and m.group_id = j.group_id
                  and m.student_id = ${studentId}::uuid
                  and m.valid_from <= q.end_date
                  and m.valid_until > journal_rating_date(x.journal_id, x.quarter_id)
                  and m.valid_from < m.valid_until
              )
          `.execute(transaction)
        ).rows;
  const lessons = new Set(memberLessons.map((row) => row.id));
  const exams = new Set(memberExams.map((row) => row.id));
  return entries.filter((entry) =>
    entry.lessonId !== null ? !lessons.has(entry.lessonId) : !exams.has(entry.ratingExamId ?? ''),
  );
}

/** The held lessons (started, not cancelled) dated on or after `from` the student is a member of. */
async function memberLessonsFrom(
  transaction: Transaction,
  studentId: string,
  from: string,
): Promise<{ id: string; branchId: string }[]> {
  const moment = await transactionMoment(transaction);
  const rows = await sql<{ id: string; branch_id: string }>`
    with near as materialized (
      select l.id, l.branch_id from lessons l
      where l.lesson_date >= ${from}::date
        and l.starts_at <= ${moment}::timestamptz
        and l.cancel_cause is null
        and l.teacher_id is not null
        and (
          exists (
            select 1 from class_memberships m
            where m.class_id = l.class_id and m.student_id = ${studentId}::uuid
              and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
          )
          or exists (
            select 1 from group_memberships m
            where m.group_id = l.group_id and m.student_id = ${studentId}::uuid
              and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
          )
        )
    )
    select id, branch_id from near order by id
  `.execute(transaction);
  return rows.rows.map((row) => ({ id: row.id, branchId: row.branch_id }));
}

/** The detail of an entry in a refusal. */
export function entryDetail(entry: MetEntry, code: ErrorCode, voidable: boolean): ErrorDetail {
  const journalEntry: JournalEntryDetail = {
    kind: entry.kind,
    version: entry.version,
    date: entry.date,
    journalId: entry.journalId,
    unitName: entry.unitName,
    subject: entry.subject,
    mark: entry.kind === 'cell' ? entry.mark : null,
    score: entry.kind === 'comment' ? null : entry.score,
    didNotSit: entry.ratingKind === 'did_not_sit',
    voidable,
  };
  return {
    path: 'journalEntries',
    code,
    message: `The ${entry.kind} of ${entry.date} holds data.`,
    recordId: entry.id,
    journalEntry,
  };
}

/** A leaving voids absences and zeros by itself (decision 6). */
export const voidedByLeaving = (entry: MetEntry): boolean =>
  entry.kind === 'cell' && (entry.mark === 0 || (entry.mark === null && entry.score === 0));

const sourceColumns = (source: JournalSource) => ({
  move_id: 'moveId' in source ? source.moveId : null,
  leaving_id: 'leavingId' in source ? source.leavingId : null,
  branch_move_id: 'branchMoveId' in source ? source.branchMoveId : null,
  return_status_id: 'returnStatusId' in source ? source.returnStatusId : null,
  merge_id: 'mergeId' in source ? source.mergeId : null,
});

const howOf = (source: JournalSource): 'transfer' | 'leaving' =>
  'leavingId' in source ? 'leaving' : 'transfer';

/** The same entries, each with the same version. */
function sameList(needs: readonly MetEntry[], seen: JournalEntriesChoice['seen']): boolean {
  const sent = new Map(seen.map((one) => [one.id.toLowerCase(), one.version]));
  if (needs.length !== seen.length || sent.size !== seen.length) return false;
  return needs.every((entry) => sent.get(entry.id.toLowerCase()) === entry.version);
}

/**
 * Voids the entries for the source: the cleared value with the source's
 * `changed_how`, the reason in the history line, the value in `journal_voids`.
 */
export async function voidEntries(
  transaction: Transaction,
  input: {
    readonly studentId: string;
    readonly source: JournalSource;
    readonly actorId: string;
    readonly entries: readonly { entry: MetEntry; reason: string | null }[];
  },
): Promise<JournalEffects['journalVoids']> {
  const how = howOf(input.source);
  const moment = await transactionMoment(transaction);
  const done: JournalEffects['journalVoids'] = [];
  for (const { entry, reason } of input.entries) {
    await sql`select set_config('app.void_reason', ${reason ?? ''}, true)`.execute(transaction);
    let version: number;
    if (entry.kind === 'cell') {
      const row = await transaction
        .updateTable('journal_cells')
        .set({ mark: null, score: null, changed_by: input.actorId, changed_how: how })
        .where('id', '=', entry.id)
        .where('version', '=', entry.version)
        .returning('version')
        .executeTakeFirstOrThrow();
      version = row.version;
    } else if (entry.kind === 'comment') {
      const row = await transaction
        .updateTable('journal_comments')
        .set({ body: null, changed_by: input.actorId, changed_how: how })
        .where('id', '=', entry.id)
        .where('version', '=', entry.version)
        .returning('version')
        .executeTakeFirstOrThrow();
      version = row.version;
    } else {
      const row = await transaction
        .updateTable('journal_rating_entries')
        .set({
          kind: null,
          score: null,
          // Every write over an entry carries its reason (0120); a leaving's
          // own void never reaches a rating entry (decision 6).
          reason: reason ?? how,
          changed_by: input.actorId,
          changed_how: how,
        })
        .where('id', '=', entry.id)
        .where('version', '=', entry.version)
        .returning('version')
        .executeTakeFirstOrThrow();
      version = row.version;
    }
    await transaction
      .insertInto('journal_voids')
      .values({
        branch_id: entry.branchId,
        student_id: input.studentId,
        ...sourceColumns(input.source),
        cell_id: entry.kind === 'cell' ? entry.id : null,
        comment_id: entry.kind === 'comment' ? entry.id : null,
        rating_entry_id: entry.kind === 'rating' ? entry.id : null,
        mark: entry.mark,
        score: entry.score,
        rating_kind: entry.ratingKind,
        body: entry.body,
        visibility: entry.visibility,
        version,
        reason,
        voided_by: input.actorId,
        voided_at: moment,
      })
      .execute();
    done.push({ kind: entry.kind, entryId: entry.id, reason });
  }
  await sql`select set_config('app.void_reason', '', true)`.execute(transaction);
  return done;
}

/** What `followJournal` read before the write. */
export interface JournalFollow {
  readonly studentId: string;
  readonly from: string;
  readonly entries: readonly MetEntry[];
  readonly memberLessons: ReadonlySet<string>;
}

/**
 * Locks the student's entries and rows and reads what the write may leave
 * (see the file's comment). `from` is the first day the change touches: a
 * move's date, the day after a leaving's last day.
 */
export async function followJournal(
  transaction: Transaction,
  studentId: string,
  from: string,
): Promise<JournalFollow> {
  await lockStudentEntries(transaction, [studentId]);
  const entries = await entriesFrom(transaction, studentId, from);
  const lessons = await memberLessonsFrom(transaction, studentId, from);
  return { studentId, from, entries, memberLessons: new Set(lessons.map((lesson) => lesson.id)) };
}

/**
 * After the write: voids what the change left, refusing it when a choice is
 * missing or stale, and opens the optional cells (see the file's comment).
 */
export async function settle(
  transaction: Transaction,
  follow: JournalFollow,
  input: {
    readonly source: JournalSource;
    readonly actorId: string;
    readonly choice: JournalEntriesChoice | undefined;
    /** A move dated today cannot void (edge, the 11:00 row). */
    readonly voidable: boolean;
    /** The leaving voids absences and zeros by itself (decision 6). */
    readonly voidsByItself?: (entry: MetEntry) => boolean;
    /** Whether held lessons the student became a member of open as optional cells. */
    readonly opensOptional: boolean;
  },
): Promise<JournalEffects> {
  if (input.choice !== undefined) {
    await refuseForeignSeen(transaction, input.choice.seen);
  }
  const left = await entriesLeft(transaction, follow.studentId, follow.entries);
  const byItself = input.voidsByItself ?? (() => false);
  const own = left.filter(byItself);
  const needs = left.filter((entry) => !byItself(entry));
  if (needs.length > 0 && !input.voidable) {
    throw new ApiException(
      'move_entries_today',
      409,
      undefined,
      needs.map((entry) => entryDetail(entry, 'move_entries_today', false)),
    );
  }
  if (needs.length > 0 && input.choice === undefined) {
    throw journalEntriesRefusal(needs, true, false);
  }
  if (input.choice !== undefined && !sameList(needs, input.choice.seen)) {
    throw journalEntriesRefusal(needs, input.voidable, true);
  }
  const journalVoids = await voidEntries(transaction, {
    studentId: follow.studentId,
    source: input.source,
    actorId: input.actorId,
    entries: [
      ...own.map((entry) => ({ entry, reason: null })),
      ...needs.map((entry) => ({ entry, reason: input.choice?.reason ?? null })),
    ],
  });
  const optionalCells = input.opensOptional
    ? await openOptional(transaction, follow, input.source)
    : [];
  return { journalVoids, optionalCells };
}

/**
 * An entry named in `seen` that the branch does not hold, or an unknown one,
 * is 404 (`.claude/rules/api.md`: one 404 per body id); the change is rolled
 * back with it.
 */
export async function refuseForeignSeen(
  transaction: Transaction,
  seen: JournalEntriesChoice['seen'],
): Promise<void> {
  const ids = [...new Set(seen.map((one) => one.id.toLowerCase()))];
  const found = await sql<{ id: string }>`
    select id from journal_cells where id = any(${ids}::uuid[])
    union all
    select id from journal_comments where id = any(${ids}::uuid[])
    union all
    select id from journal_rating_entries where id = any(${ids}::uuid[])
  `.execute(transaction);
  if (found.rows.length !== ids.length) throw notFound();
}

/** The refusal `journal_entries` with one detail per entry. */
export function journalEntriesRefusal(
  entries: readonly MetEntry[],
  voidable: boolean,
  changed: boolean,
): ApiException {
  const details = entries.map((entry) => entryDetail(entry, 'journal_entries', voidable));
  if (changed) {
    details.push({
      path: 'journalEntries.seen',
      code: 'journal_entries',
      message: 'The entries sent are not the list now.',
      changed: true,
    });
  }
  return new ApiException('journal_entries', 409, undefined, details);
}

/**
 * Opens as optional the held lessons the student became a member of, until
 * 00:00 branch time of the day after the seventh day following today
 * (decision 10 as changed by correction 3).
 */
async function openOptional(
  transaction: Transaction,
  follow: JournalFollow,
  source: JournalSource,
): Promise<JournalEffects['optionalCells']> {
  const now = await memberLessonsFrom(transaction, follow.studentId, follow.from);
  const opened = now.filter((lesson) => !follow.memberLessons.has(lesson.id));
  if (opened.length === 0) return [];
  const moment = await transactionMoment(transaction);
  const rows = await sql<{ lesson_id: string; open_until: string }>`
    insert into journal_optional_cells (
      branch_id, move_id, branch_move_id, return_status_id, lesson_id, student_id, open_until,
      opened_at
    )
    select l.branch_id, ${sourceColumns(source).move_id}::uuid,
      ${sourceColumns(source).branch_move_id}::uuid, ${sourceColumns(source).return_status_id}::uuid,
      l.id, ${follow.studentId}::uuid,
      (((${moment}::timestamptz at time zone b.time_zone)::date + 8)::timestamp
        at time zone b.time_zone),
      ${moment}::timestamptz
    from lessons l
    join branches b on b.id = l.branch_id
    where l.id = any(${opened.map((lesson) => lesson.id)}::uuid[])
    order by l.id
    returning lesson_id, to_json(open_until)#>>'{}' as open_until
  `.execute(transaction);
  return rows.rows.map((row) => ({ lessonId: row.lesson_id, openUntil: row.open_until }));
}

interface VoidRow {
  id: string;
  cell_id: string | null;
  comment_id: string | null;
  rating_entry_id: string | null;
  mark: number | null;
  score: number | null;
  rating_kind: string | null;
  body: string | null;
  visibility: string | null;
  version: number;
  reason: string | null;
}

const sourceFilter = (source: JournalSource) => {
  const columns = sourceColumns(source);
  if (columns.move_id !== null) return sql`v.move_id = ${columns.move_id}::uuid`;
  if (columns.leaving_id !== null) return sql`v.leaving_id = ${columns.leaving_id}::uuid`;
  if (columns.branch_move_id !== null)
    return sql`v.branch_move_id = ${columns.branch_move_id}::uuid`;
  if (columns.return_status_id !== null)
    return sql`v.return_status_id = ${columns.return_status_id}::uuid`;
  return sql`v.merge_id = ${columns.merge_id}::uuid`;
};

/**
 * Gives back what the source voided, after the change was taken back: each
 * value is written where its row still holds the void's version and the
 * database takes it (the student expected again, the work's total, the
 * exam's state), in a savepoint of its own; a value the database refuses
 * stays voided. Every void row is marked given back. The cells taken back are
 * locked first, in the order of `saveCells`.
 */
export async function giveBack(
  transaction: Transaction,
  input: { readonly studentId: string; readonly source: JournalSource; readonly actorId: string },
): Promise<JournalGiveBack> {
  await lockStudentEntries(transaction, [input.studentId]);
  const moment = await transactionMoment(transaction);
  const voids = await sql<VoidRow>`
    select v.id, v.cell_id, v.comment_id, v.rating_entry_id, v.mark, v.score, v.rating_kind,
      v.body, v.visibility, v.version, v.reason
    from journal_voids v
    where ${sourceFilter(input.source)} and v.given_back_at is null
    order by v.id
  `.execute(transaction);
  const how = howOf(input.source);
  const journalGivenBack: JournalGiveBack['journalGivenBack'] = [];
  for (const row of voids.rows) {
    const kind: JournalEntryKind =
      row.cell_id !== null ? 'cell' : row.comment_id !== null ? 'comment' : 'rating';
    const entryId = row.cell_id ?? row.comment_id ?? row.rating_entry_id ?? '';
    await sql`savepoint journal_give_back`.execute(transaction);
    let written = false;
    try {
      await sql`select set_config('app.void_reason', ${row.reason ?? ''}, true)`.execute(
        transaction,
      );
      if (kind === 'cell') {
        const result = await transaction
          .updateTable('journal_cells')
          .set({ mark: row.mark, score: row.score, changed_by: input.actorId, changed_how: how })
          .where('id', '=', entryId)
          .where('version', '=', row.version)
          .where('mark', 'is', null)
          .where('score', 'is', null)
          .executeTakeFirst();
        written = result.numUpdatedRows > 0n;
      } else if (kind === 'comment') {
        const result = await transaction
          .updateTable('journal_comments')
          .set({
            body: row.body,
            visibility: row.visibility ?? 'staff',
            changed_by: input.actorId,
            changed_how: how,
          })
          .where('id', '=', entryId)
          .where('version', '=', row.version)
          .where('body', 'is', null)
          .executeTakeFirst();
        written = result.numUpdatedRows > 0n;
      } else {
        const result = await transaction
          .updateTable('journal_rating_entries')
          .set({
            kind: row.rating_kind,
            score: row.score,
            reason: row.reason ?? how,
            changed_by: input.actorId,
            changed_how: how,
          })
          .where('id', '=', entryId)
          .where('version', '=', row.version)
          .where('kind', 'is', null)
          .executeTakeFirst();
        written = result.numUpdatedRows > 0n;
      }
      await sql`release savepoint journal_give_back`.execute(transaction);
    } catch (error) {
      if (!isCheckViolation(error)) throw error;
      await sql`rollback to savepoint journal_give_back`.execute(transaction);
    }
    await transaction
      .updateTable('journal_voids')
      .set({ given_back_at: moment, given_back_by: input.actorId })
      .where('id', '=', row.id)
      .execute();
    journalGivenBack.push({ kind, entryId, written });
  }
  await sql`select set_config('app.void_reason', '', true)`.execute(transaction);
  // A leaving and a merge open no optional cell.
  const columns = sourceColumns(input.source);
  const opener =
    columns.move_id !== null
      ? (['move_id', columns.move_id] as const)
      : columns.branch_move_id !== null
        ? (['branch_move_id', columns.branch_move_id] as const)
        : columns.return_status_id !== null
          ? (['return_status_id', columns.return_status_id] as const)
          : null;
  if (opener === null) {
    return { journalGivenBack, optionalWithdrawn: 0 };
  }
  const withdrawn = await transaction
    .updateTable('journal_optional_cells')
    .set({ withdrawn_at: moment })
    .where('withdrawn_at', 'is', null)
    .where(opener[0], '=', opener[1])
    .executeTakeFirst();
  return { journalGivenBack, optionalWithdrawn: Number(withdrawn.numUpdatedRows) };
}

/** A refusal of a check or a trigger of the database (SQLSTATE 23514). */
function isCheckViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23514';
}

/**
 * The undo of a move is refused while the journals it wrote rows for hold
 * data of the student on or after its date (decision 12): run after the undo's
 * write, with the entries `followJournal` read before it.
 */
export async function refuseEntriesLeftByUndo(
  transaction: Transaction,
  follow: JournalFollow,
): Promise<void> {
  const left = await entriesLeft(transaction, follow.studentId, follow.entries);
  if (left.length > 0) {
    throw new ApiException(
      'move_has_entries',
      409,
      undefined,
      left.map((entry) => entryDetail(entry, 'move_has_entries', false)),
    );
  }
}
