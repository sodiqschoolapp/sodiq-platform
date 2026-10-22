import { createHash } from 'node:crypto';
import {
  listName,
  weekdaySchema,
  type PreviewNamesAnswer,
  type PublishImpactAnswer,
  type TransitionRowAnswer,
} from '@sodiq/shared';
import {
  addDays,
  impactLessonOf,
  mondayOf,
  publishImpact,
  transitionWeek,
  type DatedPattern,
  type ImpactChange,
  type ImpactLesson,
} from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import { runAbsences } from './absences-read.js';
import { runClosures } from './rooms-out-read.js';
import { datedLessonsOf, type DatedFindings } from './dated-check.js';
import {
  keepsOfRun,
  needKeyOf,
  patternDateOf,
  vacanciesOf,
  writtenTeacherOf,
  type KeepLine,
} from './dated-lessons.js';
import type { SortedBulk } from './bulk-cancels-kept.js';
import type { DayWritePlan, SortedDayChange } from './day-changes-kept.js';
import type { KeptExam } from './exams-kept.js';
import type { SortedSubstitution } from './substitutions-kept.js';
import type { PatternState } from './pattern.service.js';
import { hasStoredLessons, storedImpactLessons, storedLessonRows } from './stored-lessons.js';
import type { VersionRow } from './timetable.service.js';

/** How the preview reads another version: its row and its pattern state. */
export interface VersionReader {
  readonly versionRow: (id: string) => Promise<VersionRow>;
  readonly stateOf: (version: VersionRow) => Promise<PatternState>;
}

/**
 * The stored one-day changes of the dates written, sorted (task 5.6a-5a): the
 * key of the sorting, every item (the carried versions' too), and the stored
 * lessons a kept move from outside a run keeps, by the carried version (`null`
 * for the published one's run), shown on the "after" side.
 */
export interface ImpactDays {
  readonly key: string;
  readonly items: readonly SortedDayChange[];
  /** Task 5.6a-5b-1: the bulk cancels of the runs, sorted. */
  readonly bulk: readonly SortedBulk[];
  readonly keptStored: ReadonlyMap<string | null, ReadonlySet<string>>;
  /** Task 5.6c-3a: the standing exams of the runs, sorted. */
  readonly exams: readonly KeptExam[];
  /** Task 5.7b-3: the stored substitutions of the runs, sorted. */
  readonly substitutions: readonly SortedSubstitution[];
  /**
   * Task 6.1b-1: the write plan of the published version's run with no
   * decision taken, which the lessons with data are read with
   * (`keepsOfRun`); `null` for a run with nothing sorted.
   */
  readonly plan: DayWritePlan | null;
}

/** The impact preview and the key of its transition week, as the publish compares it. */
export interface Impact {
  readonly answer: PublishImpactAnswer;
  /** The differing rows of the transition week, for the audit entry of the publish (decision 11). */
  readonly acknowledged: readonly TransitionRowAnswer[];
}

/**
 * Decision 11 with review correction 1: the key of the differing rows of a
 * draft on a start; the draft is part of it, so a key shown for one draft
 * never acknowledges another (permission review, should-fix 4).
 */
export function transitionKeyOf(
  versionId: string,
  startsOn: string,
  rows: readonly TransitionRowAnswer[],
): string {
  return createHash('sha256').update(JSON.stringify({ versionId, startsOn, rows })).digest('hex');
}

/**
 * The impact preview of a publish of the draft on `startsOn` (task 5.5a-2b-1,
 * pull request #142; `06`, How surprises are prevented, Impact preview). The
 * draft's lessons of the dates (`draftDated`, from the dated check) are
 * compared with the lessons that the published version in force before the
 * start gives on the same dates (decision 2; a later published version is
 * refused by 5.5a-1, decision 3). The transition week reads each date before
 * the start from the published version in force on that date (spec review
 * must-fix 1), and the draft's load (decision 10).
 *
 * Task 5.5b-2 (pull request #154): the lessons of a published version are
 * the ones stored (`storedImpactLessons`), and a version with none stored,
 * published before 0079, is expanded from its pattern (decision 2). The
 * "after" sides carry the needs-a-teacher marks of their dated check, as the
 * publish writes them (`writtenTeacherOf`, decision 5).
 */
