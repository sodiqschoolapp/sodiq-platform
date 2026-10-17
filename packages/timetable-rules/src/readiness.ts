/**
 * The "ready when" checks of steps 1 to 4 of the draft builder (06, Building
 * a timetable; task 5.3a, pull request #127). The caller reads the facts on
 * the dates of decision 2 (templates weekday by weekday from the later of the
 * start date and today, availability from the entry in force on that date)
 * and passes them in; nothing here reads a clock or a table.
 */
import { ROOM_PROBLEMS, type LoadProblem } from './load.js';
import { PREFERENCES, type Preference, type Weights } from './preferences.js';

/** A slot of a cell's day: its kind and its clock minutes. */
export type CellSlot = readonly [kind: 'lesson' | 'break', start: number, end: number];

/**
 * One cell of the table of step 1: the template of a grade on a weekday, read
 * on `date` (the weekday's first date on or after the later of the start date
 * and today), or `null` when none applies.
 */
export interface TemplateCell {
  readonly weekday: number;
  readonly grade: number;
  readonly date: string;
  readonly template: { readonly id: string; readonly slots: readonly CellSlot[] } | null;
}

/** A cell named by its weekday and grade. */
export interface CellKey {
  readonly weekday: number;
  readonly grade: number;
}

export interface TemplatesReadiness {
  readonly ready: boolean;
  readonly startPast: boolean;
  readonly confirmed: boolean;
  /** The cells that differ from the confirmed table (none while nothing is confirmed). */
  readonly changed: CellKey[];
  readonly missing: CellKey[];
}

/**
 * What a cell is compared on (review correction 1): the template and the
 * kind, start and end of each slot; never its date, which moves with the
 * start date, nor the template's name.
 */
const valueOf = (cell: TemplateCell | undefined): string =>
  cell === undefined
    ? 'absent'
    : cell.template === null
      ? 'none'
      : JSON.stringify([cell.template.id, cell.template.slots]);

const keyOf = (cell: CellKey): string => `${cell.weekday}:${cell.grade}`;

const byWeekdayAndGrade = (a: CellKey, b: CellKey): number =>
  a.grade - b.grade || a.weekday - b.weekday;

/**
 * Step 1: "The start date is set and the table of templates per weekday and
 * grade is confirmed." Decision 5: not ready while the start date is before
 * today. Decision 4: a template in every cell. Decision 3: confirmed while
 * every cell of the current table equals the confirmed one.
 */
export function templatesReadiness(input: {
  readonly startsOn: string;
  readonly today: string;
  readonly cells: readonly TemplateCell[];
  readonly confirmed: readonly TemplateCell[] | null;
}): TemplatesReadiness {
  const startPast = input.startsOn < input.today;
  const stored = new Map((input.confirmed ?? []).map((cell) => [keyOf(cell), cell]));
  const changed =
    input.confirmed === null
      ? []
      : input.cells
          .filter((cell) => valueOf(stored.get(keyOf(cell))) !== valueOf(cell))
          .map(({ weekday, grade }) => ({ weekday, grade }))
          .sort(byWeekdayAndGrade);
  const missing = input.cells
    .filter((cell) => cell.template === null)
    .map(({ weekday, grade }) => ({ weekday, grade }))
    .sort(byWeekdayAndGrade);
  const confirmed = input.confirmed !== null && changed.length === 0;
  return {
    ready: !startPast && confirmed && missing.length === 0 && input.cells.length > 0,
    startPast,
    confirmed,
    changed,
    missing,
  };
}

export interface LoadReadiness {
  readonly ready: boolean;
  readonly empty: boolean;
  /** The rows with a problem of step 2 (every problem but the room problems). */
  readonly rows: string[];
  readonly leftRows: number;
  readonly classesOver: string[];
}

/** Step 2 problems: every problem of a row but those step 4 reports (decision 7). */
const stepTwoProblems = (problems: readonly LoadProblem[]): LoadProblem[] =>
  problems.filter((problem) => !ROOM_PROBLEMS.includes(problem));

