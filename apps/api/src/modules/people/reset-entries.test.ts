import { resetEntriesSchema, type Reset, type ResetEntries } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import type { Json } from '../../database/types.generated.js';
import { ratingEntryAndNote } from '../../testing/rating-kit.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** A moment in Tashkent. */
const at = (date: string, time: string) => `${date}T${time}:00+05:00`;
const iso = (moment: string) => new Date(moment).toISOString();
/**
 * The clock of every request: the sessions are signed in at it, and a save
 * at another moment sets the clock back to it afterwards.
 */
const NOW = at('2026-11-02', '12:00');

// The report of entries made within 48 hours of a password reset (task 6.1c,
// pull request #209; edge-cases/people-roles-accounts, Accounts and sign-in:
// "A report lists entries made within 48 hours of a reset ... A password
// reset by email that follows a change of the email by somebody else is
// listed in the same report"). The plan approved with corrections 1 to 5.
// All names are invented.
describe('the report of entries after a reset', () => {
  let t: DayTemplatesKit;
  let cells: CellsKit;
  let adminAccount: string;

  /** The account of the kit's holder of a role. */
  const accountOf = async (role: 'super_admin' | 'academic_vice_principal') =>
    (
      await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', role)
        .orderBy('id')
        .executeTakeFirstOrThrow()
    ).account_id;
  const scenes = new Map<string, { classId: string; year: string; students: string[] }>();

  const classes = () => cells.lessons.load.classes;

  /** A class of grade 7 with three students in the branch, made once. */
  async function scene(branch: string) {
    const found = scenes.get(branch);
    if (found !== undefined) return found;
    const year = await classes().year(branch);
    const classId = await classes().schoolClass(branch, year, { grade: 7 });
    const students = await cells.lessons.pupils(branch, classId, 3);
    const made = { classId, year, students };
    scenes.set(branch, made);
    return made;
  }

  /** A lesson of the branch's class on a date. */
  async function lesson(branch: string, date = '2026-10-12'): Promise<string> {
    const { classId, year } = await scene(branch);
    return cells.lesson(branch, year, classId, date);
  }

  /** A mark saved by `saveCells` as the account, at the moment of the clock given. */
  async function mark(input: {
    branch: string;
    accountId: string;
    lessonId: string;
    student?: number;
    value?: number;
    at: string;
  }): Promise<void> {
    const { students } = await scene(input.branch);
    const studentId = students[input.student ?? 0] ?? '';
    const stored = await t.database.migrator
      .selectFrom('journal_cells')
      .select('version')
      .where('lesson_id', '=', input.lessonId)
      .where('student_id', '=', studentId)
      .where('work_id', 'is', null)
      .executeTakeFirst();
    t.clock.set(input.at);
    await t.app.get(Transactions).run([input.branch], (transaction) =>
      saveCells(transaction, t.app.get(Audit), { accountId: input.accountId }, [
        {
          lessonId: input.lessonId,
          studentId,
          workId: null,
          value: input.value ?? 1,
          version: stored?.version ?? null,
        },
      ]),
    );
    t.clock.set(NOW);
  }

  /** An entry written by hand, through the owner of the log, as the services write it. */
  async function entry(values: {
    branch: string | null;
    action: string;
    at: string;
    actor: string | null;
    person?: string;
    record?: { type: string; id: string };
    newValue?: unknown;
    details?: unknown;
  }): Promise<string> {
    const id = (await sql<{ id: string }>`select uuidv7() as id`.execute(t.database.migrator))
      .rows[0]?.id;
    const json = (value: unknown) =>
      value === undefined ? null : sql<Json>`${JSON.stringify(value)}::jsonb`;
    const row = {
      id: id ?? '',
      occurred_at: new Date(values.at),
      actor_id: values.actor,
      person_id: values.person ?? null,
      action: values.action,
      record_type: values.record?.type ?? null,
      record_id: values.record?.id ?? null,
      new_value: json(values.newValue),
      details: json(values.details),
    };
    if (values.branch === null) {
      await t.database.migrator.insertInto('audit_log_school').values(row).execute();
    } else {
      await t.database.migrator
        .insertInto('audit_log')
        .values({ ...row, branch_id: values.branch })
        .execute();
    }
    return id ?? '';
  }

  const report = (branch: string, from: string, to: string, cookie?: string) =>
    t.get(`/api/people/accounts/reset-entries?from=${from}&to=${to}`, branch, cookie);

  function ok(response: Response): ResetEntries {
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return resetEntriesSchema.parse(response.body);
  }

  const resetOf = (answer: ResetEntries, accountId: string): Reset[] =>
    answer.resets.filter((reset) => reset.person.accountId === accountId);

  beforeAll(async () => {
    t = await dayTemplatesKit({ start: NOW });
    cells = await CellsKit.create(t.database.migrator);
    adminAccount = await accountOf('super_admin');
  });

  afterAll(async () => {
    await t.close();
  });

  it('lists the entries of the 48 hours of a reset by the Academic Vice Principal, and none before or after', async () => {
    const teacher = await classes().person(t.north, ['uz'], { first: 'Nodira', last: 'Rahimova' });
    // A Teacher of the branch, whom the Academic Vice Principal may reset.
    await classes().role(teacher.accountId, t.north, 'teacher');
    const viceAccount = await accountOf('academic_vice_principal');
    const colleague = await classes().person(t.north, ['uz']);
    const first = await lesson(t.north);
    const second = await lesson(t.north);
    await mark({
      branch: t.north,
      accountId: teacher.accountId,
      lessonId: first,
      at: at('2026-11-02', '11:59'),
    });
    const reset = await t.post(
      `/api/people/staff/${teacher.staffId}/account/password-reset`,
      t.north,
      {},
      t.vicePrincipal,
    );
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    await mark({
      branch: t.north,
      accountId: teacher.accountId,
      lessonId: first,
      value: 2,
      at: at('2026-11-02', '13:00'),
    });
    await mark({
      branch: t.north,
      accountId: teacher.accountId,
      lessonId: first,
      student: 1,
      at: at('2026-11-04', '11:59'),
    });
    await mark({
      branch: t.north,
      accountId: teacher.accountId,
      lessonId: first,
      student: 2,
      at: at('2026-11-04', '12:00'),
    });
    await mark({
      branch: t.north,
      accountId: colleague.accountId,
      lessonId: second,
      at: at('2026-11-02', '13:30'),
    });

    // The Super Admin reads it (correction of the plan review: a reader per role).
    const [found] = resetOf(
      ok(await report(t.north, '2026-11-02', '2026-11-02')),
      teacher.accountId,
    );
    expect(found?.kind).toBe('administrator');
    expect(found?.at).toBe(iso(NOW));
    expect(found?.by?.accountId).toBe(viceAccount);
    // The kit's Academic Vice Principal has no staff record: a login and no name.
    expect(found?.by?.login).toEqual(expect.any(String));
    expect(found?.by?.name).toBeNull();
    expect(found?.person.name).toBe('Rahimova Nodira');
    expect(found?.emailChangedBy).toBeNull();
    const { students } = await scene(t.north);
    expect(
      found?.entries.map((line) => ({
        at: line.changedAt,
        student: line.student?.id,
        before: line.before,
        after: line.after,
        attendance: line.attendance,
        how: line.changedHow,
        subject: line.lesson?.subject.en,
      })),
    ).toEqual([
      {
        at: iso(at('2026-11-02', '13:00')),
        student: students[0],
        before: 1,
        after: 2,
        attendance: true,
        how: 'entry',
        subject: expect.any(String) as unknown,
      },
      {
        at: iso(at('2026-11-04', '11:59')),
        student: students[1],
        before: null,
        after: 1,
        attendance: true,
        how: 'entry',
        subject: expect.any(String) as unknown,
      },
    ]);

    // The Principal and the Academic Vice Principal of the branch read the same lines.
    for (const cookie of [t.principal, t.vicePrincipal]) {
      const [read] = resetOf(
        ok(await report(t.north, '2026-11-02', '2026-11-02', cookie)),
        teacher.accountId,
      );
      expect(read?.entries.map((line) => line.id)).toEqual(found?.entries.map((line) => line.id));
    }
    // The colleague's account had no reset: not listed.
    expect(
      resetOf(ok(await report(t.north, '2026-11-02', '2026-11-02')), colleague.accountId),
    ).toEqual([]);
  });

  it('lists the re-hire password and the email reset, and marks the reset after an edit of the email', async () => {
    const rehired = await classes().person(t.north, ['uz']);
    const edited = await classes().person(t.north, ['uz']);
    const created = await classes().person(t.north, ['uz']);
    const lessonId = await lesson(t.north);
    await entry({
      branch: null,
      action: 'account.rehire_password',
      at: at('2026-10-20', '09:00'),
      actor: adminAccount,
      record: { type: 'account', id: rehired.accountId },
    });
    await mark({
      branch: t.north,
      accountId: rehired.accountId,
      lessonId,
      at: at('2026-10-20', '10:00'),
    });
    // The email of `edited` was edited by the Super Admin; that of `created`
    // was given only when the record was created.
    await entry({
      branch: t.north,
      action: 'staff.edit',
      at: at('2026-10-20', '08:00'),
      actor: adminAccount,
      person: edited.staffId,
      record: { type: 'staff', id: edited.staffId },
      newValue: { email: 'n.ergasheva@example.uz' },
    });
    await entry({
      branch: null,
      action: 'auth.password_reset_by_email',
      at: at('2026-10-20', '11:00'),
      actor: edited.accountId,
      record: { type: 'account', id: edited.accountId },
      details: {
        endedSessions: 0,
        lastEmailChange: { by: adminAccount, at: iso(at('2026-10-20', '08:00')) },
      },
    });
    await entry({
      branch: t.north,
      action: 'staff.create',
      at: at('2026-10-01', '08:00'),
      actor: adminAccount,
      person: created.staffId,
      record: { type: 'staff', id: created.staffId },
      newValue: { email: 'k.qodirov@example.uz' },
    });
    await entry({
      branch: null,
      action: 'auth.password_reset_by_email',
      at: at('2026-10-20', '12:00'),
      actor: created.accountId,
      record: { type: 'account', id: created.accountId },
      details: {
        endedSessions: 0,
        lastEmailChange: { by: adminAccount, at: iso(at('2026-10-01', '08:00')) },
      },
    });
    const answer = ok(await report(t.north, '2026-10-20', '2026-10-20', t.vicePrincipal));
    const [rehire] = resetOf(answer, rehired.accountId);
    expect(rehire?.kind).toBe('rehire');
    expect(rehire?.entries).toHaveLength(1);
    const [byEmail] = resetOf(answer, edited.accountId);
    expect(byEmail?.kind).toBe('email');
    // The mark's actor and moment are the reset entry's own `lastEmailChange` (correction 2).
    expect(byEmail?.emailChangedBy).toMatchObject({
      accountId: adminAccount,
      at: iso(at('2026-10-20', '08:00')),
    });
    const [plain] = resetOf(answer, created.accountId);
    expect(plain?.kind).toBe('email');
    expect(plain?.emailChangedBy).toBeNull();
    expect(answer.resets.map((reset) => reset.at)).toEqual(
      [...answer.resets.map((reset) => reset.at)].sort().reverse(),
    );
  });

  it('lists a reset written in another branch with the entries of the branch of the request only', async () => {
    const shared = await classes().person(t.north, ['uz'], { further: [t.south] });
    const southOnly = await classes().person(t.south, ['uz']);
    const northLesson = await lesson(t.north, '2026-10-13');
    const southLesson = await lesson(t.south, '2026-10-13');
    await entry({
      branch: t.south,
      action: 'account.password_reset',
      at: at('2026-10-21', '09:00'),
      actor: adminAccount,
      record: { type: 'account', id: shared.accountId },
    });
    await entry({
      branch: t.south,
      action: 'account.password_reset',
      at: at('2026-10-21', '09:30'),
      actor: adminAccount,
      record: { type: 'account', id: southOnly.accountId },
    });
    await mark({
      branch: t.north,
      accountId: shared.accountId,
      lessonId: northLesson,
      at: at('2026-10-21', '10:00'),
    });
    await mark({
      branch: t.south,
      accountId: shared.accountId,
      lessonId: southLesson,
      at: at('2026-10-21', '11:00'),
    });
    const north = ok(await report(t.north, '2026-10-21', '2026-10-21', t.principal));
    const [inNorth] = resetOf(north, shared.accountId);
    expect(inNorth?.entries.map((line) => line.changedAt)).toEqual([
      iso(at('2026-10-21', '10:00')),
    ]);
    expect(resetOf(north, southOnly.accountId)).toEqual([]);
    const south = ok(await report(t.south, '2026-10-21', '2026-10-21'));
    const [inSouth] = resetOf(south, shared.accountId);
    expect(inSouth?.entries.map((line) => line.changedAt)).toEqual([
      iso(at('2026-10-21', '11:00')),
    ]);
    expect(resetOf(south, southOnly.accountId)).toHaveLength(1);
  });

  // Task 8.1 (From 6.1c): the total and "not held" lines the account wrote within the 48 hours.
  it('lists the totals and "not held" marks the account set within the 48 hours, and none after', async () => {
    const person = await classes().person(t.north, ['uz']);
    const lessonId = await lesson(t.north, '2026-10-14');
    await entry({
      branch: t.north,
      action: 'account.password_reset',
      at: at('2026-10-22', '09:00'),
      actor: adminAccount,
      record: { type: 'account', id: person.accountId },
    });
    const total = async (moment: string, values: { total?: number; not_held?: boolean }) => {
      t.clock.set(moment);
      await t.app.get(Transactions).run([t.north], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: t.north,
          actorId: person.accountId,
          action: 'journal.work_total',
        });
        const existing = await transaction
          .selectFrom('journal_works')
          .select('id')
          .where('lesson_id', '=', lessonId)
          .executeTakeFirst();
        const id =
          existing?.id ??
          (
            await transaction
              .insertInto('journal_works')
              .values({
                branch_id: t.north,
                lesson_id: lessonId,
                source_lesson_id: lessonId,
                kind: 'classwork',
                changed_by: person.accountId,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        await transaction
          .updateTable('journal_works')
          .set({ ...values, changed_by: person.accountId })
          .where('id', '=', id)
          .execute();
      });
      t.clock.set(NOW);
    };
    await total(at('2026-10-22', '10:00'), { total: 30 });
    await total(at('2026-10-23', '11:00'), { not_held: true });
    await total(at('2026-10-24', '10:00'), { total: 20 });
    // A total the account set in another branch within the 48 hours is not this branch's.
    const southLesson = await lesson(t.south, '2026-10-14');
    t.clock.set(at('2026-10-22', '11:00'));
    await t.app.get(Transactions).run([t.south], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: t.south,
        actorId: person.accountId,
        action: 'journal.work_total',
      });
      const row = await transaction
        .insertInto('journal_works')
        .values({
          branch_id: t.south,
          lesson_id: southLesson,
          source_lesson_id: southLesson,
          kind: 'classwork',
          changed_by: person.accountId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('journal_works')
        .set({ total: 40, changed_by: person.accountId })
        .where('id', '=', row.id)
        .execute();
    });
    t.clock.set(NOW);
    const answer = ok(await report(t.north, '2026-10-22', '2026-10-22'));
    const [reset] = resetOf(answer, person.accountId);
    expect(
      reset?.workEntries.map((line) => [line.totalBefore, line.totalAfter, line.notHeldAfter]),
    ).toEqual([
      [null, 30, false],
      [30, 30, true],
    ]);
    expect(reset?.workEntries[0]?.lesson?.date).toBe('2026-10-14');
  });

  // Task 8.2 (From 6.1c; decision 12): the rating entries and comments of the 48 hours.
  it('lists the rating entries and comments the account wrote within the 48 hours', async () => {
    const person = await classes().person(t.north, ['uz']);
    const lessonId = await lesson(t.north, '2026-10-14');
    const { classId, year, students } = await scene(t.north);
    await entry({
      branch: t.north,
      action: 'account.password_reset',
      at: at('2026-10-22', '09:00'),
      actor: adminAccount,
      record: { type: 'account', id: person.accountId },
    });
    await ratingEntryAndNote(t, cells.lessons.load, {
      branch: t.north,
      year,
      classId,
      lessonId,
      studentId: students[1] ?? '',
      accountId: person.accountId,
      at: at('2026-10-22', '10:00'),
      examDate: '2026-10-12',
    });
    // The same account writes in another branch within the 48 hours: not this branch's.
    const south = await scene(t.south);
    await ratingEntryAndNote(t, cells.lessons.load, {
      branch: t.south,
      year: south.year,
      classId: south.classId,
      lessonId: await lesson(t.south, '2026-10-14'),
      studentId: south.students[0] ?? '',
      accountId: person.accountId,
      at: at('2026-10-22', '11:00'),
      examDate: '2026-10-12',
    });
    t.clock.set(NOW);
    const answer = ok(await report(t.north, '2026-10-22', '2026-10-22'));
    const [reset] = resetOf(answer, person.accountId);
    expect(reset?.ratingEntries.map((line) => [line.studentId, line.after])).toEqual([
      [students[1], { kind: 'score', score: 77 }],
    ]);
    expect(
      reset?.commentEntries.map((line) => [line.target, line.bodyAfter, line.lesson?.date]),
    ).toEqual([['note', 'Helped a classmate', '2026-10-14']]);
  });

  it('keeps a reset and its entries after the branch link is taken off', async () => {
    const moved = await classes().person(t.south, ['uz'], { further: [t.north] });
    const lessonId = await lesson(t.north, '2026-10-13');
    await entry({
      branch: t.south,
      action: 'account.password_reset',
      at: at('2026-10-22', '09:00'),
      actor: adminAccount,
      record: { type: 'account', id: moved.accountId },
    });
    await mark({
      branch: t.north,
      accountId: moved.accountId,
      lessonId,
      at: at('2026-10-22', '10:00'),
    });
    await t.database.migrator
      .deleteFrom('staff_branches')
      .where('staff_id', '=', moved.staffId)
      .where('branch_id', '=', t.north)
      .execute();
    const [kept] = resetOf(ok(await report(t.north, '2026-10-22', '2026-10-22')), moved.accountId);
    expect(kept?.entries.map((line) => line.changedAt)).toEqual([iso(at('2026-10-22', '10:00'))]);
  });

  it('takes the resets of the range in branch time, each with its 48 hours past the range', async () => {
    const late = await classes().person(t.north, ['uz']);
    const lessonId = await lesson(t.north, '2026-10-13');
    await entry({
      branch: t.north,
      action: 'account.password_reset',
      at: at('2026-10-27', '23:30'),
      actor: adminAccount,
      record: { type: 'account', id: late.accountId },
    });
    await entry({
      branch: t.north,
      action: 'account.password_reset',
      at: at('2026-10-28', '00:30'),
      actor: adminAccount,
      record: { type: 'account', id: late.accountId },
    });
    await mark({
      branch: t.north,
      accountId: late.accountId,
      lessonId,
      at: at('2026-10-28', '01:00'),
    });
    const resets = resetOf(ok(await report(t.north, '2026-10-27', '2026-10-27')), late.accountId);
    expect(resets.map((reset) => reset.at)).toEqual([iso(at('2026-10-27', '23:30'))]);
    expect(resets[0]?.entries.map((line) => line.changedAt)).toEqual([
      iso(at('2026-10-28', '01:00')),
    ]);
  });

  it('refuses a range that ends before it begins or is longer than 366 days', async () => {
    expect(errorCode(await report(t.north, '2026-10-12', '2026-10-11'))).toBe('validation_failed');
    expect(errorCode(await report(t.north, '2025-10-01', '2026-10-12'))).toBe('validation_failed');
    const onlyTo = await t.get('/api/people/accounts/reset-entries?to=2026-10-12', t.north);
    expect(ok(onlyTo).from).toBe('2026-09-13');
  });

  // Decision 3: the second-step reset writes the administrator's reset too.
  it('lists the second-step reset as a reset by an administrator', async () => {
    const browser = await t.kit.completeSession('Zarina', 'Hamidova');
    const person = await classes().person(t.north, ['uz'], { accountId: browser.account.id });
    const response = await t.post(
      `/api/people/staff/${person.staffId}/account/second-step-reset`,
      t.north,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const resets = resetOf(
      ok(await report(t.north, '2026-11-02', '2026-11-02')),
      browser.account.id,
    );
    expect(resets.map((reset) => [reset.kind, reset.at, reset.by?.accountId])).toEqual([
      ['administrator', iso(NOW), adminAccount],
    ]);
  });

  it('refuses a Teacher, a Tutor and a Head Teacher of the branch', async () => {
    const tutor = await t.kit.fullSession('Shahlo', 'Nazarova');
    await t.kit.giveRole(tutor.account.id, { role: 'tutor', branchId: t.north });
    const head = await t.kit.fullSession('Ulugbek', 'Sobirov');
    await t.kit.giveRole(head.account.id, { role: 'head_teacher', branchId: t.north });
    for (const cookie of [t.teacher, tutor.cookie, head.cookie]) {
      const response = await report(t.north, '2026-11-02', '2026-11-02', cookie);
      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('permission_denied');
    }
  });

  // A vacancy holds no account (`staff_vacancy_check`, 0024), so the join's
  // `kind = 'person'` can be reached by no fixture; the answer's columns are
  // held here: ids, kinds and moments only (decision 1).
  it('answers through password_resets_of_branch ids, kinds and moments only', async () => {
    const own = await classes().person(t.north, ['uz']);
    await entry({
      branch: t.north,
      action: 'account.password_reset',
      at: at('2026-10-30', '09:00'),
      actor: adminAccount,
      record: { type: 'account', id: own.accountId },
    });
    const columns = await t.app.get(Transactions).run(
      [t.north],
      async (transaction) =>
        (
          await sql<Record<string, unknown>>`
          select * from password_resets_of_branch(
            ${t.north}::uuid,
            ${iso(at('2026-10-30', '00:00'))}::timestamptz,
            ${iso(at('2026-10-31', '00:00'))}::timestamptz
          )
        `.execute(transaction)
        ).rows,
    );
    expect(columns).toHaveLength(1);
    expect(Object.keys(columns[0] ?? {}).sort()).toEqual([
      'account_id',
      'actor_id',
      'email_change_action',
      'email_change_at',
      'email_change_by',
      'entry_id',
      'kind',
      'occurred_at',
    ]);
  });
});
