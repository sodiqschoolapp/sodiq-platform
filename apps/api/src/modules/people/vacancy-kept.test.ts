import { vacancyDetailSchema, vacancyListSchema } from '@sodiq/shared';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  TODAY,
  TOMORROW,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { at, LessonsKit, QUARTER_DATES, type LessonSource } from '../../testing/lessons-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

/** A Monday before the kit's today, when the first version starts. */
const EARLY = '2026-09-07';
/** The day after tomorrow. */
const LATER = '2026-10-12';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const detailsOf = (response: Response) =>
  (response.body as { error: { details: { path: string; recordId?: string; message: string }[] } })
    .error.details;

// The vacancy closed and kept through its routes (task 5.5c-2b, pull request
// #157, decisions 1 to 4). 04, Vacancy: "A vacancy cannot be closed while a
// load row names it or a future lesson is under it. One that never held a
// load can be deleted; one that did is closed and kept." The tests run in
// order on one chain of the North's year: the first makes a version that
// started today, so every earlier version has ended. The clock stands at
// 23:55 on Saturday 10 October 2026 in Tashkent. All names are invented.
describe('a vacancy closed and kept', () => {
  let t: DayTemplatesKit;
  let kit: LessonsKit;
  let year: string;
  let quarter: string;
  let subject: string;
  let classId: string;

  const post = (path: string) => t.post(path, t.north, {}, t.vicePrincipal);
  const get = (path: string) => t.get(path, t.north, t.vicePrincipal);

  const vacancy = () => kit.load.vacancy(t.north, { subjects: [{ subject, grades: [7] }] });

  /** A version of the year with a row of the class naming `teacher`. */
  async function naming(
    teacher: string,
    startsOn: string,
    status: 'published' | 'archived' = 'published',
  ): Promise<string> {
    const version = await kit.load.version(t.north, year, { startsOn });
    await kit.load.row({
      branch_id: t.north,
      version_id: version,
      class_id: classId,
      subject_id: subject,
      teacher_id: teacher,
    });
    await kit.load.setVersion(version, status);
    return version;
  }

  /** The rows a refused close or delete must leave as they were. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('staff').select('id').orderBy('id').execute(),
      t.database.migrator.selectFrom('staff_statuses').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('staff_branches').selectAll().orderBy('staff_id').execute(),
      t.database.migrator
        .selectFrom('staff_subjects')
        .selectAll()
        .orderBy('staff_id')
        .orderBy('subject_id')
        .execute(),
      t.database.migrator.selectFrom('teaching_load_rows').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
    ]);

  /** A lesson of the class on `date` from `source`, under `teacher`, by the migrator. */
  async function lessonOn(source: LessonSource, date: string, teacher: string): Promise<void> {
    const block = await t.database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: t.north,
        academic_year_id: year,
        quarter_id: quarter,
        lesson_date: date,
        starts_at: at(date, '08:00'),
        ends_at: at(date, '08:45'),
        version_id: source.versionId,
        pattern_block_id: source.patternBlockId,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const from = source.lessons[0];
    await t.database.migrator
      .insertInto('lessons')
      .values({
        branch_id: t.north,
        block_id: block.id,
        lesson_date: block.lesson_date,
        starts_at: block.starts_at,
        ends_at: block.ends_at,
        class_id: classId,
        group_id: null,
        subject_id: subject,
        load_row_id: from?.loadRowId ?? '',
        pattern_entry_id: from?.patternEntryId ?? '',
        teacher_id: teacher,
      })
      .execute();
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    kit = await LessonsKit.create(t.database.migrator);
    year = await kit.load.classes.year(t.north);
    const [start, end] = QUARTER_DATES[0];
    const first = await t.database.migrator
      .updateTable('quarters')
      .set({ start_date: start, end_date: end })
      .where('academic_year_id', '=', year)
      .where('number', '=', 1)
      .returning('id')
      .executeTakeFirstOrThrow();
    quarter = first.id;
    subject = await kit.load.classes.subject({ grades: [7] });
    classId = await kit.load.classes.schoolClass(t.north, year, { grade: 7 });
  });

  afterAll(async () => {
    await t.close();
  });

  it('is closed and stays listed once its published rows have ended, and is never deleted', async () => {
    const kept = await vacancy();
    const teacher = await kit.load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
    await naming(kept, EARLY);
    await naming(teacher.staffId, TODAY);
    const closed = vacancyDetailSchema.parse(
      (await post(`/api/people/vacancies/${kept}/close`).expect(200)).body,
    );
    expect(closed.status).toBe('closed');
    expect(await t.entries('vacancy.close', kept)).toHaveLength(1);
    const list = vacancyListSchema.parse((await get('/api/people/vacancies').expect(200)).body);
    expect(list.vacancies.find((one) => one.id === kept)?.status).toBe('closed');

    const before = await rowsOf();
    const deleted = await post(`/api/people/vacancies/${kept}/delete`);
    refusedWith(deleted, 409, 'vacancy_in_load');
    expect(await rowsOf()).toEqual(before);
  });

  it('is refused while a published version that has not started names it', async () => {
    const held = await vacancy();
    const coming = await naming(held, LATER);
    const before = await rowsOf();
    const response = await post(`/api/people/vacancies/${held}/close`);
    refusedWith(response, 409, 'vacancy_has_load');
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ path: 'load', recordId: coming }),
    ]);
    expect(await rowsOf()).toEqual(before);
  });

  it('is closed when the only version naming it was withdrawn', async () => {
    const withdrawn = await vacancy();
    await naming(withdrawn, LATER, 'archived');
    await post(`/api/people/vacancies/${withdrawn}/close`).expect(200);
  });

  it('is refused with a lesson after today under it, and closed with one today', async () => {
    const source = await kit.source(
      t.north,
      year,
      [{ classId, groupId: null, subjectId: subject }],
      EARLY,
    );
    const future = await vacancy();
    await lessonOn(source, TOMORROW, future);
    const before = await rowsOf();
    const response = await post(`/api/people/vacancies/${future}/close`);
    refusedWith(response, 409, 'vacancy_has_load');
    const details = detailsOf(response);
    expect(details.map((detail) => detail.path)).toEqual(['lessons']);
    expect(details[0]?.message).toContain(TOMORROW);
    expect(await rowsOf()).toEqual(before);

    const today = await vacancy();
    await lessonOn(source, TODAY, today);
    await post(`/api/people/vacancies/${today}/close`).expect(200);
  });
});