export async function impactOf(
  transaction: Transaction,
  reader: VersionReader,
  draft: PatternState,
  draftFindings: DatedFindings,
  startsOn: string,
  days: ImpactDays,
  carried: readonly CarriedImpact[] = [],
): Promise<Impact> {
  const { data } = draft.pattern.model;
  const lastDate = data.versionEnd;
  // Task 5.5a-3a, decision 7: every published version of the year up to the
  // draft's last date, so that after a replace each date reads the version in
  // force on it before the publish; a version runs until the next starts.
  const published = await transaction
    .selectFrom('timetable_versions')
    .select(['id', 'number', 'starts_on'])
    .where('branch_id', '=', draft.version.branch_id)
    .where('academic_year_id', '=', draft.version.academic_year_id)
    .where('status', '=', 'published')
    .where('starts_on', '<=', lastDate)
    .orderBy('starts_on', 'desc')
    .orderBy('number', 'desc')
    .execute();
  const inForceOn = (date: string) => published.find((one) => one.starts_on <= date) ?? null;

  const states = new Map<string, PatternState>();
  const classesOfUnit = new Map<string, readonly string[]>();
  const knowUnits = (state: PatternState) => {
    for (const unit of state.pattern.model.data.units) classesOfUnit.set(unit.id, unit.classIds);
  };
  knowUnits(draft);
  for (const one of carried) knowUnits(one.state);
  const stateOf = async (id: string): Promise<PatternState> => {
    const known = states.get(id);
    if (known !== undefined) return known;
    const state = await reader.stateOf(await reader.versionRow(id));
    states.set(id, state);
    knowUnits(state);
    return state;
  };
  const storedOf = new Map<string, boolean>();
  const isStored = async (id: string): Promise<boolean> => {
    const known = storedOf.get(id);
    if (known !== undefined) return known;
    const found = await hasStoredLessons(transaction, id);
    storedOf.set(id, found);
    return found;
  };
  const storedLessons = (from: string, to: string, cancelled: 'one_day' | 'none') =>
    storedImpactLessons(transaction, {
      branchId: draft.version.branch_id,
      firstDate: from,
      lastDate: to,
      classIdsOf: (unitId) => classesOfUnit.get(unitId),
      cancelled,
    });
  const lessonsOf = async (
    id: string,
    from: string,
    to: string,
    cancelled: 'one_day' | 'none',
  ): Promise<ImpactLesson[]> => {
    const state = await stateOf(id);
    if (await isStored(id)) return storedLessons(from, to, cancelled);
    const { dated } = await datedLessonsOf(transaction, state, from, to);
    return dated.lessons.map(impactLessonOf);
  };

  const beforeVersion = inForceOn(startsOn);
  const before: ImpactLesson[] = [];
  for (const stretch of stretchesOf(published, startsOn, lastDate)) {
    before.push(...(await lessonsOf(stretch.id, stretch.from, stretch.to, 'one_day')));
  }
  // Task 5.6a-5a: a kept move from outside the run keeps its stored lessons.
  // Task 5.7a-1 (code review finding 2): the lessons an absence can put
  // under "needs a teacher": a kept stored lesson cancelled with a reason or
  // for an exam is cancelled, never counted.
  const absenceLessons: ImpactLesson[] = [];
  const keptStoredOf = async (version: string | null, from: string, to: string) => {
    const ids = days.keptStored.get(version);
    if (ids === undefined || ids.size === 0) return [];
    const rows = await storedLessonRows(transaction, {
      branchId: draft.version.branch_id,
      firstDate: from,
      lastDate: to,
      classIdsOf: (unitId) => classesOfUnit.get(unitId),
      cancelled: 'one_day',
      lock: false,
    });
    const kept = rows.filter((row) => ids.has(row.id));
    absenceLessons.push(...kept.filter((row) => row.cancelCause === null).map((row) => row.lesson));
    return kept.map((row) => row.lesson);
  };
  const written = await writtenLessonsOf(transaction, draftFindings);
  absenceLessons.push(...written);
  const after = [...written, ...(await keptStoredOf(null, startsOn, lastDate))];
  const own = publishImpact({ before, after });
  // Spec review must-fix 1: each carried version over its own run.
  const carriedImpacts: { one: CarriedImpact; impact: ReturnType<typeof publishImpact> }[] = [];
  for (const one of carried) {
    const oneWritten = await writtenLessonsOf(transaction, one.after);
    absenceLessons.push(...oneWritten);
    const oneAfter = [
      ...oneWritten,
      ...(await keptStoredOf(one.versionId, one.firstDate, one.lastDate)),
    ];
    carriedImpacts.push({
      one,
      impact: publishImpact({
        before: (await isStored(one.versionId))
          ? await storedLessons(one.firstDate, one.lastDate, 'one_day')
          : one.before.lessons.map(impactLessonOf),
        after: oneAfter,
      }),
    });
  }
  const together = (pick: (one: typeof own) => readonly string[]) =>
    [...new Set([own, ...carriedImpacts.map((one) => one.impact)].flatMap(pick))].sort();
  const impact = {
    ...own,
    teacherIds: together((one) => one.teacherIds),
    classIds: together((one) => one.classIds),
    roomIds: together((one) => one.roomIds),
  };
  const allChanges = [...own.changes, ...carriedImpacts.flatMap((one) => one.impact.changes)];

  // The week's dates before the start, each from the version in force on it.
  const weekStart = mondayOf(startsOn);
  const earlier: ImpactLesson[] = [];
  const byVersion = new Map<string, string[]>();
  for (let date = weekStart; date < startsOn; date = addDays(date, 1)) {
    if (date < draft.version.start_date) continue;
    const version = inForceOn(date);
    if (version === null) continue;
    byVersion.set(version.id, [...(byVersion.get(version.id) ?? []), date]);
  }
  for (const [id, dates] of byVersion) {
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first === undefined || last === undefined) continue;
    earlier.push(...(await lessonsOf(id, first, last, 'none')));
  }
  const load = new Map<string, { unitId: string; subjectId: string; lessonsPerWeek: number }>();
  for (const row of draft.rows) {
    const unitId = row.class_id ?? row.group_id ?? '';
    const key = `${unitId}|${row.subject_id}`;
    const found = load.get(key);
    load.set(key, {
      unitId,
      subjectId: row.subject_id,
      lessonsPerWeek: (found?.lessonsPerWeek ?? 0) + row.lessons_per_week,
    });
  }
  const week = transitionWeek({ startsOn, before: earlier, after, load: [...load.values()] });
  const differing = week === null ? [] : week.rows.filter((row) => row.differs);

  // Decision 8: every vacancy of the draft's pattern with its lessons per week.
  const vacancies = new Map<string, number>();
  const vacancy = new Set(data.teachers.filter((one) => one.vacancy).map((one) => one.id));
  for (const block of draft.blocks) {
    for (const lesson of block.lessons) {
      const teacherId = draft.pattern.model.rowOf(lesson.loadRowId).teacherId;
      if (vacancy.has(teacherId)) {
        vacancies.set(teacherId, (vacancies.get(teacherId) ?? 0) + 1);
      }
    }
  }

  // Task 6.1b-1 (decisions 3 and 5): the lessons with data the publish keeps
  // or that refuse it, over its run and each carried run, as the writer
  // decides them.
  const keepRuns = [
    await keepsOfRun(transaction, {
      state: draft,
      findings: draftFindings,
      firstDate: startsOn,
      lastDate,
      plan: days.plan,
      keepStored: days.keptStored.get(null) ?? new Set(),
    }),
  ];
  for (const one of carried) {
    keepRuns.push(
      await keepsOfRun(transaction, {
        state: one.state,
        findings: one.after,
        firstDate: one.firstDate,
        lastDate: one.lastDate,
        plan: null,
        keepStored: days.keptStored.get(one.versionId) ?? new Set(),
      }),
    );
  }
  const keptLines = keepRuns.flatMap((one) => one.kept);
  const heldLines = keepRuns.flatMap((one) => one.refused);
  const heldDataOf = (line: KeepLine) => ({
    lessonId: line.id,
    date: line.date,
    start: line.start,
    end: line.end,
    unitId: line.unitId,
    subjectId: line.subjectId,
    teacherIds: line.teacherId === null ? [] : [line.teacherId],
    roomId: line.roomId,
    cancelCause: line.cancelCause,
  });

  // The names of what the preview names (decision 12): records of the branch only.
  // A class reached only through a group lesson is in `classIds` alone (review of #142).
  const named = dayChangeIdsOf(days.items, days.bulk, days.exams, days.substitutions);
  const unitIds = new Set<string>([
    ...named.unitIds,
    ...impact.classIds,
    ...allChanges.flatMap((one) => [one.unitId, ...one.classIds]),
    ...(week?.rows ?? []).map((one) => one.unitId),
    ...[...keptLines, ...heldLines].map((one) => one.unitId),
  ]);
  const subjectIds = new Set<string>([
    ...named.subjectIds,
    ...allChanges.map((one) => one.subjectId),
    ...(week?.rows ?? []).map((one) => one.subjectId),
    ...[...keptLines, ...heldLines].map((one) => one.subjectId),
  ]);
  const teacherIds = new Set<string>([
    ...impact.teacherIds,
    ...vacancies.keys(),
    ...named.teacherIds,
    ...[...keptLines, ...heldLines].flatMap((one) =>
      one.teacherId === null ? [] : [one.teacherId],
    ),
  ]);
  const roomIds = new Set<string>([
    ...impact.roomIds,
    ...named.roomIds,
    ...[...keptLines, ...heldLines].flatMap((one) => (one.roomId === null ? [] : [one.roomId])),
  ]);
  const units = new Map(
    [...states.values(), draft].flatMap((state) =>
      state.pattern.model.data.units.map((unit) => [unit.id, unit] as const),
    ),
  );
  const { names, staff } = await namesOf(
    transaction,
    { unitIds, subjectIds, teacherIds, roomIds },
    units,
  );
  const staffOf = new Map(staff.map((one) => [one.id, one]));

  return {
    answer: {
      beforeVersion:
        beforeVersion === null ? null : { id: beforeVersion.id, number: beforeVersion.number },
      counts: impact.counts,
      changes: impact.changes.map(changeAnswer),
      carried: carriedImpacts.map(({ one, impact: carriedImpact }) => ({
        versionId: one.versionId,
        number: one.number,
        counts: carriedImpact.counts,
        changes: carriedImpact.changes.map(changeAnswer),
      })),
      // Decisions 6 and 7: a vacancy is never notified; a person only with an account.
      teachers: impact.teacherIds.map((id) => {
        const record = staffOf.get(id);
        const isVacancy = record?.kind === 'vacancy';
        return {
          id,
          vacancy: isVacancy,
          notified: record !== undefined && !isVacancy && record.account_id !== null,
        };
      }),
      classIds: [...impact.classIds],
      roomIds: [...impact.roomIds],
      vacancies: [...vacancies.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, lessonsPerWeek]) => ({ id, lessonsPerWeek })),
      transition:
        week === null
          ? null
          : {
              weekStart: week.weekStart,
              weekEnd: week.weekEnd,
              rows: week.rows.map((row) => ({ ...row })),
              key:
                differing.length === 0
                  ? null
                  : transitionKeyOf(draft.version.id, startsOn, differing),
            },
      dayChanges: {
        key: days.key,
        kept: days.items.filter((one) => one.category === 'kept').map((one) => one.answer),
        decide: days.items.filter((one) => one.category === 'decide').map((one) => one.answer),
        dropped: days.items.filter((one) => one.category === 'dropped').map((one) => one.answer),
        bulk: days.bulk.map((one) => one.answer),
        exams: days.exams.map((one) => one.answer),
        substitutions: days.substitutions.map((one) => one.answer),
        absences: await runAbsences(transaction, draft.version.branch_id, absenceLessons),
        // Task 5.7a-2b (decision 9): the same lessons, put under "needs a room".
        closures: await runClosures(transaction, draft.version.branch_id, absenceLessons),
      },
      keptWithData: keptLines.map(heldDataOf),
      heldData: heldLines.map(heldDataOf),
      names,
    },
    acknowledged: differing.map((row) => ({ ...row })),
  };
}

