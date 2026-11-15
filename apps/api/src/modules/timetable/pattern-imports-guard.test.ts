import {
  BRANCH_HEADER,
  STUDENT_IMPORT_TYPES,
  patternImportPreviewSchema,
  type PatternImportPreview,
} from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { filledPatternTemplate } from '../../testing/pattern-import-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// The rule engine's check of a whole timetable is switched off in this file only, so that a clash
// the engine would refuse reaches the clash constraints of 0058 through the confirm: their
// refusal is mapped by `PATTERN_REFUSALS` (`.claude/rules/api.md`: a refusal a route answers by
// mapping a constraint has a route test that reaches it through the route; spec review of the
// code of task 5.14). Every other test of the import runs with the real engine.
vi.mock('@sodiq/timetable-rules', async (original) => ({
  ...(await original<typeof import('@sodiq/timetable-rules')>()),
  checkTimetable: () => [],
}));

const XLSX = STUDENT_IMPORT_TYPES[0] ?? '';

// All names are invented. Task 5.14: the database stays the last guard of an imported timetable
// (CLAUDE.md, The database guards the rules). The clock stands at 23:55 on Saturday 10 October
// 2026 in Tashkent; the draft starts on Monday 19 October.
describe('the timetable import and the clash constraints', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let version = '';
  let teacherLabel = '';

  beforeAll(async () => {
    t = await dayTemplatesKit();
    load = new LoadKit(t.database.migrator);
    const year = await load.classes.year(t.north);
    const lesson = await t.createSlotType(t.north, 'Lesson', 'lesson', 45);
    await t.assign(t.north, await t.createTemplate(t.north, 'Regular', [lesson, lesson]));
    const maths = await load.classes.subject({ grades: [7], name: 'Algebra Quince' });
    const oxford = await load.classes.schoolClass(t.north, year, { grade: 7, name: 'Oxford' });
    const princeton = await load.classes.schoolClass(t.north, year, {
      grade: 7,
      name: 'Princeton',
    });
    const teacher = (await load.teacher(t.north, { subjects: [{ subject: maths, grades: [7] }] }))
      .staffId;
    const row = await t.database.migrator
      .selectFrom('staff')
      .select(['first_name', 'last_name', 'staff_id'])
      .where('id', '=', teacher)
      .executeTakeFirstOrThrow();
    teacherLabel = `${row.last_name ?? ''} ${row.first_name ?? ''} (${row.staff_id ?? ''})`;
    version = await load.version(t.north, year, { startsOn: '2026-10-19' });
    for (const classId of [oxford, princeton]) {
      await load.row({
        branch_id: t.north,
        version_id: version,
        class_id: classId,
        subject_id: maths,
        teacher_id: teacher,
        lessons_per_week: 1,
      });
    }
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  it('answers pattern_clash when a teacher in two places reaches the constraint, writing nothing', async () => {
    const template = await request(t.kit.server)
      .get(`/api/timetable/versions/${version}/pattern/import-template?language=en`)
      .set('Cookie', t.vicePrincipal)
      .set(BRANCH_HEADER, t.north)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          callback(null, Buffer.concat(chunks));
        });
      });
    expect(template.status).toBe(200);
    const bytes = await filledPatternTemplate(
      template.body as Buffer,
      ['7 Oxford', '7 Princeton'].map((unit) => ({
        weekday: 'Monday',
        lessonNumber: '1',
        unit,
        subject: 'Algebra Quince',
        teacher: teacherLabel,
      })),
    );
    const uploaded = await request(t.kit.server)
      .put(`/api/timetable/versions/${version}/pattern/imports`)
      .set('Cookie', t.vicePrincipal)
      .set(BRANCH_HEADER, t.north)
      .set('Content-Type', XLSX)
      .send(bytes);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200);
    const preview: PatternImportPreview = patternImportPreviewSchema.parse(uploaded.body);
    // With the engine's check switched off, the preview sees no clash.
    expect(preview.clean).toBe(true);
    const audit = await t.auditCount();
    const answer = await t.post(
      `/api/timetable/versions/${version}/pattern/imports/${preview.importId}/confirm`,
      t.north,
      { removes: preview.removes },
      t.vicePrincipal,
    );
    expect(answer.status, JSON.stringify(answer.body)).toBe(409);
    expect(errorCode(answer)).toBe('pattern_clash');
    expect(
      await t.database.migrator
        .selectFrom('pattern_entries')
        .select('id')
        .where('version_id', '=', version)
        .execute(),
    ).toEqual([]);
    const marked = await t.database.migrator
      .selectFrom('pattern_imports')
      .select('confirmed_at')
      .where('id', '=', preview.importId)
      .executeTakeFirstOrThrow();
    expect(marked.confirmed_at).toBeNull();
    // The edit lock the confirm took rolled back with it: no entry stays.
    expect(await t.auditCount()).toBe(audit);
  });
});
