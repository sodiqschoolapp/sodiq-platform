import {
  apiErrorSchema,
  BRANCH_HEADER,
  setupChecklistSchema,
  subjectListSchema,
  subjectQuarterWeightsSchema,
  subjectSchema,
  type Subject,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { closeQuarter } from '../../testing/closing-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// Five minutes on: the Super Admin's idle limit is 15.
const LATER = '2026-10-10T23:59:00+05:00';

// The start date a department move carries (task 3.4c, decision 2): after today, inside the year.
const MOVE_ON = '2026-11-02';

const DAILY = { attendance: 10, classwork: 50, homework: 40 };
const RATED = { attendance: 10, classwork: 30, homework: 20, ratingExam: 40 };
const UNRATED = { attendance: 10, classwork: 50, homework: 40, ratingExam: null };

const DATED = [
  ['2026-09-02', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-19'],
  ['2027-03-29', '2027-05-25'],
] as const;

/** The fields a refused body names. */
const detailPaths = (response: Response): string[] =>
  apiErrorSchema.parse(response.body).error.details?.map((detail) => detail.path) ?? [];

// All names are invented. docs/spec/05-classes-groups-subjects.md, Subject and
// "Grading weights on a subject"; the owner's answers 3 to 8 (docs/decisions.md,
// "Decided ahead for tasks 2.1 to 2.6"); the plan approved on pull request #52.
describe('subjects', () => {
  let t: DayTemplatesKit;
  let steam: string;
  let tutors: string;
  let medical: string;
  let subjectCount = 0;

  beforeAll(async () => {
    t = await dayTemplatesKit();
    const departmentId = async (en: string) =>
      (
        await t.database.migrator
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', en)
          .executeTakeFirstOrThrow()
      ).id;
    steam = await departmentId('STEAM');
    tutors = await departmentId('Tutors');
    medical = await departmentId('Medical');
  });

  afterAll(async () => {
    await t.close();
  });

  const put = (path: string, branch: string, body: object, cookie = t.admin) =>
    request(t.kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  /** A new graded subject body with a name of its own; `en` is what the tests call it. */
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    subjectCount += 1;
    const en = `Subject ${String(subjectCount)}`;
    return {
      names: { uz: `Fan ${String(subjectCount)}`, ru: `Предмет ${String(subjectCount)}`, en },
      departmentId: steam,
      grades: [5, 6, 7],
      colour: 'blue',
      journalType: 'graded',
      ratingExam: true,
      groupSubject: false,
      languageRule: true,
      demanding: false,
      ...overrides,
    };
  }

  /** What an edit sends: the fields of the answer, without the branch's weights. */
  // Task 8.2 (decision 16): a change of the switches names the quarter it takes effect
  // from; quarter 1 unless the test names another, so it reaches every quarter of the year.
  const editBody = (subject: Subject, overrides: Record<string, unknown> = {}) => {
    const switches =
      ('journalType' in overrides && overrides.journalType !== subject.journalType) ||
      ('ratingExam' in overrides && overrides.ratingExam !== subject.ratingExam);
    return {
      names: subject.names,
      departmentId: subject.departmentId,
      grades: subject.grades,
      colour: subject.colour,
      journalType: subject.journalType,
      ratingExam: subject.ratingExam,
      groupSubject: subject.groupSubject,
      languageRule: subject.languageRule,
      demanding: subject.demanding,
      ...(switches ? { switchesFrom: 1 } : {}),
      ...overrides,
    };
  };

  async function create(
    overrides: Record<string, unknown> = {},
    branch = t.north,
    cookie = t.admin,
  ): Promise<Subject> {
    const response = await t.post('/api/setup/subjects', branch, body(overrides), cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return subjectSchema.parse(response.body);
  }

  const list = async (branch = t.north, cookie = t.admin) => {
    const response = await t.get('/api/setup/subjects', branch, cookie);
    expect(response.status).toBe(200);
    return subjectListSchema.parse(response.body).subjects;
  };

  const inList = async (id: string, branch = t.north) => {
    const found = (await list(branch)).find((subject) => subject.id === id);
    if (found === undefined) {
      throw new Error('The list does not hold the subject.');
    }
    return found;
  };

  const schoolEntries = (action: string, recordId?: string) => {
    let query = t.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .orderBy('occurred_at')
      .orderBy('id');
    if (recordId !== undefined) {
      query = query.where('record_id', '=', recordId);
    }
    return query.execute();
  };

  const auditCount = async () =>
    Number(
      (
        await sql<{ n: string }>`
          select (select count(*) from audit_log) + (select count(*) from audit_log_school) as n
        `.execute(t.database.migrator)
      ).rows[0]?.n,
    );

  /** The stored daily distributions of a subject (task 11.17: kept untouched and unread). */
  const dailyRows = (subjectId: string) =>
    t.database.migrator
      .selectFrom('subject_daily_weights')
      .selectAll()
      .where('subject_id', '=', subjectId)
      .orderBy('branch_id')
      .execute();

  /** A daily distribution stored before task 11.17, written as the old route wrote it. */
  const storeOldDaily = (subjectId: string, branchId: string) =>
    t.database.migrator
      .insertInto('subject_daily_weights')
      .values({ branch_id: branchId, subject_id: subjectId, ...DAILY })
      .execute();

  /** Every row of the three tables of subjects: what a refused change leaves as it was. */
  const rows = async () => ({
    subjects: await t.database.migrator.selectFrom('subjects').selectAll().orderBy('id').execute(),
    daily: await t.database.migrator
      .selectFrom('subject_daily_weights')
      .selectAll()
      .orderBy('branch_id')
      .orderBy('subject_id')
      .execute(),
    quarters: await t.database.migrator
      .selectFrom('subject_quarter_weights')
      .selectAll()
      .orderBy('branch_id')
      .orderBy('subject_id')
      .orderBy('quarter_id')
      .execute(),
  });

  /** A year of four quarters, written by the migrator; planned, current or closed. */
  async function insertYear(
    branch: string,
    startDate: string,
    status: 'planned' | 'current' | 'closed' = 'planned',
    quarterDates: readonly (readonly [string, string] | null)[] = DATED,
  ): Promise<{ yearId: string; quarterIds: string[] }> {
    const startYear = Number(startDate.slice(0, 4));
    const endDate = `${String(startYear + 1)}-06-30`;
    const shift = (date: string) =>
      `${String(Number(date.slice(0, 4)) + startYear - 2026)}${date.slice(4)}`;
    return t.database.migrator.transaction().execute(async (transaction) => {
      const year = await transaction
        .insertInto('academic_years')
        .values({ branch_id: branch, start_date: startDate, end_date: endDate })
        .returning('id')
        .executeTakeFirstOrThrow();
      const quarterIds: string[] = [];
      for (const [index, dates] of quarterDates.entries()) {
        const quarter = await transaction
          .insertInto('quarters')
          .values({
            branch_id: branch,
            academic_year_id: year.id,
            number: index + 1,
            start_date: dates === null ? null : shift(dates[0]),
            end_date: dates === null ? null : shift(dates[1]),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        quarterIds.push(quarter.id);
      }
      for (const next of ['current', 'closed'] as const) {
        if (status === 'planned' || (status === 'current' && next === 'closed')) {
          break;
        }
        await transaction
          .updateTable('academic_years')
          .set({ status: next })
          .where('id', '=', year.id)
          .execute();
      }
      return { yearId: year.id, quarterIds };
    });
  }

  describe('a new subject', () => {
    it('is created by the Super Admin: one school-wide entry naming the assignment and the request, and no daily distribution (task 11.17)', async () => {
      const sent = body({ grades: [1, 11], colour: 'teal', demanding: true });
      const response = await t.post('/api/setup/subjects', t.north, sent);

      expect(response.status).toBe(201);
      const subject = subjectSchema.parse(response.body);
      expect(subject).toMatchObject({
        names: sent.names,
        departmentId: steam,
        grades: [1, 11],
        colour: 'teal',
        journalType: 'graded',
        ratingExam: true,
        groupSubject: false,
        languageRule: true,
        demanding: true,
        archivedAt: null,
        quarterWeightsMissing: null,
        quarterCount: null,
      });
      // The answer as it came: no daily distribution (the schema would strip one).
      expect(response.body).not.toHaveProperty('daily');
      const requestId = response.headers['x-request-id'];
      const created = await schoolEntries('subject.create', subject.id);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        assignment_id: t.adminAssignment,
        request_id: requestId,
        record_type: 'subject',
      });
      expect(created[0]?.new_value).toMatchObject({ names: sent.names, grades: [1, 11] });
      expect(await t.entries('subject_daily_weights.set', subject.id)).toEqual([]);
      expect(await dailyRows(subject.id)).toEqual([]);
    });

    it('is created by the Academic Vice Principal of the branch', async () => {
      const response = await t.post('/api/setup/subjects', t.north, body(), t.vicePrincipal);

      expect(response.status).toBe(201);
      const subject = subjectSchema.parse(response.body);
      expect((await schoolEntries('subject.create', subject.id))[0]?.assignment_id).toBe(
        t.viceAssignment,
      );
    });

    // Task 9.4d: a subject is taught in grades 0 to 11 (05, Class: "Grade (0–11)").
    it('is created with grades 0 to 4 and refused with grade -1 or 12; nothing is written', async () => {
      const response = await t.post(
        '/api/setup/subjects',
        t.north,
        body({ grades: [0, 1, 2, 3, 4] }),
      );
      expect(response.status).toBe(201);
      expect(subjectSchema.parse(response.body).grades).toEqual([0, 1, 2, 3, 4]);
      const before = await rows();
      const audit = await auditCount();
      for (const grades of [
        [-1, 0],
        [0, 12],
      ]) {
        const wrong = await t.post('/api/setup/subjects', t.north, body({ grades }));
        expect(wrong.status).toBe(400);
        expect(errorCode(wrong)).toBe('validation_failed');
      }
      expect(await rows()).toEqual(before);
      expect(await auditCount()).toBe(audit);
    });

    // Task 11.17 (`07`, Calculation rules, rule 3: there is no lesson score): a graded subject
    // saves with no daily distribution; one still sent is dropped (plan decision 4) and nothing
    // is written to the daily distributions.
    it('saves a graded subject with no daily distribution and drops one sent', async () => {
      const response = await t.post('/api/setup/subjects', t.north, body({ daily: DAILY }));
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body).not.toHaveProperty('daily');
      const subject = subjectSchema.parse(response.body);
      expect(await dailyRows(subject.id)).toEqual([]);
      expect(await t.entries('subject_daily_weights.set', subject.id)).toEqual([]);
    });

    // `edge/calculation`: attendance-only subjects have no weights, no result.
    it('that is attendance only takes no rating exam', async () => {
      const subject = await create({
        journalType: 'attendance_only',
        ratingExam: false,
        departmentId: tutors,
      });
      expect(subject.quarterWeightsMissing).toBeNull();

      const rating = await t.post(
        '/api/setup/subjects',
        t.north,
        body({ journalType: 'attendance_only' }),
      );
      expect(detailPaths(rating)).toEqual(['ratingExam']);
    });

    it('is refused with already_exists, naming the language, when an active subject has that name in any case; nothing is written', async () => {
      const first = await create();
      const before = await rows();

      const response = await t.post(
        '/api/setup/subjects',
        t.north,
        body({ names: { uz: 'Boshqa', ru: first.names.ru.toUpperCase(), en: 'Other' } }),
      );

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('already_exists');
      expect(detailPaths(response)).toEqual(['names.ru']);
      expect(await rows()).toEqual(before);
    });

    it('is refused in an unknown department (404), one outside Academic and an archived one; nothing is written', async () => {
      const archived = await t.database.migrator
        .insertInto('departments')
        .values({
          division_id: (
            await t.database.migrator
              .selectFrom('divisions')
              .select('id')
              .where('built_in', '=', true)
              .executeTakeFirstOrThrow()
          ).id,
          name_uz: 'Eski',
          name_ru: 'Старый',
          name_en: 'Old',
          position: 99,
          archived_at: new Date(START),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const before = await rows();
      const audit = await auditCount();

      const unknown = await t.post('/api/setup/subjects', t.north, body({ departmentId: UNKNOWN }));
      expect(unknown.status).toBe(404);
      const outside = await t.post('/api/setup/subjects', t.north, body({ departmentId: medical }));
      expect(outside.status).toBe(409);
      expect(errorCode(outside)).toBe('department_not_academic');
      const old = await t.post('/api/setup/subjects', t.north, body({ departmentId: archived.id }));
      expect(old.status).toBe(409);
      expect(errorCode(old)).toBe('department_archived');

      expect(await rows()).toEqual(before);
      expect(await auditCount()).toBe(audit);
    });
  });

  describe('the list', () => {
    it('counts the quarters of the planned and current years without a fitting quarterly distribution', async () => {
      const branch = await t.newBranch();
      await insertYear(branch, '2025-09-01', 'closed');
      const { quarterIds } = await insertYear(branch, '2026-09-01', 'current');
      const subject = await create({}, branch);
      expect((await inList(subject.id, branch)).quarterWeightsMissing).toBe(4);

      const quarter = quarterIds[0] ?? '';
      const set = await put(
        `/api/setup/subjects/${subject.id}/quarter-weights/${quarter}`,
        branch,
        RATED,
      );
      expect(set.status).toBe(200);
      expect(await inList(subject.id, branch)).toMatchObject({
        quarterWeightsMissing: 3,
        quarterCount: 4,
      });
    });

    it('is read by the Principal and the Academic Vice Principal, not by a Teacher', async () => {
      expect((await t.get('/api/setup/subjects', t.north, t.principal)).status).toBe(200);
      expect((await t.get('/api/setup/subjects', t.north, t.vicePrincipal)).status).toBe(200);
      expect(errorCode(await t.get('/api/setup/subjects', t.north, t.teacher))).toBe(
        'permission_denied',
      );
    });
  });

  describe('an edit', () => {
    it('changes the school-wide fields with the old and new values in the audit entry; the same body writes nothing', async () => {
      const subject = await create();
      const renamed = { ...subject.names, en: `${subject.names.en} renamed` };

      const response = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, { names: renamed, grades: [5, 6], groupSubject: true }),
      );

      expect(response.status).toBe(200);
      expect(subjectSchema.parse(response.body)).toMatchObject({
        names: renamed,
        grades: [5, 6],
        groupSubject: true,
      });
      const edits = await schoolEntries('subject.edit', subject.id);
      expect(edits).toHaveLength(1);
      expect(edits[0]).toMatchObject({
        assignment_id: t.adminAssignment,
        request_id: response.headers['x-request-id'],
        old_value: { names: subject.names, grades: [5, 6, 7], groupSubject: false },
        new_value: { names: renamed, grades: [5, 6], groupSubject: true },
      });

      const again = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, { names: renamed, grades: [5, 6], groupSubject: true }),
      );
      expect(again.status).toBe(200);
      expect(await schoolEntries('subject.edit', subject.id)).toHaveLength(1);
    });

    // Task 11.17: an edit asks for no daily distribution in any branch, drops one sent, and
    // leaves the daily distributions stored before untouched.
    it('edits a graded subject in any branch with no daily distribution and leaves the stored ones untouched', async () => {
      const subject = await create();
      await storeOldDaily(subject.id, t.north);
      const stored = await dailyRows(subject.id);
      expect(stored).toHaveLength(1);

      const renamed = { ...subject.names, en: `${subject.names.en} again` };
      for (const branch of [t.south, t.north]) {
        const response = await put(
          `/api/setup/subjects/${subject.id}`,
          branch,
          editBody(subject, {
            names: renamed,
            daily: { attendance: 20, classwork: 40, homework: 40 },
          }),
        );
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).not.toHaveProperty('daily');
      }
      expect(await dailyRows(subject.id)).toEqual(stored);
      expect(await t.entries('subject_daily_weights.set', subject.id)).toEqual([]);
    });

    // Decision 14: the journal type stays editable; the weight rows stay.
    it('to attendance only and back to graded keeps the stored weight rows and needs no daily distribution', async () => {
      const subject = await create();
      await storeOldDaily(subject.id, t.north);
      await storeOldDaily(subject.id, t.south);
      const stored = await dailyRows(subject.id);

      const off = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, { journalType: 'attendance_only', ratingExam: false }),
      );
      expect(off.status).toBe(200);
      expect(subjectSchema.parse(off.body)).toMatchObject({
        journalType: 'attendance_only',
        quarterWeightsMissing: null,
        quarterCount: null,
      });

      const attendanceOnly = subjectSchema.parse(off.body);
      const on = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(attendanceOnly, { journalType: 'graded' }),
      );
      expect(on.status, JSON.stringify(on.body)).toBe(200);
      expect(subjectSchema.parse(on.body).journalType).toBe('graded');
      expect(await dailyRows(subject.id)).toEqual(stored);
    });

    // `edge/people-roles-accounts`: a subject moved to another department is
    // moved "by the Super Admin" (the permission review; decision 17).
    it('moves a subject to another department for the Super Admin only; the Academic Vice Principal is refused and nothing is written', async () => {
      const subject = await create();
      const before = await rows();
      const audit = await auditCount();

      const refused = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, { departmentId: tutors }),
        t.vicePrincipal,
      );
      expect(refused.status).toBe(403);
      expect(errorCode(refused)).toBe('subject_move_super_admin');
      expect(await rows()).toEqual(before);
      expect(await auditCount()).toBe(audit);

      const kept = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, { groupSubject: true }),
        t.vicePrincipal,
      );
      expect(kept.status).toBe(200);

      const moved = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, {
          departmentId: tutors,
          groupSubject: true,
          departmentStartsOn: MOVE_ON,
        }),
      );
      expect(moved.status).toBe(200);
      // Task 3.6b-3 (L195): the record shows STEAM until the start date.
      expect(subjectSchema.parse(moved.body)).toMatchObject({
        departmentId: steam,
        departmentMove: { departmentId: tutors, startsOn: MOVE_ON },
      });
      expect((await schoolEntries('subject.edit', subject.id)).at(-1)).toMatchObject({
        old_value: { departmentId: steam },
        new_value: { departmentId: tutors },
      });
    });

    // The review of #52, edge cases "Who can act": "The server allows an action
    // if any current assignment permits it ... The audit log records which
    // assignment allowed the action." The Academic Vice Principal assignment is
    // created first, so it is the one the guard names.
    it('moves a subject for an account that holds the Academic Vice Principal before the Super Admin, naming the Super Admin assignment', async () => {
      const both = await t.kit.completeSession('Malika', 'Tursunova');
      const vice = await t.kit.giveRole(both.account.id, {
        role: 'academic_vice_principal',
        branchId: t.north,
      });
      const superAdmin = await t.kit.giveRole(both.account.id, { role: 'super_admin' });
      const subject = await create();

      const listed = await t.get('/api/setup/subjects', t.north, both.cookie);
      expect(subjectListSchema.parse(listed.body).mayMoveDepartment).toBe(true);
      const kept = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, { groupSubject: true }),
        both.cookie,
      );
      expect(kept.status).toBe(200);
      expect((await schoolEntries('subject.edit', subject.id)).at(-1)).toMatchObject({
        assignment_id: vice.id,
      });

      const moved = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, {
          departmentId: tutors,
          groupSubject: true,
          departmentStartsOn: MOVE_ON,
        }),
        both.cookie,
      );

      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      // Task 3.6b-3 (L195): the record shows STEAM until the start date.
      expect(subjectSchema.parse(moved.body)).toMatchObject({
        departmentId: steam,
        departmentMove: { departmentId: tutors, startsOn: MOVE_ON },
      });
      expect((await schoolEntries('subject.edit', subject.id)).at(-1)).toMatchObject({
        actor_id: both.account.id,
        assignment_id: superAdmin.id,
        old_value: { departmentId: steam },
        new_value: { departmentId: tutors },
      });
      const alone = await t.get('/api/setup/subjects', t.north, t.vicePrincipal);
      expect(subjectListSchema.parse(alone.body).mayMoveDepartment).toBe(false);
    });

    it('into an unknown department is not found, outside Academic refused; nothing is written', async () => {
      const subject = await create();
      const before = await rows();
      const audit = await auditCount();

      const unknown = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, { departmentId: UNKNOWN, departmentStartsOn: MOVE_ON }),
      );
      expect(unknown.status).toBe(404);
      const outside = await put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, { departmentId: medical, departmentStartsOn: MOVE_ON }),
      );
      expect(errorCode(outside)).toBe('department_not_academic');

      expect(await rows()).toEqual(before);
      expect(await auditCount()).toBe(audit);
    });

    it('of an unknown subject is not found, of an archived one refused', async () => {
      const subject = await create();
      expect((await put(`/api/setup/subjects/${UNKNOWN}`, t.north, editBody(subject))).status).toBe(
        404,
      );
      await t.post(`/api/setup/subjects/${subject.id}/archive`, t.north);
      const archived = await put(`/api/setup/subjects/${subject.id}`, t.north, editBody(subject));
      expect(archived.status).toBe(409);
      expect(errorCode(archived)).toBe('subject_archived');
    });
  });

  // Task 11.17: the route of the daily distribution is gone; the route lists prove it for every
  // role, this the answer.
  it('has no route for a daily distribution any more', async () => {
    const subject = await create();
    const response = await put(`/api/setup/subjects/${subject.id}/daily-weights`, t.north, DAILY);
    expect(response.status).toBe(404);
    expect(await dailyRows(subject.id)).toEqual([]);
  });

  describe('archive and restore', () => {
    it('archive at the moment of the clock, once only, and restore, each with a school-wide entry', async () => {
      t.clock.set(START);
      const subject = await create();
      t.clock.set(LATER);

      const archived = await t.post(`/api/setup/subjects/${subject.id}/archive`, t.north);
      expect(archived.status).toBe(200);
      expect(subjectSchema.parse(archived.body).archivedAt).toBe(new Date(LATER).toISOString());
      const again = await t.post(`/api/setup/subjects/${subject.id}/archive`, t.north);
      expect(again.status).toBe(200);
      expect(await schoolEntries('subject.archive', subject.id)).toHaveLength(1);

      const restored = await t.post(`/api/setup/subjects/${subject.id}/restore`, t.north);
      expect(restored.status).toBe(200);
      expect(subjectSchema.parse(restored.body).archivedAt).toBeNull();
      expect(await schoolEntries('subject.restore', subject.id)).toHaveLength(1);
      t.clock.set(START);
    });

    it('restore is refused while an active subject has the name, or while the department is archived; nothing is written', async () => {
      const subject = await create();
      await t.post(`/api/setup/subjects/${subject.id}/archive`, t.north);
      const twin = await create({ names: subject.names });
      const before = await rows();

      const taken = await t.post(`/api/setup/subjects/${subject.id}/restore`, t.north);
      expect(taken.status).toBe(409);
      expect(errorCode(taken)).toBe('already_exists');
      expect(await rows()).toEqual(before);

      await t.post(`/api/setup/subjects/${twin.id}/archive`, t.north);
      const department = await t.database.migrator
        .insertInto('departments')
        .values({
          division_id: (
            await t.database.migrator
              .selectFrom('departments')
              .select('division_id')
              .where('id', '=', steam)
              .executeTakeFirstOrThrow()
          ).division_id,
          name_uz: 'Vaqtinchalik',
          name_ru: 'Временный',
          name_en: 'Temporary',
          position: 98,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const moved = await create({ departmentId: department.id });
      await t.post(`/api/setup/subjects/${moved.id}/archive`, t.north);
      await t.database.migrator
        .updateTable('departments')
        .set({ archived_at: new Date(START) })
        .where('id', '=', department.id)
        .execute();

      const closed = await t.post(`/api/setup/subjects/${moved.id}/restore`, t.north);
      expect(closed.status).toBe(409);
      expect(errorCode(closed)).toBe('subject_department_archived');
    });

    // Task 10.3b: every route that names a subject in its path. A subject is
    // a record of the whole school (`03`, answer 3): no other branch has one.
    it('of an unknown subject is not found; nothing is written', async () => {
      const subject = await create();
      const before = await rows();
      const audit = await auditCount();
      expect((await t.post(`/api/setup/subjects/${UNKNOWN}/archive`, t.north)).status).toBe(404);
      expect((await t.post(`/api/setup/subjects/${UNKNOWN}/restore`, t.north)).status).toBe(404);
      expect((await put(`/api/setup/subjects/${UNKNOWN}`, t.north, editBody(subject))).status).toBe(
        404,
      );
      expect(await rows()).toEqual(before);
      expect(await auditCount()).toBe(audit);
    });
  });

  describe('the quarterly distributions', () => {
    it('are four per year, set one quarter at a time with the values before and after in the entry of the branch', async () => {
      const branch = await t.newBranch();
      const { yearId, quarterIds } = await insertYear(branch, '2026-09-01');
      const subject = await create({}, branch);

      const empty = await t.get(
        `/api/setup/subjects/${subject.id}/quarter-weights?yearId=${yearId}`,
        branch,
      );
      expect(empty.status).toBe(200);
      const read = subjectQuarterWeightsSchema.parse(empty.body);
      expect(read.quarters.map((quarter) => [quarter.number, quarter.weights])).toEqual([
        [1, null],
        [2, null],
        [3, null],
        [4, null],
      ]);

      const quarter = quarterIds[1] ?? '';
      const response = await put(
        `/api/setup/subjects/${subject.id}/quarter-weights/${quarter}`,
        branch,
        RATED,
      );
      expect(response.status).toBe(200);
      const answered = subjectQuarterWeightsSchema.parse(response.body);
      expect(answered.quarters[1]).toMatchObject({ weights: RATED, fits: true });
      const changed = { ...RATED, classwork: 40, ratingExam: 30 };
      // Task 9.1 (decision 5): a change of a stored distribution carries its reason.
      await put(`/api/setup/subjects/${subject.id}/quarter-weights/${quarter}`, branch, {
        ...changed,
        reason: 'Agreed by the department',
      });
      const entries = await t.entries('subject_quarter_weights.set', subject.id);
      expect(entries).toHaveLength(2);
      expect(entries[1]).toMatchObject({
        branch_id: branch,
        assignment_id: t.adminAssignment,
        old_value: { weights: RATED },
        new_value: { weights: changed },
        details: { quarterId: quarter, reason: 'Agreed by the department' },
      });
    });

    it('are refused at 99 and 101 with three and with four parts, in the shape that does not fit the rating switch, and for an attendance-only subject; nothing is written', async () => {
      const branch = await t.newBranch();
      const { quarterIds } = await insertYear(branch, '2026-09-01');
      const rated = await create({}, branch);
      const unrated = await create({ ratingExam: false }, branch);
      const attendanceOnly = await create(
        { journalType: 'attendance_only', ratingExam: false },
        branch,
      );
      const quarter = quarterIds[0] ?? '';
      const path = (id: string) => `/api/setup/subjects/${id}/quarter-weights/${quarter}`;
      const before = await rows();
      const audit = await auditCount();

      for (const [id, weights] of [
        [unrated.id, { ...UNRATED, homework: 39 }],
        [unrated.id, { ...UNRATED, homework: 41 }],
        [rated.id, { ...RATED, ratingExam: 39 }],
        [rated.id, { ...RATED, ratingExam: 41 }],
      ] as const) {
        const wrong = await put(path(id), branch, weights);
        expect(wrong.status).toBe(400);
        expect(detailPaths(wrong)).toEqual(['total']);
      }
      const four = await put(path(unrated.id), branch, RATED);
      expect(errorCode(four)).toBe('weights_shape_mismatch');
      const three = await put(path(rated.id), branch, UNRATED);
      expect(errorCode(three)).toBe('weights_shape_mismatch');
      const none = await put(path(attendanceOnly.id), branch, UNRATED);
      expect(errorCode(none)).toBe('attendance_only_no_weights');

      expect(await rows()).toEqual(before);
      expect(await auditCount()).toBe(audit);
    });

    it("of another branch's quarter or year, or an unknown one, are not found; nothing is written", async () => {
      const subject = await create();
      const own = await t.newBranch();
      const other = await t.newBranch();
      await insertYear(own, '2026-09-01');
      const { yearId, quarterIds } = await insertYear(other, '2026-09-01');
      const before = await rows();
      const audit = await auditCount();

      for (const quarter of [quarterIds[0] ?? '', UNKNOWN]) {
        const response = await put(
          `/api/setup/subjects/${subject.id}/quarter-weights/${quarter}`,
          own,
          RATED,
        );
        expect(response.status).toBe(404);
      }
      for (const year of [yearId, UNKNOWN]) {
        expect(
          (await t.get(`/api/setup/subjects/${subject.id}/quarter-weights?yearId=${year}`, own))
            .status,
        ).toBe(404);
        expect(
          (
            await t.post(`/api/setup/subjects/${subject.id}/quarter-weights/copy`, own, {
              yearId: year,
            })
          ).status,
        ).toBe(404);
      }
      expect(
        (await t.get(`/api/setup/subjects/${UNKNOWN}/quarter-weights?yearId=${yearId}`, other))
          .status,
      ).toBe(404);
      expect(await rows()).toEqual(before);
      expect(await auditCount()).toBe(audit);
    });

    // Decision 12: a quarter of a closed year is closed.
    it('of a closed year are refused; nothing is written', async () => {
      const branch = await t.newBranch();
      const { yearId, quarterIds } = await insertYear(branch, '2025-09-01', 'closed');
      const subject = await create({}, branch);
      const before = await rows();

      const response = await put(
        `/api/setup/subjects/${subject.id}/quarter-weights/${quarterIds[0] ?? ''}`,
        branch,
        RATED,
      );
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('year_closed');
      const copy = await t.post(`/api/setup/subjects/${subject.id}/quarter-weights/copy`, branch, {
        yearId,
      });
      expect(errorCode(copy)).toBe('year_closed');
      expect(await rows()).toEqual(before);
    });

    /** The id of an account of the kit, the closer of a quarter closed by a test. */
    const closerId = async () =>
      (
        await t.database.migrator
          .selectFrom('accounts')
          .select('id')
          .orderBy('id')
          .executeTakeFirstOrThrow()
      ).id;

    // Task 9.2b (From 2.1): `05`, "Weights of a quarter can change until the quarter is closed."
    it('of a closed quarter are refused, in the save, the copy and their previews; nothing is written', async () => {
      const branch = await t.newBranch();
      const { yearId, quarterIds } = await insertYear(branch, '2026-09-01', 'current');
      const subject = await create({}, branch);
      const first = quarterIds[0] ?? '';
      const closed = quarterIds[1] ?? '';
      const path = (quarter: string) =>
        `/api/setup/subjects/${subject.id}/quarter-weights/${quarter}`;
      expect((await put(path(first), branch, RATED)).status).toBe(200);
      await closeQuarter(t.database, {
        branchId: branch,
        quarterId: closed,
        accountId: await closerId(),
      });
      const before = await rows();
      const audit = await auditCount();

      const response = await put(path(closed), branch, RATED);
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('quarter_closed');
      const preview = await t.post(`${path(closed)}/preview`, branch, RATED);
      expect(preview.status).toBe(409);
      expect(errorCode(preview)).toBe('quarter_closed');
      const copyPath = `/api/setup/subjects/${subject.id}/quarter-weights/copy`;
      const copy = await t.post(copyPath, branch, { yearId });
      expect(copy.status).toBe(409);
      expect(errorCode(copy)).toBe('quarter_closed');
      const copyPreview = await t.post(`${copyPath}/preview`, branch, { yearId });
      expect(copyPreview.status).toBe(409);
      expect(errorCode(copyPreview)).toBe('quarter_closed');
      expect(await rows()).toEqual(before);
      expect(await auditCount()).toBe(audit);

      // A later open quarter still takes its distribution.
      expect((await put(path(quarterIds[2] ?? ''), branch, RATED)).status).toBe(200);
    });

    it('copy from a closed quarter 1 to the open quarters 2 to 4', async () => {
      const branch = await t.newBranch();
      const { yearId, quarterIds } = await insertYear(branch, '2026-09-01', 'current');
      const subject = await create({}, branch);
      const first = quarterIds[0] ?? '';
      expect(
        (await put(`/api/setup/subjects/${subject.id}/quarter-weights/${first}`, branch, RATED))
          .status,
      ).toBe(200);
      await closeQuarter(t.database, {
        branchId: branch,
        quarterId: first,
        accountId: await closerId(),
      });

      const copy = await t.post(`/api/setup/subjects/${subject.id}/quarter-weights/copy`, branch, {
        yearId,
      });
      expect(copy.status).toBe(200);
      expect(
        subjectQuarterWeightsSchema.parse(copy.body).quarters.map((quarter) => quarter.weights),
      ).toEqual([RATED, RATED, RATED, RATED]);
    });

    // Decision 3: a distribution counts only when its shape fits the switch;
    // decision 19: a change of the switch starts a new rating round, so the
    // old distribution shows as not set.
    it('stop counting when the rating switch is turned off, and count as missing', async () => {
      const branch = await t.newBranch();
      const { yearId, quarterIds } = await insertYear(branch, '2026-09-01');
      const subject = await create({}, branch);
      await put(
        `/api/setup/subjects/${subject.id}/quarter-weights/${quarterIds[0] ?? ''}`,
        branch,
        RATED,
      );
      expect((await inList(subject.id, branch)).quarterWeightsMissing).toBe(3);

      await put(
        `/api/setup/subjects/${subject.id}`,
        branch,
        editBody(subject, { ratingExam: false }),
      );

      expect((await inList(subject.id, branch)).quarterWeightsMissing).toBe(4);
      const read = subjectQuarterWeightsSchema.parse(
        (await t.get(`/api/setup/subjects/${subject.id}/quarter-weights?yearId=${yearId}`, branch))
          .body,
      );
      expect(read.quarters[0]).toMatchObject({ weights: null, fits: false });
    });

    // The review of #52 and decision 19: turning the switch off and on again
    // brings no quarterly distribution of before back into force.
    it('count no distribution of before when the rating switch is turned off and on again', async () => {
      const branch = await t.newBranch();
      const { yearId, quarterIds } = await insertYear(branch, '2026-09-01');
      const subject = await create({}, branch);
      const path = (index: number) =>
        `/api/setup/subjects/${subject.id}/quarter-weights/${quarterIds[index] ?? ''}`;
      expect((await put(path(1), branch, RATED)).status).toBe(200);
      const off = subjectSchema.parse(
        (
          await put(
            `/api/setup/subjects/${subject.id}`,
            branch,
            editBody(subject, { ratingExam: false }),
          )
        ).body,
      );
      expect((await schoolEntries('subject.edit', subject.id)).at(-1)?.details).toEqual({
        ratingRound: { from: 1, to: 2 },
        switchesFrom: 1,
      });
      expect((await put(path(2), branch, UNRATED)).status).toBe(200);
      const entries = (await t.entries('subject_quarter_weights.set', subject.id)).length;

      const on = await put(
        `/api/setup/subjects/${subject.id}`,
        branch,
        editBody(off, { ratingExam: true }),
      );

      expect(on.status, JSON.stringify(on.body)).toBe(200);
      expect(subjectSchema.parse(on.body)).toMatchObject({
        quarterWeightsMissing: 4,
        quarterCount: 4,
      });
      expect((await schoolEntries('subject.edit', subject.id)).at(-1)?.details).toEqual({
        ratingRound: { from: 2, to: 3 },
        switchesFrom: 1,
      });
      const read = subjectQuarterWeightsSchema.parse(
        (await t.get(`/api/setup/subjects/${subject.id}/quarter-weights?yearId=${yearId}`, branch))
          .body,
      );
      expect(read.quarters.map((quarter) => quarter.weights)).toEqual([null, null, null, null]);
      expect((await t.entries('subject_quarter_weights.set', subject.id)).length).toBe(entries);

      // Set again: written in the new rating round, audited from "none".
      expect((await put(path(1), branch, RATED)).status).toBe(200);
      expect((await t.entries('subject_quarter_weights.set', subject.id)).at(-1)).toMatchObject({
        old_value: { weights: null },
        new_value: { weights: RATED },
      });
      expect((await inList(subject.id, branch)).quarterWeightsMissing).toBe(3);
    });
  });

  // Decision 14 and migration 0021 (the spec review): a subject made graded
  // again starts a new round; no weight of an earlier round counts, in any
  // branch, for the list, the quarters, the copy and the checklist.
  describe('a new round of weights', () => {
    it('leaves every quarterly distribution of the earlier round out until it is set again', async () => {
      const branch = await t.newBranch();
      const { yearId, quarterIds } = await insertYear(branch, '2026-09-01');
      const subject = await create({}, branch);
      await put(
        `/api/setup/subjects/${subject.id}/quarter-weights/${quarterIds[0] ?? ''}`,
        branch,
        RATED,
      );
      const off = subjectSchema.parse(
        (
          await put(
            `/api/setup/subjects/${subject.id}`,
            branch,
            editBody(subject, { journalType: 'attendance_only', ratingExam: false }),
          )
        ).body,
      );

      const on = await put(
        `/api/setup/subjects/${subject.id}`,
        branch,
        editBody(off, { journalType: 'graded', ratingExam: true }),
      );

      expect(on.status).toBe(200);
      expect(subjectSchema.parse(on.body)).toMatchObject({
        quarterWeightsMissing: 4,
        quarterCount: 4,
      });
      // The switch went off with the journal type and comes back with it: a new rating round too.
      expect((await schoolEntries('subject.edit', subject.id)).at(-1)?.details).toEqual({
        weightsRound: { from: 1, to: 2 },
        ratingRound: { from: 2, to: 3 },
        switchesFrom: 1,
      });
      // This branch: quarter 1 of round 1 shows as not set, and is not copied.
      const read = subjectQuarterWeightsSchema.parse(
        (await t.get(`/api/setup/subjects/${subject.id}/quarter-weights?yearId=${yearId}`, branch))
          .body,
      );
      expect(read.quarters[0]).toMatchObject({ weights: null, fits: false });
      expect(
        errorCode(
          await t.post(`/api/setup/subjects/${subject.id}/quarter-weights/copy`, branch, {
            yearId,
          }),
        ),
      ).toBe('quarter_one_not_set');
    });
  });

  describe('copying quarter 1', () => {
    it('writes quarters 2 to 4 over what they hold, with an entry per quarter changed', async () => {
      const branch = await t.newBranch();
      const { yearId, quarterIds } = await insertYear(branch, '2026-09-01');
      const subject = await create({}, branch);
      const path = (index: number) =>
        `/api/setup/subjects/${subject.id}/quarter-weights/${quarterIds[index] ?? ''}`;
      await put(path(0), branch, RATED);
      await put(path(2), branch, { ...RATED, classwork: 40, ratingExam: 30 });
      const before = (await t.entries('subject_quarter_weights.set', subject.id)).length;

      // Task 9.1: quarter 3 holds another distribution, so the copy carries a reason.
      const response = await t.post(
        `/api/setup/subjects/${subject.id}/quarter-weights/copy`,
        branch,
        { yearId, reason: 'One distribution for the year' },
        t.admin,
      );

      expect(response.status).toBe(200);
      const answered = subjectQuarterWeightsSchema.parse(response.body);
      expect(answered.quarters.map((quarter) => quarter.weights)).toEqual([
        RATED,
        RATED,
        RATED,
        RATED,
      ]);
      expect((await t.entries('subject_quarter_weights.set', subject.id)).length).toBe(before + 3);
    });

    it('is refused without a fitting quarter 1, for an attendance-only and for an archived subject; nothing is written', async () => {
      const branch = await t.newBranch();
      const { yearId, quarterIds } = await insertYear(branch, '2026-09-01');
      const subject = await create({}, branch);
      const attendanceOnly = await create(
        { journalType: 'attendance_only', ratingExam: false },
        branch,
      );
      const copy = (id: string) =>
        t.post(`/api/setup/subjects/${id}/quarter-weights/copy`, branch, { yearId });

      expect(errorCode(await copy(subject.id))).toBe('quarter_one_not_set');
      await put(
        `/api/setup/subjects/${subject.id}/quarter-weights/${quarterIds[0] ?? ''}`,
        branch,
        RATED,
      );
      await put(
        `/api/setup/subjects/${subject.id}`,
        branch,
        editBody(subject, { ratingExam: false }),
      );
      const before = await rows();

      expect(errorCode(await copy(subject.id))).toBe('quarter_one_not_set');
      expect(errorCode(await copy(attendanceOnly.id))).toBe('attendance_only_no_weights');
      await t.post(`/api/setup/subjects/${subject.id}/archive`, branch);
      const afterArchive = await rows();
      expect(errorCode(await copy(subject.id))).toBe('subject_archived');
      expect(await rows()).toEqual(afterArchive);
      expect(before.quarters).toEqual(afterArchive.quarters);
    });
  });

  it('refuses the Principal and a Teacher on every writing route, and a Teacher on the reading ones; nothing is written', async () => {
    const branch = t.north;
    const subject = await create();
    const { yearId, quarterIds } = await insertYear(await t.newBranch(), '2026-09-01');
    const before = await rows();
    const audit = await auditCount();

    for (const cookie of [t.principal, t.teacher]) {
      const calls = [
        () => t.post('/api/setup/subjects', branch, body(), cookie),
        () => put(`/api/setup/subjects/${subject.id}`, branch, editBody(subject), cookie),
        () => t.post(`/api/setup/subjects/${subject.id}/archive`, branch, {}, cookie),
        () => t.post(`/api/setup/subjects/${subject.id}/restore`, branch, {}, cookie),
        () =>
          put(
            `/api/setup/subjects/${subject.id}/quarter-weights/${quarterIds[0] ?? ''}`,
            branch,
            RATED,
            cookie,
          ),
        () =>
          t.post(
            `/api/setup/subjects/${subject.id}/quarter-weights/copy`,
            branch,
            { yearId },
            cookie,
          ),
      ];
      for (const call of calls) {
        const response = await call();
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
    }
    expect(
      errorCode(
        await t.get(
          `/api/setup/subjects/${subject.id}/quarter-weights?yearId=${yearId}`,
          branch,
          t.teacher,
        ),
      ),
    ).toBe('permission_denied');
    expect(await rows()).toEqual(before);
    expect(await auditCount()).toBe(audit);
  });

  // Task 11.17: the item asks for no daily distribution; it is done once an active subject exists.
  it('makes the checklist item "Subjects and weights" done in a branch with active graded subjects and no daily distribution', async () => {
    const branch = await t.newBranch();
    const active = (await list(branch)).filter(
      (subject) => subject.archivedAt === null && subject.journalType === 'graded',
    );
    expect(active.length).toBeGreaterThan(0);
    const stored = await t.database.migrator
      .selectFrom('subject_daily_weights')
      .select('subject_id')
      .where('branch_id', '=', branch)
      .execute();
    expect(stored).toEqual([]);
    const response = await t.get('/api/setup/checklist', branch);
    expect(response.status).toBe(200);
    const item = setupChecklistSchema
      .parse(response.body)
      .items.find((one) => one.key === 'subjects');
    expect(item).toMatchObject({ done: true });
  });

  // The lock order of the service: every write locks the subject row first.
  // The test holds an archive of the subject open, sends an edit, sees it wait
  // in pg_stat_activity, lets the archive commit and reads the answer: the edit
  // then finds the subject archived. No step is decided by a race.
  it('serialises an edit behind an archive of the same subject: the edit waits and is then refused', async () => {
    const subject = await create();
    let open = (): void => undefined;
    const release = new Promise<void>((resolve) => {
      open = resolve;
    });
    let lockedNow = (): void => undefined;
    const locked = new Promise<void>((resolve) => {
      lockedNow = resolve;
    });
    const archive = t.app.get(Transactions).run([], async (transaction) => {
      await transaction
        .updateTable('subjects')
        .set({ archived_at: new Date(START) })
        .where('id', '=', subject.id)
        .execute();
      lockedNow();
      await release;
    });
    await locked;
    try {
      const edit = put(
        `/api/setup/subjects/${subject.id}`,
        t.north,
        editBody(subject, { groupSubject: true }),
      ).then((sent) => sent);
      for (let tries = 0; ; tries += 1) {
        const waiting = await sql<{ n: string }>`
          select count(*) as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
        `.execute(t.database.app);
        if (Number(waiting.rows[0]?.n) > 0) {
          break;
        }
        if (tries > 100) {
          throw new Error('The edit did not wait for the archive.');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      open();
      await archive;
      const response = await edit;
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('subject_archived');
      const row = await t.database.migrator
        .selectFrom('subjects')
        .select('group_subject')
        .where('id', '=', subject.id)
        .executeTakeFirstOrThrow();
      expect(row.group_subject).toBe(false);
    } finally {
      open();
      await archive.catch(() => undefined);
    }
  });
});
