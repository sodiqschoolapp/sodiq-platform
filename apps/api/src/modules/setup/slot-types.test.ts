import { apiErrorSchema, slotTypeListSchema, slotTypeSchema } from '@sodiq/shared';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  START,
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const detailPaths = (response: Response): string[] =>
  apiErrorSchema.parse(response.body).error.details?.map((detail) => detail.path) ?? [];

// docs/spec/03-school-setup.md, Slot types and day templates: "A slot type has
// a name, a kind (lesson or break) and a length in minutes: for example Lesson
// 45, Break 15, Long break 20, Lunch 40." The owner's answers 9, 12 and 14;
// the plan of pull request #46.
describe('slot types', () => {
  let t: DayTemplatesKit;

  beforeAll(async () => {
    t = await dayTemplatesKit();
  });

  afterAll(async () => {
    await t.close();
  });

  it('are created by the Super Admin and the Academic Vice Principal, the length in force from today, with an audit entry', async () => {
    const branch = t.north;
    const response = await t.post(
      '/api/setup/slot-types',
      branch,
      { name: 'Lesson 45', kind: 'lesson', lengthMinutes: 45 },
      t.vicePrincipal,
    );

    expect(response.status).toBe(201);
    const slotType = slotTypeSchema.parse(response.body);
    expect(slotType).toEqual({
      id: slotType.id,
      name: 'Lesson 45',
      kind: 'lesson',
      lengthMinutes: 45,
      lengths: [{ lengthMinutes: 45, validFrom: TODAY, validUntil: null }],
      archivedAt: null,
    });
    const [entry] = await t.entries('slot_type.create', slotType.id);
    expect(entry).toMatchObject({
      branch_id: branch,
      assignment_id: t.viceAssignment,
      record_type: 'slot_type',
      new_value: { name: 'Lesson 45', kind: 'lesson', lengthMinutes: 45, validFrom: TODAY },
      request_id: response.headers['x-request-id'],
    });
    const admin = await t.post('/api/setup/slot-types', branch, {
      name: 'Lunch',
      kind: 'break',
      lengthMinutes: 40,
    });
    expect(admin.status).toBe(201);
    const [adminEntry] = await t.entries('slot_type.create', slotTypeSchema.parse(admin.body).id);
    expect(adminEntry).toMatchObject({ assignment_id: t.adminAssignment });
  });

  it('are listed by name in their branch only, for the Principal too', async () => {
    const branch = await t.newBranch();
    await t.createSlotType(branch, 'Long break', 'break', 20);
    await t.createSlotType(branch, 'Break 15', 'break', 15);

    for (const cookie of [t.admin, t.principal]) {
      const response = await t.get(
        '/api/setup/slot-types',
        cookie === t.admin ? branch : t.north,
        cookie,
      );
      expect(response.status).toBe(200);
    }
    const list = slotTypeListSchema.parse((await t.get('/api/setup/slot-types', branch)).body);
    expect(list.slotTypes.map((one) => one.name)).toEqual(['Break 15', 'Long break']);
    const other = await t.newBranch();
    expect((await t.get('/api/setup/slot-types', other)).body).toEqual({
      today: TODAY,
      slotTypes: [],
    });
  });

  it('are refused to the Principal and a Teacher on every write, and to a Teacher on reading; nothing is written', async () => {
    const id = await t.createSlotType(t.north, 'Refused one');
    const before = await t.auditCount();
    for (const cookie of [t.principal, t.teacher]) {
      const writes = [
        t.post(
          '/api/setup/slot-types',
          t.north,
          { name: 'X', kind: 'lesson', lengthMinutes: 45 },
          cookie,
        ),
        t.patch(`/api/setup/slot-types/${id}`, t.north, { name: 'Y' }, cookie),
        t.post(
          `/api/setup/slot-types/${id}/lengths`,
          t.north,
          { lengthMinutes: 40, from: TOMORROW },
          cookie,
        ),
        t.post(`/api/setup/slot-types/${id}/archive`, t.north, {}, cookie),
        t.post(`/api/setup/slot-types/${id}/restore`, t.north, {}, cookie),
      ];
      for (const response of await Promise.all(writes)) {
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
    }
    expect((await t.get('/api/setup/slot-types', t.north, t.teacher)).status).toBe(403);
    expect(await t.auditCount()).toBe(before);
  });

  it('answer 404 for a slot type of another branch or an unknown one, and change nothing in either branch', async () => {
    const other = await t.newBranch();
    const foreign = await t.createSlotType(other, 'Foreign');
    // Task 5.5a-3b-1: a draft in each branch, which a length change would mark.
    await t.draftIn(t.north);
    await t.draftIn(other);
    const rows = [await t.rowsOf(t.north), await t.rowsOf(other)];
    const before = await t.auditCount();
    for (const id of [foreign, UNKNOWN]) {
      for (const response of [
        await t.patch(`/api/setup/slot-types/${id}`, t.north, { name: 'Taken over' }),
        await t.post(`/api/setup/slot-types/${id}/lengths`, t.north, {
          lengthMinutes: 40,
          from: TOMORROW,
        }),
        // 404 comes before any other refusal, here the date of today.
        await t.post(`/api/setup/slot-types/${id}/lengths`, t.north, {
          lengthMinutes: 40,
          from: TODAY,
        }),
        await t.post(`/api/setup/slot-types/${id}/archive`, t.north),
        await t.post(`/api/setup/slot-types/${id}/restore`, t.north),
      ]) {
        expect(response.status).toBe(404);
      }
    }
    expect(await t.auditCount()).toBe(before);
    // The names, archive times and lengths (what `/lengths` writes) of both branches.
    expect([await t.rowsOf(t.north), await t.rowsOf(other)]).toEqual(rows);
  });

  it('validate what is typed', async () => {
    for (const [body, path] of [
      [{ name: '', kind: 'lesson', lengthMinutes: 45 }, 'name'],
      [{ name: 'Short', kind: 'lesson', lengthMinutes: 4 }, 'lengthMinutes'],
      [{ name: 'Long', kind: 'lesson', lengthMinutes: 181 }, 'lengthMinutes'],
      [{ name: 'Lunch', kind: 'lunch', lengthMinutes: 40 }, 'kind'],
    ] as const) {
      const response = await t.post('/api/setup/slot-types', t.north, body);
      expect(response.status).toBe(400);
      expect(detailPaths(response)).toContain(path);
    }
  });

  // Decision 16: unique per branch among active rows, case and outer spaces ignored.
  it('refuse a name an active slot type of the branch has, naming the field, for a restore too', async () => {
    const branch = await t.newBranch();
    const lunch = await t.createSlotType(branch, 'Обед', 'break', 40);

    const taken = await t.post('/api/setup/slot-types', branch, {
      name: ' ОБЕД ',
      kind: 'break',
      lengthMinutes: 30,
    });
    expect(taken.status).toBe(409);
    expect(errorCode(taken)).toBe('already_exists');
    expect(detailPaths(taken)).toEqual(['name']);

    expect((await t.post(`/api/setup/slot-types/${lunch}/archive`, branch)).status).toBe(200);
    await t.createSlotType(branch, 'обед', 'break', 30);
    const restore = await t.post(`/api/setup/slot-types/${lunch}/restore`, branch);
    expect(restore.status).toBe(409);
    expect(errorCode(restore)).toBe('already_exists');
    expect(detailPaths(restore)).toEqual(['name']);
  });

  it('are renamed in place with an entry; the same name writes nothing; an archived one is not renamed', async () => {
    const branch = await t.newBranch();
    const id = await t.createSlotType(branch, 'Lesson');

    const renamed = await t.patch(`/api/setup/slot-types/${id}`, branch, { name: 'Lesson 45' });
    expect(renamed.status).toBe(200);
    expect(slotTypeSchema.parse(renamed.body).name).toBe('Lesson 45');
    expect(await t.entries('slot_type.rename', id)).toEqual([
      expect.objectContaining({ old_value: { name: 'Lesson' }, new_value: { name: 'Lesson 45' } }),
    ]);
    await t.patch(`/api/setup/slot-types/${id}`, branch, { name: 'Lesson 45' });
    expect(await t.entries('slot_type.rename', id)).toHaveLength(1);

    await t.post(`/api/setup/slot-types/${id}/archive`, branch);
    const archived = await t.patch(`/api/setup/slot-types/${id}`, branch, { name: 'Other' });
    expect(archived.status).toBe(409);
    expect(errorCode(archived)).toBe('slot_type_archived');
  });

  // Answer 12 and edge/time-dates-calendar, "A slot type's length … is changed
  // mid-year": "The change takes effect from a chosen date, tomorrow at the earliest."
  describe('change length', () => {
    it('from tomorrow at the earliest in branch time', async () => {
      const branch = await t.newBranch();
      const id = await t.createSlotType(branch, 'Lesson 45');
      const before = await t.auditCount();

      const today = await t.post(`/api/setup/slot-types/${id}/lengths`, branch, {
        lengthMinutes: 40,
        from: TODAY,
      });
      expect(today.status).toBe(409);
      expect(errorCode(today)).toBe('date_not_in_future');
      expect(detailPaths(today)).toEqual(['from']);
      expect(await t.auditCount()).toBe(before);

      const tomorrow = await t.post(`/api/setup/slot-types/${id}/lengths`, branch, {
        lengthMinutes: 40,
        from: TOMORROW,
      });
      expect(tomorrow.status).toBe(200);
      expect(slotTypeSchema.parse(tomorrow.body)).toMatchObject({
        lengthMinutes: 45,
        lengths: [
          { lengthMinutes: 45, validFrom: TODAY, validUntil: TOMORROW },
          { lengthMinutes: 40, validFrom: TOMORROW, validUntil: null },
        ],
      });
      expect(await t.entries('slot_type.length_change', id)).toEqual([
        expect.objectContaining({
          old_value: { cut: { lengthMinutes: 45, validFrom: TODAY, validUntil: null } },
          new_value: { lengthMinutes: 40, validFrom: TOMORROW, validUntil: null },
        }),
      ]);
    });

    // edge/00-definitions, Branch time: every date rule uses the branch's local time.
    it('reads today in branch time: at 19:01 UTC on the 10th it is already the 11th in Tashkent', async () => {
      const branch = await t.newBranch();
      const id = await t.createSlotType(branch, 'Lesson 45');
      t.clock.set('2026-10-10T19:01:00Z');
      try {
        const response = await t.post(`/api/setup/slot-types/${id}/lengths`, branch, {
          lengthMinutes: 40,
          from: TOMORROW,
        });
        expect(response.status).toBe(409);
        expect(errorCode(response)).toBe('date_not_in_future');
      } finally {
        t.clock.set(START);
      }
    });

    it('keeps a change already planned after the date', async () => {
      const branch = await t.newBranch();
      const id = await t.createSlotType(branch, 'Lesson 45');
      await t.post(`/api/setup/slot-types/${id}/lengths`, branch, {
        lengthMinutes: 40,
        from: '2026-11-01',
      });

      const response = await t.post(`/api/setup/slot-types/${id}/lengths`, branch, {
        lengthMinutes: 50,
        from: '2026-10-20',
      });
      expect(slotTypeSchema.parse(response.body).lengths).toEqual([
        { lengthMinutes: 45, validFrom: TODAY, validUntil: '2026-10-20' },
        { lengthMinutes: 50, validFrom: '2026-10-20', validUntil: '2026-11-01' },
        { lengthMinutes: 40, validFrom: '2026-11-01', validUntil: null },
      ]);

      // A change on the very date of a planned one replaces it; the old one is withdrawn, kept as history.
      const replaced = await t.post(`/api/setup/slot-types/${id}/lengths`, branch, {
        lengthMinutes: 35,
        from: '2026-11-01',
      });
      expect(slotTypeSchema.parse(replaced.body).lengths.map((one) => one.lengthMinutes)).toEqual([
        45, 50, 35,
      ]);
      const rows = await t.database.migrator
        .selectFrom('slot_type_lengths')
        .select(['length_minutes', 'valid_from', 'valid_until'])
        .where('slot_type_id', '=', id)
        .orderBy('created_at')
        .execute();
      expect(rows).toContainEqual({
        length_minutes: 40,
        valid_from: '2026-11-01',
        valid_until: '2026-11-01',
      });
    });

    it('is refused for an archived slot type', async () => {
      const branch = await t.newBranch();
      const id = await t.createSlotType(branch, 'Lesson 45');
      await t.post(`/api/setup/slot-types/${id}/archive`, branch);
      const response = await t.post(`/api/setup/slot-types/${id}/lengths`, branch, {
        lengthMinutes: 40,
        from: TOMORROW,
      });
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('slot_type_archived');
    });

    // Decision 7: a day ends by midnight on every date a change reaches.
    it('is refused when a day would end after midnight on any date the change reaches', async () => {
      const branch = await t.newBranch();
      const lesson = await t.createSlotType(branch, 'Lesson 45');
      const template = await t.createTemplate(branch, 'Late', [lesson], '23:00');
      // From 1 November the template starts at 23:10.
      await t.post(`/api/setup/day-templates/${template}/versions`, branch, {
        from: '2026-11-01',
        startTime: '23:10',
        slotTypeIds: [lesson],
      });
      const before = await t.auditCount();

      // 23:00 + 61 runs past midnight on the 20th.
      const tooLong = await t.post(`/api/setup/slot-types/${lesson}/lengths`, branch, {
        lengthMinutes: 61,
        from: '2026-10-20',
      });
      expect(tooLong.status).toBe(409);
      expect(errorCode(tooLong)).toBe('day_past_midnight');
      expect(detailPaths(tooLong)).toEqual(['lengthMinutes']);
      // 23:00 + 55 ends in time on the 20th, but 23:10 + 55 does not from 1 November.
      const later = await t.post(`/api/setup/slot-types/${lesson}/lengths`, branch, {
        lengthMinutes: 55,
        from: '2026-10-20',
      });
      expect(errorCode(later)).toBe('day_past_midnight');
      expect(await t.auditCount()).toBe(before);
      // 23:10 + 50 ends at 24:00 exactly: allowed (half-open ranges).
      const atMidnight = await t.post(`/api/setup/slot-types/${lesson}/lengths`, branch, {
        lengthMinutes: 50,
        from: '2026-10-20',
      });
      expect(atMidnight.status).toBe(200);
    });
  });

  // Answer 9: "archived when unused, never deleted"; decision 11.
  describe('archive', () => {
    it('archives an unused slot type at the moment of the clock, once only, and restores it, with an entry each', async () => {
      const branch = await t.newBranch();
      const id = await t.createSlotType(branch, 'Break 15', 'break', 15);

      const archived = await t.post(`/api/setup/slot-types/${id}/archive`, branch);
      expect(archived.status).toBe(200);
      expect(slotTypeSchema.parse(archived.body).archivedAt).toBe('2026-10-10T18:55:00.000Z');
      await t.post(`/api/setup/slot-types/${id}/archive`, branch);
      expect(await t.entries('slot_type.archive', id)).toHaveLength(1);

      const restored = await t.post(`/api/setup/slot-types/${id}/restore`, branch);
      expect(slotTypeSchema.parse(restored.body).archivedAt).toBeNull();
      expect(await t.entries('slot_type.restore', id)).toHaveLength(1);
    });

    it('is refused while an active template uses it from today on, and allowed once that template is archived', async () => {
      const branch = await t.newBranch();
      const lesson = await t.createSlotType(branch, 'Lesson 45');
      const template = await t.createTemplate(branch, 'Main', [lesson]);
      const before = await t.auditCount();

      const refused = await t.post(`/api/setup/slot-types/${lesson}/archive`, branch);
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('slot_type_in_use');
      expect(await t.auditCount()).toBe(before);

      expect((await t.post(`/api/setup/day-templates/${template}/archive`, branch)).status).toBe(
        200,
      );
      expect((await t.post(`/api/setup/slot-types/${lesson}/archive`, branch)).status).toBe(200);
    });

    it('is allowed when only a version that has ended uses it', async () => {
      const branch = await t.newBranch();
      const lesson = await t.createSlotType(branch, 'Lesson 45');
      const other = await t.createSlotType(branch, 'Lesson 40', 'lesson', 40);
      const template = await t.createTemplate(branch, 'Main', [lesson]);
      // From tomorrow the template uses the other one; today's version still names it.
      await t.post(`/api/setup/day-templates/${template}/versions`, branch, {
        from: TOMORROW,
        startTime: '08:00',
        slotTypeIds: [other],
      });
      const today = await t.post(`/api/setup/slot-types/${lesson}/archive`, branch);
      expect(errorCode(today)).toBe('slot_type_in_use');

      // As it stands tomorrow: the first version ended (the migrator, which a day of the clock would end the sessions).
      await t.database.migrator
        .updateTable('day_template_versions')
        .set({ valid_until: TODAY })
        .where('day_template_id', '=', template)
        .where('valid_from', '=', TODAY)
        .execute();
      expect((await t.post(`/api/setup/slot-types/${lesson}/archive`, branch)).status).toBe(200);
    });
  });
});
