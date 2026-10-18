import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  listName,
  REQUEST_KEY_HEADER,
  outOfDateAnswerSchema,
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
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { Audit } from '../audit/audit.service.js';
import { markDraftsOutOfDate } from './out-of-date.js';

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

/** A Monday of the planned year 2027-09-01 to 2028-05-31. */
const NEXT_YEAR_MONDAY = '2027-09-06';

/** A day off on one date of the current year, in the future of the kit's clock. */
const DAY_OFF = {
  kind: 'day_off',
  name: 'Teachers day',
  firstDate: '2026-11-04',
  lastDate: '2026-11-04',
  gradeFrom: null,
  gradeTo: null,
  dayTemplateId: null,
  followsWeekday: null,
  examWeek: null,
} as const;

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

// All names are invented. Task 5.5a-3b-1, pull request #146: out-of-date
// drafts (docs/spec/06-timetable.md, How surprises are prevented: "Out-of-date
// draft. If the live timetable changed after a draft was started, the draft
// must be brought up to date before publishing; the differences are shown";
// edge/timetable, Versions and drafts: "Any publish, or any change to
// templates, calendar, availability or rooms, marks the other drafts out of
// date"). The clock stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('out-of-date drafts', () => {
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
  const put = (path: string, branch: string, body: object, cookie = t.admin) =>
    t.put(path, branch, body, cookie);
  const patch = (path: string, branch: string, body: object, cookie = t.admin) =>
    t.patch(path, branch, body, cookie);

  const causesRoute = (branch: string, version: string, cookie = t.admin) =>
    get(`/api/timetable/versions/${version}/out-of-date`, branch, cookie);
  const upToDate = (branch: string, version: string, key: string, cookie = t.admin) =>
    post(`/api/timetable/versions/${version}/up-to-date`, branch, { key }, cookie);

  /** The causes of a version as stored, oldest first. */
  const causesOf = (id: string) =>
    t.database.migrator
      .selectFrom('timetable_version_out_of_date_causes')
      .select(['action', 'record_id'])
      .where('version_id', '=', id)
      .orderBy('caused_at')
      .orderBy('id')
      .execute();

  /** The rows a bring-up-to-date writes, in a branch: what a refused one must leave. */
  const rowsOf = async (branch: string) => ({
    causes: await t.database.migrator
      .selectFrom('timetable_version_out_of_date_causes')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute(),
    versions: await t.database.migrator
      .selectFrom('timetable_versions')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute(),
  });

  const draft = async (
    branch: string,
    year: string,
    copyFrom: string | null = null,
    startsOn: string = MONDAY,
  ) => {
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn,
      copyFrom,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return (created.body as { id: string }).id;
  };

  const dayOff = async (branch: string, body: object = DAY_OFF) => {
    const created = okay(await post('/api/setup/calendar-entries', branch, body));
    return (created.body as { id: string }).id;
  };

  /** A branch with a current year and a draft of it. */
  async function scene() {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    const version = await draft(branch, year);
    return { branch, year, version };
  }

  /** The room of a branch as its edit sends it back. */
  const roomRecord = async (room: string) => {
    const row = await t.database.migrator
      .selectFrom('rooms')
      .selectAll()
      .where('id', '=', room)
      .executeTakeFirstOrThrow();
    return {
      name: row.name,
      floorId: row.floor_id,
      type: row.type,
      capacity: row.capacity,
      status: row.status,
      shared: row.shared,
      maxSimultaneousLessons: row.max_simultaneous_lessons,
    };
  };

  /** A draft brought up to date with the key of its causes. */
  const bringUp = async (branch: string, version: string) => {
    const shown = answerOf(await causesRoute(branch, version));
    return versionOf(await upToDate(branch, version, shown.key));
  };

  /** The draft's edit lock taken by the kit's Super Admin, with a write of its start date. */
  const takeEditLock = async (branch: string, version: string) =>
    versionOf(
      await patch(`/api/timetable/versions/${version}`, branch, { startsOn: '2026-10-19' }),
    );

  /** A room edit that changes its capacity: a change the timetable reads. */
  const widenRoom = async (branch: string, room: string, capacity = 31) =>
    okay(await put(`/api/setup/rooms/${room}`, branch, { ...(await roomRecord(room)), capacity }));

  describe('the marks', () => {
    it('marks an open draft of the year a new day off falls in, and nothing else', async () => {
      const branch = await t.newBranch();
      const pastYear = await load.classes.year(branch, 'current', '2025-09-01', '2026-05-31');
      const closed = await load.version(branch, pastYear, { startsOn: '2025-09-08' });
      await load.classes.setYear(pastYear, 'closed');
      const year = await load.classes.year(branch);
      const s = { branch, year, version: await draft(branch, year) };
      const nextYear = await load.classes.year(s.branch, 'planned', '2027-09-01', '2028-05-31');
      const otherYear = await draft(s.branch, nextYear, null, NEXT_YEAR_MONDAY);
      const published = await load.version(s.branch, s.year);
      await load.setVersion(published, 'published');
      const elsewhere = await scene();
      const entry = await dayOff(s.branch);
      expect(await causesOf(s.version)).toEqual([
        { action: 'calendar_entry.create', record_id: entry },
      ]);
      for (const left of [otherYear, published, closed, elsewhere.version]) {
        expect(await causesOf(left)).toEqual([]);
      }
      const [audit] = await t.entries('timetable_version.out_of_date', s.version);
      expect(audit).toMatchObject({
        branch_id: s.branch,
        old_value: { outOfDate: false },
        new_value: { outOfDate: true, action: 'calendar_entry.create', recordId: entry },
      });
      const list = (await get('/api/timetable/versions', s.branch)).body as {
        versions: TimetableVersion[];
      };
      expect(list.versions.find((one) => one.id === s.version)?.outOfDate).toBe(true);
      expect(list.versions.find((one) => one.id === otherYear)?.outOfDate).toBe(false);
      // A room edit touches every year: the planned one too, never the closed one.
      const room = await load.classes.room(s.branch);
      await widenRoom(s.branch, room);
      expect(await causesOf(otherYear)).toEqual([{ action: 'room.edit', record_id: room }]);
      expect(await causesOf(closed)).toEqual([]);
      expect(await causesOf(published)).toEqual([]);
    });

    it('adds a cause for each further change and keeps the first', async () => {
      const s = await scene();
      const entry = await dayOff(s.branch);
      okay(await post(`/api/setup/calendar-entries/${entry}/archive`, s.branch));
      okay(await post(`/api/setup/calendar-entries/${entry}/restore`, s.branch));
      expect(await causesOf(s.version)).toEqual([
        { action: 'calendar_entry.create', record_id: entry },
        { action: 'calendar_entry.archive', record_id: entry },
        { action: 'calendar_entry.restore', record_id: entry },
      ]);
      const entries = await t.entries('timetable_version.out_of_date', s.version);
      expect(entries.map((one) => (one.old_value as { outOfDate: boolean }).outOfDate)).toEqual([
        false,
        true,
        true,
      ]);
    });

    it('marks the years of both the old and the new dates of an edit, and not for a new name alone', async () => {
      const s = await scene();
      const nextYear = await load.classes.year(s.branch, 'planned', '2027-09-01', '2028-05-31');
      const later = await draft(s.branch, nextYear, null, NEXT_YEAR_MONDAY);
      const entry = await dayOff(s.branch);
      okay(
        await patch(`/api/setup/calendar-entries/${entry}`, s.branch, {
          ...DAY_OFF,
          name: 'Day of rest',
        }),
      );
      expect(await causesOf(s.version)).toHaveLength(1);
      expect(await causesOf(later)).toEqual([]);
      okay(
        await patch(`/api/setup/calendar-entries/${entry}`, s.branch, {
          ...DAY_OFF,
          name: 'Day of rest',
          firstDate: '2027-10-06',
          lastDate: '2027-10-06',
        }),
      );
      expect(await causesOf(s.version)).toEqual([
        { action: 'calendar_entry.create', record_id: entry },
        { action: 'calendar_entry.edit', record_id: entry },
      ]);
      expect(await causesOf(later)).toEqual([{ action: 'calendar_entry.edit', record_id: entry }]);
    });

    it('marks for a slot length, a template version and a template set or ended, never for a new name', async () => {
      const s = await scene();
      const lesson = await t.createSlotType(s.branch, 'Lesson', 'lesson', 45);
      const regular = await t.createTemplate(s.branch, 'Regular', [lesson]);
      const short = await t.createTemplate(s.branch, 'Short', [lesson]);
      expect(await causesOf(s.version)).toEqual([]);
      okay(await patch(`/api/setup/slot-types/${lesson}`, s.branch, { name: 'Period' }));
      okay(await patch(`/api/setup/day-templates/${regular}`, s.branch, { name: 'Usual' }));
      expect(await causesOf(s.version)).toEqual([]);
      const setting = await t.assign(s.branch, regular);
      okay(
        await post(`/api/setup/slot-types/${lesson}/lengths`, s.branch, {
          lengthMinutes: 40,
          from: '2026-11-02',
        }),
      );
      okay(
        await post(`/api/setup/day-templates/${regular}/versions`, s.branch, {
          from: '2026-11-02',
          startTime: '08:30',
          slotTypeIds: [lesson],
        }),
      );
      const friday = await t.assign(s.branch, short, { level: 'weekday', weekday: 5 });
      okay(
        await post(`/api/setup/day-template-assignments/${friday}/end`, s.branch, {
          from: '2026-12-01',
        }),
      );
      expect(await causesOf(s.version)).toEqual([
        { action: 'day_template_assignment.set', record_id: setting },
        { action: 'slot_type.length_change', record_id: lesson },
        { action: 'day_template.version_create', record_id: regular },
        { action: 'day_template_assignment.set', record_id: friday },
        { action: 'day_template_assignment.end', record_id: friday },
      ]);
    });

    it('marks the drafts of the branch for new hours of a teacher', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const teacher = (await load.teacher(s.branch)).staffId;
      okay(
        await put(`/api/people/staff/${teacher}/availability`, s.branch, {
          from: '2026-11-02',
          ranges: [{ weekday: 1, start: '08:00', end: '13:00' }],
        }),
      );
      expect(await causesOf(s.version)).toEqual([
        { action: 'staff.availability_set', record_id: teacher },
      ]);
      expect(await causesOf(elsewhere.version)).toEqual([]);
    });

    it('marks the drafts of a branch removed from a teacher, not those of the branch of the request', async () => {
      const a = await scene();
      const b = await scene();
      const teacher = (await load.teacher(a.branch, { further: [b.branch] })).staffId;
      const entry = await t.database.migrator
        .insertInto('staff_availability')
        .values({ branch_id: b.branch, staff_id: teacher, valid_from: '2026-09-01' })
        .returning('id')
        .executeTakeFirstOrThrow();
      expect(entry.id).toBeTypeOf('string');
      okay(
        await put(`/api/people/staff/${teacher}/branches`, a.branch, {
          mainBranchId: a.branch,
          furtherBranchIds: [],
        }),
      );
      expect(await causesOf(b.version)).toEqual([
        { action: 'staff.availability_end', record_id: teacher },
      ]);
      expect(await causesOf(a.version)).toEqual([]);
      const [audit] = await t.entries('timetable_version.out_of_date', b.version);
      expect(audit).toMatchObject({ branch_id: b.branch });
      // Review round 1, second opinion: the teacher is no longer seen from B, so the
      // record is null there and the panel names a teacher who left the branch.
      const listed = answerOf(await causesRoute(b.branch, b.version));
      expect(listed.causes.map((one) => [one.kind, one.record])).toEqual([['availability', null]]);
    });

    it('marks for a room capacity, not for a new room name', async () => {
      const s = await scene();
      const room = await load.classes.room(s.branch);
      okay(
        await put(`/api/setup/rooms/${room}`, s.branch, {
          ...(await roomRecord(room)),
          name: 'Hall B',
        }),
      );
      expect(await causesOf(s.version)).toEqual([]);
      await widenRoom(s.branch, room);
      expect(await causesOf(s.version)).toEqual([{ action: 'room.edit', record_id: room }]);
    });
  });

  describe('publish and copy', () => {
    it('carries the causes of a draft into its copy, none of a published version', async () => {
      const s = await scene();
      const room = await load.classes.room(s.branch);
      await widenRoom(s.branch, room);
      const copy = await draft(s.branch, s.year, s.version);
      expect(await causesOf(copy)).toEqual([{ action: 'room.edit', record_id: room }]);
      // Review correction 2: a cause left on a version published at the same moment.
      const published = await load.version(s.branch, s.year);
      await t.database.migrator
        .insertInto('timetable_version_out_of_date_causes')
        .values({
          branch_id: s.branch,
          version_id: published,
          action: 'room.edit',
          record_id: room,
          caused_at: t.clock.now(),
        })
        .execute();
      await load.setVersion(published, 'published');
      const restored = await draft(s.branch, s.year, published);
      expect(await causesOf(restored)).toEqual([]);
      expect(answerOf(await causesRoute(s.branch, published)).causes).toEqual([]);
    });

    it('adds the cause of a publish to a draft a setup change already marked, which then waits for 5.5a-3b-2', async () => {
      const p = await publishable();
      const sibling = await draft(p.branch, p.year);
      await widenRoom(p.branch, p.room);
      await bringUp(p.branch, p.version);
      versionOf(await publish(p.branch, p.version));
      expect(await causesOf(sibling)).toEqual([
        { action: 'room.edit', record_id: p.room },
        { action: 'timetable_version.publish', record_id: p.version },
      ]);
      const entries = await t.entries('timetable_version.out_of_date', sibling);
      expect(entries[1]).toMatchObject({
        old_value: { outOfDate: true },
        new_value: { outOfDate: true, publishedId: p.version },
      });
      const shown = answerOf(await causesRoute(p.branch, sibling));
      refusedWith(
        await upToDate(p.branch, sibling, shown.key),
        409,
        'draft_out_of_date_by_publish',
      );
      expect(await causesOf(sibling)).toHaveLength(2);
    });
  });

  describe('the routes', () => {
    it('lists the causes oldest first with their records, a record gone as null', async () => {
      const s = await scene();
      const room = await load.classes.room(s.branch);
      await widenRoom(s.branch, room);
      const entry = await dayOff(s.branch);
      const teacher = (await load.teacher(s.branch)).staffId;
      okay(
        await put(`/api/people/staff/${teacher}/availability`, s.branch, {
          from: '2026-11-02',
          ranges: [{ weekday: 1, start: '08:00', end: '13:00' }],
        }),
      );
      await t.database.migrator
        .insertInto('timetable_version_out_of_date_causes')
        .values([
          {
            branch_id: s.branch,
            version_id: s.version,
            action: 'room.edit',
            record_id: UNKNOWN,
            caused_at: t.clock.now(),
          },
          {
            branch_id: s.branch,
            version_id: s.version,
            action: 'timetable_version.publish',
            record_id: null,
            caused_at: t.clock.now(),
          },
        ])
        .execute();
      const answer = answerOf(await causesRoute(s.branch, s.version));
      const roomName = (await roomRecord(room)).name;
      const person = await t.database.migrator
        .selectFrom('staff')
        .select(['first_name', 'last_name'])
        .where('id', '=', teacher)
        .executeTakeFirstOrThrow();
      const teacherName = listName({
        firstName: person.first_name ?? '',
        lastName: person.last_name ?? '',
      });
      expect(answer.causes.map((one) => [one.kind, one.action, one.record])).toEqual([
        [
          'rooms',
          'room.edit',
          {
            id: room,
            name: roomName,
            firstDate: null,
            lastDate: null,
            versionNumber: null,
          },
        ],
        [
          'calendar',
          'calendar_entry.create',
          {
            id: entry,
            name: 'Teachers day',
            firstDate: '2026-11-04',
            lastDate: '2026-11-04',
            versionNumber: null,
          },
        ],
        [
          'availability',
          'staff.availability_set',
          {
            id: teacher,
            name: teacherName,
            firstDate: null,
            lastDate: null,
            versionNumber: null,
          },
        ],
        ['rooms', 'room.edit', null],
        ['publish', 'timetable_version.publish', null],
      ]);
    });

    it('brings a draft up to date with the key shown, after which it publishes', async () => {
      const p = await publishable();
      await widenRoom(p.branch, p.room);
      await load.freeEditLock(p.version);
      const before = answerOf(await causesRoute(p.branch, p.version));
      expect(before.causes).toHaveLength(1);
      const answer = versionOf(await upToDate(p.branch, p.version, before.key));
      expect(answer.outOfDate).toBe(false);
      expect(await causesOf(p.version)).toEqual([]);
      const [audit] = await t.entries('timetable_version.up_to_date', p.version);
      expect(audit).toMatchObject({
        old_value: {
          outOfDate: true,
          causes: [{ id: before.causes[0]?.id, action: 'room.edit', recordId: p.room }],
        },
        new_value: { outOfDate: false },
      });
      expect(answerOf(await causesRoute(p.branch, p.version)).causes).toEqual([]);
      versionOf(await publish(p.branch, p.version));
    });

    it('refuses a key of other causes, and keeps them', async () => {
      const s = await scene();
      const room = await load.classes.room(s.branch);
      await widenRoom(s.branch, room);
      const shown = answerOf(await causesRoute(s.branch, s.version));
      await widenRoom(s.branch, room, 32);
      refusedWith(await upToDate(s.branch, s.version, shown.key), 409, 'out_of_date_changed');
      expect(await causesOf(s.version)).toHaveLength(2);
    });

    it('refuses while another account edits the draft, and a version that is not a draft', async () => {
      const s = await scene();
      const room = await load.classes.room(s.branch);
      await widenRoom(s.branch, room);
      await load.classes.role(
        (
          await t.database.migrator
            .selectFrom('assignments')
            .select('account_id')
            .where('id', '=', t.viceAssignment)
            .executeTakeFirstOrThrow()
        ).account_id,
        s.branch,
        'academic_vice_principal',
      );
      await takeEditLock(s.branch, s.version);
      const shown = answerOf(await causesRoute(s.branch, s.version));
      refusedWith(
        await upToDate(s.branch, s.version, shown.key, t.vicePrincipal),
        409,
        'draft_edit_locked',
      );
      expect(await causesOf(s.version)).toHaveLength(1);
      const published = await load.version(s.branch, s.year);
      await t.database.migrator
        .insertInto('timetable_version_out_of_date_causes')
        .values({
          branch_id: s.branch,
          version_id: published,
          action: 'room.edit',
          record_id: room,
          caused_at: t.clock.now(),
        })
        .execute();
      await load.setVersion(published, 'published');
      refusedWith(await upToDate(s.branch, published, shown.key), 409, 'version_not_draft');
    });

    it('lets the Academic Vice Principal bring a draft up to date (permission review, should-fix 1)', async () => {
      const s = await scene();
      await widenRoom(s.branch, await load.classes.room(s.branch));
      await load.classes.role(
        (
          await t.database.migrator
            .selectFrom('assignments')
            .select('account_id')
            .where('id', '=', t.viceAssignment)
            .executeTakeFirstOrThrow()
        ).account_id,
        s.branch,
        'academic_vice_principal',
      );
      await load.freeEditLock(s.version);
      const shown = answerOf(await causesRoute(s.branch, s.version, t.vicePrincipal));
      expect(
        versionOf(await upToDate(s.branch, s.version, shown.key, t.vicePrincipal)).outOfDate,
      ).toBe(false);
      expect(await causesOf(s.version)).toEqual([]);
      const [audit] = await t.entries('timetable_version.up_to_date', s.version);
      expect(audit).toMatchObject({ branch_id: s.branch, new_value: { outOfDate: false } });
    });

    it('answers a draft that is up to date as it is and writes nothing', async () => {
      const s = await scene();
      const shown = answerOf(await causesRoute(s.branch, s.version));
      const rows = await rowsOf(s.branch);
      const count = await t.auditCount();
      expect(versionOf(await upToDate(s.branch, s.version, shown.key)).outOfDate).toBe(false);
      expect(await rowsOf(s.branch)).toEqual(rows);
      expect(await t.auditCount()).toBe(count);
    });
  });

  describe('who may', () => {
    it('answers 404 for a version of another branch or an unknown one, and changes nothing', async () => {
      const s = await scene();
      const other = await scene();
      for (const one of [s, other]) {
        await widenRoom(one.branch, await load.classes.room(one.branch));
      }
      const key = answerOf(await causesRoute(other.branch, other.version)).key;
      const rows = [await rowsOf(s.branch), await rowsOf(other.branch)];
      const count = await t.auditCount();
      for (const id of [other.version, UNKNOWN]) {
        refusedWith(await causesRoute(s.branch, id), 404, 'not_found');
        refusedWith(await upToDate(s.branch, id, key), 404, 'not_found');
      }
      expect([await rowsOf(s.branch), await rowsOf(other.branch)]).toEqual(rows);
      expect(await t.auditCount()).toBe(count);
    });

    it('lets the Principal read the causes but not clear them, and the Teacher do neither', async () => {
      const room = await load.classes.room(t.north);
      const year =
        (
          await t.database.migrator
            .selectFrom('academic_years')
            .select('id')
            .where('branch_id', '=', t.north)
            .where('status', '=', 'current')
            .executeTakeFirst()
        )?.id ?? (await load.classes.year(t.north));
      const version = await draft(t.north, year);
      await widenRoom(t.north, room);
      const key = answerOf(await causesRoute(t.north, version, t.principal)).key;
      const rows = await rowsOf(t.north);
      const count = await t.auditCount();
      refusedWith(await upToDate(t.north, version, key, t.principal), 403, 'permission_denied');
      refusedWith(await causesRoute(t.north, version, t.teacher), 403, 'permission_denied');
      refusedWith(await upToDate(t.north, version, key, t.teacher), 403, 'permission_denied');
      expect(await rowsOf(t.north)).toEqual(rows);
      expect(await t.auditCount()).toBe(count);
    });
  });

  // review correction 1: a setup writer holds its branch, room or staff row
  // `for update`; a draft write's foreign keys take `for key share` on them, so
  // one waits for the other, but never on a version or a cause row (decision
  // 8), and both commit with no deadlock.
  describe('at the same moment', () => {
    /** A transaction of the application that runs `first`, waits until let go, runs `then` and commits. */
    async function holdOpen(
      branches: string[],
      first: (transaction: Transaction) => Promise<void>,
    ) {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const done = t.app
        .get(Transactions)
        .run(branches, async (transaction) => {
          await first(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await Promise.race([isReady, done]);
      return { release, done };
    }

    /** The sessions of the test database waiting for a lock. */
    async function waiting(): Promise<number> {
      const found = await sql<{ n: number }>`
        select count(distinct l.pid)::int as n
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.n ?? 0;
    }

    /** The row locks waited for on a version or a cause (a tuple lock exists only while one waits). */
    async function versionWaits(): Promise<number> {
      const found = await sql<{ n: number }>`
        select count(*)::int as n
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and l.locktype = 'tuple'
          and l.relation in (
            'timetable_versions'::regclass,
            'timetable_version_out_of_date_causes'::regclass
          )
      `.execute(t.database.migrator);
      return found.rows[0]?.n ?? 0;
    }

    /**
     * The held side, then the real route: the route waits, or answers at once;
     * while the held side is open, nothing waits on a version or a cause; then
     * both commit with no 40P01.
     */
    async function pair(
      branch: string,
      held: (transaction: Transaction) => Promise<void>,
      real: () => Promise<Response>,
    ): Promise<Response> {
      const gate = await holdOpen([branch], held);
      let answered: Response | null = null;
      const route = real().then((response) => {
        answered = response;
        return response;
      });
      await expect
        .poll(async () => answered !== null || (await waiting()) >= 1, {
          timeout: 20_000,
          interval: 25,
        })
        .toBe(true);
      expect(await versionWaits()).toBe(0);
      gate.release();
      expect(await gate.done).toBeUndefined();
      return okay(await route);
    }

    const audit = () => t.app.get(Audit);

    /** What a calendar create writes: the branch for update, the entry, its audit entry and the marks. */
    const heldCalendar =
      (branch: string, date = '2026-11-11') =>
      async (transaction: Transaction) => {
        await transaction
          .selectFrom('branches')
          .select('id')
          .where('id', '=', branch)
          .forUpdate()
          .execute();
        const entry = await transaction
          .insertInto('calendar_entries')
          .values({
            branch_id: branch,
            kind: 'day_off',
            name: 'Sports day',
            first_date: date,
            last_date: date,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await audit().record(transaction, {
          branchId: branch,
          actorId: null,
          action: 'calendar_entry.create',
          record: { type: 'calendar_entry', id: entry.id },
        });
        await markDraftsOutOfDate(transaction, audit(), {
          branchId: branch,
          action: 'calendar_entry.create',
          recordId: entry.id,
          dates: [{ from: date, until: date }],
          actorId: null,
        });
      };

    /**
     * What a draft write writes: the year for share, the version for no key
     * update, the edit lock, the rows its pattern entry names for key share
     * (a room, a teacher), and its audit entry.
     */
    const heldDraftWrite =
      (
        branch: string,
        year: string,
        version: string,
        names: { room?: string; staff?: string } = {},
      ) =>
      async (transaction: Transaction) => {
        await transaction
          .selectFrom('academic_years')
          .select('id')
          .where('id', '=', year)
          .forShare()
          .execute();
        await transaction
          .selectFrom('timetable_versions')
          .select('id')
          .where('id', '=', version)
          .forNoKeyUpdate()
          .execute();
        await transaction
          .updateTable('timetable_versions')
          .set({ starts_on: '2026-10-19' })
          .where('id', '=', version)
          .execute();
        if (names.room !== undefined) {
          await transaction
            .selectFrom('rooms')
            .select('id')
            .where('id', '=', names.room)
            .forKeyShare()
            .execute();
        }
        if (names.staff !== undefined) {
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', names.staff)
            .forKeyShare()
            .execute();
        }
        await audit().record(transaction, {
          branchId: branch,
          actorId: null,
          action: 'timetable_version.edit',
          record: { type: 'timetable_version', id: version },
        });
      };

    it('keeps a cause added while a bring-up-to-date runs, in either order', async () => {
      // The calendar change held: the real route reads and deletes the old
      // cause, waits on the branch for its audit entry, and commits after it.
      {
        const s = await scene();
        await widenRoom(s.branch, await load.classes.room(s.branch));
        // The Super Admin already holds the edit lock, so its take writes no
        // audit entry and the route first waits for the one of the bring-up.
        await takeEditLock(s.branch, s.version);
        const shown = answerOf(await causesRoute(s.branch, s.version));
        versionOf(
          await pair(s.branch, heldCalendar(s.branch), () =>
            upToDate(s.branch, s.version, shown.key),
          ),
        );
        expect((await causesOf(s.version)).map((one) => one.action)).toEqual([
          'calendar_entry.create',
        ]);
      }
      // The bring-up-to-date held: the real calendar route waits on the branch
      // and adds its cause after the old one is gone.
      {
        const s = await scene();
        const room = await load.classes.room(s.branch);
        await widenRoom(s.branch, room);
        const stored = await t.database.migrator
          .selectFrom('timetable_version_out_of_date_causes')
          .select('id')
          .where('version_id', '=', s.version)
          .execute();
        await pair(
          s.branch,
          async (transaction) => {
            await transaction
              .selectFrom('timetable_versions')
              .select('id')
              .where('id', '=', s.version)
              .forNoKeyUpdate()
              .execute();
            await transaction
              .deleteFrom('timetable_version_out_of_date_causes')
              .where(
                'id',
                'in',
                stored.map((one) => one.id),
              )
              .execute();
            await audit().record(transaction, {
              branchId: s.branch,
              actorId: null,
              action: 'timetable_version.up_to_date',
              record: { type: 'timetable_version', id: s.version },
            });
          },
          () => post('/api/setup/calendar-entries', s.branch, DAY_OFF),
        );
        expect((await causesOf(s.version)).map((one) => one.action)).toEqual([
          'calendar_entry.create',
        ]);
      }
    });

    it('refuses a bring-up-to-date over causes that changed before it read them', async () => {
      const s = await scene();
      await widenRoom(s.branch, await load.classes.room(s.branch));
      const shown = answerOf(await causesRoute(s.branch, s.version));
      await dayOff(s.branch);
      refusedWith(await upToDate(s.branch, s.version, shown.key), 409, 'out_of_date_changed');
      expect((await causesOf(s.version)).map((one) => one.action)).toEqual([
        'room.edit',
        'calendar_entry.create',
      ]);
    });

    it('lets a calendar or template write and a draft write meet in either order', async () => {
      const s = await scene();
      const lesson = await t.createSlotType(s.branch, 'Lesson', 'lesson', 45);
      await pair(s.branch, heldDraftWrite(s.branch, s.year, s.version), () =>
        post('/api/setup/calendar-entries', s.branch, DAY_OFF),
      );
      await pair(s.branch, heldDraftWrite(s.branch, s.year, s.version), () =>
        post(`/api/setup/slot-types/${lesson}/lengths`, s.branch, {
          lengthMinutes: 40,
          from: '2026-11-02',
        }),
      );
      await load.freeEditLock(s.version);
      await pair(s.branch, heldCalendar(s.branch), () =>
        patch(`/api/timetable/versions/${s.version}`, s.branch, { startsOn: '2026-10-26' }),
      );
      expect((await causesOf(s.version)).map((one) => one.action)).toEqual([
        'calendar_entry.create',
        'slot_type.length_change',
        'calendar_entry.create',
      ]);
    });

    it('lets a room edit and a draft write that holds the room meet in either order', async () => {
      const s = await scene();
      const room = await load.classes.room(s.branch);
      await pair(s.branch, heldDraftWrite(s.branch, s.year, s.version, { room }), () =>
        roomRecord(room).then((record) =>
          put(`/api/setup/rooms/${room}`, s.branch, { ...record, capacity: 33 }),
        ),
      );
      const record = await roomRecord(room);
      await load.freeEditLock(s.version);
      await pair(
        s.branch,
        async (transaction) => {
          await transaction
            .selectFrom('rooms')
            .select('id')
            .where('id', '=', room)
            .forUpdate()
            .execute();
          await transaction
            .updateTable('rooms')
            .set({ capacity: record.capacity + 1 })
            .where('id', '=', room)
            .execute();
          await markDraftsOutOfDate(transaction, audit(), {
            branchId: s.branch,
            action: 'room.edit',
            recordId: room,
            dates: 'every_year',
            actorId: null,
          });
        },
        () => patch(`/api/timetable/versions/${s.version}`, s.branch, { startsOn: '2026-10-26' }),
      );
      expect(await causesOf(s.version)).toEqual([
        { action: 'room.edit', record_id: room },
        { action: 'room.edit', record_id: room },
      ]);
    });

    it('lets new hours and a draft write of that teacher meet in either order', async () => {
      const s = await scene();
      const teacher = (await load.teacher(s.branch)).staffId;
      await pair(s.branch, heldDraftWrite(s.branch, s.year, s.version, { staff: teacher }), () =>
        put(`/api/people/staff/${teacher}/availability`, s.branch, {
          from: '2026-11-02',
          ranges: [{ weekday: 1, start: '08:00', end: '13:00' }],
        }),
      );
      await load.freeEditLock(s.version);
      await pair(
        s.branch,
        async (transaction) => {
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', teacher)
            .forUpdate()
            .execute();
          await markDraftsOutOfDate(transaction, audit(), {
            branchId: s.branch,
            action: 'staff.availability_set',
            recordId: teacher,
            dates: [{ from: '2026-11-09', until: null }],
            actorId: null,
          });
        },
        () => patch(`/api/timetable/versions/${s.version}`, s.branch, { startsOn: '2026-10-26' }),
      );
      expect(await causesOf(s.version)).toHaveLength(2);
    });

    it('lets a setup change and a copy meet in either order', async () => {
      const s = await scene();
      await pair(
        s.branch,
        async (transaction) => {
          await transaction
            .selectFrom('academic_years')
            .select('id')
            .where('id', '=', s.year)
            .forUpdate()
            .execute();
          await transaction
            .selectFrom('timetable_versions')
            .select('id')
            .where('id', '=', s.version)
            .forShare()
            .execute();
          await audit().record(transaction, {
            branchId: s.branch,
            actorId: null,
            action: 'timetable_version.create',
            record: { type: 'timetable_version', id: s.version },
          });
        },
        () => post('/api/setup/calendar-entries', s.branch, DAY_OFF),
      );
      const copied = await pair(s.branch, heldCalendar(s.branch), () =>
        post('/api/timetable/versions', s.branch, {
          academicYearId: s.year,
          startsOn: MONDAY,
          copyFrom: s.version,
        }),
      );
      // The copy waited on the branch for its version row, then read both causes.
      expect(await causesOf((copied.body as { id: string }).id)).toHaveLength(2);
      expect(await causesOf(s.version)).toHaveLength(2);
    });

    it('lets a setup change and a publish meet in either order', async () => {
      const p = await publishable();
      const sibling = await draft(p.branch, p.year);
      const nextYear = await load.classes.year(p.branch, 'planned', '2027-09-01', '2028-05-31');
      const later = await draft(p.branch, nextYear, null, NEXT_YEAR_MONDAY);
      await load.freeEditLock(p.version);
      await pair(
        p.branch,
        async (transaction) => {
          await transaction
            .selectFrom('branches')
            .select('id')
            .where('id', '=', p.branch)
            .forKeyShare()
            .execute();
          await transaction
            .selectFrom('academic_years')
            .select('id')
            .where('id', '=', p.year)
            .forShare()
            .execute();
          await transaction
            .selectFrom('timetable_versions')
            .select('id')
            .where('branch_id', '=', p.branch)
            .orderBy('id')
            .forNoKeyUpdate()
            .execute();
          await audit().record(transaction, {
            branchId: p.branch,
            actorId: null,
            action: 'timetable_version.publish',
            record: { type: 'timetable_version', id: p.version },
          });
        },
        () => widenRoom(p.branch, p.room),
      );
      await bringUp(p.branch, p.version);
      // A day off of the planned year, so the draft published stays up to date.
      versionOf(
        await pair(p.branch, heldCalendar(p.branch, '2027-10-06'), () =>
          publish(p.branch, p.version),
        ),
      );
      expect((await causesOf(sibling)).map((one) => one.action)).toEqual([
        'room.edit',
        'timetable_version.publish',
      ]);
      expect((await causesOf(later)).map((one) => one.action)).toEqual([
        'room.edit',
        'calendar_entry.create',
      ]);
    });
  });

  const publish = (branch: string, version: string) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn: MONDAY });

  /**
   * A branch with a year of four dated quarters, a day of three lessons on
   * every weekday, a class of grade 7 with its main classroom, and a draft
   * from Monday with one row placed once and its templates confirmed: a
   * draft that can be published (as `publish.test.ts` builds one).
   */
  async function publishable() {
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
    const regular = await t.createTemplate(branch, 'Regular', [
      lesson,
      pause,
      lesson,
      pause,
      lesson,
    ]);
    await t.assign(branch, regular);
    const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const room = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const teacherId = (await load.teacher(branch, { subjects: [{ subject, grades: [7] }] }))
      .staffId;
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
    const version = await draft(branch, year);
    const rowId = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: classId,
      subject_id: subject,
      teacher_id: teacherId,
      lessons_per_week: 1,
    });
    okay(
      await post(`/api/timetable/versions/${version}/pattern`, branch, {
        loadRowId: rowId,
        weekday: 1,
        slotPosition: 1,
      }),
    );
    okay(await post(`/api/timetable/versions/${version}/templates/confirm`, branch));
    return { branch, year, version, room };
  }
});