/** The classes, groups, subjects and rooms a sorting of one-day changes and bulk cancels names. */
export function dayChangeIdsOf(
  items: readonly SortedDayChange[],
  bulk: readonly SortedBulk[],
  /** Task 5.6c-3a: the exams of the sorting. */
  exams: readonly KeptExam[] = [],
  /** Task 5.7b-3: the substitutions of the sorting. */
  substitutions: readonly SortedSubstitution[] = [],
): { unitIds: string[]; subjectIds: string[]; roomIds: string[]; teacherIds: string[] } {
  const examLessons = exams.flatMap((one) => [
    ...one.answer.cancelled,
    ...one.answer.clashes,
    ...one.answer.dropBlocked,
    ...one.answer.blocks.flatMap((block) => block.lessons),
  ]);
  return {
    // A class reached only through a group lesson is in `classIds` alone (review of #142).
    unitIds: [
      ...items.map((one) => one.answer.unitId),
      ...bulk.flatMap((one) => [
        ...one.answer.classIds,
        ...one.answer.blocks.flatMap((block) => [
          ...block.lessons.map((lesson) => lesson.unitId),
          ...block.chosenClassIds,
          ...block.otherClassIds,
        ]),
      ]),
      ...examLessons.map((lesson) => lesson.unitId),
      ...exams.flatMap((one) =>
        one.answer.blocks.flatMap((block) => [...block.sittingClassIds, ...block.otherClassIds]),
      ),
      ...substitutions.map((one) => one.answer.unitId),
    ],
    subjectIds: [
      ...items.map((one) => one.answer.subjectId),
      ...bulk.flatMap((one) =>
        one.answer.blocks.flatMap((block) => block.lessons.map((lesson) => lesson.subjectId)),
      ),
      ...examLessons.map((lesson) => lesson.subjectId),
      ...substitutions.map((one) => one.answer.subjectId),
    ],
    roomIds: items
      .flatMap((one) => [one.answer.from.roomId, one.answer.to.roomId])
      .flatMap((id) => (id === null ? [] : [id])),
    teacherIds: substitutions.flatMap((one) => [
      one.answer.substituteId,
      ...(one.answer.replacedId === null ? [] : [one.answer.replacedId]),
    ]),
  };
}

