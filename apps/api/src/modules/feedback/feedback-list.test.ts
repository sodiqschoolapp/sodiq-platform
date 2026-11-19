import type { INestApplication } from '@nestjs/common';
import {
  FEEDBACK_HANDLED_LISTED,
  feedbackReportEntrySchema,
  feedbackReportListSchema,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

// Pull request #361 (owner, 19 November 2026): the Feedback reports page of the Super Admin and
// its handled mark. `14`, Whole system, Monitoring: "A feedback button on every page sends a
// report with the page and role attached." CLAUDE.md, "Every change is audited". The harness
// (`route-access-list.ts`) refuses every other role; all names are invented.

const NOW = '2026-11-19T10:00:00+05:00';
const UNKNOWN = '0199a000-0000-7000-8000-000000000999';
const HOUR = 3_600_000;

const ok = (response: Response): unknown => {
  expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
  return response.body;
};

describe('the feedback reports of the Super Admin', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let admin: string;
  let adminAccount: string;
  let named: string;
  let nameless: string;
  const clock = new FixedClock(NOW);

  const list = async () =>
    feedbackReportListSchema.parse(ok(await kit.get('/api/feedback-reports', admin)));

  const mark = (id: string, handled: boolean) => {
    const path = `/api/feedback-reports/${id}/handled`;
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    return (handled ? request(server).post(path) : request(server).delete(path)).set(
      'Cookie',
      admin,
    );
  };

  const entries = () =>
    database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', 'in', ['feedback.handled', 'feedback.reopened'])
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();

  /** A report stored as the button stores it, `hoursAgo` before now. */
  async function report(
    account: string,
    hoursAgo: number,
    fields: { text?: string; handled?: boolean; version?: number } = {},
  ): Promise<string> {
    const createdAt = new Date(new Date(NOW).getTime() - hoursAgo * HOUR);
    const row = await database.migrator
      .insertInto('feedback_reports')
      .values({
        account_id: account,
        roles: ['teacher'],
        page: '/journal',
        text: fields.text ?? `Written ${String(hoursAgo)} hours ago.`,
        created_at: createdAt,
        app_version: fields.version ?? null,
        ...(fields.handled === true ? { handled_at: createdAt, handled_by: adminAccount } : {}),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    const north = await insertBranch(database.migrator, 'North');
    app = await createTestApp({ database: database.app, clock });
    kit = signInKit(app);
    const browser = await kit.completeSession('Dilnoza', 'Karimova');
    await kit.giveRole(browser.account.id, { role: 'super_admin' });
    admin = browser.cookie;
    adminAccount = browser.account.id;
    const people = new ClassesKit(database.migrator);
    await people.person(north, ['uz'], {
      first: 'Dilnoza',
      last: 'Karimova',
      accountId: adminAccount,
    });
    named = (await people.person(north, ['uz'], { first: 'Aziza', last: 'Yusupova' })).accountId;
    nameless = await people.account();
  });

  beforeEach(async () => {
    await database.migrator.deleteFrom('feedback_reports').execute();
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('lists the reports newest first, with the sender, the roles, the page and the version', async () => {
    const older = await report(named, 5, { version: 7 });
    const newer = await report(nameless, 1);

    const answer = await list();

    expect(answer.handledTruncated).toBe(false);
    expect(answer.entries.map((entry) => entry.id)).toEqual([newer, older]);
    expect(answer.entries[1]).toEqual({
      id: older,
      sender: { id: named, name: 'Yusupova Aziza' },
      roles: ['teacher'],
      page: '/journal',
      text: 'Written 5 hours ago.',
      appVersion: 7,
      createdAt: new Date(new Date(NOW).getTime() - 5 * HOUR).toISOString(),
      handledAt: null,
      handledBy: null,
    });
    // An account with no staff record has no name; the page says "No name".
    expect(answer.entries[0]?.sender).toEqual({ id: nameless, name: '' });
  });

  it('answers every new report however old, and the newest handled ones up to the limit', async () => {
    const oldNew = await report(named, 24 * 400, { text: 'Old and never handled.' });
    const rows = Array.from({ length: FEEDBACK_HANDLED_LISTED + 1 }, (_, n) => ({
      account_id: named,
      roles: ['teacher'],
      page: '/journal',
      text: `Handled ${String(n)}.`,
      created_at: new Date(new Date(NOW).getTime() - (n + 1) * 60_000),
      handled_at: new Date(NOW),
      handled_by: adminAccount,
    }));
    await database.migrator.insertInto('feedback_reports').values(rows).execute();

    const answer = await list();

    expect(answer.handledTruncated).toBe(true);
    expect(answer.entries).toHaveLength(FEEDBACK_HANDLED_LISTED + 1);
    // The oldest handled one is left out; the new one of 400 days ago is there, last.
    expect(
      answer.entries.some((entry) => entry.text === `Handled ${String(FEEDBACK_HANDLED_LISTED)}.`),
    ).toBe(false);
    expect(answer.entries.at(-1)?.id).toBe(oldNew);
  });

  it('marks a report handled, audited in the school-wide log without its text, once', async () => {
    const id = await report(named, 2, { text: 'The save button is hidden on my phone.' });
    const before = (await entries()).length;

    const handled = feedbackReportEntrySchema.parse(ok(await mark(id, true)));

    expect(handled.handledAt).toBe(new Date(NOW).toISOString());
    expect(handled.handledBy).toEqual({ id: adminAccount, name: 'Karimova Dilnoza' });
    const written = (await entries()).slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      action: 'feedback.handled',
      actor_id: adminAccount,
      record_type: 'feedback_report',
      record_id: id,
      old_value: { handled: false },
      new_value: { handled: true },
    });
    expect(JSON.stringify(written[0])).not.toContain('save button');

    // A second mark, five minutes later, changes nothing and writes no entry (within the
    // Super Admin's 15 minutes without use).
    clock.advance(5 * 60_000);
    const again = feedbackReportEntrySchema.parse(ok(await mark(id, true)));
    expect(again.handledAt).toBe(new Date(NOW).toISOString());
    expect((await entries()).slice(before)).toHaveLength(1);
  });

  it('marks a handled report new again, audited, once', async () => {
    const id = await report(named, 3, { handled: true });
    const before = (await entries()).length;

    const reopened = feedbackReportEntrySchema.parse(ok(await mark(id, false)));

    expect(reopened).toMatchObject({ handledAt: null, handledBy: null });
    const stored = await database.migrator
      .selectFrom('feedback_reports')
      .select(['handled_at', 'handled_by'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ handled_at: null, handled_by: null });
    const written = (await entries()).slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      action: 'feedback.reopened',
      record_id: id,
      old_value: { handled: true },
      new_value: { handled: false },
    });

    ok(await mark(id, false));
    expect((await entries()).slice(before)).toHaveLength(1);
  });

  it('answers 404 for an unknown report, and writes nothing', async () => {
    const id = await report(named, 1);
    const before = await entries();

    for (const handled of [true, false]) {
      const response = await mark(UNKNOWN, handled);
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('not_found');
    }

    expect(await entries()).toEqual(before);
    const stored = await database.migrator
      .selectFrom('feedback_reports')
      .select(['handled_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(stored.handled_at).toBeNull();
  });

  it('refuses an id that is not a uuid with 400', async () => {
    const response = await mark('not-an-id', true);
    expect(response.status).toBe(400);
  });
});
