import { apiErrorSchema, dayTemplateListSchema, dayTemplateSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { Transactions } from '../../database/transactions.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const detailPaths = (response: Response): string[] =>
  apiErrorSchema.parse(response.body).error.details?.map((detail) => detail.path) ?? [];

/** "08:30" as minutes after midnight. */
const at = (hours: number, minutes: number): number => hours * 60 + minutes;

// docs/spec/03-school-setup.md, Slot types and day templates: "A day template
// is a start time and an ordered list of slots chosen from these types. The
// Academic Vice Principal adds, removes and reorders slots; every start and
// end time is calculated from the order and the lengths. Times are never typed
// by hand." The owner's answers 10, 12 and 14; the plan of pull request #46.
describe('day templates', () => {
  let t: DayTemplatesKit;

  beforeAll(async () => {
    t = await dayTemplatesKit();
  });

  afterAll(async () => {
    await t.close();
  });

  /** A branch with Lesson 45, Break 15 and Lunch 40. */
  async function slotTypes() {
    const branch = await t.newBranch();
    return {
      branch,
      lesson: await t.createSlotType(branch, 'Lesson 45'),
      pause: await t.createSlotType(branch, 'Break 15', 'break', 15),
      lunch: await t.createSlotType(branch, 'Lunch', 'break', 40),
    };
  }

  it('are created with the times calculated from the start, the order and the lengths, in force from today, with an entry', async () => {
    const { branch, lesson, pause, lunch } = await slotTypes();

    const response = await t.post(
      '/api/setup/day-templates',
      branch,
      { name: 'Main', startTime: '08:30', slotTypeIds: [lesson, pause, lesson, lunch, lesson] },
      t.vicePrincipal,
    );

    // The Academic Vice Principal of the north branch is refused in another branch.
    expect(response.status).toBe(403);
    const created = await t.post('/api/setup/day-templates', branch, {
      name: 'Main',
      startTime: '08:30',
      slotTypeIds: [lesson, pause, lesson, lunch, lesson],
    });
    expect(created.status).toBe(201);
    const template = dayTemplateSchema.parse(created.body);
    expect(template.date).toBe(TODAY);
    expect(
      template.slots.map((slot) => [slot.name, slot.start, slot.end, slot.lessonNumber]),
    ).toEqual([
      ['Lesson 45', at(8, 30), at(9, 15), 1],
      ['Break 15', at(9, 15), at(9, 30), null],
      ['Lesson 45', at(9, 30), at(10, 15), 2],
      ['Lunch', at(10, 15), at(10, 55), null],
      ['Lesson 45', at(10, 55), at(11, 40), 3],
    ]);
    expect(template.versions).toEqual([
      {
        id: expect.any(String) as string,
        startMinutes: at(8, 30),
        slotTypeIds: [lesson, pause, lesson, lunch, lesson],
        validFrom: TODAY,
        validUntil: null,
      },
    ]);
    const [entry] = await t.entries('day_template.create', template.id);
    expect(entry).toMatchObject({
      branch_id: branch,
      assignment_id: t.adminAssignment,
      new_value: { name: 'Main', startTime: '08:30', validFrom: TODAY },
      request_id: created.headers['x-request-id'],
    });
  });

  it('are created by the Academic Vice Principal of the branch and listed with their day, for the Principal too', async () => {
    const lesson = await t.createSlotType(t.north, 'Lesson 40', 'lesson', 40);
    const response = await t.post(
      '/api/setup/day-templates',
      t.north,
      { name: 'Primary', startTime: '08:00', slotTypeIds: [lesson, lesson] },
      t.vicePrincipal,
    );
    expect(response.status).toBe(201);
    const [entry] = await t.entries(
      'day_template.create',
      dayTemplateSchema.parse(response.body).id,
    );
    expect(entry).toMatchObject({ assignment_id: t.viceAssignment });

    for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
      const list = await t.get('/api/setup/day-templates', t.north, cookie);
      expect(list.status).toBe(200);
      expect(dayTemplateListSchema.parse(list.body).dayTemplates).toContainEqual({
        id: dayTemplateSchema.parse(response.body).id,
        name: 'Primary',
        archivedAt: null,
        start: at(8, 0),
        end: at(9, 20),
        lessonSlots: 2,
        inUse: false,
      });
    }
    expect((await t.get('/api/setup/day-templates', t.north, t.teacher)).status).toBe(403);
  });

  it('are refused to the Principal and a Teacher on every write; nothing is written', async () => {
    const lesson = await t.createSlotType(t.north, 'Lesson refused');
    const id = await t.createTemplate(t.north, 'Refused', [lesson]);
    const before = await t.auditCount();
    for (const cookie of [t.principal, t.teacher]) {
      for (const response of [
        await t.post(
          '/api/setup/day-templates',
          t.north,
          { name: 'X', startTime: '08:00', slotTypeIds: [lesson] },
          cookie,
        ),
        await t.patch(`/api/setup/day-templates/${id}`, t.north, { name: 'Y' }, cookie),
        await t.post(
          `/api/setup/day-templates/${id}/versions`,
          t.north,
          { from: TOMORROW, startTime: '08:00', slotTypeIds: [lesson] },
          cookie,
        ),
        await t.post(`/api/setup/day-templates/${id}/archive`, t.north, {}, cookie),
        await t.post(`/api/setup/day-templates/${id}/restore`, t.north, {}, cookie),
      ]) {
        expect(response.status).toBe(403);
      }
    }
    expect(
      (await t.get(`/api/setup/day-templates/${id}?date=${TODAY}`, t.north, t.teacher)).status,
    ).toBe(403);
    expect(await t.auditCount()).toBe(before);
  });

  it('answer 404 for a template of another branch or an unknown one, and change nothing', async () => {
    const { branch, lesson } = await slotTypes();
    const other = await slotTypes();
    const foreign = await t.createTemplate(other.branch, 'Foreign', [other.lesson]);
    const before = await t.auditCount();
    const foreignRows = () =>
      Promise.all([
        t.database.migrator
          .selectFrom('day_templates')
          .select(['name', 'archived_at'])
          .where('id', '=', foreign)
          .execute(),
        t.database.migrator
          .selectFrom('day_template_versions')
          .select(['id', 'valid_from', 'valid_until'])
          .where('day_template_id', '=', foreign)
          .orderBy('id')
          .execute(),
      ]);
    const rowsBefore = await foreignRows();
    for (const id of [foreign, UNKNOWN]) {
      for (const response of [
        await t.get(`/api/setup/day-templates/${id}?date=${TODAY}`, branch),
        await t.patch(`/api/setup/day-templates/${id}`, branch, { name: 'Taken over' }),
        await t.post(`/api/setup/day-templates/${id}/versions`, branch, {
          from: TOMORROW,
          startTime: '08:00',
          slotTypeIds: [lesson],
        }),
        await t.post(`/api/setup/day-templates/${id}/archive`, branch),
        await t.post(`/api/setup/day-templates/${id}/restore`, branch),
      ]) {
        expect(response.status).toBe(404);
      }
    }
    expect(await t.auditCount()).toBe(before);
    expect(await foreignRows()).toEqual(rowsBefore);
  });

  it('refuse a slot type of another branch or an unknown one with 404, never a 500 from the key, for a new version too', async () => {
    const { branch, lesson } = await slotTypes();
    const other = await slotTypes();
    const own = await t.createTemplate(branch, 'Own', [lesson]);
    const versions = () =>
      t.database.migrator
        .selectFrom('day_template_versions')
        .select(['id', 'valid_until'])
        .where('day_template_id', '=', own)
        .orderBy('id')
        .execute();
    const versionsBefore = await versions();
    const before = await t.auditCount();
    for (const slotTypeIds of [[lesson, other.lesson], [UNKNOWN]]) {
      const response = await t.post(`/api/setup/day-templates/${own}/versions`, branch, {
        from: TOMORROW,
        startTime: '08:00',
        slotTypeIds,
      });
      expect(response.status).toBe(404);
    }
    expect(await versions()).toEqual(versionsBefore);
    for (const slotTypeIds of [[lesson, other.lesson], [UNKNOWN]]) {
      const response = await t.post('/api/setup/day-templates', branch, {
        name: 'Mixed',
        startTime: '08:00',
        slotTypeIds,
      });
      expect(response.status).toBe(404);
    }
    expect(await t.auditCount()).toBe(before);
  });

  // Answer 10: "1 to 20 ordered slots with at least one lesson slot".
  it('need at least one lesson slot, and at most twenty slots', async () => {
    const { branch, lesson, lunch } = await slotTypes();
    const breaks = await t.post('/api/setup/day-templates', branch, {
      name: 'Breaks only',
      startTime: '08:00',
      slotTypeIds: [lunch, lunch],
    });
    expect(breaks.status).toBe(409);
    expect(errorCode(breaks)).toBe('no_lesson_slot');
    expect(detailPaths(breaks)).toEqual(['slotTypeIds']);

    const many = await t.post('/api/setup/day-templates', branch, {
      name: 'Too many',
      startTime: '00:00',
      slotTypeIds: Array.from({ length: 21 }, () => lesson),
    });
    expect(many.status).toBe(400);
    expect(
      (
        await t.post('/api/setup/day-templates', branch, {
          name: 'Twenty',
          startTime: '00:00',
          slotTypeIds: Array.from({ length: 20 }, () => lesson),
        })
      ).status,
    ).toBe(201);
  });

  it('refuse a start time typed otherwise than HH:MM', async () => {
    const { branch, lesson } = await slotTypes();
    const response = await t.post('/api/setup/day-templates', branch, {
      name: 'Odd',
      startTime: '8.30',
      slotTypeIds: [lesson],
    });
    expect(response.status).toBe(400);
    expect(detailPaths(response)).toEqual(['startTime']);
  });

  it('refuse an archived slot type', async () => {
    const { branch, lesson, lunch } = await slotTypes();
    await t.post(`/api/setup/slot-types/${lunch}/archive`, branch);
    const response = await t.post('/api/setup/day-templates', branch, {
      name: 'With archived',
      startTime: '08:00',
      slotTypeIds: [lesson, lunch],
    });
    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('slot_type_archived');
    expect(detailPaths(response)).toEqual(['slotTypeIds']);
  });

  // Decision 7.
  it('refuse a day that ends after midnight, and allow one that ends at 24:00', async () => {
    const { branch, lesson } = await slotTypes();
    const late = await t.post('/api/setup/day-templates', branch, {
      name: 'Late',
      startTime: '23:16',
      slotTypeIds: [lesson],
    });
    expect(late.status).toBe(409);
    expect(errorCode(late)).toBe('day_past_midnight');
    expect(
      (
        await t.post('/api/setup/day-templates', branch, {
          name: 'Late',
          startTime: '23:15',
          slotTypeIds: [lesson],
        })
      ).status,
    ).toBe(201);
  });

  // Decision 16.
  it('refuse a name an active template of the branch has, naming the field, for a restore too', async () => {
    const { branch, lesson } = await slotTypes();
    const main = await t.createTemplate(branch, 'Главный', [lesson]);
    const taken = await t.post('/api/setup/day-templates', branch, {
      name: 'ГЛАВНЫЙ',
      startTime: '08:00',
      slotTypeIds: [lesson],
    });
    expect(taken.status).toBe(409);
    expect(errorCode(taken)).toBe('already_exists');
    expect(detailPaths(taken)).toEqual(['name']);

    await t.post(`/api/setup/day-templates/${main}/archive`, branch);
    await t.createTemplate(branch, 'главный', [lesson]);
    const restore = await t.post(`/api/setup/day-templates/${main}/restore`, branch);
    expect(restore.status).toBe(409);
    expect(errorCode(restore)).toBe('already_exists');
    expect(detailPaths(restore)).toEqual(['name']);
  });

  it('are renamed in place with an entry; an archived one is not', async () => {
    const { branch, lesson } = await slotTypes();
    const id = await t.createTemplate(branch, 'Main', [lesson]);
    const renamed = await t.patch(`/api/setup/day-templates/${id}`, branch, { name: 'Senior' });
    expect(dayTemplateSchema.parse(renamed.body).name).toBe('Senior');
    expect(await t.entries('day_template.rename', id)).toEqual([
      expect.objectContaining({ old_value: { name: 'Main' }, new_value: { name: 'Senior' } }),
    ]);
    await t.post(`/api/setup/day-templates/${id}/archive`, branch);
    expect(errorCode(await t.patch(`/api/setup/day-templates/${id}`, branch, { name: 'X' }))).toBe(
      'template_archived',
    );
  });

  // Answer 12: "changing … a template's slots creates a new version from a
  // chosen date, tomorrow at the earliest, history kept".
  describe('a new version', () => {
    it('takes effect from tomorrow at the earliest; the old version keeps today, the times move with the order', async () => {
      const { branch, lesson, lunch } = await slotTypes();
      const id = await t.createTemplate(branch, 'Main', [lesson, lunch, lesson]);
      const before = await t.auditCount();

      const today = await t.post(`/api/setup/day-templates/${id}/versions`, branch, {
        from: TODAY,
        startTime: '08:00',
        slotTypeIds: [lesson, lesson, lunch],
      });
      expect(errorCode(today)).toBe('date_not_in_future');
      expect(await t.auditCount()).toBe(before);

      // Lunch one slot later from tomorrow.
      const response = await t.post(`/api/setup/day-templates/${id}/versions`, branch, {
        from: TOMORROW,
        startTime: '08:00',
        slotTypeIds: [lesson, lesson, lunch],
      });
      expect(response.status).toBe(200);
      const template = dayTemplateSchema.parse(response.body);
      expect(template.date).toBe(TOMORROW);
      expect(template.slots.map((slot) => [slot.kind, slot.start, slot.end])).toEqual([
        ['lesson', at(8, 0), at(8, 45)],
        ['lesson', at(8, 45), at(9, 30)],
        ['break', at(9, 30), at(10, 10)],
      ]);
      expect(template.versions.map((version) => [version.validFrom, version.validUntil])).toEqual([
        [TODAY, TOMORROW],
        [TOMORROW, null],
      ]);
      const onToday = dayTemplateSchema.parse(
        (await t.get(`/api/setup/day-templates/${id}?date=${TODAY}`, branch)).body,
      );
      expect(onToday.slots.map((slot) => slot.kind)).toEqual(['lesson', 'break', 'lesson']);
      expect(await t.entries('day_template.version_create', id)).toEqual([
        expect.objectContaining({
          old_value: {
            cut: {
              startTime: '08:00',
              slotTypeIds: [lesson, lunch, lesson],
              validFrom: TODAY,
              validUntil: null,
            },
          },
          new_value: {
            startTime: '08:00',
            slotTypeIds: [lesson, lesson, lunch],
            validFrom: TOMORROW,
            validUntil: null,
          },
        }),
      ]);
    });

    it('uses the length of each slot type in force on the date', async () => {
      const { branch, lesson } = await slotTypes();
      const id = await t.createTemplate(branch, 'Main', [lesson, lesson]);
      await t.post(`/api/setup/slot-types/${lesson}/lengths`, branch, {
        lengthMinutes: 40,
        from: '2026-11-01',
      });
      const october = dayTemplateSchema.parse(
        (await t.get(`/api/setup/day-templates/${id}?date=2026-10-31`, branch)).body,
      );
      const november = dayTemplateSchema.parse(
        (await t.get(`/api/setup/day-templates/${id}?date=2026-11-01`, branch)).body,
      );
      expect(october.slots.map((slot) => slot.end)).toEqual([at(8, 45), at(9, 30)]);
      expect(november.slots.map((slot) => slot.end)).toEqual([at(8, 40), at(9, 20)]);
    });

    it('is refused for an archived template, and for a day past midnight', async () => {
      const { branch, lesson } = await slotTypes();
      const id = await t.createTemplate(branch, 'Main', [lesson]);
      const late = await t.post(`/api/setup/day-templates/${id}/versions`, branch, {
        from: TOMORROW,
        startTime: '23:30',
        slotTypeIds: [lesson],
      });
      expect(errorCode(late)).toBe('day_past_midnight');
      expect(detailPaths(late)).toEqual(['startTime', 'slotTypeIds']);
      await t.post(`/api/setup/day-templates/${id}/archive`, branch);
      const archived = await t.post(`/api/setup/day-templates/${id}/versions`, branch, {
        from: TOMORROW,
        startTime: '08:00',
        slotTypeIds: [lesson],
      });
      expect(errorCode(archived)).toBe('template_archived');
    });
  });

  describe('archive', () => {
    it('archives a template no setting names from today on, once only, and restores it, with an entry each', async () => {
      const { branch, lesson } = await slotTypes();
      const id = await t.createTemplate(branch, 'Main', [lesson]);
      const archived = await t.post(`/api/setup/day-templates/${id}/archive`, branch);
      expect(dayTemplateSchema.parse(archived.body).archivedAt).toBe('2026-10-10T18:55:00.000Z');
      await t.post(`/api/setup/day-templates/${id}/archive`, branch);
      expect(await t.entries('day_template.archive', id)).toHaveLength(1);
      const restored = await t.post(`/api/setup/day-templates/${id}/restore`, branch);
      expect(dayTemplateSchema.parse(restored.body).archivedAt).toBeNull();
      expect(await t.entries('day_template.restore', id)).toHaveLength(1);
    });

    it('is refused while a setting names the template from today on', async () => {
      const { branch, lesson } = await slotTypes();
      const id = await t.createTemplate(branch, 'Main', [lesson]);
      await t.assign(branch, id);
      const before = await t.auditCount();
      const response = await t.post(`/api/setup/day-templates/${id}/archive`, branch);
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('template_in_use');
      expect(await t.auditCount()).toBe(before);
    });

    it('refuses the restore of a template whose version from today on uses an archived slot type', async () => {
      const { branch, lesson, lunch } = await slotTypes();
      const id = await t.createTemplate(branch, 'Main', [lesson, lunch]);
      await t.post(`/api/setup/day-templates/${id}/archive`, branch);
      expect((await t.post(`/api/setup/slot-types/${lunch}/archive`, branch)).status).toBe(200);
      const response = await t.post(`/api/setup/day-templates/${id}/restore`, branch);
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('template_uses_archived_slot_type');
    });

    // The plan's spec review (finding 2): a length that changed while the template was archived.
    it('refuses the restore of a template whose day would now end after midnight', async () => {
      const { branch } = await slotTypes();
      const other = await t.createSlotType(branch, 'Lesson short', 'lesson', 30);
      const id = await t.createTemplate(branch, 'Late', [other], '23:30');
      await t.post(`/api/setup/day-templates/${id}/archive`, branch);
      // Only the archived template would run past midnight with the new length.
      expect(
        (
          await t.post(`/api/setup/slot-types/${other}/lengths`, branch, {
            lengthMinutes: 45,
            from: TOMORROW,
          })
        ).status,
      ).toBe(200);
      const before = await t.auditCount();
      const response = await t.post(`/api/setup/day-templates/${id}/restore`, branch);
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('day_past_midnight');
      expect(await t.auditCount()).toBe(before);
    });
  });

  // The review's decision 12: every write takes the branch row first, so two
  // writes that could race run one after the other. The test writes a new
  // version naming a slot type in a transaction of the application that holds
  // the branch row, as the version route does, sends the archive of that slot
  // type, sees it wait in pg_stat_activity, commits, and reads the answer: the
  // archive saw the version and is refused. Without the lock it would have read
  // the state before the commit and archived a slot type in use.
  it('runs the archive of a slot type after a write that holds the branch row, and sees what it wrote', async () => {
    const { branch, lesson } = await slotTypes();
    const spare = await t.createSlotType(branch, 'Lesson spare');
    const id = await t.createTemplate(branch, 'Main', [lesson]);
    const held = gate();
    const release = gate();

    const first = t.app.get(Transactions).run([branch], async (transaction) => {
      await transaction
        .selectFrom('branches')
        .select('id')
        .where('id', '=', branch)
        .forUpdate()
        .execute();
      // The version in force is cut first, as the route does.
      await transaction
        .updateTable('day_template_versions')
        .set({ valid_until: '2026-12-01' })
        .where('day_template_id', '=', id)
        .where('valid_from', '=', TODAY)
        .execute();
      const version = await transaction
        .insertInto('day_template_versions')
        .values({
          branch_id: branch,
          day_template_id: id,
          start_minutes: 480,
          valid_from: '2026-12-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('day_template_slots')
        .values({ version_id: version.id, branch_id: branch, position: 1, slot_type_id: spare })
        .execute();
      held.open();
      await release.opened;
    });
    await held.opened;

    try {
      const archive = t.post(`/api/setup/slot-types/${spare}/archive`, branch).then((sent) => sent);
      await waitForWaiter();
      release.open();
      await first;
      const response = await archive;
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('slot_type_in_use');
    } finally {
      release.open();
      await first.catch(() => undefined);
    }
  });

  /** A promise that is settled from outside. */
  function gate(): { opened: Promise<void>; open: () => void } {
    let open = (): void => undefined;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { opened, open };
  }

  /** Until a call of the application waits for a lock; names the backends when none does in time. */
  async function waitForWaiter(): Promise<void> {
    const backends = async () =>
      (
        await sql<{ state: string | null; wait_event_type: string | null }>`
          select state, wait_event_type from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid()
        `.execute(t.database.app)
      ).rows;
    for (let tries = 0; tries < 100; tries += 1) {
      if ((await backends()).some((backend) => backend.wait_event_type === 'Lock')) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`No call waited for the branch row. Seen: ${JSON.stringify(await backends())}`);
  }
});
