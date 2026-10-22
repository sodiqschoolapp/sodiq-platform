import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  absenceSchema,
  bulkCancelCheckAnswerSchema,
  examSaveAnswerSchema,
  publishCheckSchema,
  roomClosureSchema,
  vacancyFillCheckSchema,
  type VacancyFillCheck,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../database/database.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { markedLesson, workWithTotal } from '../../testing/cells-kit.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import {
  hoursOf,
  publishedScene,
  publishOf,
  QUARTERS,
  type PublishedScene,
} from '../../testing/published-scene.js';
import { signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const ok = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

/** Class, group and subject of every lesson of the branch, by id. */
const unitsOf = async (migrator: Database, branch: string) =>
  new Map(
    (
      await migrator
        .selectFrom('lessons')
        .select(['id', 'class_id', 'group_id', 'subject_id'])
        .where('branch_id', '=', branch)
        .execute()
    ).map((one) => [one.id, `${one.class_id ?? ''}|${one.group_id ?? ''}|${one.subject_id}`]),
  );

/** Every lesson that stays keeps its class, group and subject; answers how many stayed. */
const keptUnits = (before: Map<string, string>, after: Map<string, string>) => {
  let kept = 0;
  for (const [id, unit] of after) {
    if (!before.has(id)) continue;
    expect(unit, id).toBe(before.get(id));
    kept += 1;
  }
  return kept;
};

interface Line {
  lesson_id: string;
  branch_id: string;
  kind: string;
  teacher_before: string | null;
  teacher_after: string | null;
  room_before: string | null;
  room_after: string | null;
  starts_before: Date | null;
  starts_after: Date | null;
  cancel_before: string | null;
  cancel_after: string | null;
  /** The actors of the audit entries of the line's transaction in the line's branch. */
  actors: string[];
  /** The actions of those entries. */
  actions: string[];
}

/** The history lines of the lessons named, each with the entries of its transaction. */
const linesOf = async (migrator: Database, lessonIds: readonly string[]) =>
  (
    await sql<Line>`
      select h.lesson_id, h.branch_id, h.kind, h.teacher_before, h.teacher_after, h.room_before,
        h.room_after, h.starts_before, h.starts_after, h.cancel_before, h.cancel_after,
        array(
          select distinct a.actor_id::text from audit_log a
          where a.branch_id = h.branch_id and a.written_xact = h.written_xact
        ) as actors,
        array(
          select distinct a.action from audit_log a
          where a.branch_id = h.branch_id and a.written_xact = h.written_xact
          order by a.action
        ) as actions
      from lesson_history h
      where h.lesson_id = any(${lessonIds}::uuid[])
      order by h.changed_at, h.id
    `.execute(migrator)
  ).rows;

/** Every line of the lessons named was written by one account, through an audit entry. */
const allBy = (lines: readonly Line[], actor: string) => {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line.actors, line.lesson_id).toEqual([actor]);
  }
};