/**
 * The names of what a preview names (decision 12): records of the branch
 * only; a unit's grades from `units`. Also the withdraw check's (task
 * 5.6a-5b-2).
 */
export async function namesOf(
  transaction: Transaction,
  input: {
    readonly unitIds: Iterable<string>;
    readonly subjectIds: Iterable<string>;
    readonly teacherIds: Iterable<string>;
    readonly roomIds: Iterable<string>;
  },
  units: ReadonlyMap<string, { readonly grades: readonly number[] }>,
) {
  const unitIds = new Set(input.unitIds);
  const subjectIds = new Set(input.subjectIds);
  const teacherIds = new Set(input.teacherIds);
  const roomIds = new Set(input.roomIds);
  const ids = (set: Set<string>) => [...set].filter((id) => id !== '').sort();
  const [classes, groups, subjects, staff, rooms] = await Promise.all([
    ids(unitIds).length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('classes')
          .select(['id', 'name'])
          .where('id', 'in', ids(unitIds))
          .execute(),
    ids(unitIds).length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('groups')
          .select(['id', 'name'])
          .where('id', 'in', ids(unitIds))
          .execute(),
    ids(subjectIds).length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('subjects')
          .select(['id', 'name_uz', 'name_ru', 'name_en'])
          .where('id', 'in', ids(subjectIds))
          .orderBy('id')
          .execute(),
    ids(teacherIds).length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('staff')
          .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name', 'account_id'])
          .where('id', 'in', ids(teacherIds))
          .orderBy('id')
          .execute(),
    ids(roomIds).length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('rooms')
          .select(['id', 'name'])
          .where('id', 'in', ids(roomIds))
          .orderBy('id')
          .execute(),
  ]);
  const unitNames = [
    ...classes.map((one) => ({ ...one, kind: 'class' as const })),
    ...groups.map((one) => ({ ...one, kind: 'group' as const })),
  ]
    .map((one) => ({ ...one, grades: [...(units.get(one.id)?.grades ?? [])] }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const names: PreviewNamesAnswer = {
    units: unitNames,
    subjects: subjects.map((one) => ({
      id: one.id,
      names: { uz: one.name_uz, ru: one.name_ru, en: one.name_en },
    })),
    teachers: staff.map((one) => ({
      id: one.id,
      name:
        one.kind === 'vacancy'
          ? (one.vacancy_name ?? '')
          : listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
    })),
    rooms: rooms.map((one) => ({ id: one.id, name: one.name })),
  };
  return { names, staff };
}

/**
 * A carried version over its run (task 5.5a-3a): its lessons before the
 * change, read from its stored lessons, or with none stored from `before`
 * (task 5.5b-2, decision 2); its state and dated check after the change.
 */
export interface CarriedImpact {
  readonly versionId: string;
  readonly number: number;
  readonly firstDate: string;
  readonly lastDate: string;
  readonly before: DatedPattern;
  readonly state: PatternState;
  readonly after: DatedFindings;
}

/**
 * The lessons a dated check expanded, each with the teacher the publish
 * writes it with (task 5.5b-2, decision 5).
 */
async function writtenLessonsOf(
  transaction: Transaction,
  findings: DatedFindings,
): Promise<ImpactLesson[]> {
  const { lessons } = findings.dated;
  const vacancies = await vacanciesOf(
    transaction,
    lessons.flatMap((one) => one.placement.teacherIds),
  );
  const needs = new Set(findings.needsTeacher.map((one) => needKeyOf(one.entryId, one.date)));
  return lessons.map((lesson) => {
    const teacher = writtenTeacherOf(needs, vacancies, {
      entryId: lesson.entryId,
      date: patternDateOf(lesson),
      teacherId: lesson.placement.teacherIds[0] ?? null,
    });
    return { ...impactLessonOf(lesson), teacherIds: teacher === null ? [] : [teacher] };
  });
}

/**
 * The stretches of `from` to `to`, each with the published version in force
 * on it (`published` latest start first, ties by the higher number); dates
 * before the first version are in none.
 */
function stretchesOf(
  published: readonly { id: string; starts_on: string }[],
  from: string,
  to: string,
): { id: string; from: string; to: string }[] {
  const stretches: { id: string; from: string; to: string }[] = [];
  const ascending = [...published].reverse();
  for (const [index, version] of ascending.entries()) {
    const next = ascending.slice(index + 1).find((other) => other.starts_on > version.starts_on);
    // A tie on a start goes to the higher number, later in this order.
    if (ascending.slice(index + 1).some((other) => other.starts_on === version.starts_on)) {
      continue;
    }
    const start = version.starts_on > from ? version.starts_on : from;
    const end =
      next === undefined ? to : addDays(next.starts_on, -1) < to ? addDays(next.starts_on, -1) : to;
    if (start <= end) stretches.push({ id: version.id, from: start, to: end });
  }
  return stretches;
}

const changeAnswer = (change: ImpactChange) => ({
  ...change,
  classIds: [...change.classIds],
  before: change.before === null ? null : slotAnswer(change.before),
  after: change.after === null ? null : slotAnswer(change.after),
});

const slotAnswer = (slot: {
  weekday: number;
  start: number;
  end: number;
  teacherIds: readonly string[];
  roomId: string | null;
}) => ({
  weekday: weekdaySchema.parse(slot.weekday),
  start: slot.start,
  end: slot.end,
  teacherIds: [...slot.teacherIds],
  roomId: slot.roomId,
});
