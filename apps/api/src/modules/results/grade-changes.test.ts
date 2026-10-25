import { gradeChangesSchema, type GradeChanges } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const changesOf = (response: Response): GradeChanges => {
  expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
  return gradeChangesSchema.parse(response.body);
};

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

// All names are invented. Task 9.1: the preview, the reason and the notice of a change of a
// quarter's weights or of its late and skipped values (docs/spec/edge-cases/calculation.md,
// "Quarterly weights are changed in week 7": "Before saving, the system shows how many grades
// will change in each journal, asks for a reason and tells the subject's teachers"; "The value
// of 'late' is changed from 50 to 75": "with the same preview"; From 1.6 decision 3 and
// From 2.1 decision 4; decisions 2, 3, 5 and 11).
describe('the preview and the reason of a change of weights or values', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Sevara', `Yusupova${'a'.repeat(names % 5)}`);
  };

  const saveOn = async (
    branch: string,
    date: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
    t.clock.set(`${date}T18:00:00+05:00`);
    try {
      const writer = await load.classes.account();
      await t.app.get(Transactions).run([branch], (transaction) =>
        saveCells(
          transaction,
          t.app.get(Audit),
          { accountId: writer },
          cells.map((cell) => ({
            lessonId: cell.lessonId,
            studentId: cell.studentId,
            workId: cell.workId ?? null,
            value: cell.value,
            version: null,
          })),
        ),
      );
    } finally {
      t.clock.set(START);
    }
  };

  /** Runs `work` with the clock at MOMENT and the sessions used then. */
  const at = async <T>(work: () => Promise<T>, moment = MOMENT): Promise<T> => {
    t.clock.set(moment);
    // The kit's sessions are used at the moment, so idle sign-out does not end them.
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .execute();
    try {
      return await work();
    } finally {
      t.clock.set(START);
    }
  };

  /**
   * The graded maths scene (20 · 40 · 40 in every quarter) with Aziz (present on the 12th
   * with 9 of 10, absent on the 19th: 76.7, grade 4) and Bekzod (late on the 12th with 10 of
   * 10: (20 × 50 + 40 × 100) ÷ 60 = 83.3, grade 4).
   */
  async function scene() {
    const owner = await account();
    const spare = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id, spare: spare.account.id },
    });
    const lessons = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', sql<string>`lesson_date::text`.as('date')])
      .where('class_id', '=', s.classId)
      .where('lesson_date', '<=', '2026-10-31')
      .orderBy('starts_at')
      .execute();
    const [l12, l19] = lessons;
    if (l12 === undefined || l19 === undefined) throw new Error('Two lessons.');
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const placed = async () => {
      const id = await kit.student(s.branch, { startsOn: '2026-09-01', grade: 7 });
      await kit.member({ branch: s.branch, classId: s.classId, studentId: id, from: '2026-09-01' });
      return id;
    };
    const aziz = await placed();
    const bekzod = await placed();
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.branch, lesson_id: l12.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await saveOn(s.branch, l12.date, [
      { lessonId: l12.id, studentId: aziz, value: 1 },
      { lessonId: l12.id, studentId: aziz, workId: work, value: 9 },
      { lessonId: l12.id, studentId: bekzod, value: 2 },
      { lessonId: l12.id, studentId: bekzod, workId: work, value: 10 },
    ]);
    await saveOn(s.branch, l19.date, [{ lessonId: l19.id, studentId: aziz, value: 0 }]);
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .executeTakeFirstOrThrow()
    ).id;
    const quarters = (
      await t.database.migrator
        .selectFrom('quarters')
        .select(['id', 'number'])
        .where('academic_year_id', '=', s.year)
        .orderBy('number')
        .execute()
    ).map((one) => one.id);
    return { s, owner, spare, journal, quarters, aziz, bekzod };
  }

  /** Every row the writes touch, in every branch, and the audit log. */
  const rowsOf = async () => ({
    weights: await t.database.migrator
      .selectFrom('subject_quarter_weights')
      .selectAll()
      .orderBy(['branch_id', 'subject_id', 'quarter_id'])
      .execute(),
    quarters: await t.database.migrator.selectFrom('quarters').selectAll().orderBy('id').execute(),
    audit: (
      await t.database.migrator
        .selectFrom('audit_log')
        .select(sql<number>`count(*)::int`.as('count'))
        .executeTakeFirstOrThrow()
    ).count,
    notifications: (
      await t.database.migrator
        .selectFrom('notifications')
        .select(sql<number>`count(*)::int`.as('count'))
        .executeTakeFirstOrThrow()
    ).count,
  });

  const noticesOf = (accountId: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['kind', 'data', 'branch_id'])
      .where('account_id', '=', accountId)
      .where('kind', '=', 'setup.quarter_weights_changed')
      .orderBy('created_at')
      .orderBy('id')
      .execute();

  /** 60 · 20 · 20: Aziz (60 × 50 + 20 × 90) ÷ 80 = 60, grade 3; Bekzod 62.5, grade 3. */
  const CHANGED = { attendance: 60, classwork: 20, homework: 20, ratingExam: null };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('shows how many grades a weights change alters in each journal, and changes nothing', async () => {
    const x = await scene();
    const before = await rowsOf();
    const preview = changesOf(
      await at(() =>
        t.post(
          `/api/setup/subjects/${x.s.subject}/quarter-weights/${x.quarters[0] ?? ''}/preview`,
          x.s.branch,
          CHANGED,
        ),
      ),
    );
    expect(preview).toEqual({
      reasonRequired: true,
      quarters: [
        {
          quarterId: x.quarters[0],
          number: 1,
          journals: [
            {
              journalId: x.journal,
              unit: { kind: 'class', id: x.s.classId, name: expect.any(String) as unknown },
              subject: expect.objectContaining({ id: x.s.subject }) as unknown,
              grades: 2,
              results: 2,
            },
          ],
        },
      ],
    });
    expect(await rowsOf()).toEqual(before);
  });

  it('refuses a change of a stored distribution without a reason, and with one stores it, audits the reason and tells the subject’s teachers', async () => {
    const x = await scene();
    const path = `/api/setup/subjects/${x.s.subject}/quarter-weights/${x.quarters[0] ?? ''}`;
    const before = await rowsOf();
    const refused = await at(() => t.put(path, x.s.branch, CHANGED));
    expect(refused.status).toBe(409);
    expect(codeOf(refused)).toBe('reason_required');
    expect(await rowsOf()).toEqual(before);

    const saved = await at(() =>
      t.put(path, x.s.branch, { ...CHANGED, reason: 'Agreed by the department' }),
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const entries = await t.entries('subject_quarter_weights.set', x.s.subject);
    expect(entries.at(-1)).toMatchObject({
      branch_id: x.s.branch,
      details: { quarterId: x.quarters[0], reason: 'Agreed by the department' },
    });
    // The journal's teacher is told in the transaction of the change; a teacher with no
    // journal of the subject is not.
    expect(await noticesOf(x.owner.account.id)).toEqual([
      {
        kind: 'setup.quarter_weights_changed',
        branch_id: x.s.branch,
        data: {
          subject: expect.any(Object) as unknown,
          quarters: [1],
          date: '2026-10-27',
          reason: 'Agreed by the department',
        },
      },
    ]);
    expect(await noticesOf(x.spare.account.id)).toEqual([]);
  });

  it('needs no reason and tells nobody for a first setting or a save that changes nothing, in a started quarter too', async () => {
    const x = await scene();
    await t.database.migrator
      .deleteFrom('subject_quarter_weights')
      .where('branch_id', '=', x.s.branch)
      .where('quarter_id', '=', x.quarters[0] ?? '')
      .execute();
    const path = `/api/setup/subjects/${x.s.subject}/quarter-weights/${x.quarters[0] ?? ''}`;
    const first = await at(() => t.put(path, x.s.branch, CHANGED));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const again = await at(() => t.put(path, x.s.branch, CHANGED));
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(await noticesOf(x.owner.account.id)).toEqual([]);
    // The preview of a save that changes nothing asks for no reason and lists nothing.
    expect(changesOf(await at(() => t.post(`${path}/preview`, x.s.branch, CHANGED)))).toEqual({
      reasonRequired: false,
      quarters: [{ quarterId: x.quarters[0], number: 1, journals: [] }],
    });
  });

  it('asks for a reason in a quarter that has not started, whose preview lists nothing, and tells its teachers of the first day', async () => {
    const x = await scene();
    const path = `/api/setup/subjects/${x.s.subject}/quarter-weights/${x.quarters[1] ?? ''}`;
    expect(changesOf(await at(() => t.post(`${path}/preview`, x.s.branch, CHANGED)))).toEqual({
      reasonRequired: true,
      quarters: [{ quarterId: x.quarters[1], number: 2, journals: [] }],
    });
    expect(codeOf(await at(() => t.put(path, x.s.branch, CHANGED)))).toBe('reason_required');
    const saved = await at(() => t.put(path, x.s.branch, { ...CHANGED, reason: 'Set for Q2' }));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await noticesOf(x.owner.account.id)).map((one) => one.data)).toEqual([
      expect.objectContaining({ quarters: [2], reason: 'Set for Q2' }),
    ]);
  });

  it('previews the copy of quarter 1 for each quarter it writes, refuses it without a reason, and leaves nothing behind', async () => {
    const x = await scene();
    await at(() =>
      t.put(
        `/api/setup/subjects/${x.s.subject}/quarter-weights/${x.quarters[0] ?? ''}`,
        x.s.branch,
        { ...CHANGED, reason: 'Agreed by the department' },
      ),
    );
    const before = await rowsOf();
    const copy = `/api/setup/subjects/${x.s.subject}/quarter-weights/copy`;
    const preview = changesOf(
      await at(() => t.post(`${copy}/preview`, x.s.branch, { yearId: x.s.year })),
    );
    expect(preview.reasonRequired).toBe(true);
    expect(preview.quarters.map((one) => [one.number, one.journals])).toEqual([
      [2, []],
      [3, []],
      [4, []],
    ]);
    const refused = await at(() => t.post(copy, x.s.branch, { yearId: x.s.year }));
    expect(codeOf(refused)).toBe('reason_required');
    expect(await rowsOf()).toEqual(before);
    // With the reason: one notice to the teacher, naming the three quarters it changed.
    const copied = await at(() =>
      t.post(copy, x.s.branch, { yearId: x.s.year, reason: 'One distribution' }),
    );
    expect(copied.status, JSON.stringify(copied.body)).toBe(200);
    expect((await noticesOf(x.owner.account.id)).map((one) => one.data)).toEqual([
      expect.objectContaining({ quarters: [1], reason: 'Agreed by the department' }),
      expect.objectContaining({ quarters: [2, 3, 4], reason: 'One distribution' }),
    ]);
  });

  it('shows the grades a change of late alters, refuses it without a reason, and audits the reason', async () => {
    const x = await scene();
    const path = `/api/setup/quarters/${x.quarters[0] ?? ''}/attendance-values`;
    const before = await rowsOf();
    // Late 75: Bekzod (20 × 75 + 40 × 100) ÷ 60 = 91.7, grade 5; Aziz has no late lesson.
    const preview = changesOf(
      await at(() => t.post(`${path}/preview`, x.s.branch, { lateValue: 75, skippedValue: 0 })),
    );
    expect(preview.reasonRequired).toBe(true);
    expect(
      preview.quarters.map((one) => one.journals.map((j) => [j.journalId, j.grades, j.results])),
    ).toEqual([[[x.journal, 1, 1]]]);
    expect(await rowsOf()).toEqual(before);
    const refused = await at(() => t.put(path, x.s.branch, { lateValue: 75, skippedValue: 0 }));
    expect(codeOf(refused)).toBe('reason_required');
    expect(await rowsOf()).toEqual(before);
    const saved = await at(() =>
      t.put(path, x.s.branch, { lateValue: 75, skippedValue: 0, reason: 'Council decision' }),
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const entries = await t.entries('quarter.attendance_values', x.quarters[0] ?? '');
    expect(entries.at(-1)).toMatchObject({ details: { reason: 'Council decision' } });
  });

  it('refuses in each preview what its write refuses', async () => {
    const x = await scene();
    const weights = `/api/setup/subjects/${x.s.subject}/quarter-weights/${x.quarters[0] ?? ''}/preview`;
    // A rating part the subject has no switch for.
    expect(
      codeOf(
        await at(() =>
          t.post(weights, x.s.branch, {
            attendance: 20,
            classwork: 20,
            homework: 20,
            ratingExam: 40,
          }),
        ),
      ),
    ).toBe('weights_shape_mismatch');
    // A copy with no quarter 1 to copy.
    await t.database.migrator
      .deleteFrom('subject_quarter_weights')
      .where('branch_id', '=', x.s.branch)
      .where('quarter_id', '=', x.quarters[0] ?? '')
      .execute();
    expect(
      codeOf(
        await at(() =>
          t.post(`/api/setup/subjects/${x.s.subject}/quarter-weights/copy/preview`, x.s.branch, {
            yearId: x.s.year,
          }),
        ),
      ),
    ).toBe('quarter_one_not_set');
    // An attendance-only subject has no weights.
    const attendanceOnly = await load.classes.subject({
      grades: [7],
      journalType: 'attendance_only',
    });
    expect(
      codeOf(
        await at(() =>
          t.post(
            `/api/setup/subjects/${attendanceOnly}/quarter-weights/${x.quarters[0] ?? ''}/preview`,
            x.s.branch,
            CHANGED,
          ),
        ),
      ),
    ).toBe('attendance_only_no_weights');
    // A closed year changes nothing.
    await t.database.migrator
      .updateTable('academic_years')
      .set({ status: 'closed' })
      .where('id', '=', x.s.year)
      .execute();
    expect(codeOf(await at(() => t.post(weights, x.s.branch, CHANGED)))).toBe('year_closed');
  });

  it('answers 404 for another branch’s and an unknown quarter and year, and an unknown subject, with every row unchanged', async () => {
    const x = await scene();
    const other = await scene();
    const before = await rowsOf();
    const subject = x.s.subject;
    for (const [path, body] of [
      [
        `/api/setup/quarters/${other.quarters[0] ?? ''}/attendance-values/preview`,
        { lateValue: 75, skippedValue: 0 },
      ],
      [
        `/api/setup/quarters/${UNKNOWN}/attendance-values/preview`,
        { lateValue: 75, skippedValue: 0 },
      ],
      [
        `/api/setup/subjects/${subject}/quarter-weights/${other.quarters[0] ?? ''}/preview`,
        CHANGED,
      ],
      [`/api/setup/subjects/${subject}/quarter-weights/${UNKNOWN}/preview`, CHANGED],
      [`/api/setup/subjects/${UNKNOWN}/quarter-weights/${x.quarters[0] ?? ''}/preview`, CHANGED],
      [`/api/setup/subjects/${subject}/quarter-weights/copy/preview`, { yearId: other.s.year }],
      [`/api/setup/subjects/${subject}/quarter-weights/copy/preview`, { yearId: UNKNOWN }],
      [`/api/setup/subjects/${UNKNOWN}/quarter-weights/copy/preview`, { yearId: x.s.year }],
    ] as const) {
      const response = await at(() => t.post(path, x.s.branch, body));
      expect(response.status, `${path} ${JSON.stringify(response.body)}`).toBe(404);
    }
    expect(await rowsOf()).toEqual(before);
  });

  // The permission review of the code, must-fix 3: the writes now tell teachers, so their 404
  // tests compare the notices too, with a reason sent and an owned journal and a stored
  // distribution in both branches, so that a leaked id would reach the notice.
  it('answers 404 to the writes of weights for another branch’s and an unknown quarter and year, and an unknown subject, with no notice and every row unchanged', async () => {
    const x = await scene();
    const other = await scene();
    const before = await rowsOf();
    const subject = x.s.subject;
    const withReason = { ...CHANGED, reason: 'Agreed by the department' };
    for (const [method, path, body] of [
      [
        'put',
        `/api/setup/subjects/${subject}/quarter-weights/${other.quarters[0] ?? ''}`,
        withReason,
      ],
      ['put', `/api/setup/subjects/${subject}/quarter-weights/${UNKNOWN}`, withReason],
      ['put', `/api/setup/subjects/${UNKNOWN}/quarter-weights/${x.quarters[0] ?? ''}`, withReason],
      [
        'post',
        `/api/setup/subjects/${subject}/quarter-weights/copy`,
        { yearId: other.s.year, reason: 'x' },
      ],
      [
        'post',
        `/api/setup/subjects/${subject}/quarter-weights/copy`,
        { yearId: UNKNOWN, reason: 'x' },
      ],
      [
        'post',
        `/api/setup/subjects/${UNKNOWN}/quarter-weights/copy`,
        { yearId: x.s.year, reason: 'x' },
      ],
    ] as const) {
      const response = await at(() =>
        method === 'put' ? t.put(path, x.s.branch, body) : t.post(path, x.s.branch, body),
      );
      expect(response.status, `${path} ${JSON.stringify(response.body)}`).toBe(404);
    }
    expect(await rowsOf()).toEqual(before);
    expect(await noticesOf(other.owner.account.id)).toEqual([]);
  });
});
