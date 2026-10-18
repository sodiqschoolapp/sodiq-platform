import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  outOfDateAnswerSchema,
  publishCheckSchema,
  timetableVersionSchema,
  type OutOfDateAnswer,
  type TimetableVersion,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  MONDAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const okay = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBeGreaterThanOrEqual(200);
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return response;
};

const answerOf = (response: Response): OutOfDateAnswer =>
  outOfDateAnswerSchema.parse(okay(response).body);

const versionOf = (response: Response): TimetableVersion =>
  timetableVersionSchema.parse(okay(response).body);

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** A Monday in November: the start of the second version and of the draft. */
const NOVEMBER = '2026-11-02';

// All names are invented. Task 5.5a-3b-2, pull request #148: bringing a draft
// up to date after a publish (edge/timetable, Versions and drafts, "Two drafts
// are open": "Each draft remembers the version it started from. Any publish
// ... marks the other drafts out of date. Bringing one up to date lists what
// changed on both sides, and the Academic Vice Principal picks"; 06, How
// surprises are prevented: "the differences are shown"). The clock stands at
// 23:55 on Saturday 10 October 2026 in Tashkent.
describe('bringing a draft up to date after a publish', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const get = (path: string, branch: string, cookie = t.admin) => t.get(path, branch, cookie);
  const post = (path: string, branch: string, body: object = {}, cookie = t.admin) =>
    t.post(path, branch, body, cookie);

  const shownOf = async (branch: string, version: string) =>
    answerOf(await get(`/api/timetable/versions/${version}/out-of-date`, branch));
  const upToDate = (
    branch: string,
    version: string,
    key: string,
    picks: readonly { item: string; side: 'draft' | 'published' }[] = [],
    cookie = t.admin,
  ) => post(`/api/timetable/versions/${version}/up-to-date`, branch, { key, picks }, cookie);

  const publish = (branch: string, version: string, startsOn: string) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn });

  const copy = async (branch: string, year: string, from: string, startsOn: string) => {
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn,
      copyFrom: from,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return (created.body as { id: string }).id;
  };

  const place = async (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition: number,
    double = false,
  ) =>
    okay(
      await post(`/api/timetable/versions/${version}/pattern`, branch, {
        loadRowId,
        weekday,
        slotPosition,
        ...(double ? { double: true } : {}),
      }),
    );

  const confirm = async (branch: string, version: string) =>
    okay(await post(`/api/timetable/versions/${version}/templates/confirm`, branch));

  /** The load row of a version for a subject. */
  const rowOf = async (version: string, subject: string) =>
    (
      await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', version)
        .where('subject_id', '=', subject)
        .executeTakeFirstOrThrow()
    ).id;

  /** The placements of a version, by subject, weekday and slot, with the pair of a double. */
  const placementsOf = (version: string) =>
    t.database.migrator
      .selectFrom('pattern_entries')
      .innerJoin('pattern_blocks', 'pattern_blocks.id', 'pattern_entries.block_id')
      .innerJoin('teaching_load_rows', 'teaching_load_rows.id', 'pattern_entries.load_row_id')
      .select([
        'teaching_load_rows.subject_id',
        'pattern_blocks.weekday',
        'pattern_blocks.slot_position',
        'pattern_blocks.double_pair_id',
      ])
      .where('pattern_entries.version_id', '=', version)
      .orderBy('teaching_load_rows.subject_id')
      .orderBy('pattern_blocks.weekday')
      .orderBy('pattern_blocks.slot_position')
      .execute();

  const pinsOf = async (version: string) =>
    (
      await t.database.migrator
        .selectFrom('timetable_pins')
        .innerJoin('teaching_load_rows', 'teaching_load_rows.id', 'timetable_pins.load_row_id')
        .select([
          'teaching_load_rows.subject_id',
          'timetable_pins.weekday',
          'timetable_pins.slot_position',
        ])
        .where('timetable_pins.version_id', '=', version)
        .execute()
    )
      .map((one) => [one.subject_id, one.weekday, one.slot_position])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  /** An account of the kit given a role in a branch. */
  const roleIn = async (branch: string, role: 'principal' | 'academic_vice_principal') => {
    const found = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('role', '=', role)
      .where('branch_id', '=', t.north)
      .executeTakeFirstOrThrow();
    await load.classes.role(found.account_id, branch, role);
  };

  const causesOf = (version: string) =>
    t.database.migrator
      .selectFrom('timetable_version_out_of_date_causes')
      .select(['action', 'record_id'])
      .where('version_id', '=', version)
      .orderBy('caused_at')
      .orderBy('id')
      .execute();

  const fromOf = async (version: string) =>
    (
      await t.database.migrator
        .selectFrom('timetable_versions')
        .select('from_version_id')
        .where('id', '=', version)
        .executeTakeFirstOrThrow()
    ).from_version_id;

  /** Every row of the tables a bring-up-to-date writes, in a branch. */
  const rowsOf = async (branch: string) => {
    const of = (table: string) =>
      sql<Record<string, unknown>>`select * from ${sql.table(table)} where branch_id = ${branch}`
        .execute(t.database.migrator)
        .then((found) => found.rows.map((one) => JSON.stringify(one)).sort());
    return {
      rows: await of('teaching_load_rows'),
      blocks: await of('pattern_blocks'),
      entries: await of('pattern_entries'),
      blockClasses: await of('pattern_block_classes'),
      pins: await of('timetable_pins'),
      locks: await of('timetable_locks'),
      versions: await of('timetable_versions'),
      causes: await of('timetable_version_out_of_date_causes'),
    };
  };

  /**
   * A branch whose published version S (from Monday 12 October) holds maths
   * on Monday 1 and art on Monday 2; a draft D and a draft E copied from it,
   * both from 2 November; E places maths on Tuesday 1, art on Tuesday 2 and a
   * row of history (E's own) on Wednesday 1, and is published, which marks D.
   * D places maths on Tuesday 2 and art on Monday 2. One teacher teaches all
   * three; every lesson is once a week. With `double`, maths is twice a week
   * as a double: S and E place it as a double, D leaves it unplaced.
   */
  async function scene(options: { double?: boolean } = {}) {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    for (const [index, [start, end]] of QUARTERS.entries()) {
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
        .execute();
    }
    const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
    const pause = await t.createSlotType(branch, 'Break', 'break', 10);
    const regular = await t.createTemplate(branch, 'Regular', [lesson, lesson, pause, lesson]);
    await t.assign(branch, regular);
    const subject = () => load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const maths = await subject();
    const art = await subject();
    const history = await subject();
    const room = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const teacherId = (
      await load.teacher(branch, {
        subjects: [maths, art, history].map((one) => ({ subject: one, grades: [7] })),
      })
    ).staffId;
    const hours = await t.database.migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: teacherId, valid_from: '2026-09-01' })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    for (const weekday of [1, 2, 3, 4, 5]) {
      await t.database.migrator
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: hours.id,
          branch_id: branch,
          staff_id: teacherId,
          weekday,
          start_minutes: 0,
          end_minutes: 1440,
          valid_from: '2026-09-01',
          valid_until: hours.valid_until,
        })
        .execute();
    }
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
      copyFrom: null,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const s = (created.body as { id: string }).id;
    const row = (version: string, subjectId: string, lessons = 1, double = false) =>
      load.row({
        branch_id: branch,
        version_id: version,
        class_id: classId,
        subject_id: subjectId,
        teacher_id: teacherId,
        lessons_per_week: lessons,
        ...(double ? { double_lessons: true } : {}),
      });
    const double = options.double === true;
    await place(branch, s, await row(s, maths, double ? 2 : 1, double), 1, 1, double);
    await place(branch, s, await row(s, art), 1, double ? 4 : 2);
    await confirm(branch, s);
    versionOf(await publish(branch, s, MONDAY));

    const d = await copy(branch, year, s, NOVEMBER);
    const e = await copy(branch, year, s, NOVEMBER);
    await place(branch, e, await rowOf(e, maths), 2, 1, double);
    await place(branch, e, await rowOf(e, art), 2, double ? 4 : 2);
    const eHistory = await row(e, history);
    await place(branch, e, eHistory, 3, 1);
    okay(
      await post(`/api/timetable/versions/${e}/pins`, branch, {
        loadRowId: eHistory,
        weekday: 3,
        slotPosition: 1,
      }),
    );
    await confirm(branch, e);
    versionOf(await publish(branch, e, NOVEMBER));
    let lockId: string | null = null;
    if (!double) {
      // D pins its maths on Tuesday 2 and locks its art block (permission
      // review, must-fix 2: the pins and the block locks a pick replaces).
      await place(branch, d, await rowOf(d, maths), 2, 2);
      await place(branch, d, await rowOf(d, art), 1, 2);
      okay(
        await post(`/api/timetable/versions/${d}/pins`, branch, {
          loadRowId: await rowOf(d, maths),
          weekday: 2,
          slotPosition: 2,
        }),
      );
      const artBlock = await t.database.migrator
        .selectFrom('pattern_entries')
        .select('block_id')
        .where('load_row_id', '=', await rowOf(d, art))
        .executeTakeFirstOrThrow();
      okay(
        await post(`/api/timetable/versions/${d}/locks`, branch, {
          kind: 'block',
          blockId: artBlock.block_id,
        }),
      );
      lockId = (
        await t.database.migrator
          .selectFrom('timetable_locks')
          .select('id')
          .where('version_id', '=', d)
          .executeTakeFirstOrThrow()
      ).id;
    } else {
      await place(branch, d, await rowOf(d, art), 1, 4);
    }
    return { branch, year, s, d, e, maths, art, history, classId, teacherId, lockId };
  }

  const itemOf = (shown: OutOfDateAnswer, subject: string) => {
    const found = shown.items.find((one) => one.rows.some((row) => row.subjectId === subject));
    if (found === undefined) throw new Error(`no item of ${subject}`);
    return found;
  };

  it('lists the changes of both sides and keeps the picks, after which the draft publishes', async () => {
    const x = await scene();
    expect(await causesOf(x.d)).toEqual([{ action: 'timetable_version.publish', record_id: x.e }]);
    const shown = await shownOf(x.branch, x.d);
    expect(shown.other).toMatchObject({ id: x.e, startsOn: NOVEMBER });
    expect(shown.base?.id).toBe(x.s);
    const maths = itemOf(shown, x.maths);
    const art = itemOf(shown, x.art);
    const history = itemOf(shown, x.history);
    expect(shown.items).toHaveLength(3);
    // Maths: the draft moved it to Tuesday 2, the published side to Tuesday 1.
    expect([maths.changedBy, maths.defaultPick]).toEqual(['both', null]);
    const [mathsRow] = maths.rows;
    expect(mathsRow?.base?.placements.map((one) => [one.weekday, one.slotPosition])).toEqual([
      [1, 1],
    ]);
    expect(mathsRow?.draft?.placements.map((one) => [one.weekday, one.slotPosition])).toEqual([
      [2, 2],
    ]);
    expect(mathsRow?.published?.placements.map((one) => [one.weekday, one.slotPosition])).toEqual([
      [2, 1],
    ]);
    expect(mathsRow?.published?.teacherName).toEqual(expect.any(String));
    // Art: only the published side moved it; history: only the published side has it.
    expect([art.changedBy, art.defaultPick]).toEqual(['published', 'published']);
    expect([history.changedBy, history.defaultPick]).toEqual(['published', 'published']);
    expect(history.rows[0]?.draft).toBeNull();

    const before = await rowsOf(x.branch);
    refusedWith(
      await upToDate(x.branch, x.d, shown.key, [
        { item: art.key, side: 'published' },
        { item: history.key, side: 'published' },
      ]),
      409,
      'up_to_date_pick_missing',
    );
    expect(await rowsOf(x.branch)).toEqual(before);

    versionOf(
      await upToDate(x.branch, x.d, shown.key, [
        { item: maths.key, side: 'draft' },
        { item: art.key, side: 'draft' },
        { item: history.key, side: 'published' },
      ]),
    );
    expect(await causesOf(x.d)).toEqual([]);
    expect(await fromOf(x.d)).toBe(x.e);
    const placed = (await placementsOf(x.d)).map((one) => [
      one.subject_id,
      one.weekday,
      one.slot_position,
    ]);
    expect(placed).toEqual(
      expect.arrayContaining([
        [x.maths, 2, 2],
        [x.art, 1, 2],
        [x.history, 3, 1],
      ]),
    );
    expect(placed).toHaveLength(3);
    // The draft's maths pin stays; the published history pin comes with its row.
    expect(await pinsOf(x.d)).toEqual(
      [
        [x.maths, 2, 2],
        [x.history, 3, 1],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    const [entry] = await t.entries('timetable_version.up_to_date', x.d);
    expect(entry).toMatchObject({
      old_value: { outOfDate: true, fromVersionId: x.s },
      new_value: {
        outOfDate: false,
        comparedVersionId: x.e,
        fromVersionId: x.e,
        picks: expect.arrayContaining([{ item: history.key, side: 'published' }]) as unknown,
        rows: { inserted: [expect.objectContaining({ subjectId: x.history })], removed: [] },
        blocks: { removed: [], added: [expect.objectContaining({ weekday: 3, slotPosition: 1 })] },
      },
    });
    const check = publishCheckSchema.parse(
      okay(await get(`/api/timetable/versions/${x.d}/publish-check?startsOn=2026-11-09`, x.branch))
        .body,
    );
    expect(check.refusals.map((one) => one.code)).not.toContain('draft_out_of_date');
    // The repeat finds no cause and answers the draft as it is (review correction 3).
    const count = await t.auditCount();
    versionOf(await upToDate(x.branch, x.d, shown.key, [{ item: maths.key, side: 'published' }]));
    expect(await t.auditCount()).toBe(count);
  });

  it('refuses picks that double-book the teacher, and changes nothing (decision 8)', async () => {
    const x = await scene();
    const shown = await shownOf(x.branch, x.d);
    const picks = (maths: 'draft' | 'published') => [
      { item: itemOf(shown, x.maths).key, side: maths },
      { item: itemOf(shown, x.art).key, side: 'published' as const },
      { item: itemOf(shown, x.history).key, side: 'published' as const },
    ];
    const before = await rowsOf(x.branch);
    const count = await t.auditCount();
    // The draft's maths on Tuesday 2 and the published art on Tuesday 2.
    const refused = await upToDate(x.branch, x.d, shown.key, picks('draft'));
    refusedWith(refused, 409, 'up_to_date_blocked');
    expect(
      (refused.body as { error: { details: { path: string }[] } }).error.details.map(
        (one) => one.path,
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/^pattern\./)]));
    expect(await rowsOf(x.branch)).toEqual(before);
    expect(await t.auditCount()).toBe(count);
    // A pick of an item not listed (permission review, should-fix 5).
    refusedWith(
      await upToDate(x.branch, x.d, shown.key, [
        ...picks('published'),
        { item: 'class-z||maths', side: 'draft' },
      ]),
      409,
      'out_of_date_changed',
    );
    expect(await rowsOf(x.branch)).toEqual(before);
    // The Academic Vice Principal of the branch takes the draft and
    // brings it up to date (permission review, should-fix 3).
    await roleIn(x.branch, 'academic_vice_principal');
    // The Super Admin's edit lock is let go, as after five minutes away.
    await t.database.migrator
      .updateTable('timetable_versions')
      .set({ edit_holder_id: null, edit_seen_at: null })
      .where('id', '=', x.d)
      .execute();
    versionOf(await upToDate(x.branch, x.d, shown.key, picks('published'), t.vicePrincipal));
    // The draft's maths pin went with its maths; the history pin came; the art
    // block's lock went with the block (0072 cascade).
    expect(await pinsOf(x.d)).toEqual([[x.history, 3, 1]]);
    expect(
      await t.database.migrator
        .selectFrom('timetable_locks')
        .select('id')
        .where('version_id', '=', x.d)
        .execute(),
    ).toEqual([]);
    expect(
      (await placementsOf(x.d)).map((one) => [one.subject_id, one.weekday, one.slot_position]),
    ).toEqual(
      expect.arrayContaining([
        [x.maths, 2, 1],
        [x.art, 2, 2],
      ]),
    );
    const [entry] = await t.entries('timetable_version.up_to_date', x.d);
    expect(entry).toMatchObject({
      new_value: {
        rows: { updated: [], inserted: [expect.objectContaining({ subjectId: x.history })] },
        pins: {
          removed: [expect.objectContaining({ weekday: 2, slotPosition: 2 })],
          added: [expect.objectContaining({ weekday: 3, slotPosition: 1 })],
        },
        blocks: {
          removed: expect.arrayContaining([
            expect.objectContaining({ weekday: 2, slotPosition: 2, locks: [] }),
            expect.objectContaining({ weekday: 1, slotPosition: 2, locks: [x.lockId] }),
          ]) as unknown,
        },
      },
    });
  });

  it('refuses a row taken whose subject was archived since (a load problem)', async () => {
    const x = await scene();
    const shown = await shownOf(x.branch, x.d);
    await t.database.migrator
      .updateTable('subjects')
      .set({ archived_at: t.clock.now() })
      .where('id', '=', x.history)
      .execute();
    const again = await shownOf(x.branch, x.d);
    const picks = again.items.map((one) => ({ item: one.key, side: 'published' as const }));
    const before = await rowsOf(x.branch);
    const refused = await upToDate(x.branch, x.d, again.key, picks);
    refusedWith(refused, 409, 'up_to_date_blocked');
    expect(
      (refused.body as { error: { details: { path: string }[] } }).error.details.map(
        (one) => one.path,
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/^loadRows\./)]));
    expect(await rowsOf(x.branch)).toEqual(before);
    expect(shown.items).toHaveLength(3);
  });

  it('takes a double from the published side with a pair id of the draft (spec review must-fix 2)', async () => {
    const x = await scene({ double: true });
    const shown = await shownOf(x.branch, x.d);
    const maths = itemOf(shown, x.maths);
    // An unplaced copy: the draft changed the item against its source.
    expect(maths.changedBy).toBe('both');
    expect(maths.rows[0]?.draft?.placements).toEqual([]);
    expect(maths.rows[0]?.published?.placements.map((one) => one.pairedWith !== null)).toEqual([
      true,
      true,
    ]);
    versionOf(
      await upToDate(
        x.branch,
        x.d,
        shown.key,
        shown.items.map((one) => ({ item: one.key, side: 'published' })),
      ),
    );
    const draftPairs = (await placementsOf(x.d))
      .filter((one) => one.subject_id === x.maths)
      .map((one) => one.double_pair_id);
    const publishedPairs = (await placementsOf(x.e))
      .filter((one) => one.subject_id === x.maths)
      .map((one) => one.double_pair_id);
    expect(draftPairs).toHaveLength(2);
    expect(draftPairs[0]).not.toBeNull();
    expect(draftPairs[1]).toBe(draftPairs[0]);
    expect(draftPairs[0]).not.toBe(publishedPairs[0]);
  });

  it('refuses a key after the holder changed the draft, with no cause added (spec review should-fix 2)', async () => {
    const x = await scene();
    const shown = await shownOf(x.branch, x.d);
    const block = await t.database.migrator
      .selectFrom('pattern_entries')
      .select('block_id')
      .where('load_row_id', '=', await rowOf(x.d, x.art))
      .executeTakeFirstOrThrow();
    okay(
      await post(`/api/timetable/versions/${x.d}/pattern/${block.block_id}/move`, x.branch, {
        weekday: 4,
        slotPosition: 1,
      }),
    );
    expect(await causesOf(x.d)).toHaveLength(1);
    refusedWith(
      await upToDate(
        x.branch,
        x.d,
        shown.key,
        shown.items.map((one) => ({ item: one.key, side: 'published' })),
      ),
      409,
      'out_of_date_changed',
    );
    expect(await causesOf(x.d)).toHaveLength(1);
  });

  describe('the version compared (decision 3)', () => {
    /** A branch and year with versions written directly: no rows, only starts and statuses. */
    async function versions() {
      const branch = await t.newBranch();
      const year = await load.classes.year(branch);
      const at = async (startsOn: string, status: 'draft' | 'published') => {
        const id = await load.version(branch, year, { startsOn });
        if (status === 'published') await load.setVersion(id, 'published');
        return id;
      };
      const cause = (version: string, record: string | null) =>
        t.database.migrator
          .insertInto('timetable_version_out_of_date_causes')
          .values({
            branch_id: branch,
            version_id: version,
            action: 'timetable_version.publish',
            record_id: record,
            caused_at: t.clock.now(),
          })
          .execute();
      return { branch, year, at, cause };
    }

    it('reads a draft whose start has passed on tomorrow (spec review must-fix 1)', async () => {
      const v = await versions();
      await v.at('2026-09-07', 'published');
      const tomorrow = await v.at(TOMORROW, 'published');
      const past = await v.at('2026-10-05', 'draft');
      await v.cause(past, tomorrow);
      expect((await shownOf(v.branch, past)).other?.id).toBe(tomorrow);
    });

    it('compares a draft marked before 0077 (no record) with the version in force, and clears a later version cause', async () => {
      const v = await versions();
      const first = await v.at('2026-09-07', 'published');
      const later = await v.at('2026-12-07', 'published');
      const marked = await v.at(NOVEMBER, 'draft');
      await v.cause(marked, null);
      await v.cause(marked, later);
      const shown = await shownOf(v.branch, marked);
      expect(shown.other?.id).toBe(first);
      expect(shown.causes.map((one) => one.record?.versionNumber ?? null)).toEqual([
        null,
        expect.any(Number),
      ]);
      versionOf(await upToDate(v.branch, marked, shown.key));
      expect(await causesOf(marked)).toEqual([]);
      expect(await fromOf(marked)).toBe(first);
    });

    it('takes the earliest published version when none is in force, and confirms only with none at all', async () => {
      const v = await versions();
      const lonely = await v.at(NOVEMBER, 'draft');
      await v.cause(lonely, null);
      const none = await shownOf(v.branch, lonely);
      expect([none.other, none.items]).toEqual([null, []]);
      versionOf(await upToDate(v.branch, lonely, none.key));
      expect(await causesOf(lonely)).toEqual([]);
      expect(await fromOf(lonely)).toBeNull();
      const december = await v.at('2026-12-07', 'published');
      await v.cause(lonely, december);
      expect((await shownOf(v.branch, lonely)).other?.id).toBe(december);
    });
  });

  it('lets a draft name a version that names it, and a later publish still marks it (decision 14)', async () => {
    const x = await scene();
    const shown = await shownOf(x.branch, x.d);
    versionOf(
      await upToDate(
        x.branch,
        x.d,
        shown.key,
        shown.items.map((one) => ({ item: one.key, side: 'published' })),
      ),
    );
    expect(await fromOf(x.d)).toBe(x.e);
    // X is copied from D and published; it marks D, whose sources do not hold it.
    const xCopy = await copy(x.branch, x.year, x.d, '2026-11-16');
    await place(x.branch, xCopy, await rowOf(xCopy, x.maths), 4, 1);
    await place(x.branch, xCopy, await rowOf(xCopy, x.art), 4, 2);
    await place(x.branch, xCopy, await rowOf(xCopy, x.history), 4, 4);
    await confirm(x.branch, xCopy);
    versionOf(await publish(x.branch, xCopy, '2026-11-16'));
    expect(await causesOf(x.d)).toEqual([
      { action: 'timetable_version.publish', record_id: xCopy },
    ]);
    // The fixture makes D name X, as a bring-up-to-date that compared D with
    // X writes: D and X then name each other.
    await t.database.migrator
      .updateTable('timetable_versions')
      .set({ from_version_id: xCopy })
      .where('id', '=', x.d)
      .execute();
    await t.database.migrator
      .deleteFrom('timetable_version_out_of_date_causes')
      .where('version_id', '=', x.d)
      .execute();
    expect(await fromOf(xCopy)).toBe(x.d);
    const y = await copy(x.branch, x.year, x.e, '2026-11-23');
    await place(x.branch, y, await rowOf(y, x.maths), 5, 1);
    await place(x.branch, y, await rowOf(y, x.art), 5, 2);
    await place(x.branch, y, await rowOf(y, x.history), 5, 4);
    await confirm(x.branch, y);
    versionOf(await publish(x.branch, y, '2026-11-23'));
    expect(await causesOf(x.d)).toEqual([{ action: 'timetable_version.publish', record_id: y }]);
  });

  it("answers 404 for another branch's and an unknown draft, with picks, and writes nothing", async () => {
    const x = await scene();
    const other = await scene();
    const shown = await shownOf(other.branch, other.d);
    const picks = shown.items.map((one) => ({ item: one.key, side: 'published' as const }));
    const before = [await rowsOf(x.branch), await rowsOf(other.branch)];
    const count = await t.auditCount();
    refusedWith(await upToDate(x.branch, other.d, shown.key, picks), 404, 'not_found');
    refusedWith(await upToDate(x.branch, UNKNOWN, shown.key, picks), 404, 'not_found');
    refusedWith(
      await get(`/api/timetable/versions/${other.d}/out-of-date`, x.branch),
      404,
      'not_found',
    );
    expect([await rowsOf(x.branch), await rowsOf(other.branch)]).toEqual(before);
    expect(await t.auditCount()).toBe(count);
    // The Principal reads the differences with their names and may not pick
    // (permission review, should-fix 4); the Teacher may do neither.
    await roleIn(other.branch, 'principal');
    const read = answerOf(
      await get(`/api/timetable/versions/${other.d}/out-of-date`, other.branch, t.principal),
    );
    expect(read.key).toBe(shown.key);
    expect(read.items[0]?.rows[0]?.unitName).toEqual(expect.any(String));
    refusedWith(
      await upToDate(other.branch, other.d, shown.key, picks, t.principal),
      403,
      'permission_denied',
    );
    refusedWith(
      await upToDate(other.branch, other.d, shown.key, picks, t.teacher),
      403,
      'permission_denied',
    );
    refusedWith(
      await get(`/api/timetable/versions/${other.d}/out-of-date`, other.branch, t.teacher),
      403,
      'permission_denied',
    );
    expect([await rowsOf(x.branch), await rowsOf(other.branch)]).toEqual(before);
    expect(await t.auditCount()).toBe(count);
  });

  // Decision 10: the publish lock first. A publish held on the lock with the
  // cause it writes: the bring-up-to-date waits, then sees the new cause.
  it('waits for a publish holding the publish lock, then refuses the key of the causes shown', async () => {
    const x = await scene();
    const shown = await shownOf(x.branch, x.d);
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = t.app
      .get(Transactions)
      .run([x.branch], async (transaction: Transaction) => {
        await sql`select pg_advisory_xact_lock(550001)`.execute(transaction);
        await transaction
          .insertInto('timetable_version_out_of_date_causes')
          .values({
            branch_id: x.branch,
            version_id: x.d,
            action: 'timetable_version.publish',
            record_id: x.s,
            caused_at: t.clock.now(),
          })
          .execute();
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await isReady;
    let answered: Response | null = null;
    const route = upToDate(
      x.branch,
      x.d,
      shown.key,
      shown.items.map((one) => ({ item: one.key, side: 'published' })),
    ).then((response) => {
      answered = response;
      return response;
    });
    await expect
      .poll(
        async () => {
          const found = await sql<{ n: number }>`
            select count(*)::int as n
            from pg_locks l join pg_stat_activity a on a.pid = l.pid
            where a.datname = current_database() and l.locktype = 'advisory' and not l.granted
          `.execute(t.database.migrator);
          return found.rows[0]?.n ?? 0;
        },
        { timeout: 20_000, interval: 25 },
      )
      .toBe(1);
    expect(answered).toBeNull();
    release();
    expect(await held).toBeUndefined();
    refusedWith(await route, 409, 'out_of_date_changed');
    expect(await causesOf(x.d)).toHaveLength(2);
  });
});
