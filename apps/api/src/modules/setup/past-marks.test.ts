import {
  BRANCH_HEADER,
  pastMarkConfirmResultSchema,
  pastMarkPreviewSchema,
  pastMarkTitleKey,
  pastMarkUploadListSchema,
  STUDENT_IMPORT_TYPES,
  type PastMarkPreview,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { MembersKit, moveStudentBranch } from '../../testing/members-kit.js';
import { filledPastMarkTemplate, type PastMarkTemplateRow } from '../../testing/past-marks-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { insertSubject } from '../../testing/subjects-kit.js';

const XLSX = STUDENT_IMPORT_TYPES[0] ?? '';

const DATED = [
  ['2026-09-02', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-19'],
  ['2027-03-29', '2027-05-25'],
] as const;

/** The go-live date of both branches: Monday 12 October 2026. */
const GO_LIVE = '2026-10-12';

interface Pupil {
  id: string;
  uid: string;
  lastName: string;
  firstName: string;
}

// All names are invented. Task 11.26: `10`, Past marks from before go-live (The file, The rules
// of a row, The upload, Withdrawal); `edge/academic-year`, Past marks from before go-live, with
// the plan's decisions and the review's corrections 1 and 2. The clock stands at 23:55 on
// 10 October 2026 in Tashkent.
describe('the import of past marks', () => {
  let t: DayTemplatesKit;
  let members: MembersKit;
  let creator: string;
  let history: string;
  let historyName: string;
  let pe: string;
  let peName: string;
  /** Grade 7 of the north from 1 September. */
  let ali: Pupil;
  let bea: Pupil;
  /** A record of the south now; in grade 8 of the north until 1 October. */
  let moved: Pupil;

  const upload = (bytes: Buffer, cookie = t.admin, branch = '', name = 'marks.xlsx') =>
    request(t.kit.server)
      .put(`/api/setup/past-marks/imports?name=${encodeURIComponent(name)}`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch || t.north)
      .set('Content-Type', XLSX)
      .send(bytes);

  async function uploaded(
    rows: readonly PastMarkTemplateRow[],
    branch = '',
    cookie = t.admin,
    name = 'marks.xlsx',
  ): Promise<PastMarkPreview> {
    const response = await upload(await filledPastMarkTemplate(rows), cookie, branch, name);
    expect(response.status, JSON.stringify(response.body).slice(0, 800)).toBe(200);
    return pastMarkPreviewSchema.parse(response.body);
  }

  const preview = (id: string, page = 1, cookie = t.admin, branch = '') =>
    t.post(`/api/setup/past-marks/imports/${id}/preview`, branch || t.north, { page }, cookie);

  const confirm = (id: string, cookie = t.admin, branch = '') =>
    t.post(`/api/setup/past-marks/imports/${id}/confirm`, branch || t.north, {}, cookie);

  const withdraw = (
    id: string,
    reason = 'The wrong class was exported',
    cookie = t.admin,
    branch = '',
  ) =>
    t.post(`/api/setup/past-marks/imports/${id}/withdraw`, branch || t.north, { reason }, cookie);

  async function saved(id: string, cookie = t.admin, branch = '') {
    const response = await confirm(id, cookie, branch);
    expect(response.status, JSON.stringify(response.body).slice(0, 800)).toBe(200);
    const result = pastMarkConfirmResultSchema.parse(response.body);
    if (result.outcome !== 'saved') {
      throw new Error(`Not saved: ${JSON.stringify(result.preview.rows)}`);
    }
    return result;
  }

  async function imported(rows: readonly PastMarkTemplateRow[], branch = '', name = 'marks.xlsx') {
    const answer = await uploaded(rows, branch, t.admin, name);
    expect(answer.clean, JSON.stringify(answer.rows)).toBe(true);
    await saved(answer.importId, t.admin, branch);
    return answer.importId;
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const codesAt = (answer: PastMarkPreview, rowNumber: number) =>
    (answer.rows.find((one) => one.rowNumber === rowNumber)?.problems ?? []).map(
      (one) => `${String(one.column)}:${one.code}`,
    );

  /** A row of a pupil, of history on a date, with the cells given. */
  const rowOf = (pupil: Pupil, cells: PastMarkTemplateRow = {}): PastMarkTemplateRow => ({
    uid: pupil.uid,
    lastName: pupil.lastName,
    firstName: pupil.firstName,
    date: '2026-09-07',
    subject: historyName,
    ...cells,
  });

  /** Every row of the tables the import writes, in both branches, and the logs. */
  const rowsOf = () =>
    Promise.all(
      ['past_mark_uploads', 'past_attendance', 'past_works', 'audit_log', 'audit_log_school'].map(
        async (table) =>
          (await sql`select * from ${sql.table(table)} order by 1`.execute(t.database.migrator))
            .rows,
      ),
    );

  const countOf = async (table: 'past_attendance' | 'past_works', uploadId?: string) =>
    Number(
      (
        await t.database.migrator
          .selectFrom(table)
          .select((eb) => eb.fn.countAll().as('count'))
          .$if(uploadId !== undefined, (query) => query.where('upload_id', '=', uploadId ?? ''))
          .executeTakeFirstOrThrow()
      ).count,
    );

  const goLive = (date: string | null, branch = '') =>
    t.put('/api/setup/branch/go-live', branch || t.north, { goLiveDate: date });

  async function pupil(branch: string, grade = 7): Promise<Pupil> {
    const id = await members.student(branch, { grade });
    const row = await t.database.migrator
      .selectFrom('students')
      .select(['uid', 'last_name', 'first_name'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { id, uid: row.uid, lastName: row.last_name, firstName: row.first_name };
  }

  /** Holds a transaction of the migrator open after its steps; answers its backend and the release. */
  async function held(steps: readonly ReturnType<typeof sql>[]) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: (pid: number) => void = () => undefined;
    const holding = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const done = t.database.migrator.transaction().execute(async (transaction) => {
      for (const step of steps) await step.execute(transaction);
      const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(transaction);
      ready(pid.rows[0]?.pid ?? 0);
      await released;
    });
    const pid = await holding;
    return {
      pid,
      release: async () => {
        release();
        await done;
      },
    };
  }

  /** Waits until a backend of this database waits on `pid`. */
  async function waitingOn(pid: number): Promise<void> {
    for (let tries = 0; tries < 400; tries += 1) {
      const found = await sql<{ count: number }>`
        select count(*)::int as count from pg_stat_activity a
        where a.datname = current_database() and ${pid} = any(pg_blocking_pids(a.pid))
      `.execute(t.database.migrator);
      if ((found.rows[0]?.count ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Nothing waited on the held transaction.');
  }

  /** Starts a request now (a supertest request is sent only once awaited). */
  const started = (run: () => Promise<Response>): Promise<Response> =>
    new Promise((resolve, reject) => {
      run().then(resolve, reject);
    });

  beforeAll(async () => {
    t = await dayTemplatesKit();
    creator = (
      await t.database.migrator
        .selectFrom('accounts')
        .select('id')
        .orderBy('id')
        .executeTakeFirstOrThrow()
    ).id;
    members = new MembersKit(t.database.migrator, creator);
    for (const branch of [t.north, t.south]) {
      await t.database.migrator.transaction().execute(async (transaction) => {
        const year = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: '2026-09-01', end_date: '2027-05-31' })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const [index, dates] of DATED.entries()) {
          await transaction
            .insertInto('quarters')
            .values({
              branch_id: branch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: dates[0],
              end_date: dates[1],
            })
            .execute();
        }
        await transaction
          .updateTable('academic_years')
          .set({ status: 'current' })
          .where('id', '=', year.id)
          .execute();
        await transaction
          .updateTable('branches')
          .set({ go_live_date: GO_LIVE })
          .where('id', '=', branch)
          .execute();
      });
    }
    // Wednesday 16 September: a day off of grade 7 of the north only.
    await t.database.migrator
      .insertInto('calendar_entries')
      .values({
        branch_id: t.north,
        kind: 'day_off',
        name: 'Grade 7 trip',
        first_date: '2026-09-16',
        last_date: '2026-09-16',
        grade_from: 7,
        grade_to: 7,
      })
      .execute();
    history = await insertSubject(t.database.migrator, 'History');
    historyName = (
      await t.database.migrator
        .selectFrom('subjects')
        .select('name_en')
        .where('id', '=', history)
        .executeTakeFirstOrThrow()
    ).name_en;
    pe = await insertSubject(t.database.migrator, 'Physical education');
    await t.database.migrator
      .updateTable('subjects')
      .set({ journal_type: 'attendance_only' })
      .where('id', '=', pe)
      .execute();
    peName = (
      await t.database.migrator
        .selectFrom('subjects')
        .select('name_en')
        .where('id', '=', pe)
        .executeTakeFirstOrThrow()
    ).name_en;
    const north7 = (await t.classOf(t.north, 7, '2026-09-02')) ?? '';
    const north8 = (await t.classOf(t.north, 8, '2026-09-02')) ?? '';
    const south8 = (await t.classOf(t.south, 8, '2026-09-02')) ?? '';
    ali = await pupil(t.north);
    bea = await pupil(t.north);
    for (const one of [ali, bea]) {
      await members.member({
        branch: t.north,
        classId: north7,
        studentId: one.id,
        from: '2026-09-01',
      });
    }
    // Grade 8 of the north until 1 October, then of the south (as a branch move leaves it).
    moved = await pupil(t.north, 8);
    await members.member({
      branch: t.north,
      classId: north8,
      studentId: moved.id,
      from: '2026-09-01',
      until: '2026-10-01',
      ownUntil: '2026-10-01',
    });
    await moveStudentBranch(t.database.migrator, moved.id, t.north, t.south, '2026-10-01T10:00:00+05:00');
    await members.member({ branch: t.south, classId: south8, studentId: moved.id, from: '2026-10-01' });
  });

  afterAll(async () => {
    await t.close();
  });

  it('shows every problem of a file on its row and saves nothing', async () => {
    const before = await countOf('past_attendance');
    const answer = await uploaded([
      // 3: clean.
      rowOf(ali, { attendance: '1' }),
      // 4: another person under the UID.
      rowOf(ali, { firstName: 'Zarina', date: '2026-09-08', attendance: '1' }),
      // 5: an unknown UID.
      rowOf(ali, { uid: '2699998', date: '2026-09-08', attendance: '1' }),
      // 6: on the go-live date.
      rowOf(ali, { date: GO_LIVE, attendance: '1' }),
      // 7: the day off of grade 7.
      rowOf(ali, { date: '2026-09-16', attendance: '1' }),
      // 8: an unknown subject.
      rowOf(ali, { subject: 'Astronomy', date: '2026-09-08', attendance: '1' }),
      // 9: a work on an attendance-only subject.
      rowOf(ali, {
        subject: peName,
        date: '2026-09-08',
        classworkTitle: 'Run',
        classworkTotal: 10,
        classworkScore: 9,
      }),
      // 10: a work with two of its three cells.
      rowOf(ali, { date: '2026-09-09', classworkTitle: 'Dictation', classworkTotal: 10 }),
      // 11: a comma and three decimals.
      rowOf(ali, {
        date: '2026-09-10',
        classworkTitle: 'Dictation',
        classworkTotal: '10,5',
        classworkScore: '7.555',
      }),
      // 12: a score above the total, a title too long.
      rowOf(ali, {
        date: '2026-09-11',
        homeworkTitle: 'x'.repeat(61),
        homeworkTotal: 10,
        homeworkScore: 10.5,
      }),
      // 13 and 14: one lesson's attendance twice.
      rowOf(bea, { attendance: '1' }),
      rowOf(bea, { attendance: '0' }),
      // 15: a lesson 13.
      rowOf(bea, { lesson: 13, attendance: '1', date: '2026-09-08' }),
      // 16: the moved student, of the north on that date: clean.
      rowOf(moved, { attendance: '1' }),
    ]);
    expect(answer.clean).toBe(false);
    expect(answer.counts).toEqual({ rows: 14, withProblems: 12, clean: 2 });
    expect(codesAt(answer, 3)).toEqual([]);
    expect(codesAt(answer, 4)).toEqual(['lastName:name_mismatch']);
    expect(codesAt(answer, 5)).toEqual(['uid:uid_unknown']);
    expect(codesAt(answer, 6)).toEqual(['date:date_not_before_go_live']);
    expect(codesAt(answer, 7)).toEqual(['date:date_not_school_day']);
    expect(codesAt(answer, 8)).toEqual(['subject:subject_unknown']);
    expect(codesAt(answer, 9)).toEqual(['classworkTitle:subject_attendance_only']);
    expect(codesAt(answer, 10)).toEqual(['classworkScore:work_incomplete']);
    expect(codesAt(answer, 11)).toEqual([
      'classworkTotal:amount_comma',
      'classworkScore:amount_decimals',
    ]);
    expect(codesAt(answer, 12)).toEqual([
      'homeworkTitle:title_too_long',
      'homeworkScore:score_range',
    ]);
    expect(codesAt(answer, 13)).toEqual(['attendance:attendance_repeated_in_file']);
    expect(codesAt(answer, 14)).toEqual(['attendance:attendance_repeated_in_file']);
    expect(codesAt(answer, 15)).toEqual(['lesson:invalid']);
    expect(codesAt(answer, 16)).toEqual([]);
    // Rows with problems first.
    expect(answer.rows.slice(0, 12).every((one) => one.problems.length > 0)).toBe(true);

    const result = pastMarkConfirmResultSchema.parse((await confirm(answer.importId)).body);
    expect(result.outcome).toBe('not_clean');
    expect(await countOf('past_attendance')).toBe(before);
    const upload = await t.database.migrator
      .selectFrom('past_mark_uploads')
      .select(['confirmed_at'])
      .where('id', '=', answer.importId)
      .executeTakeFirstOrThrow();
    expect(upload.confirmed_at).toBeNull();
  });

  it('saves every row of a clean file, lists the upload and logs the upload and the confirm', async () => {
    const answer = await uploaded(
      [
        rowOf(ali, {
          date: '2026-09-14',
          attendance: '2',
          classworkTitle: 'Dictation',
          classworkTotal: 10,
          classworkScore: 7.5,
          homeworkTitle: 'Map',
          homeworkTotal: '8.25',
          homeworkScore: '6.6',
        }),
        // A second classwork of the lesson: a further row.
        rowOf(ali, {
          date: '2026-09-14',
          classworkTitle: 'Reading',
          classworkTotal: 5,
          classworkScore: 5,
        }),
        rowOf(ali, { date: '2026-09-14', subject: peName, attendance: '5' }),
        rowOf(bea, { date: '2026-09-14', lesson: 2, attendance: '0' }),
      ],
      '',
      t.vicePrincipal,
      'Grade 7 September.xlsx',
    );
    expect(answer.clean, JSON.stringify(answer.rows)).toBe(true);
    const result = await saved(answer.importId, t.vicePrincipal);
    expect(result).toEqual({ outcome: 'saved', rows: 4, attendance: 3, works: 3 });
    const works = await t.database.migrator
      .selectFrom('past_works')
      .select(['kind', 'position', 'title', 'total', 'score', 'branch_id', 'lesson_number'])
      .where('upload_id', '=', answer.importId)
      .orderBy('kind')
      .orderBy('position')
      .execute();
    expect(
      works.map((one) => [one.kind, one.position, one.title, Number(one.total), Number(one.score)]),
    ).toEqual([
      ['classwork', 1, 'Dictation', 10, 7.5],
      ['classwork', 2, 'Reading', 5, 5],
      ['homework', 1, 'Map', 8.25, 6.6],
    ]);
    expect(works.every((one) => one.branch_id === t.north)).toBe(true);
    const list = pastMarkUploadListSchema.parse(
      (await t.get('/api/setup/past-marks/imports', t.north, t.vicePrincipal)).body,
    );
    const listed = list.uploads.find((one) => one.id === answer.importId);
    expect(listed).toMatchObject({
      fileName: 'Grade 7 September.xlsx',
      rowCount: 4,
      withdrawn: null,
    });
    expect(await t.entries('past_marks.upload', answer.importId)).toHaveLength(1);
    const [entry] = await t.entries('past_marks.confirm', answer.importId);
    expect(entry?.details).toMatchObject({ rowCount: 4, attendance: 3, works: 3 });
    // The south lists nothing of the north.
    const south = pastMarkUploadListSchema.parse(
      (await t.get('/api/setup/past-marks/imports', t.south)).body,
    );
    expect(south.uploads.some((one) => one.id === answer.importId)).toBe(false);
  });

  it('refuses a repeat of a standing upload, and the same file until it is withdrawn', async () => {
    const rows = [
      rowOf(ali, {
        date: '2026-09-21',
        attendance: '1',
        classworkTitle: 'Essay',
        classworkTotal: 20,
        classworkScore: 15,
      }),
    ];
    const first = await imported(rows, '', 'essay.xlsx');
    // The same file again: shown as imported, and refused at the confirm.
    const again = await uploaded(rows, '', t.admin, 'essay.xlsx');
    expect(again.alreadyImportedOn).toBe('2026-10-10');
    refusedWith(await confirm(again.importId), 409, 'import_already_done');
    // Another file with the same lesson's attendance and the same work, its title spelt otherwise.
    const repeat = await uploaded([
      rowOf(ali, { date: '2026-09-21', attendance: '0' }),
      rowOf(ali, {
        date: '2026-09-21',
        classworkTitle: ' ESSAY ',
        classworkTotal: 10,
        classworkScore: 1,
      }),
    ]);
    expect(codesAt(repeat, 3)).toEqual(['attendance:attendance_already_imported']);
    expect(codesAt(repeat, 4)).toEqual(['classworkTitle:work_already_imported']);
    // Withdrawn: the same file is taken again.
    expect((await withdraw(first)).status).toBe(200);
    const after = await uploaded(rows, '', t.admin, 'essay.xlsx');
    expect(after.alreadyImportedOn).toBeNull();
    expect(after.clean).toBe(true);
    await saved(after.importId);
  });

  it('withdraws a whole upload with a reason, keeping its rows marked', async () => {
    const id = await imported(
      [
        rowOf(bea, { date: '2026-09-22', attendance: '3' }),
        rowOf(bea, {
          date: '2026-09-22',
          homeworkTitle: 'Poem',
          homeworkTotal: 5,
          homeworkScore: 4,
        }),
      ],
      '',
      'poem.xlsx',
    );
    // Not by the Principal (no `past_marks`), nor a reason left empty.
    refusedWith(await withdraw(id, 'Wrong file', t.principal), 403, 'permission_denied');
    expect((await withdraw(id, '  ')).status).toBe(400);
    const response = await withdraw(id, 'Exported from the wrong class', t.vicePrincipal);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const list = pastMarkUploadListSchema.parse(response.body);
    expect(list.uploads.find((one) => one.id === id)?.withdrawn).toMatchObject({
      reason: 'Exported from the wrong class',
    });
    for (const table of ['past_attendance', 'past_works'] as const) {
      const rows = await t.database.migrator
        .selectFrom(table)
        .select('withdrawn_at')
        .where('upload_id', '=', id)
        .execute();
      expect(rows.length).toBe(1);
      expect(rows.every((one) => one.withdrawn_at !== null)).toBe(true);
    }
    const [entry] = await t.entries('past_marks.withdraw', id);
    expect(entry?.details).toMatchObject({
      reason: 'Exported from the wrong class',
      attendance: 1,
      works: 1,
    });
    // Twice, or an upload never confirmed: not standing.
    refusedWith(await withdraw(id), 409, 'past_marks_not_standing');
    const unconfirmed = await uploaded([rowOf(bea, { date: '2026-09-23', attendance: '1' })]);
    refusedWith(await withdraw(unconfirmed.importId), 409, 'past_marks_not_standing');
  });

  it('refuses a go-live date that a standing past mark would be on or after, and a clearing', async () => {
    const id = await imported(
      [rowOf(bea, { date: '2026-10-05', attendance: '1' })],
      '',
      'october.xlsx',
    );
    const refused = await goLive('2026-10-05');
    refusedWith(refused, 409, 'go_live_past_marks');
    expect(
      (refused.body as { error: { details: { recordId?: string; message: string }[] } }).error
        .details,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ recordId: id, message: 'october.xlsx' })]),
    );
    refusedWith(await goLive(null), 409, 'go_live_past_marks');
    // Later is fine: every past mark stays before it.
    expect((await goLive('2026-10-13')).status).toBe(200);
    expect((await goLive(GO_LIVE)).status).toBe(200);
    // A withdrawn upload is in no one's way.
    await withdraw(id);
    const branch = await t.database.migrator
      .selectFrom('branches')
      .select('go_live_date')
      .where('id', '=', t.north)
      .executeTakeFirstOrThrow();
    expect(String(branch.go_live_date)).toBe(GO_LIVE);
  });

  it('decides the branch of a moved student by the class on the date (review correction 1)', async () => {
    const rows = [rowOf(moved, { date: '2026-09-24', attendance: '1' })];
    const south = await uploaded(rows, t.south);
    expect(codesAt(south, 3)).toEqual(['uid:student_other_branch']);
    const north = await uploaded(rows, t.north);
    expect(north.clean).toBe(true);
    await saved(north.importId);
    const row = await t.database.migrator
      .selectFrom('past_attendance')
      .select('branch_id')
      .where('upload_id', '=', north.importId)
      .executeTakeFirstOrThrow();
    expect(row.branch_id).toBe(t.north);
  });

  it('answers 404 for an upload of another branch or an unknown one, changing nothing', async () => {
    const south = await uploaded([rowOf(moved, { date: '2026-10-05', attendance: '1' })], t.south);
    const standing = await imported(
      [rowOf(ali, { date: '2026-09-25', attendance: '1' })],
      '',
      'friday.xlsx',
    );
    const before = await rowsOf();
    for (const id of [south.importId, UNKNOWN]) {
      refusedWith(await preview(id), 404, 'not_found');
      refusedWith(await confirm(id), 404, 'not_found');
      refusedWith(await withdraw(id), 404, 'not_found');
    }
    // The north's standing upload named in the south.
    refusedWith(await withdraw(standing, 'x', t.admin, t.south), 404, 'not_found');
    expect(await rowsOf()).toEqual(before);
  });

  it('refuses every route to the Principal and the Teacher of the branch', async () => {
    const answer = await uploaded([rowOf(ali, { date: '2026-09-28', attendance: '1' })]);
    for (const cookie of [t.principal, t.teacher]) {
      refusedWith(
        await upload(await filledPastMarkTemplate([rowOf(ali)]), cookie),
        403,
        'permission_denied',
      );
      refusedWith(await preview(answer.importId, 1, cookie), 403, 'permission_denied');
      refusedWith(await confirm(answer.importId, cookie), 403, 'permission_denied');
      refusedWith(
        await t.get('/api/setup/past-marks/imports', t.north, cookie),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.get('/api/setup/past-marks/import-template?language=uz', t.north, cookie),
        403,
        'permission_denied',
      );
    }
    // The Academic Vice Principal of the north is refused in the south.
    refusedWith(
      await t.get('/api/setup/past-marks/imports', t.south, t.vicePrincipal),
      403,
      'permission_denied',
    );
  });

  it('gives the template in each language, as the system template', async () => {
    for (const language of ['uz', 'ru', 'en']) {
      const response = await t
        .get(`/api/setup/past-marks/import-template?language=${language}`, t.north, t.vicePrincipal)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect(response.status).toBe(200);
      // An empty template is the system's: read, and refused only as empty.
      const answer = await upload(response.body as Buffer);
      refusedWith(answer, 422, 'import_empty');
    }
  });

  it('pages the preview, rows with problems first', async () => {
    const rows = Array.from({ length: 520 }, (_, index) =>
      rowOf(ali, {
        date: '2026-09-29',
        lesson: (index % 12) + 1,
        classworkTitle: `Task ${String(index)}`,
        classworkTotal: 10,
        classworkScore: index === 519 ? 11 : 5,
      }),
    );
    const first = await uploaded(rows);
    expect(first.page).toBe(1);
    expect(first.pageCount).toBe(2);
    expect(first.rows).toHaveLength(500);
    expect(first.rows[0]?.rowNumber).toBe(522);
    const second = pastMarkPreviewSchema.parse((await preview(first.importId, 2)).body);
    expect(second.rows).toHaveLength(20);
    expect(second.counts).toEqual({ rows: 520, withProblems: 1, clean: 519 });
  });

  describe('at the same moment', () => {
    it('two confirms meet at the lock: the second answers the repeat as a problem of its row', async () => {
      const answer = await uploaded([rowOf(bea, { date: '2026-09-30', attendance: '1' })]);
      const other = await t.database.migrator
        .insertInto('past_mark_uploads')
        .values({
          branch_id: t.north,
          file_name: 'first.xlsx',
          file_sha256: 'a'.repeat(64),
          rows: JSON.stringify([]),
          row_count: 1,
          uploaded_by: creator,
          uploaded_at: new Date(START),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const first = await held([
        sql`select pg_advisory_xact_lock(hashtextextended(${`past_marks:${t.north}`}, 0))`,
        sql`update past_mark_uploads set confirmed_by = ${creator}::uuid, confirmed_at = ${new Date(START)} where id = ${other.id}::uuid`,
        sql`insert into past_attendance (branch_id, upload_id, academic_year_id, student_id, subject_id, school_date, lesson_number, mark)
            select ${t.north}::uuid, ${other.id}::uuid, y.id, ${bea.id}::uuid, ${history}::uuid, '2026-09-30', 1, 1
            from academic_years y where y.branch_id = ${t.north}::uuid and y.status = 'current'`,
      ]);
      const second = started(() => confirm(answer.importId));
      await waitingOn(first.pid);
      await first.release();
      const response = await second;
      const result = pastMarkConfirmResultSchema.parse(response.body);
      expect(result.outcome).toBe('not_clean');
      if (result.outcome === 'not_clean') {
        expect(codesAt(result.preview, 3)).toEqual(['attendance:attendance_already_imported']);
      }
    });

    it('a go-live change held first: the confirm then finds its rows on or after the new date', async () => {
      const answer = await uploaded([rowOf(bea, { date: '2026-10-06', attendance: '1' })]);
      const first = await held([
        sql`select 1 from branches where id = ${t.north}::uuid for update`,
        sql`update branches set go_live_date = '2026-10-05' where id = ${t.north}::uuid`,
      ]);
      const second = started(() => confirm(answer.importId));
      await waitingOn(first.pid);
      await first.release();
      const result = pastMarkConfirmResultSchema.parse((await second).body);
      expect(result.outcome).toBe('not_clean');
      if (result.outcome === 'not_clean') {
        expect(codesAt(result.preview, 3)).toEqual(['date:date_not_before_go_live']);
      }
      await t.database.migrator
        .updateTable('branches')
        .set({ go_live_date: GO_LIVE })
        .where('id', '=', t.north)
        .execute();
    });

    it('a confirm held first: the go-live change then finds its rows and is refused', async () => {
      const other = await t.database.migrator
        .insertInto('past_mark_uploads')
        .values({
          branch_id: t.north,
          file_name: 'held.xlsx',
          file_sha256: 'b'.repeat(64),
          rows: JSON.stringify([]),
          row_count: 1,
          uploaded_by: creator,
          uploaded_at: new Date(START),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const first = await held([
        sql`select 1 from branches where id = ${t.north}::uuid for share`,
        sql`update past_mark_uploads set confirmed_by = ${creator}::uuid, confirmed_at = ${new Date(START)} where id = ${other.id}::uuid`,
        sql`insert into past_attendance (branch_id, upload_id, academic_year_id, student_id, subject_id, school_date, lesson_number, mark)
            select ${t.north}::uuid, ${other.id}::uuid, y.id, ${bea.id}::uuid, ${history}::uuid, '2026-10-07', 1, 1
            from academic_years y where y.branch_id = ${t.north}::uuid and y.status = 'current'`,
      ]);
      const second = started(() => goLive('2026-10-07'));
      await waitingOn(first.pid);
      await first.release();
      const response = await second;
      refusedWith(response, 409, 'go_live_past_marks');
      await withdraw(other.id);
    });
  });

  describe('the database', () => {
    it('gives a title the same key as the reader of the file (review correction 2)', async () => {
      const titles = [
        'Essay',
        ' ESSAY ',
        'Oʻqish',
        "O'qish",
        'O’qish',
        'Oʼqish',
        'O`qish',
        'Two  words',
        'Ўқиш',
        'ДИКТАНТ',
      ];
      const keys = await sql<{ title: string; key: string }>`
        select t as title, past_mark_title_key(t) as key from unnest(${titles}::text[]) t
      `.execute(t.database.migrator);
      for (const row of keys.rows) {
        expect(row.key, row.title).toBe(pastMarkTitleKey(row.title));
      }
    });

    it('keeps one standing mark of a lesson and one standing work, and the rules of a row', async () => {
      const upload = await t.database.migrator
        .insertInto('past_mark_uploads')
        .values({
          branch_id: t.north,
          file_name: 'guards.xlsx',
          file_sha256: 'c'.repeat(64),
          rows: JSON.stringify([]),
          row_count: 1,
          uploaded_by: creator,
          uploaded_at: new Date(START),
          confirmed_by: creator,
          confirmed_at: new Date(START),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const year = await t.database.migrator
        .selectFrom('academic_years')
        .select('id')
        .where('branch_id', '=', t.north)
        .where('status', '=', 'current')
        .executeTakeFirstOrThrow();
      const base = {
        branch_id: t.north,
        upload_id: upload.id,
        academic_year_id: year.id,
        student_id: ali.id,
        subject_id: history,
        school_date: '2026-10-01',
        lesson_number: 1,
      };
      await t.database.migrator
        .insertInto('past_attendance')
        .values({ ...base, mark: 1 })
        .execute();
      await expect(
        t.database.migrator
          .insertInto('past_attendance')
          .values({ ...base, mark: 0 })
          .execute(),
      ).rejects.toMatchObject({ constraint: 'past_attendance_standing_idx' });
      const work = { ...base, kind: 'classwork', position: 1, total: 10, score: 5 };
      await t.database.migrator
        .insertInto('past_works')
        .values({ ...work, title: 'Quiz' })
        .execute();
      await expect(
        t.database.migrator
          .insertInto('past_works')
          .values({ ...work, title: ' quiz' })
          .execute(),
      ).rejects.toMatchObject({ constraint: 'past_works_title_check' });
      await expect(
        t.database.migrator
          .insertInto('past_works')
          .values({ ...work, title: 'QUIZ' })
          .execute(),
      ).rejects.toMatchObject({ constraint: 'past_works_standing_idx' });
      await expect(
        t.database.migrator
          .insertInto('past_works')
          .values({ ...work, title: 'Score', score: 10.5 })
          .execute(),
      ).rejects.toMatchObject({ constraint: 'past_works_score_check' });
      await expect(
        t.database.migrator
          .insertInto('past_works')
          .values({ ...work, title: 'Decimals', total: 10, score: 5.555 })
          .execute(),
      ).rejects.toMatchObject({ constraint: 'work_amount_check' });
      await expect(
        t.database.migrator
          .insertInto('past_attendance')
          .values({ ...base, branch_id: t.south, lesson_number: 2, mark: 1 })
          .execute(),
      ).rejects.toMatchObject({ constraint: 'past_marks_upload_branch' });
      // A row is withdrawn only with its upload, once.
      await expect(
        t.database.migrator
          .updateTable('past_attendance')
          .set({ withdrawn_at: new Date(START) })
          .where('upload_id', '=', upload.id)
          .execute(),
      ).rejects.toMatchObject({ constraint: 'past_marks_withdrawn_once' });
      await withdraw(upload.id);
      await expect(
        t.database.migrator
          .updateTable('past_attendance')
          .set({ withdrawn_at: null })
          .where('upload_id', '=', upload.id)
          .execute(),
      ).rejects.toMatchObject({ constraint: 'past_marks_withdrawn_once' });
      // Withdrawn, the lesson takes a standing mark again.
      await t.database.migrator
        .insertInto('past_attendance')
        .values({
          ...base,
          mark: 0,
          upload_id: (
            await t.database.migrator
              .insertInto('past_mark_uploads')
              .values({
                branch_id: t.north,
                file_name: 'again.xlsx',
                file_sha256: 'd'.repeat(64),
                rows: JSON.stringify([]),
                row_count: 1,
                uploaded_by: creator,
                uploaded_at: new Date(START),
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id,
        })
        .execute();
    });

    it('gives the application no delete and no change of a mark beyond its withdrawal and student', async () => {
      const grants = await sql<{ table_name: string; privilege_type: string }>`
        select table_name, privilege_type from information_schema.role_table_grants
        where grantee = 'sodiq_app' and table_name in ('past_mark_uploads', 'past_attendance', 'past_works')
        order by 1, 2
      `.execute(t.database.migrator);
      expect(grants.rows.map((one) => `${one.table_name}:${one.privilege_type}`)).toEqual([
        'past_attendance:INSERT',
        'past_attendance:SELECT',
        'past_mark_uploads:INSERT',
        'past_mark_uploads:SELECT',
        'past_works:INSERT',
        'past_works:SELECT',
      ]);
      const columns = await sql<{ table_name: string; column_name: string }>`
        select table_name, column_name from information_schema.column_privileges
        where grantee = 'sodiq_app' and privilege_type = 'UPDATE'
          and table_name in ('past_mark_uploads', 'past_attendance', 'past_works')
        order by 1, 2
      `.execute(t.database.migrator);
      expect(columns.rows.map((one) => `${one.table_name}.${one.column_name}`)).toEqual([
        'past_attendance.student_id',
        'past_attendance.withdrawn_at',
        'past_mark_uploads.confirmed_at',
        'past_mark_uploads.confirmed_by',
        'past_mark_uploads.withdraw_reason',
        'past_mark_uploads.withdrawn_at',
        'past_mark_uploads.withdrawn_by',
        'past_works.student_id',
        'past_works.withdrawn_at',
      ]);
    });
  });
});
