/**
 * The work columns of a journal's lessons (task 8.1, pull request #217;
 * `07`, Entering data; `09`, In the journal; `edge/journal`, Entering).
 * Pure: the grid and every write route call it with what they read, so the
 * grid and the writes agree on which columns a lesson has. Nothing is stored
 * by a read; a column with no row (`workId` null) gets one at its first write.
 *
 * - The source of a lesson's homework columns is the nearest earlier lesson
 *   of the journal in the year that is not cancelled and not "started but not
 *   held" (decision 3; `edge/00-definitions`, Previous lesson); for a held
 *   lesson this is the previous lesson. The check lesson of homework given at
 *   a lesson is the next such lesson.
 * - Classwork columns of lesson L: the classworks of L's plan item, then the
 *   works added by hand at L. Homework columns of check lesson C: the
 *   homeworks given at source(C) (planned, then by hand), then the stored
 *   homeworks shown at C for another reason (carried in, kept with numbers).
 *   A planned work uses its stored row (`planWorkId`, linked at its first
 *   write or by the takeover of the plan save, review correction 1); a
 *   hand-added work with no link is an unplanned column.
 * - Where a stored row is shown: a homework with no number at the check
 *   lesson of its source (of the lesson it was carried from, when carried;
 *   decision 7: "The homework columns move to the next held lesson, each as
 *   long as it has no numbers yet"); every other row at its own lesson, after
 *   the planned ones when the plan no longer names it there (spec review
 *   must-fix 2): nothing typed leaves the grid.
 * - A work marked "not held" leaves the columns (`09`: "its column is
 *   removed from that lesson") and is listed apart, so it can be undone.
 * - A planned homework marked "not given" at its source lesson (task 8.8,
 *   `edge/lesson-plans`: "the next lesson gets no column for a homework not
 *   given") makes no column, and an empty stored row of it is not shown (a
 *   row with data refuses the mark, 0130). It stays in the source lesson's
 *   `given` list with `notGiven`.
 */

export type WorkKind = 'classwork' | 'homework';

/** A lesson of the journal in the academic year. */
export interface ColumnLesson {
  readonly id: string;
  readonly startsAt: Date;
  readonly cancelled: boolean;
  /** Its start has passed. */
  readonly started: boolean;
  /** `edge/00-definitions`, Held lesson. */
  readonly held: boolean;
}

/** A work of a plan item. */
export interface PlannedWork {
  readonly id: string;
  readonly kind: WorkKind;
  readonly title: string;
}

/** A stored `journal_works` row. */
export interface StoredWork {
  readonly id: string;
  readonly lessonId: string;
  readonly sourceLessonId: string | null;
  readonly kind: WorkKind;
  readonly planWorkId: string | null;
  readonly position: number;
  readonly total: number | null;
  readonly notHeld: boolean;
  readonly carriedFromLessonId: string | null;
  readonly version: number;
  /** A cell of the work holds a number. */
  readonly hasNumbers: boolean;
}

export interface Column {
  /** The stored row, `null` before the column's first write. */
  readonly workId: string | null;
  readonly planWorkId: string | null;
  readonly sourceLessonId: string | null;
  readonly kind: WorkKind;
  /** The plan's title; `null` for an unplanned work (the screen numbers it). */
  readonly title: string | null;
  readonly unplanned: boolean;
  /** Its place among the columns of its kind in the lesson, from 1. */
  readonly position: number;
  readonly total: number | null;
  readonly notHeld: boolean;
  readonly version: number | null;
  readonly carriedFrom: string | null;
  /** The lesson the row is stored at, when it is not this one (moved at the first write). */
  readonly storedAt: string | null;
}

/** Why homework given at a lesson makes no column. */
export type Ungraded = 'year_end' | 'group_closed';

export interface GivenHomework {
  readonly workId: string | null;
  readonly planWorkId: string | null;
  readonly title: string | null;
  /** The check lesson, `null` when there is none. */
  readonly checkAt: string | null;
  readonly ungraded: Ungraded | null;
  /** Task 8.8: marked "not given" at this lesson; it has no check lesson then. */
  readonly notGiven: boolean;
}

export interface LessonColumns {
  /** The lesson's row has an item of the journal's plan ("No plan" otherwise). */
  readonly planItem: boolean;
  readonly columns: readonly Column[];
  /** Works of the lesson marked "not held". */
  readonly notHeld: readonly Column[];
  /** The homeworks given at this lesson. */
  readonly given: readonly GivenHomework[];
  /** The lesson whose homeworks are this lesson's homework columns. */
  readonly source: string | null;
  /** The next lesson that checks homework given here: not cancelled, not "started but not held". */
  readonly next: string | null;
}

