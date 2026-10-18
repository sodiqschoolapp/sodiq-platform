/**
 * The impact preview of a publish (task 5.5a-2b-1): what the new version
 * changes on the dates it covers, and the transition week of a start that is
 * not the first day of its week.
 *
 * docs/spec/06-timetable.md, How surprises are prevented, Impact preview:
 * "Before publishing, the system lists the teachers, classes and rooms
 * affected, the lessons that will be created, moved and removed". What a
 * change does to existing data: "Lesson moved to another day or slot",
 * "Room changed", "Teacher changed". edge/timetable, Versions and drafts, "A
 * version starts on a Wednesday": "The preview shows, for each class and
 * subject, the lessons of the transition week against the load. Differences
 * are warnings to acknowledge."
 *
 * Two lessons are the same lesson when they have the same class or group,
 * subject, date, start and end; a different teacher or room makes it
 * `changed` (decision 3). The rest are paired per class or group, subject and
 * Monday-to-Sunday week in order of date and start (`moved`); what is left is
 * `created` or `removed`. Lessons created as cancelled are not given here
 * (decision 4).
 */
import { addDays, type DatedLesson } from './dated.js';
import { weekdayOf } from './templates.js';

/** A lesson of a date as the preview compares it. */
export interface ImpactLesson {
  readonly date: string;
  /** The weekday of the pattern the lesson comes from (a worked Saturday follows another). */
  readonly weekday: number;
  readonly start: number;
  readonly end: number;
  /** The class or group. */
  readonly unitId: string;
  readonly subjectId: string;
  /** The class, or the classes the group draws from. */
  readonly classIds: readonly string[];
  /** The teacher or vacancy; none for a Tutor lesson with no Tutor on the date. */
  readonly teacherIds: readonly string[];
  readonly roomId: string | null;
}

/** A dated lesson of `datedPattern` as the preview compares it. */
export function impactLessonOf(lesson: DatedLesson): ImpactLesson {
  const { placement } = lesson;
  return {
    date: lesson.date,
    weekday: lesson.followsWeekday,
    start: placement.start,
    end: placement.end,
    unitId: placement.classId ?? placement.groupId ?? '',
    subjectId: placement.subjectId ?? '',
    classIds: placement.classIds,
    teacherIds: [...placement.teacherIds].sort(),
    roomId: placement.roomId,
  };
}

export type ImpactKind = 'created' | 'moved' | 'removed' | 'changed';

/** Where a lesson is, without its date: the pattern's weekday, times, teacher and room. */
export interface ImpactSlot {
  readonly weekday: number;
  readonly start: number;
  readonly end: number;
  readonly teacherIds: readonly string[];
  readonly roomId: string | null;
}

/** Lessons of one class or group and subject changed the same way, on `count` dates (decision 5). */
export interface ImpactChange {
  readonly kind: ImpactKind;
  readonly unitId: string;
  readonly subjectId: string;
  readonly classIds: readonly string[];
  readonly before: ImpactSlot | null;
  readonly after: ImpactSlot | null;
  readonly count: number;
  readonly firstDate: string;
  readonly lastDate: string;
}

