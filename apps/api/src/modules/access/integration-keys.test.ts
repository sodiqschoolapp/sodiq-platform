import { createHash } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import {
  INTEGRATION_KEY_SECRET_FORMAT,
  integrationKeyChoicesSchema,
  integrationKeyCreatedSchema,
  integrationKeyListSchema,
  integrationKeySchema,
  type IntegrationKey,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../database/database.js';
import { ShippingLogger } from '../../monitoring/monitoring.service.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { LoadKit } from '../../testing/load-kit.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

// Task 10.9 (pull request #368; the owner's spec change of 21 November 2026). `02`, Integration
// keys: "The Super Admin creates a key with a name ..., a list of people and an end date at most
// one year ahead. Each person on the list holds the Teacher, Head Teacher or Senior Head Teacher
// role. ... The secret is shown once ... and is stored only as a hash. Only the Super Admin
// creates keys, changes their people and end date, and revokes them." The harness
// (`route-access-list.ts`) tries every other role; all names and secrets are invented.

// 00:30 in Tashkent is still 20 November in UTC: "today" is the school's day (decision 5).
const NOW = '2026-11-21T00:30:00+05:00';
const TODAY = '2026-11-21';
const LATEST = '2027-11-21';
const UNKNOWN = '0199a000-0000-7000-8000-000000000999';

/** The request id of each labelled answer, as the answer header gives it. */
const ids: Record<string, string> = {};

const ok = (response: Response, status = 200, label?: string): unknown => {
  expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(status);
  if (label !== undefined) ids[label] = String(response.headers['x-request-id']);
  return response.body;
};

const refused = (response: Response, status: number, code: string): void => {
  expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('integration keys: the keys and the Super Admin page', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let server: Parameters<typeof request>[0];
  let admin: string;
  let adminAccount: string;
  let adminAssignment: string;
  let north: string;
  let south: string;
  let people: ClassesKit;
  const clock = new FixedClock(NOW);
  let keyNames = 0;

  /** A person of a branch with a role in it (or a Senior Head Teacher, of every branch). */
  async function person(
    branch: string,
    role: 'teacher' | 'head_teacher' | 'senior_head_teacher' | 'tutor' | 'principal' | null,
    last: string,
  ): Promise<{ staffId: string; accountId: string; assignmentId: string | null }> {
    const made = await people.person(branch, ['uz'], { first: 'Malika', last });
    const assignment =
      role === null
        ? null
        : await kit.giveRole(made.accountId, {
            role,
            ...(role === 'senior_head_teacher' ? {} : { branchId: branch }),
          });
    return { ...made, assignmentId: assignment?.id ?? null };
  }

  const name = (): string => {
    keyNames += 1;
    return `Platform ${String(keyNames)}`;
  };

  const create = (body: unknown, cookie = admin) =>
    request(server)
      .post('/api/integration-keys')
      .set('Cookie', cookie)
      .send(body as object);
  const putPeople = (id: string, staffRecordIds: string[], cookie = admin) =>
    request(server)
      .put(`/api/integration-keys/${id}/people`)
      .set('Cookie', cookie)
      .send({ staffRecordIds });
  const putEnd = (id: string, endsOn: string, cookie = admin) =>
    request(server)
      .put(`/api/integration-keys/${id}/end-date`)
      .set('Cookie', cookie)
      .send({ endsOn });
  const revoke = (id: string, cookie = admin) =>
    request(server).post(`/api/integration-keys/${id}/revoke`).set('Cookie', cookie).send({});

  const list = async () =>
    integrationKeyListSchema.parse(ok(await kit.get('/api/integration-keys', admin)));
  const listed = async (id: string): Promise<IntegrationKey | undefined> =>
    (await list()).keys.find((key) => key.id === id);

  async function created(staffRecordIds: string[], endsOn = LATEST) {
    return integrationKeyCreatedSchema.parse(
      ok(await create({ name: name(), staffRecordIds, endsOn }), 201),
    );
  }

  const keyRows = () =>
    database.migrator.selectFrom('integration_keys').selectAll().orderBy('id').execute();
  const peopleRows = () =>
    database.migrator.selectFrom('integration_key_people').selectAll().orderBy('id').execute();
  const entries = (recordId?: string) => {
    let query = database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', 'like', 'integration_key.%')
      .orderBy('occurred_at')
      .orderBy('id');
    if (recordId !== undefined) query = query.where('record_id', '=', recordId);
    return query.execute();
  };
  const everything = async () => ({
    keys: await keyRows(),
    people: await peopleRows(),
    entries: await entries(),
  });

  /** The backend of a held connection. */
  const pidOf = async (connection: Database): Promise<number> =>
    (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(connection)).rows[0]?.pid ??
    0;

  /** Whether a request of this test database waits on the held backend (up to 5 s). */
  async function waitsOn(pid: number): Promise<boolean> {
    for (let i = 0; i < 200; i += 1) {
      const blocked = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and ${pid}::int = any(pg_blocking_pids(pid))
      `.execute(database.migrator);
      if ((blocked.rows[0]?.n ?? 0) > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  let teacher: Awaited<ReturnType<typeof person>>;
  let headTeacher: Awaited<ReturnType<typeof person>>;
  let senior: Awaited<ReturnType<typeof person>>;

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    app = await createTestApp({ database: database.app, clock });
    kit = signInKit(app);
    server = app.getHttpServer() as Parameters<typeof request>[0];
    people = new ClassesKit(database.migrator);
    const browser = await kit.completeSession('Dilnoza', 'Karimova');
    adminAssignment = (await kit.giveRole(browser.account.id, { role: 'super_admin' })).id;
    admin = browser.cookie;
    adminAccount = browser.account.id;
    teacher = await person(north, 'teacher', 'Teacherova');
    headTeacher = await person(south, 'head_teacher', 'Headova');
    senior = await person(north, 'senior_head_teacher', 'Seniorova');
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('shows the secret once and stores only its hash (`02`: "shown once ... stored only as a hash")', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    Logger.overrideLogger(new ShippingLogger());
    ShippingLogger.sink = (_level, text) => {
      lines.push(text);
    };
    let answer: ReturnType<typeof integrationKeyCreatedSchema.parse>;
    try {
      answer = await created([teacher.staffId]);
    } finally {
      ShippingLogger.sink = undefined;
      vi.restoreAllMocks();
    }
    expect(answer.secret).toMatch(INTEGRATION_KEY_SECRET_FORMAT);
    // The table holds the hash and nowhere the secret.
    const stored = await database.migrator
      .selectFrom('integration_keys')
      .selectAll()
      .where('id', '=', answer.key.id)
      .executeTakeFirstOrThrow();
    expect(stored.secret_hash).toBe(sha256(answer.secret));
    expect(JSON.stringify(stored)).not.toContain(answer.secret);
    expect(JSON.stringify(await peopleRows())).not.toContain(answer.secret);
    // Neither the secret nor its hash is in the audit log or a log line.
    const audit = JSON.stringify(
      (await sql`select * from audit_log_school`.execute(database.migrator)).rows,
    );
    expect(audit).not.toContain(answer.secret);
    expect(audit).not.toContain(stored.secret_hash);
    expect(lines.join('\n')).not.toContain(answer.secret);
    // No answer reads it again.
    const read = await kit.get('/api/integration-keys', admin);
    expect(JSON.stringify(read.body)).not.toContain(answer.secret);
    expect(JSON.stringify(read.body)).not.toContain(stored.secret_hash);
    const again = await revoke(answer.key.id);
    expect(JSON.stringify(again.body)).not.toContain(answer.secret);
    // Two keys never share a secret.
    const other = await created([teacher.staffId]);
    expect(other.secret).not.toBe(answer.secret);
  });

  it('lists a key with its name, people, end date, last use and state, and audits the create', async () => {
    const keyName = name();
    const answer = integrationKeyCreatedSchema.parse(
      ok(
        await create({
          name: `  ${keyName} `,
          staffRecordIds: [teacher.staffId, headTeacher.staffId, senior.staffId],
          endsOn: TODAY,
        }),
        201,
        'create',
      ),
    );
    const key = await listed(answer.key.id);
    expect(key).toMatchObject({
      name: keyName,
      endsOn: TODAY,
      state: 'active',
      revokedAt: null,
      lastUsedAt: null,
    });
    // People of two branches and a Senior Head Teacher with none (decision 2).
    expect(key?.people.map((one) => [one.lastName, one.holdsKeyRole]).sort()).toEqual([
      ['Headova', true],
      ['Seniorova', true],
      ['Teacherova', true],
    ]);
    expect(key?.people.every((one) => /^S-\d{6}$/.test(one.staffId))).toBe(true);
    const [entry, ...more] = await entries(answer.key.id);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      action: 'integration_key.create',
      actor_id: adminAccount,
      assignment_id: adminAssignment,
      request_id: ids.create,
      record_type: 'integration_key',
      new_value: {
        name: keyName,
        endsOn: TODAY,
        staffRecordIds: [teacher.staffId, headTeacher.staffId, senior.staffId].sort(),
      },
    });
    const all = await list();
    expect(all.today).toBe(TODAY);
    expect(all.latestEndsOn).toBe(LATEST);
  });

  it('offers as choices the people of every branch who hold a key role, and nobody else', async () => {
    const tutor = await person(north, 'tutor', 'Tutorova');
    const choices = integrationKeyChoicesSchema.parse(
      ok(await kit.get('/api/integration-keys/choices', admin)),
    );
    const ids = choices.people.map((one) => one.staffRecordId);
    expect(ids).toEqual(
      expect.arrayContaining([teacher.staffId, headTeacher.staffId, senior.staffId]),
    );
    expect(ids).not.toContain(tutor.staffId);
    expect(choices.people.every((one) => one.holdsKeyRole)).toBe(true);
  });

  describe('refuses a person who may not be put on a key', () => {
    it('on create and on a people change, naming each one, and writes nothing', async () => {
      // A Tutor only (`edge/people-roles-accounts`: "Tutor work is done in this platform"), a
      // Principal, a Teacher whose role ended, an inactive Teacher, a locked Teacher (correction
      // 1 of the plan review) and a person with no account.
      const tutor = await person(north, 'tutor', 'Tutorovb');
      const principal = await person(south, 'principal', 'Principalova');
      const ended = await person(north, 'teacher', 'Endedova');
      await kit.endRole(ended.assignmentId ?? '', adminAccount, north);
      const inactive = await person(north, 'teacher', 'Inactivova');
      await database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2026-11-20' })
        .where('staff_id', '=', inactive.staffId)
        .execute();
      await database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: inactive.staffId, status: 'inactive', valid_from: '2026-11-20' })
        .execute();
      const locked = await person(north, 'teacher', 'Lockedova');
      await database.migrator
        .updateTable('accounts')
        .set({
          locked_at: new Date('2026-11-20T10:00:00+05:00'),
          locked_by: adminAccount,
          lock_reason: 'Left the school',
        })
        .where('id', '=', locked.accountId)
        .execute();
      const noAccount = await people.person(north, ['uz'], {
        last: 'Accountless',
        noAccount: true,
      });

      // A vacancy (a staff record with no staff ID and no account, `04`, Vacancy).
      const vacancy = { id: await new LoadKit(database.migrator).vacancy(north) };
      const key = await created([teacher.staffId]);
      for (const one of [
        tutor,
        principal,
        ended,
        inactive,
        locked,
        noAccount,
        { staffId: vacancy.id },
      ]) {
        const before = await everything();
        const answer = await create({
          name: name(),
          staffRecordIds: [teacher.staffId, one.staffId],
          endsOn: LATEST,
        });
        refused(answer, 422, 'integration_key_person_refused');
        const body = answer.body as { error: { details: { recordId: string }[] } };
        expect(body.error.details.map((detail) => detail.recordId)).toEqual([one.staffId]);
        refused(
          await putPeople(key.key.id, [teacher.staffId, one.staffId]),
          422,
          'integration_key_person_refused',
        );
        expect(await everything()).toEqual(before);
      }
    });

    it('answers 404 for an unknown staff record on create and on a people change, and writes nothing', async () => {
      const key = await created([teacher.staffId]);
      const before = await everything();
      refused(
        await create({ name: name(), staffRecordIds: [UNKNOWN], endsOn: LATEST }),
        404,
        'not_found',
      );
      refused(await putPeople(key.key.id, [teacher.staffId, UNKNOWN]), 404, 'not_found');
      expect(await everything()).toEqual(before);
    });
  });

  it('takes an end date from today to one year ahead in Tashkent, and refuses the others', async () => {
    // 00:30 in Tashkent: 20 November is yesterday, though it is still 20 November in UTC.
    for (const [endsOn, allowed] of [
      [TODAY, true],
      [LATEST, true],
      ['2026-11-20', false],
      ['2027-11-22', false],
    ] as const) {
      const before = await everything();
      const answer = await create({ name: name(), staffRecordIds: [teacher.staffId], endsOn });
      if (allowed) {
        expect(answer.status, endsOn).toBe(201);
      } else {
        refused(answer, 422, 'integration_key_end_refused');
        expect(await everything()).toEqual(before);
      }
    }
    // The stored moment is the start of the next day in Tashkent.
    const key = await created([teacher.staffId], TODAY);
    const row = (await keyRows()).find((one) => one.id === key.key.id);
    expect(row?.ends_at.toISOString()).toBe('2026-11-21T19:00:00.000Z');
  });

  it('changes the end date with an entry, refuses one out of bounds, and writes nothing for the same date', async () => {
    const key = await created([teacher.staffId]);
    integrationKeySchema.parse(ok(await putEnd(key.key.id, '2027-06-30'), 200, 'end'));
    expect((await listed(key.key.id))?.endsOn).toBe('2027-06-30');
    const [, entry] = await entries(key.key.id);
    expect(entry).toMatchObject({
      action: 'integration_key.end_date_changed',
      assignment_id: adminAssignment,
      request_id: ids.end,
      old_value: { endsOn: LATEST },
      new_value: { endsOn: '2027-06-30' },
    });
    const before = await everything();
    ok(await putEnd(key.key.id, '2027-06-30'));
    refused(await putEnd(key.key.id, '2026-11-20'), 422, 'integration_key_end_refused');
    refused(await putEnd(key.key.id, '2027-11-22'), 422, 'integration_key_end_refused');
    expect(await everything()).toEqual(before);
  });

  it('reads a key past its end date as ended from the clock, with no write', async () => {
    const key = await created([teacher.staffId], TODAY);
    expect((await listed(key.key.id))?.state).toBe('active');
    // The stored end moved to yesterday, as if the clock had passed it.
    await database.migrator
      .updateTable('integration_keys')
      .set({ ends_on: '2026-11-20', ends_at: new Date('2026-11-20T19:00:00Z') })
      .where('id', '=', key.key.id)
      .execute();
    expect((await listed(key.key.id))?.state).toBe('ended');
  });

  it('changes the people with one entry; an unchanged list writes nothing', async () => {
    const key = await created([teacher.staffId, headTeacher.staffId]);
    const changed = integrationKeySchema.parse(
      ok(await putPeople(key.key.id, [headTeacher.staffId, senior.staffId]), 200, 'people'),
    );
    expect(changed.people.map((one) => one.staffRecordId).sort()).toEqual(
      [headTeacher.staffId, senior.staffId].sort(),
    );
    // The removed person's row is ended, never deleted (decision 9).
    const rows = (await peopleRows()).filter((row) => row.key_id === key.key.id);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.staff_id === teacher.staffId)?.removed_by).toBe(adminAccount);
    const [, entry] = await entries(key.key.id);
    expect(entry).toMatchObject({
      action: 'integration_key.people_changed',
      assignment_id: adminAssignment,
      request_id: ids.people,
      old_value: { staffRecordIds: [teacher.staffId, headTeacher.staffId].sort() },
      new_value: { staffRecordIds: [headTeacher.staffId, senior.staffId].sort() },
    });
    const before = await everything();
    ok(await putPeople(key.key.id, [senior.staffId, headTeacher.staffId]));
    expect(await everything()).toEqual(before);
    // A person taken off may be put back, on a new row.
    ok(await putPeople(key.key.id, [teacher.staffId, headTeacher.staffId, senior.staffId]));
    expect((await peopleRows()).filter((row) => row.key_id === key.key.id)).toHaveLength(4);
  });

  it('keeps a person who lost the key role on the key, marked (decision 6)', async () => {
    const later = await person(south, 'teacher', 'Laterova');
    const key = await created([later.staffId, teacher.staffId]);
    await kit.endRole(later.assignmentId ?? '', adminAccount, south);
    const before = await everything();
    const read = await listed(key.key.id);
    expect(read?.people.find((one) => one.staffRecordId === later.staffId)?.holdsKeyRole).toBe(
      false,
    );
    expect(read?.people.find((one) => one.staffRecordId === teacher.staffId)?.holdsKeyRole).toBe(
      true,
    );
    // A people change that keeps them does not check them again.
    ok(await putPeople(key.key.id, [later.staffId, teacher.staffId, senior.staffId]));
    expect((await listed(key.key.id))?.people).toHaveLength(3);
    expect((await everything()).keys).toEqual(before.keys);
  });

  it('revokes a key for good: listed as revoked, one entry, nothing changes it and nothing restores it', async () => {
    const key = await created([teacher.staffId]);
    const answer = integrationKeySchema.parse(ok(await revoke(key.key.id), 200, 'revoke'));
    expect(answer.state).toBe('revoked');
    expect((await listed(key.key.id))?.state).toBe('revoked');
    const [, entry, ...more] = await entries(key.key.id);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      action: 'integration_key.revoke',
      assignment_id: adminAssignment,
      request_id: ids.revoke,
    });
    const before = await everything();
    expect(integrationKeySchema.parse(ok(await revoke(key.key.id))).state).toBe('revoked');
    refused(await putPeople(key.key.id, [headTeacher.staffId]), 409, 'integration_key_revoked');
    refused(await putEnd(key.key.id, TODAY), 409, 'integration_key_revoked');
    expect(await everything()).toEqual(before);
    // Its name may be used again by a new key.
    const reused = await create({
      name: key.key.name,
      staffRecordIds: [teacher.staffId],
      endsOn: LATEST,
    });
    expect(reused.status).toBe(201);
  });

  it('refuses a second key of the same name, in another case, while the first is not revoked', async () => {
    const key = await created([teacher.staffId]);
    const before = await everything();
    const answer = await create({
      name: key.key.name.toUpperCase(),
      staffRecordIds: [teacher.staffId],
      endsOn: LATEST,
    });
    refused(answer, 409, 'already_exists');
    expect((answer.body as { error: { details: { path: string }[] } }).error.details[0]?.path).toBe(
      'name',
    );
    expect(await everything()).toEqual(before);
  });

  it('refuses two creates of one name at the same moment: one 201, one already_exists', async () => {
    const keyName = name();
    const answers = await Promise.all([
      create({ name: keyName, staffRecordIds: [teacher.staffId], endsOn: LATEST }),
      create({ name: keyName, staffRecordIds: [headTeacher.staffId], endsOn: LATEST }),
    ]);
    expect(answers.map((one) => one.status).sort()).toEqual([201, 409]);
    const loser = answers.find((one) => one.status === 409);
    expect(loser === undefined ? undefined : errorCode(loser)).toBe('already_exists');
    expect((await keyRows()).filter((row) => row.name === keyName)).toHaveLength(1);
  });

  it('answers 404 for an unknown key on each route, and writes nothing', async () => {
    await created([teacher.staffId]);
    const before = await everything();
    refused(await putPeople(UNKNOWN, [teacher.staffId]), 404, 'not_found');
    refused(await putEnd(UNKNOWN, LATEST), 404, 'not_found');
    refused(await revoke(UNKNOWN), 404, 'not_found');
    expect(await everything()).toEqual(before);
  });

  it('refuses every route to a Teacher and a Principal, and writes nothing', async () => {
    const key = await created([teacher.staffId]);
    for (const role of ['teacher', 'principal'] as const) {
      const browser = await kit.completeSession('Aziza', `Refused${role}`);
      await kit.giveRole(browser.account.id, { role, branchId: north });
      const before = await everything();
      refused(await kit.get('/api/integration-keys', browser.cookie), 403, 'permission_denied');
      refused(
        await kit.get('/api/integration-keys/choices', browser.cookie),
        403,
        'permission_denied',
      );
      refused(
        await create(
          { name: name(), staffRecordIds: [teacher.staffId], endsOn: LATEST },
          browser.cookie,
        ),
        403,
        'permission_denied',
      );
      refused(
        await putPeople(key.key.id, [headTeacher.staffId], browser.cookie),
        403,
        'permission_denied',
      );
      refused(await putEnd(key.key.id, TODAY, browser.cookie), 403, 'permission_denied');
      refused(await revoke(key.key.id, browser.cookie), 403, 'permission_denied');
      expect(await everything()).toEqual(before);
    }
  });

  describe('a revoke and a people change at the same moment', () => {
    it('the revoke held after its write: the people change waits and is refused integration_key_revoked', async () => {
      const key = await created([teacher.staffId]);
      await database.app.connection().execute(async (held) => {
        await sql`begin`.execute(held);
        const pid = await pidOf(held);
        await sql`select id from integration_keys where id = ${key.key.id} for update`.execute(
          held,
        );
        await held
          .updateTable('integration_keys')
          .set({ revoked_at: clock.now(), revoked_by: adminAccount })
          .where('id', '=', key.key.id)
          .execute();
        const waiting = new Promise<Response>((resolve, reject) => {
          putPeople(key.key.id, [teacher.staffId, headTeacher.staffId]).then(resolve, reject);
        });
        expect(await waitsOn(pid)).toBe(true);
        await sql`commit`.execute(held);
        refused(await waiting, 409, 'integration_key_revoked');
      });
      expect((await peopleRows()).filter((row) => row.key_id === key.key.id)).toHaveLength(1);
    });

    it('the people change held after its writes: the revoke waits, then revokes with the new people kept', async () => {
      const key = await created([teacher.staffId]);
      await database.app.connection().execute(async (held) => {
        await sql`begin`.execute(held);
        const pid = await pidOf(held);
        await sql`select id from integration_keys where id = ${key.key.id} for update`.execute(
          held,
        );
        await held
          .insertInto('integration_key_people')
          .values({
            key_id: key.key.id,
            staff_id: headTeacher.staffId,
            added_at: clock.now(),
            added_by: adminAccount,
          })
          .execute();
        const waiting = new Promise<Response>((resolve, reject) => {
          revoke(key.key.id).then(resolve, reject);
        });
        expect(await waitsOn(pid)).toBe(true);
        await sql`commit`.execute(held);
        const answer = integrationKeySchema.parse(ok(await waiting));
        expect(answer.state).toBe('revoked');
        expect(answer.people.map((one) => one.staffRecordId).sort()).toEqual(
          [teacher.staffId, headTeacher.staffId].sort(),
        );
      });
    });
  });
});
