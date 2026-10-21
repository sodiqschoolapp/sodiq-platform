import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  forcedDeleteListSchema,
  forcedDeleteSchema,
  lessonHistorySchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  MONDAY,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { standingExamOver } from '../../testing/exams-kit.js';
import { heldEntry } from '../../testing/held-entry.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { publishedScene, publishOf, type PublishedScene } from '../../testing/published-scene.js';
import { RESTORE_REFUSALS } from './forced-deletes.service.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

/** The details of a refusal: what each names and why. */
const detailsOf = (response: Response) =>
  (response.body as { error: { details: { code: string; path: string }[] } }).error.details;

const done = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const answer = forcedDeleteSchema.parse(response.body);
  if (answer.recordType !== 'lesson') throw new Error('A lesson was expected.');
  return answer;
};

/** A moment of a school date at a clock time in Tashkent (+05:00). */
const at = (date: string, time: string): Date => new Date(`${date}T${time}:00+05:00`);

const NEXT_MONDAY = '2026-10-19';
/** Monday 5 October 2026, before the clock. */
const PAST_MONDAY = '2026-10-05';

// All names are invented. Task 5.8b, pull request #195: the Super Admin's
// forced delete of a dated lesson, its store and its restore, and the history
// of a lesson (docs/spec/06-timetable.md, Protection: "Forced delete is for
// Super Admin only, with a typed reason. The attendance and marks are kept for
// 30 days and can be restored." "Every change records who, when, the value
// before and the value after."; edge/timetable, After publishing: "Every rule
// is checked again. The restore can be refused."). The clock stands at 23:55
// on Saturday 10 October 2026 in Tashkent.
describe('the forced delete of a dated lesson and its restore', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let northScene: Scene;
  let adminAccount: string;
  /** A second Super Admin, for the request keys (at most three: `MAX_SUPER_ADMINS`). */
  let second: { cookie: string };

  const keyed = (path: string, branch: string, body: object, cookie: string, key: string) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send(body);

  const forceDelete = (
    branch: string,
    id: string,
    reason: unknown = 'Entered for the wrong class',
    cookie = t.admin,
    key: string = randomUUID(),
  ) => keyed(`/api/timetable/lessons/${id}/forced-delete`, branch, { reason }, cookie, key);

  const restore = (branch: string, id: string, cookie = t.admin, key: string = randomUUID()) =>
    keyed(`/api/forced-deletes/${id}/restore`, branch, {}, cookie, key);

  const list = (branch: string, cookie = t.admin) => t.get('/api/forced-deletes', branch, cookie);

  const history = (branch: string, id: string, cookie = t.admin) =>
    t.get(`/api/timetable/lessons/${id}/history`, branch, cookie);

  const publish = (branch: string, version: string, startsOn: string) =>
    publishOf(t)(branch, version, startsOn);

  const scene = (input: { branch?: string; double?: boolean } = {}) =>
    publishedScene(t, load, input);

  type Scene = PublishedScene;

  /** The stored lessons of a class and subject on a date, by start. */
  const lessonsOf = (s: Scene, date: string, classId = s.classId) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', s.branch)
      .where('class_id', '=', classId)
      .where('subject_id', '=', s.subject)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .execute();

  const lessonOf = async (s: Scene, date: string, classId = s.classId) => {
    const [found] = await lessonsOf(s, date, classId);
    if (found === undefined) throw new Error('No such lesson.');
    return found;
  };

  const rowOf = (id: string) =>
    t.database.migrator.selectFrom('lessons').selectAll().where('id', '=', id).executeTakeFirst();

  const blockOf = (id: string) =>
    t.database.migrator
      .selectFrom('lesson_blocks')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

  const claimsOf = (id: string) =>
    t.database.migrator
      .selectFrom('time_claims')
      .select('kind')
      .where('lesson_id', '=', id)
      .execute();

  const historyOf = (id: string) =>
    t.database.migrator
      .selectFrom('lesson_history')
      .selectAll()
      .where('lesson_id', '=', id)
      .orderBy('changed_at')
      .orderBy('id')
      .execute();

  const noticesOf = (
    accountId: string,
    kind:
      | 'timetable.lesson_force_deleted'
      | 'timetable.lesson_restored' = 'timetable.lesson_force_deleted',
  ) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['data', 'branch_id'])
      .where('account_id', '=', accountId)
      .where('kind', '=', kind)
      .execute();

  /** The account of an assignment of the kit. */
  const accountOfAssignment = async (assignmentId: string) =>
    (
      await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', assignmentId)
        .executeTakeFirstOrThrow()
    ).account_id;

  /** Every row of the tables a forced delete or a restore writes, and the log. */
  const everything = () =>
    Promise.all([
      t.database.migrator.selectFrom('lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_blocks').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('time_claims').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_changes').selectAll().orderBy('lesson_id').execute(),
      t.database.migrator.selectFrom('lesson_day_changes').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('lesson_absence_taught')
        .selectAll()
        .orderBy('lesson_id')
        .execute(),
      t.database.migrator
        .selectFrom('lesson_exam_cancels')
        .selectAll()
        .orderBy('lesson_id')
        .execute(),
      t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .selectAll()
        .orderBy('block_id')
        .execute(),
      t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .selectAll()
        .orderBy('bulk_cancel_id')
        .orderBy('block_id')
        .execute(),
      t.database.migrator.selectFrom('substitution_lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('forced_deletes').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_history').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('notifications').select('id').orderBy('id').execute(),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
      t.database.migrator.selectFrom('request_keys').selectAll().orderBy('key').execute(),
    ]);

  /** A copy of a stored lesson in a block of its own dated `date`, written by the migrator. */
  async function lessonDated(s: Scene, date: string) {
    const from = await lessonOf(s, MONDAY);
    const block = await blockOf(from.block_id);
    if (block === undefined) throw new Error('No block.');
    const made = await t.database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: s.branch,
        academic_year_id: block.academic_year_id,
        quarter_id: block.quarter_id,
        lesson_date: date,
        starts_at: at(date, '08:00'),
        ends_at: at(date, '08:45'),
        version_id: block.version_id,
        pattern_block_id: block.pattern_block_id,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const lesson = await t.database.migrator
      .insertInto('lessons')
      .values({
        branch_id: s.branch,
        block_id: made.id,
        lesson_date: made.lesson_date,
        starts_at: made.starts_at,
        ends_at: made.ends_at,
        class_id: from.class_id,
        subject_id: from.subject_id,
        load_row_id: from.load_row_id,
        pattern_entry_id: from.pattern_entry_id,
        teacher_id: from.teacher_id,
        room_id: from.room_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return lesson.id;
  }

  /** The two Monday lessons of the first class on `date`, made one double pair by the migrator. */
  async function doubleOf(s: Scene, date: string) {
    const both = await lessonsOf(s, date);
    const [first, second] = both;
    if (both.length !== 2 || first === undefined || second === undefined) {
      throw new Error('No double lesson.');
    }
    await t.database.migrator
      .updateTable('lesson_blocks')
      .set({ double_pair_id: randomUUID() })
      .where('id', 'in', [first.block_id, second.block_id])
      .execute();
    return [first, second] as const;
  }

  /** A substitute put on a lesson through its route. */
  const substitute = async (s: Scene, lessonId: string) => {
    const response = await keyed(
      `/api/timetable/lessons/${lessonId}/substitute`,
      s.branch,
      { teacherId: s.spareTeacher.staffId, reason: 'Away at a seminar' },
      t.admin,
      randomUUID(),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  };

  /** The id of the store row of a forced delete answered. */
  const storeOf = (response: Response) => done(response).id;

  async function waiting(): Promise<number> {
    const found = await sql<{ n: number }>`
      select count(distinct l.pid)::int as n
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.n ?? 0;
  }

  /** Two real requests behind the publish lock held open, the first sent first. */
  async function inOrder(
    branch: string,
    first: () => Promise<Response>,
    second: () => Promise<Response>,
    hold: (transaction: Transaction) => Promise<unknown> = (transaction) =>
      sql`select pg_advisory_xact_lock(550001)`.execute(transaction),
  ): Promise<[Response, Response]> {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = t.app
      .get(Transactions)
      .run([branch], async (transaction: Transaction) => {
        await hold(transaction);
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await isReady;
    const one = first().then((response) => response);
    await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
    const two = second().then((response) => response);
    await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(2);
    release();
    expect(await held).toBeUndefined();
    return Promise.all([one, two]);
  }

  /** A draft copied from the scene's version, its first class's teacher changed, published from `startsOn`. */
  async function republish(s: Scene, startsOn: string) {
    const created = await t.post('/api/timetable/versions', s.branch, {
      academicYearId: s.year,
      startsOn,
      copyFrom: s.version,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = (created.body as { id: string }).id;
    await t.database.migrator
      .updateTable('teaching_load_rows')
      .set({ teacher_id: s.spareTeacher.staffId })
      .where('version_id', '=', draft)
      .where('class_id', '=', s.classId)
      .execute();
    const confirmed = await t.post(`/api/timetable/versions/${draft}/templates/confirm`, s.branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(draft);
    return () => publish(s.branch, draft, startsOn);
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    northScene = await scene({ branch: t.north });
    const browser = await t.kit.completeSession('Malika', 'Tosheva');
    await t.kit.giveRole(browser.account.id, { role: 'super_admin' });
    second = browser;
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

  describe('a forced delete', () => {
    it('removes a future lesson and its block, keeps them in the store, writes its history line, its entry and the notice', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, NEXT_MONDAY);
      expect(await claimsOf(lesson.id)).not.toEqual([]);
      const answer = done(
        await forceDelete(s.branch, lesson.id, '  Entered for the wrong class  '),
      );
      expect(answer).toMatchObject({
        recordType: 'lesson',
        reason: 'Entered for the wrong class',
        lesson: { id: lesson.id, date: NEXT_MONDAY, unit: { kind: 'class', id: s.classId } },
        restoredAt: null,
        restorable: true,
      });
      expect(answer.restoreUntil).toBe(
        new Date(new Date(START).getTime() + 30 * 86_400_000).toISOString(),
      );
      expect(await rowOf(lesson.id)).toBeUndefined();
      expect(await blockOf(lesson.block_id)).toBeUndefined();
      expect(await claimsOf(lesson.id)).toEqual([]);
      expect((await historyOf(lesson.id)).map((one) => one.kind)).toEqual(['forced_delete']);
      const [entry] = await t.entries('lesson.forced_delete', lesson.id);
      expect(entry).toMatchObject({
        assignment_id: t.adminAssignment,
        reason: 'Entered for the wrong class',
      });
      // edge/people-roles-accounts: "It notifies the branch's Academic Vice
      // Principal, the Principal and the teacher."
      expect(await noticesOf(s.teacher.accountId)).toEqual([
        {
          branch_id: s.branch,
          data: expect.objectContaining({ date: NEXT_MONDAY, start: '08:00' }) as unknown,
        },
      ]);
      expect(await noticesOf(await accountOfAssignment(t.viceAssignment))).toHaveLength(1);
      expect(await noticesOf(s.otherTeacher.accountId)).toHaveLength(0);
      // The other class's lesson at the same time stays.
      expect(await rowOf((await lessonOf(s, NEXT_MONDAY, s.otherClass)).id)).toBeDefined();
    });

    it('removes a past lesson, which only a forced delete can, and tells its teacher', async () => {
      const s = northScene;
      const id = await lessonDated(s, PAST_MONDAY);
      const before = (await noticesOf(s.teacher.accountId)).length;
      done(await forceDelete(s.branch, id));
      expect(await rowOf(id)).toBeUndefined();
      expect(await noticesOf(s.teacher.accountId)).toHaveLength(before + 1);
    });

    it('takes one half of a double lesson: the other half and its block stay', async () => {
      const s = await scene({ double: true });
      const [first, second] = await doubleOf(s, NEXT_MONDAY);
      done(await forceDelete(s.branch, second.id));
      expect(await rowOf(first.id)).toBeDefined();
      expect(await blockOf(first.block_id)).toBeDefined();
      expect(await rowOf(second.id)).toBeUndefined();
    });

    it('ends the substitution of the lesson with its own cause', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      await substitute(s, lesson.id);
      done(await forceDelete(s.branch, lesson.id));
      const rows = await t.database.migrator
        .selectFrom('substitution_lessons')
        .select(['end_cause', 'lesson_id'])
        .where('lesson_date', '=', NEXT_MONDAY)
        .where('branch_id', '=', s.branch)
        .execute();
      expect(rows).toEqual([{ end_cause: 'forced_delete', lesson_id: null }]);
    });

    it('refuses a reason missing, of spaces only or of 501 characters as an input error', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-10-26');
      const before = await everything();
      for (const body of [{}, { reason: '   ' }, { reason: 'x'.repeat(501) }]) {
        refusedWith(
          await keyed(
            `/api/timetable/lessons/${lesson.id}/forced-delete`,
            s.branch,
            body,
            t.admin,
            randomUUID(),
          ),
          400,
          'validation_failed',
        );
      }
      expect(await everything()).toEqual(before);
    });

    it('is refused in a closed year', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status: 'current' })
        .where('id', '=', s.year)
        .where('status', '=', 'planned')
        .execute();
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status: 'closed' })
        .where('id', '=', s.year)
        .execute();
      refusedWith(await forceDelete(s.branch, lesson.id), 409, 'timetable_year_closed');
      expect(await rowOf(lesson.id)).toBeDefined();
    });

    it('is refused to the Academic Vice Principal, the Principal and a Teacher, and nothing changes', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-11-09');
      const before = await everything();
      for (const cookie of [t.vicePrincipal, t.principal, t.teacher]) {
        refusedWith(
          await forceDelete(s.branch, lesson.id, 'Rain', cookie),
          403,
          'permission_denied',
        );
      }
      expect(await everything()).toEqual(before);
    });

    it('answers 404 for a lesson of another branch and an unknown one, and nothing changes', async () => {
      const other = await scene();
      const foreign = await lessonOf(other, NEXT_MONDAY);
      const before = await everything();
      refusedWith(await forceDelete(t.north, foreign.id), 404, 'not_found');
      refusedWith(await forceDelete(t.north, UNKNOWN), 404, 'not_found');
      expect(await everything()).toEqual(before);
    });

    it('keeps a used key to its account, its branch and its role (request keys)', async () => {
      const s = northScene;
      const other = await scene();
      const foreign = await lessonOf(other, NEXT_MONDAY);
      const lesson = await lessonOf(s, '2026-11-16');
      const key = randomUUID();
      done(await forceDelete(s.branch, lesson.id, 'Rain', t.admin, key));
      const after = await everything();
      done(await forceDelete(s.branch, lesson.id, 'Rain', t.admin, key));
      expect(await everything()).toEqual(after);
      refusedWith(
        await forceDelete(s.branch, lesson.id, 'Rain', second.cookie, key),
        409,
        'request_key_reused',
      );
      refusedWith(await forceDelete(s.branch, foreign.id, 'Rain', t.admin, key), 404, 'not_found');
      refusedWith(await forceDelete(s.branch, UNKNOWN, 'Rain', t.admin, key), 404, 'not_found');
      refusedWith(
        await forceDelete(s.branch, lesson.id, 'Rain', t.vicePrincipal, key),
        403,
        'permission_denied',
      );
      expect(await everything()).toEqual(after);
      expect(await t.entries('lesson.forced_delete', lesson.id)).toHaveLength(1);
    });
  });

  describe('a restore', () => {
    it('puts back the same lesson and block within 30 days, with its claims, its history line and its entry', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-11-23');
      const block = await blockOf(lesson.block_id);
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      const answer = done(await restore(s.branch, store));
      expect(answer).toMatchObject({ restorable: false, restoredBy: { id: adminAccount } });
      // `created_at` is bookkeeping, written again by the insert.
      const { created_at: _lessonCreated, ...kept } = lesson;
      void _lessonCreated;
      expect(await rowOf(lesson.id)).toMatchObject(kept);
      const { created_at: _blockCreated, ...keptBlock } = block ?? {};
      void _blockCreated;
      expect(await blockOf(lesson.block_id)).toMatchObject(keptBlock);
      expect(await claimsOf(lesson.id)).not.toEqual([]);
      expect((await historyOf(lesson.id)).map((one) => one.kind)).toEqual([
        'forced_delete',
        'restored',
      ]);
      expect(await t.entries('forced_delete.restore', lesson.id)).toHaveLength(1);
      refusedWith(await restore(s.branch, store), 409, 'forced_delete_restored');
    });

    it('puts back the second half of a double into its pair', async () => {
      const s = await scene({ double: true });
      const [first, second] = await doubleOf(s, NEXT_MONDAY);
      const pair = (await blockOf(first.block_id))?.double_pair_id;
      const store = storeOf(await forceDelete(s.branch, second.id));
      done(await restore(s.branch, store));
      expect((await blockOf(second.block_id))?.double_pair_id).toBe(pair);
    });

    it('records the substitution again for the same record', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      await substitute(s, lesson.id);
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      done(await restore(s.branch, store));
      expect((await rowOf(lesson.id))?.teacher_id).toBe(s.spareTeacher.staffId);
      const rows = await t.database.migrator
        .selectFrom('substitution_lessons')
        .select(['substitution_id', 'end_cause', 'lesson_id'])
        .where('lesson_date', '=', NEXT_MONDAY)
        .where('branch_id', '=', s.branch)
        .orderBy('id')
        .execute();
      expect(rows).toHaveLength(2);
      expect(rows[0]?.substitution_id).toBe(rows[1]?.substitution_id);
      expect(rows.map((one) => [one.end_cause, one.lesson_id])).toEqual([
        ['forced_delete', null],
        [null, lesson.id],
      ]);
    });

    it('is refused when the substitution was withdrawn from the other half of the double since', async () => {
      const s = await scene({ double: true });
      const [first, second] = await doubleOf(s, NEXT_MONDAY);
      await substitute(s, first.id);
      const store = storeOf(await forceDelete(s.branch, second.id));
      const withdrawn = await keyed(
        `/api/timetable/lessons/${first.id}/substitution/withdraw`,
        s.branch,
        { reason: 'Back from the seminar' },
        t.admin,
        randomUUID(),
      );
      expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
      const refused = await restore(s.branch, store);
      refusedWith(refused, 409, 'forced_delete_parent_changed');
      expect(detailsOf(refused)).toEqual([
        expect.objectContaining({ path: 'substitutions', code: 'substitution_withdrawn' }),
      ]);
      expect(await rowOf(second.id)).toBeUndefined();
    });

    it('is refused when the absence of the substitution was withdrawn since', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const absence = await t.database.migrator
        .insertInto('absences')
        .values({
          staff_id: s.teacher.staffId,
          starts_on: NEXT_MONDAY,
          ends_on: NEXT_MONDAY,
          applies_from: at(NEXT_MONDAY, '00:00'),
          applies_until: at('2026-10-20', '00:00'),
          reason: 'Ill',
          created_by: adminAccount,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await substitute(s, lesson.id);
      const kept = await t.database.migrator
        .selectFrom('substitution_lessons')
        .innerJoin('substitutions', 'substitutions.id', 'substitution_lessons.substitution_id')
        .select('substitutions.absence_id')
        .where('substitution_lessons.lesson_id', '=', lesson.id)
        .executeTakeFirstOrThrow();
      expect(kept.absence_id).toBe(absence.id);
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      await t.database.migrator
        .updateTable('absences')
        .set({ withdrawn_at: at('2026-10-10', '23:55') })
        .where('id', '=', absence.id)
        .execute();
      const refused = await restore(s.branch, store);
      refusedWith(refused, 409, 'forced_delete_parent_changed');
      expect(detailsOf(refused)).toEqual([
        expect.objectContaining({ path: 'absences', code: 'absence_withdrawn' }),
      ]);
      expect(await rowOf(lesson.id)).toBeUndefined();
    });

    it('puts back the change mark, the one-day change link and the absence-taught record', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const moved = await keyed(
        `/api/timetable/lessons/${lesson.id}/move`,
        s.branch,
        { date: NEXT_MONDAY, lessonNumber: 2, reason: 'The class is at the theatre' },
        t.admin,
        randomUUID(),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const placed = await rowOf(lesson.id);
      await t.database.migrator
        .insertInto('lesson_absence_taught')
        .values({
          branch_id: s.branch,
          lesson_id: lesson.id,
          recorded_by: adminAccount,
          recorded_at: at('2026-10-10', '12:00'),
        })
        .execute();
      const kept = async () => ({
        mark: await t.database.migrator
          .selectFrom('lesson_changes')
          .select('changed_at')
          .where('lesson_id', '=', lesson.id)
          .execute(),
        dayChanges: await t.database.migrator
          .selectFrom('lesson_day_changes')
          .select('id')
          .where('lesson_id', '=', lesson.id)
          .orderBy('id')
          .execute(),
        taught: await t.database.migrator
          .selectFrom('lesson_absence_taught')
          .select(['recorded_by', 'recorded_at'])
          .where('lesson_id', '=', lesson.id)
          .execute(),
      });
      const before = await kept();
      expect(before.mark).toHaveLength(1);
      expect(before.dayChanges).toHaveLength(1);
      expect(before.taught).toHaveLength(1);
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      expect(await kept()).toEqual({ mark: [], dayChanges: [], taught: [] });
      done(await restore(s.branch, store));
      expect(await kept()).toEqual(before);
      // Every stored value back; `created_at` is bookkeeping only.
      expect({ ...(await rowOf(lesson.id)), created_at: null }).toEqual({
        ...placed,
        created_at: null,
      });
    });

    it('puts back the exam cancel while its exam still stands over the lesson', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const exam = await standingExamOver(t.database.migrator, {
        lessonId: lesson.id,
        roomId: s.room,
        staffId: s.teacher.staffId,
      });
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      done(await restore(s.branch, store));
      expect((await rowOf(lesson.id))?.cancel_cause).toBe('exam');
      expect(
        await t.database.migrator
          .selectFrom('lesson_exam_cancels')
          .select('exam_id')
          .where('lesson_id', '=', lesson.id)
          .execute(),
      ).toEqual([{ exam_id: exam }]);
    });

    it('is refused when the exam that cancelled the lesson stands but no longer meets it', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const exam = await standingExamOver(t.database.migrator, {
        lessonId: lesson.id,
        roomId: s.room,
        staffId: s.teacher.staffId,
      });
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      await t.database.migrator
        .updateTable('exams')
        .set({
          starts_at: at(NEXT_MONDAY, '11:00'),
          ends_at: at(NEXT_MONDAY, '11:45'),
          first_slot: 4,
          last_slot: 4,
        })
        .where('id', '=', exam)
        .execute();
      const refused = await restore(s.branch, store);
      refusedWith(refused, 409, 'forced_delete_parent_changed');
      expect(detailsOf(refused)).toEqual([
        expect.objectContaining({ path: 'exams', code: 'exam_moved' }),
      ]);
      expect(await rowOf(lesson.id)).toBeUndefined();
    });

    /** Puts the other class's lesson into the block of the class's lesson: one block, two lessons. */
    const LATER_MONDAY = '2026-11-30';
    const sharedBlock = async (s: Scene) => {
      const lesson = await lessonOf(s, LATER_MONDAY);
      const other = await lessonOf(s, LATER_MONDAY, s.otherClass);
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`set constraints time_claims_class_excl deferred`.execute(transaction);
        // The clock of the scene, so the guard of the past lets the empty block go.
        await sql`select set_config('app.now', '2026-10-10T23:55:00+05:00', true)`.execute(
          transaction,
        );
        await transaction
          .updateTable('lessons')
          .set({ block_id: lesson.block_id })
          .where('id', '=', other.id)
          .execute();
        await transaction.deleteFrom('lesson_blocks').where('id', '=', other.block_id).execute();
      });
      return { lesson, other };
    };

    it('checks a lesson whose block stayed at the block’s times when the block was retimed since, refused with the findings, never a 500', async () => {
      const s = await scene();
      const { lesson } = await sharedBlock(s);
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      expect(await blockOf(lesson.block_id)).toBeDefined();
      await t.database.migrator
        .updateTable('lesson_blocks')
        .set({ starts_at: at(LATER_MONDAY, '08:05'), ends_at: at(LATER_MONDAY, '08:50') })
        .where('id', '=', lesson.block_id)
        .execute();
      // The stored times no longer meet the block's key (23503 before the fix):
      // the lesson is put at the block's times and checked there, where 08:05
      // starts no slot of the day.
      const refused = await restore(s.branch, store);
      refusedWith(refused, 409, 'forced_delete_restore_blocked');
      expect(detailsOf(refused)).toContainEqual(
        expect.objectContaining({ code: 'not_a_slot', day: LATER_MONDAY }),
      );
      expect(await rowOf(lesson.id)).toBeUndefined();
    });

    it('is refused when the block the lesson stayed in is gone since', async () => {
      const s = await scene();
      const { lesson, other } = await sharedBlock(s);
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      storeOf(await forceDelete(s.branch, other.id));
      expect(await blockOf(lesson.block_id)).toBeUndefined();
      refusedWith(await restore(s.branch, store), 409, 'forced_delete_block_gone');
      expect(await rowOf(lesson.id)).toBeUndefined();
    });

    /**
     * A shared block kept for the other class while the class sits an exam
     * over it: the class's lesson cancelled "exam" and the class kept out of
     * the block (`lesson_block_class_outs`). The other class's lesson is then
     * deleted for good, so the class's lesson is the block's last.
     */
    const classOutScene = async (s: Scene) => {
      const { lesson, other } = await sharedBlock(s);
      const exam = await standingExamOver(t.database.migrator, {
        lessonId: lesson.id,
        roomId: s.room,
        staffId: s.teacher.staffId,
      });
      await t.database.migrator
        .insertInto('lesson_block_class_outs')
        .values({
          branch_id: s.branch,
          block_id: lesson.block_id,
          class_id: s.classId,
          exam_id: exam,
        })
        .execute();
      storeOf(await forceDelete(s.branch, other.id));
      return { lesson, exam };
    };

    const classOutsOf = (blockId: string) =>
      t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .select(['class_id', 'exam_id'])
        .where('block_id', '=', blockId)
        .execute();

    it('takes the class outs with the block of its last lesson, keeps them in the store and puts them back', async () => {
      const s = await scene();
      const { lesson, exam } = await classOutScene(s);
      const deleted = await forceDelete(s.branch, lesson.id);
      const store = storeOf(deleted);
      expect(await blockOf(lesson.block_id)).toBeUndefined();
      expect(await classOutsOf(lesson.block_id)).toEqual([]);
      const kept = await t.database.migrator
        .selectFrom('forced_deletes')
        .select('rows')
        .where('id', '=', store)
        .executeTakeFirstOrThrow();
      expect((kept.rows as { classOuts: unknown }).classOuts).toEqual([
        { classId: s.classId, examId: exam },
      ]);
      done(await restore(s.branch, store));
      expect(await blockOf(lesson.block_id)).toBeDefined();
      expect((await rowOf(lesson.id))?.cancel_cause).toBe('exam');
      expect(await classOutsOf(lesson.block_id)).toEqual([{ class_id: s.classId, exam_id: exam }]);
    });

    it('is refused when the exam that kept the class out of the block was cancelled since', async () => {
      const s = await scene();
      const { lesson, exam } = await classOutScene(s);
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      await t.database.migrator
        .updateTable('exams')
        .set({ cancel_cause: 'cancelled' })
        .where('id', '=', exam)
        .execute();
      const refused = await restore(s.branch, store);
      refusedWith(refused, 409, 'forced_delete_parent_changed');
      expect(detailsOf(refused)).toEqual([
        expect.objectContaining({ path: 'exams', code: 'exam_cancelled' }),
      ]);
      expect(await blockOf(lesson.block_id)).toBeUndefined();
      expect(await classOutsOf(lesson.block_id)).toEqual([]);
    });

    it('is refused after its 30 days', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, '2027-01-25');
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      // The 30 days are a stored moment, compared with the clock on each request.
      await t.database.migrator
        .updateTable('forced_deletes')
        .set({ restore_until: new Date(START) })
        .where('id', '=', store)
        .execute();
      refusedWith(await restore(s.branch, store), 409, 'forced_delete_expired');
      const listed = forcedDeleteListSchema.parse((await list(s.branch)).body);
      expect(listed.entries.find((one) => one.id === store)?.restorable).toBe(false);
      expect(await rowOf(lesson.id)).toBeUndefined();
    });

    it('is refused when a later version is in force on the date', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, '2026-11-30');
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      const later = await republish(s, '2026-11-02');
      expect((await later()).status).toBe(200);
      refusedWith(await restore(s.branch, store), 409, 'forced_delete_version');
    });

    it('is refused when the room went to another lesson, every rule checked again', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      await t.database.migrator
        .updateTable('lessons')
        .set({ room_id: s.room })
        .where('id', '=', (await lessonOf(s, NEXT_MONDAY, s.otherClass)).id)
        .execute();
      refusedWith(await restore(s.branch, store), 409, 'forced_delete_restore_blocked');
      expect(await rowOf(lesson.id)).toBeUndefined();
    });

    it('is refused when the exam that cancelled the lesson no longer stands', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const exam = await t.database.migrator
        .insertInto('exams')
        .values({
          branch_id: s.branch,
          academic_year_id: s.year,
          exam_date: NEXT_MONDAY,
          starts_at: lesson.starts_at,
          ends_at: lesson.ends_at,
          first_slot: 1,
          last_slot: 1,
          title: 'Quarter exam',
          cancel_cause: 'cancelled',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('lessons')
          .set({ cancel_cause: 'exam' })
          .where('id', '=', lesson.id)
          .execute();
        await transaction
          .insertInto('lesson_exam_cancels')
          .values({ branch_id: s.branch, lesson_id: lesson.id, exam_id: exam.id })
          .execute();
      });
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      refusedWith(await restore(s.branch, store), 409, 'forced_delete_parent_changed');
    });

    it('is refused when another branch’s lesson of the teacher is committed between the check and the write (23P01)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      // The teacher also works in another branch, where a lesson at the same
      // time is written and held open while the restore runs.
      const away = await scene();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.teacher.staffId, branch_id: away.branch, is_main: false })
        .execute();
      const awayLesson = await lessonOf(away, NEXT_MONDAY);
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = t.app
        .get(Transactions)
        .run([away.branch], async (transaction: Transaction) => {
          await transaction
            .updateTable('lessons')
            .set({ teacher_id: s.teacher.staffId })
            .where('id', '=', awayLesson.id)
            .execute();
          await heldEntry(transaction, away.branch);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const restored = restore(s.branch, store).then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      release();
      expect(await held).toBeUndefined();
      // The application's check passed; the claims constraint refused it.
      refusedWith(await restored, 409, 'forced_delete_restore_blocked');
      expect(await rowOf(lesson.id)).toBeUndefined();
      const [row] = await t.database.migrator
        .selectFrom('forced_deletes')
        .select('restored_at')
        .where('id', '=', store)
        .execute();
      expect(row?.restored_at).toBeNull();
    });

    it('is refused in a closed year', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status: 'current' })
        .where('id', '=', s.year)
        .where('status', '=', 'planned')
        .execute();
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status: 'closed' })
        .where('id', '=', s.year)
        .execute();
      refusedWith(await restore(s.branch, store), 409, 'timetable_year_closed');
      expect(await rowOf(lesson.id)).toBeUndefined();
    });

    it('refuses a body with a field of its own as an input error', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2027-02-15');
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      refusedWith(
        await keyed(
          `/api/forced-deletes/${store}/restore`,
          s.branch,
          { roomId: UNKNOWN },
          t.admin,
          randomUUID(),
        ),
        400,
        'validation_failed',
      );
    });

    it('maps the claims and the commit checks of 0058 to forced_delete_restore_blocked', () => {
      for (const name of [
        'time_claims_teacher_excl',
        'time_claims_room_excl',
        'time_claims_class_excl',
        'room_shared_full',
        'room_shared_capacity',
        'lesson_block_student_twice',
      ]) {
        expect(RESTORE_REFUSALS[name]).toBe('forced_delete_restore_blocked');
      }
    });

    it('is refused to the Academic Vice Principal, the Principal and a Teacher (the harness tries every role), and answers 404 for another branch’s and an unknown id', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-12-07');
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      const other = await scene();
      const foreign = storeOf(
        await forceDelete(other.branch, (await lessonOf(other, NEXT_MONDAY)).id),
      );
      const before = await everything();
      for (const cookie of [t.vicePrincipal, t.principal, t.teacher]) {
        refusedWith(await restore(s.branch, store, cookie), 403, 'permission_denied');
        refusedWith(await list(s.branch, cookie), 403, 'permission_denied');
      }
      refusedWith(await restore(t.north, foreign), 404, 'not_found');
      refusedWith(await restore(t.north, UNKNOWN), 404, 'not_found');
      expect(await everything()).toEqual(before);
      // The list holds the branch's records only.
      const listed = forcedDeleteListSchema.parse((await list(t.north)).body);
      expect(listed.entries.map((one) => one.id)).toContain(store);
      expect(listed.entries.map((one) => one.id)).not.toContain(foreign);
    });

    it('keeps a used key to its account, its branch and its role (request keys)', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-12-14');
      const store = storeOf(await forceDelete(s.branch, lesson.id));
      const other = await scene();
      const foreign = storeOf(
        await forceDelete(other.branch, (await lessonOf(other, NEXT_MONDAY)).id),
      );
      const key = randomUUID();
      done(await restore(s.branch, store, t.admin, key));
      const after = await everything();
      done(await restore(s.branch, store, t.admin, key));
      expect(await everything()).toEqual(after);
      refusedWith(await restore(s.branch, store, second.cookie, key), 409, 'request_key_reused');
      refusedWith(await restore(s.branch, foreign, t.admin, key), 404, 'not_found');
      refusedWith(await restore(s.branch, UNKNOWN, t.admin, key), 404, 'not_found');
      refusedWith(await restore(s.branch, store, t.vicePrincipal, key), 403, 'permission_denied');
      expect(await everything()).toEqual(after);
    });
  });

  describe('at the same moment', () => {
    it('a restore and a publish of the date: the restore first is replaced by the publish; the publish first refuses the restore', async () => {
      for (const restoreFirst of [true, false]) {
        const s = await scene();
        const lesson = await lessonOf(s, '2026-11-30');
        const store = storeOf(await forceDelete(s.branch, lesson.id));
        const later = await republish(s, '2026-11-02');
        const [one, two] = await inOrder(
          s.branch,
          restoreFirst ? () => restore(s.branch, store) : later,
          restoreFirst ? later : () => restore(s.branch, store),
        );
        const [restored, published] = restoreFirst ? [one, two] : [two, one];
        expect(published.status, JSON.stringify(published.body)).toBe(200);
        if (restoreFirst) {
          done(restored);
          expect((await lessonOf(s, '2026-11-30')).teacher_id).toBe(s.spareTeacher.staffId);
        } else {
          refusedWith(restored, 409, 'forced_delete_version');
        }
      }
    });

    it('a forced delete and a one-day cancel of the lesson: the delete first leaves nothing to cancel; the cancel first is kept in the store', async () => {
      for (const deleteFirst of [true, false]) {
        const s = await scene();
        const lesson = await lessonOf(s, NEXT_MONDAY);
        const cancel = () =>
          keyed(
            `/api/timetable/lessons/${lesson.id}/cancel`,
            s.branch,
            { reason: 'Excursion' },
            t.admin,
            randomUUID(),
          );
        const [one, two] = await inOrder(
          s.branch,
          deleteFirst ? () => forceDelete(s.branch, lesson.id) : cancel,
          deleteFirst ? cancel : () => forceDelete(s.branch, lesson.id),
        );
        const [deleted, cancelled] = deleteFirst ? [one, two] : [two, one];
        const answer = done(deleted);
        if (deleteFirst) {
          refusedWith(cancelled, 404, 'not_found');
          expect(answer.lesson.cancelCause).toBeNull();
        } else {
          expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
          expect(answer.lesson.cancelCause).toBe('reason');
        }
      }
    });
  });

  describe('at the same moment, a class held', () => {
    it('a forced delete and an archive of the lesson’s class: neither waits on the other in a cycle; the archive is refused while the class has lessons ahead', async () => {
      for (const deleteFirst of [true, false]) {
        const s = await scene();
        const lesson = await lessonOf(s, NEXT_MONDAY);
        const archive = () =>
          request(t.kit.server)
            .post(`/api/classes/${s.classId}/archive`)
            .set('Cookie', t.admin)
            .set(BRANCH_HEADER, s.branch)
            .send({});
        const [one, two] = await inOrder(
          s.branch,
          deleteFirst ? () => forceDelete(s.branch, lesson.id) : archive,
          deleteFirst ? archive : () => forceDelete(s.branch, lesson.id),
          // The class row held for update, as the archive holds it.
          (transaction) =>
            transaction
              .selectFrom('classes')
              .select('id')
              .where('id', '=', s.classId)
              .forUpdate()
              .execute(),
        );
        const [deleted, archived] = deleteFirst ? [one, two] : [two, one];
        done(deleted);
        refusedWith(archived, 409, 'class_has_lessons');
        expect(await rowOf(lesson.id)).toBeUndefined();
      }
    });
  });

  describe('the history of a lesson', () => {
    it('lists who changed what, when, before and after, for the Principal too', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2027-02-08');
      const cancelled = await keyed(
        `/api/timetable/lessons/${lesson.id}/cancel`,
        s.branch,
        { reason: 'Excursion' },
        t.admin,
        randomUUID(),
      );
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const response = await history(s.branch, lesson.id, t.admin);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const answer = lessonHistorySchema.parse(response.body);
      expect(answer.lines).toHaveLength(1);
      expect(answer.lines[0]).toMatchObject({
        kind: 'changed',
        who: { id: adminAccount },
        cancelCause: { before: null, after: 'reason' },
        cancelReason: { before: null, after: 'Excursion' },
        teacher: { before: { id: s.teacher.staffId }, after: { id: s.teacher.staffId } },
      });
      expect(answer.lines[0]?.changedAt).toBe(new Date(START).toISOString());
      // A lesson force-deleted keeps its history.
      done(await forceDelete(s.branch, lesson.id));
      const principal = lessonHistorySchema.parse(
        (await history(s.branch, lesson.id, t.principal)).body,
      );
      expect(principal.lines.map((one) => one.kind)).toEqual(['changed', 'forced_delete']);
    });

    it('names "the system" for a change whose entry has no actor, as a job writes it', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      await t.app.get(Transactions).run([s.branch], async (transaction: Transaction) => {
        await transaction
          .updateTable('lessons')
          .set({ teacher_id: s.spareTeacher.staffId })
          .where('id', '=', lesson.id)
          .execute();
        await heldEntry(transaction, s.branch);
      });
      const answer = lessonHistorySchema.parse((await history(s.branch, lesson.id)).body);
      expect(answer.lines).toHaveLength(1);
      expect(answer.lines[0]).toMatchObject({
        kind: 'changed',
        who: null,
        teacher: { before: { id: s.teacher.staffId }, after: { id: s.spareTeacher.staffId } },
      });
    });

    it('is refused to a Teacher and answers 404 for another branch’s and an unknown lesson', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2027-02-01');
      const other = await scene();
      refusedWith(await history(s.branch, lesson.id, t.teacher), 403, 'permission_denied');
      // The other branch's lesson has history lines and no lesson row left:
      // only the branch of the lines keeps them out.
      const foreign = await lessonOf(other, NEXT_MONDAY);
      done(await forceDelete(other.branch, foreign.id));
      expect(await historyOf(foreign.id)).toHaveLength(1);
      refusedWith(await history(t.north, foreign.id), 404, 'not_found');
      refusedWith(await history(t.north, UNKNOWN), 404, 'not_found');
    });
  });
});
