import {
  apiErrorSchema,
  digestFrequencyAnswerSchema,
  digestLogSchema,
  digestSettingsSchema,
  relativeReportSchema,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, type DayTemplatesKit } from '../../../testing/day-templates-kit.js';
import { LoadKit } from '../../../testing/load-kit.js';
import { ParentsKit } from '../../../testing/parents-kit.js';

const codeOf = (response: Response): string =>
  apiErrorSchema.safeParse(response.body).data?.error.code ?? `status ${String(response.status)}`;

// All names are invented. Task 11.5, pull request #299: the routes of the parents' digest. Who
// may call each one is walked for every role by route-permissions.test.ts (`ROUTE_ACCESS`); this
// file checks what each does, its audit entries and the refusals inside the route.
describe('the routes of the parents digest', () => {
  let t: DayTemplatesKit;
  let parents: ParentsKit;
  let parent: { cookie: string; accountId: string; relativeId: string };

  const settings = (cookie = t.admin) =>
    request(t.kit.server).get('/api/setup/school-settings/digest').set('Cookie', cookie);
  const change = (body: object, cookie = t.admin) =>
    request(t.kit.server).put('/api/setup/school-settings/digest').set('Cookie', cookie).send(body);
  const frequency = (cookie: string) =>
    request(t.kit.server).get('/api/auth/digest-frequency').set('Cookie', cookie);
  const choose = (body: object, cookie: string) =>
    request(t.kit.server).put('/api/auth/digest-frequency').set('Cookie', cookie).send(body);

  /** The school-wide audit entries of an action (no branch: `audit_log_school`). */
  const entries = (action: string) =>
    t.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();
  const count = async () =>
    (await t.database.migrator.selectFrom('audit_log_school').select('id').execute()).length;

  beforeAll(async () => {
    t = await dayTemplatesKit();
    const load = new LoadKit(t.database.migrator);
    parents = new ParentsKit(t.app, t.database.migrator, await load.classes.account());
    const { relativeId } = await parents.student(t.north);
    const session = await parents.session(relativeId);
    parent = { cookie: session.cookie, accountId: session.account.id, relativeId };
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  it('reads the defaults: 19:00, quiet from 21:00 to 08:00', async () => {
    const response = await settings();
    expect(response.status).toBe(200);
    expect(digestSettingsSchema.parse(response.body)).toEqual({
      sendAt: '19:00',
      quietFrom: '21:00',
      quietUntil: '08:00',
    });
  });

  it('changes the time and the quiet hours, with an audit entry', async () => {
    const before = await count();
    const response = await change({ sendAt: '18:30', quietFrom: '22:00', quietUntil: '07:30' });
    expect(response.status).toBe(200);
    expect(digestSettingsSchema.parse(response.body)).toEqual({
      sendAt: '18:30',
      quietFrom: '22:00',
      quietUntil: '07:30',
    });
    expect(await count()).toBe(before + 1);
    const [entry] = await entries('school_settings.digest');
    expect(entry?.old_value).toEqual({ sendAt: '19:00', quietFrom: '21:00', quietUntil: '08:00' });
    expect(entry?.new_value).toEqual({ sendAt: '18:30', quietFrom: '22:00', quietUntil: '07:30' });
    // The same values again change nothing and write nothing.
    await change({ sendAt: '18:30', quietFrom: '22:00', quietUntil: '07:30' });
    expect(await count()).toBe(before + 1);
  });

  it('refuses a digest time inside the quiet hours, equal quiet ends and a wrong time', async () => {
    const before = await count();
    for (const body of [
      { sendAt: '23:00', quietFrom: '22:00', quietUntil: '07:30' },
      { sendAt: '06:00', quietFrom: '22:00', quietUntil: '07:30' },
      { sendAt: '13:00', quietFrom: '12:00', quietUntil: '14:00' },
      { sendAt: '19:00', quietFrom: '21:00', quietUntil: '21:00' },
      { sendAt: '7:00', quietFrom: '21:00', quietUntil: '08:00' },
      { sendAt: '19:00', quietFrom: '21:00', quietUntil: '08:00', extra: true },
    ]) {
      const response = await change(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(await count()).toBe(before);
    expect(digestSettingsSchema.parse((await settings()).body).sendAt).toBe('18:30');
  });

  it('refuses the settings to the Principal and the Academic Vice Principal', async () => {
    for (const cookie of [t.principal, t.vicePrincipal]) {
      expect(codeOf(await settings(cookie))).toBe('permission_denied');
      expect(
        codeOf(await change({ sendAt: '19:00', quietFrom: '21:00', quietUntil: '08:00' }, cookie)),
      ).toBe('permission_denied');
    }
  });

  it('gives a parent the frequency, twice a week until chosen, and records the choice', async () => {
    const first = digestFrequencyAnswerSchema.parse((await frequency(parent.cookie)).body);
    expect(first).toEqual({ frequency: 'twice_weekly', chosen: false });
    const response = await choose({ frequency: 'daily' }, parent.cookie);
    expect(response.status).toBe(200);
    expect(digestFrequencyAnswerSchema.parse(response.body)).toEqual({
      frequency: 'daily',
      chosen: true,
    });
    expect(digestFrequencyAnswerSchema.parse((await frequency(parent.cookie)).body)).toEqual({
      frequency: 'daily',
      chosen: true,
    });
    const chosen = (await entries('parent_account.digest_frequency')).filter(
      (entry) => entry.record_id === parent.accountId,
    );
    expect(chosen.map((entry) => entry.new_value)).toEqual([{ frequency: 'daily' }]);
    expect(codeOf(await choose({ frequency: 'monthly' }, parent.cookie))).toBe('validation_failed');
    expect(codeOf(await choose({ frequency: 'weekly', accountId: t.admin }, parent.cookie))).toBe(
      'validation_failed',
    );
  });

  it('refuses the frequency to a staff account', async () => {
    for (const cookie of [t.admin, t.teacher]) {
      expect(codeOf(await frequency(cookie))).toBe('permission_denied');
      expect(codeOf(await choose({ frequency: 'daily' }, cookie))).toBe('permission_denied');
    }
    const rows = await t.database.migrator.selectFrom('digest_frequencies').selectAll().execute();
    expect(rows.map((row) => row.account_id)).toEqual([parent.accountId]);
  });

  it('shows the Super Admin the send log, and refuses it to a parent and the Principal', async () => {
    const link = await t.database.migrator
      .insertInto('telegram_links')
      .values({
        account_id: parent.accountId,
        telegram_user_id: '7200001',
        linked_at: new Date('2026-10-01T10:00:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .insertInto('digests')
      .values({
        account_id: parent.accountId,
        digest_date: '2026-10-21',
        telegram_link_id: link.id,
        due_at: new Date('2026-10-21T19:00:00+05:00'),
        next_try_at: new Date('2026-10-21T19:00:00+05:00'),
        status: 'failed',
        attempts: 8,
      })
      .execute();
    const response = await request(t.kit.server).get('/api/digest-log').set('Cookie', t.admin);
    expect(response.status).toBe(200);
    const log = digestLogSchema.parse(response.body);
    expect(log.total).toBe(1);
    const relative = await t.database.migrator
      .selectFrom('relative_accounts')
      .innerJoin('relatives', 'relatives.id', 'relative_accounts.relative_id')
      .select('relatives.full_name')
      .where('relative_accounts.account_id', '=', parent.accountId)
      .executeTakeFirstOrThrow();
    expect(relative.full_name).not.toBe('');
    expect(log.rows[0]).toMatchObject({
      digestDate: '2026-10-21',
      parentName: relative.full_name,
      status: 'failed',
      attempts: 8,
    });
    const filtered = await request(t.kit.server)
      .get('/api/digest-log?status=delivered')
      .set('Cookie', t.admin);
    expect(digestLogSchema.parse(filtered.body).total).toBe(0);
    expect(
      (await request(t.kit.server).get('/api/digest-log?for=all').set('Cookie', t.admin)).status,
    ).toBe(400);
    for (const cookie of [parent.cookie, t.principal]) {
      expect(codeOf(await request(t.kit.server).get('/api/digest-log').set('Cookie', cookie))).toBe(
        'permission_denied',
      );
    }
  });

  // Plan decision 15 (permission review of the code, should-fix 4): the reader of the digests.
  it("lists the account's digests in the personal data report of the relative, and no other", async () => {
    const other = await parents.student(t.north);
    const otherSession = await parents.session(other.relativeId);
    const link = await t.database.migrator
      .insertInto('telegram_links')
      .values({
        account_id: otherSession.account.id,
        telegram_user_id: '7200002',
        linked_at: new Date('2026-10-01T10:00:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .insertInto('digests')
      .values({
        account_id: otherSession.account.id,
        digest_date: '2026-10-22',
        telegram_link_id: link.id,
        due_at: new Date('2026-10-22T19:00:00+05:00'),
        next_try_at: new Date('2026-10-22T19:00:00+05:00'),
      })
      .execute();
    const response = await t.post(
      `/api/people/relatives/${parent.relativeId}/report`,
      t.north,
      {},
      t.admin,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(relativeReportSchema.parse(response.body).relative.account?.digests).toEqual([
      { digestDate: '2026-10-21', status: 'failed', sentAt: null },
    ]);
  });
});
