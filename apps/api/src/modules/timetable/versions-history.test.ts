import {
  timetableHistorySchema,
  versionComparisonSchema,
  type TimetableHistory,
  type VersionComparison,
} from '@sodiq/shared';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  MONDAY,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

const historyOf = (response: Response): TimetableHistory => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return timetableHistorySchema.parse(response.body);
};

const comparisonOf = (response: Response): VersionComparison => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return versionComparisonSchema.parse(response.body);
};

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

// All names are invented. Task 5.8a, pull request #194: docs/spec/06-timetable.md,
// Protection: "Version history shows every version in the order of their
// start dates, names the version in force on the first day of each quarter,
// compares two versions, and can reopen an old one as a new draft"
// (decisions 2 to 4; the reopening is `copy-pattern.test.ts`).
describe('version history and comparison', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  /** A branch of its own with a year of four dated quarters. */
  async function yearScene() {
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
    return { branch, year };
  }

  const history = (branch: string, year: string, cookie = t.admin) =>
    t.get(`/api/timetable/history?academicYearId=${year}`, branch, cookie);

  describe('the history of a year', () => {
    it('lists every version by start date, then number, drafts and archived included', async () => {
      const s = await yearScene();
      const late = await load.version(s.branch, s.year, { startsOn: '2027-01-11' });
      const early = await load.version(s.branch, s.year, {
        startsOn: MONDAY,
        status: 'published',
      });
      const tie = await load.version(s.branch, s.year, {
        startsOn: MONDAY,
        status: 'archived',
      });
      const answer = historyOf(await history(s.branch, s.year));
      expect(answer.versions.map((one) => [one.id, one.status])).toEqual([
        [early, 'published'],
        [tie, 'archived'],
        [late, 'draft'],
      ]);
    });

    it('names the published version in force on the first day of each quarter', async () => {
      const s = await yearScene();
      const a = await load.version(s.branch, s.year, { startsOn: MONDAY, status: 'published' });
      // Published from the middle of quarter 2: quarter 3 is the first it starts by.
      const b = await load.version(s.branch, s.year, {
        startsOn: '2026-11-16',
        status: 'published',
      });
      // On quarter 4's first day, with the highest number: a draft and a withdrawn
      // (archived) version, each with every other value that would name it.
      await load.version(s.branch, s.year, { startsOn: '2027-03-30', status: 'archived' });
      await load.version(s.branch, s.year, { startsOn: '2027-03-30' });
      const answer = historyOf(await history(s.branch, s.year));
      const numberOf = (id: string) => answer.versions.find((one) => one.id === id)?.number;
      expect(answer.quarters).toEqual([
        { number: 1, startsOn: '2026-09-01', version: null },
        { number: 2, startsOn: '2026-11-09', version: { id: a, number: numberOf(a) } },
        { number: 3, startsOn: '2027-01-11', version: { id: b, number: numberOf(b) } },
        { number: 4, startsOn: '2027-03-30', version: { id: b, number: numberOf(b) } },
      ]);
    });

    it('leaves out a quarter with no dates', async () => {
      const s = await yearScene();
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: null, end_date: null })
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 4)
        .execute();
      const answer = historyOf(await history(s.branch, s.year));
      expect(answer.quarters.map((one) => one.number)).toEqual([1, 2, 3]);
    });

    it("answers 404 for another branch's year and an unknown one", async () => {
      const s = await yearScene();
      const other = await yearScene();
      await load.version(other.branch, other.year, { startsOn: MONDAY, status: 'published' });
      refusedWith(await history(s.branch, other.year), 404, 'not_found');
      refusedWith(await history(s.branch, UNKNOWN), 404, 'not_found');
    });

    it('is read by the Principal, refused to a Teacher', async () => {
      const s = await yearScene();
      await load.version(s.branch, s.year, { startsOn: MONDAY, status: 'published' });
      // The kit's accounts hold their roles in the kit's branch.
      const north = await t.database.migrator
        .selectFrom('academic_years')
        .select('id')
        .where('branch_id', '=', t.north)
        .executeTakeFirst();
      const year = north?.id ?? (await load.classes.year(t.north));
      historyOf(await history(t.north, year, t.principal));
      refusedWith(await history(t.north, year, t.teacher), 403, 'permission_denied');
    });
  });

  describe('two versions compared', () => {
    /**
     * Version A with maths placed on Monday 1 in room R, and B with the
     * same row under another teacher, placed on Tuesday 3, and Art added.
     */
    async function compareScene() {
      const s = await yearScene();
      const classId = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      const maths = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const art = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const first = await load.teacher(s.branch, { subjects: [{ subject: maths, grades: [7] }] });
      const second = await load.teacher(s.branch, { subjects: [{ subject: maths, grades: [7] }] });
      const artist = await load.teacher(s.branch, { subjects: [{ subject: art, grades: [7] }] });
      const room = await load.classes.room(s.branch);
      const a = await load.version(s.branch, s.year, { startsOn: MONDAY, status: 'draft' });
      const b = await load.version(s.branch, s.year, { startsOn: '2026-11-09', from: a });
      const rowOf = (version: string, subject: string, teacher: string) =>
        load.row({
          branch_id: s.branch,
          version_id: version,
          class_id: classId,
          subject_id: subject,
          teacher_id: teacher,
          lessons_per_week: 1,
        });
      const placeRow = async (
        version: string,
        row: string,
        teacher: string,
        weekday: number,
        slot: number,
        start: number,
      ) => {
        const block = await t.database.migrator
          .insertInto('pattern_blocks')
          .values({
            branch_id: s.branch,
            version_id: version,
            weekday,
            slot_position: slot,
            start_minutes: start,
            end_minutes: start + 45,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await t.database.migrator
          .insertInto('pattern_entries')
          .values({
            branch_id: s.branch,
            version_id: version,
            block_id: block.id,
            weekday,
            start_minutes: start,
            end_minutes: start + 45,
            load_row_id: row,
            teacher_id: teacher,
            room_id: room,
          })
          .execute();
      };
      await placeRow(a, await rowOf(a, maths, first.staffId), first.staffId, 1, 1, 480);
      await placeRow(b, await rowOf(b, maths, second.staffId), second.staffId, 2, 3, 535);
      await rowOf(b, art, artist.staffId);
      return { ...s, classId, maths, art, first, second, artist, room, a, b };
    }

    const compare = (branch: string, id: string, other: string, cookie = t.admin) =>
      t.get(`/api/timetable/versions/${id}/compare?with=${other}`, branch, cookie);

    it('lists the rows and placements that differ, with the rows and rooms named', async () => {
      const s = await compareScene();
      const answer = comparisonOf(await compare(s.branch, s.a, s.b));
      expect([answer.before.id, answer.after.id]).toEqual([s.a, s.b]);
      const unit = { classId: s.classId, groupId: null };
      expect(answer.differences).toEqual([
        {
          kind: 'teacher',
          ...unit,
          subjectId: s.maths,
          before: s.first.staffId,
          after: s.second.staffId,
          tutorRow: false,
        },
        {
          kind: 'row_added',
          ...unit,
          subjectId: s.art,
          teacherId: s.artist.staffId,
          lessonsPerWeek: 1,
        },
        {
          kind: 'placement_added',
          ...unit,
          subjectId: s.maths,
          weekday: 2,
          slotPosition: 3,
          roomId: s.room,
        },
        {
          kind: 'placement_removed',
          ...unit,
          subjectId: s.maths,
          weekday: 1,
          slotPosition: 1,
          roomId: s.room,
        },
      ]);
      expect(answer.rows).toHaveLength(3);
      expect(answer.rooms.map((one) => one.id)).toEqual([s.room]);
      // Nothing written by a read.
      expect(await t.entries('timetable_version.compare')).toEqual([]);
    });

    it('finds nothing between a version and itself', async () => {
      const s = await compareScene();
      expect(comparisonOf(await compare(s.branch, s.a, s.a)).differences).toEqual([]);
    });

    it('refuses two versions of different years', async () => {
      const s = await compareScene();
      const next = await load.classes.year(s.branch, 'planned', '2027-09-01', '2028-05-31');
      const other = await load.version(s.branch, next, { startsOn: '2027-09-06' });
      refusedWith(await compare(s.branch, s.a, other), 422, 'version_compare_year');
    });

    it("answers 404 for another branch's and an unknown version, in the path and in `with`", async () => {
      const s = await compareScene();
      const elsewhere = await compareScene();
      for (const [id, other] of [
        [elsewhere.a, s.b],
        [UNKNOWN, s.b],
        [s.a, elsewhere.b],
        [s.a, UNKNOWN],
      ] as const) {
        refusedWith(await compare(s.branch, id, other), 404, 'not_found');
      }
    });
  });
});
