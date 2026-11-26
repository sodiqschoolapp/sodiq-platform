/**
 * The work columns of a journal's lessons (task 8.1, pull request #217; task
 * 11.24; `07`, Entering data; `09`, In the journal; `edge/journal`,
 * Entering). Pure: the grid and every write route call it with what they
 * read, so the grid and the writes agree on which columns a lesson has.
 * Nothing is stored by a read; a column with no row (`workId` null) gets one
 * at its first write.
 *
 * - A homework is graded at the lesson where it was given (owner, 25 November
 *   2026; `07`, Homework column): the classwork and the homework columns of
 *   lesson L are the works of L's plan item, then the works added by hand at
 *   L. No other lesson has a column for them. A planned work uses its stored
 *   row (`planWorkId`, linked at its first write or by the takeover of the
 *   plan save, review correction 1); a hand-added work with no link is an
 *   unplanned column.
 * - Every stored row is a column of its own lesson (0186 keeps a work at the
 *   lesson where it was given), after the planned ones when the plan no longer
 *   names it there: nothing typed leaves the grid.
 * - A work marked "not held" leaves the columns (`09`: "its column is
 *   removed from that lesson") and is listed apart, so it can be undone.
 * - A planned homework marked "not given" at its lesson (task 8.8,
 *   `edge/lesson-plans`: "a homework not given has no column") makes no
 *   column, and an empty stored row of it is not shown (a row with data
 *   refuses the mark, 0130). It stays in the lesson's `given` list with
 *   `notGiven`.
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
  /** Task 10.8: added in the journal at a lesson with no plan item (`added_in_journal_at`). */
  readonly addedInJournal?: boolean;
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
  /** Task 10.6: the title typed for a work added by hand (`null` for a planned one or one added before). */
  readonly title: string | null;
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
  /**
   * The plan's title, or for an unplanned work the title typed when it was
   * added (task 10.6); `null` for a work added by hand before 10.6 (the
   * screen numbers it).
   */
  readonly title: string | null;
  readonly unplanned: boolean;
  /** Its place among the columns of its kind in the lesson, from 1. */
  readonly position: number;
  readonly total: number | null;
  readonly notHeld: boolean;
  readonly version: number | null;
}

export interface GivenHomework {
  readonly workId: string | null;
  readonly planWorkId: string | null;
  readonly title: string | null;
  /** Task 8.8: marked "not given" at this lesson; it has no column then. */
  readonly notGiven: boolean;
}

export interface LessonColumns {
  /**
   * The lesson's row has an item of the journal's plan with a topic ("No plan" otherwise). Task
   * 10.8: an item the journal's add created has no topic until the owner writes it, and counts as
   * missing until then (`09`, In the journal; plan decision 4).
   */
  readonly planItem: boolean;
  readonly columns: readonly Column[];
  /** Works of the lesson marked "not held". */
  readonly notHeld: readonly Column[];
  /** The homeworks given at this lesson, which are its homework columns (`09`, In the journal). */
  readonly given: readonly GivenHomework[];
}

export interface ColumnsInput {
  /** Every lesson of the journal in the year. */
  readonly lessons: readonly ColumnLesson[];
  /** The works of each lesson's plan item, `null` for a lesson with no item; a lesson not named has none. */
  readonly planned: ReadonlyMap<string, readonly PlannedWork[] | null>;
  readonly stored: readonly StoredWork[];
  /** Task 8.8: the planned homeworks marked "not given", as `<lesson>/<plan work>`. */
  readonly notGiven?: ReadonlySet<string>;
  /** Task 10.8: the lessons whose plan item has no topic yet (made by a work added in the journal). */
  readonly topicless?: ReadonlySet<string>;
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
  const isNotGiven = (lessonId: string, planWorkId: string | null): boolean =>
    planWorkId !== null && notGiven.has(`${lessonId}/${planWorkId}`);
  // An empty row of a homework not given is not shown (spec review of the plan of 8.8, must-fix 1).
  const hidden = (row: StoredWork): boolean =>
    row.kind === 'homework' &&
    isNotGiven(row.lessonId, row.planWorkId) &&
    row.total === null &&
    !row.notHeld &&
    !row.hasNumbers;