// All names are invented. Task 5.8b, pull request #195: the protection of
// dated lessons through the writers of dated lessons that
// `lesson-protection.test.ts` does not reach (06, Protection: "A dated lesson
// that already has attendance or marks cannot be deleted and cannot change its
// class, group or subject. Its teacher, room and time can change, with a log
// entry." "Every change records who, when, the value before and the value
// after."). Each writer runs through its real route; each test asserts that
// every lesson that stays keeps its class, group and subject, and that each
// lesson changed has one line per change, tied to an audit entry of its
// transaction in the lesson's branch that names the Super Admin who ran it.
describe('the protection of dated lessons through the other writers', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let adminAccount: string;

  const keyed = (path: string, branch: string, body: object, method: 'post' | 'put' = 'post') =>
    request(t.kit.server)
      [method](path)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  const units = (branch: string) => unitsOf(t.database.migrator, branch);
  const lines = (ids: readonly string[]) => linesOf(t.database.migrator, ids);

  const lessonOf = async (s: PublishedScene, date: string, classId = s.classId) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', s.branch)
      .where('class_id', '=', classId)
      .where('lesson_date', '=', date)
      .executeTakeFirstOrThrow();

  /** A teacher of the scene's subject in grade 7, with hours. */
  async function teacherOf(branch: string, subject: string) {
    const teacher = await load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
    await hoursOf(t, branch, teacher.staffId);
    return teacher;
  }

  /** A draft copied from `copyFrom`, the class's teacher changed, ready to publish from `startsOn`. */
  async function draftWith(
    s: PublishedScene,
    input: { startsOn: string; classId: string; teacherId: string; copyFrom?: string },
  ) {
    const created = await t.post('/api/timetable/versions', s.branch, {
      academicYearId: s.year,
      startsOn: input.startsOn,
      copyFrom: input.copyFrom ?? s.version,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = (created.body as { id: string }).id;
    await t.database.migrator
      .updateTable('teaching_load_rows')
      .set({ teacher_id: input.teacherId })
      .where('version_id', '=', draft)
      .where('class_id', '=', input.classId)
      .execute();
    ok(await t.post(`/api/timetable/versions/${draft}/templates/confirm`, s.branch));
    await load.freeEditLock(draft);
    return draft;
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    adminAccount = (
      await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.adminAssignment)
        .executeTakeFirstOrThrow()
    ).account_id;
  });

  afterAll(async () => {
    await t.close();
  });

  it('a publish that carries a teacher into a later version writes a line per lesson of both versions, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    // A later version from 9 November gives the first class the spare teacher.
    const later = await draftWith(s, {
      startsOn: '2026-11-09',
      classId: s.classId,
      teacherId: s.spareTeacher.staffId,
    });
    ok(await publishOf(t)(s.branch, later, '2026-11-09'));
    // The fix from 19 October gives the second class another teacher, carried into the later one.
    const newcomer = await teacherOf(s.branch, s.subject);
    const fix = await draftWith(s, {
      startsOn: '2026-10-19',
      classId: s.otherClass,
      teacherId: newcomer.staffId,
    });
    const check = publishCheckSchema.parse(
      ok(
        await t.get(
          `/api/timetable/versions/${fix}/publish-check?startsOn=2026-10-19&chain=carry`,
          s.branch,
        ),
      ).body,
    );
    expect(check.chain?.carryOffered).toBe(true);
    const before = await units(s.branch);
    const ownFirst = await lessonOf(s, '2026-11-16');
    ok(
      await keyed(`/api/timetable/versions/${fix}/publish`, s.branch, {
        startsOn: '2026-10-19',
        chain: 'carry',
        laterKey: check.chain?.key,
      }),
    );
    expect(keptUnits(before, await units(s.branch))).toBeGreaterThan(0);
    const inFix = await lessonOf(s, '2026-10-26', s.otherClass);
    const carried = await lessonOf(s, '2026-11-16', s.otherClass);
    expect(carried.teacher_id).toBe(newcomer.staffId);
    for (const lesson of [inFix, carried]) {
      const found = await lines([lesson.id]);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        kind: 'changed',
        teacher_before: s.otherTeacher.staffId,
        teacher_after: newcomer.staffId,
        actors: [adminAccount],
      });
    }
    expect(
      (await lines([ownFirst.id])).map((one) => [one.teacher_before, one.teacher_after]),
    ).toEqual([[s.teacher.staffId, s.spareTeacher.staffId]]);
  });

  it('a vacancy fill writes a line per lesson the person takes from the vacancy, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const vacancy = await load.vacancy(s.branch, {
      subjects: [{ subject: s.subject, grades: [7] }],
    });
    await hoursOf(t, s.branch, vacancy);
    const open = await draftWith(s, {
      startsOn: '2026-10-19',
      classId: s.classId,
      teacherId: vacancy,
    });
    ok(await publishOf(t)(s.branch, open, '2026-10-19'));
    const body = {
      vacancyId: vacancy,
      personId: s.spareTeacher.staffId,
      startsOn: '2026-11-09',
    };
    const check: VacancyFillCheck = vacancyFillCheckSchema.parse(
      ok(await t.post('/api/timetable/vacancy-fills/check', s.branch, body)).body,
    );
    const before = await units(s.branch);
    ok(
      await keyed('/api/timetable/vacancy-fills', s.branch, {
        ...body,
        rowsKey: check.rowsKey,
        ...(check.publish?.chain == null ? {} : { laterKey: check.publish.chain.key }),
        ...(check.publish?.impact?.transition?.key == null
          ? {}
          : { transitionKey: check.publish.impact.transition.key }),
        ...(check.publish?.impact == null
          ? {}
          : { dayChangesKey: check.publish.impact.dayChanges.key }),
      }),
      201,
    );
    expect(keptUnits(before, await units(s.branch))).toBeGreaterThan(0);
    const filled = await lessonOf(s, '2026-11-16');
    expect(filled.teacher_id).toBe(s.spareTeacher.staffId);
    const found = await lines([filled.id]);
    expect(found.map((one) => [one.teacher_before, one.teacher_after])).toEqual([
      [s.teacher.staffId, vacancy],
      [vacancy, s.spareTeacher.staffId],
    ]);
    allBy(found, adminAccount);
    // A lesson before the fill keeps the vacancy, with the publish's line only.
    expect(
      (await lines([(await lessonOf(s, '2026-10-26')).id])).map((one) => one.teacher_after),
    ).toEqual([vacancy]);
  });

  it('a day off over lessons writes a removed line per lesson, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const removed = [
      await lessonOf(s, '2026-10-19'),
      await lessonOf(s, '2026-10-19', s.otherClass),
    ];
    const before = await units(s.branch);
    ok(
      await t.post('/api/setup/calendar-entries', s.branch, {
        kind: 'day_off',
        name: 'Founders day',
        firstDate: '2026-10-19',
        lastDate: '2026-10-19',
        gradeFrom: null,
        gradeTo: null,
        dayTemplateId: null,
        followsWeekday: null,
        examWeek: null,
      }),
      201,
    );
    const after = await units(s.branch);
    expect(keptUnits(before, after)).toBe(before.size - 2);
    for (const lesson of removed) {
      expect(after.has(lesson.id)).toBe(false);
      expect(await lines([lesson.id])).toMatchObject([
        {
          kind: 'removed',
          teacher_before: lesson.teacher_id,
          room_before: lesson.room_id,
          actors: [adminAccount],
          actions: ['calendar_entry.create'],
        },
      ]);
    }
    expect(await lines([(await lessonOf(s, '2026-10-26')).id])).toEqual([]);
  });

  it('a day template change from a date moves each lesson in time in place: its id, its cells and a line of its times, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const template = await t.database.migrator
      .selectFrom('day_templates')
      .select('id')
      .where('branch_id', '=', s.branch)
      .where('name', '=', 'Regular')
      .executeTakeFirstOrThrow();
    const typeOf = async (name: string) =>
      (
        await t.database.migrator
          .selectFrom('slot_types')
          .select('id')
          .where('branch_id', '=', s.branch)
          .where('name', '=', name)
          .executeTakeFirstOrThrow()
      ).id;
    const lesson = await typeOf('Lesson');
    const pause = await typeOf('Break');
    const moved = await lessonOf(s, '2026-10-19');
    const later = await lessonOf(s, '2026-10-26');
    const kept = await lessonOf(s, '2026-10-12');
    // Task 6.1b-1 (decision 6, the From line of 5.8b): a lesson with a mark.
    const { studentId } = await markedLesson(t.app, t.database.migrator, {
      branchId: s.branch,
      classId: s.classId,
      lessonId: moved.id,
      accountId: adminAccount,
    });
    const before = await units(s.branch);
    ok(
      await t.post(`/api/setup/day-templates/${template.id}/versions`, s.branch, {
        from: '2026-10-19',
        startTime: '08:30',
        slotTypeIds: [lesson, pause, lesson, pause, lesson],
      }),
    );
    // A rewrite of the version pairs a lesson by its pattern entry and
    // pattern date (`pairDated`, pass 2): every lesson stays with its id,
    // its class, group and subject, at the new time.
    const after = await units(s.branch);
    expect(keptUnits(before, after)).toBe(before.size);
    const now = await lessonOf(s, '2026-10-19');
    expect(now.id).toBe(moved.id);
    expect(now.starts_at.toISOString()).toBe(at('2026-10-19', '08:30').toISOString());
    expect((await lessonOf(s, '2026-10-26')).id).toBe(later.id);
    const cells = await t.database.migrator
      .selectFrom('journal_cells')
      .select(['student_id', 'mark'])
      .where('lesson_id', '=', moved.id)
      .execute();
    expect(cells).toEqual([{ student_id: studentId, mark: 1 }]);
    const found = await lines([moved.id]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'changed',
      teacher_before: moved.teacher_id,
      teacher_after: moved.teacher_id,
      actions: ['day_template.version_create'],
    });
    expect(found[0]?.starts_before?.toISOString()).toBe(moved.starts_at.toISOString());
    expect(found[0]?.starts_after?.toISOString()).toBe(at('2026-10-19', '08:30').toISOString());
    allBy(found, adminAccount);
    expect(await lines([kept.id])).toEqual([]);
  });

  // Task 6.1b-1 (decisions 2, 5, 6 and 7): the setup writers over lessons that
  // hold data, each through its real route, its preview against its save.
  describe('lessons that hold data (6.1b-1)', () => {
    const slotTypeOf = async (branch: string, name: string) =>
      (
        await t.database.migrator
          .selectFrom('slot_types')
          .select('id')
          .where('branch_id', '=', branch)
          .where('name', '=', name)
          .executeTakeFirstOrThrow()
      ).id;

    const cellsOf = (lessonId: string) =>
      t.database.migrator
        .selectFrom('journal_cells')
        .select(['student_id', 'mark'])
        .where('lesson_id', '=', lessonId)
        .execute();

    const lessonById = (id: string) =>
      t.database.migrator
        .selectFrom('lessons')
        .select(['id', 'block_id', 'starts_at', 'ends_at', 'cancel_cause'])
        .where('id', '=', id)
        .executeTakeFirst();

    /** The newest audit entry of the action in the branch: its writes of dated lessons. */
    const writesOf = async (branch: string, action: string) => {
      const entry = await t.database.migrator
        .selectFrom('audit_log')
        .select('new_value')
        .where('branch_id', '=', branch)
        .where('action', '=', action)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow();
      const value = entry.new_value as {
        datedLessons?: {
          keptWithData?: { id: string; cause: string }[];
          givenBack?: { id: string }[];
        }[];
      };
      return value.datedLessons ?? [];
    };

    /** The lessons lists of a calendar preview. */
    const calendarPreview = async (branch: string, change: object) => {
      const response = ok(await t.post('/api/setup/calendar-entries/preview', branch, change));
      return (
        response.body as {
          lessons: {
            keptWithData: { lessonId: string; cause: string; cancelCause: string | null }[];
            givenBack: { lessonId: string }[];
            heldData: { lessonId: string }[];
          };
        }
      ).lessons;
    };

    const dayOff = (date: string) => ({
      kind: 'day_off',
      name: 'Founders day',
      firstDate: date,
      lastDate: date,
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: null,
      followsWeekday: null,
      examWeek: null,
    });

    const special = (date: string, dayTemplateId: string) => ({
      kind: 'special_day',
      name: 'Open day',
      firstDate: date,
      lastDate: date,
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId,
      followsWeekday: null,
      examWeek: null,
    });

    const mark = (s: PublishedScene, lessonId: string, classId = s.classId) =>
      markedLesson(t.app, t.database.migrator, {
        branchId: s.branch,
        classId,
        lessonId,
        accountId: adminAccount,
      });

    it('a slot length change moves a lesson with data in place: its id, its cells, its new end', async () => {
      const s = await publishedScene(t, load);
      const moved = await lessonOf(s, '2026-10-19');
      const { studentId } = await mark(s, moved.id);
      ok(
        await t.post(
          `/api/setup/slot-types/${await slotTypeOf(s.branch, 'Lesson')}/lengths`,
          s.branch,
          { lengthMinutes: 40, from: '2026-10-19' },
        ),
      );
      const now = await lessonById(moved.id);
      expect(now?.starts_at.toISOString()).toBe(moved.starts_at.toISOString());
      expect(now?.ends_at.toISOString()).toBe(
        new Date(moved.starts_at.getTime() + 40 * 60_000).toISOString(),
      );
      expect(await cellsOf(moved.id)).toEqual([{ student_id: studentId, mark: 1 }]);
    });

    it('a special template on a date moves a lesson with data in place and cancels one it has no slot for "not in the day\'s template" in place, listed in the preview and the entry', async () => {
      const s = await publishedScene(t, load, { secondSubject: true });
      const lesson = await slotTypeOf(s.branch, 'Lesson');
      // One lesson slot from 08:30: the first lesson moves, the second has no slot.
      const late = await t.createTemplate(s.branch, 'Late', [lesson], '08:30');
      const moved = await lessonOf(s, '2026-10-19');
      const dropped = await t.database.migrator
        .selectFrom('lessons')
        .selectAll()
        .where('branch_id', '=', s.branch)
        .where('class_id', '=', s.otherClass)
        .where('lesson_date', '=', '2026-10-19')
        .orderBy('starts_at', 'desc')
        .executeTakeFirstOrThrow();
      expect(dropped.subject_id).not.toBe(s.subject);
      await mark(s, moved.id);
      const { studentId } = await mark(s, dropped.id, s.otherClass);

      const shown = await calendarPreview(s.branch, {
        action: 'create',
        record: special('2026-10-19', late),
      });
      expect(shown.keptWithData.map((one) => [one.lessonId, one.cancelCause, one.cause])).toEqual([
        [dropped.id, null, 'not_in_template'],
      ]);
      expect(shown.heldData).toEqual([]);
      ok(await t.post('/api/setup/calendar-entries', s.branch, special('2026-10-19', late)), 201);

      const now = await lessonById(moved.id);
      expect(now?.starts_at.toISOString()).toBe(at('2026-10-19', '08:30').toISOString());
      expect(now?.cancel_cause).toBeNull();
      expect(await lessonById(dropped.id)).toMatchObject({
        block_id: dropped.block_id,
        cancel_cause: 'not_in_template',
      });
      expect(await cellsOf(dropped.id)).toEqual([{ student_id: studentId, mark: 1 }]);
      // One lesson at each place of the date.
      expect(
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('branch_id', '=', s.branch)
          .where('lesson_date', '=', '2026-10-19')
          .where('subject_id', '=', dropped.subject_id)
          .execute(),
      ).toEqual([{ id: dropped.id }]);
      const writes = await writesOf(s.branch, 'calendar_entry.create');
      expect(
        writes.flatMap((one) => one.keptWithData ?? []).map((one) => [one.id, one.cause]),
      ).toEqual([[dropped.id, 'not_in_template']]);
    });

    it('a day off over a lesson with a work total keeps it, listed in the preview and the entry; the day off taken back gives it back', async () => {
      const s = await publishedScene(t, load);
      const held = await lessonOf(s, '2026-10-26');
      const other = await lessonOf(s, '2026-10-26', s.otherClass);
      await workWithTotal(t.database.migrator, { branchId: s.branch, lessonId: held.id });

      const shown = await calendarPreview(s.branch, {
        action: 'create',
        record: dayOff('2026-10-26'),
      });
      expect(shown.keptWithData.map((one) => [one.lessonId, one.cause])).toEqual([
        [held.id, 'kept_data'],
      ]);
      const created = ok(
        await t.post('/api/setup/calendar-entries', s.branch, dayOff('2026-10-26')),
        201,
      );
      expect(await lessonById(held.id)).toMatchObject({
        block_id: held.block_id,
        cancel_cause: 'kept_data',
      });
      expect(await lessonById(other.id)).toBeUndefined();
      expect(
        (await writesOf(s.branch, 'calendar_entry.create'))
          .flatMap((one) => one.keptWithData ?? [])
          .map((one) => one.id),
      ).toEqual([held.id]);

      const id = (created.body as { id: string }).id;
      const back = await calendarPreview(s.branch, { action: 'archive', id });
      expect(back.givenBack.map((one) => one.lessonId)).toEqual([held.id]);
      ok(await t.post(`/api/setup/calendar-entries/${id}/archive`, s.branch));
      expect(await lessonById(held.id)).toMatchObject({
        block_id: held.block_id,
        cancel_cause: null,
      });
      expect(
        (await writesOf(s.branch, 'calendar_entry.archive'))
          .flatMap((one) => one.givenBack ?? [])
          .map((one) => one.id),
      ).toEqual([held.id]);
    });

    it('a shorter last quarter over a lesson holding data is refused with the lesson listed, in the preview and on the save, and changes nothing', async () => {
      const s = await publishedScene(t, load);
      const held = await lessonOf(s, '2027-05-31');
      await mark(s, held.id);
      const dates = QUARTERS.map(([start, end], index) =>
        index === 3
          ? { startDate: start, endDate: '2027-05-24' }
          : { startDate: start, endDate: end },
      );
      const shown = ok(
        await t.post(`/api/setup/academic-years/${s.year}/quarters/preview`, s.branch, {
          quarters: dates,
        }),
      ).body as { dataLessons: { items: { kind: string; date: string }[]; more: number } };
      expect(shown.dataLessons).toEqual({
        items: [expect.objectContaining({ kind: 'data_lesson', date: '2027-05-31' })],
        more: 0,
      });
      const before = await units(s.branch);
      const refused = await t.put(`/api/setup/academic-years/${s.year}/quarters`, s.branch, {
        quarters: dates,
      });
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect((refused.body as { error: { code: string } }).error.code).toBe('lessons_hold_data');
      expect(await units(s.branch)).toEqual(before);
      expect(await lessonById(held.id)).toMatchObject({ cancel_cause: null });
      const quarter = await t.database.migrator
        .selectFrom('quarters')
        .select(sql<string>`end_date::text`.as('end_date'))
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 4)
        .executeTakeFirstOrThrow();
      expect(quarter.end_date).toBe(QUARTERS[3]?.[1]);
    });
  });

  it('a shorter last quarter writes a removed line per lesson it cuts off, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const cut = [await lessonOf(s, '2027-05-31'), await lessonOf(s, '2027-05-31', s.otherClass)];
    const before = await units(s.branch);
    const dates = QUARTERS.map(([start, end], index) =>
      index === 3
        ? { startDate: start, endDate: '2027-05-24' }
        : { startDate: start, endDate: end },
    );
    ok(await t.put(`/api/setup/academic-years/${s.year}/quarters`, s.branch, { quarters: dates }));
    const after = await units(s.branch);
    expect(keptUnits(before, after)).toBe(before.size - 2);
    const found = await lines(cut.map((one) => one.id));
    expect(found.map((one) => one.kind)).toEqual(['removed', 'removed']);
    allBy(found, adminAccount);
    expect(await lines([(await lessonOf(s, '2027-05-24')).id])).toEqual([]);
  });

  it('the correction of a past lesson writes its line, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    // The scene's templates from the start of the year, so that Friday 9
    // October has its day (as the correction tests of day-changes.test.ts set it up).
    await t.database.migrator.transaction().execute(async (transaction) => {
      for (const table of [
        'slot_type_lengths',
        'day_template_versions',
        'day_template_assignments',
      ] as const) {
        await sql`alter table ${sql.table(table)} disable trigger user`.execute(transaction);
        await transaction
          .updateTable(table)
          .set({ valid_from: '2026-09-01' })
          .where('branch_id', '=', s.branch)
          .execute();
        await sql`alter table ${sql.table(table)} enable trigger user`.execute(transaction);
      }
    });
    // A copy of the Monday lesson on Friday 9 October, written by the
    // migrator: a publish never writes the past.
    const monday = await lessonOf(s, '2026-10-12');
    const block = await t.database.migrator
      .selectFrom('lesson_blocks')
      .selectAll()
      .where('id', '=', monday.block_id)
      .executeTakeFirstOrThrow();
    const back = 3 * 86_400_000;
    const pastBlock = await t.database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: s.branch,
        academic_year_id: block.academic_year_id,
        quarter_id: block.quarter_id,
        lesson_date: '2026-10-09',
        starts_at: new Date(monday.starts_at.getTime() - back),
        ends_at: new Date(monday.ends_at.getTime() - back),
        version_id: block.version_id,
        pattern_block_id: block.pattern_block_id,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const past = await t.database.migrator
      .insertInto('lessons')
      .values({
        branch_id: s.branch,
        block_id: pastBlock.id,
        lesson_date: pastBlock.lesson_date,
        starts_at: pastBlock.starts_at,
        ends_at: pastBlock.ends_at,
        class_id: monday.class_id,
        subject_id: monday.subject_id,
        load_row_id: monday.load_row_id,
        pattern_entry_id: monday.pattern_entry_id,
        teacher_id: monday.teacher_id,
        room_id: monday.room_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const before = await units(s.branch);
    ok(
      await keyed(`/api/timetable/lessons/${past.id}/correction`, s.branch, {
        kind: 'teacher',
        teacherId: s.spareTeacher.staffId,
        reason: 'The register says otherwise',
      }),
    );
    expect(keptUnits(before, await units(s.branch))).toBe(before.size);
    expect(await lines([past.id])).toMatchObject([
      {
        kind: 'changed',
        teacher_before: s.teacher.staffId,
        teacher_after: s.spareTeacher.staffId,
        actors: [adminAccount],
        actions: ['lesson.correct'],
      },
    ]);
  });

  it('an absence, its journal substitution, its shortening and its withdraw each write their lines, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const journal = await t.database.migrator
      .selectFrom('journals')
      .select('id')
      .where('class_id', '=', s.classId)
      .where('subject_id', '=', s.subject)
      .executeTakeFirstOrThrow();
    const dates = ['2026-10-12', '2026-10-19', '2026-10-26'];
    const ids = await Promise.all(dates.map(async (date) => (await lessonOf(s, date)).id));
    const before = await units(s.branch);
    // The absence alone changes no lesson.
    const absence = absenceSchema.parse(
      ok(
        await t.post('/api/timetable/absences', s.branch, {
          staffId: s.teacher.staffId,
          startsOn: '2026-10-12',
          endsOn: '2026-10-30',
          reason: 'Ill',
        }),
        201,
      ).body,
    );
    expect(await lines(ids)).toEqual([]);
    ok(
      await keyed(`/api/timetable/absences/${absence.id}/journal-substitute`, s.branch, {
        journalId: journal.id,
        teacherId: s.spareTeacher.staffId,
        reason: 'The teacher is ill',
      }),
    );
    // Shortened to the first week: the later two lessons go back to the teacher.
    ok(
      await t.patch(`/api/timetable/absences/${absence.id}`, s.branch, {
        startsOn: '2026-10-12',
        endsOn: '2026-10-16',
      }),
    );
    // Withdrawn before it starts: the first lesson goes back too.
    ok(await t.post(`/api/timetable/absences/${absence.id}/withdraw`, s.branch));
    expect(keptUnits(before, await units(s.branch))).toBe(before.size);
    const swap = [s.teacher.staffId, s.spareTeacher.staffId];
    const back = [s.spareTeacher.staffId, s.teacher.staffId];
    for (const [index, id] of ids.entries()) {
      const found = await lines([id]);
      expect(found.map((one) => [one.teacher_before, one.teacher_after])).toEqual([swap, back]);
      expect(found.map((one) => one.actions)).toEqual([
        ['absence.journal_substitute'],
        [index === 0 ? 'absence.withdraw' : 'absence.edit'],
      ]);
      allBy(found, adminAccount);
    }
  });

  it('the shortening of an absence returns a lesson of another branch with its line tied to an entry in that branch', async () => {
    const home = await publishedScene(t, load);
    const away = await publishedScene(t, load);
    // The other branch's teacher also works in the home branch.
    await t.database.migrator
      .insertInto('staff_branches')
      .values({ staff_id: away.teacher.staffId, branch_id: home.branch, is_main: false })
      .execute();
    const journal = await t.database.migrator
      .selectFrom('journals')
      .select('id')
      .where('class_id', '=', away.classId)
      .where('subject_id', '=', away.subject)
      .executeTakeFirstOrThrow();
    const absence = absenceSchema.parse(
      ok(
        await t.post('/api/timetable/absences', home.branch, {
          staffId: away.teacher.staffId,
          startsOn: '2026-10-12',
          endsOn: '2026-10-30',
          reason: 'Ill',
        }),
        201,
      ).body,
    );
    ok(
      await keyed(`/api/timetable/absences/${absence.id}/journal-substitute`, away.branch, {
        journalId: journal.id,
        teacherId: away.spareTeacher.staffId,
        reason: 'The teacher is ill',
      }),
    );
    const homeBefore = await units(home.branch);
    const awayBefore = await units(away.branch);
    ok(
      await t.patch(`/api/timetable/absences/${absence.id}`, home.branch, {
        startsOn: '2026-10-12',
        endsOn: '2026-10-16',
      }),
    );
    expect(keptUnits(homeBefore, await units(home.branch))).toBe(homeBefore.size);
    expect(keptUnits(awayBefore, await units(away.branch))).toBe(awayBefore.size);
    const returned = await lessonOf(away, '2026-10-19');
    expect(returned.teacher_id).toBe(away.teacher.staffId);
    const found = await lines([returned.id]);
    expect(found).toHaveLength(2);
    expect(found[1]).toMatchObject({
      branch_id: away.branch,
      teacher_before: away.spareTeacher.staffId,
      teacher_after: away.teacher.staffId,
      actors: [adminAccount],
      actions: ['absence.return'],
    });
    // The first week stays substituted, with the substitution's line only.
    expect(await lines([(await lessonOf(away, '2026-10-12')).id])).toHaveLength(1);
  });

  it('a room closure move writes a line per lesson it moves, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const spare = await load.classes.room(s.branch);
    const closure = roomClosureSchema.parse(
      ok(
        await t.post('/api/timetable/room-closures', s.branch, {
          roomId: s.room,
          startsOn: '2026-10-19',
          endsOn: '2026-10-30',
          reason: 'Laboratory under repair',
        }),
        201,
      ).body,
    );
    const moved = [await lessonOf(s, '2026-10-19'), await lessonOf(s, '2026-10-26')];
    const before = await units(s.branch);
    ok(
      await t.post(`/api/timetable/room-closures/${closure.id}/move`, s.branch, {
        roomId: spare,
        reason: 'Repairs',
      }),
    );
    expect(keptUnits(before, await units(s.branch))).toBe(before.size);
    for (const lesson of moved) {
      expect(await lines([lesson.id])).toMatchObject([
        { kind: 'changed', room_before: s.room, room_after: spare, actors: [adminAccount] },
      ]);
    }
    expect(await lines([(await lessonOf(s, '2026-11-09')).id])).toEqual([]);
  });

  it('an exam save and its cancel write a line per lesson they cancel and give back, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const hall = await load.classes.room(s.branch);
    const covered = [
      await lessonOf(s, '2026-10-19'),
      await lessonOf(s, '2026-10-19', s.otherClass),
    ];
    const before = await units(s.branch);
    const exam = examSaveAnswerSchema.parse(
      ok(
        await keyed('/api/timetable/exams', s.branch, {
          date: '2026-10-19',
          firstLesson: 1,
          lastLesson: 1,
          title: 'Quarter exam in maths',
          subjectId: s.subject,
          rooms: [
            {
              roomId: hall,
              classIds: [s.classId, s.otherClass],
              groupIds: [],
              invigilatorIds: [s.spareTeacher.staffId],
            },
          ],
          blockChoices: [],
          confirm: true,
        }),
        201,
      ).body,
    ).exam;
    ok(await keyed(`/api/timetable/exams/${exam.id}/cancel`, s.branch, {}));
    expect(keptUnits(before, await units(s.branch))).toBe(before.size);
    for (const lesson of covered) {
      const found = await lines([lesson.id]);
      expect(found.map((one) => [one.cancel_before, one.cancel_after])).toEqual([
        [null, 'exam'],
        ['exam', null],
      ]);
      expect(found.map((one) => one.actions)).toEqual([['exam.create'], ['exam.cancel']]);
      allBy(found, adminAccount);
    }
  });

  it('a bulk cancel writes a line per lesson it cancels, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const body = { date: '2026-10-19', classIds: [s.classId], lessonNumbers: [1] };
    const check = bulkCancelCheckAnswerSchema.parse(
      ok(await t.post('/api/timetable/bulk-cancels/check', s.branch, body)).body,
    );
    const before = await units(s.branch);
    ok(
      await keyed('/api/timetable/bulk-cancels', s.branch, {
        ...body,
        reason: 'Excursion to the museum',
        blocks: check.shared.map((one) => ({ blockId: one.blockId, choice: 'cancel' })),
        lessonIds: [
          ...check.cancel.map((one) => one.lesson.id),
          ...check.shared.flatMap((one) => one.lessons.map((lesson) => lesson.id)),
        ],
      }),
    );
    expect(keptUnits(before, await units(s.branch))).toBe(before.size);
    const cancelled = await lessonOf(s, '2026-10-19');
    const found = await lines([cancelled.id]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'changed',
      cancel_before: null,
      actors: [adminAccount],
    });
    expect(found[0]?.cancel_after).not.toBeNull();
    expect(await lines([(await lessonOf(s, '2026-10-19', s.otherClass)).id])).toEqual([]);
  });
});

