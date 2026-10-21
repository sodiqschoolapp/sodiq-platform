import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  timetableVersionSchema,
  vacancyDetailSchema,
  vacancyFillCheckSchema,
  vacancyFillSchema,
  type VacancyFill,
  type VacancyFillCheck,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  MONDAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** A Monday a week after the first version's start: the fill's date inside its run. */
const OCTOBER_19 = '2026-10-19';
/** The second quarter's first day, a Monday: the start of a later version. */
const NOVEMBER = '2026-11-09';
/** A Monday inside the second quarter. */
const DECEMBER = '2026-12-07';

// All names are invented. Task 5.7a-3a, pull request #188: filling a vacancy
// (docs/spec/06-timetable.md, Changes after publishing, "Filling a vacancy";
// edge/timetable, After publishing, the vacancy rows; 04, Vacancy). The
// clock stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('vacancy fill', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const post = (path: string, branch: string, body: object = {}, cookie = t.admin) =>
    t.post(path, branch, body, cookie);

  const keyed = (
    path: string,
    branch: string,
    body: object,
    key = randomUUID(),
    cookie = t.admin,
  ) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send(body);

  const publish = (branch: string, version: string, startsOn: string, extra: object = {}) =>
    keyed(`/api/timetable/versions/${version}/publish`, branch, { startsOn, ...extra });

  const published = async (branch: string, version: string, startsOn: string, extra = {}) => {
    const answer = await publish(branch, version, startsOn, extra);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return timetableVersionSchema.parse(answer.body);
  };

  /** Hours of a record in the branch from 1 September, Monday to Friday, all day. */
  async function hours(branch: string, staffId: string) {
    const entry = await t.database.migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    for (const weekday of [1, 2, 3, 4, 5]) {
      await t.database.migrator
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: entry.id,
          branch_id: branch,
          staff_id: staffId,
          weekday,
          start_minutes: 0,
          end_minutes: 1440,
          valid_from: '2026-09-01',
          valid_until: entry.valid_until,
        })
        .execute();
    }
  }

  const draft = async (branch: string, year: string, copyFrom: string | null = null) => {
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
      copyFrom,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return (created.body as { id: string }).id;
  };

  const placeAt = async (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition = 1,
  ) => {
    const placed = await post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  const ready = async (branch: string, version: string) => {
    const confirmed = await post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(version);
  };

  interface Unit {
    readonly classId: string;
    readonly rowSlot: { weekday: number; slotPosition: number };
  }

  /**
   * A branch of its own with a year of four dated quarters, a day of lesson,
   * break, lesson, break, lesson on every weekday from 08:00, the classes 7A
   * and 7B, a subject of grade 7, a vacancy for it, and a person hired who
   * teaches it; version A, published from Monday 12 October, holds the
   * vacancy's row of 7A (Monday, slot 1) and, with \`second\`, of 7B (Tuesday,
   * slot 1).
   */
  async function scene(input: { second?: boolean; personSubjects?: 'none' | 'grade8' } = {}) {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    for (const [index, [start, end]] of QUARTERS.entries()) {
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
        .execute();
    }
    const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
    const pause = await t.createSlotType(branch, 'Break', 'break', 10);
    const regular = await t.createTemplate(branch, 'Regular', [
      lesson,
      pause,
      lesson,
      pause,
      lesson,
    ]);
    await t.assign(branch, regular);
    const subject = await load.classes.subject({ grades: [7, 8], journalType: 'attendance_only' });
    const room = await load.classes.room(branch);
    const roomB = await load.classes.room(branch);
    const classA = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const classB = await load.classes.schoolClass(branch, year, { grade: 7, room: roomB });
    const vacancy = await load.vacancy(branch, { subjects: [{ subject, grades: [7] }] });
    await hours(branch, vacancy);
    const person = (
      await load.teacher(branch, {
        subjects:
          input.personSubjects === 'none'
            ? []
            : [{ subject, grades: input.personSubjects === 'grade8' ? [8] : [7] }],
      })
    ).staffId;
    await hours(branch, person);
    const a = await draft(branch, year);
    const units: Unit[] = [{ classId: classA, rowSlot: { weekday: 1, slotPosition: 1 } }];
    if (input.second === true) {
      units.push({ classId: classB, rowSlot: { weekday: 2, slotPosition: 1 } });
    }
    const rows: string[] = [];
    for (const unit of units) {
      const rowId = await load.row({
        branch_id: branch,
        version_id: a,
        class_id: unit.classId,
        subject_id: subject,
        teacher_id: vacancy,
        lessons_per_week: 1,
      });
      await placeAt(branch, a, rowId, unit.rowSlot.weekday, unit.rowSlot.slotPosition);
      rows.push(rowId);
    }
    await ready(branch, a);
    await published(branch, a, MONDAY);
    return { branch, year, subject, room, roomB, classA, classB, vacancy, person, a, rows };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** A copy of version \`from\` placed as it was, published from \`startsOn\` with \`chain\`. */
  async function laterCopy(s: Scene, from: string, startsOn: string) {
    const version = await draft(s.branch, s.year, from);
    const copied = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select(['id', 'class_id'])
      .where('version_id', '=', version)
      .execute();
    for (const row of copied) {
      await placeAt(s.branch, version, row.id, row.class_id === s.classA ? 1 : 2);
    }
    await ready(s.branch, version);
    await published(s.branch, version, startsOn, { chain: 'until' });
    return version;
  }

  const checkFill = (branch: string, body: object, cookie = t.admin) =>
    post('/api/timetable/vacancy-fills/check', branch, body, cookie);

  const checked = async (branch: string, body: object): Promise<VacancyFillCheck> => {
    const answer = await checkFill(branch, body);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return vacancyFillCheckSchema.parse(answer.body);
  };

  /** The keys of a check, as the fill sends them. */
  const keysOf = (check: VacancyFillCheck) => ({
    rowsKey: check.rowsKey,
    ...(check.publish?.chain === null || check.publish?.chain === undefined
      ? {}
      : { laterKey: check.publish.chain.key }),
    ...(check.publish?.impact?.transition?.key === undefined ||
    check.publish.impact.transition.key === null
      ? {}
      : { transitionKey: check.publish.impact.transition.key }),
    ...(check.publish?.impact === null || check.publish?.impact === undefined
      ? {}
      : { dayChangesKey: check.publish.impact.dayChanges.key }),
  });

  const fillOf = (branch: string, body: object, key = randomUUID(), cookie = t.admin) =>
    keyed('/api/timetable/vacancy-fills', branch, body, key, cookie);

  /** The check, then the fill with its keys. */
  const filled = async (s: { branch: string }, body: object): Promise<VacancyFill> => {
    const check = await checked(s.branch, body);
    const answer = await fillOf(s.branch, { ...body, ...keysOf(check) });
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    return vacancyFillSchema.parse(answer.body);
  };

  const bodyOf = (s: Scene, startsOn: string, extra: object = {}) => ({
    vacancyId: s.vacancy,
    personId: s.person,
    startsOn,
    ...extra,
  });

  /** The dated lessons of a branch: date, teacher and the version of the block. */
  const lessonsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
      .select([
        sql<string>`lessons.lesson_date::text`.as('date'),
        'lessons.class_id',
        'lessons.teacher_id',
        'lesson_blocks.version_id',
      ])
      .where('lessons.branch_id', '=', branch)
      .orderBy('lessons.lesson_date')
      .orderBy('lessons.starts_at')
      .execute();

  const versionsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('timetable_versions')
      .select([
        'id',
        'number',
        'status',
        sql<string>`starts_on::text`.as('starts_on'),
        'from_version_id',
      ])
      .where('branch_id', '=', branch)
      .orderBy('number')
      .execute();

  const teachersOfRows = (version: string) =>
    t.database.migrator
      .selectFrom('teaching_load_rows')
      .select(['class_id', 'teacher_id'])
      .where('version_id', '=', version)
      .orderBy('class_id')
      .execute();

  const statusesOf = (staffId: string) =>
    t.database.migrator
      .selectFrom('staff_statuses')
      .select([
        'status',
        sql<string>`valid_from::text`.as('from'),
        sql<string | null>`valid_until::text`.as('until'),
      ])
      .where('staff_id', '=', staffId)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  /** The live status rows of a record, an emptied row left out. */
  const liveStatusesOf = async (staffId: string) =>
    (await statusesOf(staffId)).filter((one) => one.from !== one.until);

  describe('a fill from a date inside the version in force', () => {
    it('publishes a version from the date that differs only in the teacher of the rows; earlier lessons keep the vacancy', async () => {
      const s = await scene();
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      expect(fill.rows).toEqual([
        {
          classId: s.classA,
          groupId: null,
          subjectId: s.subject,
          filled: true,
          reason: null,
          dates: [],
        },
      ]);
      expect(fill.versionId).not.toBeNull();
      const versions = await versionsOf(s.branch);
      const made = versions.find((one) => one.id === fill.versionId);
      expect(made).toMatchObject({
        status: 'published',
        starts_on: OCTOBER_19,
        from_version_id: s.a,
      });
      expect(await teachersOfRows(fill.versionId ?? '')).toEqual([
        { class_id: s.classA, teacher_id: s.person },
      ]);
      // The version in force keeps the vacancy; it runs until the day before.
      expect(await teachersOfRows(s.a)).toEqual([{ class_id: s.classA, teacher_id: s.vacancy }]);
      const lessons = await lessonsOf(s.branch);
      expect(lessons.filter((one) => one.date < OCTOBER_19).map((one) => one.teacher_id)).toEqual([
        s.vacancy,
      ]);
      const after = lessons.filter((one) => one.date >= OCTOBER_19);
      expect(after.length).toBeGreaterThan(20);
      expect(new Set(after.map((one) => one.teacher_id))).toEqual(new Set([s.person]));
      expect(new Set(after.map((one) => one.version_id))).toEqual(new Set([fill.versionId]));
    });

    it('closes the vacancy from the fill date when nothing holds it; open until then', async () => {
      const s = await scene();
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      expect(check.closes).toBe(true);
      expect(check.holders).toEqual([]);
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      expect(fill.closed).toBe(true);
      expect(await liveStatusesOf(s.vacancy)).toEqual([
        { status: 'open', from: '2026-09-01', until: OCTOBER_19 },
        { status: 'closed', from: OCTOBER_19, until: null },
      ]);
      const detail = await t.get(`/api/people/vacancies/${s.vacancy}`, s.branch);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      const parsed = vacancyDetailSchema.parse(detail.body);
      // Today the vacancy is still open: its lessons before the date run.
      expect(parsed.status).toBe('open');
      expect(parsed.fills).toEqual([
        {
          id: fill.id,
          startsOn: OCTOBER_19,
          person: { id: s.person, name: expect.any(String) as unknown as string },
          rows: [{ classId: s.classA, groupId: null, subjectId: s.subject }],
          versionNumber: 2,
          withdrawn: false,
        },
      ]);
      const [close] = await t.entries('vacancy.close', s.vacancy);
      expect(close).toMatchObject({
        new_value: { status: 'closed', from: OCTOBER_19, byFill: true },
      });
      const [entry] = await t.entries('vacancy.fill', s.vacancy);
      expect(entry).toMatchObject({
        person_id: s.person,
        new_value: { fillId: fill.id, personId: s.person, from: OCTOBER_19, closed: true },
      });
      const [published] = await t.entries('timetable_version.publish', fill.versionId ?? '');
      expect(published).toMatchObject({
        new_value: { vacancyFill: { vacancyId: s.vacancy, personId: s.person } },
      });
    });
  });
});
