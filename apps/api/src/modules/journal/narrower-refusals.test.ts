import { randomUUID } from 'node:crypto';
import { REQUEST_KEY_HEADER, cellHistorySchema, journalExportListSchema } from '@sodiq/shared';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { RecordingPdf } from '../../testing/pdf-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { MemoryPhotoStore } from '../people/photo-store.js';
import { saveCells } from './cells.js';

/** Tuesday 27 October 2026, noon in Tashkent, inside the first quarter of the scene. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ??
  `status ${String(response.status)}`;

// All names are invented. Task 10.3a: the limits inside the routes for the
// whole-branch roles (`narrower`). docs/spec/07-journal.md, Who can do what:
// the Vice Principal for Spiritual and Moral Education sees attendance; the
// export of the whole branch is for the readers of every journal whole (task
// 8.9, decision 3), as the Head Tutor's refusal in journal-exports.test.ts.
describe('the journal routes held narrower for a whole-branch role', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  /** A new account holding the role in the branch from 1 September, its session in use at MOMENT. */
  const reader = async (role: 'spiritual_vice_principal', branchId: string) => {
    names += 1;
    const browser = await t.kit.completeSession('Gulnora', `Tojiyeva${'a'.repeat(names % 7)}`);
    // An assignment in the branch of the request: the guard lets the role in.
    await t.kit.giveRole(browser.account.id, {
      role,
      branchId,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    t.clock.set(MOMENT);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
      .where('account_id', '=', browser.account.id)
      .execute();
    return browser;
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({
      jobs: true,
      photoStore: new MemoryPhotoStore(),
      pdfRenderer: new RecordingPdf(),
    });
    load = new LoadKit(t.database.migrator);
  });

  afterEach(() => {
    t.clock.set(START);
  });

  afterAll(async () => {
    await t.close();
  });

  it('refuses the branch export to the Spiritual Vice Principal, a reader of attendance, with nothing written', async () => {
    const s = await publishedScene(t, load, { graded: true });
    const quarter = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', s.year)
      .where('number', '=', 1)
      .executeTakeFirstOrThrow();
    const browser = await reader('spiritual_vice_principal', s.branch);

    const exportsBefore = await t.database.migrator
      .selectFrom('journal_exports')
      .select('id')
      .execute();
    const auditBefore = await t.database.migrator
      .selectFrom('audit_log')
      .select(({ fn }) => fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();

    const asked = await t
      .post(
        '/api/journal/exports',
        s.branch,
        { format: 'xlsx', quarterId: quarter.id },
        browser.cookie,
      )
      .set(REQUEST_KEY_HEADER, randomUUID());
    expect(asked.status, JSON.stringify(asked.body)).toBe(403);
    expect(codeOf(asked)).toBe('journal_export_scope');

    const list = journalExportListSchema.parse(
      (await t.get('/api/journal/exports', s.branch, browser.cookie)).body,
    );
    expect(list).toMatchObject({ canExportBranch: false, exports: [] });

    expect(await t.database.migrator.selectFrom('journal_exports').select('id').execute()).toEqual(
      exportsBefore,
    );
    expect(
      await t.database.migrator
        .selectFrom('audit_log')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ).toEqual(auditBefore);
  });

  it('answers the Spiritual Vice Principal the attendance lines of a cell only, no work line', async () => {
    const s = await publishedScene(t, load, { graded: true });
    const lesson = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', s.classId)
      .where('lesson_date', '<=', '2026-10-31')
      .orderBy('starts_at')
      .executeTakeFirstOrThrow();
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const student = await members.student(s.branch, { startsOn: '2026-09-01', grade: 7 });
    await members.member({
      branch: s.branch,
      classId: s.classId,
      studentId: student,
      from: '2026-09-01',
    });
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.branch, lesson_id: lesson.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    // A mark and a score typed in the edit period: one attendance line, one work line.
    t.clock.set(MOMENT);
    const writer = await load.classes.account();
    await t.app.get(Transactions).run([s.branch], (transaction) =>
      saveCells(transaction, t.app.get(Audit), { accountId: writer }, [
        { lessonId: lesson.id, studentId: student, workId: null, value: 1, version: null },
        { lessonId: lesson.id, studentId: student, workId: work, value: 7, version: null },
      ]),
    );
    const workLines = await t.database.migrator
      .selectFrom('journal_cell_history')
      .select('id')
      .where('work_id', '=', work)
      .execute();
    // The fixture holds a score line the route must leave out.
    expect(workLines.length).toBeGreaterThan(0);

    const browser = await reader('spiritual_vice_principal', s.branch);
    const answer = await t.get(
      `/api/journal/lessons/${lesson.id}/students/${student}/history`,
      s.branch,
      browser.cookie,
    );
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const history = cellHistorySchema.parse(answer.body);
    expect(history.lines.length).toBeGreaterThan(0);
    expect(history.lines.every((line) => line.work === null)).toBe(true);
    expect(history.workLines).toEqual([]);
  });
});