export interface ColumnsInput {
  /** Every lesson of the journal in the year. */
  readonly lessons: readonly ColumnLesson[];
  /** The works of each lesson's plan item, `null` for a lesson with no item; a lesson not named has none. */
  readonly planned: ReadonlyMap<string, readonly PlannedWork[] | null>;
  readonly stored: readonly StoredWork[];
  /** The journal has no run day left (7.1b decision 9): its last homework is "not checked, group closed". */
  readonly journalClosed: boolean;
  /** Task 8.8: the planned homeworks marked "not given", as `<source lesson>/<plan work>`. */
  readonly notGiven?: ReadonlySet<string>;
}

const eligible = (lesson: ColumnLesson): boolean =>
  !lesson.cancelled && !(lesson.started && !lesson.held);

function byStart(one: ColumnLesson, other: ColumnLesson): number {
  return one.startsAt.getTime() - other.startsAt.getTime() || one.id.localeCompare(other.id);
}

/** The columns of every lesson of `input.lessons`. */
export function lessonColumns(input: ColumnsInput): Map<string, LessonColumns> {
  const lessons = [...input.lessons].sort(byStart);
  const notGiven = input.notGiven ?? new Set<string>();
  const isNotGiven = (sourceId: string | null, planWorkId: string | null): boolean =>
    sourceId !== null && planWorkId !== null && notGiven.has(`${sourceId}/${planWorkId}`);
  // An empty row of a homework not given is not shown (spec review of the plan, must-fix 1).
  const hidden = (row: StoredWork): boolean =>
    row.kind === 'homework' &&
    isNotGiven(row.sourceLessonId, row.planWorkId) &&
    row.total === null &&
    !row.notHeld &&
    row.carriedFromLessonId === null &&
    !row.hasNumbers;
  const index = new Map(lessons.map((lesson, at) => [lesson.id, at]));
  const nextOf = (lessonId: string): string | null => {
    const at = index.get(lessonId);
    if (at === undefined) return null;
    for (let next = at + 1; next < lessons.length; next += 1) {
      const lesson = lessons[next];
      if (lesson !== undefined && eligible(lesson)) return lesson.id;
    }
    return null;
  };
  const sourceOf = (lessonId: string): string | null => {
    const at = index.get(lessonId);
    if (at === undefined) return null;
    for (let earlier = at - 1; earlier >= 0; earlier -= 1) {
      const lesson = lessons[earlier];
      if (lesson !== undefined && eligible(lesson)) return lesson.id;
    }
    return null;
  };
  const isEligible = (lessonId: string | null): boolean => {
    if (lessonId === null) return false;
    const at = index.get(lessonId);
    const lesson = at === undefined ? undefined : lessons[at];
    return lesson !== undefined && eligible(lesson);
  };

  /**
   * Where a stored row is shown; `null` only for an empty homework with no check lesson,
   * which is listed with "will not be graded" at the lesson where it was given. A row
   * with a total or "not held" and no check lesson stays at its own lesson (code review,
   * must-fix 1): nothing set ever leaves the grid.
   */
  const shownAt = (row: StoredWork): string | null => {
    if (row.kind !== 'homework' || row.hasNumbers) return row.lessonId;
    const held = row.total !== null || row.notHeld;
    let check: string | null = row.lessonId;
    if (row.carriedFromLessonId !== null) check = nextOf(row.carriedFromLessonId);
    else if (row.sourceLessonId !== null && isEligible(row.sourceLessonId)) {
      check = nextOf(row.sourceLessonId);
    }
    if (check !== null) return check;
    return held ? row.lessonId : null;
  };

  const storedAt = new Map<string, StoredWork[]>();
  const placed = new Map<string, string | null>();
  for (const row of [...input.stored].sort((a, b) => a.id.localeCompare(b.id))) {
    if (hidden(row)) continue;
    const at = shownAt(row);
    placed.set(row.id, at);
    if (at === null) continue;
    storedAt.set(at, [...(storedAt.get(at) ?? []), row]);
  }
  const plannedRow = new Map<string, StoredWork>();
  for (const row of input.stored) {
    if (row.planWorkId !== null && row.sourceLessonId !== null) {
      plannedRow.set(`${row.sourceLessonId}/${row.planWorkId}`, row);
    }
  }
  const unplannedOf = (sourceId: string, kind: WorkKind): StoredWork[] =>
    input.stored
      .filter(
        (row) => row.sourceLessonId === sourceId && row.kind === kind && row.planWorkId === null,
      )
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  const fromRow = (
    row: StoredWork,
    lessonId: string,
    title: string | null,
  ): Omit<Column, 'position'> => ({
    workId: row.id,
    planWorkId: row.planWorkId,
    sourceLessonId: row.sourceLessonId,
    kind: row.kind,
    title,
    unplanned: row.planWorkId === null,
    total: row.total,
    notHeld: row.notHeld,
    version: row.version,
    carriedFrom: row.carriedFromLessonId,
    storedAt: row.lessonId === lessonId ? null : row.lessonId,
  });

  const result = new Map<string, LessonColumns>();
  for (const lesson of lessons) {
    const here = storedAt.get(lesson.id) ?? [];
    const used = new Set<string>();
    const kindColumns = (kind: WorkKind, sourceId: string | null): Omit<Column, 'position'>[] => {
      const found: Omit<Column, 'position'>[] = [];
      if (sourceId !== null) {
        for (const work of (input.planned.get(sourceId) ?? []).filter((one) => one.kind === kind)) {
          const row = plannedRow.get(`${sourceId}/${work.id}`);
          if (
            kind === 'homework' &&
            isNotGiven(sourceId, work.id) &&
            (row === undefined || hidden(row))
          ) {
            continue;
          }
          if (row === undefined) {
            found.push({
              workId: null,
              planWorkId: work.id,
              sourceLessonId: sourceId,
              kind,
              title: work.title,
              unplanned: false,
              total: null,
              notHeld: false,
              version: null,
              carriedFrom: null,
              storedAt: null,
            });
          } else if (placed.get(row.id) === lesson.id) {
            used.add(row.id);
            found.push(fromRow(row, lesson.id, work.title));
          }
        }
        for (const row of unplannedOf(sourceId, kind)) {
          if (placed.get(row.id) !== lesson.id) continue;
          used.add(row.id);
          found.push(fromRow(row, lesson.id, null));
        }
      }
      // Carried in first, then any other row kept here (spec review must-fix 2).
      const rest = here
        .filter((row) => row.kind === kind && !used.has(row.id))
        .sort(
          (a, b) =>
            Number(b.carriedFromLessonId !== null) - Number(a.carriedFromLessonId !== null) ||
            a.id.localeCompare(b.id),
        );
      for (const row of rest) {
        used.add(row.id);
        found.push(fromRow(row, lesson.id, plannedTitle(input.planned, row)));
      }
      return found;
    };
    const source = sourceOf(lesson.id);
    // A cancelled or unresolved lesson shows only the rows kept at it.
    const open = eligible(lesson);
    const all = [
      ...kindColumns('classwork', open ? lesson.id : null),
      ...kindColumns('homework', open ? source : null),
    ];
    const numbered = (list: Omit<Column, 'position'>[]): Column[] => {
      const counts = { classwork: 0, homework: 0 };
      return list.map((column) => {
        counts[column.kind] += 1;
        return { ...column, position: counts[column.kind] };
      });
    };
    const given: GivenHomework[] = [];
    const checkAt = eligible(lesson) ? nextOf(lesson.id) : null;
    const ungraded: Ungraded | null =
      checkAt === null ? (input.journalClosed ? 'group_closed' : 'year_end') : null;
    for (const work of (input.planned.get(lesson.id) ?? []).filter(
      (one) => one.kind === 'homework',
    )) {
      const marked = isNotGiven(lesson.id, work.id);
      given.push({
        workId: plannedRow.get(`${lesson.id}/${work.id}`)?.id ?? null,
        planWorkId: work.id,
        title: work.title,
        checkAt: marked ? null : checkAt,
        ungraded: marked ? null : ungraded,
        notGiven: marked,
      });
    }
    for (const row of unplannedOf(lesson.id, 'homework')) {
      given.push({
        workId: row.id,
        planWorkId: null,
        title: null,
        checkAt,
        ungraded,
        notGiven: false,
      });
    }
    result.set(lesson.id, {
      planItem: (input.planned.get(lesson.id) ?? null) !== null,
      columns: numbered(all.filter((column) => !column.notHeld)),
      notHeld: numbered(all.filter((column) => column.notHeld)),
      given,
      source,
      next: nextOf(lesson.id),
    });
  }
  return result;
}

/** The plan title of a stored row whose plan work an item of the input still names. */
function plannedTitle(
  planned: ReadonlyMap<string, readonly PlannedWork[] | null>,
  row: StoredWork,
): string | null {
  if (row.planWorkId === null) return null;
  for (const works of planned.values()) {
    const found = works?.find((work) => work.id === row.planWorkId);
    if (found !== undefined) return found.title;
  }
  return null;
}

/** The column of `lessonId` named by a write: its row, or its plan work and source. */
export function columnAt(
  columns: ReadonlyMap<string, LessonColumns>,
  lessonId: string,
  key:
    { readonly workId: string } | { readonly planWorkId: string; readonly sourceLessonId: string },
): Column | null {
  const lesson = columns.get(lessonId);
  if (lesson === undefined) return null;
  const all = [...lesson.columns, ...lesson.notHeld];
  return (
    all.find((column) =>
      'workId' in key
        ? column.workId === key.workId
        : column.workId === null &&
          column.planWorkId === key.planWorkId &&
          column.sourceLessonId === key.sourceLessonId,
    ) ?? null
  );
}
