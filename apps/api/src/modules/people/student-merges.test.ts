import {
  studentDetailSchema,
  studentHistorySchema,
  studentMergePreviewSchema,
  studentMergeResultSchema,
  type StudentDetail,
  type StudentMergePreview,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { MembersKit, moveStudentBranch } from '../../testing/members-kit.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

// All names are invented. edge/students-classes-groups, "A student who left
// in 2025 is created again as new": "The Super Admin can merge two records;
// the older UID survives"; "A student is created twice by mistake ... 'leave'
// or the merge is used"; "Two people move the same student at the same
// moment. The second one gets 'student changed, reload'". Task 3.3d, pull
// request #98 with corrections 1 to 5 of its review. The clock stands at
// 23:55 on Saturday 10 October 2026 in Tashkent.
describe('the merge of two student records', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let northYear: string;
  let southYear: string;
  let members: MembersKit;
  let tutor: string;
  let headTeacher: string;
  let count = 0;

  /** A new student's body: grade 7, from the date given, in the class named. */
  function body(
    classId: string,
    startsOn: string,
    fields: Record<string, unknown> = {},
  ): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2609500 + count),
      confirmUidSet: true,
      firstName: 'Nodira',
      lastName: `Saidova${'s'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: '2013-04-11',
      grade: 7,
      startsOn,
      documentType: null,
      documentNumber: null,
      jshshir: null,
      phone: null,
      email: null,
      address: null,
      region: null,
      previousSchool: null,
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `MG-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      classId,
      ...fields,
    };
  }

  /**
   * A student of a new 7th class of the branch from the date given; the
   * clock moves on a second after each, so that each UID is held later than
   * the one before (decision 3).
   */
  async function pupil(
    input: { branch?: string; from?: string; fields?: Record<string, unknown> } = {},
  ): Promise<StudentDetail> {
    const branch = input.branch ?? t.north;
    const year = branch === t.north ? northYear : southYear;
    const own = await classes.schoolClass(branch, year, { grade: 7 });
    const response = await t.post(
      '/api/people/students',
      branch,
      body(own, input.from ?? '2026-09-02', input.fields),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    t.clock.advance(1000);
    return studentDetailSchema.parse(response.body);
  }

  const fresh = async (id: string, branch = t.north): Promise<StudentDetail> => {
    const response = await t.get(`/api/people/students/${id}`, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentDetailSchema.parse(response.body);
  };

  /** A leaving by the Super Admin, the last day given. */
  async function leave(id: string, lastDay: string, branch = t.north): Promise<void> {
    const response = await t.post(`/api/people/students/${id}/leaving`, branch, {
      lastDay,
      reason: 'Moved to another city',
      version: (await fresh(id, branch)).version,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }

  const preview = (id: string, uid: string, branch = t.north, cookie?: string) =>
    t.get(`/api/people/students/${id}/merge?uid=${uid}`, branch, cookie);

  const previewOf = async (id: string, uid: string, branch = t.north) => {
    const response = await preview(id, uid, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentMergePreviewSchema.parse(response.body);
  };

  const post = (id: string, input: object, branch = t.north, cookie?: string) =>
    t.post(`/api/people/students/${id}/merge`, branch, input, cookie);

  /** A merge as the screen sends it: the preview first, then its digest. */
  async function merge(id: string, uid: string, branch = t.north) {
    const seen = await previewOf(id, uid, branch);
    return post(id, { uid, reason: 'Created twice by mistake', digest: seen.digest }, branch);
  }

  const merged = (response: Response) => {
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentMergeResultSchema.parse(response.body);
  };

  /** Every row of the tables a merge writes, in every branch, and the log. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('students').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_merges').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_statuses').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_contracts').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('class_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('group_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_moves').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_branch_moves').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_relatives').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('student_accounts')
        .selectAll()
        .orderBy('student_id')
        .execute(),
      t.database.migrator.selectFrom('student_uids').selectAll().orderBy('uid').execute(),
      t.database.migrator.selectFrom('relatives').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  const statusesOf = (id: string) =>
    t.database.migrator
      .selectFrom('student_statuses')
      .select(['status', 'valid_from', 'valid_until', 'branch_id'])
      .where('student_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  const classRowsOf = (id: string) =>
    t.database.migrator
      .selectFrom('class_memberships')
      .select(['id', 'class_id', 'valid_from', 'valid_until', 'ended_by', 'branch_id'])
      .where('student_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  const exists = async (id: string) =>
    (await t.database.migrator
      .selectFrom('students')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst()) !== undefined;

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /** Runs `work` in a transaction of the application that stays open until released. */
  async function holdOpen(branches: string[], work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = t.app
      .get(Transactions)
      .run(branches, async (transaction) => {
        await work(transaction);
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await Promise.race([isReady, done]);
    return { release, done };
  }

  /**
   * Two real routes in a fixed order (`inOrder` of `class-groups.test.ts`): a
   * third transaction holds a student both lock, the first route waits on
   * it, then the second; the first runs to its commit before the second reads.
   */
  async function inOrder(
    held: string,
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ): Promise<[Response, Response]> {
    const gate = await holdOpen([t.north], async (transaction) => {
      await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', held)
        .forUpdate()
        .execute();
    });
    const one = first().then((response) => response);
    await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
    const two = second().then((response) => response);
    await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(1);
    gate.release();
    expect(await gate.done).toBeUndefined();
    return [await one, await two];
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    // The closed year first: one year of a branch is current at a time.
    await classes.year(t.north, 'closed', '2025-09-01', '2026-05-31');
    northYear = await classes.year(t.north);
    southYear = await classes.year(t.south);
    members = new MembersKit(t.database.migrator, await classes.account());
    const tutorBrowser = await t.kit.completeSession('Sardor', 'Aliyev');
    await t.kit.giveRole(tutorBrowser.account.id, { role: 'tutor', branchId: t.north });
    tutor = tutorBrowser.cookie;
    const headBrowser = await t.kit.completeSession('Kamola', 'Rasulova');
    await t.kit.giveRole(headBrowser.account.id, { role: 'head_teacher', branchId: t.north });
    headTeacher = headBrowser.cookie;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a record created again after leaving (edge: "created again as new")', () => {
    it('keeps the older UID whichever record is in the path, and every row of the other', async () => {
      for (const pathIsOlder of [false, true]) {
        const old = await pupil({ from: '2026-09-02' });
        await leave(old.id, '2026-09-19');
        const again = await pupil({ from: '2026-10-05' });
        const ownRows = await rowsOf();
        const before = {
          statuses: await statusesOf(again.id),
          classRows: await classRowsOf(again.id),
          contracts: await t.database.migrator
            .selectFrom('student_contracts')
            .select('id')
            .where('student_id', '=', again.id)
            .execute(),
        };
        expect(ownRows[0].length).toBeGreaterThan(0);
        const result = merged(
          pathIsOlder ? await merge(old.id, again.uid) : await merge(again.id, old.uid),
        );
        expect(result.student).toMatchObject({
          id: old.id,
          uid: old.uid,
          status: 'active',
          mergedUids: [again.uid],
          startsOn: '2026-09-02',
        });
        expect(result.branch).toEqual({ id: t.north, name: 'North' });
        expect(result.student.class?.id).toBe(before.classRows[0]?.class_id);
        expect(await exists(again.id)).toBe(false);
        refusedWith(await t.get(`/api/people/students/${again.id}`, t.north), 404, 'not_found');
        // The inactive tail cut at the new life's first day; the new life carried.
        expect(await statusesOf(old.id)).toEqual([
          {
            status: 'active',
            valid_from: '2026-09-02',
            valid_until: '2026-09-20',
            branch_id: t.north,
          },
          {
            status: 'inactive',
            valid_from: '2026-09-20',
            valid_until: '2026-10-05',
            branch_id: t.north,
          },
          { status: 'active', valid_from: '2026-10-05', valid_until: null, branch_id: t.north },
        ]);
        // Every row of the merged record is on the kept record (Done when).
        const now = await t.database.migrator
          .selectFrom('student_contracts')
          .select('student_id')
          .where(
            'id',
            'in',
            before.contracts.map((one) => one.id),
          )
          .execute();
        expect(now.every((one) => one.student_id === old.id)).toBe(true);
        const rows = await classRowsOf(old.id);
        for (const row of before.classRows) {
          expect(rows.map((one) => one.id)).toContain(row.id);
        }
        const [entry] = await t.entries('student.merged', old.id);
        expect(entry).toMatchObject({
          branch_id: t.north,
          reason: 'Created twice by mistake',
          assignment_id: t.adminAssignment,
          new_value: { keptId: old.id, mergedId: again.id, keptUid: old.uid, mergedUid: again.uid },
        });
      }
    });

    it('cuts the graduated tail of a graduate created again', async () => {
      const graduate = await members.student(t.north, { startsOn: '2026-09-01' });
      await t.database.migrator
        .updateTable('student_statuses')
        .set({ valid_until: '2026-09-15' })
        .where('student_id', '=', graduate)
        .execute();
      await t.database.migrator
        .insertInto('student_statuses')
        .values({
          student_id: graduate,
          branch_id: t.north,
          status: 'graduated',
          valid_from: '2026-09-15',
          cause: 'graduation',
        })
        .execute();
      const again = await pupil({ from: '2026-10-05' });
      merged(await merge(again.id, (await fresh(graduate)).uid));
      expect((await statusesOf(graduate)).map((row) => [row.status, row.valid_until])).toEqual([
        ['active', '2026-09-15'],
        ['graduated', '2026-10-05'],
        ['active', null],
      ]);
    });
  });

  describe('a record created twice by mistake (edge: "\'leave\' or the merge is used")', () => {
    it('leaves behind the duplicate that started later, its class row with it', async () => {
      const first = await pupil({ from: '2026-09-02' });
      const twice = await pupil({ from: '2026-09-10' });
      const twiceRows = await classRowsOf(twice.id);
      const seen = await previewOf(first.id, twice.uid);
      expect(seen.kept.id).toBe(first.id);
      expect(seen.refusal).toBeNull();
      expect(
        seen.rows
          .filter((row) => row.action === 'left')
          .map((row) => row.kind)
          .sort(),
      ).toEqual(['class', 'status']);
      const result = merged(
        await post(first.id, { uid: twice.uid, reason: 'Created twice', digest: seen.digest }),
      );
      expect(result.student.class?.id).toBe((await classRowsOf(first.id))[0]?.class_id);
      expect(await classRowsOf(first.id)).toHaveLength(1);
      const stored = await t.database.migrator
        .selectFrom('student_merges')
        .select(['left_rows', 'merged_record', 'merged_uids'])
        .where('kept_id', '=', first.id)
        .executeTakeFirstOrThrow();
      const left = stored.left_rows as Record<string, { id: string }[]>;
      expect(left.class_memberships?.map((row) => row.id)).toEqual(twiceRows.map((row) => row.id));
      expect(left.student_statuses).toHaveLength(1);
      expect(left.student_accounts).toHaveLength(1);
      expect((stored.merged_record as { id: string }).id).toBe(twice.id);
      expect(stored.merged_uids).toEqual([twice.uid]);
    });

    it('cuts the duplicate that started first at the kept record’s first day', async () => {
      const kept = await pupil({ from: '2026-09-10' });
      const earlier = await pupil({ from: '2026-09-02' });
      const earlierRows = await classRowsOf(earlier.id);
      merged(await merge(earlier.id, kept.uid));
      expect((await statusesOf(kept.id)).map((row) => [row.valid_from, row.valid_until])).toEqual([
        ['2026-09-02', '2026-09-10'],
        ['2026-09-10', null],
      ]);
      const rows = await classRowsOf(kept.id);
      expect(rows.map((row) => [row.id, row.valid_from, row.valid_until, row.ended_by])).toEqual([
        [earlierRows[0]?.id, '2026-09-02', '2026-09-10', 'merge'],
        [expect.any(String) as unknown, '2026-09-10', '2027-06-01', null],
      ]);
    });

    it('refuses a row that would lose its start, naming the day, with nothing written', async () => {
      const kept = await pupil({ from: '2026-09-02' });
      await leave(kept.id, '2026-09-30');
      const other = await pupil({ from: '2026-09-15' });
      const seen = await previewOf(kept.id, other.uid);
      expect(seen.refusal).toEqual({ code: 'student_merge_overlap', day: '2026-09-15' });
      const before = await rowsOf();
      const response = await post(kept.id, {
        uid: other.uid,
        reason: 'Created twice',
        digest: seen.digest,
      });
      refusedWith(response, 409, 'student_merge_overlap');
      expect(
        (response.body as { error: { details: { day: string }[] } }).error.details[0]?.day,
      ).toBe('2026-09-15');
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('two branches (decision 5, correction 1)', () => {
    it('gives the kept record the later life’s branch, keeps the earlier branch’s rows readable there, and logs in both', async () => {
      const old = await pupil({ from: '2026-09-02', fields: { phone: '+998901110001' } });
      await leave(old.id, '2026-09-19');
      const again = await pupil({
        branch: t.south,
        from: '2026-10-05',
        fields: { phone: '+998902220002', address: 'Yunusobod 4' },
      });
      const oldRows = await classRowsOf(old.id);
      const seen = await previewOf(old.id, again.uid);
      expect(seen.branch).toEqual({ id: t.south, name: 'South' });
      const result = merged(
        await post(old.id, { uid: again.uid, reason: 'Created again', digest: seen.digest }),
      );
      expect(result.branch).toEqual({ id: t.south, name: 'South' });
      expect(result.student).toMatchObject({ id: old.id, uid: old.uid, status: 'active' });
      // No longer of the North branch: 404 there, read in the South.
      refusedWith(await t.get(`/api/people/students/${old.id}`, t.north), 404, 'not_found');
      expect((await fresh(old.id, t.south)).mergedUids).toEqual([again.uid]);
      expect(new Set((await statusesOf(old.id)).map((row) => row.branch_id))).toEqual(
        new Set([t.south]),
      );
      expect((await classRowsOf(old.id)).find((row) => row.id === oldRows[0]?.id)?.branch_id).toBe(
        t.north,
      );
      const history = studentHistorySchema.parse(
        (await t.get(`/api/people/students/${old.id}/history`, t.south)).body,
      );
      const classLines = history.lines.filter((line) => line.kind === 'class');
      expect(classLines).toHaveLength(2);
      const mergedLine = history.lines.find((line) => line.kind === 'merged');
      expect(mergedLine).toEqual({
        kind: 'merged',
        on: '2026-10-10',
        uid: again.uid,
        reason: 'Created again',
      });
      const entries = await t.entries('student.merged', old.id);
      expect(entries.map((entry) => entry.branch_id).sort()).toEqual([t.north, t.south].sort());
      // The personal values only in the kept record's branch (decision 5;
      // permission review, must-fix 1): the North entry names no value of
      // either record.
      const north = entries.find((entry) => entry.branch_id === t.north);
      const south = entries.find((entry) => entry.branch_id === t.south);
      const northText = JSON.stringify(north?.new_value);
      for (const value of ['+998901110001', '+998902220002', 'Yunusobod 4']) {
        expect(northText).not.toContain(value);
      }
      expect(north?.new_value).not.toHaveProperty('filled');
      expect(north?.new_value).not.toHaveProperty('leftValues');
      expect(south?.new_value).toMatchObject({
        filled: { address: 'Yunusobod 4' },
        leftValues: expect.arrayContaining([
          { field: 'phone', kept: '+998901110001', merged: '+998902220002' },
        ]) as unknown,
      });
    });
  });

  it('carries an accepted branch move of the later life after the cuts (the order of step 5)', async () => {
    const old = await pupil({ from: '2026-09-02' });
    await leave(old.id, '2026-09-19');
    const again = await pupil({ from: '2026-10-05' });
    await moveStudentBranch(
      t.database.migrator,
      again.id,
      t.north,
      t.south,
      '2026-10-10T18:55:00Z',
    );
    const move = await t.database.migrator
      .selectFrom('student_branch_moves')
      .select('id')
      .where('student_id', '=', again.id)
      .executeTakeFirstOrThrow();
    const result = merged(await merge(old.id, again.uid));
    expect(result.branch).toEqual({ id: t.south, name: 'South' });
    expect(result.student.lastBranchMove).toMatchObject({ id: move.id, state: 'accepted' });
    const stored = await t.database.migrator
      .selectFrom('student_branch_moves')
      .select(['student_id', 'branch_id'])
      .where('id', '=', move.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ student_id: old.id, branch_id: t.south });
    expect((await statusesOf(old.id)).map((row) => [row.status, row.valid_until])).toEqual([
      ['active', '2026-09-20'],
      ['inactive', '2026-10-05'],
      ['active', null],
    ]);
  });

  it('refuses a cut in a closed year (`year_closed`)', async () => {
    // The rows of the closed year are written as they stood before it was
    // closed: its guard is off for the fixture alone (this file's database).
    const guard = (state: 'enable' | 'disable') =>
      sql`alter table student_statuses ${sql.raw(state)} trigger student_statuses_closed_year_guard`.execute(
        t.database.migrator,
      );
    await guard('disable');
    const old = await members.student(t.north, { startsOn: '2025-09-01' });
    await t.database.migrator
      .transaction()
      .execute((transaction) => members.leaving(transaction, t.north, old, '2026-01-01'));
    const again = await members.student(t.north, { startsOn: '2026-02-01' });
    await guard('enable');
    const uid = (await fresh(again)).uid;
    const seen = await previewOf(old, uid);
    const before = await rowsOf();
    refusedWith(
      await post(old, { uid, reason: 'Created again', digest: seen.digest }),
      409,
      'year_closed',
    );
    expect(await rowsOf()).toEqual(before);
  });

  describe('something pending (decision 11)', () => {
    it('refuses an open release on either record', async () => {
      const kept = await pupil();
      const other = await pupil();
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', '2026-10-10T18:55:00Z', true)`.execute(transaction);
        await transaction
          .insertInto('student_branch_moves')
          .values({
            branch_id: t.north,
            student_id: other.id,
            from_branch_id: t.north,
            to_branch_id: t.south,
            effective_on: '2026-10-20',
            released_at: new Date('2026-10-10T18:55:00Z'),
          })
          .execute();
      });
      const seen = await previewOf(kept.id, other.uid);
      expect(seen.refusal).toEqual({ code: 'branch_move_open', day: null });
      refusedWith(
        await post(kept.id, { uid: other.uid, reason: 'Twice', digest: seen.digest }),
        409,
        'branch_move_open',
      );
    });

    it('refuses a class move scheduled after today on either record', async () => {
      const kept = await pupil();
      const other = await pupil();
      const to = await classes.schoolClass(t.north, northYear, { grade: 7 });
      await members.move({
        branch: t.north,
        studentId: kept.id,
        from: '2026-10-20',
        fromClassId: (await classRowsOf(kept.id))[0]?.class_id ?? '',
        toClassId: to,
      });
      const seen = await previewOf(other.id, kept.uid);
      expect(seen.refusal?.code).toBe('move_scheduled');
      refusedWith(
        await post(other.id, { uid: kept.uid, reason: 'Twice', digest: seen.digest }),
        409,
        'move_scheduled',
      );
    });
  });

  describe('relatives and fields (decisions 7 to 9)', () => {
    it('keeps one link of a relative of both with the kept main mark and moves the others, archiving none', async () => {
      const kept = await pupil();
      const other = await pupil();
      const links = await t.database.migrator
        .selectFrom('student_relatives')
        .select(['relative_id', 'student_id', 'main_contact'])
        .where('student_id', 'in', [kept.id, other.id])
        .execute();
      const keptMain = links.find((one) => one.student_id === kept.id)?.relative_id ?? '';
      const otherMain = links.find((one) => one.student_id === other.id)?.relative_id ?? '';
      // The kept record's main contact is also the other record's relative.
      await t.database.migrator
        .insertInto('student_relatives')
        .values({
          student_id: other.id,
          branch_id: t.north,
          relative_id: keptMain,
          relationship: 'aunt',
          main_contact: false,
          linked_at: new Date('2026-10-01T08:00:00Z'),
        })
        .execute();
      merged(await merge(kept.id, other.uid));
      const live = await t.database.migrator
        .selectFrom('student_relatives')
        .select(['relative_id', 'main_contact', 'relationship'])
        .where('student_id', '=', kept.id)
        .where('unlinked_at', 'is', null)
        .orderBy('main_contact', 'desc')
        .execute();
      expect(live).toEqual([
        { relative_id: keptMain, main_contact: true, relationship: 'mother' },
        { relative_id: otherMain, main_contact: false, relationship: 'mother' },
      ]);
      const archived = await t.database.migrator
        .selectFrom('relatives')
        .select('archived_at')
        .where('id', 'in', [keptMain, otherMain])
        .execute();
      expect(archived.every((one) => one.archived_at === null)).toBe(true);
    });

    it('fills the kept record’s empty fields, the document with its type, and keeps differing values on the merge', async () => {
      const kept = await pupil({ fields: { phone: '+998901112233' } });
      const other = await pupil({
        fields: {
          phone: '+998907778899',
          jshshir: '31304110000017',
          documentType: 'birth_certificate',
          documentNumber: 'IAB1234567',
          address: 'Navoi street 5',
        },
      });
      const seen = await previewOf(kept.id, other.uid);
      expect(seen.filled.sort()).toEqual(['address', 'document', 'jshshir']);
      expect(seen.differing).toEqual([
        { field: 'lastName', kept: kept.lastName, merged: other.lastName },
        { field: 'phone', kept: '+998901112233', merged: '+998907778899' },
      ]);
      merged(await post(kept.id, { uid: other.uid, reason: 'Twice', digest: seen.digest }));
      const stored = await t.database.migrator
        .selectFrom('students')
        .select(['phone', 'jshshir', 'document_type', 'document_number', 'address'])
        .where('id', '=', kept.id)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({
        phone: '+998901112233',
        jshshir: '31304110000017',
        document_type: 'birth_certificate',
        document_number: 'IAB1234567',
        address: 'Navoi street 5',
      });
      const merge = await t.database.migrator
        .selectFrom('student_merges')
        .select('merged_record')
        .where('kept_id', '=', kept.id)
        .executeTakeFirstOrThrow();
      expect(merge.merged_record).toMatchObject({
        phone: '+998907778899',
        jshshir: '31304110000017',
      });
    });
  });

  it('follows a chain: both old UIDs lead to the latest kept record', async () => {
    const oldest = await pupil();
    const middle = await pupil();
    const newest = await pupil();
    merged(await merge(middle.id, newest.uid));
    merged(await merge(oldest.id, middle.uid));
    expect((await fresh(oldest.id)).mergedUids).toEqual([newest.uid, middle.uid]);
    const rows = await t.database.migrator
      .selectFrom('student_merges')
      .select('kept_id')
      .where('merged_uid', 'in', [newest.uid, middle.uid])
      .execute();
    expect(rows.map((row) => row.kept_id)).toEqual([oldest.id, oldest.id]);
  });

  describe('"student changed, reload" (edge) and the input', () => {
    it('gives one digest for an unchanged pair, and merges with it', async () => {
      const kept = await pupil();
      const other = await pupil();
      const one = await previewOf(kept.id, other.uid);
      const two = await previewOf(kept.id, other.uid);
      expect(two.digest).toBe(one.digest);
      merged(await post(kept.id, { uid: other.uid, reason: 'Twice', digest: one.digest }));
    });

    it('refuses with `student_changed` when a field, a link or a row changed after the preview', async () => {
      const changes: ((kept: string, other: string) => Promise<unknown>)[] = [
        (_kept, other) =>
          t.database.migrator
            .updateTable('students')
            .set({ address: 'Chilonzor 1' })
            .where('id', '=', other)
            .execute(),
        (kept) =>
          t.database.migrator
            .updateTable('student_relatives')
            .set({ receives_notices: false })
            .where('student_id', '=', kept)
            .execute(),
        (kept) =>
          t.database.migrator
            .updateTable('student_contracts')
            .set({ signed_on: '2026-08-21' })
            .where('student_id', '=', kept)
            .execute(),
      ];
      for (const change of changes) {
        const kept = await pupil();
        const other = await pupil();
        const seen = await previewOf(kept.id, other.uid);
        await change(kept.id, other.id);
        const before = await rowsOf();
        refusedWith(
          await post(kept.id, { uid: other.uid, reason: 'Twice', digest: seen.digest }),
          409,
          'student_changed',
        );
        expect(await rowsOf()).toEqual(before);
      }
    });

    it('refuses the record’s own UID, an unknown UID and a missing reason', async () => {
      const kept = await pupil();
      const before = await rowsOf();
      for (const [uid, code] of [
        [kept.uid, 'student_merge_same'],
        ['2699999', 'student_merge_not_found'],
      ] as const) {
        refusedWith(await preview(kept.id, uid), 422, code);
        refusedWith(
          await post(kept.id, { uid, reason: 'Twice', digest: '0'.repeat(64) }),
          422,
          code,
        );
      }
      const other = await pupil();
      const seen = await previewOf(kept.id, other.uid);
      const mid = await rowsOf();
      refusedWith(
        await post(kept.id, { uid: other.uid, reason: '  ', digest: seen.digest }),
        400,
        'validation_failed',
      );
      expect(await rowsOf()).toEqual(mid);
      expect(before[0].length).toBeLessThan(mid[0].length);
    });
  });

  describe('permissions (decision 10)', () => {
    it('refuses every role but the Super Admin on both routes, with nothing written', async () => {
      const kept = await pupil();
      const other = await pupil();
      const seen = await previewOf(kept.id, other.uid);
      const before = await rowsOf();
      for (const cookie of [t.vicePrincipal, t.principal, tutor, t.teacher, headTeacher]) {
        refusedWith(await preview(kept.id, other.uid, t.north, cookie), 403, 'permission_denied');
        refusedWith(
          await post(
            kept.id,
            { uid: other.uid, reason: 'Twice', digest: seen.digest },
            t.north,
            cookie,
          ),
          403,
          'permission_denied',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });

    it("answers 404 for another branch's path record and an unknown one on both routes, as the Super Admin, with nothing written", async () => {
      const south = await pupil({ branch: t.south });
      const north = await pupil();
      const before = await rowsOf();
      for (const id of [south.id, UNKNOWN]) {
        refusedWith(await preview(id, north.uid), 404, 'not_found');
        refusedWith(
          await post(id, { uid: north.uid, reason: 'Twice', digest: '0'.repeat(64) }),
          404,
          'not_found',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('two merges at the same moment (`inOrder`)', () => {
    it('gives the second `student_merge_not_found` when it names the record the first removed', async () => {
      const a = await pupil();
      const b = await pupil();
      const c = await pupil();
      const first = await previewOf(a.id, b.uid);
      const second = await previewOf(c.id, b.uid);
      const [one, two] = await inOrder(
        b.id,
        () => post(a.id, { uid: b.uid, reason: 'Twice', digest: first.digest }),
        () => post(c.id, { uid: b.uid, reason: 'Twice', digest: second.digest }),
      );
      merged(one);
      refusedWith(two, 422, 'student_merge_not_found');
    });

    it('gives the second `student_changed` when the record it keeps changed', async () => {
      const a = await pupil();
      const b = await pupil();
      const c = await pupil();
      const first = await previewOf(c.id, b.uid);
      const second = await previewOf(a.id, b.uid);
      const [one, two] = await inOrder(
        b.id,
        () => post(c.id, { uid: b.uid, reason: 'Twice', digest: first.digest }),
        () => post(a.id, { uid: b.uid, reason: 'Twice', digest: second.digest }),
      );
      expect(merged(one).student.id).toBe(b.id);
      refusedWith(two, 409, 'student_changed');
    });
  });

  describe('the merged UID leads to the kept record (decisions 6 and 15)', () => {
    it('is found by the search and the list, and refused on a new student naming the kept record', async () => {
      const kept = await pupil();
      const other = await pupil();
      merged(await merge(kept.id, other.uid));
      const search = await t.get(`/api/search/students?q=${other.uid}`, t.north);
      expect(search.status, JSON.stringify(search.body)).toBe(200);
      expect((search.body as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
        kept.id,
      ]);
      const list = await t.get('/api/people/students', t.north);
      const row = (list.body as { students: { id: string; mergedUids: string[] }[] }).students.find(
        (one) => one.id === kept.id,
      );
      expect(row?.mergedUids).toEqual([other.uid]);
      // Not from another branch, and not for a reader outside the record's
      // scope (a Tutor of no class of it; permission review, should-fix 2).
      const southSearch = await t.get(`/api/search/students?q=${other.uid}`, t.south);
      expect((southSearch.body as { items: unknown[] }).items).toEqual([]);
      const southList = await t.get('/api/people/students', t.south);
      expect(
        (southList.body as { students: { id: string }[] }).students.some(
          (one) => one.id === kept.id,
        ),
      ).toBe(false);
      const tutorSearch = await t.get(`/api/search/students?q=${other.uid}`, t.north, tutor);
      expect(tutorSearch.status, JSON.stringify(tutorSearch.body)).toBe(200);
      expect((tutorSearch.body as { items: unknown[] }).items).toEqual([]);
      const classId = await classes.schoolClass(t.north, northYear, { grade: 7 });
      const created = await t.post('/api/people/students', t.north, {
        ...body(classId, '2026-09-02'),
        uid: other.uid,
      });
      refusedWith(created, 409, 'student_value_taken');
      expect((created.body as { error: { details: unknown[] } }).error.details[0]).toMatchObject({
        path: 'uid',
        code: 'uid_merged',
        recordId: kept.id,
      });
      // The correction of a UID meets the same answer.
      const third = await pupil();
      const corrected = await t.put(`/api/people/students/${third.id}/uid`, t.north, {
        uid: other.uid,
        reason: 'Typed wrongly at enrolment.',
        confirmUidSet: true,
      });
      refusedWith(corrected, 409, 'student_value_taken');
      expect((corrected.body as { error: { details: unknown[] } }).error.details[0]).toMatchObject({
        code: 'uid_merged',
        recordId: kept.id,
      });
      // From another branch: "a student of another branch".
      const southClass = await classes.schoolClass(t.south, southYear, { grade: 7 });
      const elsewhere = await t.post('/api/people/students', t.south, {
        ...body(southClass, '2026-09-02'),
        uid: other.uid,
      });
      refusedWith(elsewhere, 409, 'student_value_taken');
      const detail = (elsewhere.body as { error: { details: Record<string, unknown>[] } }).error
        .details[0];
      expect(detail).toMatchObject({ path: 'uid', code: 'held_elsewhere' });
      expect(detail?.recordId).toBeUndefined();
    });

    it('lists the merged record’s values on the kept record’s personal data report', async () => {
      const kept = await pupil();
      const other = await pupil({ fields: { address: 'Navoi street 9' } });
      merged(await merge(kept.id, other.uid));
      const report = await t.post(`/api/people/students/${kept.id}/report`, t.north, {});
      expect(report.status, JSON.stringify(report.body)).toBe(200);
      const student = (report.body as { student: { merged: unknown[] } }).student;
      expect(student.merged).toEqual([
        {
          uids: [other.uid],
          mergedAt: expect.any(String) as unknown,
          reason: 'Created twice by mistake',
          values: expect.arrayContaining([
            { field: 'address', value: 'Navoi street 9' },
            { field: 'lastName', value: other.lastName },
          ]) as unknown,
        },
      ]);
    });
  });

  // Kept for the reader of the preview (correction 1): the kept record's side.
  it('names both records and the branch in the preview', async () => {
    const kept = await pupil();
    const other = await pupil();
    const seen: StudentMergePreview = await previewOf(other.id, kept.uid);
    expect(seen.kept).toMatchObject({ id: kept.id, uid: kept.uid, status: 'active' });
    expect(seen.merged).toMatchObject({ id: other.id, uid: other.uid });
    expect(seen.branch.id).toBe(t.north);
  });
});
