import {
  apiErrorSchema,
  relativeDetailSchema,
  relativeListSchema,
  relativeNoValidPhoneSchema,
  relativePhoneMatchResultSchema,
  studentDetailSchema,
  studentRelativesSchema,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { refusingRelativeRaces } from './relative-writes.js';
import { staffIdOf } from './staff-numbers.js';

// All names and phones are invented. edge/close-relatives, rows 1 to 3; the
// plan approved on pull request #73 with corrections 1 to 3 (task 2.5b-1):
// the new owner of a phone and "no valid phone", the merge, and the notice to
// the Academic Vice Principal of the other branch. The clock stands at 23:55
// on 10 October 2026 in Tashkent; north and south each have the year
// 2026–2027.
describe('phone owners, merges and the notice to the other branch', () => {
  let t: DayTemplatesKit;
  let southVice: string;
  let southViceAccount: string;
  let northViceAccount: string;
  let count = 0;

  const phone = () => {
    count += 1;
    return `+99891${String(4000000 + count)}`;
  };

  const newRelative = (
    number: string | null,
    values: { fullName?: string; mainContact?: boolean; workplace?: string | null } = {},
  ) => ({
    kind: 'new',
    relative: {
      fullName: values.fullName ?? 'Dilfuza Karimova',
      phone: number,
      workplace: values.workplace === undefined ? 'Toshkent shahar shifoxonasi' : values.workplace,
      email: values.workplace === null ? null : 'd.karimova@example.uz',
    },
    relationship: 'mother',
    mainContact: values.mainContact ?? true,
    portalAccess: true,
    receivesNotices: true,
  });

  /** "Different person, the number has a new owner". */
  const newOwner = (
    number: string,
    previousId: string,
    previousPhone: string | null,
    mainContact = true,
  ) => ({
    kind: 'new_owner',
    relative: { fullName: 'Nodira Rasulova', phone: number, workplace: null, email: null },
    previousId,
    previousPhone,
    relationship: 'mother',
    mainContact,
    portalAccess: true,
    receivesNotices: true,
  });

  const existing = (relativeId: string, number: string) => ({
    kind: 'existing',
    relativeId,
    phone: number,
    relationship: 'father',
    mainContact: false,
    portalAccess: true,
    receivesNotices: true,
  });

  function body(relatives: unknown[]): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2609000 + count),
      confirmUidSet: true,
      firstName: 'Kamola',
      lastName: `Ergasheva${'a'.repeat(count % 7)}`,
      paternalName: '',
      sex: 'female',
      birthDate: `2014-05-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
      startsOn: '2026-09-02',
      documentType: null,
      documentNumber: '',
      jshshir: '',
      phone: '',
      email: '',
      address: '',
      region: null,
      previousSchool: '',
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `RO-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives,
    };
  }

  async function student(
    relatives: unknown[],
    branch: string,
    cookie = '',
  ): Promise<StudentDetail> {
    const response = await t.post(
      '/api/people/students',
      branch,
      body(relatives),
      cookie || t.admin,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  async function tab(id: string, branch: string) {
    const response = await t.get(`/api/people/students/${id}/relatives`, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentRelativesSchema.parse(response.body);
  }

  async function withRelative(
    number: string | null,
    branch: string,
    values: { fullName?: string; workplace?: string | null } = {},
  ) {
    const created = await student([newRelative(number, values)], branch);
    const relative = (await tab(created.id, branch)).relatives[0];
    if (relative === undefined) {
      throw new Error('A student is created with a relative.');
    }
    return { student: created, relativeId: relative.relativeId };
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const detailsOf = (response: Response) => apiErrorSchema.parse(response.body).error.details ?? [];

  const stored = (id: string) =>
    t.database.migrator
      .selectFrom('relatives')
      .select([
        'full_name',
        'phone',
        'phone_invalid_since',
        'merged_into',
        'archived_at',
        'workplace',
      ])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const schoolEntries = (action: string, recordId: string) =>
    t.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .where('record_id', '=', recordId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();

  const noticesOf = (accountId: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['kind', 'data', 'branch_id'])
      .where('account_id', '=', accountId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();

  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = {};
    for (const table of [
      'relatives',
      'relative_accounts',
      'student_relatives',
      'students',
      'notifications',
      'audit_log',
      'audit_log_school',
    ] as const) {
      rows[table] = (
        await sql`select * from ${sql.table(table)} order by 1`.execute(t.database.migrator)
      ).rows;
    }
    return rows;
  }

  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /** A transaction of a branch held open after `work` until released. */
  async function holdOpen(branches: string[], work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = t.app.get(Transactions).run(branches, async (transaction: Transaction) => {
      await work(transaction);
      ready();
      await released;
    });
    await Promise.race([isReady, done]);
    return { release, done };
  }

  const merge = (
    id: string,
    input: Record<string, unknown>,
    branch: string,
    cookie = t.vicePrincipal,
  ) => t.post(`/api/people/relatives/${id}/merge`, branch, input, cookie);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    for (const branch of [t.north, t.south]) {
      await t.database.migrator.transaction().execute(async (transaction) => {
        const year = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: '2026-09-01', end_date: '2027-05-31' })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const number of [1, 2, 3, 4]) {
          await transaction
            .insertInto('quarters')
            .values({ branch_id: branch, academic_year_id: year.id, number })
            .execute();
        }
      });
    }
    const browser = await t.kit.completeSession('Sardor', 'Rahimov');
    await t.kit.giveRole(browser.account.id, {
      role: 'academic_vice_principal',
      branchId: t.south,
    });
    southVice = browser.cookie;
    southViceAccount = browser.account.id;
    northViceAccount = (
      await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.viceAssignment)
        .executeTakeFirstOrThrow()
    ).account_id;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the new owner of a phone (edge, row 2; the done-when of 2.5b)', () => {
    it('gives the number to a new relative of a create and sets the earlier one to no valid phone', async () => {
      const number = phone();
      const earlier = await withRelative(number, t.south, { fullName: 'Zarina Aliyeva' });
      const before = (await noticesOf(southViceAccount)).length;
      const created = await student(
        [newOwner(number, earlier.relativeId, null)],
        t.north,
        t.vicePrincipal,
      );
      const [link] = (await tab(created.id, t.north)).relatives;
      expect(link).toMatchObject({ fullName: 'Nodira Rasulova', phone: number, mainContact: true });
      expect(await stored(earlier.relativeId)).toMatchObject({ phone: null });
      expect((await stored(earlier.relativeId)).phone_invalid_since).not.toBeNull();
      const [entry] = await schoolEntries('relative.phone_released', earlier.relativeId);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        old_value: { phone: number },
        new_value: { phone: null, phoneInvalid: true },
        details: { branchId: t.north, newOwnerId: link?.relativeId },
      });
      // The other branch's Academic Vice Principal is told, labelled with the
      // branch of the change; the one making it is not.
      const notices = await noticesOf(southViceAccount);
      expect(notices.slice(before)).toEqual([
        {
          kind: 'relative.phone_changed',
          data: { fullName: 'Zarina Aliyeva' },
          branch_id: t.north,
        },
      ]);
      expect(
        (await noticesOf(northViceAccount)).filter((one) => one.kind.startsWith('relative.')),
      ).toEqual([]);
    });

    it('gives the earlier relative a new phone on a link', async () => {
      const number = phone();
      const next = phone();
      const earlier = await withRelative(number, t.north);
      const target = await withRelative(phone(), t.north);
      const response = await t.post(
        `/api/people/students/${target.student.id}/relatives`,
        t.north,
        newOwner(number, earlier.relativeId, next, false),
      );
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(await stored(earlier.relativeId)).toMatchObject({
        phone: next,
        phone_invalid_since: null,
      });
    });

    it('gives the number on a refused phone change (decision 8)', async () => {
      const number = phone();
      const earlier = await withRelative(number, t.south);
      const edited = await withRelative(phone(), t.north);
      const record = {
        fullName: 'Dilfuza Karimova',
        phone: number,
        workplace: 'Toshkent shahar shifoxonasi',
        email: 'd.karimova@example.uz',
        extraPhones: [],
      };
      // The holder is linked in the south only: no merge for the Academic
      // Vice Principal of the north, a merge for the Super Admin.
      const refused = await t.patch(
        `/api/people/relatives/${edited.relativeId}`,
        t.north,
        record,
        t.vicePrincipal,
      );
      refusedWith(refused, 409, 'relative_phone_taken');
      expect(detailsOf(refused)[0]).toMatchObject({ mergeable: false });
      const asAdmin = await t.patch(`/api/people/relatives/${edited.relativeId}`, t.north, record);
      expect(detailsOf(asAdmin)[0]).toMatchObject({ mergeable: true });
      const match = relativePhoneMatchResultSchema.parse(
        (await t.post('/api/people/relatives/phone-match', t.north, { phone: number })).body,
      );
      expect(match.holder?.id).toBe(earlier.relativeId);
      const response = await t.patch(`/api/people/relatives/${edited.relativeId}`, t.north, {
        ...record,
        newOwner: { previousId: earlier.relativeId, previousPhone: null },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(relativeDetailSchema.parse(response.body).phone).toBe(number);
      expect((await stored(earlier.relativeId)).phone).toBeNull();
      const [entry] = await schoolEntries('relative.phone_released', earlier.relativeId);
      expect(entry?.details).toEqual({ branchId: t.north, newOwnerId: edited.relativeId });
    });

    it('refuses an unknown previousId and a relative that does not hold the phone, changing nothing', async () => {
      const number = phone();
      await withRelative(number, t.north);
      const other = await withRelative(phone(), t.north);
      for (const previousId of [UNKNOWN, other.relativeId]) {
        const before = await snapshot();
        const response = await t.post(
          '/api/people/students',
          t.north,
          body([newOwner(number, previousId, null)]),
        );
        refusedWith(response, 409, 'relative_phone_changed');
        expect(await snapshot()).toEqual(before);
      }
    });

    it('refuses a new phone of the earlier relative that is taken, changing nothing', async () => {
      const number = phone();
      const taken = phone();
      const earlier = await withRelative(number, t.north);
      await withRelative(taken, t.south, { fullName: 'Shoira Nazarova' });
      const before = await snapshot();
      const response = await t.post(
        '/api/people/students',
        t.north,
        body([newOwner(number, earlier.relativeId, taken)]),
      );
      refusedWith(response, 409, 'relative_phone_taken');
      expect(detailsOf(response)[0]).toMatchObject({
        path: 'relatives.0.phone.previousPhone',
        holder: { fullName: 'Shoira Nazarova', students: 1 },
      });
      expect(await snapshot()).toEqual(before);
    });

    it('is refused validation when the earlier relative would keep the number', async () => {
      const number = phone();
      const earlier = await withRelative(number, t.north);
      const response = await t.post(
        '/api/people/students',
        t.north,
        body([newOwner(number, earlier.relativeId, number)]),
      );
      refusedWith(response, 400, 'validation_failed');
    });

    it('answers relative_phone_changed to the second of two new owners of one number', async () => {
      const number = phone();
      const earlier = await withRelative(number, t.south);
      const target = await withRelative(phone(), t.north);
      // The first new owner, held open after the release: the earlier relative locked.
      const held = await holdOpen([t.south], async (transaction) => {
        await sql`select * from relative_release_phone(
          ${earlier.relativeId}::uuid, ${number}, ${null}, ${t.south}::uuid
        )`.execute(transaction);
      });
      const second = t
        .post(
          `/api/people/students/${target.student.id}/relatives`,
          t.north,
          newOwner(number, earlier.relativeId, null, false),
        )
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await second, 409, 'relative_phone_changed');
    });

    it('answers relative_phone_changed to a new owner that waited on an edit of the holder', async () => {
      const number = phone();
      const earlier = await withRelative(number, t.north);
      const held = await holdOpen([t.north], async (transaction) => {
        await transaction
          .selectFrom('relatives')
          .select('id')
          .where('id', '=', earlier.relativeId)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('relatives')
          .set({ phone: phone() })
          .where('id', '=', earlier.relativeId)
          .execute();
      });
      const waiting = t
        .post('/api/people/students', t.north, body([newOwner(number, earlier.relativeId, null)]))
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await waiting, 409, 'relative_phone_changed');
    });

    it('turns a deadlock error (40P01) into relative_changed, never a fault (decision 10)', async () => {
      await expect(
        refusingRelativeRaces(() =>
          Promise.reject(Object.assign(new Error('x'), { code: '40P01' })),
        ),
      ).rejects.toEqual(new ApiException('relative_changed', 409));
    });
  });

  describe('"no valid phone" (decision 3)', () => {
    it('is listed and counted while a student of the branch is active, and cleared by a phone', async () => {
      const number = phone();
      const earlier = await withRelative(number, t.north, { fullName: 'Feruza Qodirova' });
      await student([newOwner(number, earlier.relativeId, null)], t.north);
      const list = relativeListSchema.parse(
        (await t.get('/api/people/relatives?filter=no_valid_phone', t.north, t.principal)).body,
      );
      const row = list.relatives.find((one) => one.id === earlier.relativeId);
      expect(row?.phoneInvalidSince).not.toBeNull();
      expect(list.relatives.every((one) => one.phoneInvalidSince !== null)).toBe(true);
      const counted = relativeNoValidPhoneSchema.parse(
        (await t.get('/api/people/relatives/no-valid-phone', t.north, t.vicePrincipal)).body,
      ).count;
      expect(counted).toBe(list.relatives.length);
      // The student leaves: the relative is no longer listed.
      const left = await t.post(`/api/people/students/${earlier.student.id}/leaving`, t.north, {
        lastDay: '2026-10-09',
        reason: 'The family moved to another city.',
        version: earlier.student.version,
      });
      expect(left.status, JSON.stringify(left.body)).toBe(200);
      const after = relativeListSchema.parse(
        (await t.get('/api/people/relatives?filter=no_valid_phone', t.north)).body,
      );
      expect(after.relatives.some((one) => one.id === earlier.relativeId)).toBe(false);
      // A name kept, a phone given: no longer invalid.
      const record = {
        fullName: 'Feruza Qodirova',
        phone: null,
        workplace: null,
        email: null,
        extraPhones: [],
      };
      expect(
        (await t.patch(`/api/people/relatives/${earlier.relativeId}`, t.north, record)).status,
      ).toBe(200);
      expect((await stored(earlier.relativeId)).phone_invalid_since).not.toBeNull();
      const given = await t.patch(`/api/people/relatives/${earlier.relativeId}`, t.north, {
        ...record,
        phone: phone(),
      });
      expect(given.status, JSON.stringify(given.body)).toBe(200);
      expect(relativeDetailSchema.parse(given.body).phoneInvalidSince).toBeNull();
    });

    it('refuses the count to a Teacher', async () => {
      const response = await t.get('/api/people/relatives/no-valid-phone', t.north, t.teacher);
      refusedWith(response, 403, 'permission_denied');
    });
  });

  describe('the notice to the other branch (edge, row 1)', () => {
    it('tells the other branch of a rename and a phone change, and nobody for a relative of one branch', async () => {
      const shared = await withRelative(phone(), t.north, { fullName: 'Lola Ismoilova' });
      await student(
        [existing(shared.relativeId, (await stored(shared.relativeId)).phone ?? '')].map(
          (link) => ({ ...link, mainContact: true }),
        ),
        t.south,
      );
      const only = await withRelative(phone(), t.north, { fullName: 'Lola Ismoilova' });
      const before = (await noticesOf(southViceAccount)).length;
      const changed = await t.patch(
        `/api/people/relatives/${shared.relativeId}`,
        t.north,
        {
          fullName: 'Lola Ismoilova Karimova',
          phone: phone(),
          workplace: null,
          email: null,
          extraPhones: [],
        },
        t.vicePrincipal,
      );
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      const renamedOnly = await t.patch(
        `/api/people/relatives/${only.relativeId}`,
        t.north,
        {
          fullName: 'Lola Karimova',
          phone: phone(),
          workplace: null,
          email: null,
          extraPhones: [],
        },
        t.vicePrincipal,
      );
      expect(renamedOnly.status).toBe(200);
      expect((await noticesOf(southViceAccount)).slice(before)).toEqual([
        {
          kind: 'relative.renamed',
          data: { previousName: 'Lola Ismoilova', fullName: 'Lola Ismoilova Karimova' },
          branch_id: t.north,
        },
        {
          kind: 'relative.phone_changed',
          data: { fullName: 'Lola Ismoilova Karimova' },
          branch_id: t.north,
        },
      ]);
    });
  });

  describe('the merge (edge, row 3)', () => {
    it('moves every link to the record whose phone stays, in the branch (the done-when of 2.5b)', async () => {
      const keptPhone = phone();
      const mergedPhone = phone();
      const kept = await withRelative(keptPhone, t.north, {
        fullName: 'Gavhar Toirova',
        workplace: null,
      });
      const merged = await withRelative(mergedPhone, t.north, { fullName: 'Gavhar Toyirova' });
      // A student linked to both: the merged one is its main contact.
      const both = await student(
        [
          { ...existing(merged.relativeId, mergedPhone), mainContact: true },
          existing(kept.relativeId, keptPhone),
        ],
        t.north,
      );
      const response = await merge(
        kept.relativeId,
        {
          otherId: merged.relativeId,
          thisPhone: keptPhone,
          otherPhone: mergedPhone,
          phoneOf: 'this',
          nameOf: 'other',
        },
        t.north,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const detail = relativeDetailSchema.parse(response.body);
      expect(detail).toMatchObject({
        id: kept.relativeId,
        fullName: 'Gavhar Toyirova',
        phone: keptPhone,
      });
      expect(detail.students.map((one) => one.id).sort()).toEqual(
        [kept.student.id, merged.student.id, both.id].sort(),
      );
      // The shared student keeps one link, the main mark on it.
      const links = (await tab(both.id, t.north)).relatives;
      expect(links).toEqual([
        expect.objectContaining({
          relativeId: kept.relativeId,
          mainContact: true,
          relationship: 'father',
        }),
      ]);
      expect(await stored(kept.relativeId)).toMatchObject({
        workplace: 'Toshkent shahar shifoxonasi',
      });
      const gone = await stored(merged.relativeId);
      expect(gone).toMatchObject({ phone: null, merged_into: kept.relativeId });
      expect(gone.archived_at).not.toBeNull();
      expect(await schoolEntries('relative.merge', kept.relativeId)).toEqual([
        expect.objectContaining({
          assignment_id: t.viceAssignment,
          details: { branchId: t.north, mergedId: merged.relativeId },
        }),
      ]);
      expect(await schoolEntries('relative.merged', merged.relativeId)).toEqual([
        expect.objectContaining({
          old_value: expect.objectContaining({
            phone: mergedPhone,
            fullName: 'Gavhar Toyirova',
          }) as unknown,
          new_value: {
            mergedInto: kept.relativeId,
            phone: null,
            account: 'off',
            extraPhones: [],
            staffId: null,
          },
        }),
      ]);
      expect(await schoolEntries('relative.archive', merged.relativeId)).toHaveLength(1);
      expect(await t.entries('relative.link_moved', kept.relativeId)).toHaveLength(1);
      expect(await t.entries('relative.link_edit', kept.relativeId)).toHaveLength(1);
      // The merged record's own link of the shared student ends with an entry.
      expect(await t.entries('relative.unlink', merged.relativeId)).toEqual([
        expect.objectContaining({
          old_value: expect.objectContaining({ studentId: both.id, mainContact: true }) as unknown,
          details: { mergedInto: kept.relativeId },
        }),
      ]);
      // The merged record is never linked again.
      const relink = await t.post(
        `/api/people/students/${both.id}/relatives`,
        t.north,
        existing(merged.relativeId, mergedPhone),
      );
      refusedWith(relink, 409, 'relative_phone_changed');
    });

    it('is refused to keep a record with no phone of its own (correction 1)', async () => {
      const withPhone = await withRelative(phone(), t.north);
      const without = await withRelative(null, t.north);
      const before = await snapshot();
      const response = await merge(
        without.relativeId,
        {
          otherId: withPhone.relativeId,
          thisPhone: null,
          otherPhone: (await stored(withPhone.relativeId)).phone,
          phoneOf: 'this',
          nameOf: 'this',
        },
        t.north,
      );
      refusedWith(response, 400, 'validation_failed');
      expect(await snapshot()).toEqual(before);
    });

    it('across branches is refused to the Academic Vice Principal and done by the Super Admin', async () => {
      const keptPhone = phone();
      const mergedPhone = phone();
      const kept = await withRelative(keptPhone, t.north, { fullName: 'Sevara Olimova' });
      const merged = await withRelative(mergedPhone, t.north, { fullName: 'Sevara Olimova' });
      // The merged record also has a student in the south.
      await student([{ ...existing(merged.relativeId, mergedPhone), mainContact: true }], t.south);
      const input = {
        otherId: merged.relativeId,
        thisPhone: keptPhone,
        otherPhone: mergedPhone,
        phoneOf: 'this',
        nameOf: 'this',
      };
      const before = await snapshot();
      refusedWith(await merge(kept.relativeId, input, t.north), 403, 'merge_needs_super_admin');
      expect(await snapshot()).toEqual(before);
      const noticed = (await noticesOf(southViceAccount)).length;
      const response = await merge(kept.relativeId, input, t.north, t.admin);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(relativeDetailSchema.parse(response.body).elsewhere).toBe(1);
      expect(await schoolEntries('relative.merge', kept.relativeId)).toEqual([
        expect.objectContaining({ assignment_id: t.adminAssignment }),
      ]);
      // The moved southern link is in the south's log.
      const moved = await t.entries('relative.link_moved', kept.relativeId);
      expect(moved.map((entry) => entry.branch_id).sort()).toEqual([t.north, t.south].sort());
      expect((await noticesOf(southViceAccount)).slice(noticed)).toEqual([
        {
          kind: 'relative.merged',
          data: {
            keptName: 'Sevara Olimova',
            mergedName: 'Sevara Olimova',
            fullName: 'Sevara Olimova',
          },
          branch_id: t.north,
        },
      ]);
    });

    it('answers 404 for a path id or an otherId of another branch and an unknown one', async () => {
      const here = await withRelative(phone(), t.north);
      const there = await withRelative(phone(), t.south);
      const herePhone = (await stored(here.relativeId)).phone;
      const therePhone = (await stored(there.relativeId)).phone;
      const before = await snapshot();
      for (const [id, otherId] of [
        [there.relativeId, here.relativeId],
        [UNKNOWN, here.relativeId],
        [here.relativeId, there.relativeId],
        [here.relativeId, UNKNOWN],
      ] as const) {
        const response = await merge(
          id,
          {
            otherId,
            thisPhone: herePhone,
            otherPhone: therePhone,
            phoneOf: 'this',
            nameOf: 'this',
          },
          t.north,
        );
        refusedWith(response, 404, 'not_found');
      }
      expect(await snapshot()).toEqual(before);
    });

    it('is refused relative_changed when a phone changed since it was shown', async () => {
      const one = await withRelative(phone(), t.north);
      const other = await withRelative(phone(), t.north);
      const before = await snapshot();
      const response = await merge(
        one.relativeId,
        {
          otherId: other.relativeId,
          thisPhone: (await stored(one.relativeId)).phone,
          otherPhone: '+998911111111',
          phoneOf: 'this',
          nameOf: 'this',
        },
        t.north,
      );
      refusedWith(response, 409, 'relative_changed');
      expect(await snapshot()).toEqual(before);
    });

    it('offers the merge on a refused phone change only for a holder linked in the branch', async () => {
      const holder = await withRelative(phone(), t.north);
      const edited = await withRelative(phone(), t.north);
      const refused = await t.patch(`/api/people/relatives/${edited.relativeId}`, t.north, {
        fullName: 'Dilfuza Karimova',
        phone: (await stored(holder.relativeId)).phone,
        workplace: null,
        email: null,
        extraPhones: [],
      });
      refusedWith(refused, 409, 'relative_phone_taken');
      expect(detailsOf(refused)[0]).toMatchObject({ mergeable: true, recordId: holder.relativeId });
    });

    it('offers the merge to the Academic Vice Principal only when neither record is linked in another branch', async () => {
      const record = (number: string | null) => ({
        fullName: 'Dilfuza Karimova',
        phone: number,
        workplace: null,
        email: null,
        extraPhones: [],
      });
      // The holder is linked in the north and in the south.
      const holderPhone = phone();
      const holder = await withRelative(holderPhone, t.north);
      await student([{ ...existing(holder.relativeId, holderPhone), mainContact: true }], t.south);
      const edited = await withRelative(phone(), t.north);
      const refused = await t.patch(
        `/api/people/relatives/${edited.relativeId}`,
        t.north,
        record(holderPhone),
        t.vicePrincipal,
      );
      refusedWith(refused, 409, 'relative_phone_taken');
      expect(detailsOf(refused)[0]).toMatchObject({
        mergeable: false,
        recordId: holder.relativeId,
      });
      const asAdmin = await t.patch(
        `/api/people/relatives/${edited.relativeId}`,
        t.north,
        record(holderPhone),
      );
      expect(detailsOf(asAdmin)[0]).toMatchObject({ mergeable: true });
      // The edited record is linked in the south too, the holder in the north only.
      const northOnlyPhone = phone();
      const northOnly = await withRelative(northOnlyPhone, t.north);
      const sharedPhone = phone();
      const shared = await withRelative(sharedPhone, t.north);
      await student([{ ...existing(shared.relativeId, sharedPhone), mainContact: true }], t.south);
      const refusedShared = await t.patch(
        `/api/people/relatives/${shared.relativeId}`,
        t.north,
        record(northOnlyPhone),
        t.vicePrincipal,
      );
      refusedWith(refusedShared, 409, 'relative_phone_taken');
      expect(detailsOf(refusedShared)[0]).toMatchObject({
        mergeable: false,
        recordId: northOnly.relativeId,
      });
      const sharedAsAdmin = await t.patch(
        `/api/people/relatives/${shared.relativeId}`,
        t.north,
        record(northOnlyPhone),
      );
      expect(detailsOf(sharedAsAdmin)[0]).toMatchObject({ mergeable: true });
    });

    it('is refused relative_changed when the path record was unlinked from the branch while it waited', async () => {
      // The path record is linked in the south and, not as main contact, to a
      // student of the north; the other record in the north.
      const pathPhone = phone();
      const path = await withRelative(pathPhone, t.south);
      const northStudent = await student(
        [newRelative(phone()), { ...existing(path.relativeId, pathPhone), mainContact: false }],
        t.north,
      );
      const otherPhone = phone();
      const other = await withRelative(otherPhone, t.north);
      // An unlink of the northern link, held open with the student locked.
      const held = await holdOpen([t.north], async (transaction) => {
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', northStudent.id)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ unlinked_at: new Date('2026-10-10T18:55:00Z') })
          .where('relative_id', '=', path.relativeId)
          .where('student_id', '=', northStudent.id)
          .execute();
      });
      const merging = merge(
        path.relativeId,
        {
          otherId: other.relativeId,
          thisPhone: pathPhone,
          otherPhone,
          phoneOf: 'other',
          nameOf: 'other',
        },
        t.north,
        t.admin,
      ).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await merging, 409, 'relative_changed');
      expect(await stored(path.relativeId)).toMatchObject({ phone: pathPhone, merged_into: null });
    });

    it('makes a link to the merged record wait and refuses it relative_merged', async () => {
      const keptPhone = phone();
      const mergedPhone = phone();
      const kept = await withRelative(keptPhone, t.north);
      const merged = await withRelative(mergedPhone, t.north);
      const target = await withRelative(phone(), t.north);
      // The writes of the merge, held open with both records locked.
      const held = await holdOpen([t.north], async (transaction) => {
        await transaction
          .selectFrom('relatives')
          .select('id')
          .where('id', 'in', [kept.relativeId, merged.relativeId])
          .orderBy('id')
          .forUpdate()
          .execute();
        await transaction
          .updateTable('relatives')
          .set({ phone: null, merged_into: kept.relativeId })
          .where('id', '=', merged.relativeId)
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: false, unlinked_at: new Date('2026-10-10T18:55:00Z') })
          .where('relative_id', '=', merged.relativeId)
          .execute();
        await transaction
          .insertInto('student_relatives')
          .values({
            student_id: merged.student.id,
            branch_id: t.north,
            relative_id: kept.relativeId,
            relationship: 'mother',
            main_contact: true,
            linked_at: new Date('2026-10-10T18:55:00Z'),
          })
          .execute();
      });
      const linking = t
        .post(
          `/api/people/students/${target.student.id}/relatives`,
          t.north,
          existing(merged.relativeId, mergedPhone),
        )
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await linking, 409, 'relative_merged');
    });

    it('is refused relative_changed after waiting on a link of a student it did not lock', async () => {
      const keptPhone = phone();
      const mergedPhone = phone();
      const kept = await withRelative(keptPhone, t.north);
      const merged = await withRelative(mergedPhone, t.north);
      const other = await withRelative(phone(), t.north);
      // A link of the merged record to another student, held open: it holds
      // the record's lock (`student_relatives_not_merged`).
      const held = await holdOpen([t.north], async (transaction) => {
        await transaction
          .insertInto('student_relatives')
          .values({
            student_id: other.student.id,
            branch_id: t.north,
            relative_id: merged.relativeId,
            relationship: 'aunt',
            main_contact: false,
            linked_at: new Date('2026-10-10T18:55:00Z'),
          })
          .execute();
      });
      const merging = merge(
        kept.relativeId,
        {
          otherId: merged.relativeId,
          thisPhone: keptPhone,
          otherPhone: mergedPhone,
          phoneOf: 'this',
          nameOf: 'this',
        },
        t.north,
      ).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await merging, 409, 'relative_changed');
      expect((await stored(merged.relativeId)).merged_into).toBeNull();
    });

    // Two merges at the same moment are proved by the lock pair "a merge that
    // waited on another merge of the same record" below; sent at once, the
    // second answered 404 or 409 by timing (CI of pull request #74).
    it('refuses a later merge of a record already merged, changing nothing', async () => {
      const aPhone = phone();
      const bPhone = phone();
      const cPhone = phone();
      const a = await withRelative(aPhone, t.north);
      const b = await withRelative(bPhone, t.north);
      const c = await withRelative(cPhone, t.north);
      const first = await merge(
        a.relativeId,
        {
          otherId: b.relativeId,
          thisPhone: aPhone,
          otherPhone: bPhone,
          phoneOf: 'this',
          nameOf: 'this',
        },
        t.north,
      );
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const before = await snapshot();
      refusedWith(
        await merge(
          c.relativeId,
          {
            otherId: b.relativeId,
            thisPhone: cPhone,
            otherPhone: bPhone,
            phoneOf: 'this',
            nameOf: 'this',
          },
          t.north,
          t.admin,
        ),
        404,
        'not_found',
      );
      expect(await snapshot()).toEqual(before);
    });

    it('is refused to the Principal and the south Academic Vice Principal in the north', async () => {
      const one = await withRelative(phone(), t.north);
      const other = await withRelative(phone(), t.north);
      const input = {
        otherId: other.relativeId,
        thisPhone: (await stored(one.relativeId)).phone,
        otherPhone: (await stored(other.relativeId)).phone,
        phoneOf: 'this',
        nameOf: 'this',
      };
      refusedWith(
        await merge(one.relativeId, input, t.north, t.principal),
        403,
        'permission_denied',
      );
      refusedWith(await merge(one.relativeId, input, t.north, southVice), 403, 'permission_denied');
    });
  });

  describe('the ids of a new owner and a merge (permission review)', () => {
    it('answers 404 to a new owner on a relative or a student of another branch and an unknown one', async () => {
      const number = phone();
      const holder = await withRelative(number, t.south);
      const southern = await withRelative(phone(), t.south);
      const before = await snapshot();
      for (const id of [southern.relativeId, UNKNOWN]) {
        const response = await t.patch(
          `/api/people/relatives/${id}`,
          t.north,
          {
            fullName: 'Dilfuza Karimova',
            phone: number,
            workplace: null,
            email: null,
            extraPhones: [],
            newOwner: { previousId: holder.relativeId, previousPhone: null },
          },
          t.vicePrincipal,
        );
        refusedWith(response, 404, 'not_found');
      }
      for (const id of [southern.student.id, UNKNOWN]) {
        const response = await t.post(
          `/api/people/students/${id}/relatives`,
          t.north,
          newOwner(number, holder.relativeId, null, false),
          t.vicePrincipal,
        );
        refusedWith(response, 404, 'not_found');
      }
      expect(await snapshot()).toEqual(before);
      expect((await stored(holder.relativeId)).phone).toBe(number);
    });

    it('answers relative_phone_changed to a previousId that is unknown or does not hold the phone, on the edit and the link', async () => {
      const number = phone();
      await withRelative(number, t.north);
      const other = await withRelative(phone(), t.north);
      const edited = await withRelative(phone(), t.north);
      const target = await withRelative(phone(), t.north);
      const before = await snapshot();
      for (const previousId of [UNKNOWN, other.relativeId]) {
        refusedWith(
          await t.patch(`/api/people/relatives/${edited.relativeId}`, t.north, {
            fullName: 'Dilfuza Karimova',
            phone: number,
            workplace: null,
            email: null,
            extraPhones: [],
            newOwner: { previousId, previousPhone: null },
          }),
          409,
          'relative_phone_changed',
        );
        refusedWith(
          await t.post(
            `/api/people/students/${target.student.id}/relatives`,
            t.north,
            newOwner(number, previousId, null, false),
          ),
          409,
          'relative_phone_changed',
        );
      }
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a new owner sent without the phone it takes', async () => {
      const edited = await withRelative(phone(), t.north);
      const holder = await withRelative(phone(), t.north);
      const before = await snapshot();
      const response = await t.patch(`/api/people/relatives/${edited.relativeId}`, t.north, {
        fullName: 'Dilfuza Karimova',
        phone: (await stored(edited.relativeId)).phone,
        workplace: 'Toshkent shahar shifoxonasi',
        email: 'd.karimova@example.uz',
        extraPhones: [],
        newOwner: { previousId: holder.relativeId, previousPhone: null },
      });
      refusedWith(response, 422, 'request_refused');
      expect(await snapshot()).toEqual(before);
    });

    it('lets the Academic Vice Principal give the number of a relative of another branch on the edit', async () => {
      const number = phone();
      const holder = await withRelative(number, t.south, { fullName: 'Saodat Nurmatova' });
      const edited = await withRelative(phone(), t.north);
      const noticed = (await noticesOf(southViceAccount)).length;
      const response = await t.patch(
        `/api/people/relatives/${edited.relativeId}`,
        t.north,
        {
          fullName: 'Dilfuza Karimova',
          phone: number,
          workplace: 'Toshkent shahar shifoxonasi',
          email: 'd.karimova@example.uz',
          extraPhones: [],
          newOwner: { previousId: holder.relativeId, previousPhone: null },
        },
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const [entry] = await schoolEntries('relative.phone_released', holder.relativeId);
      expect(entry).toMatchObject({ assignment_id: t.viceAssignment });
      expect((await noticesOf(southViceAccount)).slice(noticed)).toEqual([
        {
          kind: 'relative.phone_changed',
          data: { fullName: 'Saodat Nurmatova' },
          branch_id: t.north,
        },
      ]);
    });

    it('answers 404 to the Super Admin for a path id outside the branch of the request and unknown ids', async () => {
      const here = await withRelative(phone(), t.north);
      const there = await withRelative(phone(), t.south);
      const herePhone = (await stored(here.relativeId)).phone;
      const therePhone = (await stored(there.relativeId)).phone;
      const before = await snapshot();
      for (const [id, otherId, thisPhone, otherPhone] of [
        [there.relativeId, here.relativeId, therePhone, herePhone],
        [UNKNOWN, here.relativeId, therePhone, herePhone],
        [here.relativeId, UNKNOWN, herePhone, therePhone],
      ] as const) {
        const response = await merge(
          id,
          { otherId, thisPhone, otherPhone, phoneOf: 'other', nameOf: 'this' },
          t.north,
          t.admin,
        );
        refusedWith(response, 404, 'not_found');
      }
      expect(await snapshot()).toEqual(before);
    });

    it('counts and lists no valid phone only in its own branch, also for the Super Admin', async () => {
      const number = phone();
      const southern = await withRelative(number, t.south, { fullName: 'Kumush Ergasheva' });
      await student([newOwner(number, southern.relativeId, null)], t.south);
      const listed = async (branch: string) =>
        relativeListSchema
          .parse((await t.get('/api/people/relatives?filter=no_valid_phone', branch)).body)
          .relatives.map((row) => row.id);
      expect(await listed(t.south)).toContain(southern.relativeId);
      expect(await listed(t.north)).not.toContain(southern.relativeId);
      const counted = async (branch: string) =>
        relativeNoValidPhoneSchema.parse(
          (await t.get('/api/people/relatives/no-valid-phone', branch)).body,
        ).count;
      expect(await counted(t.south)).toBe((await listed(t.south)).length);
      expect(await counted(t.north)).toBe((await listed(t.north)).length);
    });
  });

  describe('the merge and the new owner at the same moment (lock pairs)', () => {
    const at = new Date('2026-10-10T18:55:00Z');

    /** The writes of a merge of `merged` into `kept` in the north, held open. */
    const holdMerge = (kept: string, merged: { relativeId: string; student: StudentDetail }) =>
      holdOpen([t.north], async (transaction) => {
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', merged.student.id)
          .forUpdate()
          .execute();
        await transaction
          .selectFrom('relatives')
          .select('id')
          .where('id', 'in', [kept, merged.relativeId])
          .orderBy('id')
          .forUpdate()
          .execute();
        await transaction
          .updateTable('relatives')
          .set({ phone: null, merged_into: kept })
          .where('id', '=', merged.relativeId)
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: false, unlinked_at: at })
          .where('relative_id', '=', merged.relativeId)
          .execute();
        await transaction
          .insertInto('student_relatives')
          .values({
            student_id: merged.student.id,
            branch_id: t.north,
            relative_id: kept,
            relationship: 'mother',
            main_contact: true,
            linked_at: at,
          })
          .execute();
      });

    const pair = async () => {
      const keptPhone = phone();
      const mergedPhone = phone();
      const kept = await withRelative(keptPhone, t.north);
      const merged = await withRelative(mergedPhone, t.north);
      const body = {
        otherId: merged.relativeId,
        thisPhone: keptPhone,
        otherPhone: mergedPhone,
        phoneOf: 'this',
        nameOf: 'this',
      };
      return { keptPhone, mergedPhone, kept, merged, body };
    };

    it('a merge that waited on an edit of the kept phone is refused relative_changed', async () => {
      const { kept, merged, body } = await pair();
      const held = await holdOpen([t.north], async (transaction) => {
        await transaction
          .selectFrom('relatives')
          .select('id')
          .where('id', '=', kept.relativeId)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('relatives')
          .set({ phone: phone() })
          .where('id', '=', kept.relativeId)
          .execute();
      });
      const merging = merge(kept.relativeId, body, t.north).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await merging, 409, 'relative_changed');
      expect((await stored(merged.relativeId)).merged_into).toBeNull();
    });

    it('an edit of the kept phone that waited on a merge is made on the merged record', async () => {
      const { kept, merged } = await pair();
      const held = await holdMerge(kept.relativeId, merged);
      const next = phone();
      const editing = t
        .patch(`/api/people/relatives/${kept.relativeId}`, t.north, {
          fullName: 'Dilfuza Karimova',
          phone: next,
          workplace: 'Toshkent shahar shifoxonasi',
          email: 'd.karimova@example.uz',
          extraPhones: [],
        })
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      const response = await editing;
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(relativeDetailSchema.parse(response.body).students.map((one) => one.id)).toContain(
        merged.student.id,
      );
      expect((await stored(kept.relativeId)).phone).toBe(next);
    });

    it('a merge that waited on a new owner of the merged phone is refused relative_changed', async () => {
      const { mergedPhone, kept, merged, body } = await pair();
      const held = await holdOpen([t.north], async (transaction) => {
        await sql`select * from relative_release_phone(
          ${merged.relativeId}::uuid, ${mergedPhone}, ${null}, ${t.north}::uuid
        )`.execute(transaction);
      });
      const merging = merge(kept.relativeId, body, t.north).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await merging, 409, 'relative_changed');
    });

    it('a new owner that waited on a merge of the holder is refused relative_phone_changed', async () => {
      const { mergedPhone, kept, merged } = await pair();
      const target = await withRelative(phone(), t.north);
      const held = await holdMerge(kept.relativeId, merged);
      const owning = t
        .post(
          `/api/people/students/${target.student.id}/relatives`,
          t.north,
          newOwner(mergedPhone, merged.relativeId, null, false),
        )
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await owning, 409, 'relative_phone_changed');
    });

    it('an edit of the holder that waited on a new owner is made after it', async () => {
      const number = phone();
      const holder = await withRelative(number, t.north);
      const held = await holdOpen([t.north], async (transaction) => {
        await sql`select * from relative_release_phone(
          ${holder.relativeId}::uuid, ${number}, ${null}, ${t.north}::uuid
        )`.execute(transaction);
      });
      const next = phone();
      const editing = t
        .patch(`/api/people/relatives/${holder.relativeId}`, t.north, {
          fullName: 'Dilfuza Karimova',
          phone: next,
          workplace: 'Toshkent shahar shifoxonasi',
          email: 'd.karimova@example.uz',
          extraPhones: [],
        })
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      expect((await editing).status).toBe(200);
      expect(await stored(holder.relativeId)).toMatchObject({
        phone: next,
        phone_invalid_since: null,
      });
    });

    it('a merge that waited on another merge of the same record is refused relative_changed', async () => {
      const { kept, merged } = await pair();
      const thirdPhone = phone();
      const third = await withRelative(thirdPhone, t.north);
      const held = await holdMerge(kept.relativeId, merged);
      const second = merge(
        third.relativeId,
        {
          otherId: merged.relativeId,
          thisPhone: thirdPhone,
          otherPhone: (await stored(merged.relativeId)).phone,
          phoneOf: 'this',
          nameOf: 'this',
        },
        t.north,
      ).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await second, 409, 'relative_changed');
    });

    it('two new owners swapping numbers at once answer 409 or succeed, never a fault', async () => {
      const first = phone();
      const second = phone();
      const one = await withRelative(first, t.north);
      const other = await withRelative(second, t.north);
      const targetA = await withRelative(phone(), t.north);
      const targetB = await withRelative(phone(), t.north);
      const answers = await Promise.all([
        t.post(
          `/api/people/students/${targetA.student.id}/relatives`,
          t.north,
          newOwner(first, one.relativeId, second, false),
        ),
        t.post(
          `/api/people/students/${targetB.student.id}/relatives`,
          t.north,
          newOwner(second, other.relativeId, first, false),
        ),
      ]);
      for (const answer of answers) {
        expect([201, 409], JSON.stringify(answer.body)).toContain(answer.status);
      }
    });

    it('refuses a merge of a record with itself, changing nothing', async () => {
      const { keptPhone, kept } = await pair();
      const before = await snapshot();
      const response = await merge(
        kept.relativeId,
        {
          otherId: kept.relativeId,
          thisPhone: keptPhone,
          otherPhone: keptPhone,
          phoneOf: 'this',
          nameOf: 'this',
        },
        t.north,
      );
      refusedWith(response, 422, 'request_refused');
      expect(await snapshot()).toEqual(before);
    });

    it('offers no merge for an archived holder, whose number still finds a new owner', async () => {
      const number = phone();
      const holder = await withRelative(number, t.north);
      // A second relative, then the holder unlinked: archived.
      await t.post(`/api/people/students/${holder.student.id}/relatives`, t.north, {
        ...newRelative(phone()),
        mainContact: true,
      });
      const unlinked = await t.post(
        `/api/people/students/${holder.student.id}/relatives/${holder.relativeId}/unlink`,
        t.north,
        { newMainContactId: null },
      );
      expect(unlinked.status, JSON.stringify(unlinked.body)).toBe(200);
      expect((await stored(holder.relativeId)).archived_at).not.toBeNull();
      const edited = await withRelative(phone(), t.north);
      const record = {
        fullName: 'Dilfuza Karimova',
        phone: number,
        workplace: null,
        email: null,
        extraPhones: [],
      };
      const refused = await t.patch(`/api/people/relatives/${edited.relativeId}`, t.north, record);
      refusedWith(refused, 409, 'relative_phone_taken');
      expect(detailsOf(refused)[0]).toMatchObject({ mergeable: false });
      const given = await t.patch(`/api/people/relatives/${edited.relativeId}`, t.north, {
        ...record,
        newOwner: { previousId: holder.relativeId, previousPhone: null },
      });
      expect(given.status, JSON.stringify(given.body)).toBe(200);
    });
  });

  // Task 2.5b-2, pull request #74: extra phones (decisions 2 and 3) and what a
  // merge does with them and with the mark "same person" (decision 5).
  describe('extra phones and the merge of marks (task 2.5b-2)', () => {
    let headTutor: string;
    let staffCount = 0;

    const lettersOf = (n: number): string =>
      n < 26
        ? String.fromCharCode(97 + n)
        : lettersOf(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));

    /** A staff person with a main branch and further branches, written by the migrator. */
    async function staffMember(main: string, further: string[] = []): Promise<string> {
      staffCount += 1;
      const number = staffCount;
      const division = await t.database.migrator
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Academic')
        .executeTakeFirstOrThrow();
      const department = await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow();
      return t.database.migrator.transaction().execute(async (transaction) => {
        const row = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: staffIdOf(2026, 8500 + number),
            first_name: 'Jasur',
            last_name: `Ergashev${lettersOf(number)}`,
            sex: 'male',
            birth_date: '1984-02-03',
            phone: `+99895${String(7000000 + number)}`,
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values([
            { staff_id: row.id, branch_id: main, is_main: true },
            ...further.map((branch) => ({ staff_id: row.id, branch_id: branch, is_main: false })),
          ])
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: row.id,
            division_id: division.id,
            department_id: department.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: row.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        return row.id;
      });
    }

    const withExtra = (number: string | null, extraPhones: string[]) => {
      const link = newRelative(number);
      return { ...link, relative: { ...link.relative, extraPhones } };
    };

    const extraOf = async (id: string) =>
      await t.database.migrator
        .selectFrom('relatives')
        .select(['extra_phones', 'staff_id'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    const editBody = (number: string | null, extraPhones?: string[]) => ({
      fullName: 'Dilfuza Karimova',
      phone: number,
      workplace: 'Toshkent shahar shifoxonasi',
      email: 'd.karimova@example.uz',
      ...(extraPhones === undefined ? {} : { extraPhones }),
    });

    beforeAll(async () => {
      const tutor = await t.kit.completeSession('Nilufar', 'Hamidova');
      await t.kit.giveRole(tutor.account.id, { role: 'head_tutor', branchId: t.north });
      headTutor = tutor.cookie;
    });

    it('keeps extra phones written with a new relative, a link and a new owner, in the create entry', async () => {
      const extra = phone();
      const created = await student([withExtra(phone(), [extra, '+12025550147'])], t.north);
      const [link] = (await tab(created.id, t.north)).relatives;
      expect(link?.extraPhones).toEqual([extra, '+12025550147']);
      const relativeId = link?.relativeId ?? '';
      const [entry] = await schoolEntries('relative.create', relativeId);
      expect(entry?.new_value).toMatchObject({ extraPhones: [extra, '+12025550147'] });
      const linked = await t.post(`/api/people/students/${created.id}/relatives`, t.north, {
        ...withExtra(phone(), [phone()]),
        mainContact: false,
      });
      expect(linked.status, JSON.stringify(linked.body)).toBe(201);
      expect(studentRelativesSchema.parse(linked.body).relatives[1]?.extraPhones).toHaveLength(1);
      const number = phone();
      const earlier = await withRelative(number, t.north);
      const owner = newOwner(number, earlier.relativeId, null);
      const taken = await student(
        [{ ...owner, relative: { ...owner.relative, extraPhones: [extra] } }],
        t.north,
      );
      expect((await tab(taken.id, t.north)).relatives[0]?.extraPhones).toEqual([extra]);
    });

    it('answers the extra phones to a Contact reader of the Relatives tab and on the detail', async () => {
      const extra = phone();
      const created = await student([withExtra(phone(), [extra])], t.north);
      const response = await t.get(
        `/api/people/students/${created.id}/relatives`,
        t.north,
        headTutor,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(studentRelativesSchema.parse(response.body).relatives[0]?.extraPhones).toEqual([
        extra,
      ]);
      const id = studentRelativesSchema.parse(response.body).relatives[0]?.relativeId ?? '';
      const detail = relativeDetailSchema.parse(
        (await t.get(`/api/people/relatives/${id}`, t.north)).body,
      );
      expect(detail).toMatchObject({ extraPhones: [extra], samePerson: null });
    });

    it('refuses an extra phone given twice, a fourth one and an edit without the list, changing nothing', async () => {
      const extra = phone();
      const before = await snapshot();
      refusedWith(
        await t.post('/api/people/students', t.north, body([withExtra(phone(), [extra, extra])])),
        400,
        'validation_failed',
      );
      refusedWith(
        await t.post(
          '/api/people/students',
          t.north,
          body([withExtra(phone(), [phone(), phone(), phone(), phone()])]),
        ),
        400,
        'validation_failed',
      );
      expect(await snapshot()).toEqual(before);
      const edited = await withRelative(phone(), t.north);
      const number = (await stored(edited.relativeId)).phone;
      const unchanged = await snapshot();
      for (const sent of [editBody(number), editBody(number, [extra, extra])]) {
        refusedWith(
          await t.patch(`/api/people/relatives/${edited.relativeId}`, t.north, sent),
          400,
          'validation_failed',
        );
      }
      expect(await snapshot()).toEqual(unchanged);
    });

    it('logs a change of extra phones only and tells no other branch', async () => {
      const shared = await withRelative(phone(), t.north);
      const number = (await stored(shared.relativeId)).phone ?? '';
      await student(
        [existing(shared.relativeId, number)].map((one) => ({ ...one, mainContact: true })),
        t.south,
      );
      const before = (await noticesOf(southViceAccount)).length;
      const extra = phone();
      const response = await t.patch(
        `/api/people/relatives/${shared.relativeId}`,
        t.north,
        editBody(number, [extra]),
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(relativeDetailSchema.parse(response.body).extraPhones).toEqual([extra]);
      expect(await schoolEntries('relative.edit', shared.relativeId)).toEqual([
        expect.objectContaining({
          old_value: { extraPhones: [] },
          new_value: { extraPhones: [extra] },
        }),
      ]);
      expect((await noticesOf(southViceAccount)).length).toBe(before);
    });

    it('never finds a relative by an extra phone: the phone match and the phone search', async () => {
      const extra = phone();
      await student([withExtra(phone(), [extra])], t.north);
      const match = await t.post('/api/people/relatives/phone-match', t.north, { phone: extra });
      expect(match.status, JSON.stringify(match.body)).toBe(200);
      expect(relativePhoneMatchResultSchema.parse(match.body).holder).toBeNull();
      const list = await t.get(`/api/people/relatives?phone=${encodeURIComponent(extra)}`, t.north);
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect(relativeListSchema.parse(list.body).relatives).toEqual([]);
      // A new relative with that number as the main phone is created, not matched.
      const created = await student([newRelative(extra)], t.north);
      expect((await tab(created.id, t.north)).relatives[0]?.phone).toBe(extra);
    });

    /** Two relatives of the north, each with its own phone, for a merge. */
    const mergePair = async () => {
      const keptPhone = phone();
      const mergedPhone = phone();
      const kept = await withRelative(keptPhone, t.north);
      const merged = await withRelative(mergedPhone, t.north);
      return {
        kept,
        merged,
        input: {
          otherId: merged.relativeId,
          thisPhone: keptPhone,
          otherPhone: mergedPhone,
          phoneOf: 'this',
          nameOf: 'this',
        },
      };
    };

    const markAs = async (relativeId: string, staffId: string, cookie = t.vicePrincipal) => {
      const response = await t.put(
        `/api/people/relatives/${relativeId}/same-person`,
        t.north,
        { staffId },
        cookie,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
    };

    const setExtra = (relativeId: string, extraPhones: string[]) =>
      t.database.migrator
        .updateTable('relatives')
        .set({ extra_phones: extraPhones })
        .where('id', '=', relativeId)
        .execute();

    it('fills the kept record with the extra phones and the mark of the other, and empties it', async () => {
      const { kept, merged, input } = await mergePair();
      const teacher = await staffMember(t.north);
      const extra = phone();
      await setExtra(merged.relativeId, [extra]);
      await markAs(merged.relativeId, teacher);
      const response = await merge(kept.relativeId, input, t.north);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(relativeDetailSchema.parse(response.body)).toMatchObject({
        extraPhones: [extra],
        samePerson: { staffId: teacher },
      });
      expect(await extraOf(kept.relativeId)).toEqual({ extra_phones: [extra], staff_id: teacher });
      expect(await extraOf(merged.relativeId)).toEqual({ extra_phones: [], staff_id: null });
      expect(await schoolEntries('relative.merge', kept.relativeId)).toEqual([
        expect.objectContaining({
          old_value: expect.objectContaining({ extraPhones: [], staffId: null }) as unknown,
          new_value: expect.objectContaining({ extraPhones: [extra], staffId: teacher }) as unknown,
        }),
      ]);
      expect(await schoolEntries('relative.merged', merged.relativeId)).toEqual([
        expect.objectContaining({
          old_value: expect.objectContaining({ extraPhones: [extra], staffId: teacher }) as unknown,
          new_value: expect.objectContaining({ extraPhones: [], staffId: null }) as unknown,
        }),
      ]);
    });

    it('keeps the extra phones and the mark of the kept record', async () => {
      const { kept, merged, input } = await mergePair();
      const teacher = await staffMember(t.north);
      const keptExtra = phone();
      await setExtra(kept.relativeId, [keptExtra]);
      await setExtra(merged.relativeId, [phone()]);
      await markAs(kept.relativeId, teacher);
      const response = await merge(kept.relativeId, input, t.north);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await extraOf(kept.relativeId)).toEqual({
        extra_phones: [keptExtra],
        staff_id: teacher,
      });
    });

    it('refuses two records marked as two different staff members, changing nothing', async () => {
      const { kept, merged, input } = await mergePair();
      await markAs(kept.relativeId, await staffMember(t.north));
      await markAs(merged.relativeId, await staffMember(t.north));
      const before = await snapshot();
      refusedWith(await merge(kept.relativeId, input, t.north), 422, 'merge_marks_differ');
      expect(await snapshot()).toEqual(before);
    });

    it('refuses to the Academic Vice Principal a mark to move of a staff member of another branch; the Super Admin moves it', async () => {
      const { kept, merged, input } = await mergePair();
      const teacher = await staffMember(t.south, [t.north]);
      await markAs(merged.relativeId, teacher);
      // The teacher leaves the north: the mark stays, out of the north's sight.
      await t.database.migrator
        .deleteFrom('staff_branches')
        .where('staff_id', '=', teacher)
        .where('branch_id', '=', t.north)
        .execute();
      const before = await snapshot();
      refusedWith(await merge(kept.relativeId, input, t.north), 403, 'merge_needs_super_admin');
      expect(await snapshot()).toEqual(before);
      const response = await merge(kept.relativeId, input, t.north, t.admin);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await extraOf(kept.relativeId)).toMatchObject({ staff_id: teacher });
      expect(await extraOf(merged.relativeId)).toMatchObject({ staff_id: null });
    });
  });
});