/**
 * Step 2: "The weekly lessons of every class fit into the week's lesson
 * slots, and every load has a teacher or a vacancy." Decisions 7 to 9: no row
 * with a problem, at least one row, and no row a copy left still waiting.
 */
export function loadReadiness(input: {
  readonly rows: readonly { readonly id: string; readonly problems: readonly LoadProblem[] }[];
  readonly leftRows: number;
  readonly classes: readonly {
    readonly id: string;
    readonly lessons: number;
    readonly lessonSlots: number;
  }[];
}): LoadReadiness {
  const rows = input.rows
    .filter((row) => stepTwoProblems(row.problems).length > 0)
    .map((row) => row.id);
  const classesOver = input.classes
    .filter((one) => one.lessons > one.lessonSlots)
    .map((one) => one.id);
  const empty = input.rows.length === 0;
  return {
    ready: !empty && rows.length === 0 && input.leftRows === 0 && classesOver.length === 0,
    empty,
    rows,
    leftRows: input.leftRows,
    classesOver,
  };
}

export interface TeachersReadiness {
  readonly ready: boolean;
  readonly noHours: string[];
  readonly over: string[];
}

/**
 * Step 3: "No teacher has more lessons than free slots" (decision 10): the
 * lessons of the draft against the free slots in the branch, `null` when no
 * hours entry is in force (no slot lies inside availability). Teachers and
 * vacancies alike (06, Rules, the vacancy row).
 */
export function teachersReadiness(
  teachers: readonly {
    readonly id: string;
    readonly lessons: number;
    readonly freeSlots: number | null;
  }[],
): TeachersReadiness {
  const noHours = teachers.filter((one) => one.freeSlots === null).map((one) => one.id);
  const over = teachers
    .filter((one) => one.freeSlots !== null && one.lessons > one.freeSlots)
    .map((one) => one.id);
  return { ready: noHours.length === 0 && over.length === 0, noHours, over };
}

export interface RoomsReadiness {
  readonly ready: boolean;
  /** The rows that name a closed room (`load_room_closed`). */
  readonly closed: string[];
  /** The rows whose room type no room of the branch that is not closed has (`room_type_none`). */
  readonly typeNone: string[];
}

/**
 * Step 4: "Every subject that needs a special room has one" (decision 11): a
 * row's room type is met by a room of that type that is not closed (a room
 * under repair counts, 3.4a decision 13), and no row names a closed room.
 */
export function roomsReadiness(input: {
  readonly rows: readonly {
    readonly id: string;
    readonly roomType: string | null;
    readonly problems: readonly LoadProblem[];
  }[];
  readonly rooms: readonly { readonly type: string; readonly closed: boolean }[];
}): RoomsReadiness {
  const open = new Set(input.rooms.filter((room) => !room.closed).map((room) => room.type));
  const closed = input.rows
    .filter((row) => row.problems.some((problem) => ROOM_PROBLEMS.includes(problem)))
    .map((row) => row.id);
  const typeNone = input.rows
    .filter((row) => row.roomType !== null && !open.has(row.roomType))
    .map((row) => row.id);
  return { ready: closed.length === 0 && typeNone.length === 0, closed, typeNone };
}

export interface RulesReadiness {
  readonly ready: boolean;
  readonly confirmed: boolean;
  /** The preferences whose weight differs from the confirmed one (none while nothing is confirmed). */
  readonly changed: Preference[];
}

/**
 * Step 5: "Confirmed" (task 5.3b-1, decision 2): ready while the weights
 * confirmed equal the weights stored now; a later change of a weight makes it
 * not ready with no write.
 */
export function rulesReadiness(input: {
  readonly weights: Weights;
  readonly confirmed: Weights | null;
}): RulesReadiness {
  const { confirmed } = input;
  const changed =
    confirmed === null
      ? []
      : PREFERENCES.filter((preference) => input.weights[preference] !== confirmed[preference]);
  const ready = confirmed !== null && changed.length === 0;
  return { ready, confirmed: ready, changed };
}

/** Ready for generation: every step is ready (steps 1 to 5; task 5.3b-1). */
export const draftReady = (steps: readonly { readonly ready: boolean }[]): boolean =>
  steps.every((step) => step.ready);
