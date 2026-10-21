import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  actingTeacherCheckSchema,
  actingTeacherSchema,
  vacancyDetailSchema,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { ActingKit, type ActingScene } from '../../testing/acting-kit.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { journalOwnerOn } from './journal-owners.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

/** The kit's clock stands at 23:55 on Saturday 10 October 2026 in Tashkent. */
const TODAY = '2026-10-10';
const YESTERDAY = '2026-10-09';
const MONDAY = '2026-10-12';
const LATER = '2026-10-19';
/** The fill's date, a Monday. */
const FILL = '2026-11-02';

// All names are invented. Task 5.7a-3c, pull request #190: the acting
// teacher of a vacancy's journal (edge/timetable, After publishing, "A
// vacancy lasts a quarter: who writes the plan and grades?"), the routes
// `POST /api/timetable/acting-teachers`, `/check` and `/:id/end` (area
// `timetable` `edit`, decision 7) and the vacancy's record (decision 8).
describe('acting teachers', () => {
  let t: DayTemplatesKit;
  let kit: ActingKit;
  let viceAccount: string;

  beforeAll(async () => {
    t = await dayTemplatesKit();
    kit = new ActingKit(t.database.migrator);
    viceAccount = (
      await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.viceAssignment)
        .executeTakeFirstOrThrow()
    ).account_id;
  });

  afterAll(async () => {
    await t.close();
  });

  /** A scene in a new branch, where the kit's Academic Vice Principal holds the role too. */
  async function scene(input: { language?: 'uz' | 'ru' } = {}): Promise<ActingScene> {
    const branch = await t.newBranch();
    await kit.load.classes.role(viceAccount, branch, 'academic_vice_principal');
    return kit.scene(branch, input);
  }

  const keyed = (
    path: string,
    branch: string,
    body: object,
    key = randomUUID(),
    cookie = t.vicePrincipal,
  ) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send(body);

  const bodyOf = (s: ActingScene, extra: object = {}) => ({
    vacancyId: s.vacancy,
    journalId: s.journal,
    personId: s.person,
    from: MONDAY,
    ...extra,
  });

  const name = (s: ActingScene, extra: object = {}, cookie = t.vicePrincipal, key = randomUUID()) =>
    keyed('/api/timetable/acting-teachers', s.branch, bodyOf(s, extra), key, cookie);

  const check = (s: ActingScene, extra: object = {}, cookie = t.vicePrincipal) =>
    t.post('/api/timetable/acting-teachers/check', s.branch, bodyOf(s, extra), cookie);

  const named = async (s: ActingScene, extra: object = {}) => {
    const answer = await name(s, extra);
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    return actingTeacherSchema.parse(answer.body);
  };

  const end = (
    s: ActingScene,
    id: string,
    until: string,
    key = randomUUID(),
    cookie = t.vicePrincipal,
  ) => keyed(`/api/timetable/acting-teachers/${id}/end`, s.branch, { until }, key, cookie);

  /** The kit's Teacher, given the role in the branch too, so a refusal is the role's, not the branch's. */
  async function teacherIn(branch: string): Promise<string> {
    const teacher = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('role', '=', 'teacher')
      .where('branch_id', '=', t.north)
      .executeTakeFirstOrThrow();
    await kit.load.classes.role(teacher.account_id, branch, 'teacher');
    return t.teacher;
  }

  /** Every period of a branch, each column: what a refused change leaves as it was. */
  const rowsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('journal_acting_teachers')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute();

  const ownerOn = (s: ActingScene, day: string) =>
    new Transactions(t.database.app, t.clock).run([s.branch], (transaction) =>
      journalOwnerOn(transaction, s.branch, s.journal, day),
    );

  describe('naming', () => {
    it('lets the Academic Vice Principal name an acting teacher, who owns the journal from the day, with the audit entry', async () => {
      const s = await scene();
      const answer = await named(s);
      expect(answer).toMatchObject({
        journalId: s.journal,
        person: { id: s.person },
        from: MONDAY,
        until: null,
        endsOn: null,
        state: 'planned',
        canEnd: true,
        canWithdraw: true,
      });
      expect(answer.person.name).not.toBe('');
      expect((await ownerOn(s, TODAY))?.kind).toBe('none');
      expect(await ownerOn(s, MONDAY)).toEqual({
        kind: 'acting',
        staffId: s.person,
        vacancyId: s.vacancy,
      });
      const assignment = await t.database.migrator
        .selectFrom('assignments')
        .select('id')
        .where('account_id', '=', viceAccount)
        .where('branch_id', '=', s.branch)
        .executeTakeFirstOrThrow();
      const [entry] = await t.entries('vacancy.acting_name', s.vacancy);
      expect(entry).toMatchObject({
        person_id: s.person,
        assignment_id: assignment.id,
        new_value: {
          id: answer.id,
          journalId: s.journal,
          personId: s.person,
          from: MONDAY,
          until: null,
        },
      });
    });

    it('lets the Super Admin name one from today with an end', async () => {
      const s = await scene();
      const answer = await name(s, { from: TODAY, until: LATER }, t.admin);
      expect(answer.status, JSON.stringify(answer.body)).toBe(201);
      expect(actingTeacherSchema.parse(answer.body)).toMatchObject({
        from: TODAY,
        until: LATER,
        state: 'current',
        canWithdraw: false,
      });
    });

    it('refuses a role without timetable edit in the branch, and the Academic Vice Principal of another branch', async () => {
      const s = await scene();
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .executeTakeFirstOrThrow();
      await kit.load.classes.role(principal.account_id, s.branch, 'principal');
      const audit = await t.auditCount();
      refusedWith(await name(s, {}, t.principal), 403, 'permission_denied');
      refusedWith(await check(s, {}, t.principal), 403, 'permission_denied');
      const other = await kit.scene(await t.newBranch());
      refusedWith(await name(other), 403, 'permission_denied');
      expect(await rowsOf(s.branch)).toEqual([]);
      expect(await rowsOf(other.branch)).toEqual([]);
      expect(await t.auditCount()).toBe(audit);
    });

    it('answers 404 for another branch’s or an unknown journal, vacancy or person, writing nothing', async () => {
      const s = await scene();
      const theirs = await scene();
      // A period in the other branch, so a write there would show.
      await kit.period(theirs, LATER);
      const before = await rowsOf(theirs.branch);
      const audit = await t.auditCount();
      for (const extra of [
        { journalId: theirs.journal },
        { journalId: UNKNOWN },
        { vacancyId: theirs.vacancy },
        { vacancyId: UNKNOWN },
        { personId: theirs.person },
        { personId: UNKNOWN },
      ]) {
        refusedWith(await name(s, extra), 404, 'not_found');
        refusedWith(await check(s, extra), 404, 'not_found');
      }
      expect(await rowsOf(s.branch)).toEqual([]);
      expect(await rowsOf(theirs.branch)).toEqual(before);
      expect(await t.auditCount()).toBe(audit);
    });

    it('refuses a journal the vacancy does not hold on the start day: another vacancy, a person named as the vacancy, a day from the fill (decision 2)', async () => {
      const s = await scene();
      const another = await kit.load.vacancy(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      refusedWith(await name(s, { vacancyId: another }), 422, 'acting_not_vacancy');
      const other = await kit.load.teacher(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      refusedWith(await name(s, { vacancyId: other.staffId }), 422, 'acting_not_vacancy');
      await kit.published(s, FILL, other.staffId);
      refusedWith(await name(s, { from: FILL }), 422, 'acting_not_vacancy');
      // Before the fill date the vacancy still holds it.
      expect((await name(s, { until: FILL })).status).toBe(201);
    });

    it('refuses a vacancy or a person not active on the start day (acting_person, decision 5)', async () => {
      const s = await scene();
      const vacancy = await kit.load.vacancy(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      refusedWith(await name(s, { personId: vacancy }), 422, 'acting_person');
      await kit.load.status(s.person, 'inactive', MONDAY);
      refusedWith(await name(s), 422, 'acting_person');
      expect((await name(s, { from: TODAY, until: MONDAY })).status).toBe(201);
    });

    it('refuses a person without the subject for the grade (acting_profile, decision 5)', async () => {
      const s = await scene();
      const other = await kit.load.teacher(s.branch, {
        subjects: [{ subject: s.subject, grades: [8] }],
      });
      refusedWith(await name(s, { personId: other.staffId }), 422, 'acting_profile');
      const none = await kit.load.teacher(s.branch);
      refusedWith(await name(s, { personId: none.staffId }), 422, 'acting_profile');
    });

    it('asks a confirmation for a person who does not teach in the class’s language, and names them with it (decision 5)', async () => {
      const s = await scene({ language: 'ru' });
      await t.database.migrator
        .updateTable('subjects')
        .set({ language_rule: true })
        .where('id', '=', s.subject)
        .execute();
      const asked = await check(s);
      expect(asked.status, JSON.stringify(asked.body)).toBe(200);
      expect(actingTeacherCheckSchema.parse(asked.body)).toEqual({ problems: [], language: true });
      refusedWith(await name(s), 409, 'acting_language');
      expect(await rowsOf(s.branch)).toEqual([]);
      expect((await name(s, { confirmLanguage: true })).status).toBe(201);
      const [entry] = await t.entries('vacancy.acting_name', s.vacancy);
      expect(entry).toMatchObject({ new_value: { language: true } });
    });

    it('refuses a start before today (decision 4)', async () => {
      const s = await scene();
      refusedWith(await name(s, { from: YESTERDAY }), 422, 'acting_start_past');
    });

    it('refuses an empty or reversed period in the body (review correction 1)', async () => {
      const s = await scene();
      refusedWith(await name(s, { until: MONDAY }), 400, 'validation_failed');
      refusedWith(await name(s, { until: TODAY }), 400, 'validation_failed');
      refusedWith(await name(s, { other: 1 }), 400, 'validation_failed');
    });

    it('refuses a second acting teacher on a day of the period (decision 6)', async () => {
      const s = await scene();
      await named(s, { until: FILL });
      refusedWith(await name(s, { from: LATER }), 409, 'acting_overlap');
      expect((await name(s, { from: FILL })).status).toBe(201);
    });

    it('answers the check with every problem in order, writing nothing', async () => {
      const s = await scene();
      const none = await kit.load.teacher(s.branch);
      const answer = await check(s, { personId: none.staffId, from: YESTERDAY });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(actingTeacherCheckSchema.parse(answer.body)).toEqual({
        problems: ['acting_profile', 'acting_start_past'],
        language: false,
      });
      expect(await rowsOf(s.branch)).toEqual([]);
    });
  });

  describe('the request key', () => {
    it('answers a repeat once and refuses it from another account', async () => {
      const s = await scene();
      const key = randomUUID();
      const first = await name(s, {}, t.vicePrincipal, key);
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const again = await name(s, {}, t.vicePrincipal, key);
      expect(again.status).toBe(201);
      expect(again.body).toEqual(first.body);
      expect(await rowsOf(s.branch)).toHaveLength(1);
      refusedWith(await name(s, {}, t.admin, key), 409, 'request_key_reused');
    });

    it('checks the ids and the permission again on a repeat, before the stored answer', async () => {
      const s = await scene();
      const theirs = await scene();
      const key = randomUUID();
      expect((await name(s, { until: FILL }, t.vicePrincipal, key)).status).toBe(201);
      for (const extra of [{ journalId: theirs.journal }, { personId: UNKNOWN }]) {
        refusedWith(await name(s, extra, t.vicePrincipal, key), 404, 'not_found');
      }
      const teacher = await teacherIn(s.branch);
      refusedWith(await name(s, {}, teacher, key), 403, 'permission_denied');
      const period = await named(s, { from: FILL });
      const endKey = randomUUID();
      expect((await end(s, period.id, FILL, endKey)).status).toBe(200);
      refusedWith(await end(theirs, period.id, FILL, endKey), 404, 'not_found');
      refusedWith(await end(s, UNKNOWN, FILL, endKey), 404, 'not_found');
      refusedWith(await end(s, period.id, FILL, endKey, teacher), 403, 'permission_denied');
      refusedWith(await end(s, period.id, FILL, endKey, t.admin), 409, 'request_key_reused');
    });
  });

  describe('the end', () => {
    it('ends a period on a day, with the audit entry; the day is the first the person no longer owns it (review correction 2)', async () => {
      const s = await scene();
      const period = await named(s, { from: TODAY });
      const answer = await end(s, period.id, LATER);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(actingTeacherSchema.parse(answer.body)).toMatchObject({
        until: LATER,
        state: 'current',
      });
      expect((await ownerOn(s, '2026-10-18'))?.kind).toBe('acting');
      expect((await ownerOn(s, LATER))?.kind).toBe('none');
      const [entry] = await t.entries('vacancy.acting_end', s.vacancy);
      expect(entry).toMatchObject({
        person_id: s.person,
        old_value: { until: null, endCause: null },
        new_value: { until: LATER, endCause: 'ended' },
      });
    });

    it('withdraws a planned period by ending it on its start, kept as an empty row', async () => {
      const s = await scene();
      const period = await named(s);
      const answer = await end(s, period.id, MONDAY);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(actingTeacherSchema.parse(answer.body)).toMatchObject({
        state: 'withdrawn',
        canEnd: false,
        canWithdraw: false,
      });
      expect((await rowsOf(s.branch))[0]).toMatchObject({ end_cause: 'withdrawn' });
      refusedWith(await end(s, period.id, MONDAY), 409, 'acting_ended');
      expect((await name(s)).status).toBe(201);
    });

    it('refuses an end before today, after its own end, a withdraw of a started period, and an ended period', async () => {
      const s = await scene();
      const current = await named(s, { from: TODAY, until: FILL });
      refusedWith(await end(s, current.id, YESTERDAY), 409, 'acting_end_past');
      refusedWith(await end(s, current.id, '2026-11-09'), 409, 'acting_end_later');
      refusedWith(await end(s, current.id, TODAY), 409, 'acting_started');
      const past = await kit.period(s, '2026-09-14', '2026-09-21');
      refusedWith(await end(s, past, MONDAY), 409, 'acting_ended');
      const planned = await named(s, { from: FILL });
      refusedWith(await end(s, planned.id, LATER), 409, 'acting_end_past');
    });

    it('answers 404 for another branch’s or an unknown period, changing nothing', async () => {
      const s = await scene();
      const theirs = await scene();
      const period = await named(theirs);
      const before = await rowsOf(theirs.branch);
      const audit = await t.auditCount();
      refusedWith(await end(s, period.id, LATER), 404, 'not_found');
      refusedWith(await end(s, UNKNOWN, LATER), 404, 'not_found');
      refusedWith(await end(s, period.id, LATER, randomUUID(), t.admin), 404, 'not_found');
      expect(await rowsOf(theirs.branch)).toEqual(before);
      expect(await t.auditCount()).toBe(audit);
    });

    it('refuses a role without timetable edit', async () => {
      const s = await scene();
      const period = await named(s);
      const teacher = await teacherIn(s.branch);
      const before = await rowsOf(s.branch);
      const audit = await t.auditCount();
      refusedWith(await end(s, period.id, LATER, randomUUID(), teacher), 403, 'permission_denied');
      expect(await rowsOf(s.branch)).toEqual(before);
      expect(await t.auditCount()).toBe(audit);
    });
  });

  describe('the vacancy’s record (decision 8, must-fix 5)', () => {
    it('answers the journals and their periods, the end at the fill date, and no draft', async () => {
      const s = await scene();
      const period = await named(s, { from: TODAY });
      const other = await kit.load.teacher(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      await kit.published(s, FILL, other.staffId);
      // A draft naming the vacancy again from later is not counted.
      await kit.published(s, '2026-11-16', s.vacancy, 'draft');
      const answer = await t.get(`/api/people/vacancies/${s.vacancy}`, s.branch);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const detail = vacancyDetailSchema.parse(answer.body);
      expect(detail.journals).toEqual([
        {
          id: s.journal,
          classId: s.classId,
          groupId: null,
          subjectId: s.subject,
          runs: [{ from: TODAY, until: FILL }],
          acting: [expect.objectContaining({ id: period.id, endsOn: FILL, state: 'current' })],
        },
      ]);
      expect(detail.fillUnits.map((one) => one.id)).toContain(s.classId);
      // The Principal reads the vacancy and so its periods, with the name (a reader of the new value).
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await kit.load.classes.role(principal.account_id, s.branch, 'principal');
      const read = await t.get(`/api/people/vacancies/${s.vacancy}`, s.branch, t.principal);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect(vacancyDetailSchema.parse(read.body).journals[0]?.acting[0]?.person).toEqual(
        period.person,
      );
    });

    it('lists the naming and the end in the person’s personal data report', async () => {
      const s = await scene();
      const period = await named(s);
      expect((await end(s, period.id, MONDAY)).status).toBe(200);
      const report = await t.post(`/api/people/staff/${s.person}/report`, s.branch);
      expect(report.status, JSON.stringify(report.body)).toBe(200);
      const actions = (report.body as { entries: { action: string }[] }).entries.map(
        (one) => one.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining(['vacancy.acting_name', 'vacancy.acting_end']),
      );
    });

    it('answers 404 for another branch’s vacancy', async () => {
      const s = await scene();
      const theirs = await scene();
      refusedWith(
        await t.get(`/api/people/vacancies/${theirs.vacancy}`, s.branch),
        404,
        'not_found',
      );
    });
  });
});
