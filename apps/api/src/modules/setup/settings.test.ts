import { BRANCH_HEADER } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  START,
  TODAY,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const DEFAULTS = {
  editDays: 7,
  lowResult: 50,
  resultDrop: 15,
  attendancePercent: 80,
  absencesInRow: 3,
};

const THRESHOLDS = { lowResult: 45, resultDrop: 20, attendancePercent: 75, absencesInRow: 4 };

// All names are invented.
// Task 1.6 and the owner's answers 19 to 24 (docs/decisions.md, "Decided ahead
// for tasks 1.3 to 1.6"); the plan approved on pull request #49.
describe('the settings of a branch', () => {
  let t: DayTemplatesKit;

  beforeAll(async () => {
    t = await dayTemplatesKit();
  });

  afterAll(async () => {
    await t.close();
  });

  const put = (path: string, branch: string, body: object, cookie = t.admin) =>
    request(t.kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  const settingsRow = (branch: string) =>
    t.database.migrator
      .selectFrom('branch_settings')
      .selectAll()
      .where('branch_id', '=', branch)
      .executeTakeFirstOrThrow();

  const quartersOf = (branch: string) =>
    t.database.migrator
      .selectFrom('quarters')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute();

  /**
   * A year of four quarters, dated or not, written by the migrator as the
   * routes would: planned first, then moved on; returns the quarter ids.
   */
  async function insertYear(
    branch: string,
    startDate: string,
    endDate: string,
    status: 'planned' | 'current' | 'closed',
    quarterDates: readonly (readonly [string, string] | null)[],
  ): Promise<{ yearId: string; quarterIds: string[] }> {
    return t.database.migrator.transaction().execute(async (transaction) => {
      const year = await transaction
        .insertInto('academic_years')
        .values({ branch_id: branch, start_date: startDate, end_date: endDate })
        .returning('id')
        .executeTakeFirstOrThrow();
      const quarterIds: string[] = [];
      for (const [index, dates] of quarterDates.entries()) {
        const quarter = await transaction
          .insertInto('quarters')
          .values({
            branch_id: branch,
            academic_year_id: year.id,
            number: index + 1,
            start_date: dates?.[0] ?? null,
            end_date: dates?.[1] ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        quarterIds.push(quarter.id);
      }
      // The status moves only planned -> current -> closed, and a closed year takes no quarter.
      for (const next of ['current', 'closed'] as const) {
        if (status === 'planned' || (status === 'current' && next === 'closed')) {
          break;
        }
        await transaction
          .updateTable('academic_years')
          .set({ status: next })
          .where('id', '=', year.id)
          .execute();
      }
      return { yearId: year.id, quarterIds };
    });
  }

  const UNDATED = [null, null, null, null] as const;
  const DATED = [
    ['2026-09-02', '2026-10-31'],
    ['2026-11-09', '2026-12-28'],
    ['2027-01-11', '2027-03-19'],
    ['2027-03-29', '2027-05-25'],
  ] as const;

  describe('edit days and early-warning thresholds', () => {
    it('start with the defaults of the spec for every branch', async () => {
      for (const cookie of [t.admin, t.vicePrincipal, t.principal]) {
        const response = await t.get('/api/setup/settings', t.north, cookie);
        expect(response.status).toBe(200);
        expect(response.body).toEqual(DEFAULTS);
      }
    });

    it('take a new number of edit days from the Academic Vice Principal, audited with the old and new value', async () => {
      const branch = await t.newBranch();
      const response = await put('/api/setup/settings/edit-days', branch, { editDays: 10 });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ...DEFAULTS, editDays: 10 });

      const vice = await put(
        '/api/setup/settings/edit-days',
        t.north,
        { editDays: 5 },
        t.vicePrincipal,
      );
      expect(vice.status).toBe(200);
      expect((await settingsRow(t.north)).edit_days).toBe(5);
      const entries = await t.entries('settings.edit_days', t.north);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        branch_id: t.north,
        record_type: 'branch_settings',
        assignment_id: t.viceAssignment,
        old_value: { editDays: 7 },
        new_value: { editDays: 5 },
        request_id: vice.headers['x-request-id'],
      });
    });

    it('take the four thresholds, audited with the fields that changed', async () => {
      const branch = await t.newBranch();
      const response = await put('/api/setup/settings/early-warning', branch, THRESHOLDS);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ...THRESHOLDS, editDays: 7 });
      const entries = await t.entries('settings.early_warning', branch);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        assignment_id: t.adminAssignment,
        old_value: { lowResult: 50, resultDrop: 15, attendancePercent: 80, absencesInRow: 3 },
        new_value: THRESHOLDS,
      });
    });

    it('write nothing for a save that changes nothing', async () => {
      const branch = await t.newBranch();
      const before = await t.auditCount();
      expect((await put('/api/setup/settings/edit-days', branch, { editDays: 7 })).status).toBe(
        200,
      );
      expect(
        (
          await put('/api/setup/settings/early-warning', branch, {
            lowResult: 50,
            resultDrop: 15,
            attendancePercent: 80,
            absencesInRow: 3,
          })
        ).status,
      ).toBe(200);
      expect(await t.auditCount()).toBe(before);
    });

    it('refuse values outside their bounds', async () => {
      for (const body of [{ editDays: 0 }, { editDays: 31 }, { editDays: 7.5 }]) {
        const response = await put('/api/setup/settings/edit-days', t.north, body);
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('validation_failed');
      }
      const response = await put('/api/setup/settings/early-warning', t.north, {
        ...THRESHOLDS,
        absencesInRow: 31,
      });
      expect(response.status).toBe(400);
    });

    // Answer 24: the Principal views; nobody else changes anything.
    it('refuse the Principal and a Teacher, and change nothing', async () => {
      const before = await settingsRow(t.north);
      const count = await t.auditCount();
      for (const cookie of [t.principal, t.teacher]) {
        expect(
          (await put('/api/setup/settings/edit-days', t.north, { editDays: 9 }, cookie)).status,
        ).toBe(403);
        expect(
          (await put('/api/setup/settings/early-warning', t.north, THRESHOLDS, cookie)).status,
        ).toBe(403);
      }
      expect((await t.get('/api/setup/settings', t.north, t.teacher)).status).toBe(403);
      expect(await settingsRow(t.north)).toEqual(before);
      expect(await t.auditCount()).toBe(count);
    });

    it('refuse the Academic Vice Principal of one branch in another', async () => {
      const before = await settingsRow(t.south);
      expect(
        (await put('/api/setup/settings/edit-days', t.south, { editDays: 9 }, t.vicePrincipal))
          .status,
      ).toBe(403);
      expect(await settingsRow(t.south)).toEqual(before);
    });
  });

  // Answer 20; edge/calculation: "stored per branch and quarter".
  describe('late and skipped values', () => {
    it('are listed for the quarters of the planned and current years, 50 and 0 by default', async () => {
      const branch = await t.newBranch();
      await insertYear(branch, '2025-09-01', '2026-06-30', 'closed', UNDATED);
      const { quarterIds } = await insertYear(branch, '2026-09-01', '2027-06-30', 'planned', DATED);

      const response = await t.get('/api/setup/attendance-values', branch);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        years: [
          {
            id: expect.any(String) as string,
            name: '2026–2027',
            status: 'planned',
            quarters: DATED.map(([startDate, endDate], index) => ({
              id: quarterIds[index],
              number: index + 1,
              startDate,
              endDate,
              lateValue: 50,
              skippedValue: 0,
            })),
          },
        ],
      });
    });

    it('change for one quarter, audited in the branch with the old and new values', async () => {
      const branch = await t.newBranch();
      const { quarterIds } = await insertYear(branch, '2026-09-01', '2027-06-30', 'planned', DATED);
      const quarterId = quarterIds[1] ?? '';

      const response = await put(`/api/setup/quarters/${quarterId}/attendance-values`, branch, {
        lateValue: 75,
        skippedValue: 10,
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: quarterId,
        number: 2,
        lateValue: 75,
        skippedValue: 10,
      });
      const quarters = await quartersOf(branch);
      expect(quarters.find((quarter) => quarter.id === quarterId)).toMatchObject({
        late_value: 75,
        skipped_value: 10,
      });
      expect(quarters.filter((quarter) => quarter.late_value === 50)).toHaveLength(3);
      const entries = await t.entries('quarter.attendance_values', quarterId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        branch_id: branch,
        old_value: { lateValue: 50, skippedValue: 0 },
        new_value: { lateValue: 75, skippedValue: 10 },
        request_id: response.headers['x-request-id'],
      });

      const count = await t.auditCount();
      const again = await put(`/api/setup/quarters/${quarterId}/attendance-values`, branch, {
        lateValue: 75,
        skippedValue: 10,
      });
      expect(again.status).toBe(200);
      expect(await t.auditCount()).toBe(count);
    });

    // edge/calculation: "A closed quarter keeps the values it was closed with."
    it('refuse a quarter of a closed year', async () => {
      const branch = await t.newBranch();
      const { quarterIds } = await insertYear(
        branch,
        '2025-09-01',
        '2026-06-30',
        'closed',
        UNDATED,
      );
      const before = await quartersOf(branch);
      const count = await t.auditCount();

      const response = await put(
        `/api/setup/quarters/${quarterIds[0] ?? ''}/attendance-values`,
        branch,
        {
          lateValue: 60,
          skippedValue: 0,
        },
      );
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('year_closed');
      expect(await quartersOf(branch)).toEqual(before);
      expect(await t.auditCount()).toBe(count);
    });

    it('answer 404 for a quarter of another branch and an unknown one, with the quarters of both branches unchanged', async () => {
      const own = await t.newBranch();
      const other = await t.newBranch();
      await insertYear(own, '2026-09-01', '2027-06-30', 'planned', DATED);
      const { quarterIds } = await insertYear(other, '2026-09-01', '2027-06-30', 'planned', DATED);
      const before = [await quartersOf(own), await quartersOf(other)];
      const count = await t.auditCount();

      for (const id of [quarterIds[0] ?? '', UNKNOWN]) {
        const response = await put(`/api/setup/quarters/${id}/attendance-values`, own, {
          lateValue: 60,
          skippedValue: 5,
        });
        expect(response.status).toBe(404);
      }
      expect([await quartersOf(own), await quartersOf(other)]).toEqual(before);
      expect(await t.auditCount()).toBe(count);
    });

    it('refuse the Principal and a Teacher, and values outside 0 to 100', async () => {
      const { quarterIds } = await insertYear(
        t.north,
        '2026-09-01',
        '2027-06-30',
        'planned',
        DATED,
      );
      const path = `/api/setup/quarters/${quarterIds[0] ?? ''}/attendance-values`;
      const before = await quartersOf(t.north);
      for (const cookie of [t.principal, t.teacher]) {
        expect((await put(path, t.north, { lateValue: 60, skippedValue: 0 }, cookie)).status).toBe(
          403,
        );
      }
      expect((await t.get('/api/setup/attendance-values', t.north, t.principal)).status).toBe(200);
      expect((await t.get('/api/setup/attendance-values', t.north, t.teacher)).status).toBe(403);
      for (const body of [
        { lateValue: 101, skippedValue: 0 },
        { lateValue: 50, skippedValue: -1 },
      ]) {
        expect((await put(path, t.north, body, t.vicePrincipal)).status).toBe(400);
      }
      expect(await quartersOf(t.north)).toEqual(before);
    });
  });

  // Answer 21; `06`, Teachers who work in several branches.
  describe('travel time', () => {
    const pairs = () =>
      t.database.migrator
        .selectFrom('travel_times')
        .selectAll()
        .orderBy('branch_low')
        .orderBy('branch_high')
        .execute();

    const schoolEntries = () =>
      t.database.migrator
        .selectFrom('audit_log_school')
        .selectAll()
        .where('action', '=', 'travel_time.set')
        .orderBy('occurred_at')
        .orderBy('id')
        .execute();

    it('is one value per pair, read the same from both branches, not set until typed', async () => {
      const east = await t.newBranch();
      const west = await t.newBranch();
      const unset = await t.get('/api/setup/travel-times', east);
      expect(unset.status).toBe(200);
      expect(unset.body).toMatchObject({
        pairs: expect.arrayContaining([
          expect.objectContaining({ branchId: west, minutes: null }),
        ]) as unknown,
      });

      const response = await put('/api/setup/travel-times', east, {
        otherBranchId: west,
        minutes: 40,
      });
      expect(response.status).toBe(200);
      const fromWest = await t.get('/api/setup/travel-times', west);
      const toEast = (
        fromWest.body as { pairs: { branchId: string; minutes: number | null }[] }
      ).pairs.find((pair) => pair.branchId === east);
      expect(toEast?.minutes).toBe(40);
      expect(
        (fromWest.body as { pairs: { branchId: string }[] }).pairs.map((pair) => pair.branchId),
      ).not.toContain(west);

      const again = await put('/api/setup/travel-times', west, {
        otherBranchId: east,
        minutes: 25,
      });
      expect(again.status).toBe(200);
      const stored = (await pairs()).filter(
        (pair) => [pair.branch_low, pair.branch_high].sort().join() === [east, west].sort().join(),
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]?.minutes).toBe(25);
    });

    // Correction 1 of the review: audited in audit_log_school, never in a branch's log.
    it('is audited for the whole school with both branches and the old and new minutes', async () => {
      const east = await t.newBranch();
      const west = await t.newBranch();
      const [low, high] = [east, west].sort();
      const branchCount = await t.auditCount();
      const response = await put('/api/setup/travel-times', east, {
        otherBranchId: west,
        minutes: 30,
      });
      expect(response.status).toBe(200);
      const entries = (await schoolEntries()).filter((entry) => entry.record_id === low);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        record_type: 'travel_time',
        assignment_id: t.adminAssignment,
        old_value: { branchIds: [low, high], minutes: null },
        new_value: { branchIds: [low, high], minutes: 30 },
        request_id: response.headers['x-request-id'],
      });
      expect(await t.auditCount()).toBe(branchCount);

      const before = (await schoolEntries()).length;
      expect(
        (await put('/api/setup/travel-times', west, { otherBranchId: east, minutes: 30 })).status,
      ).toBe(200);
      expect((await schoolEntries()).length).toBe(before);
    });

    it('refuses the branch itself, an unknown branch (404) and minutes outside 0 to 180, and changes nothing', async () => {
      // An unknown id is the only 404: the Super Admin works in every branch,
      // so another branch's id is a valid partner, never a refusal.
      const before = await pairs();
      const count = (await schoolEntries()).length;
      const branchCount = await t.auditCount();
      const same = await put('/api/setup/travel-times', t.north, {
        otherBranchId: t.north,
        minutes: 10,
      });
      expect(same.status).toBe(409);
      expect(errorCode(same)).toBe('travel_time_same_branch');
      const unknown = await put('/api/setup/travel-times', t.north, {
        otherBranchId: UNKNOWN,
        minutes: 10,
      });
      expect(unknown.status).toBe(404);
      for (const minutes of [-1, 181]) {
        expect(
          (await put('/api/setup/travel-times', t.north, { otherBranchId: t.south, minutes }))
            .status,
        ).toBe(400);
      }
      expect(await pairs()).toEqual(before);
      expect((await schoolEntries()).length).toBe(count);
      expect(await t.auditCount()).toBe(branchCount);
    });

    // Answer 24: under `branches` edit, the Super Admin alone.
    it('is read by the Principal and the Academic Vice Principal, and changed by neither', async () => {
      const before = await pairs();
      for (const cookie of [t.principal, t.vicePrincipal]) {
        expect((await t.get('/api/setup/travel-times', t.north, cookie)).status).toBe(200);
        expect(
          (
            await put(
              '/api/setup/travel-times',
              t.north,
              { otherBranchId: t.south, minutes: 10 },
              cookie,
            )
          ).status,
        ).toBe(403);
      }
      expect((await t.get('/api/setup/travel-times', t.north, t.teacher)).status).toBe(403);
      expect(await pairs()).toEqual(before);
    });
  });

  // edge/academic-year: "Each branch has a setup checklist in a fixed order";
  // answer 23.
  describe('the setup checklist', () => {
    const stateOf = async (branch: string, cookie = t.admin) => {
      const response = await t.get('/api/setup/checklist', branch, cookie);
      expect(response.status).toBe(200);
      return (
        response.body as {
          items: { key: string; done: boolean | null; count: number | null; years: string[] }[];
        }
      ).items;
    };

    it('of a new branch has the branch and the school-wide departments done, in the order of the spec', async () => {
      const branch = await t.newBranch();
      const items = await stateOf(branch);
      expect(items.map((item) => item.key)).toEqual([
        'branch',
        'rooms',
        'departments',
        'year',
        'quarters',
        'slotTypes',
        'defaultTemplate',
        'calendar',
        'subjects',
        // Task 3.1a, decision 12.
        'classes',
        // Task 3.2a, decision 14.
        'groups',
        // Task 3.4a, decision 14.
        'teachingLoad',
      ]);
      expect(items.map((item) => item.done)).toEqual([
        true,
        false,
        true,
        false,
        false,
        false,
        false,
        null,
        // No subject yet (task 2.1, decision 7).
        false,
        // No class yet (task 3.1a, decision 12).
        false,
        // No group yet (task 3.2a, decision 14).
        false,
        // No load row yet (task 3.4a, decision 14).
        false,
      ]);
      expect(items.find((item) => item.key === 'calendar')?.count).toBe(0);
      expect(items.find((item) => item.key === 'subjects')?.count).toBe(0);
    });

    it('turns each item done as its data is stored', async () => {
      const branch = await t.newBranch();
      const migrator = t.database.migrator;

      const building = await migrator
        .insertInto('buildings')
        .values({ branch_id: branch, name: 'Main' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const floor = await migrator
        .insertInto('floors')
        .values({ branch_id: branch, building_id: building.id, name: '1' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await migrator
        .insertInto('rooms')
        .values({
          branch_id: branch,
          floor_id: floor.id,
          name: '101',
          type: 'classroom',
          capacity: 30,
          status: 'under_repair',
        })
        .execute();
      expect((await stateOf(branch))[1]?.done).toBe(false);
      await migrator
        .updateTable('rooms')
        .set({ status: 'in_use' })
        .where('branch_id', '=', branch)
        .execute();
      expect((await stateOf(branch))[1]?.done).toBe(true);

      await insertYear(branch, '2026-09-01', '2027-06-30', 'planned', UNDATED);
      let items = await stateOf(branch);
      expect(items[3]?.done).toBe(true);
      expect(items[4]).toMatchObject({ done: false, years: ['2026–2027'] });
      await insertYear(branch, '2027-09-01', '2028-06-30', 'planned', [
        ['2027-09-02', '2027-10-31'],
        ['2027-11-08', '2027-12-28'],
        ['2028-01-10', '2028-03-18'],
        ['2028-03-27', '2028-05-25'],
      ]);
      expect((await stateOf(branch))[4]).toMatchObject({ done: false, years: ['2026–2027'] });
      await migrator.transaction().execute(async (transaction) => {
        for (const [index, [start, end]] of DATED.entries()) {
          await transaction
            .updateTable('quarters')
            .set({ start_date: start, end_date: end })
            .where('branch_id', '=', branch)
            .where('number', '=', index + 1)
            .where('start_date', 'is', null)
            .execute();
        }
      });
      expect((await stateOf(branch))[4]).toMatchObject({ done: true, years: [] });

      const brk = await t.createSlotType(branch, 'Break', 'break', 10);
      expect((await stateOf(branch))[5]?.done).toBe(false);
      const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
      expect((await stateOf(branch))[5]?.done).toBe(true);

      const template = await t.createTemplate(branch, 'Regular', [lesson, brk, lesson]);
      expect((await stateOf(branch))[6]?.done).toBe(false);
      await t.assign(branch, template);
      items = await stateOf(branch);
      expect(items[6]?.done).toBe(true);

      await migrator
        .insertInto('calendar_entries')
        .values([
          {
            branch_id: branch,
            kind: 'day_off',
            name: 'Holiday',
            first_date: '2027-03-21',
            last_date: '2027-03-21',
          },
          {
            branch_id: branch,
            kind: 'day_off',
            name: 'Old',
            first_date: '2026-01-01',
            last_date: '2026-01-01',
          },
        ])
        .execute();
      items = await stateOf(branch);
      expect(items[7]).toMatchObject({ done: null, count: 1 });
      expect(items.slice(0, 7).every((item) => item.done === true)).toBe(true);

      // Task 3.1a, decision 12: an active class in a planned or current year;
      // an archived one does not count.
      const classesItem = async () =>
        (await stateOf(branch)).find((item) => item.key === 'classes')?.done;
      expect(await classesItem()).toBe(false);
      const year = await migrator
        .selectFrom('academic_years')
        .select('id')
        .where('branch_id', '=', branch)
        .orderBy('start_date')
        .executeTakeFirstOrThrow();
      const schoolClass = await migrator
        .insertInto('classes')
        .values({
          branch_id: branch,
          academic_year_id: year.id,
          grade: 7,
          name: 'Oxford',
          language: 'uz',
          max_size: 25,
          archived_at: new Date(START),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      expect(await classesItem()).toBe(false);
      await migrator
        .updateTable('classes')
        .set({ archived_at: null })
        .where('id', '=', schoolClass.id)
        .execute();
      expect(await classesItem()).toBe(true);

      // Task 3.2a, decision 14: an active group in a planned or current year;
      // an archived one does not count.
      const groupsItem = async () =>
        (await stateOf(branch)).find((item) => item.key === 'groups')?.done;
      expect(await groupsItem()).toBe(false);
      const steam = await migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow();
      const subject = await migrator
        .insertInto('subjects')
        .values({
          name_uz: 'Guruh fani',
          name_ru: 'Предмет групп',
          name_en: 'Group subject',
          department_id: steam.id,
          grades: [7],
          colour: 'blue',
          journal_type: 'graded',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const group = await migrator.transaction().execute(async (transaction) => {
        const row = await transaction
          .insertInto('groups')
          .values({
            branch_id: branch,
            academic_year_id: year.id,
            subject_id: subject.id,
            name: '7-E-1',
            language: 'uz',
            max_size: 15,
            archived_at: new Date(START),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('group_classes')
          .values({ group_id: row.id, class_id: schoolClass.id, branch_id: branch })
          .execute();
        return row;
      });
      expect(await groupsItem()).toBe(false);
      await migrator
        .updateTable('groups')
        .set({ archived_at: null })
        .where('id', '=', group.id)
        .execute();
      expect(await groupsItem()).toBe(true);

      // Task 3.4a, decision 14: a version of a planned or current year with a
      // load row; an empty draft does not count.
      const loadItem = async () =>
        (await stateOf(branch)).find((item) => item.key === 'teachingLoad')?.done;
      const load = new LoadKit(migrator);
      const version = await load.version(branch, year.id);
      expect(await loadItem()).toBe(false);
      const teacher = await load.teacher(branch, {
        subjects: [{ subject: subject.id, grades: [7] }],
      });
      await load.row({
        branch_id: branch,
        version_id: version,
        class_id: schoolClass.id,
        subject_id: subject.id,
        teacher_id: teacher.staffId,
      });
      expect(await loadItem()).toBe(true);
    });

    // Decision 6: a default setting in force today or starting later; a row
    // that ended by today, or was withdrawn (an empty range), is not one.
    it('reads a default template that ended or was withdrawn as missing', async () => {
      const branch = await t.newBranch();
      const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
      const template = await t.createTemplate(branch, 'Regular', [lesson]);
      await t.database.migrator
        .insertInto('day_template_assignments')
        .values([
          {
            branch_id: branch,
            level: 'default',
            day_template_id: template,
            valid_from: '2026-09-01',
            valid_until: TODAY,
          },
          {
            branch_id: branch,
            level: 'default',
            day_template_id: template,
            valid_from: '2026-10-20',
            valid_until: '2026-10-20',
          },
        ])
        .execute();
      expect((await stateOf(branch))[6]?.done).toBe(false);
    });

    // Answer 23: the departments of the Academic division, school-wide.
    it('reads the departments as missing while every Academic department is archived', async () => {
      const branch = await t.newBranch();
      const academic = t.database.migrator
        .selectFrom('departments')
        .innerJoin('divisions', 'divisions.id', 'departments.division_id')
        .select('departments.id')
        .where('divisions.built_in', '=', true)
        .where('departments.archived_at', 'is', null);
      const ids = (await academic.execute()).map((row) => row.id);
      expect(ids.length).toBeGreaterThan(0);
      await t.database.migrator
        .updateTable('departments')
        .set({ archived_at: new Date(START) })
        .where('id', 'in', ids)
        .execute();
      try {
        expect((await stateOf(branch))[2]?.done).toBe(false);
      } finally {
        await t.database.migrator
          .updateTable('departments')
          .set({ archived_at: null })
          .where('id', 'in', ids)
          .execute();
      }
      expect((await stateOf(branch))[2]?.done).toBe(true);
    });

    it('is read by the three roles of answer 23 and refused to a Teacher', async () => {
      for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
        expect((await t.get('/api/setup/checklist', t.north, cookie)).status).toBe(200);
      }
      expect((await t.get('/api/setup/checklist', t.north, t.teacher)).status).toBe(403);
      expect((await t.get('/api/setup/checklist', t.south, t.principal)).status).toBe(403);
    });
  });
});
