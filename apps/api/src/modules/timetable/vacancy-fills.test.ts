import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  publishCheckSchema,
  timetableVersionSchema,
  vacancyDetailSchema,
  vacancyFillCheckSchema,
  vacancyFillSchema,
  vacancyListSchema,
  type VacancyFill,
  type VacancyFillCheck,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  MONDAY,
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
   * vacancy's row of 7A (Monday, slot 1) and, with `second`, of 7B (Tuesday,
   * slot 1).
   */
  async function scene(
    input: {
      second?: boolean;
      personSubjects?: 'none' | 'grade8';
      /** 7B taught in Russian; the vacancy teaches both languages, the person Uzbek only. */
      classBLanguage?: 'ru';
      /** A row of art taught by the person, placed in A at slot 1 of the weekday, for 7A or 7B. */
      art?: { weekday: number; unit: 'A' | 'B' };
    } = {},
  ) {
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
    const classB = await load.classes.schoolClass(branch, year, {
      grade: 7,
      room: roomB,
      ...(input.classBLanguage === undefined ? {} : { language: input.classBLanguage }),
    });
    const vacancy = await load.vacancy(branch, {
      subjects: [{ subject, grades: [7] }],
      languages: input.classBLanguage === undefined ? ['uz'] : ['uz', 'ru'],
    });
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
    const art = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    await load.profile(person, [{ subject: art, grades: [7] }]);
    let artRow: string | null = null;
    if (input.art !== undefined) {
      artRow = await load.row({
        branch_id: branch,
        version_id: a,
        class_id: input.art.unit === 'A' ? classA : classB,
        subject_id: art,
        teacher_id: person,
        lessons_per_week: 1,
      });
      await placeAt(branch, a, artRow, input.art.weekday);
    }
    await ready(branch, a);
    await published(branch, a, MONDAY);
    return {
      branch,
      year,
      subject,
      art,
      room,
      roomB,
      classA,
      classB,
      vacancy,
      person,
      a,
      rows,
      artRow,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /**
   * A copy of version `from`, its maths placed as in A (7A Monday, 7B
   * Tuesday), its art on `artDay` (Wednesday by default), with `extraB` a
   * row of maths for 7B under the vacancy on Tuesday, published from
   * `startsOn` to run until the next version.
   */
  async function laterCopy(
    s: Scene,
    from: string,
    startsOn: string,
    options: { artDay?: number; extraB?: boolean } = {},
  ) {
    const version = await draft(s.branch, s.year, from);
    const copied = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select(['id', 'class_id', 'subject_id'])
      .where('version_id', '=', version)
      .execute();
    for (const row of copied) {
      const weekday =
        row.subject_id === s.art ? (options.artDay ?? 3) : row.class_id === s.classA ? 1 : 2;
      await placeAt(s.branch, version, row.id, weekday);
    }
    if (options.extraB === true) {
      const rowId = await load.row({
        branch_id: s.branch,
        version_id: version,
        class_id: s.classB,
        subject_id: s.subject,
        teacher_id: s.vacancy,
        lessons_per_week: 1,
      });
      await placeAt(s.branch, version, rowId, 2);
    }
    await ready(s.branch, version);
    await published(s.branch, version, startsOn, { chain: 'run_until' });
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
      const personName = parsed.fills[0]?.person.name ?? '';
      expect(personName).not.toBe('');
      expect(parsed.fills).toEqual([
        {
          id: fill.id,
          startsOn: OCTOBER_19,
          person: { id: s.person, name: personName },
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
  /** The causes of a draft's mark out of date. */
  const causesOf = (id: string) =>
    t.database.migrator
      .selectFrom('timetable_version_out_of_date_causes')
      .select(['action', 'record_id'])
      .where('version_id', '=', id)
      .orderBy('caused_at')
      .orderBy('id')
      .execute();

  describe('the later versions', () => {
    it('changes a later published version that names the vacancy from its own start, in the same step; an open draft is marked and holds the vacancy open', async () => {
      const s = await scene();
      const b = await laterCopy(s, s.a, NOVEMBER);
      const open = await draft(s.branch, s.year, s.a);
      await load.freeEditLock(open);
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      expect(check.inPlace).toBe(false);
      expect(check.publish?.chain?.later.map((one) => one.id)).toEqual([b]);
      expect(check.publish?.chain?.carried.map((one) => [one.versionId, one.left])).toEqual([
        [b, false],
      ]);
      expect(check.closes).toBe(false);
      expect(check.holders.map((one) => one.versionId)).toEqual([open]);
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      expect(fill.closed).toBe(false);
      expect(await teachersOfRows(b)).toEqual([{ class_id: s.classA, teacher_id: s.person }]);
      const lessons = await lessonsOf(s.branch);
      const ofB = lessons.filter((one) => one.version_id === b);
      expect(ofB.length).toBeGreaterThan(5);
      expect(new Set(ofB.map((one) => one.teacher_id))).toEqual(new Set([s.person]));
      expect(ofB.every((one) => one.date >= NOVEMBER)).toBe(true);
      expect(await causesOf(open)).toEqual([
        { action: 'timetable_version.publish', record_id: fill.versionId },
      ]);
      expect(await liveStatusesOf(s.vacancy)).toEqual([
        { status: 'open', from: '2026-09-01', until: null },
      ]);
      const [carry] = await t.entries('timetable_version.carry', b);
      expect(carry).toMatchObject({ new_value: { fromVersionId: fill.versionId } });
    });

    it('fills a row found only in a later version, there (spec review of the plan, must-fix 4)', async () => {
      const s = await scene();
      const b = await laterCopy(s, s.a, NOVEMBER, { extraB: true });
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      expect(fill.rows.map((one) => [one.classId, one.filled])).toEqual(
        [
          [s.classA, true],
          [s.classB, true],
        ].sort((x, y) => (`${x[0]}` < `${y[0]}` ? -1 : 1)),
      );
      expect(await teachersOfRows(b)).toEqual(
        [
          { class_id: s.classA, teacher_id: s.person },
          { class_id: s.classB, teacher_id: s.person },
        ].sort((x, y) => (x.class_id < y.class_id ? -1 : 1)),
      );
      expect(fill.closed).toBe(true);
    });

    it('carries the fill into the version that starts on its date in place: no version is made (decision 4)', async () => {
      const s = await scene();
      const b = await laterCopy(s, s.a, NOVEMBER);
      const open = await draft(s.branch, s.year, s.a);
      await load.freeEditLock(open);
      const before = await versionsOf(s.branch);
      const check = await checked(s.branch, bodyOf(s, NOVEMBER));
      expect(check.inPlace).toBe(true);
      const fill = await filled(s, bodyOf(s, NOVEMBER));
      expect(fill.versionId).toBeNull();
      expect(await versionsOf(s.branch)).toEqual(before);
      expect(await teachersOfRows(b)).toEqual([{ class_id: s.classA, teacher_id: s.person }]);
      expect(await teachersOfRows(s.a)).toEqual([{ class_id: s.classA, teacher_id: s.vacancy }]);
      const lessons = await lessonsOf(s.branch);
      expect(
        new Set(lessons.filter((one) => one.date >= NOVEMBER).map((one) => one.teacher_id)),
      ).toEqual(new Set([s.person]));
      expect(
        new Set(lessons.filter((one) => one.date < NOVEMBER).map((one) => one.teacher_id)),
      ).toEqual(new Set([s.vacancy]));
      // Decision 15: the open draft is marked with the fill's cause, named by B.
      expect(await causesOf(open)).toEqual([{ action: 'vacancy.fill', record_id: b }]);
      const [carry] = await t.entries('timetable_version.carry', b);
      expect(carry).toMatchObject({
        new_value: {
          fromVersionId: null,
          vacancyFill: { vacancyId: s.vacancy, personId: s.person },
        },
      });
      const notices = await t.database.migrator
        .selectFrom('notifications')
        .select('kind')
        .where('branch_id', '=', s.branch)
        .where('kind', '=', 'timetable.vacancy_filled')
        .execute();
      expect(notices).toHaveLength(1);
    });
  });

  describe('the rows', () => {
    it('fills the rows chosen and leaves the others with the vacancy, which stays open', async () => {
      const s = await scene({ second: true });
      const fill = await filled(
        s,
        bodyOf(s, OCTOBER_19, { rows: [{ classId: s.classB, subjectId: s.subject }] }),
      );
      expect(fill.rows.map((one) => [one.classId, one.filled])).toEqual([[s.classB, true]]);
      expect(await teachersOfRows(fill.versionId ?? '')).toEqual(
        [
          { class_id: s.classA, teacher_id: s.vacancy },
          { class_id: s.classB, teacher_id: s.person },
        ].sort((x, y) => (x.class_id < y.class_id ? -1 : 1)),
      );
      expect(fill.closed).toBe(false);
      expect(fill.holders.map((one) => one.versionId)).toContain(fill.versionId);
    });

    it('leaves a row whose lessons meet a blocked rule with the person with the vacancy, listed, and fills the rest (decision 3)', async () => {
      // The person teaches art to 7A on Tuesdays at slot 1, the time of 7B's row.
      const s = await scene({ second: true, art: { weekday: 2, unit: 'A' } });
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      const byClass = new Map(check.rows.map((one) => [one.classId, one]));
      expect(byClass.get(s.classA)).toMatchObject({ filled: true, reason: null });
      expect(byClass.get(s.classB)).toMatchObject({ filled: false, reason: 'blocked' });
      // Listed with its dates: every Tuesday of the run from the date.
      expect(byClass.get(s.classB)?.dates.slice(0, 2)).toEqual(['2026-10-20', '2026-10-27']);
      expect(check.closes).toBe(false);
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      expect(await teachersOfRows(fill.versionId ?? '')).toEqual(
        expect.arrayContaining([
          { class_id: s.classA, teacher_id: s.person },
          { class_id: s.classB, teacher_id: s.vacancy },
        ]),
      );
      const [entry] = await t.entries('vacancy.fill', s.vacancy);
      expect(entry).toMatchObject({
        new_value: {
          rows: expect.arrayContaining([
            expect.objectContaining({ classId: s.classB, reason: 'blocked' }),
          ]) as unknown,
        },
      });
    });

    it('leaves a row the person is blocked on only in a later version with the vacancy in every version; no version is left', async () => {
      const s = await scene({ second: true, art: { weekday: 3, unit: 'A' } });
      // In B the person's art moves to Tuesday at slot 1, 7B's maths time.
      const b = await laterCopy(s, s.a, NOVEMBER, { artDay: 2 });
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      expect(check.rows.find((one) => one.classId === s.classB)).toMatchObject({
        filled: false,
        reason: 'blocked',
      });
      expect(check.publish?.chain?.carried.map((one) => one.left)).toEqual([false]);
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      for (const version of [fill.versionId ?? '', b]) {
        expect(await teachersOfRows(version)).toEqual(
          expect.arrayContaining([
            { class_id: s.classA, teacher_id: s.person },
            { class_id: s.classB, teacher_id: s.vacancy },
          ]),
        );
      }
    });

    it('answers fill_nothing when every row is blocked; the check shows no publish', async () => {
      // The person teaches art to 7B on Mondays at slot 1, 7A's maths time.
      const s = await scene({ art: { weekday: 1, unit: 'B' } });
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      expect(check.rows).toMatchObject([{ classId: s.classA, filled: false, reason: 'blocked' }]);
      expect(check.publish).toBeNull();
      expect(check.closes).toBe(false);
      refusedWith(
        await fillOf(s.branch, { ...bodyOf(s, OCTOBER_19), rowsKey: check.rowsKey }),
        409,
        'fill_nothing',
      );
    });

    it("leaves a row whose subject or grades are not in the person's profile, reason profile (spec review of the plan, must-fix 1)", async () => {
      const s = await scene({ second: true, personSubjects: 'grade8' });
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      expect(check.rows.map((one) => [one.filled, one.reason])).toEqual([
        [false, 'profile'],
        [false, 'profile'],
      ]);
      refusedWith(
        await fillOf(s.branch, { ...bodyOf(s, OCTOBER_19), rowsKey: check.rowsKey }),
        409,
        'fill_nothing',
      );
      const one = await scene({ second: true });
      await load.profile(one.person, []);
      // 7B only fits a person whose profile has grade 7: drop the person's
      // maths and the rows both stay.
      await t.database.migrator
        .deleteFrom('staff_subjects')
        .where('staff_id', '=', one.person)
        .where('subject_id', '=', one.subject)
        .execute();
      const none = await checked(one.branch, bodyOf(one, OCTOBER_19));
      expect(none.rows.every((row) => row.reason === 'profile')).toBe(true);
    });

    it('refuses the fill when the rows differ from those the check showed (fill_rows_changed)', async () => {
      const s = await scene({ second: true });
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      await t.database.migrator
        .updateTable('staff_subjects')
        .set({ grades: [8] })
        .where('staff_id', '=', s.person)
        .where('subject_id', '=', s.subject)
        .execute();
      const before = await lessonsOf(s.branch);
      refusedWith(
        await fillOf(s.branch, { ...bodyOf(s, OCTOBER_19), ...keysOf(check) }),
        409,
        'fill_rows_changed',
      );
      expect(await lessonsOf(s.branch)).toEqual(before);
    });
  });

  describe('refusals', () => {
    it("refuses a date today or earlier, a person who is not active on it or is a vacancy, a vacancy that is not open, and rows that are not the vacancy's", async () => {
      const s = await scene({ second: true });
      refusedWith(await checkFill(s.branch, bodyOf(s, '2026-10-10')), 409, 'fill_start');
      const other = await load.vacancy(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      refusedWith(
        await checkFill(s.branch, { ...bodyOf(s, OCTOBER_19), personId: other }),
        409,
        'fill_person',
      );
      const leaving = (
        await load.teacher(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] })
      ).staffId;
      await load.status(leaving, 'inactive', '2026-10-15');
      refusedWith(
        await checkFill(s.branch, { ...bodyOf(s, OCTOBER_19), personId: leaving }),
        409,
        'fill_person',
      );
      // Active on the date: the person is filled from it.
      expect(
        (await checkFill(s.branch, { ...bodyOf(s, '2026-10-13'), personId: leaving })).status,
      ).toBe(200);
      await load.status(other, 'closed', '2026-10-05');
      refusedWith(
        await checkFill(s.branch, { ...bodyOf(s, OCTOBER_19), vacancyId: other }),
        409,
        'fill_vacancy',
      );
      const empty = await load.vacancy(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      refusedWith(
        await checkFill(s.branch, { ...bodyOf(s, OCTOBER_19), vacancyId: empty }),
        409,
        'fill_rows',
      );
      const one = await scene();
      refusedWith(
        await checkFill(
          one.branch,
          bodyOf(one, OCTOBER_19, { rows: [{ classId: one.classB, subjectId: one.subject }] }),
        ),
        409,
        'fill_rows',
      );
    });
  });
  describe('a withdraw and a replace', () => {
    const withdraw = (branch: string, version: string) =>
      keyed(`/api/timetable/versions/${version}/withdraw`, branch, {});

    it("a withdraw of the fill's version before its start reopens the vacancy from the date, and its lessons come back (decision 7)", async () => {
      const s = await scene();
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      const answer = await withdraw(s.branch, fill.versionId ?? '');
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect((await liveStatusesOf(s.vacancy)).map((one) => one.status)).toEqual(['open', 'open']);
      expect(await liveStatusesOf(s.vacancy)).toEqual([
        { status: 'open', from: '2026-09-01', until: OCTOBER_19 },
        { status: 'open', from: OCTOBER_19, until: null },
      ]);
      expect(new Set((await lessonsOf(s.branch)).map((one) => one.teacher_id))).toEqual(
        new Set([s.vacancy]),
      );
      const [reopen] = await t.entries('vacancy.reopen', s.vacancy);
      expect(reopen).toMatchObject({
        new_value: { status: 'open', from: OCTOBER_19, byWithdraw: true },
      });
      const [entry] = await t.entries('timetable_version.withdraw', fill.versionId ?? '');
      expect(entry).toMatchObject({ new_value: { vacanciesReopened: [s.vacancy] } });
      const detail = vacancyDetailSchema.parse(
        (await t.get(`/api/people/vacancies/${s.vacancy}`, s.branch)).body,
      );
      expect(detail.fills.map((one) => one.withdrawn)).toEqual([true]);
    });

    it("a withdraw of another branch's fill version is 404 and reopens nothing in either branch (permission review of the code, must-fix 1)", async () => {
      const s = await scene();
      const theirs = await scene();
      const ours = await filled(s, bodyOf(s, OCTOBER_19));
      const their = await filled(theirs, bodyOf(theirs, OCTOBER_19));
      const before = await Promise.all([
        statusesOf(s.vacancy),
        statusesOf(theirs.vacancy),
        lessonsOf(s.branch),
        lessonsOf(theirs.branch),
        t.auditCount(),
      ]);
      for (const id of [their.versionId ?? '', UNKNOWN]) {
        refusedWith(await withdraw(s.branch, id), 404, 'not_found');
      }
      expect(ours.closed).toBe(true);
      expect(
        await Promise.all([
          statusesOf(s.vacancy),
          statusesOf(theirs.vacancy),
          lessonsOf(s.branch),
          lessonsOf(theirs.branch),
          t.auditCount(),
        ]),
      ).toEqual(before);
    });

    it('a withdraw whose run ends before the close day reopens nothing (spec review of the plan, should-fix 2)', async () => {
      const s = await scene();
      const b = await laterCopy(s, s.a, NOVEMBER);
      const fill = await filled(s, bodyOf(s, DECEMBER));
      expect(fill.closed).toBe(true);
      // A runs again from 9 November until the fill's version starts.
      const answer = await withdraw(s.branch, b);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(await liveStatusesOf(s.vacancy)).toEqual([
        { status: 'open', from: '2026-09-01', until: DECEMBER },
        { status: 'closed', from: DECEMBER, until: null },
      ]);
      expect(await t.entries('vacancy.reopen', s.vacancy)).toEqual([]);
      const lessons = await lessonsOf(s.branch);
      expect(
        new Set(lessons.filter((one) => one.date < DECEMBER).map((one) => one.teacher_id)),
      ).toEqual(new Set([s.vacancy]));
      expect(
        new Set(lessons.filter((one) => one.date >= DECEMBER).map((one) => one.teacher_id)),
      ).toEqual(new Set([s.person]));
    });

    it("a replace of the fill's version by a draft naming the vacancy is refused load_vacancy_closed; one that does not name it publishes, the vacancy still closed (review correction 1)", async () => {
      const s = await scene();
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      expect(fill.closed).toBe(true);
      const naming = await laterDraft(s, s.vacancy);
      const shown = await publishCheck(s.branch, naming, OCTOBER_19);
      const refused = await publish(s.branch, naming, OCTOBER_19, {
        chain: 'replace',
        laterKey: shown.chain?.key,
      });
      refusedWith(refused, 409, 'publish_blocked');
      expect(
        (refused.body as { error: { details: { code: string }[] } }).error.details.map(
          (one) => one.code,
        ),
      ).toContain('load_vacancy_closed');
      const other = await laterDraft(s, s.person);
      const otherShown = await publishCheck(s.branch, other, OCTOBER_19);
      await published(s.branch, other, OCTOBER_19, {
        chain: 'replace',
        laterKey: otherShown.chain?.key,
        dayChangesKey: otherShown.impact?.dayChanges.key,
      });
      expect(await liveStatusesOf(s.vacancy)).toEqual([
        { status: 'open', from: '2026-09-01', until: OCTOBER_19 },
        { status: 'closed', from: OCTOBER_19, until: null },
      ]);
    });
  });

  /** A draft of the year from 12 October with one row of maths for 7A taught by `teacherId`, Monday slot 1. */
  async function laterDraft(s: Scene, teacherId: string) {
    const version = await draft(s.branch, s.year);
    const rowId = await load.row({
      branch_id: s.branch,
      version_id: version,
      class_id: s.classA,
      subject_id: s.subject,
      teacher_id: teacherId,
      lessons_per_week: 1,
    });
    await placeAt(s.branch, version, rowId, 1);
    await ready(s.branch, version);
    return version;
  }

  const publishCheck = async (branch: string, version: string, startsOn: string) => {
    const answer = await t.get(
      `/api/timetable/versions/${version}/publish-check?startsOn=${startsOn}&chain=replace`,
      branch,
    );
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return publishCheckSchema.parse(answer.body);
  };

  describe('the close and the reopen by hand with a planned close (spec review of the plan, must-fix 5)', () => {
    it('a reopen by hand cancels the close a fill planned', async () => {
      const s = await scene();
      await filled(s, bodyOf(s, OCTOBER_19));
      const answer = await post(`/api/people/vacancies/${s.vacancy}/reopen`, s.branch);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(await liveStatusesOf(s.vacancy)).toEqual([
        { status: 'open', from: '2026-09-01', until: OCTOBER_19 },
        { status: 'open', from: OCTOBER_19, until: null },
      ]);
      const [reopen] = await t.entries('vacancy.reopen', s.vacancy);
      expect(reopen).toMatchObject({
        old_value: { plannedClose: OCTOBER_19 },
        new_value: { status: 'open', from: OCTOBER_19 },
      });
    });

    it('a close by hand empties the planned close and closes from today', async () => {
      const s = await scene();
      // In place from A's start: nothing holds the vacancy from today on.
      const fill = await filled(s, bodyOf(s, MONDAY));
      expect(fill.closed).toBe(true);
      const answer = await post(`/api/people/vacancies/${s.vacancy}/close`, s.branch);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(await liveStatusesOf(s.vacancy)).toEqual([
        { status: 'open', from: '2026-09-01', until: '2026-10-10' },
        { status: 'closed', from: '2026-10-10', until: null },
      ]);
    });
  });

  describe('the check', () => {
    /** Every row a fill writes, in the branches named. */
    const written = async (branches: readonly string[]) =>
      Promise.all([
        ...(
          [
            'timetable_versions',
            'teaching_load_rows',
            'pattern_blocks',
            'pattern_entries',
            'timetable_pins',
            'timetable_day_keeps',
            'timetable_version_out_of_date_causes',
            'lesson_blocks',
            'lessons',
            'time_claims',
            'journals',
            'vacancy_fills',
            'vacancy_fill_rows',
            // The publish's writes of the stored one-day changes, bulk cancels
            // and exams (permission review of the code, must-fix 2).
            'lesson_day_changes',
            'lesson_day_change_ends',
            'bulk_cancel_blocks',
            'lesson_exam_cancels',
            'lesson_block_class_outs',
          ] as const
        ).map((table) =>
          t.database.migrator
            .selectFrom(table)
            .selectAll()
            .where('branch_id', 'in', branches)
            .execute()
            .then((rows) => rows.map((row) => JSON.stringify(row)).sort()),
        ),
        t.database.migrator.selectFrom('staff_statuses').selectAll().orderBy('id').execute(),
        t.database.migrator.selectFrom('notifications').selectAll().orderBy('id').execute(),
        t.database.migrator.selectFrom('request_keys').selectAll().orderBy('key').execute(),
        t.auditCount(),
      ]);

    it('writes nothing', async () => {
      const s = await scene();
      await laterCopy(s, s.a, NOVEMBER);
      const before = await written([s.branch]);
      await checked(s.branch, bodyOf(s, OCTOBER_19));
      await checked(s.branch, bodyOf(s, NOVEMBER));
      expect(await written([s.branch])).toEqual(before);
    });

    it("answers 404 for another branch's or an unknown vacancy, person, class, group, subject, decision key or block, and changes nothing", async () => {
      const s = await scene();
      const theirs = await scene();
      const theirGroup = await load.classes.group(theirs.branch, theirs.year, theirs.subject, [
        theirs.classA,
      ]);
      const theirLesson = await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('branch_id', '=', theirs.branch)
        .executeTakeFirstOrThrow();
      const theirBlock = await t.database.migrator
        .selectFrom('pattern_blocks')
        .select('id')
        .where('branch_id', '=', theirs.branch)
        .executeTakeFirstOrThrow();
      const ownLesson = await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('branch_id', '=', s.branch)
        .executeTakeFirstOrThrow();
      const before = await written([s.branch, theirs.branch]);
      const bodies = [
        { ...bodyOf(s, OCTOBER_19), vacancyId: theirs.vacancy },
        { ...bodyOf(s, OCTOBER_19), vacancyId: UNKNOWN },
        { ...bodyOf(s, OCTOBER_19), personId: theirs.person },
        { ...bodyOf(s, OCTOBER_19), personId: UNKNOWN },
        bodyOf(s, OCTOBER_19, { rows: [{ classId: theirs.classA, subjectId: s.subject }] }),
        bodyOf(s, OCTOBER_19, { rows: [{ classId: UNKNOWN, subjectId: s.subject }] }),
        bodyOf(s, OCTOBER_19, { rows: [{ groupId: theirGroup, subjectId: s.subject }] }),
        bodyOf(s, OCTOBER_19, { rows: [{ groupId: UNKNOWN, subjectId: s.subject }] }),
        bodyOf(s, OCTOBER_19, { rows: [{ classId: s.classA, subjectId: UNKNOWN }] }),
      ];
      for (const body of bodies) {
        refusedWith(await checkFill(s.branch, body), 404, 'not_found');
        refusedWith(await fillOf(s.branch, { ...body, rowsKey: '0'.repeat(64) }), 404, 'not_found');
      }
      const decisions = [
        [{ key: UNKNOWN, choice: 'drop' }],
        [{ key: theirLesson.id, choice: 'drop' }],
        [{ key: ownLesson.id, blockId: theirBlock.id, blockDate: OCTOBER_19, choice: 'keep' }],
        [{ key: ownLesson.id, blockId: UNKNOWN, blockDate: OCTOBER_19, choice: 'keep' }],
      ];
      for (const dayDecisions of decisions) {
        refusedWith(
          await fillOf(s.branch, {
            ...bodyOf(s, OCTOBER_19),
            rowsKey: '0'.repeat(64),
            dayDecisions,
          }),
          404,
          'not_found',
        );
      }
      expect(await written([s.branch, theirs.branch])).toEqual(before);
    });
  });

  describe('the readers of the fill', () => {
    it("lists the fill in the hired person's personal-data report (permission review of the code, should-fix 3)", async () => {
      const s = await scene();
      await filled(s, bodyOf(s, OCTOBER_19));
      const report = await t.post(`/api/people/staff/${s.person}/report`, s.branch, {}, t.admin);
      expect(report.status, JSON.stringify(report.body)).toBe(200);
      const entries = (report.body as { entries: { action: string }[] }).entries;
      expect(entries.map((one) => one.action)).toContain('vacancy.fill');
    });
  });

  describe('the request key', () => {
    it('answers a repeat of the same key once and refuses it from another account', async () => {
      const s = await scene();
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      const key = randomUUID();
      const body = { ...bodyOf(s, OCTOBER_19), ...keysOf(check) };
      const first = await fillOf(s.branch, body, key);
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const again = await fillOf(s.branch, body, key);
      expect(again.status).toBe(201);
      expect(again.body).toEqual(first.body);
      expect(await t.entries('vacancy.fill', s.vacancy)).toHaveLength(1);
      const vice = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.viceAssignment)
        .executeTakeFirstOrThrow();
      await load.classes.role(vice.account_id, s.branch, 'academic_vice_principal');
      refusedWith(await fillOf(s.branch, body, key, t.vicePrincipal), 409, 'request_key_reused');
    });

    it('checks the branch and the permission again on a repeat, before the stored answer', async () => {
      const s = await scene();
      const theirs = await scene();
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      const key = randomUUID();
      const body = { ...bodyOf(s, OCTOBER_19), ...keysOf(check) };
      expect((await fillOf(s.branch, body, key)).status).toBe(201);
      // Permission review of the code, should-fix 1: every id of the body.
      const repeats = [
        { vacancyId: theirs.vacancy },
        { vacancyId: UNKNOWN },
        { personId: theirs.person },
        { personId: UNKNOWN },
        { rows: [{ classId: theirs.classA, subjectId: s.subject }] },
        { rows: [{ groupId: UNKNOWN, subjectId: s.subject }] },
        { dayDecisions: [{ key: UNKNOWN, choice: 'drop' }] },
      ];
      for (const one of repeats) {
        refusedWith(await fillOf(s.branch, { ...body, ...one }, key), 404, 'not_found');
      }
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(principal.account_id, s.branch, 'principal');
      expect((await fillOf(s.branch, body, key, t.principal)).status).toBe(403);
      expect((await checkFill(s.branch, bodyOf(s, OCTOBER_19), t.principal)).status).toBe(403);
    });
  });

  // .claude/rules/api.md: a test of two changes at the same moment runs the
  // real routes in a fixed order, behind a third transaction that holds the
  // row both wait on, in both directions.
  describe('at the same moment', () => {
    async function waitingForALock(): Promise<number> {
      const found = await sql<{ waiting: number }>`
        select count(distinct l.pid)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.waiting ?? 0;
    }

    /** `first`, then `second`, both waiting behind a hold of the staff row `staffId` FOR UPDATE. */
    async function inOrder(
      staffId: string,
      first: () => Promise<Response>,
      second: () => Promise<Response>,
    ): Promise<[Response, Response]> {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const done = t.database.migrator
        .transaction()
        .execute(async (transaction) => {
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', staffId)
            .forUpdate()
            .execute();
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await Promise.race([isReady, done]);
      const one = first().then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      const two = second().then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(1);
      release();
      expect(await done).toBeUndefined();
      return [await one, await two];
    }

    it('meets a fill and a reopen by hand of the vacancy, both directions', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
        const fill = () => fillOf(s.branch, { ...bodyOf(s, OCTOBER_19), ...keysOf(check) });
        const reopen = () => post(`/api/people/vacancies/${s.vacancy}/reopen`, s.branch);
        if (order === 0) {
          const [filling, reopening] = await inOrder(s.vacancy, fill, reopen);
          expect(filling.status, JSON.stringify(filling.body)).toBe(201);
          // The reopen comes after the fill and cancels the close it planned.
          expect(reopening.status, JSON.stringify(reopening.body)).toBe(200);
          expect((await liveStatusesOf(s.vacancy)).map((one) => one.status)).toEqual([
            'open',
            'open',
          ]);
        } else {
          const [reopening, filling] = await inOrder(s.vacancy, reopen, fill);
          // The vacancy is open: nothing to reopen; the fill then plans its close.
          refusedWith(reopening, 409, 'status_unchanged');
          expect(filling.status, JSON.stringify(filling.body)).toBe(201);
          expect((await liveStatusesOf(s.vacancy)).map((one) => one.status)).toEqual([
            'open',
            'closed',
          ]);
        }
      }
    });

    it('meets a fill in place and a close by hand of the vacancy, both directions (spec review of the code, must-fix 5)', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const check = await checked(s.branch, bodyOf(s, MONDAY));
        const fill = () => fillOf(s.branch, { ...bodyOf(s, MONDAY), ...keysOf(check) });
        const close = () => post(`/api/people/vacancies/${s.vacancy}/close`, s.branch);
        if (order === 0) {
          const [filling, closing] = await inOrder(s.vacancy, fill, close);
          expect(filling.status, JSON.stringify(filling.body)).toBe(201);
          // After the fill nothing holds the vacancy from today: the close by
          // hand empties the planned close and closes from today.
          expect(closing.status, JSON.stringify(closing.body)).toBe(200);
          expect(await liveStatusesOf(s.vacancy)).toEqual([
            { status: 'open', from: '2026-09-01', until: '2026-10-10' },
            { status: 'closed', from: '2026-10-10', until: null },
          ]);
        } else {
          const [closing, filling] = await inOrder(s.vacancy, close, fill);
          // Version A still names the vacancy: the close is refused.
          refusedWith(closing, 409, 'vacancy_has_load');
          expect(filling.status, JSON.stringify(filling.body)).toBe(201);
          expect(await liveStatusesOf(s.vacancy)).toEqual([
            { status: 'open', from: '2026-09-01', until: MONDAY },
            { status: 'closed', from: MONDAY, until: null },
          ]);
        }
      }
    });

    it("meets a fill and the person's status change, both directions", async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
        const fill = () => fillOf(s.branch, { ...bodyOf(s, OCTOBER_19), ...keysOf(check) });
        const leave = () =>
          post(`/api/people/staff/${s.person}/status`, s.branch, {
            status: 'inactive',
            from: '2026-10-15',
          });
        if (order === 0) {
          const [filling, leaving] = await inOrder(s.person, fill, leave);
          expect(filling.status, JSON.stringify(filling.body)).toBe(201);
          expect(leaving.status, JSON.stringify(leaving.body)).toBe(200);
          expect(await t.entries('vacancy.fill', s.vacancy)).toHaveLength(1);
        } else {
          const [leaving, filling] = await inOrder(s.person, leave, fill);
          expect(leaving.status, JSON.stringify(leaving.body)).toBe(200);
          refusedWith(filling, 409, 'fill_person');
          expect(await t.entries('vacancy.fill', s.vacancy)).toEqual([]);
        }
      }
    });
  });
  describe('the spec review of the code', () => {
    it('leaves a row whose language the person does not teach, reason profile, and fills the others (must-fix 1)', async () => {
      const s = await scene({ second: true, classBLanguage: 'ru' });
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      const byClass = new Map(fill.rows.map((one) => [one.classId, one]));
      expect(byClass.get(s.classA)).toMatchObject({ filled: true, reason: null });
      expect(byClass.get(s.classB)).toMatchObject({ filled: false, reason: 'profile', dates: [] });
      expect(await teachersOfRows(fill.versionId ?? '')).toEqual(
        expect.arrayContaining([
          { class_id: s.classA, teacher_id: s.person },
          { class_id: s.classB, teacher_id: s.vacancy },
        ]),
      );
    });

    it('leaves a row whose lesson meets the person in another branch on one date, listed with that date (must-fix 2)', async () => {
      const s = await scene();
      const other = await scene();
      // The person also works in the other branch and is recorded there on
      // one lesson of 26 October at the same time as 7A's maths here.
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.person, branch_id: other.branch, is_main: false })
        .execute();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.person })
        .where('branch_id', '=', other.branch)
        .where('lesson_date', '=', '2026-10-26')
        .execute();
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      expect(check.rows).toMatchObject([
        { classId: s.classA, filled: false, reason: 'blocked', dates: ['2026-10-26'] },
      ]);
    });

    it('a withdraw of the fill version after a carry keeps the carried version as it is and reopens the vacancy (must-fix 4)', async () => {
      const s = await scene();
      const b = await laterCopy(s, s.a, NOVEMBER);
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      expect(fill.closed).toBe(true);
      const answer = await keyed(
        `/api/timetable/versions/${fill.versionId ?? ''}/withdraw`,
        s.branch,
        {},
      );
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      // 5.5c-2a decision 13: the carry into B stays.
      expect(await teachersOfRows(b)).toEqual([{ class_id: s.classA, teacher_id: s.person }]);
      const lessons = await lessonsOf(s.branch);
      expect(
        new Set(lessons.filter((one) => one.date < NOVEMBER).map((one) => one.teacher_id)),
      ).toEqual(new Set([s.vacancy]));
      expect(
        new Set(lessons.filter((one) => one.date >= NOVEMBER).map((one) => one.teacher_id)),
      ).toEqual(new Set([s.person]));
      expect((await liveStatusesOf(s.vacancy)).map((one) => one.status)).toEqual(['open', 'open']);
    });

    it('refuses a second fill of a vacancy whose close is already planned (should-fix 3)', async () => {
      const s = await scene({ second: true });
      await filled(s, bodyOf(s, OCTOBER_19));
      refusedWith(await checkFill(s.branch, bodyOf(s, DECEMBER)), 409, 'fill_vacancy');
    });
  });
  describe('the names and the planned close of the screen (task 5.7a-3b)', () => {
    const unitsOf = async (classIds: readonly string[], groupIds: readonly string[] = []) => [
      ...(classIds.length === 0
        ? []
        : await t.database.migrator
            .selectFrom('classes')
            .select(['id', 'name', 'grade'])
            .where('id', 'in', classIds)
            .execute()
      ).map((one) => ({ id: one.id, kind: 'class', name: one.name, grades: [one.grade] })),
      ...(groupIds.length === 0
        ? []
        : await t.database.migrator
            .selectFrom('groups')
            .select(['id', 'name'])
            .where('id', 'in', groupIds)
            .execute()
      ).map((one) => ({ id: one.id, kind: 'group', name: one.name, grades: [7] })),
    ];
    const byId = <T extends { id: string }>(list: readonly T[]) =>
      [...list].sort((a, b) => (a.id < b.id ? -1 : 1));

    it('the check names the class of every row, filled or left (decision 6)', async () => {
      // 7B's row is blocked on Tuesdays: one row filled, one left.
      const s = await scene({ second: true, art: { weekday: 2, unit: 'A' } });
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      expect(check.rows.map((one) => one.filled).sort()).toEqual([false, true]);
      expect(check.units).toEqual(byId(await unitsOf([s.classA, s.classB])));
    });

    it('the check names the rows when every row is left and nothing is published', async () => {
      const s = await scene({ second: true, personSubjects: 'grade8' });
      const check = await checked(s.branch, bodyOf(s, OCTOBER_19));
      expect(check.publish).toBeNull();
      expect(check.units).toEqual(byId(await unitsOf([s.classA, s.classB])));
    });

    it('the record names the classes and groups of its fills, archived ones included, a withdrawn fill too', async () => {
      const s = await scene();
      const fill = await filled(s, bodyOf(s, OCTOBER_19));
      const group = await load.classes.group(s.branch, s.year, s.subject, [s.classA]);
      // A row of a group in the fill's history, the group archived after it.
      await t.database.migrator
        .insertInto('vacancy_fill_rows')
        .values({ fill_id: fill.id, branch_id: s.branch, group_id: group, subject_id: s.subject })
        .execute();
      await t.database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date('2026-10-12T08:00:00Z') })
        .where('id', '=', group)
        .execute();
      const withdrawn = await keyed(
        `/api/timetable/versions/${fill.versionId ?? ''}/withdraw`,
        s.branch,
        {},
      );
      expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
      const detail = vacancyDetailSchema.parse(
        (await t.get(`/api/people/vacancies/${s.vacancy}`, s.branch)).body,
      );
      expect(detail.fills.map((one) => one.withdrawn)).toEqual([true]);
      expect(detail.fillUnits).toEqual(byId(await unitsOf([s.classA], [group])));
    });

    it('the list and the record give the close a fill planned; a reopen that cancels it gives none', async () => {
      const s = await scene();
      const listed = async () =>
        vacancyListSchema
          .parse((await t.get('/api/people/vacancies', s.branch)).body)
          .vacancies.find((one) => one.id === s.vacancy);
      expect((await listed())?.closesOn).toBeNull();
      await filled(s, bodyOf(s, OCTOBER_19));
      expect(await listed()).toMatchObject({ status: 'open', closesOn: OCTOBER_19 });
      const detail = vacancyDetailSchema.parse(
        (await t.get(`/api/people/vacancies/${s.vacancy}`, s.branch)).body,
      );
      expect(detail.closesOn).toBe(OCTOBER_19);
      const reopened = await post(`/api/people/vacancies/${s.vacancy}/reopen`, s.branch);
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
      // The cancelled plan is an empty closed row, still stored.
      const stored = await t.database.migrator
        .selectFrom('staff_statuses')
        .select(['status', 'valid_from', 'valid_until'])
        .where('staff_id', '=', s.vacancy)
        .where('status', '=', 'closed')
        .execute();
      expect(stored).toHaveLength(1);
      expect((await listed())?.closesOn).toBeNull();
    });

    it('a close by hand from today gives no planned close', async () => {
      const s = await scene();
      // In place from A's start: nothing holds the vacancy from today on.
      const fill = await filled(s, bodyOf(s, MONDAY));
      expect(fill.closed).toBe(true);
      const closed = await post(`/api/people/vacancies/${s.vacancy}/close`, s.branch);
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);
      const detail = vacancyDetailSchema.parse(
        (await t.get(`/api/people/vacancies/${s.vacancy}`, s.branch)).body,
      );
      expect(detail).toMatchObject({ status: 'closed', closesOn: null });
    });
  });
});
