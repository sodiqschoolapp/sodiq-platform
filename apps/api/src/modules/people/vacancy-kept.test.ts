import { vacancyDetailSchema, vacancyListSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  TODAY,
  TOMORROW,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { at, LessonsKit, QUARTER_DATES, type LessonSource } from '../../testing/lessons-kit.js';
import { heldEntry } from '../../testing/held-entry.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { Transactions, type Transaction } from '../../database/transactions.js';

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
  async function lessonOn(source: LessonSource, date: string, teacher: string): Promise<string> {
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
    const lesson = await t.database.migrator
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
      .returning('id')
      .executeTakeFirstOrThrow();
    return lesson.id;
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

  // The permission review of the code: another branch's vacancy that its own
  // load holds is 404 before anything reads past the row filter.
  // Plan test 12: a version in force today still holds while the next one
  // has not started; each version that holds is named.
  it('is refused while the version in force holds it, the next one not started, naming each', async () => {
    const held = await vacancy();
    const teacher = await kit.load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
    const inForce = await naming(held, TODAY);
    await naming(teacher.staffId, TOMORROW);
    const response = await post(`/api/people/vacancies/${held}/close`);
    refusedWith(response, 409, 'vacancy_has_load');
    expect(detailsOf(response).map((detail) => [detail.path, detail.recordId])).toEqual([
      ['load', inForce],
    ]);

    const both = await vacancy();
    const first = await naming(both, LATER);
    const second = await naming(both, '2026-10-19');
    const twice = await post(`/api/people/vacancies/${both}/close`);
    refusedWith(twice, 409, 'vacancy_has_load');
    expect(detailsOf(twice).map((detail) => [detail.path, detail.recordId])).toEqual([
      ['load', first],
      ['load', second],
    ]);
  });

  // The spec review of the code: the side whose wait is proved is the route;
  // the held side moves a lesson under the vacancy, as no route does yet.
  it('waits for a lesson being moved under the vacancy and is refused', async () => {
    const source = await kit.source(
      t.north,
      year,
      [{ classId, groupId: null, subjectId: subject }],
      EARLY,
    );
    const teacher = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select('teacher_id')
      .where('id', '=', source.lessons[0]?.loadRowId ?? '')
      .executeTakeFirstOrThrow();
    const moved = await vacancy();
    const lesson = await lessonOn(source, '2026-10-13', teacher.teacher_id);
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = new Transactions(t.database.app, t.clock).run(
      [t.north],
      async (transaction: Transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', moved)
          .forKeyShare()
          .execute();
        await transaction
          .updateTable('lessons')
          .set({ teacher_id: moved })
          .where('id', '=', lesson)
          .execute();
        await heldEntry(transaction, t.north);
        ready();
        await released;
      },
    );
    await isReady;
    const closing = post(`/api/people/vacancies/${moved}/close`).then((response) => response);
    await expect
      .poll(
        async () =>
          (
            await sql<{ waiting: number }>`
              select count(distinct l.pid)::int as waiting
              from pg_locks l join pg_stat_activity a on a.pid = l.pid
              where a.datname = current_database() and not l.granted
            `.execute(t.database.migrator)
          ).rows[0]?.waiting ?? 0,
        { timeout: 20_000, interval: 50 },
      )
      .toBe(1);
    release();
    await held;
    const response = await closing;
    refusedWith(response, 409, 'vacancy_has_load');
    expect(detailsOf(response).map((detail) => detail.path)).toEqual(['lessons']);
  });

  it('answers 404 for a vacancy of another branch that its load holds', async () => {
    const southYear = await kit.load.classes.year(t.south);
    const southClass = await kit.load.classes.schoolClass(t.south, southYear, { grade: 7 });
    const south = await kit.load.vacancy(t.south, { subjects: [{ subject, grades: [7] }] });
    const version = await kit.load.version(t.south, southYear, { startsOn: LATER });
    await kit.load.row({
      branch_id: t.south,
      version_id: version,
      class_id: southClass,
      subject_id: subject,
      teacher_id: south,
    });
    await kit.load.setVersion(version, 'published');
    for (const cookie of [t.vicePrincipal, t.admin]) {
      for (const action of ['close', 'delete']) {
        const before = await rowsOf();
        const response = await t.post(
          `/api/people/vacancies/${south}/${action}`,
          t.north,
          {},
          cookie,
        );
        refusedWith(response, 404, 'not_found');
        expect(JSON.stringify(response.body)).not.toContain(version);
        expect(await rowsOf()).toEqual(before);
      }
    }
  });
});
