import {
  appointmentListSchema,
  firstPasswordSlipSchema,
  staffAccountSchema,
  staffDetailSchema,
  type StaffAccount,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
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
import { insertSubject } from '../../testing/subjects-kit.js';

// All names are invented. Task 2.3b-1, pull request #63: Head Teacher and
// Senior Head Teacher appointments. docs/spec/02-roles-and-access.md, Head
// Teachers and Senior Head Teachers: "The Super Admin makes the appointment
// and chooses the subjects"; "A subject in a branch has at most one Head
// Teacher"; "Appointments carry dates". The clock stands at 23:55 on
// 10 October 2026 in Tashkent.
describe('Head Teacher appointments', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;
  let count = 0;

  const lettersOf = (n: number): string =>
    n < 26
      ? String.fromCharCode(97 + n)
      : lettersOf(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));

  /** A new person of the branch with an account. */
  async function withAccount(branch = t.north): Promise<{ id: string; accountId: string }> {
    count += 1;
    const lastName = `Sobirov${lettersOf(count)}`;
    const made = await t.post('/api/people/staff', branch, {
      firstName: 'Nodir',
      lastName,
      fatherName: '',
      sex: 'male',
      birthDate: '1988-03-01',
      educationLevel: 'master',
      phone: `+99893${String(1000000 + count)}`,
      email: '',
      jshshir: '',
      admissionDate: '2026-09-01',
      contractType: 'full_time',
      contractDate: '2026-09-01',
      weeklyLessons: 18,
      dailyLessons: 5,
      divisions: [{ divisionId: academic, departmentId: steam, main: true }],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = staffDetailSchema.parse(made.body).id;
    const created = await t.post(`/api/people/staff/${id}/account`, branch, {
      login: `n.${lastName.toLowerCase()}`,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const slip = firstPasswordSlipSchema.parse(created.body);
    const account = await t.database.migrator
      .selectFrom('accounts')
      .select('id')
      .where('login', '=', slip.login)
      .executeTakeFirstOrThrow();
    return { id, accountId: account.id };
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const give = (id: string, body: object, branch = t.north, cookie = t.admin) =>
    t.post(`/api/people/staff/${id}/roles`, branch, body, cookie);

  const change = (
    id: string,
    assignmentId: string,
    body: object,
    branch = t.north,
    cookie = t.admin,
  ) => t.post(`/api/people/staff/${id}/roles/${assignmentId}/subjects`, branch, body, cookie);

  const end = (id: string, assignmentId: string, from: string) =>
    t.post(`/api/people/staff/${id}/roles/${assignmentId}/end`, t.north, { from });

  const list = (branch = t.north, cookie = t.admin) =>
    t.get('/api/access/head-teachers', branch, cookie);

  /** The appointment of a role in an answer; the newest when there are several. */
  const appointmentOf = (answer: StaffAccount, role: string) => {
    const found = answer.account?.roles.filter((held) => held.role === role).at(-1);
    if (found === undefined) {
      throw new Error(`No ${role} role in the answer.`);
    }
    return found;
  };

  async function appoint(
    subjectIds: readonly string[],
    options: { role?: string; from?: string; branch?: string } = {},
  ) {
    const branch = options.branch ?? t.north;
    const made = await withAccount(branch);
    const role = options.role ?? 'head_teacher';
    const response = await give(
      made.id,
      {
        role,
        branchId: role === 'senior_head_teacher' ? null : branch,
        from: options.from ?? TODAY,
        subjectIds,
      },
      branch,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return {
      ...made,
      assignmentId: appointmentOf(staffAccountSchema.parse(response.body), role).id,
    };
  }

  /** Every row the routes may write, and the newest audit entry: what a refusal leaves as it was. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const newest = await sql<{ id: string }>`
      select id from audit_log union all select id from audit_log_school order by id desc limit 1
    `.execute(t.database.migrator);
    const rows: Record<string, unknown> = {
      audit: await t.auditCount(),
      newest: newest.rows[0]?.id ?? null,
    };
    for (const table of ['assignments', 'assignment_subjects', 'staff_status_role_ends'] as const) {
      rows[table] = await sql`select * from ${sql.table(table)} order by 1, 2`.execute(
        t.database.migrator,
      );
    }
    return rows;
  }

  const subject = (name: string) => insertSubject(t.database.migrator, name);

  beforeAll(async () => {
    t = await dayTemplatesKit();
    const id = async (table: 'divisions' | 'departments', en: string) =>
      (
        await t.database.migrator
          .selectFrom(table)
          .select('id')
          .where('name_en', '=', en)
          .executeTakeFirstOrThrow()
      ).id;
    academic = await id('divisions', 'Academic');
    steam = await id('departments', 'STEAM');
  });

  afterAll(async () => {
    await t.close();
  });

  describe('give', () => {
    it('appoints a Head Teacher of two subjects from the moment of the give, with its audit entry', async () => {
      const mathematics = await subject('Mathematics');
      const physics = await subject('Physics');
      const made = await withAccount();

      const response = await give(made.id, {
        role: 'head_teacher',
        branchId: t.north,
        from: TODAY,
        subjectIds: [physics, mathematics],
      });

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const held = appointmentOf(staffAccountSchema.parse(response.body), 'head_teacher');
      expect(held).toMatchObject({ from: TODAY, until: null, state: 'current' });
      expect(held.subjects.map((one) => one.id).sort()).toEqual([mathematics, physics].sort());
      const stored = await t.database.migrator
        .selectFrom('assignments')
        .select('valid_from')
        .where('id', '=', held.id)
        .executeTakeFirstOrThrow();
      // Decision 5 of #63: from today at the moment of the give, not 00:00.
      expect(stored.valid_from).toEqual(new Date(START));
      expect(await t.entries('assignment.given', held.id)).toMatchObject([
        {
          assignment_id: t.adminAssignment,
          person_id: made.id,
          new_value: { role: 'head_teacher', subjectIds: [mathematics, physics].sort() },
        },
      ]);
    });

    it('appoints a Senior Head Teacher without a branch, from 00:00 of a later date', async () => {
      const chemistry = await subject('Chemistry');
      const made = await withAccount();

      const response = await give(made.id, {
        role: 'senior_head_teacher',
        branchId: null,
        from: TOMORROW,
        subjectIds: [chemistry],
      });

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const held = appointmentOf(staffAccountSchema.parse(response.body), 'senior_head_teacher');
      expect(held).toMatchObject({ branchId: null, from: TOMORROW, state: 'planned' });
      expect(held.subjects).toMatchObject([{ id: chemistry, archived: false }]);
    });

    // `02`, One per subject per branch; the Done when of the build plan.
    it('refuses a second Head Teacher of a subject in the branch, naming it, and changes nothing', async () => {
      const biology = await subject('Biology');
      const history = await subject('History');
      await appoint([biology]);
      const second = await withAccount();
      const before = await snapshot();

      const response = await give(second.id, {
        role: 'head_teacher',
        branchId: t.north,
        from: TOMORROW,
        subjectIds: [history, biology],
      });

      refusedWith(response, 409, 'head_teacher_taken');
      expect(response.body).toMatchObject({
        error: { details: [{ path: 'subjectIds.1', code: 'taken' }] },
      });
      expect(await snapshot()).toEqual(before);
    });

    it('allows the same subject in another branch', async () => {
      const geography = await subject('Geography');
      await appoint([geography]);

      const south = await appoint([geography], { branch: t.south });

      expect(south.assignmentId).toBeDefined();
    });

    it('refuses a second Senior Head Teacher of a subject (decision 4)', async () => {
      const economics = await subject('Economics');
      await appoint([economics], { role: 'senior_head_teacher' });
      const second = await withAccount();

      refusedWith(
        await give(second.id, {
          role: 'senior_head_teacher',
          branchId: null,
          from: TOMORROW,
          subjectIds: [economics],
        }),
        409,
        'head_teacher_taken',
      );
    });

    it('lets the next Head Teacher follow one ended today', async () => {
      const literature = await subject('Literature');
      const first = await appoint([literature]);
      expect((await end(first.id, first.assignmentId, TODAY)).status).toBe(200);

      const next = await appoint([literature]);

      expect(next.assignmentId).toBeDefined();
    });

    it('refuses subjects missing or given to another role, a branch for a Senior Head Teacher, and unknown or archived subjects', async () => {
      const made = await withAccount();
      const art = await subject('Art');
      const archived = await insertSubject(t.database.migrator, 'Drawing', new Date(START));
      const before = await snapshot();

      refusedWith(
        await give(made.id, { role: 'head_teacher', branchId: t.north, from: TODAY }),
        400,
        'validation_failed',
      );
      refusedWith(
        await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY, subjectIds: [art] }),
        400,
        'validation_failed',
      );
      refusedWith(
        await give(made.id, {
          role: 'senior_head_teacher',
          branchId: t.north,
          from: TODAY,
          subjectIds: [art],
        }),
        400,
        'validation_failed',
      );
      for (const one of [archived, UNKNOWN]) {
        refusedWith(
          await give(made.id, {
            role: 'head_teacher',
            branchId: t.north,
            from: TODAY,
            subjectIds: [one],
          }),
          409,
          'subject_unknown',
        );
      }
      expect(await snapshot()).toEqual(before);
    });

    it('meets a second give of the same subject at the same moment with one refusal', async () => {
      const music = await subject('Music');
      const first = await withAccount();
      const second = await withAccount();
      const body = { role: 'head_teacher', branchId: t.north, from: TOMORROW, subjectIds: [music] };

      const answers = await Promise.all([give(first.id, body), give(second.id, body)]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
      expect(answers.filter((answer) => answer.status === 409).map((answer) => errorCode(answer))).toEqual([
        'head_teacher_taken',
      ]);
      expect(
        await t.database.migrator
          .selectFrom('assignment_subjects')
          .select('assignment_id')
          .where('subject_id', '=', music)
          .execute(),
      ).toHaveLength(1);
    });
  });

  describe('change of subjects', () => {
    it.each([
      ['today', TODAY],
      ['a later date', TOMORROW],
    ])(
      'keeps a subject and adds another from %s: the old ends and the new begins at one moment',
      async (_name, from) => {
        const algebra = await subject('Algebra');
        const optics = await subject('Optics');
        const made = await appoint([algebra]);

        const response = await change(made.id, made.assignmentId, {
          subjectIds: [algebra, optics],
          from,
        });

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        const rows = await t.database.migrator
          .selectFrom('assignments')
          .select(['id', 'valid_from', 'valid_until'])
          .where('account_id', '=', made.accountId)
          .where('role', '=', 'head_teacher')
          .orderBy('valid_from')
          .orderBy('id')
          .execute();
        expect(rows).toHaveLength(2);
        const [old, now] = rows;
        expect(old?.id).toBe(made.assignmentId);
        expect(old?.valid_until).toEqual(now?.valid_from);
        const held = appointmentOf(staffAccountSchema.parse(response.body), 'head_teacher');
        expect(held.id).toBe(now?.id);
        expect(held.subjects.map((one) => one.id).sort()).toEqual([algebra, optics].sort());
        expect(await t.entries('assignment.ended', made.assignmentId)).toHaveLength(1);
        expect(await t.entries('assignment.given', held.id)).toHaveLength(1);
      },
    );

    it('carries a later end over to the appointment that follows, and refuses one that ends by then', async () => {
      const ceramics = await subject('Ceramics');
      const made = await appoint([ceramics]);
      expect((await end(made.id, made.assignmentId, '2026-12-01')).status).toBe(200);

      refusedWith(
        await change(made.id, made.assignmentId, { subjectIds: [ceramics], from: '2026-12-01' }),
        409,
        'assignment_ended',
      );
      const response = await change(made.id, made.assignmentId, {
        subjectIds: [ceramics, await subject('Weaving')],
        from: TOMORROW,
      });

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(appointmentOf(staffAccountSchema.parse(response.body), 'head_teacher')).toMatchObject({
        from: TOMORROW,
        until: '2026-12-01',
      });
    });

    it('refuses a subject another Head Teacher holds, and changes nothing', async () => {
      const ecology = await subject('Ecology');
      const botany = await subject('Botany');
      await appoint([ecology]);
      const made = await appoint([botany]);
      const before = await snapshot();

      const response = await change(made.id, made.assignmentId, {
        subjectIds: [botany, ecology],
        from: TOMORROW,
      });

      refusedWith(response, 409, 'head_teacher_taken');
      expect(response.body).toMatchObject({ error: { details: [{ path: 'subjectIds.1' }] } });
      expect(await snapshot()).toEqual(before);
    });

    it('refuses another role, a past date, an ended appointment and the Principal', async () => {
      const zoology = await subject('Zoology');
      const made = await appoint([zoology]);
      const teacher = staffAccountSchema.parse(
        (await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY })).body,
      );
      const teacherRole = appointmentOf(teacher, 'teacher');
      const before = await snapshot();

      refusedWith(
        await change(made.id, teacherRole.id, { subjectIds: [zoology], from: TODAY }),
        409,
        'role_not_appointment',
      );
      refusedWith(
        await change(made.id, made.assignmentId, { subjectIds: [zoology], from: '2026-10-09' }),
        409,
        'role_from_past',
      );
      refusedWith(
        await change(
          made.id,
          made.assignmentId,
          { subjectIds: [zoology], from: TOMORROW },
          t.north,
          t.principal,
        ),
        403,
        'permission_denied',
      );
      expect(await snapshot()).toEqual(before);

      expect((await end(made.id, made.assignmentId, TODAY)).status).toBe(200);
      refusedWith(
        await change(made.id, made.assignmentId, { subjectIds: [zoology], from: TOMORROW }),
        409,
        'assignment_ended',
      );
    });

    it('answers 404 for an appointment of another person, an unknown one and a record of another branch', async () => {
      const anatomy = await subject('Anatomy');
      const made = await appoint([anatomy]);
      const other = await appoint([await subject('Genetics')]);
      const southern = await appoint([anatomy], { branch: t.south });
      const before = await snapshot();

      refusedWith(
        await change(made.id, other.assignmentId, { subjectIds: [anatomy], from: TOMORROW }),
        404,
        'not_found',
      );
      refusedWith(
        await change(made.id, UNKNOWN, { subjectIds: [anatomy], from: TOMORROW }),
        404,
        'not_found',
      );
      refusedWith(
        await change(southern.id, southern.assignmentId, {
          subjectIds: [anatomy],
          from: TOMORROW,
        }),
        404,
        'not_found',
      );
      refusedWith(
        await change(UNKNOWN, made.assignmentId, { subjectIds: [anatomy], from: TOMORROW }),
        404,
        'not_found',
      );
      expect(await snapshot()).toEqual(before);
    });

    it('meets two changes of one appointment at the same moment with one refusal', async () => {
      const statics = await subject('Statics');
      const made = await appoint([statics]);
      const body = { subjectIds: [statics, await subject('Dynamics')], from: TOMORROW };

      const answers = await Promise.all([
        change(made.id, made.assignmentId, body),
        change(made.id, made.assignmentId, body),
      ]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      expect(answers.filter((answer) => answer.status === 409).map((answer) => errorCode(answer))).toEqual([
        'assignment_ended',
      ]);
    });

    it('waits for an end held open on the appointment, then refuses', async () => {
      const acoustics = await subject('Acoustics');
      const made = await appoint([acoustics]);
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const lockTaken = new Promise<void>((resolve) => {
        locked = resolve;
      });
      // What the end route does: lock the appointment, end it, commit.
      const holder = t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select id from assignments where id = ${made.assignmentId} for update`.execute(
          transaction,
        );
        locked();
        await held;
        await transaction
          .updateTable('assignments')
          .set({ valid_until: new Date(START) })
          .where('id', '=', made.assignmentId)
          .execute();
      });
      await lockTaken;

      const waiting = change(made.id, made.assignmentId, {
        subjectIds: [acoustics],
        from: TOMORROW,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      release();
      await holder;

      refusedWith(await waiting, 409, 'assignment_ended');
    });
  });

  // Decision 10 of #63: bringing an appointment back is checked again.
  describe('an appointment brought back', () => {
    it('is refused when its end moves later over a Head Teacher appointed meanwhile', async () => {
      const logic = await subject('Logic');
      const first = await appoint([logic]);
      expect((await end(first.id, first.assignmentId, '2026-11-01')).status).toBe(200);
      await appoint([logic], { from: '2026-11-01' });
      const before = await snapshot();

      refusedWith(await end(first.id, first.assignmentId, '2026-12-01'), 409, 'head_teacher_taken');
      expect(await snapshot()).toEqual(before);
    });

    it('is refused when a planned leave is taken back over a Head Teacher appointed meanwhile', async () => {
      const rhetoric = await subject('Rhetoric');
      const first = await appoint([rhetoric]);
      const left = await t.post(`/api/people/staff/${first.id}/status`, t.north, {
        status: 'left',
        from: '2026-12-01',
      });
      expect(left.status, JSON.stringify(left.body)).toBe(200);
      await appoint([rhetoric], { from: '2026-12-01' });
      const before = await snapshot();

      refusedWith(
        await t.post(`/api/people/staff/${first.id}/status`, t.north, {
          status: 'active',
          from: TODAY,
        }),
        409,
        'head_teacher_taken',
      );
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('the list of a branch', () => {
    it('shows the branch-wide readers every appointment of the branch and every Senior Head Teacher', async () => {
      const poetry = await subject('Poetry');
      const ethics = await subject('Ethics');
      const northern = await appoint([poetry]);
      const senior = await appoint([ethics], { role: 'senior_head_teacher', from: TOMORROW });
      const southern = await appoint([await subject('Grammar')], { branch: t.south });

      for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
        const response = await list(t.north, cookie);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        const ids = appointmentListSchema
          .parse(response.body)
          .appointments.map((appointment) => appointment.id);
        expect(ids).toContain(northern.assignmentId);
        expect(ids).toContain(senior.assignmentId);
        expect(ids).not.toContain(southern.assignmentId);
      }
      const found = appointmentListSchema
        .parse((await list()).body)
        .appointments.find((appointment) => appointment.id === senior.assignmentId);
      expect(found).toMatchObject({
        role: 'senior_head_teacher',
        state: 'planned',
        from: TOMORROW,
      });
    });

    it('shows a Head Teacher and a Senior Head Teacher their own subjects only', async () => {
      const calculus = await subject('Calculus');
      const mechanics = await subject('Mechanics');
      const own = await appoint([calculus]);
      const colleague = await appoint([mechanics]);
      const browser = await t.kit.fullSession('Otabek', 'Usmonov');
      const astronomy = await subject('Astronomy');
      await t.kit.giveRole(browser.account.id, {
        role: 'head_teacher',
        branchId: t.north,
        subjectIds: [astronomy],
      });
      await t.kit.giveRole(browser.account.id, {
        role: 'senior_head_teacher',
        subjectIds: [calculus],
      });

      const response = await list(t.north, browser.cookie);

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const appointments = appointmentListSchema.parse(response.body).appointments;
      const ids = appointments.map((appointment) => appointment.id);
      expect(ids).toContain(own.assignmentId);
      expect(ids).not.toContain(colleague.assignmentId);
      for (const appointment of appointments) {
        for (const one of appointment.subjects) {
          expect([calculus, astronomy]).toContain(one.id);
        }
      }
    });

    it('refuses a Teacher, and names a holder of another branch by login only (decision 14)', async () => {
      const sociology = await subject('Sociology');
      const southern = await appoint([sociology], { role: 'senior_head_teacher', branch: t.south });

      refusedWith(await list(t.north, t.teacher), 403, 'permission_denied');
      const found = appointmentListSchema
        .parse((await list()).body)
        .appointments.find((appointment) => appointment.id === southern.assignmentId);
      expect(found?.person.name).toBeNull();
      expect(found?.person.login).toMatch(/^n\.sobirov/);
      const inSouth = appointmentListSchema
        .parse((await list(t.south)).body)
        .appointments.find((appointment) => appointment.id === southern.assignmentId);
      expect(inSouth?.person.name).toMatchObject({ firstName: 'Nodir' });
    });

    it('leaves out an ended appointment', async () => {
      const latin = await subject('Philology');
      const made = await appoint([latin]);
      expect((await end(made.id, made.assignmentId, TODAY)).status).toBe(200);

      const ids = appointmentListSchema
        .parse((await list()).body)
        .appointments.map((appointment) => appointment.id);

      expect(ids).not.toContain(made.assignmentId);
    });
  });
});
