import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../database/transactions.js';
import {
  CHECK_VIOLATION,
  claimsHarness,
  EXCLUSION_VIOLATION,
  holding,
  NOW,
  outcome,
  refusal,
} from '../../testing/claims-harness.js';
import { groupMemberValues, memberValues } from '../../testing/members-kit.js';

/** Wednesday 14 October 2026, before the moment of the tests: its lessons have started. */
const PAST = '2026-10-14';

// The claims of future lessons checked again when something changes under
// them (db/migrations/0060; task 5.1b, pull request #108): a class added to
// or removed from a group, a membership that puts a student in two lessons of
// one block, a room's switch, its number of lessons at once or its capacity.
// edge/timetable, Structure: "A group may take students of two grades. Its
// block is placed like any other, so both classes are free in those slots";
// "A room has a 'shared' switch and a maximum number of lessons at the same
// time. Capacity is checked against the students of all of them together".
// edge/developer-rules, Class in one block: "each student of a block's
// classes is in at most one of its lessons, using membership on the lesson
// date". Every write is made as `sodiq_app` through the branch filter at
// `NOW`. All names are invented.
describe('the claims of future lessons after a change elsewhere', () => {
  const h = claimsHarness();
  const north = () => h.state.north;

  const addClass = (transaction: Transaction, groupId: string, classId: string) =>
    transaction
      .insertInto('group_classes')
      .values({ group_id: groupId, class_id: classId, branch_id: north() })
      .execute();

  describe('a class added to or removed from a group (group_classes)', () => {
    it('refuses a class added to a group whose future block clashes with the class’s other block or exam', async () => {
      const oxford = await h.schoolClass(north());
      const cambridge = await h.schoolClass(north());
      const english = await h.state.kit.load.classes.subject({ grades: [7] });
      const team = await h.group(north(), [oxford], english);
      await h.place(north(), { date: '2026-10-19', start: '09:00', end: '09:45' }, [
        { groupId: team, subjectId: english },
      ]);
      await h.place(north(), { date: '2026-10-19', start: '09:30', end: '10:15' }, [
        { classId: cambridge },
      ]);
      expect(
        await refusal(h.inBranch(north(), (transaction) => addClass(transaction, team, cambridge))),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'time_claims_class_excl' });

      const princeton = await h.schoolClass(north());
      await h.exam(north(), {
        date: '2026-10-19',
        start: '08:00',
        end: '09:15',
        rooms: [
          {
            roomId: await h.state.kit.room(north()),
            classes: [princeton],
            invigilators: [await h.teacher(north())],
          },
        ],
      });
      expect(
        await refusal(h.inBranch(north(), (transaction) => addClass(transaction, team, princeton))),
      ).toMatchObject({ constraint: 'time_claims_class_excl' });
    });

    it('frees a removed class on future blocks and leaves the claims of a started block', async () => {
      const oxford = await h.schoolClass(north());
      const cambridge = await h.schoolClass(north());
      const english = await h.state.kit.load.classes.subject({ grades: [7] });
      const team = await h.group(north(), [oxford, cambridge], english);
      const past = await h.place(north(), { date: PAST, start: '09:00', end: '09:45' }, [
        { groupId: team, subjectId: english },
      ]);
      const future = await h.place(north(), { date: '2026-10-20', start: '09:00', end: '09:45' }, [
        { groupId: team, subjectId: english },
      ]);
      await h.inBranch(north(), (transaction) =>
        transaction
          .deleteFrom('group_classes')
          .where('group_id', '=', team)
          .where('class_id', '=', cambridge)
          .execute(),
      );
      expect(await h.blockClasses(future.block)).toEqual([oxford]);
      expect(await h.blockClasses(past.block)).toEqual([oxford, cambridge].sort());
      // Cambridge is free at the future block's time now.
      await h.place(north(), { date: '2026-10-20', start: '09:00', end: '09:45' }, [
        { classId: cambridge },
      ]);
    });

    it('does not check a past lesson corrected later against a class added to its group since (spec review 10)', async () => {
      const oxford = await h.schoolClass(north());
      const cambridge = await h.schoolClass(north());
      const english = await h.state.kit.load.classes.subject({ grades: [7] });
      const team = await h.group(north(), [oxford], english);
      const past = await h.place(north(), { date: PAST, start: '11:00', end: '11:45' }, [
        { groupId: team, subjectId: english },
      ]);
      // Cambridge had a lesson of its own at that past time.
      await h.place(north(), { date: PAST, start: '11:00', end: '11:45' }, [
        { classId: cambridge },
      ]);
      await h.inBranch(north(), (transaction) => addClass(transaction, team, cambridge));
      // A correction of the past lesson (its teacher recorded) is not refused.
      const smith = await h.teacher(north());
      await h.inBranch(north(), (transaction) =>
        transaction
          .updateTable('lessons')
          .set({ teacher_id: smith })
          .where('id', '=', past.lessons[0] ?? '')
          .execute(),
      );
      expect(await h.blockClasses(past.block)).toEqual([oxford]);
    });

    it('checks a group lesson written while a class is added to its group one after the other', async () => {
      const oxford = await h.schoolClass(north());
      const cambridge = await h.schoolClass(north());
      const english = await h.state.kit.load.classes.subject({ grades: [7] });
      const team = await h.group(north(), [oxford], english);
      await h.place(north(), { date: '2026-10-21', start: '09:00', end: '09:45' }, [
        { classId: cambridge },
      ]);
      const held = holding(
        (work) => h.inBranch(north(), work),
        async (transaction) => {
          await addClass(transaction, team, cambridge);
        },
      );
      await held.ready;
      const second = outcome(
        h.place(north(), { date: '2026-10-21', start: '09:00', end: '09:45' }, [
          { groupId: team, subjectId: english },
        ]),
      );
      await h.untilWaiting(1);
      held.release();
      await held.done;
      expect(await second).toBe('time_claims_class_excl');
    });

    it('checks an exam of a group written while a class is added to the group one after the other', async () => {
      const oxford = await h.schoolClass(north());
      const cambridge = await h.schoolClass(north());
      const english = await h.state.kit.load.classes.subject({ grades: [7] });
      const team = await h.group(north(), [oxford], english);
      await h.place(north(), { date: '2026-10-22', start: '09:00', end: '09:45' }, [
        { groupId: team, subjectId: english, cancel: true },
      ]);
      await h.place(north(), { date: '2026-10-22', start: '09:00', end: '09:45' }, [
        { classId: cambridge },
      ]);
      const hall = await h.state.kit.room(north());
      const smith = await h.teacher(north());
      const held = holding(
        (work) => h.inBranch(north(), work),
        async (transaction) => {
          await addClass(transaction, team, cambridge);
        },
      );
      await held.ready;
      const second = outcome(
        h.exam(north(), {
          date: '2026-10-22',
          start: '09:00',
          end: '09:45',
          subjectId: english,
          rooms: [{ roomId: hall, groups: [team], invigilators: [smith] }],
        }),
      );
      await h.untilWaiting(1);
      held.release();
      await held.done;
      expect(await second).toBe('time_claims_class_excl');
    });
  });

  describe('a membership that puts a student in two lessons of a block (lesson_block_student_twice)', () => {
    /** A class of two pupils, and a mixed block's two groups of two subjects that draw from it. */
    async function mixed(date: string, start = '09:00', end = '09:45', cancelGirls = false) {
      const oxford = await h.schoolClass(north());
      const [first = '', second = ''] = await h.state.kit.pupils(north(), oxford, 2);
      const sport = await h.state.kit.load.classes.subject({ grades: [7] });
      const technology = await h.state.kit.load.classes.subject({ grades: [7] });
      const boys = await h.group(north(), [oxford], sport);
      const girls = await h.group(north(), [oxford], technology);
      await h.state.kit.inGroup(north(), boys, sport, first);
      await h.state.kit.inGroup(north(), girls, technology, second);
      const block = await h.place(north(), { date, start, end }, [
        { groupId: boys, subjectId: sport },
        { groupId: girls, subjectId: technology, cancel: cancelGirls },
      ]);
      return { oxford, first, second, sport, technology, boys, girls, block };
    }

    const joinGirls = (m: Awaited<ReturnType<typeof mixed>>, until?: string) =>
      h.inBranch(north(), (transaction) =>
        transaction
          .insertInto('group_memberships')
          .values(
            groupMemberValues({
              branch: north(),
              groupId: m.girls,
              subjectId: m.technology,
              studentId: m.first,
              from: '2026-09-01',
              ...(until === undefined ? {} : { until, ownUntil: until }),
            }),
          )
          .execute(),
      );

    it('refuses a group membership that puts a student into the second group of a future mixed block', async () => {
      const m = await mixed('2026-10-26');
      expect(await refusal(joinGirls(m))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'lesson_block_student_twice',
      });
    });

    it('passes a membership whose range holds only lessons that have started, and a cancelled part', async () => {
      const past = await mixed(PAST);
      await joinGirls(past, '2026-10-15');
      const cancelled = await mixed('2026-10-26', '10:00', '10:45', true);
      await joinGirls(cancelled);
    });

    it('refuses a membership made longer, so its update never adds a student to a block', async () => {
      // group_memberships_only_shrink (0048, 0054): the update branch of the
      // re-check can only take a student out.
      const m = await mixed('2026-10-27');
      const row = await h.state.database.migrator
        .selectFrom('group_memberships')
        .select('id')
        .where('student_id', '=', m.second)
        .executeTakeFirstOrThrow();
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .updateTable('group_memberships')
              .set({ valid_until: '2027-06-02' })
              .where('id', '=', row.id)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'group_memberships_only_shrink' });
    });

    it('refuses a class membership that puts a student in a class lesson and a group lesson of one block', async () => {
      // Group G draws from 7 Oxford and 7 Cambridge; the block holds a lesson
      // of 7 Oxford and one of G. A new pupil joins G and 7 Oxford from 20
      // October: the class row's own check refuses it before the group row's.
      const oxford = await h.schoolClass(north());
      const cambridge = await h.schoolClass(north());
      const sport = await h.state.kit.load.classes.subject({ grades: [7] });
      const team = await h.group(north(), [oxford, cambridge], sport);
      await h.place(north(), { date: '2026-10-28', start: '09:00', end: '09:45' }, [
        { classId: oxford },
        { groupId: team, subjectId: sport },
      ]);
      const pupil = await h.state.kit.members.student(north(), { startsOn: '2026-09-01' });
      expect(
        await refusal(
          h.inBranch(north(), async (transaction) => {
            await transaction
              .insertInto('group_memberships')
              .values(
                groupMemberValues({
                  branch: north(),
                  groupId: team,
                  subjectId: sport,
                  studentId: pupil,
                  from: '2026-10-20',
                }),
              )
              .execute();
            await transaction
              .insertInto('class_memberships')
              .values(
                memberValues({
                  branch: north(),
                  classId: oxford,
                  studentId: pupil,
                  from: '2026-10-20',
                }),
              )
              .execute();
            await sql`set constraints class_memberships_block_students immediate`.execute(
              transaction,
            );
          }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'lesson_block_student_twice' });
    });

    it('refuses a merge that carries a group row onto a student of the other group of a block (spec review 2)', async () => {
      const m = await mixed('2026-10-29');
      const account = await h.state.kit.load.classes.account();
      const row = await h.state.database.migrator
        .selectFrom('group_memberships')
        .select('id')
        .where('student_id', '=', m.second)
        .executeTakeFirstOrThrow();
      const uids = await h.state.database.migrator
        .selectFrom('students')
        .select(['id', 'uid'])
        .where('id', 'in', [m.first, m.second])
        .execute();
      const uid = (id: string) => uids.find((one) => one.id === id)?.uid ?? '';
      expect(
        await refusal(
          h.inBranch(north(), async (transaction) => {
            await transaction
              .insertInto('student_merges')
              .values({
                branch_id: north(),
                kept_id: m.first,
                merged_id: m.second,
                merged_branch_id: north(),
                kept_uid: uid(m.first),
                merged_uid: uid(m.second),
                merged_uids: [uid(m.second)],
                merged_record: JSON.stringify({ id: m.second }),
                left_rows: '{}',
                reason: 'Created twice by mistake',
                merged_by: account,
                merged_at: new Date(NOW),
              })
              .execute();
            await transaction
              .updateTable('group_memberships')
              .set({ student_id: m.first })
              .where('id', '=', row.id)
              .execute();
            await sql`set constraints group_memberships_block_students immediate`.execute(
              transaction,
            );
          }),
        ),
      ).toMatchObject({ constraint: 'lesson_block_student_twice' });
    });

    it('checks a merge and a block written at the same moment one after the other', async () => {
      // A membership insert meets a lesson insert on the class or group row
      // already (0045, 0048: FOR UPDATE against the lesson's key); a merge
      // takes no such lock, so they meet only on the lock of the group.
      const oxford = await h.schoolClass(north());
      const [first = '', second = ''] = await h.state.kit.pupils(north(), oxford, 2);
      const sport = await h.state.kit.load.classes.subject({ grades: [7] });
      const technology = await h.state.kit.load.classes.subject({ grades: [7] });
      const boys = await h.group(north(), [oxford], sport);
      const girls = await h.group(north(), [oxford], technology);
      await h.state.kit.inGroup(north(), boys, sport, first);
      await h.state.kit.inGroup(north(), girls, technology, second);
      const account = await h.state.kit.load.classes.account();
      const row = await h.state.database.migrator
        .selectFrom('group_memberships')
        .select('id')
        .where('student_id', '=', second)
        .executeTakeFirstOrThrow();
      const uids = await h.state.database.migrator
        .selectFrom('students')
        .select(['id', 'uid'])
        .where('id', 'in', [first, second])
        .execute();
      const uid = (id: string) => uids.find((one) => one.id === id)?.uid ?? '';
      const held = holding(
        (work) => h.inBranch(north(), work),
        async (transaction) => {
          await h.writeBlock(
            transaction,
            north(),
            { date: '2026-10-30', start: '09:00', end: '09:45' },
            [
              { groupId: boys, subjectId: sport },
              { groupId: girls, subjectId: technology },
            ],
          );
          await sql`set constraints lessons_block_students immediate`.execute(transaction);
        },
      );
      await held.ready;
      const merged = outcome(
        h.inBranch(north(), async (transaction) => {
          await transaction
            .insertInto('student_merges')
            .values({
              branch_id: north(),
              kept_id: first,
              merged_id: second,
              merged_branch_id: north(),
              kept_uid: uid(first),
              merged_uid: uid(second),
              merged_uids: [uid(second)],
              merged_record: JSON.stringify({ id: second }),
              left_rows: '{}',
              reason: 'Created twice by mistake',
              merged_by: account,
              merged_at: new Date(NOW),
            })
            .execute();
          await transaction
            .updateTable('group_memberships')
            .set({ student_id: first })
            .where('id', '=', row.id)
            .execute();
          await sql`set constraints group_memberships_block_students immediate`.execute(
            transaction,
          );
        }),
      );
      await h.untilWaiting(1);
      held.release();
      await held.done;
      expect(await merged).toBe('lesson_block_student_twice');
    });
  });

  describe('a room’s switch, number and capacity (rooms)', () => {
    const updateRoom = (
      roomId: string,
      values: { shared?: boolean; max_simultaneous_lessons?: number | null; capacity?: number },
    ) =>
      h.inBranch(north(), (transaction) =>
        transaction.updateTable('rooms').set(values).where('id', '=', roomId).execute(),
      );

    it('refuses a shared room with overlapping future lessons switched to not shared', async () => {
      const hall = await h.state.kit.room(north(), { most: 2 });
      await h.place(north(), { date: '2026-11-10', start: '09:00', end: '09:45' }, [
        { classId: await h.schoolClass(north()), roomId: hall },
      ]);
      await h.place(north(), { date: '2026-11-10', start: '09:30', end: '10:15' }, [
        { classId: await h.schoolClass(north()), roomId: hall },
      ]);
      expect(
        await refusal(updateRoom(hall, { shared: false, max_simultaneous_lessons: null })),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'time_claims_room_excl' });
    });

    it('refuses the number of lessons at once lowered below the future lessons', async () => {
      const hall = await h.state.kit.room(north(), { most: 3 });
      for (let index = 0; index < 3; index += 1) {
        await h.place(north(), { date: '2026-11-11', start: '09:00', end: '09:45' }, [
          { classId: await h.schoolClass(north()), roomId: hall },
        ]);
      }
      expect(await refusal(updateRoom(hall, { max_simultaneous_lessons: 2 }))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'room_shared_full',
      });
    });

    it('refuses the capacity lowered below the students of the future lessons together', async () => {
      const hall = await h.state.kit.room(north(), { most: 2, capacity: 30 });
      for (let index = 0; index < 2; index += 1) {
        const school = await h.schoolClass(north());
        await h.state.kit.pupils(north(), school, 2);
        await h.place(north(), { date: '2026-11-12', start: '09:00', end: '09:45' }, [
          { classId: school, roomId: hall },
        ]);
      }
      expect(await refusal(updateRoom(hall, { capacity: 3 }))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'room_shared_capacity',
      });
      await updateRoom(hall, { capacity: 4 });
    });

    it('passes the same changes when only lessons that have ended are over the limit', async () => {
      const hall = await h.state.kit.room(north(), { most: 2 });
      for (let index = 0; index < 2; index += 1) {
        await h.place(north(), { date: PAST, start: '09:00', end: '09:45' }, [
          { classId: await h.schoolClass(north()), roomId: hall },
        ]);
      }
      await updateRoom(hall, { shared: false, max_simultaneous_lessons: null });
      const other = await h.state.kit.room(north(), { most: 3 });
      for (let index = 0; index < 3; index += 1) {
        await h.place(north(), { date: PAST, start: '10:00', end: '10:45' }, [
          { classId: await h.schoolClass(north()), roomId: other },
        ]);
      }
      await updateRoom(other, { max_simultaneous_lessons: 2 });
    });

    it('refuses a lesson written from the old switch while the room is switched to not shared (room_shared_stale)', async () => {
      const hall = await h.state.kit.room(north(), { most: 2 });
      await h.place(north(), { date: '2026-11-13', start: '09:00', end: '09:45' }, [
        { classId: await h.schoolClass(north()), roomId: hall },
      ]);
      const cambridge = await h.schoolClass(north());
      const held = holding(
        (work) => h.inBranch(north(), work),
        async (transaction) => {
          await transaction
            .updateTable('rooms')
            .set({ shared: false, max_simultaneous_lessons: null })
            .where('id', '=', hall)
            .execute();
        },
      );
      await held.ready;
      const second = outcome(
        h.inBranch(north(), async (transaction) => {
          await h.writeBlock(
            transaction,
            north(),
            { date: '2026-11-13', start: '09:00', end: '09:45' },
            [{ classId: cambridge, roomId: hall }],
          );
          await sql`set constraints time_claims_shared_room immediate`.execute(transaction);
        }),
      );
      await h.untilWaiting(1);
      held.release();
      await held.done;
      expect(await second).toBe('room_shared_stale');
    });
  });
});
