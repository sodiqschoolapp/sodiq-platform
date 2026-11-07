import { sql } from 'kysely';
import type { Transaction } from '../../../database/transactions.js';
import { exemptionMarksOf } from '../../journal/exemption-read.js';

/**
 * Task 11.5 (pull request #299): what one branch's journal holds for a child of the digest, read
 * at the moment of sending (plan decision 18) in a transaction of that branch only (decision 11).
 * The entries saved in the period, and the entries sent in earlier digests read again, each with
 * the value it shows now, or `null` when it is gone or not shown (decision 7). Marks 4 and 5 are
 * worked out on read by `exemptionMarksOf`, the journal's own reading (`07`, Exemptions; the
 * build line: "the same attendance service as the staff pages").
 */

export type DigestEntryKind = 'attendance' | 'score' | 'rating' | 'comment';

/** The subject of an entry in the three languages. */
export interface SubjectNames {
  readonly uz: string;
  readonly ru: string;
  readonly en: string;
}

/** The value an entry shows now; compared with the value sent (decision 7). */
export interface EntryValue {
  readonly mark: number | null;
  readonly score: number | null;
  readonly total: number | null;
  readonly version: number | null;
}

/** An entry of the journal as the digest may list it. */
export interface JournalEntry {
  readonly kind: DigestEntryKind;
  readonly sourceId: string;
  readonly branchId: string;
  /** The lesson's date, or the rating exam's; `null` for an exam with no date. */
  readonly date: string | null;
  readonly subjectId: string | null;
  readonly subject: SubjectNames | null;
  /** Saved inside the window of this digest. */
  readonly savedInPeriod: boolean;
  /** `null`: gone, or not shown (an exempt lesson, "not graded", a work not held). */
  readonly value: EntryValue | null;
  /** For a score: the work. */
  readonly work?: {
    readonly kind: 'classwork' | 'homework';
    readonly position: number;
    readonly title: string | null;
  };
  /** For a comment: its text. */
  readonly body?: string;
}

const namesOf = (row: {
  name_uz: string | null;
  name_ru: string | null;
  name_en: string | null;
}): SubjectNames | null =>
  row.name_uz === null || row.name_ru === null || row.name_en === null
    ? null
    : { uz: row.name_uz, ru: row.name_ru, en: row.name_en };

/** The lessons of the student that are exempt at the moment of the transaction. */
async function exemptLessons(
  transaction: Transaction,
  studentId: string,
  lessonIds: readonly string[],
): Promise<Set<string>> {
  const marks = await exemptionMarksOf(transaction, [...new Set(lessonIds)], [studentId]);
  const found = new Set<string>();
  for (const [lessonId, students] of marks) {
    if (students.has(studentId)) found.add(lessonId);
  }
  return found;
}

/**
 * The entries of a child in the branch of the transaction: those saved in `[from, until)`, and
 * those named in `sent` (read again, whatever their moment). `until` is taken before the reads
 * (review correction 1).
 */
