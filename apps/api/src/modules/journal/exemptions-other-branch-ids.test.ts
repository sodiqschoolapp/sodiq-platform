import { randomUUID } from 'node:crypto';
import {
  REQUEST_KEY_HEADER,
  exemptionCreatedSchema,
  exemptionListSchema,
  type ExemptionChoice,
  type ExemptionCreate,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { UNKNOWN_ID, expectNotFound, expectRefusedById } from '../../testing/id-refusal-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

/** The tables the exemption routes write, also through `settle` and the notices. */
const WRITTEN = [
  'exemptions',
  'exemption_subjects',
  'exemption_spans',
  'exemption_skips',
  'exemption_clears',
  'exemption_reopened_cells',
  'exemption_move_offers',
  'journal_cells',
  'notifications',
  'request_keys',
] as const;

// All names are invented. Task 10.3b: every id the exemption routes take, sent as another
// branch's record and as an unknown one, by the Super Admin, who passes the guard in every branch
// (`.claude/rules/api.md`, tasks 1.3, 1.5 and 5.5a-1).
describe('exemptions: ids of another branch', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let admin = '';

  const student = async (branch: string, classId: string, last: string): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Olim', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({ branch, classId, studentId: id, from: '2026-09-01' });
    return id;
  };

  /** A published branch with maths of two classes on Monday and three students. */
  async function scene() {
    const s = await publishedScene(t, load, { graded: true });
    const lesson = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', s.classId)
      .where('lesson_date', '=', '2026-10-12')
      .executeTakeFirstOrThrow();
    return {
      ...s,
      lesson: lesson.id,
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.classId, 'Boboyev'),
      other: await student(s.branch, s.otherClass, 'Sobirov'),
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The clock at the moment, with the Super Admin's session in use then. */
  const adminAt = async (moment: string) => {
    t.clock.set(moment);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .where('account_id', '=', admin)
      .execute();
  };

  const post = (branch: string, path: string, body: object = {}, key = randomUUID()) =>
    t.post(path, branch, body).set(REQUEST_KEY_HEADER, key);

  const body = (input: Partial<ExemptionCreate> & { studentIds: string[] }): ExemptionCreate => ({
    kind: 'temporary',
    subjectIds: null,
    startDate: '2026-11-16',
    endDate: '2026-11-18',
    slots: null,
    category: 'illness',
    detail: 'A certificate from the clinic',
    choices: [],
    ...input,
  });

  const created = async (branch: string, input: ExemptionCreate) => {
    const made = await post(branch, '/api/exemptions', input);
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const answer = exemptionCreatedSchema.parse(made.body);
    return { id: answer.exemptions[0]?.id ?? '', batchId: answer.batchId };
  };

  /** The `from` scene's student moved to the `to` scene's branch with an exemption: an offer waits there. */
  async function offered(from: Scene, to: Scene, studentId: string): Promise<string> {
    await created(
      from.branch,
      body({ studentIds: [studentId], startDate: '2026-10-19', endDate: '2026-11-20' }),
    );
    const read = await t.get(`/api/people/students/${studentId}`, from.branch);
    const released = await t.post(`/api/people/students/${studentId}/branch-move`, from.branch, {
      toBranchId: to.branch,
      from: '2026-10-27',
      version: (read.body as { version: number }).version,
    });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    const move = await t.database.migrator
      .selectFrom('student_branch_moves')
      .select('id')
      .where('student_id', '=', studentId)
      .executeTakeFirstOrThrow();
    const accepted = await t.post(`/api/people/branch-moves/${move.id}/accept`, to.branch, {
      classId: to.otherClass,
      groups: [],
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const offer = await t.database.migrator
      .selectFrom('exemption_move_offers')
      .select('id')
      .where('student_id', '=', studentId)
      .executeTakeFirstOrThrow();
    return offer.id;
  }

  let s: Scene;
  let e: Scene;
  /** The exemption and batch of each branch. */
  let own: { id: string; batchId: string };
  let theirs: { id: string; batchId: string };
  /** An offer waiting in each branch. */
  let ownOffer = '';
  let theirOffer = '';

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    admin = (
      await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.adminAssignment)
        .executeTakeFirstOrThrow()
    ).account_id;
    s = await scene();
    e = await scene();
    await adminAt(MOMENT);
    own = await created(s.branch, body({ studentIds: [s.ahmedov] }));
    theirs = await created(
      e.branch,
      body({ studentIds: [e.ahmedov], subjectIds: [e.subject], kind: 'temporary' }),
    );
    ownOffer = await offered(e, s, e.other);
    theirOffer = await offered(s, e, s.other);
  });

  afterAll(async () => {
    t.clock.set(START);
    await t.close();
  });

  const refused = (send: (id: string) => Promise<Response>, ids = [theirs.id, UNKNOWN_ID]) =>
    expectRefusedById({ database: t.database.migrator, tables: WRITTEN, ids, send });

  const choice = (studentId: string, lessonId: string): ExemptionChoice[] => [
    { studentId, lessonId, choice: 'keep' },
  ];
  const edit = (input: { subjectIds?: string[]; choices?: ExemptionChoice[] } = {}) => ({
    kind: 'temporary',
    subjectIds: input.subjectIds ?? null,
    startDate: '2026-11-16',
    endDate: '2026-11-17',
    slots: null,
    category: 'illness',
    detail: 'x',
    version: 1,
    choices: input.choices ?? [],
  });
  const end = (choices: ExemptionChoice[] = []) => ({ version: 1, endDate: '2026-11-17', choices });
  const batchEnd = (choices: ExemptionChoice[] = []) => ({ endDate: '2026-11-17', choices });

  it('answers no exemption of another branch to the filters of GET /api/exemptions', async () => {
    const theirIds = async (branch: string, query: string) => {
      const answer = await t.get(`/api/exemptions?${query}`, branch);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      return exemptionListSchema
        .parse(answer.body)
        .items.map((one) => one.id)
        .filter((id) => id === theirs.id);
    };
    for (const query of [
      `classId=${e.classId}`,
      `subjectId=${e.subject}`,
      `studentId=${e.ahmedov}`,
      `batchId=${theirs.batchId}`,
    ]) {
      // The filter matches the other branch's exemption there.
      expect(await theirIds(e.branch, query)).toEqual([theirs.id]);
      expect(await theirIds(s.branch, query)).toEqual([]);
    }
    // An unknown id answers nothing of the other branch either (an exemption of all subjects of
    // the own branch meets any subject).
    for (const field of ['classId', 'subjectId', 'studentId', 'batchId']) {
      expect(await theirIds(s.branch, `${field}=${UNKNOWN_ID}`)).toEqual([]);
    }
  });

  it('answers 404 for an exemption of another branch on GET /api/exemptions/:id and its reason', async () => {
    for (const id of [theirs.id, UNKNOWN_ID]) {
      expectNotFound(await t.get(`/api/exemptions/${id}`, s.branch));
    }
    // An opening of a reason is logged: the audit log stays as it was.
    await expectRefusedById({
      database: t.database.migrator,
      tables: [],
      ids: [theirs.id, UNKNOWN_ID],
      send: (id) => t.get(`/api/exemptions/${id}/reason`, s.branch),
    });
  });

  it('answers 404 for an offer of another branch on /api/exemptions/move-offers/:id confirm, its preview and drop', async () => {
    const ids = [theirOffer, UNKNOWN_ID];
    await refused((id) => post(s.branch, `/api/exemptions/move-offers/${id}/confirm/preview`), ids);
    await refused(
      (id) => post(s.branch, `/api/exemptions/move-offers/${id}/confirm`, { choices: [] }),
      ids,
    );
    await refused((id) => post(s.branch, `/api/exemptions/move-offers/${id}/drop`), ids);
  });

  it('answers 404 for a student and a lesson of another branch in the choices of /api/exemptions/move-offers/:id/confirm', async () => {
    await refused(
      (id) =>
        post(s.branch, `/api/exemptions/move-offers/${ownOffer}/confirm`, {
          choices: choice(id, s.lesson),
        }),
      [e.ahmedov, UNKNOWN_ID],
    );
    await refused(
      (id) =>
        post(s.branch, `/api/exemptions/move-offers/${ownOffer}/confirm`, {
          choices: choice(e.other, id),
        }),
      [e.lesson, UNKNOWN_ID],
    );
  });

  it('answers 404 for every id of another branch in the body of POST /api/exemptions and its preview', async () => {
    for (const path of ['/api/exemptions', '/api/exemptions/preview']) {
      await refused(
        (id) => post(s.branch, path, body({ studentIds: [s.boboyev, id] })),
        [e.ahmedov, UNKNOWN_ID],
      );
      // Subjects are of the whole school: an unknown one.
      await refused(
        (id) => post(s.branch, path, body({ studentIds: [s.boboyev], subjectIds: [id] })),
        [UNKNOWN_ID],
      );
      await refused(
        (id) =>
          post(s.branch, path, body({ studentIds: [s.boboyev], choices: choice(id, s.lesson) })),
        [e.ahmedov, UNKNOWN_ID],
      );
      await refused(
        (id) =>
          post(s.branch, path, body({ studentIds: [s.boboyev], choices: choice(s.boboyev, id) })),
        [e.lesson, UNKNOWN_ID],
      );
    }
  });

  it('answers 404 for a repeat of a used key of POST /api/exemptions with an id of another branch, never the stored answer', async () => {
    const key = randomUUID();
    const first = await post(
      s.branch,
      '/api/exemptions',
      body({ studentIds: [s.boboyev], startDate: '2026-11-23', endDate: '2026-11-25' }),
      key,
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const again = (input: Partial<ExemptionCreate>) =>
      post(
        s.branch,
        '/api/exemptions',
        body({
          studentIds: [s.boboyev],
          startDate: '2026-11-23',
          endDate: '2026-11-25',
          ...input,
        }),
        key,
      );
    await refused((id) => again({ studentIds: [id] }), [e.ahmedov, UNKNOWN_ID]);
    await refused((id) => again({ subjectIds: [id] }), [UNKNOWN_ID]);
    await refused((id) => again({ choices: choice(id, s.lesson) }), [e.ahmedov, UNKNOWN_ID]);
    await refused((id) => again({ choices: choice(s.boboyev, id) }), [e.lesson, UNKNOWN_ID]);
  });

  it('answers 404 for every id of another branch in the body of PATCH /api/exemptions/:id and its edit/preview', async () => {
    const send = (input: (id: string) => Parameters<typeof edit>[0]) => async (id: string) => {
      const path = `/api/exemptions/${own.id}`;
      const preview = await post(s.branch, `${path}/edit/preview`, edit(input(id)));
      expectNotFound(preview);
      return t.patch(path, s.branch, edit(input(id)));
    };
    await refused(
      send((id) => ({ subjectIds: [id] })),
      [UNKNOWN_ID],
    );
    await refused(
      send((id) => ({ choices: choice(id, s.lesson) })),
      [e.ahmedov, UNKNOWN_ID],
    );
    await refused(
      send((id) => ({ choices: choice(s.ahmedov, id) })),
      [e.lesson, UNKNOWN_ID],
    );
  });

  it('answers 404 for every id of another branch in the body of /api/exemptions/:id/end and its preview', async () => {
    for (const path of [`/api/exemptions/${own.id}/end`, `/api/exemptions/${own.id}/end/preview`]) {
      await refused(
        (id) => post(s.branch, path, end(choice(id, s.lesson))),
        [e.ahmedov, UNKNOWN_ID],
      );
      await refused(
        (id) => post(s.branch, path, end(choice(s.ahmedov, id))),
        [e.lesson, UNKNOWN_ID],
      );
    }
  });

  it('answers 404 for every id of another branch in the body of /api/exemptions/batches/:batchId/end and its preview', async () => {
    for (const path of [
      `/api/exemptions/batches/${own.batchId}/end`,
      `/api/exemptions/batches/${own.batchId}/end/preview`,
    ]) {
      await refused(
        (id) => post(s.branch, path, batchEnd(choice(id, s.lesson))),
        [e.ahmedov, UNKNOWN_ID],
      );
      await refused(
        (id) => post(s.branch, path, batchEnd(choice(s.ahmedov, id))),
        [e.lesson, UNKNOWN_ID],
      );
    }
  });

  // Permission review of 10.3b: the choices are checked before the batch is found empty.
  it('answers 404 for a choice of another branch on /api/exemptions/batches/:batchId/end of a batch with every exemption voided', async () => {
    const voided = await created(
      s.branch,
      body({ studentIds: [s.boboyev], startDate: '2026-11-30', endDate: '2026-12-02' }),
    );
    const gone = await post(s.branch, `/api/exemptions/${voided.id}/void`, {
      version: 1,
      reason: 'Entered for the wrong student',
    });
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    const path = `/api/exemptions/batches/${voided.batchId}/end`;
    // With the own ids, the empty batch is what is refused.
    const empty = await post(s.branch, path, batchEnd(choice(s.ahmedov, s.lesson)));
    expect(empty.status, JSON.stringify(empty.body)).toBe(409);
    expect((empty.body as { error: { code: string } }).error.code).toBe('exemption_batch_empty');
    await refused(
      (id) => post(s.branch, path, batchEnd(choice(id, s.lesson))),
      [e.ahmedov, UNKNOWN_ID],
    );
    await refused(
      (id) => post(s.branch, path, batchEnd(choice(s.ahmedov, id))),
      [e.lesson, UNKNOWN_ID],
    );
  });

  it('answers 404 for an exemption of another branch on every change of /api/exemptions/:id', async () => {
    await refused((id) => t.patch(`/api/exemptions/${id}`, s.branch, edit()));
    await refused((id) => post(s.branch, `/api/exemptions/${id}/edit/preview`, edit()));
    await refused((id) => post(s.branch, `/api/exemptions/${id}/end`, end()));
    await refused((id) => post(s.branch, `/api/exemptions/${id}/end/preview`, end()));
    await refused((id) =>
      post(s.branch, `/api/exemptions/${id}/void`, { version: 1, reason: 'Wrong student' }),
    );
    await refused((id) => post(s.branch, `/api/exemptions/${id}/void/preview`, { version: 1 }));
  });

  it('answers 404 for a batch of another branch on every change of /api/exemptions/batches/:batchId', async () => {
    const ids = [theirs.batchId, UNKNOWN_ID];
    await refused((id) => post(s.branch, `/api/exemptions/batches/${id}/end`, batchEnd()), ids);
    await refused(
      (id) => post(s.branch, `/api/exemptions/batches/${id}/end/preview`, batchEnd()),
      ids,
    );
    await refused(
      (id) => post(s.branch, `/api/exemptions/batches/${id}/void`, { reason: 'Wrong students' }),
      ids,
    );
    await refused((id) => post(s.branch, `/api/exemptions/batches/${id}/void/preview`), ids);
  });

  // The fixture is real: the other branch's records are there and its own requests pass.
  it('holds the records sent, each answered in its own branch', async () => {
    expect((await t.get(`/api/exemptions/${theirs.id}`, e.branch)).status).toBe(200);
    expect((await t.get(`/api/exemptions/${own.id}`, s.branch)).status).toBe(200);
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from exemption_move_offers where id = any(${[ownOffer, theirOffer]}::uuid[])
    `.execute(t.database.migrator);
    expect(rows.rows[0]?.n).toBe(2);
  });
});
