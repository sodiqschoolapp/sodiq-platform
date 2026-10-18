import { createHash } from 'node:crypto';
import {
  listName,
  weekdaySchema,
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
import { datedLessonsOf } from './dated-check.js';
import type { PatternState } from './pattern.service.js';
import type { VersionRow } from './timetable.service.js';

/** How the preview reads another version: its row and its pattern state. */
export interface VersionReader {
  readonly versionRow: (id: string) => Promise<VersionRow>;
  readonly stateOf: (version: VersionRow) => Promise<PatternState>;
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
 */
export async function impactOf(
  transaction: Transaction,
  reader: VersionReader,
  draft: PatternState,
  draftDated: DatedPattern,
  startsOn: string,
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
  const stateOf = async (id: string): Promise<PatternState> => {
    const known = states.get(id);
    if (known !== undefined) return known;
    const state = await reader.stateOf(await reader.versionRow(id));
    states.set(id, state);
    return state;
  };
  const lessonsOf = async (id: string, from: string, to: string): Promise<ImpactLesson[]> => {
    const { dated } = await datedLessonsOf(transaction, await stateOf(id), from, to);
    return dated.lessons.map(impactLessonOf);
  };

  const beforeVersion = inForceOn(startsOn);
  const before: ImpactLesson[] = [];
  for (const stretch of stretchesOf(published, startsOn, lastDate)) {
    before.push(...(await lessonsOf(stretch.id, stretch.from, stretch.to)));
  }
  const after = draftDated.lessons.map(impactLessonOf);
  const own = publishImpact({ before, after });
  // Spec review must-fix 1: each carried version over its own run.
  const carriedImpacts = carried.map((one) => ({
    one,
    impact: publishImpact({
      before: one.before.lessons.map(impactLessonOf),
      after: one.after.lessons.map(impactLessonOf),
    }),
  }));
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
    earlier.push(...(await lessonsOf(id, first, last)));
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

  // The names of what the preview names (decision 12): records of the branch only.
  // A class reached only through a group lesson is in `classIds` alone (review of #142).
  const unitIds = new Set<string>([
    ...impact.classIds,
    ...allChanges.flatMap((one) => [one.unitId, ...one.classIds]),
    ...(week?.rows ?? []).map((one) => one.unitId),
  ]);
  const subjectIds = new Set<string>([
    ...allChanges.map((one) => one.subjectId),
    ...(week?.rows ?? []).map((one) => one.subjectId),
  ]);
  const teacherIds = new Set<string>([...impact.teacherIds, ...vacancies.keys()]);
  const roomIds = new Set<string>(impact.roomIds);
  const units = new Map(
    [...states.values(), draft].flatMap((state) =>
      state.pattern.model.data.units.map((unit) => [unit.id, unit] as const),
    ),
  );
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
  const staffOf = new Map(staff.map((one) => [one.id, one]));
  const unitNames = [
    ...classes.map((one) => ({ ...one, kind: 'class' as const })),
    ...groups.map((one) => ({ ...one, kind: 'group' as const })),
  ]
    .map((one) => ({ ...one, grades: [...(units.get(one.id)?.grades ?? [])] }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

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
      names: {
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
      },
    },
    acknowledged: differing.map((row) => ({ ...row })),
  };
}

/** A carried version's lessons over its run, before and after the change (task 5.5a-3a). */
export interface CarriedImpact {
  readonly versionId: string;
  readonly number: number;
  readonly before: DatedPattern;
  readonly after: DatedPattern;
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