/** Thursday 15 October 2026, 10:00 in Tashkent, the clock of the Tutor tests. */
const NOW = '2026-10-15T10:00:00+05:00';
const TODAY = '2026-10-15';

// The Tutor follow from its real callers (edge/timetable, Structure, "The
// Homework slot and Ma'naviyat soati": "Their teacher is always the class's
// Tutor in force on the lesson's date"), on a scene as `tutor-lessons.test.ts`
// builds it: the Tutor lessons written as the application writes them, the
// follow through the class Tutor routes, the staff status, the role end and
// the class archive.
describe('the protection of dated lessons through the Tutor follow', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let lessons: LessonsKit;
  let north: string;
  let south: string;
  let northYear: { year: string; quarters: string[] };
  let southYear: { year: string; quarters: string[] };
  let tutorSubject: string;
  let admin: string;
  let adminAccount: string;
  let count = 0;
  const clock = new FixedClock(NOW);

  const post = (path: string, body: object = {}, branch = north) =>
    kit.post(path, admin).set(BRANCH_HEADER, branch).send(body);

  const quarterOf = (year: { quarters: string[] }, date: string): string =>
    year.quarters[date < '2026-11-01' ? 0 : date < '2027-01-01' ? 1 : 2] ?? '';

  const units = (branch: string) => unitsOf(database.migrator, branch);
  const lines = (ids: readonly string[]) => linesOf(database.migrator, ids);

  const newClass = (branch = north) => {
    count += 1;
    return lessons.load.classes.schoolClass(
      branch,
      branch === north ? northYear.year : southYear.year,
      {
        grade: 7,
        name: `Guard ${'abcdefghijklmnopqrstuvwxyz'[count % 26] ?? 'a'}${'k'.repeat(Math.floor(count / 26))}`,
      },
    );
  };

  /** A person of North (and of `further`) with a Tutor role in North from 1 September. */
  async function tutorPerson(further: readonly string[] = []) {
    const person = await lessons.load.classes.person(north, ['uz'], { further });
    const assignmentId = await lessons.load.classes.role(person.accountId, north, 'tutor');
    return { ...person, assignmentId };
  }

  async function tutoredClass() {
    const classId = await newClass();
    const tutor = await tutorPerson();
    const rowId = await lessons.load.classes.tutorRow(north, classId, tutor.assignmentId);
    return { classId, tutor, rowId };
  }

  /** A Tutor lesson of a class, written as the application writes it (a creation writes no line). */
  async function tutorLesson(input: {
    classId: string;
    date: string;
    teacherId: string;
    start?: string;
    end?: string;
    branch?: string;
  }): Promise<string> {
    const branch = input.branch ?? north;
    const year = branch === north ? northYear : southYear;
    const source = await lessons.source(branch, year.year, [
      {
        classId: input.classId,
        groupId: null,
        subjectId: tutorSubject,
        rowTeacherId: input.teacherId,
      },
    ]);
    const from = source.lessons[0];
    if (from === undefined) throw new Error('No source for the lesson.');
    const start = input.start ?? '09:00';
    const end = input.end ?? '09:45';
    return app.get(Transactions).run([branch], async (transaction: Transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: branch,
          academic_year_id: year.year,
          quarter_id: quarterOf(year, input.date),
          lesson_date: input.date,
          starts_at: at(input.date, start),
          ends_at: at(input.date, end),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const row = await transaction
        .insertInto('lessons')
        .values({
          branch_id: branch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: input.classId,
          subject_id: tutorSubject,
          load_row_id: from.loadRowId,
          pattern_entry_id: from.patternEntryId,
          teacher_id: input.teacherId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  }

  const teachersOf = async (ids: readonly string[]) =>
    Promise.all(
      ids.map(
        async (id) =>
          (
            await database.migrator
              .selectFrom('lessons')
              .select('teacher_id')
              .where('id', '=', id)
              .executeTakeFirstOrThrow()
          ).teacher_id,
      ),
    );

  const pairs = (found: readonly Line[]) =>
    found.map((one) => [one.teacher_before, one.teacher_after]);

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    lessons = await LessonsKit.create(database.migrator);
    northYear = await lessons.year(north);
    southYear = await lessons.year(south);
    tutorSubject = await lessons.load.tutorSubject({ grades: [7] });
    const [low, high] = [north, south].sort();
    await database.migrator
      .insertInto('travel_times')
      .values({ branch_low: low ?? '', branch_high: high ?? '', minutes: 30 })
      .execute();
    app = await createTestApp({ database: database.app, jobsDatabaseUrl: database.appUrl, clock });
    kit = signInKit(app);
    const adminBrowser = await kit.completeSession('Aziza', 'Karimova');
    await kit.giveRole(adminBrowser.account.id, { role: 'super_admin' });
    admin = adminBrowser.cookie;
    adminAccount = adminBrowser.account.id;
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('the end of a class Tutor row and the new Tutor each write a line per lesson they move, by the Super Admin', async () => {
    const own = await tutoredClass();
    const a = own.tutor.staffId;
    const kept = await tutorLesson({ classId: own.classId, date: '2026-10-20', teacherId: a });
    const moved = await tutorLesson({ classId: own.classId, date: '2026-10-27', teacherId: a });
    const before = await units(north);
    ok(await post(`/api/classes/${own.classId}/tutors/${own.rowId}/end`, { from: '2026-10-26' }));
    const b = await tutorPerson();
    ok(
      await post(`/api/classes/${own.classId}/tutors`, {
        assignmentId: b.assignmentId,
        kind: 'tutor',
        from: '2026-10-26',
        until: null,
      }),
      201,
    );
    expect(keptUnits(before, await units(north))).toBe(before.size);
    expect(await teachersOf([kept, moved])).toEqual([a, b.staffId]);
    expect(await lines([kept])).toEqual([]);
    const found = await lines([moved]);
    expect(pairs(found)).toEqual([
      [a, null],
      [null, b.staffId],
    ]);
    expect(found.map((one) => one.actions)).toEqual([['class.tutor_ended'], ['class.tutor_given']]);
    allBy(found, adminAccount);
  });

  it('a leaving and its taking back by a status change each write a line per lesson, by the Super Admin', async () => {
    const own = await tutoredClass();
    const a = own.tutor.staffId;
    const kept = await tutorLesson({ classId: own.classId, date: '2026-10-27', teacherId: a });
    const followed = await tutorLesson({ classId: own.classId, date: '2026-10-29', teacherId: a });
    const before = await units(north);
    ok(await post(`/api/people/staff/${a}/status`, { status: 'left', from: '2026-10-28' }));
    expect(await teachersOf([kept, followed])).toEqual([a, null]);
    ok(await post(`/api/people/staff/${a}/status`, { status: 'active', from: TODAY }));
    expect(await teachersOf([kept, followed])).toEqual([a, a]);
    expect(keptUnits(before, await units(north))).toBe(before.size);
    expect(await lines([kept])).toEqual([]);
    const found = await lines([followed]);
    expect(pairs(found)).toEqual([
      [a, null],
      [null, a],
    ]);
    // The status change writes its entry beside those of the role end and its taking back.
    for (const line of found) expect(line.actions).toContain('staff.status');
    allBy(found, adminAccount);
  });

  it('the end of a Tutor role writes a line per lesson it leaves without a teacher, by the Super Admin', async () => {
    const own = await tutoredClass();
    const a = own.tutor.staffId;
    const kept = await tutorLesson({ classId: own.classId, date: '2026-10-27', teacherId: a });
    const ended = await tutorLesson({ classId: own.classId, date: '2026-10-29', teacherId: a });
    const before = await units(north);
    ok(
      await post(`/api/people/staff/${a}/roles/${own.tutor.assignmentId}/end`, {
        from: '2026-10-28',
      }),
    );
    expect(keptUnits(before, await units(north))).toBe(before.size);
    expect(await lines([kept])).toEqual([]);
    const found = await lines([ended]);
    expect(pairs(found)).toEqual([[a, null]]);
    expect(found[0]?.actions).toEqual(['assignment.ended']);
    allBy(found, adminAccount);
  });

  it('the archive of a class leaves its lesson later today as it is, with no line', async () => {
    const own = await tutoredClass();
    const today = await tutorLesson({
      classId: own.classId,
      date: TODAY,
      teacherId: own.tutor.staffId,
      start: '15:00',
      end: '15:45',
    });
    const before = await units(north);
    ok(await post(`/api/classes/${own.classId}/archive`));
    expect(keptUnits(before, await units(north))).toBe(before.size);
    expect(await teachersOf([today])).toEqual([own.tutor.staffId]);
    expect(await lines([today])).toEqual([]);
  });

  it('a leaving asked in North writes the line of a South lesson tied to an entry in South, by the Super Admin', async () => {
    const a = await tutorPerson([south]);
    const southRole = await lessons.load.classes.role(a.accountId, south, 'tutor');
    const northClass = await newClass();
    const southClass = await newClass(south);
    await lessons.load.classes.tutorRow(north, northClass, a.assignmentId);
    await lessons.load.classes.tutorRow(south, southClass, southRole);
    const northLesson = await tutorLesson({
      classId: northClass,
      date: '2026-10-29',
      teacherId: a.staffId,
    });
    const southLesson = await tutorLesson({
      classId: southClass,
      date: '2026-10-30',
      teacherId: a.staffId,
      branch: south,
    });
    const northBefore = await units(north);
    const southBefore = await units(south);
    ok(await post(`/api/people/staff/${a.staffId}/status`, { status: 'left', from: '2026-10-28' }));
    expect(keptUnits(northBefore, await units(north))).toBe(northBefore.size);
    expect(keptUnits(southBefore, await units(south))).toBe(southBefore.size);
    expect(await teachersOf([northLesson, southLesson])).toEqual([null, null]);
    expect(await lines([northLesson])).toMatchObject([
      { branch_id: north, teacher_before: a.staffId, teacher_after: null, actors: [adminAccount] },
    ]);
    const [southLine, ...rest] = await lines([southLesson]);
    expect(rest).toEqual([]);
    expect(southLine).toMatchObject({
      branch_id: south,
      teacher_before: a.staffId,
      teacher_after: null,
      actors: [adminAccount],
    });
    expect(southLine?.actions.length).toBeGreaterThan(0);
  });
});