export async function journalEntriesOf(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly studentId: string;
    readonly from: Date;
    readonly until: Date;
    readonly sent: ReadonlyMap<DigestEntryKind, readonly string[]>;
  },
): Promise<JournalEntry[]> {
  const { studentId, from, until, branchId } = input;
  const sentOf = (kind: DigestEntryKind): string[] => [...(input.sent.get(kind) ?? [])];
  const sentCells = [...sentOf('attendance'), ...sentOf('score')];

  const cells = await sql<{
    id: string;
    lesson_id: string;
    work_id: string | null;
    mark: number | null;
    score: number | null;
    not_graded: boolean;
    changed_at: Date;
    lesson_date: string;
    cancelled: boolean;
    subject_id: string;
    name_uz: string | null;
    name_ru: string | null;
    name_en: string | null;
    work_kind: string | null;
    position: number | null;
    total: number | null;
    not_held: boolean | null;
    title: string | null;
  }>`
    select c.id, c.lesson_id, c.work_id, c.mark, c.score, c.not_graded, c.changed_at,
      l.lesson_date::text as lesson_date, l.cancel_cause is not null as cancelled,
      l.subject_id, s.name_uz, s.name_ru, s.name_en,
      w.kind as work_kind, w.position, w.total, w.not_held,
      coalesce(w.title, pw.title) as title
    from journal_cells c
    join lessons l on l.id = c.lesson_id
    left join subjects s on s.id = l.subject_id
    left join journal_works w on w.id = c.work_id
    left join lesson_plan_works pw on pw.id = w.plan_work_id
    where c.student_id = ${studentId}::uuid
      and (
        (c.changed_at >= ${from} and c.changed_at < ${until})
        or c.id = any(${sentCells}::uuid[])
      )
  `.execute(transaction);

  const ratings = await sql<{
    id: string;
    kind: string | null;
    score: number | null;
    changed_at: Date;
    exam_date: string | null;
    not_held: boolean;
    subject_id: string;
    name_uz: string | null;
    name_ru: string | null;
    name_en: string | null;
  }>`
    select e.id, e.kind, e.score, e.changed_at, x.exam_date::text as exam_date, x.not_held,
      j.subject_id, s.name_uz, s.name_ru, s.name_en
    from journal_rating_entries e
    join journal_rating_exams x on x.id = e.rating_exam_id
    join journals j on j.id = x.journal_id
    left join subjects s on s.id = j.subject_id
    where e.student_id = ${studentId}::uuid
      and (
        (e.changed_at >= ${from} and e.changed_at < ${until})
        or e.id = any(${sentOf('rating')}::uuid[])
      )
  `.execute(transaction);

  const comments = await sql<{
    id: string;
    target: string;
    lesson_id: string | null;
    work_id: string | null;
    rating_exam_id: string | null;
    body: string | null;
    visibility: string;
    version: number;
    changed_at: Date;
    lesson_date: string | null;
    cancelled: boolean | null;
    exam_date: string | null;
    subject_id: string | null;
    name_uz: string | null;
    name_ru: string | null;
    name_en: string | null;
  }>`
    select m.id, m.target, m.lesson_id, m.work_id, m.rating_exam_id, m.body, m.visibility,
      m.version, m.changed_at,
      l.lesson_date::text as lesson_date, l.cancel_cause is not null as cancelled,
      x.exam_date::text as exam_date,
      coalesce(l.subject_id, j.subject_id) as subject_id,
      coalesce(sl.name_uz, sx.name_uz) as name_uz,
      coalesce(sl.name_ru, sx.name_ru) as name_ru,
      coalesce(sl.name_en, sx.name_en) as name_en
    from journal_comments m
    left join lessons l on l.id = m.lesson_id
    left join subjects sl on sl.id = l.subject_id
    left join journal_rating_exams x on x.id = m.rating_exam_id
    left join journals j on j.id = x.journal_id
    left join subjects sx on sx.id = j.subject_id
    where m.student_id = ${studentId}::uuid
      and (
        (m.changed_at >= ${from} and m.changed_at < ${until})
        or m.id = any(${sentOf('comment')}::uuid[])
      )
  `.execute(transaction);

  const lessonIds = [
    ...cells.rows.map((row) => row.lesson_id),
    ...comments.rows.flatMap((row) => (row.lesson_id === null ? [] : [row.lesson_id])),
  ];
  const exempt = await exemptLessons(transaction, studentId, lessonIds);
  const inPeriod = (moment: Date): boolean =>
    moment.getTime() >= from.getTime() && moment.getTime() < until.getTime();

  const found: JournalEntry[] = [];
  // The cells a comment may stand beside (11.3 decision 8): a shown mark or score.
  const shownCell = new Map<string, boolean>();
  const workCells = await sql<{
    work_id: string;
    score: number | null;
    not_graded: boolean;
    total: number | null;
    not_held: boolean;
  }>`
    select w.id as work_id, c.score, coalesce(c.not_graded, false) as not_graded, w.total, w.not_held
    from journal_works w
    left join journal_cells c on c.work_id = w.id and c.student_id = ${studentId}::uuid
    where w.id = any(${comments.rows.flatMap((row) => (row.work_id === null ? [] : [row.work_id]))}::uuid[])
  `.execute(transaction);
  for (const row of workCells.rows) {
    shownCell.set(row.work_id, !row.not_held && row.total !== null && !row.not_graded);
  }

  for (const row of cells.rows) {
    const subject = namesOf(row);
    const lessonShown = !row.cancelled && !exempt.has(row.lesson_id);
    if (row.work_id === null) {
      found.push({
        kind: 'attendance',
        sourceId: row.id,
        branchId,
        date: row.lesson_date,
        subjectId: row.subject_id,
        subject,
        savedInPeriod: inPeriod(row.changed_at),
        value:
          lessonShown && row.mark !== null
            ? { mark: row.mark, score: null, total: null, version: null }
            : null,
      });
      continue;
    }
    const scoreShown =
      lessonShown &&
      row.score !== null &&
      !row.not_graded &&
      row.not_held === false &&
      row.total !== null;
    found.push({
      kind: 'score',
      sourceId: row.id,
      branchId,
      date: row.lesson_date,
      subjectId: row.subject_id,
      subject,
      savedInPeriod: inPeriod(row.changed_at),
      value: scoreShown ? { mark: null, score: row.score, total: row.total, version: null } : null,
      work: {
        kind: row.work_kind === 'homework' ? 'homework' : 'classwork',
        position: row.position ?? 1,
        title: row.title,
      },
    });
  }

  const ratingShown = new Map<string, boolean>();
  for (const row of ratings.rows) {
    found.push({
      kind: 'rating',
      sourceId: row.id,
      branchId,
      date: row.exam_date,
      subjectId: row.subject_id,
      subject: namesOf(row),
      savedInPeriod: inPeriod(row.changed_at),
      value:
        !row.not_held && row.kind === 'score' && row.score !== null
          ? { mark: null, score: row.score, total: 100, version: null }
          : null,
    });
  }
  // A rating comment stands beside the child's rating entry, shown when it holds a score or
  // "did not sit" and the exam was held (11.3 decision 8).
  const ratingExamIds = comments.rows.flatMap((row) =>
    row.rating_exam_id === null ? [] : [row.rating_exam_id],
  );
  if (ratingExamIds.length > 0) {
    const entries = await sql<{ rating_exam_id: string; shown: boolean }>`
      select e.rating_exam_id, (not x.not_held and e.kind in ('score', 'did_not_sit')) as shown
      from journal_rating_entries e
      join journal_rating_exams x on x.id = e.rating_exam_id
      where e.student_id = ${studentId}::uuid and e.rating_exam_id = any(${ratingExamIds}::uuid[])
    `.execute(transaction);
    for (const row of entries.rows) ratingShown.set(row.rating_exam_id, row.shown);
  }

  for (const row of comments.rows) {
    let beside: boolean;
    if (row.target === 'rating') {
      beside = row.rating_exam_id !== null && (ratingShown.get(row.rating_exam_id) ?? false);
    } else {
      const lessonShown =
        row.lesson_id !== null && row.cancelled === false && !exempt.has(row.lesson_id);
      beside =
        lessonShown &&
        (row.target !== 'work' || (row.work_id !== null && (shownCell.get(row.work_id) ?? false)));
    }
    const shown = beside && row.visibility === 'parents' && row.body !== null;
    found.push({
      kind: 'comment',
      sourceId: row.id,
      branchId,
      date: row.target === 'rating' ? row.exam_date : row.lesson_date,
      subjectId: row.subject_id,
      subject: namesOf(row),
      savedInPeriod: inPeriod(row.changed_at),
      value: shown ? { mark: null, score: null, total: null, version: row.version } : null,
      ...(shown && row.body !== null ? { body: row.body } : {}),
    });
  }
  return found;
}
