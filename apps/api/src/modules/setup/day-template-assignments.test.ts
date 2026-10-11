import {
  apiErrorSchema,
  assignmentListSchema,
  assignmentSchema,
  templatePreviewSchema,
  templateTableSchema,
  type TemplateTable,
} from '@sodiq/shared';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  MONDAY,
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const detailPaths = (response: Response): string[] =>
  apiErrorSchema.parse(response.body).error.details?.map((detail) => detail.path) ?? [];

/** The name of the template in the cell of a weekday and grade, or null. */
const cell = (table: TemplateTable, weekday: number, grade: number): string | null =>
  table.cells.find((one) => one.weekday === weekday && one.grade === grade)?.template?.name ?? null;

// docs/spec/03-school-setup.md, Slot types and day templates: "A branch has a
// default template; another template can be set for a range of grades inside
// the branch, for a weekday, for a weekday and a range of grades together …
// For a class on a date, the first of these that applies wins … Grade ranges
// set at one level may not overlap. A template set at any level takes effect
// from a chosen date, tomorrow at the earliest, and its history is kept.
// School setup shows the template that results for every weekday and grade in
// one table; saving a template at any level shows that table with the changes
// marked, as the preview of the change." The owner's answers 11, 13 and 14.
describe('where day templates apply', () => {
  let t: DayTemplatesKit;

  beforeAll(async () => {
    t = await dayTemplatesKit();
  });

  afterAll(async () => {
    await t.close();
  });

  /** A branch (Monday to Friday) with a lesson slot type and the templates named. */
  async function branchWith(...names: string[]) {
    const branch = await t.newBranch();
    const lesson = await t.createSlotType(branch, 'Lesson 45');
    const lunch = await t.createSlotType(branch, 'Lunch', 'break', 40);
    const templates: Record<string, string> = {};
    for (const name of names) {
      templates[name] = await t.createTemplate(branch, name, [lesson, lunch, lesson]);
    }
    return { branch, lesson, lunch, templates };
  }

  const body = (
    dayTemplateId: string,
    key: {
      level?: string;
      weekday?: number | null;
      gradeFrom?: number | null;
      gradeTo?: number | null;
    } = {},
    from = TOMORROW,
  ) => ({
    level: key.level ?? 'default',
    weekday: key.weekday ?? null,
    gradeFrom: key.gradeFrom ?? null,
    gradeTo: key.gradeTo ?? null,
    dayTemplateId,
    from,
  });

  const tableOn = async (branch: string, date: string): Promise<TemplateTable> => {
    const response = await t.get(`/api/setup/day-template-table?date=${date}`, branch);
    expect(response.status).toBe(200);
    return templateTableSchema.parse(response.body);
  };

  it('are set by the Super Admin and the Academic Vice Principal from tomorrow at the earliest, with an entry', async () => {
    const lesson = await t.createSlotType(t.north, 'Lesson for the default');
    const main = await t.createTemplate(t.north, 'North main', [lesson]);
    const before = await t.auditCount();

    const today = await t.post(
      '/api/setup/day-template-assignments',
      t.north,
      body(main, {}, TODAY),
      t.vicePrincipal,
    );
    expect(today.status).toBe(409);
    expect(errorCode(today)).toBe('date_not_in_future');
    expect(detailPaths(today)).toEqual(['from']);
    expect(await t.auditCount()).toBe(before);

    const response = await t.post(
      '/api/setup/day-template-assignments',
      t.north,
      body(main),
      t.vicePrincipal,
    );
    expect(response.status).toBe(201);
    const assignment = assignmentSchema.parse(response.body);
    expect(assignment).toEqual({
      id: assignment.id,
      level: 'default',
      weekday: null,
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: main,
      validFrom: TOMORROW,
      validUntil: null,
    });
    expect(await t.entries('day_template_assignment.set', assignment.id)).toEqual([
      expect.objectContaining({
        branch_id: t.north,
        assignment_id: t.viceAssignment,
        old_value: { cut: null },
        new_value: expect.objectContaining({
          level: 'default',
          dayTemplateId: main,
          validFrom: TOMORROW,
        }) as unknown,
        request_id: response.headers['x-request-id'],
      }),
    ]);
    for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
      const list = await t.get('/api/setup/day-template-assignments', t.north, cookie);
      expect(assignmentListSchema.parse(list.body).assignments.map((one) => one.id)).toContain(
        assignment.id,
      );
    }
  });

  it('are refused to the Principal and a Teacher on every write; a Teacher reads nothing; nothing is written', async () => {
    const lesson = await t.createSlotType(t.north, 'Lesson refused set');
    const main = await t.createTemplate(t.north, 'North refused', [lesson]);
    const id = await t.assign(t.north, main, { level: 'weekday', weekday: 3 });
    const before = await t.auditCount();
    for (const cookie of [t.principal, t.teacher]) {
      for (const response of [
        await t.post(
          '/api/setup/day-template-assignments',
          t.north,
          body(main, { level: 'weekday', weekday: 4 }),
          cookie,
        ),
        await t.post(
          `/api/setup/day-template-assignments/${id}/end`,
          t.north,
          { from: MONDAY },
          cookie,
        ),
        await t.post(
          '/api/setup/day-template-table/preview',
          t.north,
          { kind: 'assignment_end', assignmentId: id, change: { from: MONDAY } },
          cookie,
        ),
      ]) {
        expect(response.status).toBe(403);
      }
    }
    for (const path of [
      '/api/setup/day-template-assignments',
      `/api/setup/day-template-table?date=${TODAY}`,
    ]) {
      expect((await t.get(path, t.north, t.teacher)).status).toBe(403);
      expect((await t.get(path, t.north, t.principal)).status).toBe(200);
    }
    expect(await t.auditCount()).toBe(before);
  });

  it('answer 404 for a setting or a template of another branch, or an unknown one, never a 500 from the key; nothing changes in either branch', async () => {
    const { branch, templates } = await branchWith('Main');
    const other = await branchWith('Foreign');
    const foreignTemplate = other.templates.Foreign ?? '';
    const foreign = await t.assign(other.branch, foreignTemplate, { level: 'weekday', weekday: 1 });
    // An own setting of the key the refused ones name: a save would cut it.
    await t.assign(branch, templates.Main ?? '');
    const rows = [await t.rowsOf(branch), await t.rowsOf(other.branch)];
    const before = await t.auditCount();
    for (const id of [foreign, UNKNOWN]) {
      expect(
        (await t.post(`/api/setup/day-template-assignments/${id}/end`, branch, { from: MONDAY }))
          .status,
      ).toBe(404);
    }
    for (const id of [foreignTemplate, UNKNOWN]) {
      expect((await t.post('/api/setup/day-template-assignments', branch, body(id))).status).toBe(
        404,
      );
    }
    expect(await t.auditCount()).toBe(before);
    expect([await t.rowsOf(branch), await t.rowsOf(other.branch)]).toEqual(rows);
  });

  it('validate the fields of each level', async () => {
    const { branch, templates } = await branchWith('Main');
    const main = templates.Main ?? '';
    for (const [record, path] of [
      [body(main, { level: 'grades' }), 'gradeFrom'],
      [body(main, { level: 'weekday' }), 'weekday'],
      [body(main, { level: 'default', weekday: 1 }), 'weekday'],
      [body(main, { level: 'grades', gradeFrom: 9, gradeTo: 5 }), 'gradeTo'],
      [body(main, { level: 'grades', gradeFrom: 1, gradeTo: 12 }), 'gradeTo'],
    ] as const) {
      const response = await t.post('/api/setup/day-template-assignments', branch, record);
      expect(response.status).toBe(400);
      expect(detailPaths(response)).toContain(path);
    }
  });

  it('refuse an archived template', async () => {
    const { branch, templates } = await branchWith('Main');
    await t.post(`/api/setup/day-templates/${templates.Main ?? ''}/archive`, branch);
    const response = await t.post(
      '/api/setup/day-template-assignments',
      branch,
      body(templates.Main ?? ''),
    );
    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('template_archived');
    expect(detailPaths(response)).toEqual(['dayTemplateId']);
  });

  describe('one key from a date', () => {
    it('replace the setting in force from the date and keep a later planned one', async () => {
      const { branch, templates } = await branchWith('Main', 'Winter', 'Spring');
      const main = await t.assign(branch, templates.Main ?? '');
      const spring = await t.assign(branch, templates.Spring ?? '', {}, '2027-03-01');

      const response = await t.post(
        '/api/setup/day-template-assignments',
        branch,
        body(templates.Winter ?? '', {}, '2026-12-01'),
      );
      expect(response.status).toBe(201);
      expect(assignmentSchema.parse(response.body)).toMatchObject({
        validFrom: '2026-12-01',
        validUntil: '2027-03-01',
      });
      const list = assignmentListSchema.parse(
        (await t.get('/api/setup/day-template-assignments', branch)).body,
      );
      expect(
        list.assignments.map((one) => [one.dayTemplateId, one.validFrom, one.validUntil]),
      ).toEqual([
        [templates.Main, TOMORROW, '2026-12-01'],
        [templates.Winter, '2026-12-01', '2027-03-01'],
        [templates.Spring, '2027-03-01', null],
      ]);
      expect(
        await t.entries('day_template_assignment.set', assignmentSchema.parse(response.body).id),
      ).toEqual([
        expect.objectContaining({
          old_value: {
            cut: { dayTemplateId: templates.Main, validFrom: TOMORROW, validUntil: '2027-03-01' },
          },
        }),
      ]);
      expect(main).not.toBe(spring);
    });

    // Decision 8, and the reviewer's note: a planned default is cancelled by
    // setting the current one again from the same date.
    it('withdraw a planned default set again from its date', async () => {
      const { branch, templates } = await branchWith('Main', 'Winter');
      await t.assign(branch, templates.Main ?? '');
      await t.assign(branch, templates.Winter ?? '', {}, '2026-12-01');
      await t.assign(branch, templates.Main ?? '', {}, '2026-12-01');
      const list = assignmentListSchema.parse(
        (await t.get('/api/setup/day-template-assignments', branch)).body,
      );
      expect(
        list.assignments.map((one) => [one.dayTemplateId, one.validFrom, one.validUntil]),
      ).toEqual([
        [templates.Main, TOMORROW, '2026-12-01'],
        [templates.Main, '2026-12-01', null],
      ]);
      const withdrawn = await t.database.migrator
        .selectFrom('day_template_assignments')
        .select(['valid_from', 'valid_until'])
        .where('day_template_id', '=', templates.Winter ?? '')
        .execute();
      expect(withdrawn).toEqual([{ valid_from: '2026-12-01', valid_until: '2026-12-01' }]);
    });
  });

  // Decision 18.
  describe('grade ranges at one level', () => {
    it('refuse a range that overlaps another range in force on the date, naming the grades', async () => {
      const { branch, templates } = await branchWith('Senior', 'Upper');
      await t.assign(branch, templates.Senior ?? '', {
        level: 'grades',
        gradeFrom: 9,
        gradeTo: 11,
      });
      const before = await t.auditCount();
      const response = await t.post(
        '/api/setup/day-template-assignments',
        branch,
        body(templates.Upper ?? '', { level: 'grades', gradeFrom: 10, gradeTo: 11 }, '2026-11-01'),
      );
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('grade_ranges_overlap');
      expect(detailPaths(response)).toEqual(['gradeFrom', 'gradeTo']);
      expect(await t.auditCount()).toBe(before);
      // At another level, or on another weekday, the same grades are allowed.
      expect(
        (
          await t.post(
            '/api/setup/day-template-assignments',
            branch,
            body(templates.Upper ?? '', {
              level: 'weekday_grades',
              weekday: 1,
              gradeFrom: 10,
              gradeTo: 11,
            }),
          )
        ).status,
      ).toBe(201);
    });

    it('end the old range, then set the new one from the same date', async () => {
      const { branch, templates } = await branchWith('Senior', 'Upper');
      const senior = await t.assign(branch, templates.Senior ?? '', {
        level: 'grades',
        gradeFrom: 9,
        gradeTo: 11,
      });
      expect(
        (
          await t.post(`/api/setup/day-template-assignments/${senior}/end`, branch, {
            from: '2026-11-01',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await t.post(
            '/api/setup/day-template-assignments',
            branch,
            body(
              templates.Upper ?? '',
              { level: 'grades', gradeFrom: 10, gradeTo: 11 },
              '2026-11-01',
            ),
          )
        ).status,
      ).toBe(201);
    });

    it('stop a new range before a planned range that overlaps it', async () => {
      const { branch, templates } = await branchWith('Senior', 'Upper');
      await t.assign(
        branch,
        templates.Senior ?? '',
        { level: 'grades', gradeFrom: 9, gradeTo: 11 },
        '2026-12-01',
      );
      const response = await t.post(
        '/api/setup/day-template-assignments',
        branch,
        body(templates.Upper ?? '', { level: 'grades', gradeFrom: 10, gradeTo: 11 }),
      );
      expect(response.status).toBe(201);
      expect(assignmentSchema.parse(response.body)).toMatchObject({
        validFrom: TOMORROW,
        validUntil: '2026-12-01',
      });
    });
  });

  describe('end from a date', () => {
    it('cuts a setting in force, with an entry', async () => {
      const { branch, templates } = await branchWith('Friday');
      const id = await t.assign(branch, templates.Friday ?? '', { level: 'weekday', weekday: 5 });
      const response = await t.post(`/api/setup/day-template-assignments/${id}/end`, branch, {
        from: '2026-11-01',
      });
      expect(response.status).toBe(200);
      expect(assignmentSchema.parse(response.body)).toMatchObject({
        validFrom: TOMORROW,
        validUntil: '2026-11-01',
      });
      expect(await t.entries('day_template_assignment.end', id)).toEqual([
        expect.objectContaining({
          old_value: { validUntil: null },
          new_value: { validUntil: '2026-11-01' },
        }),
      ]);
    });

    // The review's correction 2.
    it('withdraws a planned setting that starts after the date', async () => {
      const { branch, templates } = await branchWith('Friday');
      const id = await t.assign(
        branch,
        templates.Friday ?? '',
        { level: 'weekday', weekday: 5 },
        '2026-12-01',
      );
      const response = await t.post(`/api/setup/day-template-assignments/${id}/end`, branch, {
        from: '2026-11-01',
      });
      expect(response.status).toBe(200);
      const row = await t.database.migrator
        .selectFrom('day_template_assignments')
        .select(['valid_from', 'valid_until'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ valid_from: '2026-12-01', valid_until: '2026-12-01' });
      const list = assignmentListSchema.parse(
        (await t.get('/api/setup/day-template-assignments', branch)).body,
      );
      expect(list.assignments).toEqual([]);
    });

    it('is refused for a setting that already ends on or before the date, from tomorrow at the earliest, and for the default', async () => {
      const { branch, templates } = await branchWith('Friday', 'Main');
      const id = await t.assign(branch, templates.Friday ?? '', { level: 'weekday', weekday: 5 });
      await t.post(`/api/setup/day-template-assignments/${id}/end`, branch, { from: '2026-11-01' });
      const before = await t.auditCount();

      const again = await t.post(`/api/setup/day-template-assignments/${id}/end`, branch, {
        from: '2026-11-15',
      });
      expect(again.status).toBe(409);
      expect(errorCode(again)).toBe('already_ended');
      const today = await t.post(`/api/setup/day-template-assignments/${id}/end`, branch, {
        from: TODAY,
      });
      expect(errorCode(today)).toBe('date_not_in_future');
      const main = await t.assign(branch, templates.Main ?? '');
      const fallback = await t.post(`/api/setup/day-template-assignments/${main}/end`, branch, {
        from: '2026-11-01',
      });
      expect(fallback.status).toBe(409);
      expect(errorCode(fallback)).toBe('default_template_required');
      expect(await t.auditCount()).toBe(before + 1);
    });
  });

  // Answer 13: "working weekdays × grades 1 to 11 for the chosen date".
  describe('the table', () => {
    // edge/time-dates-calendar: "Friday is the same for every grade, but Monday
    // to Thursday grades 9–11 have lunch one slot later."
    it('shows the template of every working weekday and grade on a date: the Friday example', async () => {
      const { branch, templates } = await branchWith('Main', 'Friday', 'Senior');
      await t.assign(branch, templates.Main ?? '');
      await t.assign(branch, templates.Friday ?? '', { level: 'weekday', weekday: 5 });
      await t.assign(branch, templates.Senior ?? '', {
        level: 'grades',
        gradeFrom: 9,
        gradeTo: 11,
      });

      const table = await tableOn(branch, MONDAY);
      expect(table.weekdays).toEqual([1, 2, 3, 4, 5]);
      expect(table.cells).toHaveLength(5 * 11);
      for (const grade of [1, 8, 9, 11]) {
        expect(cell(table, 5, grade)).toBe('Friday');
      }
      expect(cell(table, 1, 8)).toBe('Main');
      expect(cell(table, 1, 9)).toBe('Senior');
      expect(cell(table, 4, 11)).toBe('Senior');
      expect(table.cells.find((one) => one.weekday === 1 && one.grade === 1)?.template).toEqual({
        id: templates.Main,
        name: 'Main',
        start: 480,
        end: 610,
        lessonSlots: 2,
      });
      // Today nothing is in force yet: every change starts tomorrow.
      expect((await tableOn(branch, TODAY)).cells.every((one) => one.template === null)).toBe(true);
    });

    it('follows the working weekdays of the branch', async () => {
      const { branch, templates } = await branchWith('Main');
      await t.database.migrator
        .updateTable('branches')
        .set({ working_weekdays: [1, 2, 3, 4, 5, 6] })
        .where('id', '=', branch)
        .execute();
      await t.assign(branch, templates.Main ?? '');
      expect((await tableOn(branch, MONDAY)).weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  // `03`: "saving a template at any level shows that table with the changes
  // marked, as the preview of the change"; decision 13: the save, rolled back.
  describe('the preview', () => {
    const preview = (branch: string, change: object, cookie?: string) =>
      t.post('/api/setup/day-template-table/preview', branch, change, cookie);

    const rowsOf = async (branch: string) =>
      Promise.all(
        (['slot_type_lengths', 'day_template_versions', 'day_template_assignments'] as const).map(
          (table) =>
            t.database.migrator
              .selectFrom(table)
              .select(['id', 'valid_until'])
              .where('branch_id', '=', branch)
              .orderBy('id')
              .execute(),
        ),
      );

    it('shows the table before and after a setting, marks the changed cells and writes nothing', async () => {
      const { branch, templates } = await branchWith('Main', 'Senior');
      await t.assign(branch, templates.Main ?? '');
      const rows = await rowsOf(branch);
      const before = await t.auditCount();

      const response = await preview(
        branch,
        {
          kind: 'assignment_set',
          change: body(
            templates.Senior ?? '',
            { level: 'grades', gradeFrom: 9, gradeTo: 11 },
            MONDAY,
          ),
        },
        t.admin,
      );
      expect(response.status).toBe(200);
      const answer = templatePreviewSchema.parse(response.body);
      expect(answer.before.date).toBe(MONDAY);
      expect(cell(answer.before, 1, 9)).toBe('Main');
      expect(cell(answer.after, 1, 9)).toBe('Senior');
      expect(cell(answer.after, 1, 8)).toBe('Main');
      expect(answer.changed).toHaveLength(5 * 3);
      expect(answer.changed).toContainEqual({ weekday: 3, grade: 10 });
      expect(await rowsOf(branch)).toEqual(rows);
      expect(await t.auditCount()).toBe(before);
    });

    it('marks a cell whose template stays the same but whose times change after a length change', async () => {
      const { branch, lesson, templates } = await branchWith('Main');
      await t.assign(branch, templates.Main ?? '');
      const response = await preview(branch, {
        kind: 'slot_length',
        slotTypeId: lesson,
        change: { lengthMinutes: 40, from: MONDAY },
      });
      const answer = templatePreviewSchema.parse(response.body);
      expect(answer.changed).toHaveLength(5 * 11);
      const after = answer.after.cells[0]?.template;
      expect(after?.name).toBe('Main');
      expect(after?.end).toBe(480 + 40 + 40 + 40);
      expect(answer.before.cells[0]?.template?.end).toBe(480 + 45 + 40 + 45);
    });

    // `edge/time-dates-calendar`: lunch one slot later. The day keeps its start,
    // its end and its number of lessons, but the second lesson moves.
    it('marks every cell of a template whose slots are reordered, the start, the end and the count unchanged', async () => {
      const { branch, lesson, lunch } = await branchWith();
      const main = await t.createTemplate(branch, 'Main', [lesson, lunch, lesson, lesson]);
      await t.assign(branch, main);
      const response = await preview(branch, {
        kind: 'template_version',
        dayTemplateId: main,
        change: { from: MONDAY, startTime: '08:00', slotTypeIds: [lesson, lesson, lunch, lesson] },
      });
      expect(response.status).toBe(200);
      const answer = templatePreviewSchema.parse(response.body);
      expect(answer.after.cells.map((one) => one.template)).toEqual(
        answer.before.cells.map((one) => one.template),
      );
      expect(answer.changed).toHaveLength(5 * 11);
    });

    it('covers a new version and the end of a setting', async () => {
      const { branch, lesson, templates } = await branchWith('Main', 'Friday');
      await t.assign(branch, templates.Main ?? '');
      const friday = await t.assign(branch, templates.Friday ?? '', {
        level: 'weekday',
        weekday: 5,
      });

      const version = templatePreviewSchema.parse(
        (
          await preview(branch, {
            kind: 'template_version',
            dayTemplateId: templates.Friday,
            change: { from: MONDAY, startTime: '09:00', slotTypeIds: [lesson] },
          })
        ).body,
      );
      expect(version.changed.every((one) => one.weekday === 5)).toBe(true);
      expect(version.changed).toHaveLength(11);

      const ended = templatePreviewSchema.parse(
        (
          await preview(branch, {
            kind: 'assignment_end',
            assignmentId: friday,
            change: { from: MONDAY },
          })
        ).body,
      );
      expect(cell(ended.before, 5, 1)).toBe('Friday');
      expect(cell(ended.after, 5, 1)).toBe('Main');
    });

    it('answers 404 for an id of another branch or an unknown one in any change, and writes nothing', async () => {
      const own = await branchWith('Main');
      const other = await branchWith('Foreign');
      const foreignTemplate = other.templates.Foreign ?? '';
      const foreignSetting = await t.assign(other.branch, foreignTemplate, {
        level: 'weekday',
        weekday: 2,
      });
      const ownTemplate = own.templates.Main ?? '';
      const rows = [await rowsOf(own.branch), await rowsOf(other.branch)];
      const before = await t.auditCount();
      for (const foreign of [
        { slotType: other.lesson, template: foreignTemplate, setting: foreignSetting },
        { slotType: UNKNOWN, template: UNKNOWN, setting: UNKNOWN },
      ]) {
        for (const change of [
          {
            kind: 'slot_length',
            slotTypeId: foreign.slotType,
            change: { lengthMinutes: 40, from: MONDAY },
          },
          {
            kind: 'template_version',
            dayTemplateId: foreign.template,
            change: { from: MONDAY, startTime: '08:00', slotTypeIds: [own.lesson] },
          },
          {
            kind: 'template_version',
            dayTemplateId: ownTemplate,
            change: { from: MONDAY, startTime: '08:00', slotTypeIds: [foreign.slotType] },
          },
          { kind: 'assignment_set', change: body(foreign.template, {}, MONDAY) },
          { kind: 'assignment_end', assignmentId: foreign.setting, change: { from: MONDAY } },
        ]) {
          const response = await preview(own.branch, change);
          expect(response.status, JSON.stringify(change)).toBe(404);
        }
      }
      expect(await t.auditCount()).toBe(before);
      expect([await rowsOf(own.branch), await rowsOf(other.branch)]).toEqual(rows);
    });

    it('writes nothing for a length change, a new version or an end, and lets the Academic Vice Principal preview too', async () => {
      const lesson = await t.createSlotType(t.north, 'Lesson for the preview');
      const main = await t.createTemplate(t.north, 'North preview', [lesson]);
      const friday = await t.assign(t.north, main, { level: 'weekday', weekday: 5 }, '2026-11-02');
      const rows = await rowsOf(t.north);
      const before = await t.auditCount();
      for (const change of [
        { kind: 'slot_length', slotTypeId: lesson, change: { lengthMinutes: 40, from: MONDAY } },
        {
          kind: 'template_version',
          dayTemplateId: main,
          change: { from: MONDAY, startTime: '09:00', slotTypeIds: [lesson] },
        },
        { kind: 'assignment_end', assignmentId: friday, change: { from: MONDAY } },
      ]) {
        const response = await preview(t.north, change, t.vicePrincipal);
        expect(response.status, change.kind).toBe(200);
      }
      expect(await rowsOf(t.north)).toEqual(rows);
      expect(await t.auditCount()).toBe(before);
    });

    it('gives the refusal the save would give: grade ranges that overlap, a date of today', async () => {
      const { branch, templates } = await branchWith('Senior', 'Upper');
      await t.assign(branch, templates.Senior ?? '', {
        level: 'grades',
        gradeFrom: 9,
        gradeTo: 11,
      });
      const overlap = await preview(branch, {
        kind: 'assignment_set',
        change: body(templates.Upper ?? '', { level: 'grades', gradeFrom: 11, gradeTo: 11 }),
      });
      expect(errorCode(overlap)).toBe('grade_ranges_overlap');
      const today = await preview(branch, {
        kind: 'assignment_set',
        change: body(templates.Upper ?? '', {}, TODAY),
      });
      expect(errorCode(today)).toBe('date_not_in_future');
    });
  });
});
