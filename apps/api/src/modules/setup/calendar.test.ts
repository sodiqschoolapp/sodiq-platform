import {
  apiErrorSchema,
  branchSchema,
  calendarDateSchema,
  calendarEntryListSchema,
  calendarEntrySchema,
  calendarPreviewSchema,
  dayTemplateListSchema,
  type CalendarEntry,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  START,
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const detailPaths = (response: Response): string[] =>
  apiErrorSchema.parse(response.body).error.details?.map((detail) => detail.path) ?? [];

// TODAY is Saturday 10 October 2026 in Tashkent.
const MONDAY = '2026-10-12';
const TUESDAY = '2026-10-13';
const WEDNESDAY = '2026-10-14';
const THURSDAY = '2026-10-15';
const SATURDAY = '2026-10-17';
const SUNDAY = '2026-10-18';

interface Fields {
  kind?: 'day_off' | 'special_day';
  name?: string;
  firstDate?: string;
  lastDate?: string;
  gradeFrom?: number | null;
  gradeTo?: number | null;
  dayTemplateId?: string | null;
  followsWeekday?: number | null;
  examWeek?: string | null;
}

const record = (fields: Fields = {}) => ({
  kind: fields.kind ?? 'day_off',
  name: fields.name ?? 'Day off',
  firstDate: fields.firstDate ?? WEDNESDAY,
  lastDate: fields.lastDate ?? fields.firstDate ?? WEDNESDAY,
  gradeFrom: fields.gradeFrom ?? null,
  gradeTo: fields.gradeTo ?? null,
  dayTemplateId: fields.dayTemplateId ?? null,
  followsWeekday: fields.followsWeekday ?? null,
  examWeek: fields.examWeek ?? null,
});

const special = (dayTemplateId: string, fields: Fields = {}) =>
  record({ kind: 'special_day', name: 'Short day', dayTemplateId, ...fields });

// docs/spec/03-school-setup.md, Academic calendar: "Days off (holidays,
// vacations) and special days: shortened day, exam week, open-doors day, a
// working Saturday. Each date resolves to 'no lessons' or to one day
// template." Owner: the Academic Vice Principal.
// docs/spec/edge-cases/time-dates-calendar.md; docs/spec/edge-cases/academic-year.md
// ("Go-live can be on any school day"); the owner's answers 15 to 18 and the
// plan approved on pull request #47.
describe('the calendar', () => {
  let t: DayTemplatesKit;

  beforeAll(async () => {
    t = await dayTemplatesKit();
    await addYear(t.north);
  });

  afterAll(async () => {
    await t.close();
  });

  /** A planned year of the branch from 1 September 2026 to 30 June 2027, written by the Super Admin. */
  async function addYear(branch: string, startDate = '2026-09-01', endDate = '2027-06-30') {
    const response = await t.post('/api/setup/academic-years', branch, { startDate, endDate });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as { id: string }).id;
  }

  /** A branch (Monday to Friday) with a year, a default template and a short template. */
  async function branchWith() {
    const branch = await t.newBranch();
    await addYear(branch);
    const lesson = await t.createSlotType(branch, 'Lesson 45');
    const main = await t.createTemplate(branch, 'Main', [lesson, lesson]);
    const short = await t.createTemplate(branch, 'Short', [lesson]);
    await t.assign(branch, main);
    return { branch, main, short };
  }

  async function create(branch: string, body: object, cookie = t.admin): Promise<CalendarEntry> {
    const response = await t.post('/api/setup/calendar-entries', branch, body, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return calendarEntrySchema.parse(response.body);
  }

  /** An entry written by the migrator, for dates no route may write any more. */
  async function insertEntry(branch: string, fields: Fields): Promise<string> {
    const body = record(fields);
    const row = await t.database.migrator
      .insertInto('calendar_entries')
      .values({
        branch_id: branch,
        kind: body.kind,
        name: body.name,
        first_date: body.firstDate,
        last_date: body.lastDate,
        grade_from: body.gradeFrom,
        grade_to: body.gradeTo,
        day_template_id: body.dayTemplateId,
        follows_weekday: body.followsWeekday,
        exam_week: body.examWeek,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** Every row a calendar save may write in a branch: its entries and its branch row. */
  async function rowsOf(branch: string) {
    return {
      entries: await t.database.migrator
        .selectFrom('calendar_entries')
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute(),
      branch: await t.database.migrator
        .selectFrom('branches')
        .selectAll()
        .where('id', '=', branch)
        .execute(),
    };
  }

  const put = (path: string, branch: string, body: object, cookie = t.admin) =>
    request(t.kit.server).put(path).set('Cookie', cookie).set('X-Branch-Id', branch).send(body);

  it('takes entries of the Super Admin and the Academic Vice Principal, with an audit entry, and lists them', async () => {
    const before = await t.auditCount();
    const response = await t.post(
      '/api/setup/calendar-entries',
      t.north,
      record({ name: 'Teachers day', gradeFrom: 1, gradeTo: 4 }),
      t.vicePrincipal,
    );
    expect(response.status).toBe(201);
    const entry = calendarEntrySchema.parse(response.body);
    expect(entry).toEqual({
      id: entry.id,
      kind: 'day_off',
      name: 'Teachers day',
      firstDate: WEDNESDAY,
      lastDate: WEDNESDAY,
      gradeFrom: 1,
      gradeTo: 4,
      dayTemplateId: null,
      dayTemplateName: null,
      followsWeekday: null,
      examWeek: null,
      archivedAt: null,
    });
    expect(await t.entries('calendar_entry.create', entry.id)).toEqual([
      expect.objectContaining({
        branch_id: t.north,
        assignment_id: t.viceAssignment,
        record_type: 'calendar_entry',
        old_value: null,
        new_value: expect.objectContaining({ name: 'Teachers day', gradeFrom: 1 }) as unknown,
        request_id: response.headers['x-request-id'],
      }),
    ]);
    expect(await t.auditCount()).toBe(before + 1);

    const byAdmin = await create(t.north, record({ name: 'Open day', firstDate: THURSDAY }));
    expect(await t.entries('calendar_entry.create', byAdmin.id)).toEqual([
      expect.objectContaining({ assignment_id: t.adminAssignment }),
    ]);

    for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
      const list = await t.get('/api/setup/calendar-entries', t.north, cookie);
      expect(list.status).toBe(200);
      const parsed = calendarEntryListSchema.parse(list.body);
      expect(parsed.today).toBe(TODAY);
      expect(parsed.entries.map((one) => one.id)).toEqual(
        expect.arrayContaining([entry.id, byAdmin.id]),
      );
    }
  });

  it('refuses the Principal and a Teacher on every write and a Teacher on the reads; nothing is written', async () => {
    const entry = await create(t.north, record({ name: 'Refused', firstDate: '2026-11-02' }));
    const rows = await rowsOf(t.north);
    const before = await t.auditCount();
    for (const cookie of [t.principal, t.teacher]) {
      const attempts = [
        () =>
          t.post(
            '/api/setup/calendar-entries',
            t.north,
            record({ firstDate: '2026-11-03' }),
            cookie,
          ),
        () =>
          t.patch(
            `/api/setup/calendar-entries/${entry.id}`,
            t.north,
            record({ name: 'Changed', firstDate: '2026-11-02' }),
            cookie,
          ),
        () => t.post(`/api/setup/calendar-entries/${entry.id}/archive`, t.north, {}, cookie),
        () => t.post(`/api/setup/calendar-entries/${entry.id}/restore`, t.north, {}, cookie),
        () =>
          t.post(
            '/api/setup/calendar-entries/preview',
            t.north,
            { action: 'create', record: record({ firstDate: '2026-11-03' }) },
            cookie,
          ),
        () =>
          t.post(
            '/api/setup/calendar-entries/preview',
            t.north,
            { action: 'edit', id: entry.id, record: record({ firstDate: '2026-11-04' }) },
            cookie,
          ),
        () =>
          t.post(
            '/api/setup/calendar-entries/preview',
            t.north,
            { action: 'archive', id: entry.id },
            cookie,
          ),
      ];
      for (const attempt of attempts) {
        expect((await attempt()).status).toBe(403);
      }
    }
    for (const path of ['/api/setup/calendar-entries', `/api/setup/calendar-day?date=${MONDAY}`]) {
      expect((await t.get(path, t.north, t.teacher)).status).toBe(403);
      expect((await t.get(path, t.north, t.principal)).status).toBe(200);
    }
    expect(await rowsOf(t.north)).toEqual(rows);
    expect(await t.auditCount()).toBe(before);
  });

  // Answer 16: "Only dates from tomorrow on (branch time zone) can be created
  // or changed"; edge/time-dates-calendar: "Today and past dates cannot become
  // a day off."
  it('refuses today and a past date, and takes tomorrow', async () => {
    const { branch } = await branchWith();
    for (const firstDate of [TODAY, '2026-10-01']) {
      const response = await t.post(
        '/api/setup/calendar-entries',
        branch,
        record({ firstDate, lastDate: MONDAY }),
      );
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('calendar_date_not_in_future');
      expect(detailPaths(response)).toEqual(['firstDate']);
    }
    await create(branch, record({ firstDate: TOMORROW, lastDate: TOMORROW }));
  });

  // Answer 16: "Entries fall inside a planned or current year"; decision 5.
  it('keeps an entry inside one planned or current year', async () => {
    const branch = await t.newBranch();
    const response = await t.post('/api/setup/calendar-entries', branch, record());
    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('calendar_outside_year');

    await addYear(branch, '2026-09-01', '2027-05-31');
    await addYear(branch, '2027-06-01', '2028-05-31');
    const across = await t.post(
      '/api/setup/calendar-entries',
      branch,
      record({ firstDate: '2027-05-30', lastDate: '2027-06-02' }),
    );
    expect(errorCode(across)).toBe('calendar_outside_year');
    expect(detailPaths(across)).toEqual(['firstDate', 'lastDate']);
    await create(branch, record({ firstDate: '2027-05-30', lastDate: '2027-05-31' }));
  });

  it('refuses a year edit that would leave an active entry outside its year', async () => {
    const branch = await t.newBranch();
    const year = await addYear(branch);
    await create(branch, record({ firstDate: '2027-06-28', lastDate: '2027-06-29' }));
    const response = await put(`/api/setup/academic-years/${year}`, branch, {
      startDate: '2026-09-01',
      endDate: '2027-06-15',
    });
    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('calendar_outside_year');
    expect(detailPaths(response)).toEqual(['endDate']);
    const longer = await put(`/api/setup/academic-years/${year}`, branch, {
      startDate: '2026-09-01',
      endDate: '2027-06-30',
    });
    expect(longer.status).toBe(200);
  });

  // Answer 17: "two entries of the same kind are refused (database
  // constraint)"; decision 2: a whole-branch entry holds every grade.
  it('refuses a second entry of one kind on a date for overlapping grades, naming the field', async () => {
    const { branch, short } = await branchWith();
    await create(branch, record({ name: 'Seniors off', gradeFrom: 9, gradeTo: 11 }));
    const overlap = await t.post(
      '/api/setup/calendar-entries',
      branch,
      record({ firstDate: TUESDAY, lastDate: THURSDAY }),
    );
    expect(overlap.status).toBe(409);
    expect(errorCode(overlap)).toBe('calendar_overlap');
    expect(detailPaths(overlap)).toEqual(['firstDate', 'lastDate']);
    await create(branch, record({ name: 'Juniors off', gradeFrom: 1, gradeTo: 8 }));

    await create(branch, special(short, { firstDate: THURSDAY }));
    const grades = await t.post(
      '/api/setup/calendar-entries',
      branch,
      special(short, { firstDate: THURSDAY, gradeFrom: 1, gradeTo: 4 }),
    );
    expect(errorCode(grades)).toBe('calendar_overlap');
    // A day off beats a special day: both may be entered for one date.
    await create(branch, record({ firstDate: THURSDAY }));
  });

  it('answers the overlap of two creates at one moment once, from the database', async () => {
    const { branch } = await branchWith();
    const [first, second] = await Promise.all([
      t.post('/api/setup/calendar-entries', branch, record({ firstDate: '2026-11-10' })),
      t.post('/api/setup/calendar-entries', branch, record({ firstDate: '2026-11-10' })),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(errorCode(first.status === 409 ? first : second)).toBe('calendar_overlap');
    expect((await rowsOf(branch)).entries).toHaveLength(1);
  });

  // Answer 15: "A special day names a template and, on a non-working weekday,
  // the weekday it follows"; decision 8 and correction 1 of the review.
  it('asks a special day on a non-working weekday for a working weekday it follows', async () => {
    const { branch, short } = await branchWith();
    const without = await t.post(
      '/api/setup/calendar-entries',
      branch,
      special(short, { firstDate: SATURDAY }),
    );
    expect(errorCode(without)).toBe('follows_weekday_required');
    expect(detailPaths(without)).toEqual(['followsWeekday']);
    const sunday = await t.post(
      '/api/setup/calendar-entries',
      branch,
      special(short, { firstDate: SATURDAY, followsWeekday: 7 }),
    );
    expect(errorCode(sunday)).toBe('follows_weekday_not_working');
    const saturday = await create(
      branch,
      special(short, { name: 'Working Saturday', firstDate: SATURDAY, followsWeekday: 1 }),
    );
    expect(saturday).toMatchObject({ dayTemplateId: short, dayTemplateName: 'Short' });
    // A week of exams from Monday to Saturday follows Monday on Saturday only.
    await create(
      branch,
      special(short, {
        name: 'Exams',
        firstDate: '2026-10-19',
        lastDate: '2026-10-24',
        followsWeekday: 1,
        examWeek: 'regular_lessons',
      }),
    );
    const tuesday = calendarDateSchema.parse(
      (await t.get('/api/setup/calendar-day?date=2026-10-20', branch)).body,
    );
    expect(tuesday.grades[0]?.day).toMatchObject({ lessons: true, followsWeekday: 2 });
    const exams = calendarDateSchema.parse(
      (await t.get('/api/setup/calendar-day?date=2026-10-24', branch)).body,
    );
    expect(exams.grades[0]?.day).toMatchObject({
      lessons: true,
      dayTemplateName: 'Short',
      followsWeekday: 1,
      examWeek: 'regular_lessons',
      entryName: 'Exams',
    });
  });

  // Done when: a holiday inside a week, a working Saturday and a grade-range entry.
  it('tells what every grade has on a date', async () => {
    const { branch, short } = await branchWith();
    await create(branch, record({ name: 'Holiday', firstDate: WEDNESDAY }));
    await create(
      branch,
      record({ name: 'Seniors off', firstDate: THURSDAY, gradeFrom: 9, gradeTo: 11 }),
    );
    await create(
      branch,
      special(short, { name: 'Working Saturday', firstDate: SATURDAY, followsWeekday: 1 }),
    );
    const dayOf = async (date: string) =>
      calendarDateSchema.parse((await t.get(`/api/setup/calendar-day?date=${date}`, branch)).body);

    const holiday = await dayOf(WEDNESDAY);
    expect(holiday.grades).toHaveLength(11);
    expect(new Set(holiday.grades.map((one) => JSON.stringify(one.day)))).toEqual(
      new Set([
        JSON.stringify({
          lessons: false,
          reason: 'day_off',
          entryId: holiday.grades[0]?.day.entryId,
          entryName: 'Holiday',
        }),
      ]),
    );
    expect((await dayOf(TUESDAY)).grades[4]?.day).toMatchObject({
      lessons: true,
      dayTemplateName: 'Main',
      followsWeekday: 2,
      entryId: null,
    });
    const thursday = await dayOf(THURSDAY);
    expect(thursday.grades[7]?.day).toMatchObject({ lessons: true, dayTemplateName: 'Main' });
    expect(thursday.grades[8]?.day).toMatchObject({ lessons: false, entryName: 'Seniors off' });
    expect((await dayOf(SATURDAY)).grades[0]?.day).toMatchObject({
      lessons: true,
      dayTemplateName: 'Short',
      followsWeekday: 1,
    });
    expect((await dayOf(SUNDAY)).grades[0]?.day).toEqual({
      lessons: false,
      reason: 'not_working_day',
      entryId: null,
      entryName: null,
    });
    expect((await t.get('/api/setup/calendar-day?date=2026-02-30', branch)).status).toBe(400);
  });

  describe('edits', () => {
    // Decision 3: no date of today or earlier changes; the name while the
    // last date is today or later; an entry wholly in the past is read-only.
    it('let a started entry change its name and its future dates only', async () => {
      const { branch, short } = await branchWith();
      const id = await insertEntry(branch, {
        kind: 'special_day',
        name: 'Exams',
        firstDate: '2026-10-08',
        lastDate: '2026-10-16',
        dayTemplateId: short,
        followsWeekday: 1,
      });
      const started = record({
        kind: 'special_day',
        name: 'Exams',
        firstDate: '2026-10-08',
        lastDate: '2026-10-16',
        dayTemplateId: short,
        followsWeekday: 1,
      });
      const edit = (body: object) => t.patch(`/api/setup/calendar-entries/${id}`, branch, body);

      const renamed = await edit({ ...started, name: 'Quarter exams' });
      expect(renamed.status).toBe(200);
      expect(await t.entries('calendar_entry.edit', id)).toEqual([
        expect.objectContaining({
          old_value: { name: 'Exams' },
          new_value: { name: 'Quarter exams' },
        }),
      ]);
      const now = { ...started, name: 'Quarter exams' };

      for (const [body, path] of [
        [{ ...now, gradeFrom: 9, gradeTo: 11 }, 'gradeFrom'],
        [{ ...now, examWeek: 'no_regular_lessons' }, 'examWeek'],
        [{ ...now, firstDate: '2026-10-09' }, 'firstDate'],
        [{ ...now, lastDate: '2026-10-09' }, 'lastDate'],
      ] as const) {
        const response = await edit(body);
        expect(response.status, path).toBe(409);
        expect(errorCode(response)).toBe('calendar_date_not_in_future');
        expect(detailPaths(response)).toContain(path);
      }
      expect((await edit({ ...now, lastDate: TODAY })).status).toBe(200);
      expect((await edit({ ...now, lastDate: '2026-10-14' })).status).toBe(200);

      const archive = await t.post(`/api/setup/calendar-entries/${id}/archive`, branch);
      expect(errorCode(archive)).toBe('calendar_date_not_in_future');

      const kind = await edit({ ...now, kind: 'day_off', dayTemplateId: null, followsWeekday: null });
      expect(kind.status).toBe(400);
      expect(detailPaths(kind)).toEqual(['kind']);
    });

    it('leave an entry wholly in the past as it is', async () => {
      const { branch } = await branchWith();
      const id = await insertEntry(branch, {
        name: 'Past',
        firstDate: '2026-10-01',
        lastDate: '2026-10-02',
      });
      const rows = await rowsOf(branch);
      const rename = await t.patch(
        `/api/setup/calendar-entries/${id}`,
        branch,
        record({ name: 'Renamed', firstDate: '2026-10-01', lastDate: '2026-10-02' }),
      );
      expect(rename.status).toBe(409);
      expect(errorCode(rename)).toBe('calendar_entry_past');
      const archive = await t.post(`/api/setup/calendar-entries/${id}/archive`, branch);
      expect(errorCode(archive)).toBe('calendar_entry_past');
      expect(await rowsOf(branch)).toEqual(rows);
    });

    it('move a future entry, and refuse an archived one until it is restored', async () => {
      const { branch } = await branchWith();
      const entry = await create(branch, record({ firstDate: '2026-11-02' }));
      const moved = await t.patch(
        `/api/setup/calendar-entries/${entry.id}`,
        branch,
        record({ firstDate: '2026-11-03', lastDate: '2026-11-05', gradeFrom: 5, gradeTo: 6 }),
      );
      expect(moved.status).toBe(200);
      expect(calendarEntrySchema.parse(moved.body)).toMatchObject({
        firstDate: '2026-11-03',
        lastDate: '2026-11-05',
        gradeFrom: 5,
      });

      const archived = await t.post(`/api/setup/calendar-entries/${entry.id}/archive`, branch);
      expect(archived.status).toBe(200);
      expect(calendarEntrySchema.parse(archived.body).archivedAt).not.toBeNull();
      expect(await t.entries('calendar_entry.archive', entry.id)).toHaveLength(1);
      const edit = await t.patch(
        `/api/setup/calendar-entries/${entry.id}`,
        branch,
        record({ name: 'Again', firstDate: '2026-11-03' }),
      );
      expect(errorCode(edit)).toBe('calendar_entry_archived');
      const again = await t.post(`/api/setup/calendar-entries/${entry.id}/archive`, branch);
      expect(errorCode(again)).toBe('calendar_entry_archived');

      // Restored under the rules of a new entry: here into an overlap.
      await create(branch, record({ firstDate: '2026-11-04' }));
      const restore = await t.post(`/api/setup/calendar-entries/${entry.id}/restore`, branch);
      expect(errorCode(restore)).toBe('calendar_overlap');
    });

    it('restore an entry, but not onto an archived template', async () => {
      const { branch, short } = await branchWith();
      const entry = await create(branch, special(short, { firstDate: '2026-11-02' }));
      expect((await t.post(`/api/setup/calendar-entries/${entry.id}/archive`, branch)).status).toBe(
        200,
      );
      expect((await t.post(`/api/setup/day-templates/${short}/archive`, branch)).status).toBe(200);
      const refused = await t.post(`/api/setup/calendar-entries/${entry.id}/restore`, branch);
      expect(errorCode(refused)).toBe('template_archived');
      expect((await t.post(`/api/setup/day-templates/${short}/restore`, branch)).status).toBe(200);
      const restored = await t.post(`/api/setup/calendar-entries/${entry.id}/restore`, branch);
      expect(restored.status).toBe(200);
      expect(calendarEntrySchema.parse(restored.body).archivedAt).toBeNull();
      expect(await t.entries('calendar_entry.restore', entry.id)).toHaveLength(1);
    });
  });

  // .claude/rules/api.md: an id of another branch or an unknown one, in the
  // path or in the body, is 404 and changes nothing in either branch.
  it('answers 404 for an entry or a template of another branch, or an unknown one', async () => {
    const north = await branchWith();
    const south = await branchWith();
    await create(north.branch, record({ firstDate: '2026-11-02' }));
    const southEntry = await create(south.branch, record({ firstDate: '2026-11-02' }));
    const rows = [await rowsOf(north.branch), await rowsOf(south.branch)];
    const before = await t.auditCount();

    for (const id of [southEntry.id, UNKNOWN]) {
      const attempts = [
        () =>
          t.patch(
            `/api/setup/calendar-entries/${id}`,
            north.branch,
            record({ firstDate: '2026-11-05' }),
          ),
        () => t.post(`/api/setup/calendar-entries/${id}/archive`, north.branch),
        () => t.post(`/api/setup/calendar-entries/${id}/restore`, north.branch),
        () =>
          t.post('/api/setup/calendar-entries/preview', north.branch, { action: 'archive', id }),
        () =>
          t.post('/api/setup/calendar-entries/preview', north.branch, { action: 'restore', id }),
        () =>
          t.post('/api/setup/calendar-entries/preview', north.branch, {
            action: 'edit',
            id,
            record: record({ firstDate: '2026-11-05' }),
          }),
      ];
      for (const attempt of attempts) {
        expect((await attempt()).status).toBe(404);
      }
    }
    for (const template of [south.short, UNKNOWN]) {
      const body = special(template, { firstDate: '2026-11-09' });
      for (const attempt of [
        () => t.post('/api/setup/calendar-entries', north.branch, body),
        () =>
          t.post('/api/setup/calendar-entries/preview', north.branch, {
            action: 'create',
            record: body,
          }),
      ]) {
        expect((await attempt()).status).toBe(404);
      }
    }
    const special404 = await create(
      north.branch,
      special(north.short, { firstDate: '2026-11-16' }),
    );
    for (const template of [south.short, UNKNOWN]) {
      const response = await t.patch(
        `/api/setup/calendar-entries/${special404.id}`,
        north.branch,
        special(template, { firstDate: '2026-11-16' }),
      );
      expect(response.status).toBe(404);
    }
    const after = await rowsOf(north.branch);
    expect(after.entries.filter((row) => row.id !== special404.id)).toEqual(rows[0]?.entries);
    expect(await rowsOf(south.branch)).toEqual(rows[1]);
    expect(await t.auditCount()).toBe(before + 1);
  });

  // Decision 11: the preview is the save, rolled back.
  it('previews a save as runs of dates and grades, writing nothing', async () => {
    const { branch } = await branchWith();
    const existing = await create(branch, record({ name: 'Holiday', firstDate: '2026-11-02' }));
    const rows = await rowsOf(branch);
    const before = await t.auditCount();

    const created = await t.post('/api/setup/calendar-entries/preview', branch, {
      action: 'create',
      record: record({
        name: 'Seniors off',
        firstDate: '2026-11-03',
        lastDate: '2026-11-04',
        gradeFrom: 9,
        gradeTo: 11,
      }),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    // One run per date: the day before names the weekday it follows, which
    // differs from Tuesday to Wednesday.
    const change = (date: string, weekday: number) => ({
      firstDate: date,
      lastDate: date,
      gradeFrom: 9,
      gradeTo: 11,
      before: expect.objectContaining({
        lessons: true,
        dayTemplateName: 'Main',
        followsWeekday: weekday,
      }) as unknown,
      after: expect.objectContaining({
        lessons: false,
        reason: 'day_off',
        entryName: 'Seniors off',
      }) as unknown,
    });
    expect(calendarPreviewSchema.parse(created.body).changes).toEqual([
      change('2026-11-03', 2),
      change('2026-11-04', 3),
    ]);

    const archive = await t.post('/api/setup/calendar-entries/preview', branch, {
      action: 'archive',
      id: existing.id,
    });
    expect(calendarPreviewSchema.parse(archive.body).changes).toEqual([
      expect.objectContaining({ firstDate: '2026-11-02', gradeFrom: 1, gradeTo: 11 }),
    ]);

    const refused = await t.post('/api/setup/calendar-entries/preview', branch, {
      action: 'create',
      record: record({ firstDate: TODAY }),
    });
    expect(errorCode(refused)).toBe('calendar_date_not_in_future');

    expect(await rowsOf(branch)).toEqual(rows);
    expect(await t.auditCount()).toBe(before);
  });

  // edge/academic-year: "Go-live can be on any school day"; decision 7.
  describe('keep the go-live date a school day', () => {
    it('refusing a go-live date without lessons for any grade', async () => {
      const { branch, short } = await branchWith();
      const goLive = (goLiveDate: string) =>
        put('/api/setup/branch/go-live', branch, { goLiveDate });
      await create(branch, record({ name: 'Holiday', firstDate: WEDNESDAY }));
      await create(
        branch,
        record({ name: 'Seniors', firstDate: THURSDAY, gradeFrom: 9, gradeTo: 11 }),
      );
      for (const date of [WEDNESDAY, SUNDAY]) {
        const response = await goLive(date);
        expect(response.status, date).toBe(409);
        expect(errorCode(response)).toBe('go_live_not_school_day');
        expect(detailPaths(response)).toEqual(['goLiveDate']);
      }
      expect((await goLive(THURSDAY)).status).toBe(200);
      await create(
        branch,
        special(short, { name: 'Working Saturday', firstDate: SATURDAY, followsWeekday: 1 }),
      );
      expect((await goLive(SATURDAY)).status).toBe(200);
    });

    it('refusing a calendar save or a weekday change that takes the school day away', async () => {
      const { branch, short } = await branchWith();
      const saturday = await create(
        branch,
        special(short, { name: 'Working Saturday', firstDate: SATURDAY, followsWeekday: 1 }),
      );
      expect(
        (await put('/api/setup/branch/go-live', branch, { goLiveDate: SATURDAY })).status,
      ).toBe(200);
      const archive = await t.post(`/api/setup/calendar-entries/${saturday.id}/archive`, branch);
      expect(errorCode(archive)).toBe('go_live_not_school_day');

      expect(
        (await put('/api/setup/branch/go-live', branch, { goLiveDate: WEDNESDAY })).status,
      ).toBe(200);
      const rows = await rowsOf(branch);
      const off = await t.post(
        '/api/setup/calendar-entries',
        branch,
        record({ firstDate: WEDNESDAY }),
      );
      expect(errorCode(off)).toBe('go_live_not_school_day');
      await create(branch, record({ firstDate: WEDNESDAY, gradeFrom: 1, gradeTo: 4 }));

      const current = branchSchema.parse((await t.get('/api/setup/branch', branch)).body);
      const weekdays = await put('/api/setup/branch', branch, {
        name: current.name,
        address: current.address,
        phone: current.phone,
        email: current.email,
        workingWeekdays: [1, 2, 4, 5],
      });
      expect(weekdays.status).toBe(409);
      expect(errorCode(weekdays)).toBe('go_live_not_school_day');
      expect(detailPaths(weekdays)).toEqual(['workingWeekdays']);
      expect((await rowsOf(branch)).branch).toEqual(rows.branch);
    });
  });

  // From 1.5 (pull request #46): a template named by a special day from today
  // on counts as in use for its archive.
  it('keeps a template named by a special day from today on in use', async () => {
    const { branch, short } = await branchWith();
    const pastTemplate = await t.createTemplate(
      branch,
      'Past',
      (
        await t.database.migrator
          .selectFrom('slot_types')
          .select('id')
          .where('branch_id', '=', branch)
          .execute()
      ).map((row) => row.id),
    );
    await insertEntry(branch, {
      kind: 'special_day',
      name: 'Past special',
      firstDate: '2026-10-05',
      lastDate: '2026-10-06',
      dayTemplateId: pastTemplate,
    });
    await create(branch, special(short, { firstDate: '2026-11-02' }));
    const list = dayTemplateListSchema.parse(
      (await t.get('/api/setup/day-templates', branch)).body,
    );
    expect(list.dayTemplates.find((one) => one.id === short)?.inUse).toBe(true);
    expect(list.dayTemplates.find((one) => one.id === pastTemplate)?.inUse).toBe(false);
    const refused = await t.post(`/api/setup/day-templates/${short}/archive`, branch);
    expect(errorCode(refused)).toBe('template_in_use');
    expect((await t.post(`/api/setup/day-templates/${pastTemplate}/archive`, branch)).status).toBe(
      200,
    );
  });

  // edge/00-definitions, Branch time: tomorrow is decided by the date in
  // Tashkent, not in UTC. Last: it moves the clock.
  it('decides tomorrow by the date in branch time', async () => {
    const { branch } = await branchWith();
    // 00:01 on 11 October in Tashkent, still 10 October in UTC.
    t.clock.set(new Date(new Date(START).getTime() + 6 * 60 * 1000));
    const today = await t.post(
      '/api/setup/calendar-entries',
      branch,
      record({ firstDate: TOMORROW }),
    );
    expect(errorCode(today)).toBe('calendar_date_not_in_future');
    await create(branch, record({ firstDate: '2026-10-12' }));
  });
});
