import { randomUUID } from 'node:crypto';
import { BRANCH_HEADER, REQUEST_KEY_HEADER, teachingHomeSchema } from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { standingExamOver } from '../../testing/exams-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';

/** Monday 19 October 2026, 07:00 in Tashkent: the scenes' versions run from the 12th. */
const MOMENT = '2026-10-19T07:00:00+05:00';
const DATE = '2026-10-19';
const DAY_MS = 86_400_000;

const homeOf = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return teachingHomeSchema.parse(response.body);
};

// All names are invented. Task 5.9b, pull request #198: the home page of a
// person who teaches (docs/spec/06-timetable.md, Teachers who work in several
// branches: "Today's lessons from all branches appear together in time
// order, each labelled with its branch. Teaching needs no branch switching";
// Views and outputs: "Teacher home page: today's lessons as a list ... and the
// week as a table"). The scenes are built at the kit's start; each home is
// read with the clock on Monday 19 October.
describe('the teaching home page', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;
  const SURNAMES = [
    'Saidova',
    'Karimova',
    'Nurova',
    'Qosimova',
    'Sharipova',
    'Jurayeva',
    'Latipova',
    'Bakirova',
    'Fozilova',
    'Hasanova',
    'Umarova',
  ];

  /** A signed-in account, made at the kit's start, for a scene's teacher. */
  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', SURNAMES[names % SURNAMES.length] ?? 'Saidova');
  };

  /** The lessons of a class on a date, in time order. */
  const lessonsOf = (scene: PublishedScene, date: string, classId = scene.classId) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('class_id', '=', classId)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .execute();

  const lessonOf = async (scene: PublishedScene, date: string, classId = scene.classId) => {
    const [found] = await lessonsOf(scene, date, classId);
    if (found === undefined) throw new Error('No such lesson.');
    return found;
  };

  /** Links the staff record to another branch where the person works. */
  const link = (staffId: string, branch: string) =>
    t.database.migrator
      .insertInto('staff_branches')
      .values({ staff_id: staffId, branch_id: branch, is_main: false })
      .execute();

  const teach = (lessonId: string, staffId: string) =>
    t.database.migrator
      .updateTable('lessons')
      .set({ teacher_id: staffId })
      .where('id', '=', lessonId)
      .execute();

  const keyed = (path: string, branch: string, body: object) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  const branchName = async (branch: string) =>
    (
      await t.database.migrator
        .selectFrom('branches')
        .select('name')
        .where('id', '=', branch)
        .executeTakeFirstOrThrow()
    ).name;

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];

  /**
   * Runs `work` with the clock at MOMENT: the account gets its roles from
   * the start of the year and its session counts as used now (the kit's
   * sessions would end after their idle minutes and seven days); the clock goes back after.
   */
  async function at<T>(
    browser: { cookie: string; account: { id: string } },
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (home: (branch: string, path?: string) => Promise<Response>) => Promise<T>,
  ): Promise<T> {
    for (const held of roles) {
      await t.kit.giveRole(browser.account.id, {
        ...held,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .where('account_id', '=', browser.account.id)
        .execute();
      return await work((branch, path = '/api/timetable/home') =>
        t.get(path, branch, browser.cookie),
      );
    } finally {
      t.clock.set(START);
    }
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('lists the lessons of today from both branches in time order, each with its branch, with no branch switch', async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
    // The other branch's day starts at 06:00: its second lesson (06:55) comes
    // before the first lesson here (08:00), so an order by lesson number fails.
    const away = await publishedScene(t, load, { startTime: '06:00', double: true });
    await link(here.teacher.staffId, away.branch);
    const awayLessons = await lessonsOf(away, DATE);
    expect(awayLessons).toHaveLength(2);
    for (const lesson of awayLessons) await teach(lesson.id, here.teacher.staffId);
    const own = await lessonOf(here, DATE);
    const [hereName, awayName] = [await branchName(here.branch), await branchName(away.branch)];

    await at(
      browser,
      [
        { role: 'teacher', branchId: here.branch },
        { role: 'teacher', branchId: away.branch },
      ],
      async (home) => {
        for (const branch of [here.branch, away.branch]) {
          const read = homeOf(await home(branch));
          expect(read.today).toBe(DATE);
          expect(read.week).toEqual({ from: DATE, to: '2026-10-25' });
          // Another teacher's lesson of the same slot is never listed.
          expect(
            read.lessons.map((one) => [one.id, one.branch, one.lessonNumber, one.today]),
          ).toEqual([
            [awayLessons[0]?.id, { id: away.branch, name: awayName }, 1, true],
            [awayLessons[1]?.id, { id: away.branch, name: awayName }, 2, true],
            [own.id, { id: here.branch, name: hereName }, 1, true],
          ]);
          expect(read.lessons.map((one) => one.startsAt)).toEqual([
            '2026-10-19T01:00:00.000Z',
            '2026-10-19T01:55:00.000Z',
            '2026-10-19T03:00:00.000Z',
          ]);
          // Both branches are read in full: no lesson comes twice as a busy block.
          expect(read.busy).toEqual([]);
          expect(read.branches.map((one) => one.id).sort()).toEqual(
            [here.branch, away.branch].sort(),
          );
          expect(
            read.days
              .filter((one) => one.date === DATE)
              .map((one) => one.branch.id)
              .sort(),
          ).toEqual([here.branch, away.branch].sort());
        }
      },
    );
  });

  it("names each lesson's journal in its own branch, opened from the home page (task 6.2, From 5.9b)", async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
    // The other branch's day starts at 06:00, so its lesson comes first.
    const away = await publishedScene(t, load, { startTime: '06:00' });
    await link(here.teacher.staffId, away.branch);
    const awayLesson = await lessonOf(away, DATE);
    await teach(awayLesson.id, here.teacher.staffId);
    const own = await lessonOf(here, DATE);
    const journalOf = async (classId: string) =>
      (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', classId)
          .where('subject_id', 'in', [here.subject, away.subject])
          .executeTakeFirstOrThrow()
      ).id;
    await at(
      browser,
      [
        { role: 'teacher', branchId: here.branch },
        { role: 'teacher', branchId: away.branch },
      ],
      async (home) => {
        const read = homeOf(await home(here.branch));
        expect(read.lessons.map((one) => [one.id, one.branch.id, one.journalId])).toEqual([
          [awayLesson.id, away.branch, await journalOf(away.classId)],
          [own.id, here.branch, await journalOf(here.classId)],
        ]);
      },
    );
  });

  it('gives a Senior Head Teacher the lessons of a branch their record is linked to, read from another branch', async () => {
    const browser = await account();
    const away = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
    const lesson = await lessonOf(away, DATE);
    await at(browser, [{ role: 'senior_head_teacher' }], async (home) => {
      // The record is not linked to t.north.
      const read = homeOf(await home(t.north));
      expect(read.lessons.map((one) => [one.id, one.branch.id])).toEqual([
        [lesson.id, away.branch],
      ]);
      expect(read.busy).toEqual([]);
    });
  });

  // Task 10.2b (the owner on #261): the Senior Head Teacher does not reach the hidden Monitoring
  // branch, so its lessons are read there only as the busy blocks of a branch with no role.
  it('reads no lesson of the Monitoring branch in full for a Senior Head Teacher', async () => {
    const browser = await account();
    const hidden = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
    const lesson = await lessonOf(hidden, DATE);
    await t.database.migrator
      .updateTable('branches')
      .set({ purpose: 'monitoring' })
      .where('id', '=', hidden.branch)
      .execute();
    try {
      await at(browser, [{ role: 'senior_head_teacher' }], async (home) => {
        const read = homeOf(await home(t.north));
        expect(read.lessons).toEqual([]);
        expect(read.branches.map((one) => one.id)).not.toContain(hidden.branch);
        expect(JSON.stringify(read)).not.toContain(lesson.id);
      });
    } finally {
      await t.database.migrator
        .updateTable('branches')
        .set({ purpose: null })
        .where('id', '=', hidden.branch)
        .execute();
    }
  });

  it('lists a cancelled lesson and a lesson replaced away in the other branch (spec review must-fix 1)', async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { spare: browser.account.id } });
    const away = await publishedScene(t, load);
    const staffId = here.spareTeacher.staffId;
    await link(staffId, away.branch);
    const cancelledLesson = await lessonOf(away, DATE);
    await teach(cancelledLesson.id, staffId);
    const cancelled = await keyed(
      `/api/timetable/lessons/${cancelledLesson.id}/cancel`,
      away.branch,
      {
        reason: 'School trip',
      },
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const replacedLesson = await lessonOf(away, DATE, away.otherClass);
    await teach(replacedLesson.id, staffId);
    const substituted = await keyed(
      `/api/timetable/lessons/${replacedLesson.id}/substitute`,
      away.branch,
      { teacherId: away.otherTeacher.staffId, reason: 'Training day' },
    );
    expect(substituted.status, JSON.stringify(substituted.body)).toBe(200);

    await at(
      browser,
      [
        { role: 'teacher', branchId: here.branch },
        { role: 'teacher', branchId: away.branch },
      ],
      async (home) => {
        const read = homeOf(await home(here.branch));
        const byId = new Map(read.lessons.map((one) => [one.id, one]));
        expect(read.lessons).toHaveLength(2);
        expect(byId.get(cancelledLesson.id)).toMatchObject({
          branch: { id: away.branch },
          cancelCause: 'reason',
          cancelReason: 'School trip',
          replacedHere: false,
        });
        expect(byId.get(replacedLesson.id)).toMatchObject({
          branch: { id: away.branch },
          replacedHere: true,
          teacher: { id: away.otherTeacher.staffId },
        });
      },
    );
  });

  it('lists a lesson the person substitutes, with the teacher replaced (5.9a decision 8)', async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { spare: browser.account.id } });
    const lesson = await lessonOf(here, DATE);
    const substituted = await keyed(`/api/timetable/lessons/${lesson.id}/substitute`, here.branch, {
      teacherId: here.spareTeacher.staffId,
      reason: 'Training day',
    });
    expect(substituted.status, JSON.stringify(substituted.body)).toBe(200);
    await at(browser, [{ role: 'teacher', branchId: here.branch }], async (home) => {
      const read = homeOf(await home(here.branch));
      expect(
        read.lessons.map((one) => [one.id, one.replacedHere, one.substitution?.replaced?.id]),
      ).toEqual([[lesson.id, false, here.teacher.staffId]]);
      expect(read.lessons[0]?.teacher?.id).toBe(here.spareTeacher.staffId);
    });
  });

  it('shows a branch with no current role as busy blocks with time and branch only, in time order', async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
    const staffId = here.teacher.staffId;
    // A second lesson here at 09:50: the other class's lesson moved to the third slot.
    const moved = await keyed(
      `/api/timetable/lessons/${(await lessonOf(here, DATE, here.otherClass)).id}/move`,
      here.branch,
      { date: DATE, lessonNumber: 3, reason: 'Room swap' },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const later = (await lessonsOf(here, DATE, here.otherClass)).find(
      (one) => one.cancel_cause === null,
    );
    if (later === undefined) throw new Error('The moved lesson is there.');
    await teach(later.id, staffId);
    // The other branch's lesson at 09:00, between the two.
    const away = await publishedScene(t, load, { startTime: '09:00' });
    await link(staffId, away.branch);
    const awayLesson = await lessonOf(away, DATE);
    await teach(awayLesson.id, staffId);
    const awayName = await branchName(away.branch);

    // A role in the other branch that has ended counts for nothing.
    const ended = await t.kit.giveRole(browser.account.id, {
      role: 'teacher',
      branchId: away.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    await t.kit.endRole(ended.id, browser.account.id, away.branch);

    await at(browser, [{ role: 'teacher', branchId: here.branch }], async (home) => {
      const read = homeOf(await home(here.branch));
      expect(read.lessons.map((one) => one.id)).toEqual([
        (await lessonOf(here, DATE)).id,
        later.id,
      ]);
      expect(read.busy).toEqual([
        {
          date: DATE,
          start: 540,
          end: 585,
          branch: { id: away.branch, name: awayName },
          startsAt: '2026-10-19T04:00:00.000Z',
          endsAt: '2026-10-19T04:45:00.000Z',
          today: true,
        },
      ]);
      const [first, second] = read.lessons;
      const block = read.busy[0];
      if (first === undefined || second === undefined || block === undefined) {
        throw new Error('Two lessons and a block are listed.');
      }
      expect(first.startsAt < block.startsAt && block.startsAt < second.startsAt).toBe(true);
      // Nothing of the other branch but its time and name.
      const text = JSON.stringify(read);
      for (const id of [away.classId, away.subject, away.room, awayLesson.id]) {
        expect(text).not.toContain(id);
      }
      expect(read.branches.map((one) => one.id)).toEqual([here.branch]);
    });
  });

  it('marks a lesson changed within the last seven days (06, Everyone is told)', async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
    const lesson = await lessonOf(here, DATE);
    const mark = (changedAt: Date) =>
      t.database.migrator
        .insertInto('lesson_changes')
        .values({ lesson_id: lesson.id, branch_id: here.branch, changed_at: changedAt })
        .onConflict((conflict) =>
          conflict.column('lesson_id').doUpdateSet({ changed_at: changedAt }),
        )
        .execute();
    const now = new Date(MOMENT).getTime();
    await at(browser, [{ role: 'teacher', branchId: here.branch }], async (home) => {
      await mark(new Date(now - 7 * DAY_MS + 1));
      expect(homeOf(await home(here.branch)).lessons.map((one) => one.changed)).toEqual([true]);
      await mark(new Date(now - 7 * DAY_MS));
      expect(homeOf(await home(here.branch)).lessons.map((one) => one.changed)).toEqual([false]);
    });
  });

  it('lists the exams the person invigilates and no other (06, Exam)', async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { spare: browser.account.id } });
    const examId = await standingExamOver(t.database.migrator, {
      lessonId: (await lessonOf(here, DATE)).id,
      roomId: here.room,
      staffId: here.spareTeacher.staffId,
    });
    await standingExamOver(t.database.migrator, {
      lessonId: (await lessonOf(here, DATE, here.otherClass)).id,
      roomId: here.otherRoom,
      staffId: here.otherTeacher.staffId,
    });
    await at(browser, [{ role: 'teacher', branchId: here.branch }], async (home) => {
      const read = homeOf(await home(here.branch));
      expect(read.exams.map((one) => [one.id, one.branch.id, one.today, one.startsAt])).toEqual([
        [examId, here.branch, true, '2026-10-19T03:00:00.000Z'],
      ]);
      expect(read.exams[0]?.rooms.map((one) => one.room.id)).toEqual([here.room]);
    });
  });

  it('keeps the other branch’s lessons on a day off here (06, Days off)', async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
    const away = await publishedScene(t, load, { startTime: '06:00' });
    await link(here.teacher.staffId, away.branch);
    const awayLesson = await lessonOf(away, DATE);
    await teach(awayLesson.id, here.teacher.staffId);
    await t.database.migrator
      .insertInto('calendar_entries')
      .values({
        branch_id: here.branch,
        kind: 'day_off',
        name: 'Teachers’ Day',
        first_date: DATE,
        last_date: DATE,
      })
      .execute();
    await at(
      browser,
      [
        { role: 'teacher', branchId: here.branch },
        { role: 'teacher', branchId: away.branch },
      ],
      async (home) => {
        const read = homeOf(await home(here.branch));
        expect(read.lessons.map((one) => one.id)).toContain(awayLesson.id);
        expect(
          read.days.find((one) => one.date === DATE && one.branch.id === here.branch)?.dayOff,
        ).toBe('Teachers’ Day');
        expect(
          read.days.find((one) => one.date === DATE && one.branch.id === away.branch)?.dayOff,
        ).toBeNull();
      },
    );
  });

  it('answers a branch with no academic year with no days, and no staff record with an empty home', async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
    const empty = await t.newBranch();
    await link(here.teacher.staffId, empty);
    await at(
      browser,
      [
        { role: 'teacher', branchId: here.branch },
        { role: 'teacher', branchId: empty },
      ],
      async (home) => {
        // The guard lets the branch with no year in: its read is no error.
        const read = homeOf(await home(empty));
        expect(read.lessons.map((one) => one.id)).toEqual([(await lessonOf(here, DATE)).id]);
        expect(read.days.every((one) => one.branch.id === here.branch)).toBe(true);
      },
    );
    // A record linked only to a branch with no year: an empty week with today, no error.
    const alone = await account();
    const lone = await load.teacher(empty, { accountId: alone.account.id });
    expect(lone.staffId).toBeDefined();
    await at(alone, [{ role: 'teacher', branchId: empty }], async (home) => {
      const read = homeOf(await home(empty));
      expect(read).toMatchObject({ branches: [], days: [], lessons: [], exams: [], busy: [] });
    });
    const nobody = await account();
    await at(nobody, [{ role: 'teacher', branchId: here.branch }], async (home) => {
      const read = homeOf(await home(here.branch));
      expect(read).toMatchObject({ today: DATE, branches: [], days: [], lessons: [], exams: [] });
      expect(read.busy).toEqual([]);
    });
  });

  // Permission review should-fixes 1 and 4: the area decides which branch is read in full.
  it('reads in full a branch whose role permits the views, and gives a branch whose role does not as busy blocks', async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
    const staffId = here.teacher.staffId;
    // A Head Teacher in one other branch: the role permits the views there.
    const headed = await publishedScene(t, load, { startTime: '06:00' });
    await link(staffId, headed.branch);
    const headedLesson = await lessonOf(headed, DATE);
    await teach(headedLesson.id, staffId);
    // HR in another: the role does not. The person invigilates an exam there.
    const other = await publishedScene(t, load, { startTime: '09:00' });
    await link(staffId, other.branch);
    const otherLesson = await lessonOf(other, DATE);
    await teach(otherLesson.id, staffId);
    const examId = await standingExamOver(t.database.migrator, {
      lessonId: otherLesson.id,
      roomId: other.room,
      staffId,
    });
    await at(
      browser,
      [
        { role: 'teacher', branchId: here.branch },
        { role: 'head_teacher', branchId: headed.branch },
        { role: 'hr', branchId: other.branch },
      ],
      async (home) => {
        const read = homeOf(await home(here.branch));
        expect(read.lessons.map((one) => [one.id, one.branch.id])).toEqual([
          [headedLesson.id, headed.branch],
          [(await lessonOf(here, DATE)).id, here.branch],
        ]);
        expect(read.exams).toEqual([]);
        expect(read.busy.map((one) => [one.branch.id, one.start, one.end])).toEqual([
          [other.branch, 540, 585],
        ]);
        const text = JSON.stringify(read);
        for (const id of [examId, otherLesson.id, other.room, other.classId, other.subject]) {
          expect(text).not.toContain(id);
        }
      },
    );
  });

  it('refuses a query that names a person (spec review should-fix 4)', async () => {
    const browser = await account();
    const here = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
    await at(browser, [{ role: 'teacher', branchId: here.branch }], async (home) => {
      const response = await home(
        here.branch,
        `/api/timetable/home?staffId=${here.otherTeacher.staffId}`,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(400);
    });
  });
});
