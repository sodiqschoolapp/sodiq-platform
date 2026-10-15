import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  CHECK_VIOLATION,
  claimsHarness,
  EXCLUSION_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  holding,
  INSUFFICIENT_PRIVILEGE,
  outcome,
  refusal,
} from '../../testing/claims-harness.js';
import { at } from '../../testing/lessons-kit.js';

/** Wednesday 21 October 2026, a school day of quarter 1 after the moment of the tests. */
const WEDNESDAY = '2026-10-21';

// Exams on the time claims (db/migrations/0060; task 5.1b, pull request
// #108). 06, Changes after publishing, Exam: "over that time it is checked as
// a lesson is for its invigilators, rooms and classes — an invigilator cannot
// be in a lesson or another exam, a room cannot hold a lesson or another exam
// unless shared, and a class cannot be in a lesson." edge/developer-rules,
// Exams: "the database checks lessons and exams against each other with one
// rule, not two." edge/timetable, Exams. Every write is made as `sodiq_app`
// through the branch filter, with no service in between. All names are
// invented.
describe('exams and their time claims in the database', () => {
  const h = claimsHarness();
  const north = () => h.state.north;
  const south = () => h.state.south;
  const room = (branch = north(), input: { most?: number; capacity?: number } = {}) =>
    h.state.kit.room(branch, input);

  /** A whole-class exam of one class in one room with one invigilator. */
  async function plain(start = '10:00', end = '11:30', date = WEDNESDAY) {
    const smith = await h.teacher(north());
    const oxford = await h.schoolClass(north());
    const hall = await room();
    return {
      smith,
      oxford,
      hall,
      input: {
        date,
        start,
        end,
        rooms: [{ roomId: hall, classes: [oxford], invigilators: [smith] }],
      },
    };
  }

  describe('an invigilator in one place (time_claims_teacher_excl)', () => {
    it('refuses an invigilator who teaches at that time, and passes one whose lesson ends as the exam starts', async () => {
      const p = await plain('10:00', '11:30');
      await h.place(north(), { date: WEDNESDAY, start: '10:30', end: '11:15' }, [
        { classId: await h.schoolClass(north()), teacherId: p.smith },
      ]);
      expect(await refusal(h.exam(north(), p.input))).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'time_claims_teacher_excl',
      });
      const jones = await h.teacher(north());
      await h.place(north(), { date: WEDNESDAY, start: '09:15', end: '10:00' }, [
        { classId: await h.schoolClass(north()), teacherId: jones },
      ]);
      await h.exam(north(), {
        ...p.input,
        rooms: [{ roomId: p.hall, classes: [p.oxford], invigilators: [jones] }],
      });
    });

    it('refuses an invigilator teaching in another branch under the other day template, by clock time', async () => {
      const p = await plain('10:00', '11:30');
      // A 40-minute slot of the other branch, 11:20 to 12:00, overlaps the end of the exam.
      await h.place(south(), { date: WEDNESDAY, start: '11:20', end: '12:00' }, [
        { classId: await h.schoolClass(south(), 3), teacherId: p.smith },
      ]);
      expect(await refusal(h.exam(north(), p.input))).toMatchObject({
        constraint: 'time_claims_teacher_excl',
      });
    });

    it('refuses an invigilator in another exam at once, and the lesson of a teacher who invigilates', async () => {
      const p = await plain('12:00', '13:00');
      await h.exam(north(), p.input);
      const other = await plain('12:30', '13:30');
      expect(
        await refusal(
          h.exam(north(), {
            ...other.input,
            rooms: [{ roomId: other.hall, classes: [other.oxford], invigilators: [p.smith] }],
          }),
        ),
      ).toMatchObject({ constraint: 'time_claims_teacher_excl' });
      expect(
        await refusal(
          h.place(north(), { date: WEDNESDAY, start: '12:15', end: '13:00' }, [
            { classId: await h.schoolClass(north()), teacherId: p.smith },
          ]),
        ),
      ).toMatchObject({ constraint: 'time_claims_teacher_excl' });
    });

    it('refuses a vacancy as invigilator by the key (exam_invigilators_person_fkey)', async () => {
      const p = await plain('14:00', '15:00');
      const wanted = await h.state.kit.load.vacancy(north());
      expect(
        await refusal(
          h.exam(north(), {
            ...p.input,
            rooms: [{ roomId: p.hall, classes: [p.oxford], invigilators: [wanted] }],
          }),
        ),
      ).toMatchObject({ code: FOREIGN_KEY_VIOLATION, constraint: 'exam_invigilators_person_fkey' });
    });

    it('refuses one person in two rooms of one exam', async () => {
      const p = await plain('15:00', '16:00');
      expect(
        await refusal(
          h.exam(north(), {
            ...p.input,
            rooms: [
              { roomId: p.hall, classes: [p.oxford], invigilators: [p.smith] },
              {
                roomId: await room(),
                classes: [await h.schoolClass(north())],
                invigilators: [p.smith],
              },
            ],
          }),
        ),
      ).toMatchObject({ constraint: 'exam_invigilators_staff_key' });
    });
  });

  describe('a room in one use (time_claims_room_excl, room_shared_full)', () => {
    it('refuses an exam in a room that holds a lesson or another exam at that time', async () => {
      const p = await plain('09:00', '10:00', '2026-10-22');
      await h.place(north(), { date: '2026-10-22', start: '09:30', end: '10:15' }, [
        { classId: await h.schoolClass(north()), roomId: p.hall },
      ]);
      expect(await refusal(h.exam(north(), p.input))).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'time_claims_room_excl',
      });
      const q = await plain('11:00', '12:00', '2026-10-22');
      await h.exam(north(), q.input);
      const r = await plain('11:30', '12:30', '2026-10-22');
      expect(
        await refusal(
          h.exam(north(), {
            ...r.input,
            rooms: [{ roomId: q.hall, classes: [r.oxford], invigilators: [r.smith] }],
          }),
        ),
      ).toMatchObject({ constraint: 'time_claims_room_excl' });
    });

    it('counts an exam as one use of a shared room, and not its students against capacity (decision 2)', async () => {
      // Capacity 2, and the exam's class has three pupils: not counted.
      const hall = await room(north(), { most: 2, capacity: 2 });
      const p = await plain('13:00', '14:00', '2026-10-22');
      await h.state.kit.pupils(north(), p.oxford, 3);
      await h.exam(north(), {
        ...p.input,
        rooms: [{ roomId: hall, classes: [p.oxford], invigilators: [p.smith] }],
      });
      await h.place(north(), { date: '2026-10-22', start: '13:00', end: '13:45' }, [
        { classId: await h.schoolClass(north()), roomId: hall },
      ]);
      expect(
        await refusal(
          h.place(north(), { date: '2026-10-22', start: '13:15', end: '14:00' }, [
            { classId: await h.schoolClass(north()), roomId: hall },
          ]),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'room_shared_full' });
    });
  });

  describe('a class in one place (time_claims_class_excl, exam_class_one_room)', () => {
    it('refuses an exam of a class that has a lesson then, and passes it with the lesson cancelled in the same save', async () => {
      const p = await plain('09:00', '10:30', '2026-10-23');
      const lesson = await h.place(north(), { date: '2026-10-23', start: '09:00', end: '09:45' }, [
        { classId: p.oxford },
      ]);
      expect(await refusal(h.exam(north(), p.input))).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'time_claims_class_excl',
      });
      await h.inBranch(north(), async (transaction) => {
        await transaction
          .updateTable('lessons')
          .set({ cancel_cause: 'exam' })
          .where('id', '=', lesson.lessons[0] ?? '')
          .execute();
        await h.writeExam(transaction, north(), p.input);
      });
      // Restoring the lesson while the exam stands is refused.
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .updateTable('lessons')
              .set({ cancel_cause: null })
              .where('id', '=', lesson.lessons[0] ?? '')
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'time_claims_class_excl' });
    });

    it('refuses a class in two rooms of one exam, and in two exams at once', async () => {
      const p = await plain('11:00', '12:00', '2026-10-23');
      expect(
        await refusal(
          h.exam(north(), {
            ...p.input,
            rooms: [
              { roomId: p.hall, classes: [p.oxford], invigilators: [p.smith] },
              {
                roomId: await room(),
                classes: [p.oxford],
                invigilators: [await h.teacher(north())],
              },
            ],
          }),
        ),
      ).toMatchObject({ code: '23505', constraint: 'exam_class_one_room' });
      await h.exam(north(), p.input);
      const q = await plain('11:30', '12:30', '2026-10-23');
      expect(
        await refusal(
          h.exam(north(), {
            ...q.input,
            rooms: [{ roomId: q.hall, classes: [p.oxford], invigilators: [q.smith] }],
          }),
        ),
      ).toMatchObject({ constraint: 'time_claims_class_excl' });
    });
  });

  describe('a group that sits in its own lesson’s slots (exam_group_slots)', () => {
    /** A class split in two groups of the exam's subject, with a block of both at 09:00. */
    async function split(date: string, start = '09:00', end = '09:45') {
      const oxford = await h.schoolClass(north());
      const english = await h.state.kit.load.classes.subject({ grades: [7] });
      const first = await h.group(north(), [oxford], english);
      const second = await h.group(north(), [oxford], english);
      const block = await h.place(north(), { date, start, end }, [
        { groupId: first, subjectId: english },
        { groupId: second, subjectId: english },
      ]);
      return { oxford, english, first, second, block };
    }

    const cancelIn = (transaction: Parameters<Parameters<typeof h.inBranch>[1]>[0], id: string) =>
      transaction
        .updateTable('lessons')
        .set({ cancel_cause: 'exam' })
        .where('id', '=', id)
        .execute();

    it('passes a group in its own slot with its lesson cancelled while the other group keeps its lesson', async () => {
      const s = await split('2026-10-26');
      const hall = await room();
      const smith = await h.teacher(north());
      const written = await h.inBranch(north(), async (transaction) => {
        await cancelIn(transaction, s.block.lessons[0] ?? '');
        return h.writeExam(transaction, north(), {
          date: '2026-10-26',
          start: '09:00',
          end: '09:45',
          subjectId: s.english,
          rooms: [{ roomId: hall, groups: [s.first], invigilators: [smith] }],
        });
      });
      expect(await h.blockClasses(s.block.block)).toEqual([s.oxford]);
      expect((await h.examClaims(written.exam)).map((c) => c.kind)).toEqual([
        'exam_group_class',
        'exam_invigilator',
        'exam_room',
      ]);
    });

    it('keeps the classes occupied when every group of the block sits', async () => {
      const s = await split('2026-10-26', '10:00', '10:45');
      const smith = await h.teacher(north());
      const jones = await h.teacher(north());
      await h.inBranch(north(), async (transaction) => {
        await cancelIn(transaction, s.block.lessons[0] ?? '');
        await cancelIn(transaction, s.block.lessons[1] ?? '');
        await h.writeExam(transaction, north(), {
          date: '2026-10-26',
          start: '10:00',
          end: '10:45',
          subjectId: s.english,
          rooms: [
            { roomId: await room(), groups: [s.first], invigilators: [smith] },
            { roomId: await room(), groups: [s.second], invigilators: [jones] },
          ],
        });
      });
      expect(await h.blockClasses(s.block.block)).toEqual([]);
      expect(
        await refusal(
          h.place(north(), { date: '2026-10-26', start: '10:00', end: '10:45' }, [
            { classId: s.oxford },
          ]),
        ),
      ).toMatchObject({ constraint: 'time_claims_class_excl' });
      // A whole-class exam of the class at that time too.
      expect(
        await refusal(
          h.exam(north(), {
            date: '2026-10-26',
            start: '10:00',
            end: '10:45',
            rooms: [
              {
                roomId: await room(),
                classes: [s.oxford],
                invigilators: [await h.teacher(north())],
              },
            ],
          }),
        ),
      ).toMatchObject({ constraint: 'time_claims_class_excl' });
    });

    it('passes the two blocks of a double lesson, and refuses two lessons with another slot between them', async () => {
      const oxford = await h.schoolClass(north());
      const english = await h.state.kit.load.classes.subject({ grades: [7] });
      const first = await h.group(north(), [oxford], english);
      const pair = '0192a3b4-0000-7000-8000-000000000001';
      const one = await h.place(
        north(),
        { date: '2026-10-27', start: '09:00', end: '09:45', pairId: pair },
        [{ groupId: first, subjectId: english, cancel: true }],
      );
      const two = await h.place(
        north(),
        { date: '2026-10-27', start: '09:55', end: '10:40', pairId: pair },
        [{ groupId: first, subjectId: english, cancel: true }],
      );
      const hall = await room();
      const written = await h.exam(north(), {
        date: '2026-10-27',
        start: '09:00',
        end: '10:40',
        subjectId: english,
        rooms: [{ roomId: hall, groups: [first], invigilators: [await h.teacher(north())] }],
      });
      const blocks = (await h.examClaims(written.exam))
        .map((c) => c.block_id)
        .filter(Boolean)
        .sort();
      expect(blocks).toEqual([one.block, two.block].sort());

      // Slots 1 and 3 of a group, with slot 2 between them.
      const second = await h.group(north(), [await h.schoolClass(north())], english);
      await h.place(north(), { date: '2026-10-27', start: '11:00', end: '11:45' }, [
        { groupId: second, subjectId: english, cancel: true },
      ]);
      await h.place(north(), { date: '2026-10-27', start: '12:45', end: '13:30' }, [
        { groupId: second, subjectId: english, cancel: true },
      ]);
      expect(
        await refusal(
          h.exam(north(), {
            date: '2026-10-27',
            start: '11:00',
            end: '13:30',
            subjectId: english,
            rooms: [
              { roomId: await room(), groups: [second], invigilators: [await h.teacher(north())] },
            ],
          }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'exam_group_slots' });
    });

    it('refuses an exam that starts or ends outside the group’s lesson, or with the lesson not cancelled', async () => {
      const s = await split('2026-10-28');
      const hall = await room();
      const smith = await h.teacher(north());
      const sitting = (start: string, end: string) => ({
        date: '2026-10-28',
        start,
        end,
        subjectId: s.english,
        rooms: [{ roomId: hall, groups: [s.first], invigilators: [smith] }],
      });
      expect(await refusal(h.exam(north(), sitting('09:00', '09:45')))).toMatchObject({
        constraint: 'exam_group_slots',
      });
      await h.inBranch(north(), (transaction) => cancelIn(transaction, s.block.lessons[0] ?? ''));
      expect(await refusal(h.exam(north(), sitting('09:00', '10:00')))).toMatchObject({
        constraint: 'exam_group_slots',
      });
      expect(await refusal(h.exam(north(), sitting('08:50', '09:45')))).toMatchObject({
        constraint: 'exam_group_slots',
      });
      expect(await refusal(h.exam(north(), sitting('11:00', '11:45')))).toMatchObject({
        constraint: 'exam_group_slots',
      });
      await h.exam(north(), sitting('09:00', '09:45'));
    });

    it('refuses the group’s lesson restored, or its block moved away, while the exam stands', async () => {
      const s = await split('2026-10-29');
      const smith = await h.teacher(north());
      await h.inBranch(north(), async (transaction) => {
        await cancelIn(transaction, s.block.lessons[0] ?? '');
        await h.writeExam(transaction, north(), {
          date: '2026-10-29',
          start: '09:00',
          end: '09:45',
          subjectId: s.english,
          rooms: [{ roomId: await room(), groups: [s.first], invigilators: [smith] }],
        });
      });
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .updateTable('lessons')
              .set({ cancel_cause: null })
              .where('id', '=', s.block.lessons[0] ?? '')
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'exam_group_slots' });
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .updateTable('lesson_blocks')
              .set({ starts_at: at('2026-10-29', '11:00'), ends_at: at('2026-10-29', '11:45') })
              .where('id', '=', s.block.block)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'exam_group_slots' });
    });

    it('moves the group claims with the block when the exam and its block move together, in both orders (spec review 4)', async () => {
      for (const examFirst of [true, false]) {
        const s = await split(
          '2026-10-30',
          examFirst ? '09:00' : '11:00',
          examFirst ? '09:45' : '11:45',
        );
        const start = examFirst ? '09:00' : '11:00';
        const end = examFirst ? '09:45' : '11:45';
        const later = examFirst ? ['10:00', '10:45'] : ['12:00', '12:45'];
        const written = await h.inBranch(north(), async (transaction) => {
          await cancelIn(transaction, s.block.lessons[0] ?? '');
          return h.writeExam(transaction, north(), {
            date: '2026-10-30',
            start,
            end,
            subjectId: s.english,
            rooms: [
              { roomId: await room(), groups: [s.first], invigilators: [await h.teacher(north())] },
            ],
          });
        });
        const moveExam = (transaction: Parameters<typeof cancelIn>[0]) =>
          transaction
            .updateTable('exams')
            .set({
              starts_at: at('2026-10-30', later[0] ?? ''),
              ends_at: at('2026-10-30', later[1] ?? ''),
            })
            .where('id', '=', written.exam)
            .execute();
        const moveBlock = (transaction: Parameters<typeof cancelIn>[0]) =>
          transaction
            .updateTable('lesson_blocks')
            .set({
              starts_at: at('2026-10-30', later[0] ?? ''),
              ends_at: at('2026-10-30', later[1] ?? ''),
            })
            .where('id', '=', s.block.block)
            .execute();
        await h.inBranch(north(), async (transaction) => {
          if (examFirst) {
            await moveExam(transaction);
            await moveBlock(transaction);
          } else {
            await moveBlock(transaction);
            await moveExam(transaction);
          }
        });
        const group = (await h.examClaims(written.exam)).find((c) => c.kind === 'exam_group_class');
        expect(group?.during).toContain(examFirst ? '05:00:00+00' : '07:00:00+00');
      }
    });

    it('refuses an exam over one half of a double lesson of the group (build review, should-fix 3)', async () => {
      const oxford = await h.schoolClass(north());
      const english = await h.state.kit.load.classes.subject({ grades: [7] });
      const team = await h.group(north(), [oxford], english);
      const pair = '0192a3b4-0000-7000-8000-000000000002';
      await h.place(north(), { date: '2026-11-25', start: '09:00', end: '09:45', pairId: pair }, [
        { groupId: team, subjectId: english, cancel: true },
      ]);
      await h.place(north(), { date: '2026-11-25', start: '09:55', end: '10:40', pairId: pair }, [
        { groupId: team, subjectId: english },
      ]);
      expect(
        await refusal(
          h.exam(north(), {
            date: '2026-11-25',
            start: '09:00',
            end: '09:45',
            subjectId: english,
            rooms: [
              { roomId: await room(), groups: [team], invigilators: [await h.teacher(north())] },
            ],
          }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'exam_group_slots' });
    });

    it('refuses three blocks of the group, and two blocks of two different pairs (build review, should-fix 4)', async () => {
      const english = await h.state.kit.load.classes.subject({ grades: [7] });
      const three = await h.group(north(), [await h.schoolClass(north())], english);
      for (const [start, end] of [
        ['09:00', '09:45'],
        ['09:50', '10:35'],
        ['10:40', '11:25'],
      ] as const) {
        await h.place(north(), { date: '2026-11-26', start, end }, [
          { groupId: three, subjectId: english, cancel: true },
        ]);
      }
      expect(
        await refusal(
          h.exam(north(), {
            date: '2026-11-26',
            start: '09:00',
            end: '11:25',
            subjectId: english,
            rooms: [
              { roomId: await room(), groups: [three], invigilators: [await h.teacher(north())] },
            ],
          }),
        ),
      ).toMatchObject({ constraint: 'exam_group_slots' });
      // Two consecutive blocks, each the only block of its own pair.
      const two = await h.group(north(), [await h.schoolClass(north())], english);
      await h.place(
        north(),
        {
          date: '2026-11-26',
          start: '12:00',
          end: '12:45',
          pairId: '0192a3b4-0000-7000-8000-000000000003',
        },
        [{ groupId: two, subjectId: english, cancel: true }],
      );
      await h.place(
        north(),
        {
          date: '2026-11-26',
          start: '12:50',
          end: '13:35',
          pairId: '0192a3b4-0000-7000-8000-000000000004',
        },
        [{ groupId: two, subjectId: english, cancel: true }],
      );
      expect(
        await refusal(
          h.exam(north(), {
            date: '2026-11-26',
            start: '12:00',
            end: '13:35',
            subjectId: english,
            rooms: [
              { roomId: await room(), groups: [two], invigilators: [await h.teacher(north())] },
            ],
          }),
        ),
      ).toMatchObject({ constraint: 'exam_group_slots' });
    });

    it('checks a group row and a change of the exam’s subject at the same moment one after the other (build review, must-fix 2)', async () => {
      const oxford = await h.schoolClass(north());
      const english = await h.state.kit.load.classes.subject({ grades: [7] });
      const team = await h.group(north(), [oxford], english);
      await h.place(north(), { date: '2026-11-27', start: '09:00', end: '09:45' }, [
        { groupId: team, subjectId: english, cancel: true },
      ]);
      const written = await h.exam(north(), {
        date: '2026-11-27',
        start: '09:00',
        end: '09:45',
        subjectId: english,
        rooms: [
          {
            roomId: await room(),
            classes: [await h.schoolClass(north())],
            invigilators: [await h.teacher(north())],
          },
        ],
      });
      const held = holding(
        (work) => h.inBranch(north(), work),
        async (transaction) => {
          await transaction
            .updateTable('exams')
            .set({ subject_id: h.state.subject })
            .where('id', '=', written.exam)
            .execute();
          await sql`set constraints exams_group_subject immediate`.execute(transaction);
        },
      );
      await held.ready;
      const second = outcome(
        h.inBranch(north(), (transaction) =>
          transaction
            .insertInto('exam_room_classes')
            .values({
              branch_id: north(),
              exam_id: written.exam,
              exam_room_id: written.rooms[0] ?? '',
              group_id: team,
            })
            .execute(),
        ),
      );
      await h.untilWaiting(1);
      held.release();
      await held.done;
      expect(await second).toBe('exam_group_subject');
    });

    it('refuses a group whose subject is not the exam’s, on insert and on a change of the exam’s subject', async () => {
      const s = await split('2026-11-18');
      const hall = await room();
      const smith = await h.teacher(north());
      await h.inBranch(north(), (transaction) => cancelIn(transaction, s.block.lessons[0] ?? ''));
      expect(
        await refusal(
          h.exam(north(), {
            date: '2026-11-18',
            start: '09:00',
            end: '09:45',
            rooms: [{ roomId: hall, groups: [s.first], invigilators: [smith] }],
          }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'exam_group_subject' });
      const written = await h.exam(north(), {
        date: '2026-11-18',
        start: '09:00',
        end: '09:45',
        subjectId: s.english,
        rooms: [{ roomId: hall, groups: [s.first], invigilators: [smith] }],
      });
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .updateTable('exams')
              .set({ subject_id: h.state.subject })
              .where('id', '=', written.exam)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'exam_group_subject' });
    });

    it('checks an exam of a group and a restore of its lesson at the same moment one after the other', async () => {
      const s = await split('2026-11-19');
      await h.inBranch(north(), (transaction) => cancelIn(transaction, s.block.lessons[0] ?? ''));
      const hall = await room();
      const smith = await h.teacher(north());
      const held = holding(
        (work) => h.inBranch(north(), work),
        async (transaction) => {
          await h.writeExam(transaction, north(), {
            date: '2026-11-19',
            start: '09:00',
            end: '09:45',
            subjectId: s.english,
            rooms: [{ roomId: hall, groups: [s.first], invigilators: [smith] }],
          });
          await sql`set constraints exams_group_slots, exam_room_classes_group_slots immediate`.execute(
            transaction,
          );
        },
      );
      await held.ready;
      const second = outcome(
        h.inBranch(north(), async (transaction) => {
          await transaction
            .updateTable('lessons')
            .set({ cancel_cause: null })
            .where('id', '=', s.block.lessons[0] ?? '')
            .execute();
          await sql`set constraints lessons_exam_group_slots immediate`.execute(transaction);
        }),
      );
      await h.untilWaiting(1);
      held.release();
      await held.done;
      expect(await second).toBe('exam_group_slots');
    });
  });

  describe('a class out of a block for an exam (lesson_block_class_outs)', () => {
    /** 10 Brown and 10 Green feed a two-class group with a lesson at 09:00. */
    async function shared(date: string) {
      const brown = await h.schoolClass(north(), 10);
      const green = await h.schoolClass(north(), 10);
      const sport = await h.state.kit.load.classes.subject({ grades: [10] });
      const team = await h.group(north(), [brown, green], sport);
      const block = await h.place(north(), { date, start: '09:00', end: '09:45' }, [
        { groupId: team, subjectId: sport },
      ]);
      return { brown, green, block };
    }

    it('takes 10 Brown out of the block for its exam and leaves 10 Green in it; refuses the exam without the row', async () => {
      const s = await shared('2026-11-20');
      const brownExam = async () => ({
        date: '2026-11-20',
        start: '09:00',
        end: '10:30',
        rooms: [
          { roomId: await room(), classes: [s.brown], invigilators: [await h.teacher(north())] },
        ],
      });
      expect(await refusal(h.exam(north(), await brownExam()))).toMatchObject({
        constraint: 'time_claims_class_excl',
      });
      await h.exam(north(), {
        ...(await brownExam()),
        outs: [{ blockId: s.block.block, classId: s.brown }],
      });
      expect(await h.blockClasses(s.block.block)).toEqual([s.green]);
    });

    it('brings the class back when the exam is cancelled (correction 1)', async () => {
      const s = await shared('2026-11-23');
      const written = await h.exam(north(), {
        date: '2026-11-23',
        start: '09:00',
        end: '10:30',
        rooms: [
          { roomId: await room(), classes: [s.brown], invigilators: [await h.teacher(north())] },
        ],
        outs: [{ blockId: s.block.block, classId: s.brown }],
      });
      expect(await h.blockClasses(s.block.block)).toEqual([s.green]);
      await h.inBranch(north(), (transaction) =>
        transaction
          .updateTable('exams')
          .set({ cancel_cause: 'cancelled' })
          .where('id', '=', written.exam)
          .execute(),
      );
      expect((await h.blockClasses(s.block.block)).sort()).toEqual([s.brown, s.green].sort());
      expect(await h.examClaims(written.exam)).toEqual([]);
    });

    it('refuses the cancel, and the out row taken away, when the class’s time in the block was taken meanwhile (correction 1)', async () => {
      // The block runs 09:00 to 09:45 and the exam 09:30 to 10:30: while 10 Brown
      // is out of the block, 09:00 to 09:30 is free for it.
      const s = await shared('2026-11-24');
      const written = await h.exam(north(), {
        date: '2026-11-24',
        start: '09:30',
        end: '10:30',
        rooms: [
          { roomId: await room(), classes: [s.brown], invigilators: [await h.teacher(north())] },
        ],
        outs: [{ blockId: s.block.block, classId: s.brown }],
      });
      // Taking the out row away while the exam stands brings the class back
      // into the block, against the exam's own claim.
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .deleteFrom('lesson_block_class_outs')
              .where('exam_id', '=', written.exam)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'time_claims_class_excl' });
      await h.place(north(), { date: '2026-11-24', start: '09:00', end: '09:30' }, [
        { classId: s.brown },
      ]);
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .updateTable('exams')
              .set({ cancel_cause: 'cancelled' })
              .where('id', '=', written.exam)
              .execute(),
          ),
        ),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'time_claims_class_excl' });
    });

    it('brings the class back when it no longer sits the exam, and refuses that while its time was taken (build review, must-fix 1)', async () => {
      const s = await shared('2026-11-30');
      const green = await h.schoolClass(north(), 10);
      const written = await h.exam(north(), {
        date: '2026-11-30',
        start: '09:30',
        end: '10:30',
        rooms: [
          {
            roomId: await room(),
            classes: [s.brown, green],
            invigilators: [await h.teacher(north())],
          },
        ],
        outs: [{ blockId: s.block.block, classId: s.brown }],
      });
      await h.place(north(), { date: '2026-11-30', start: '09:00', end: '09:30' }, [
        { classId: s.brown },
      ]);
      const removeBrown = () =>
        h.inBranch(north(), (transaction) =>
          transaction
            .deleteFrom('exam_room_classes')
            .where('exam_id', '=', written.exam)
            .where('class_id', '=', s.brown)
            .execute(),
        );
      expect(await refusal(removeBrown())).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'time_claims_class_excl',
      });

      const t = await shared('2026-12-01');
      const other = await h.exam(north(), {
        date: '2026-12-01',
        start: '09:00',
        end: '09:45',
        rooms: [
          { roomId: await room(), classes: [t.brown], invigilators: [await h.teacher(north())] },
          {
            roomId: await room(),
            classes: [await h.schoolClass(north(), 10)],
            invigilators: [await h.teacher(north())],
          },
        ],
        outs: [{ blockId: t.block.block, classId: t.brown }],
      });
      // Its room taken away (the cascade removes the class row).
      await h.inBranch(north(), (transaction) =>
        transaction
          .deleteFrom('exam_rooms')
          .where('id', '=', other.rooms[0] ?? '')
          .execute(),
      );
      expect((await h.blockClasses(t.block.block)).sort()).toEqual([t.brown, t.green].sort());
    });

    it('brings the class back when the exam moves away from the block (correction 1)', async () => {
      const s = await shared('2026-12-02');
      const written = await h.exam(north(), {
        date: '2026-12-02',
        start: '09:00',
        end: '09:45',
        rooms: [
          { roomId: await room(), classes: [s.brown], invigilators: [await h.teacher(north())] },
        ],
        outs: [{ blockId: s.block.block, classId: s.brown }],
      });
      await h.inBranch(north(), (transaction) =>
        transaction
          .updateTable('exams')
          .set({ starts_at: at('2026-12-02', '11:00'), ends_at: at('2026-12-02', '11:45') })
          .where('id', '=', written.exam)
          .execute(),
      );
      expect((await h.blockClasses(s.block.block)).sort()).toEqual([s.brown, s.green].sort());
    });

    it('brings the class back when the block moves away from the exam', async () => {
      const s = await shared('2026-11-09');
      await h.exam(north(), {
        date: '2026-11-09',
        start: '09:00',
        end: '09:45',
        rooms: [
          { roomId: await room(), classes: [s.brown], invigilators: [await h.teacher(north())] },
        ],
        outs: [{ blockId: s.block.block, classId: s.brown }],
      });
      await h.inBranch(north(), (transaction) =>
        transaction
          .updateTable('lesson_blocks')
          .set({ starts_at: at('2026-11-09', '11:00'), ends_at: at('2026-11-09', '11:45') })
          .where('id', '=', s.block.block)
          .execute(),
      );
      expect((await h.blockClasses(s.block.block)).sort()).toEqual([s.brown, s.green].sort());
    });

    it('refuses an out row whose exam is cancelled, does not seat the class, or does not overlap the block', async () => {
      const s = await shared('2026-11-10');
      const other = await h.exam(north(), {
        date: '2026-11-10',
        start: '11:00',
        end: '11:45',
        rooms: [
          { roomId: await room(), classes: [s.brown], invigilators: [await h.teacher(north())] },
        ],
      });
      const out = (classId: string) =>
        h.inBranch(north(), (transaction) =>
          transaction
            .insertInto('lesson_block_class_outs')
            .values({
              branch_id: north(),
              block_id: s.block.block,
              class_id: classId,
              exam_id: other.exam,
            })
            .execute(),
        );
      // Does not overlap the block.
      expect(await refusal(out(s.brown))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'lesson_block_class_out_exam',
      });
      const sitting = await h.exam(north(), {
        date: '2026-11-10',
        start: '09:00',
        end: '09:45',
        rooms: [
          {
            roomId: await room(),
            classes: [await h.schoolClass(north(), 10)],
            invigilators: [await h.teacher(north())],
          },
        ],
      });
      // Does not seat 10 Green.
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .insertInto('lesson_block_class_outs')
              .values({
                branch_id: north(),
                block_id: s.block.block,
                class_id: s.green,
                exam_id: sitting.exam,
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_block_class_out_exam' });
      // Cancelled.
      await h.inBranch(north(), (transaction) =>
        transaction
          .updateTable('exams')
          .set({ cancel_cause: 'cancelled' })
          .where('id', '=', other.exam)
          .execute(),
      );
      expect(await refusal(out(s.brown))).toMatchObject({
        constraint: 'lesson_block_class_out_exam',
      });
    });
  });

  describe('the exam row', () => {
    it('refuses a start or end on another local date, a date outside the year, and an end before the start, on insert and on update', async () => {
      const p = await plain('09:00', '10:00', '2026-11-11');
      // The date of 12 November with times of 11 November.
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .insertInto('exams')
              .values({
                branch_id: north(),
                academic_year_id: h.yearOf(north()),
                exam_date: '2026-11-12',
                starts_at: at('2026-11-11', '09:00'),
                ends_at: at('2026-11-11', '10:00'),
                first_slot: 1,
                last_slot: 1,
                title: 'Quarter exam in English',
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'exam_date' });
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .insertInto('exams')
              .values({
                branch_id: north(),
                academic_year_id: h.yearOf(north()),
                exam_date: '2027-07-01',
                starts_at: at('2027-07-01', '09:00'),
                ends_at: at('2027-07-01', '10:00'),
                first_slot: 1,
                last_slot: 1,
                title: 'Summer exam',
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'exam_year' });
      expect(
        await refusal(h.exam(north(), { ...p.input, start: '10:00', end: '09:00' })),
      ).toMatchObject({ constraint: 'exams_order_check' });
      const written = await h.exam(north(), p.input);
      const update = (values: { exam_date?: string; starts_at?: Date; ends_at?: Date }) =>
        h.inBranch(north(), (transaction) =>
          transaction.updateTable('exams').set(values).where('id', '=', written.exam).execute(),
        );
      expect(await refusal(update({ exam_date: '2026-11-12' }))).toMatchObject({
        constraint: 'exam_date',
      });
      expect(
        await refusal(
          update({
            exam_date: '2027-07-01',
            starts_at: at('2027-07-01', '09:00'),
            ends_at: at('2027-07-01', '10:00'),
          }),
        ),
      ).toMatchObject({ constraint: 'exam_year' });
    });

    it('refuses a class of another year (exam_unit_year)', async () => {
      const p = await plain('11:00', '12:00', '2026-11-11');
      const other = await h.state.kit.load.classes.year(
        north(),
        'planned',
        '2027-09-01',
        '2028-05-31',
      );
      const later = await h.state.kit.load.classes.schoolClass(north(), other, { grade: 7 });
      expect(
        await refusal(
          h.exam(north(), {
            ...p.input,
            rooms: [{ roomId: p.hall, classes: [later], invigilators: [p.smith] }],
          }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'exam_unit_year' });
    });

    it('refuses an exam with no room, a room with no class or no invigilator (exam_incomplete)', async () => {
      const p = await plain('13:00', '14:00', '2026-11-11');
      expect(await refusal(h.exam(north(), { ...p.input, rooms: [] }))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'exam_incomplete',
      });
      expect(
        await refusal(
          h.exam(north(), { ...p.input, rooms: [{ roomId: p.hall, invigilators: [p.smith] }] }),
        ),
      ).toMatchObject({ constraint: 'exam_incomplete' });
      expect(
        await refusal(
          h.exam(north(), { ...p.input, rooms: [{ roomId: p.hall, classes: [p.oxford] }] }),
        ),
      ).toMatchObject({ constraint: 'exam_incomplete' });
    });

    it('refuses the delete of the last invigilator, the last class and the last room', async () => {
      const p = await plain('15:00', '16:00', '2026-11-11');
      const written = await h.exam(north(), p.input);
      const remove = (table: 'exam_invigilators' | 'exam_room_classes' | 'exam_rooms') =>
        h.inBranch(north(), (transaction) =>
          transaction.deleteFrom(table).where('exam_id', '=', written.exam).execute(),
        );
      for (const table of ['exam_invigilators', 'exam_room_classes', 'exam_rooms'] as const) {
        expect(await refusal(remove(table))).toMatchObject({ constraint: 'exam_incomplete' });
      }
    });

    it('checks two deletes of a room’s two invigilators at the same moment one after the other', async () => {
      // Completeness under concurrency, not a lock of its own: every write of an
      // exam's rows meets on the exam row in exam_claims already (the test
      // below proves that lock).
      const p = await plain('09:00', '10:00', '2026-11-13');
      const jones = await h.teacher(north());
      const written = await h.exam(north(), {
        ...p.input,
        rooms: [{ roomId: p.hall, classes: [p.oxford], invigilators: [p.smith, jones] }],
      });
      const removeIn = (
        transaction: Parameters<Parameters<typeof h.inBranch>[1]>[0],
        staffId: string,
      ) =>
        transaction
          .deleteFrom('exam_invigilators')
          .where('exam_id', '=', written.exam)
          .where('staff_id', '=', staffId)
          .execute();
      const held = holding(
        (work) => h.inBranch(north(), work),
        async (transaction) => {
          await removeIn(transaction, p.smith);
          await sql`set constraints exam_invigilators_complete immediate`.execute(transaction);
        },
      );
      await held.ready;
      const second = outcome(
        h.inBranch(north(), async (transaction) => {
          await removeIn(transaction, jones);
          await sql`set constraints exam_invigilators_complete immediate`.execute(transaction);
        }),
      );
      await h.untilWaiting(1);
      held.release();
      await held.done;
      expect(await second).toBe('exam_incomplete');
    });

    it('leaves no claim of an invigilator taken away by another writer at the same moment', async () => {
      // Without the exam's lock the second writer would read the first
      // invigilator still there and write its claim again.
      const p = await plain('13:00', '14:00', '2026-11-16');
      const jones = await h.teacher(north());
      const brown = await h.teacher(north());
      const written = await h.exam(north(), {
        ...p.input,
        rooms: [{ roomId: p.hall, classes: [p.oxford], invigilators: [p.smith, jones, brown] }],
      });
      const removeIn = (
        transaction: Parameters<Parameters<typeof h.inBranch>[1]>[0],
        staffId: string,
      ) =>
        transaction
          .deleteFrom('exam_invigilators')
          .where('exam_id', '=', written.exam)
          .where('staff_id', '=', staffId)
          .execute();
      const held = holding(
        (work) => h.inBranch(north(), work),
        async (transaction) => {
          await removeIn(transaction, p.smith);
        },
      );
      await held.ready;
      const second = outcome(h.inBranch(north(), (transaction) => removeIn(transaction, jones)));
      await h.untilWaiting(1);
      held.release();
      await held.done;
      expect(await second).toBe('written');
      const invigilators = (await h.examClaims(written.exam))
        .filter((claim) => claim.kind === 'exam_invigilator')
        .map((claim) => claim.teacher_id);
      expect(invigilators).toEqual([brown]);
    });

    it('frees invigilators, rooms and classes of a cancelled exam, and refuses the cancel taken back or changed', async () => {
      const p = await plain('11:00', '12:00', '2026-11-13');
      const written = await h.exam(north(), p.input);
      const setCause = (cause: 'cancelled' | 'day_off' | null) =>
        h.inBranch(north(), (transaction) =>
          transaction
            .updateTable('exams')
            .set({ cancel_cause: cause })
            .where('id', '=', written.exam)
            .execute(),
        );
      await setCause('cancelled');
      expect(await h.examClaims(written.exam)).toEqual([]);
      await h.place(north(), { date: '2026-11-13', start: '11:00', end: '11:45' }, [
        { classId: p.oxford, teacherId: p.smith, roomId: p.hall },
      ]);
      expect(await refusal(setCause(null))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'exam_cancel_final',
      });
      expect(await refusal(setCause('day_off'))).toMatchObject({ constraint: 'exam_cancel_final' });
    });

    it('moves the room claim with a changed exam room, and refuses a room that holds a lesson then (build review, should-fix 5)', async () => {
      const p = await plain('09:00', '10:00', '2026-12-03');
      const written = await h.exam(north(), p.input);
      const lab = await room();
      const taken = await room();
      await h.place(north(), { date: '2026-12-03', start: '09:30', end: '10:15' }, [
        { classId: await h.schoolClass(north()), roomId: taken },
      ]);
      const moveRoom = (roomId: string) =>
        h.inBranch(north(), (transaction) =>
          transaction
            .updateTable('exam_rooms')
            .set({ room_id: roomId })
            .where('id', '=', written.rooms[0] ?? '')
            .execute(),
        );
      await moveRoom(lab);
      expect(
        (await h.examClaims(written.exam))
          .filter((c) => c.kind === 'exam_room')
          .map((c) => c.room_id),
      ).toEqual([lab]);
      expect(await refusal(moveRoom(taken))).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'time_claims_room_excl',
      });
    });

    it('moves every claim with the exam’s time and refuses a move into a taken time', async () => {
      const p = await plain('13:00', '14:00', '2026-11-13');
      const written = await h.exam(north(), p.input);
      await h.place(north(), { date: '2026-11-13', start: '15:00', end: '15:45' }, [
        { classId: await h.schoolClass(north()), roomId: p.hall },
      ]);
      const move = (start: string, end: string) =>
        h.inBranch(north(), (transaction) =>
          transaction
            .updateTable('exams')
            .set({ starts_at: at('2026-11-13', start), ends_at: at('2026-11-13', end) })
            .where('id', '=', written.exam)
            .execute(),
        );
      await move('09:00', '10:00');
      for (const claim of await h.examClaims(written.exam)) {
        expect(claim.during).toContain('04:00:00+00');
      }
      expect(await refusal(move('15:00', '16:00'))).toMatchObject({
        constraint: 'time_claims_room_excl',
      });
    });

    it('refuses a direct write of an exam claim, and any delete of an exam', async () => {
      const p = await plain('16:00', '17:00', '2026-11-13');
      const written = await h.exam(north(), p.input);
      const cambridge = await h.schoolClass(north());
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction
              .insertInto('time_claims')
              .values({
                branch_id: north(),
                kind: 'exam_class',
                exam_id: written.exam,
                holder: written.exam,
                during: '[2026-11-13 12:00+00,2026-11-13 13:00+00)',
                class_id: cambridge,
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'time_claims_direct' });
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction.deleteFrom('time_claims').where('exam_id', '=', written.exam).execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'time_claims_direct' });
      expect(
        await refusal(
          h.inBranch(north(), (transaction) =>
            transaction.deleteFrom('exams').where('id', '=', written.exam).execute(),
          ),
        ),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });
});