  const storedAt = new Map<string, StoredWork[]>();
  for (const row of [...input.stored].sort((a, b) => a.id.localeCompare(b.id))) {
    if (hidden(row)) continue;
    storedAt.set(row.lessonId, [...(storedAt.get(row.lessonId) ?? []), row]);
  }

  const fromRow = (row: StoredWork, title: string | null): Omit<Column, 'position'> => ({
    workId: row.id,
    planWorkId: row.planWorkId,
    sourceLessonId: row.sourceLessonId,
    kind: row.kind,
    title,
    unplanned: row.planWorkId === null,
    total: row.total,
    notHeld: row.notHeld,
    version: row.version,
  });

  const result = new Map<string, LessonColumns>();
  for (const lesson of lessons) {
    const here = storedAt.get(lesson.id) ?? [];
    const planned = input.planned.get(lesson.id) ?? [];
    // A cancelled or unresolved lesson shows only the rows kept at it.
    const open = eligible(lesson);
    const used = new Set<string>();
    const kindColumns = (kind: WorkKind): Omit<Column, 'position'>[] => {
      const found: Omit<Column, 'position'>[] = [];
      if (open) {
        for (const work of planned.filter((one) => one.kind === kind)) {
          const row = here.find((one) => one.planWorkId === work.id);
          if (kind === 'homework' && isNotGiven(lesson.id, work.id) && row === undefined) continue;
          if (row === undefined) {
            found.push({
              workId: null,
              planWorkId: work.id,
              sourceLessonId: lesson.id,
              kind,
              title: work.title,
              unplanned: false,
              total: null,
              notHeld: false,
              version: null,
            });
          } else {
            used.add(row.id);
            found.push(fromRow(row, work.title));
          }
        }
        for (const row of here
          .filter((one) => one.kind === kind && one.planWorkId === null)
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
          used.add(row.id);
          found.push(fromRow(row, row.title));
        }
      }
      // Any other row kept here (its plan no longer names it, or the lesson is not open).
      for (const row of here.filter((one) => one.kind === kind && !used.has(one.id))) {
        used.add(row.id);
        found.push(fromRow(row, plannedTitle(input.planned, row)));
      }
      return found;
    };
    const all = [...kindColumns('classwork'), ...kindColumns('homework')];
    const numbered = (list: Omit<Column, 'position'>[]): Column[] => {
      const counts = { classwork: 0, homework: 0 };
      return list.map((column) => {
        counts[column.kind] += 1;
        return { ...column, position: counts[column.kind] };
      });
    };
    const given: GivenHomework[] = [];
    for (const work of planned.filter((one) => one.kind === 'homework')) {
      given.push({
        workId: here.find((one) => one.planWorkId === work.id)?.id ?? null,
        planWorkId: work.id,
        title: work.title,
        notGiven: isNotGiven(lesson.id, work.id),
      });
    }
    for (const row of here
      .filter((one) => one.kind === 'homework' && one.planWorkId === null)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
      given.push({ workId: row.id, planWorkId: null, title: row.title, notGiven: false });
    }
    result.set(lesson.id, {
      planItem:
        (input.planned.get(lesson.id) ?? null) !== null && input.topicless?.has(lesson.id) !== true,
      columns: numbered(all.filter((column) => !column.notHeld)),
      notHeld: numbered(all.filter((column) => column.notHeld)),
      given,
    });
  }
  return result;
}

/**
 * The plan title of a stored row whose plan work an item of the input still
 * names; the typed title of a work added by hand (task 10.6).
 */
function plannedTitle(
  planned: ReadonlyMap<string, readonly PlannedWork[] | null>,
  row: StoredWork,
): string | null {
  if (row.planWorkId === null) return row.title;
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