export interface PublishImpact {
  readonly changes: readonly ImpactChange[];
  readonly counts: Readonly<Record<ImpactKind | 'unchanged', number>>;
  /** Of every lesson that is not unchanged, on either side (decision 6). */
  readonly teacherIds: readonly string[];
  readonly classIds: readonly string[];
  readonly roomIds: readonly string[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byTime = (a: ImpactLesson, b: ImpactLesson): number =>
  compare(a.date, b.date) || a.start - b.start || a.end - b.end;

/** The Monday of the week of a date. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

const slotOf = (lesson: ImpactLesson): ImpactSlot => ({
  weekday: lesson.weekday,
  start: lesson.start,
  end: lesson.end,
  teacherIds: lesson.teacherIds,
  roomId: lesson.roomId,
});

const sameStaffing = (a: ImpactLesson, b: ImpactLesson): boolean =>
  a.roomId === b.roomId &&
  a.teacherIds.length === b.teacherIds.length &&
  a.teacherIds.every((id, index) => b.teacherIds[index] === id);

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [item]);
    else list.push(item);
  }
  return groups;
}

/** What publishing `after` in place of `before` does, over the same dates (see the file's comment). */
export function publishImpact(input: {
  readonly before: readonly ImpactLesson[];
  readonly after: readonly ImpactLesson[];
}): PublishImpact {
  const pairs: { kind: ImpactKind; before: ImpactLesson | null; after: ImpactLesson | null }[] = [];
  let unchanged = 0;
  const leftBefore: ImpactLesson[] = [];
  const leftAfter: ImpactLesson[] = [];

  // The same lesson: same unit, subject, date and times.
  const timeKey = (one: ImpactLesson) =>
    [one.unitId, one.subjectId, one.date, one.start, one.end].join('|');
  const beforeAt = groupBy(input.before, timeKey);
  const afterAt = groupBy(input.after, timeKey);
  for (const key of new Set([...beforeAt.keys(), ...afterAt.keys()])) {
    const olds = [...(beforeAt.get(key) ?? [])];
    const news = [...(afterAt.get(key) ?? [])];
    // Equal staffing first, so an unchanged lesson is never reported changed.
    for (let i = olds.length - 1; i >= 0; i -= 1) {
      const old = olds[i];
      if (old === undefined) continue;
      const match = news.findIndex((one) => sameStaffing(old, one));
      if (match >= 0) {
        unchanged += 1;
        olds.splice(i, 1);
        news.splice(match, 1);
      }
    }
    while (olds.length > 0 && news.length > 0) {
      const old = olds.shift();
      const now = news.shift();
      if (old !== undefined && now !== undefined) {
        pairs.push({ kind: 'changed', before: old, after: now });
      }
    }
    leftBefore.push(...olds);
    leftAfter.push(...news);
  }

  // Moved: paired per unit, subject and week, in order of date and start.
  const weekKey = (one: ImpactLesson) => [one.unitId, one.subjectId, mondayOf(one.date)].join('|');
  const beforeWeek = groupBy(leftBefore, weekKey);
  const afterWeek = groupBy(leftAfter, weekKey);
  for (const key of new Set([...beforeWeek.keys(), ...afterWeek.keys()])) {
    const olds = [...(beforeWeek.get(key) ?? [])].sort(byTime);
    const news = [...(afterWeek.get(key) ?? [])].sort(byTime);
    const paired = Math.min(olds.length, news.length);
    for (let i = 0; i < paired; i += 1) {
      pairs.push({ kind: 'moved', before: olds[i] ?? null, after: news[i] ?? null });
    }
    for (const old of olds.slice(paired)) pairs.push({ kind: 'removed', before: old, after: null });
    for (const now of news.slice(paired)) pairs.push({ kind: 'created', before: null, after: now });
  }

  // One line per kind, unit, subject and both slots (decision 5).
  const lines = new Map<string, { change: ImpactChange; dates: string[] }>();
  const counts = { created: 0, moved: 0, removed: 0, changed: 0, unchanged };
  const teachers = new Set<string>();
  const classes = new Set<string>();
  const rooms = new Set<string>();
  for (const pair of pairs) {
    counts[pair.kind] += 1;
    const lesson = pair.after ?? pair.before;
    if (lesson === null) continue;
    for (const side of [pair.before, pair.after]) {
      if (side === null) continue;
      side.teacherIds.forEach((id) => teachers.add(id));
      side.classIds.forEach((id) => classes.add(id));
      if (side.roomId !== null) rooms.add(side.roomId);
    }
    const before = pair.before === null ? null : slotOf(pair.before);
    const after = pair.after === null ? null : slotOf(pair.after);
    const key = JSON.stringify([pair.kind, lesson.unitId, lesson.subjectId, before, after]);
    const dates = [pair.before?.date, pair.after?.date].filter(
      (one): one is string => one !== undefined,
    );
    const found = lines.get(key);
    if (found === undefined) {
      lines.set(key, {
        change: {
          kind: pair.kind,
          unitId: lesson.unitId,
          subjectId: lesson.subjectId,
          classIds: [...lesson.classIds].sort(),
          before,
          after,
          count: 1,
          firstDate: '',
          lastDate: '',
        },
        dates,
      });
    } else {
      found.change = { ...found.change, count: found.change.count + 1 };
      found.dates.push(...dates);
    }
  }
  const kinds: readonly ImpactKind[] = ['created', 'moved', 'removed', 'changed'];
  const changes = [...lines.values()]
    .map(({ change, dates }) => {
      const sorted = [...dates].sort(compare);
      return { ...change, firstDate: sorted[0] ?? '', lastDate: sorted[sorted.length - 1] ?? '' };
    })
    .sort(
      (a, b) =>
        kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
        compare(a.unitId, b.unitId) ||
        compare(a.subjectId, b.subjectId) ||
        compare(a.firstDate, b.firstDate) ||
        (a.before?.weekday ?? a.after?.weekday ?? 0) -
          (b.before?.weekday ?? b.after?.weekday ?? 0) ||
        (a.before?.start ?? a.after?.start ?? 0) - (b.before?.start ?? b.after?.start ?? 0),
    );
  return {
    changes,
    counts,
    teacherIds: [...teachers].sort(compare),
    classIds: [...classes].sort(compare),
    roomIds: [...rooms].sort(compare),
  };
}

/** A class or group and subject in the transition week (review correction 1: every one is listed). */
export interface TransitionRow {
  readonly unitId: string;
  readonly subjectId: string;
  /** The lessons of the week before the start, each date from the version in force on it. */
  readonly before: number;
  /** The new version's lessons of the week from the start. */
  readonly after: number;
  /** The new version's lessons per week for it; 0 when it has none. */
  readonly lessonsPerWeek: number;
  readonly differs: boolean;
}

export interface TransitionWeek {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly rows: readonly TransitionRow[];
}

/**
 * The transition week of a start (decision 10 with review correction 2): the
 * Monday-to-Sunday week of the start, given only when a date of it before the
 * start has lessons (`before`, which `datedPattern` gives only on dates in a
 * quarter). Every class or group and subject of the earlier lessons, the new
 * lessons or the new load is a row; `differs` when the week's lessons differ
 * from the load.
 */
export function transitionWeek(input: {
  readonly startsOn: string;
  /** The lessons of the week's dates before the start. */
  readonly before: readonly ImpactLesson[];
  /** The new version's lessons of the week's dates from the start. */
  readonly after: readonly ImpactLesson[];
  /** The new version's lessons per week by class or group and subject. */
  readonly load: readonly { unitId: string; subjectId: string; lessonsPerWeek: number }[];
}): TransitionWeek | null {
  const weekStart = mondayOf(input.startsOn);
  const weekEnd = addDays(weekStart, 6);
  const inWeek = (one: ImpactLesson) => weekStart <= one.date && one.date <= weekEnd;
  const before = input.before.filter((one) => inWeek(one) && one.date < input.startsOn);
  const after = input.after.filter((one) => inWeek(one) && one.date >= input.startsOn);
  if (before.length === 0) {
    return null;
  }
  const keyOf = (unitId: string, subjectId: string) => `${unitId}|${subjectId}`;
  const rows = new Map<
    string,
    { unitId: string; subjectId: string; before: number; after: number; lessonsPerWeek: number }
  >();
  const rowOf = (unitId: string, subjectId: string) => {
    const key = keyOf(unitId, subjectId);
    let row = rows.get(key);
    if (row === undefined) {
      row = { unitId, subjectId, before: 0, after: 0, lessonsPerWeek: 0 };
      rows.set(key, row);
    }
    return row;
  };
  for (const one of input.load)
    rowOf(one.unitId, one.subjectId).lessonsPerWeek += one.lessonsPerWeek;
  for (const one of before) rowOf(one.unitId, one.subjectId).before += 1;
  for (const one of after) rowOf(one.unitId, one.subjectId).after += 1;
  return {
    weekStart,
    weekEnd,
    rows: [...rows.values()]
      .map((row) => ({ ...row, differs: row.before + row.after !== row.lessonsPerWeek }))
      .sort((a, b) => compare(a.unitId, b.unitId) || compare(a.subjectId, b.subjectId)),
  };
}
