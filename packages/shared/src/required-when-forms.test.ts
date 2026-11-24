import { describe, expect, it } from 'vitest';
import { roleGiveRequiredWhen, roleGiveSchema } from './accounts.js';
import { announcementFormRequiredWhen, announcementFormSchema } from './announcements.js';
import { calendarEntryRecordSchema, calendarEntryRequiredWhen } from './calendar.js';
import { assignmentRecordSchema, assignmentRequiredWhen } from './day-templates.js';
import { examBodySchema, examCreateBodySchema, examRequiredWhen } from './exams.js';
import { exemptionCreateRequiredWhen, exemptionCreateSchema } from './exemptions.js';
import { ratingEntrySaveRequiredWhen } from './journal-rating.js';
import { expectTiedTo } from './required-when-kit.js';
import { roomRecordRequiredWhen, roomRecordSchema } from './setup.js';
import { staffTeachingRequiredWhen, staffTeachingSchema } from './staff.js';
import {
  loadRowRecordRequiredWhen,
  loadRowRecordSchema,
  loadRowTeacherNeeded,
} from './timetable.js';
import { vacancyRecordRequiredWhen, vacancyRecordSchema } from './vacancies.js';

// Task 11.18 (`12`, No lost work: "A field without the mark may be left
// empty"): each map of a field required only in some states is tied to the
// refines of its schema (`expectTiedTo`, `required-when-kit.ts`).

const ID = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('requiredWhen beside the schemas of the forms (task 11.18)', () => {
  it('a room: how many lessons a shared room holds', () => {
    const room = {
      name: '101',
      floorId: ID(1),
      type: 'classroom',
      capacity: 28,
      status: 'in_use',
      shared: false,
      maxSimultaneousLessons: null,
    };
    expectTiedTo(
      roomRecordSchema,
      [room, { ...room, shared: true, maxSimultaneousLessons: 3 }],
      roomRecordRequiredWhen,
    );
  });

  it('a teacher and a vacancy: a language once there is a subject', () => {
    const subjects = [{ subjectId: ID(2), grades: [7, 8] }];
    expectTiedTo(
      staffTeachingSchema,
      [
        { subjects, languages: ['uz'] },
        { subjects: [], languages: ['ru'] },
      ],
      staffTeachingRequiredWhen,
    );
    const vacancy = {
      name: 'English vacancy 2',
      departmentId: ID(1),
      subjects,
      languages: ['uz'],
      weeklyLessons: 18,
      dailyLessons: 6,
    };
    expectTiedTo(
      vacancyRecordSchema,
      [vacancy, { ...vacancy, subjects: [] }],
      vacancyRecordRequiredWhen,
    );
  });

  it('an exemption: the last day of a temporary one', () => {
    const base = {
      studentIds: [ID(1)],
      kind: 'temporary',
      subjectIds: null,
      startDate: '2026-10-20',
      endDate: '2026-10-22',
      slots: null,
      category: 'illness',
      detail: 'A certificate from the clinic',
      choices: [],
    };
    expectTiedTo(
      exemptionCreateSchema,
      [base, { ...base, kind: 'full', endDate: null }],
      exemptionCreateRequiredWhen,
    );
  });

  it('a calendar entry: the template of a special day, both grades or neither', () => {
    const dayOff = {
      kind: 'day_off',
      name: 'Navruz',
      firstDate: '2027-03-21',
      lastDate: '2027-03-21',
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: null,
      followsWeekday: null,
      examWeek: null,
    };
    expectTiedTo(
      calendarEntryRecordSchema,
      [
        dayOff,
        { ...dayOff, gradeFrom: 5, gradeTo: 9 },
        { ...dayOff, kind: 'special_day', dayTemplateId: ID(3), followsWeekday: 1 },
      ],
      calendarEntryRequiredWhen,
    );
  });

  it('a template set at a level: its weekday and its grades', () => {
    const base = { dayTemplateId: ID(3), from: '2026-10-12' };
    expectTiedTo(
      assignmentRecordSchema,
      [
        { ...base, level: 'default', weekday: null, gradeFrom: null, gradeTo: null },
        { ...base, level: 'grades', weekday: null, gradeFrom: 9, gradeTo: 11 },
        { ...base, level: 'weekday', weekday: 5, gradeFrom: null, gradeTo: null },
        { ...base, level: 'weekday_grades', weekday: 1, gradeFrom: 1, gradeTo: 4 },
      ],
      assignmentRequiredWhen,
    );
  });

  it('an announcement: the audience’s grades or classes, its readers, an event’s dates and start', () => {
    const news = {
      kind: 'news',
      title: 'Sports day',
      body: 'All classes meet in the yard.',
      audience: 'branch',
      grades: [],
      classIds: [],
      forStaff: true,
      forParents: false,
      firstDate: null,
      lastDate: null,
      startsAt: null,
      endsAt: null,
      place: null,
    };
    expectTiedTo(
      announcementFormSchema,
      [
        news,
        { ...news, audience: 'grades', grades: [5, 6], forStaff: false, forParents: true },
        { ...news, audience: 'classes', classIds: [ID(4)] },
        {
          ...news,
          kind: 'event',
          firstDate: '2026-11-20',
          lastDate: '2026-11-20',
          startsAt: '09:00',
          endsAt: '11:30',
          place: 'Main hall',
        },
      ],
      announcementFormRequiredWhen,
    );
    // Staff or parents, one of the two: each is marked while the other is not ticked.
    expect(announcementFormRequiredWhen.forParents?.({ forStaff: false }, {})).toBe(true);
    expect(announcementFormRequiredWhen.forParents?.({ forStaff: true }, {})).toBe(false);
    expect(announcementFormRequiredWhen.forStaff?.({ forParents: false }, {})).toBe(true);
  });

  it('a role from a date: the subjects of an appointment', () => {
    const give = { role: 'head_teacher', branchId: null, from: '2026-10-12', subjectIds: [ID(5)] };
    expectTiedTo(roleGiveSchema, [give], roleGiveRequiredWhen);
    expect(roleGiveRequiredWhen.subjectIds?.({ role: 'teacher' }, {})).toBe(false);
    expect(roleGiveRequiredWhen.subjectIds?.({ role: 'senior_head_teacher' }, {})).toBe(true);
  });

  it('a load row: a class or a group, and the teacher of a new row that is not a Tutor row', () => {
    const row = {
      classId: ID(6),
      groupId: null,
      subjectId: ID(7),
      teacherId: ID(8),
      lessonsPerWeek: 3,
      roomId: null,
      roomType: null,
      doubleLessons: false,
    };
    expectTiedTo(
      loadRowRecordSchema,
      [row, { ...row, classId: null, groupId: ID(9) }],
      loadRowRecordRequiredWhen,
    );
    // `load_teacher_needed` (timetable.service.ts): the server's rule, outside the schema.
    expect(loadRowTeacherNeeded(true, false)).toBe(true);
    expect(loadRowTeacherNeeded(true, true)).toBe(false);
    expect(loadRowTeacherNeeded(false, false)).toBe(false);
  });

  it('an exam: the subject of a rating exam, and the reason of lessons kept cancelled', () => {
    const body = {
      date: '2026-10-19',
      firstLesson: 1,
      lastLesson: 1,
      title: 'Quarter exam',
      subjectId: ID(10),
      rooms: [{ roomId: ID(11), classIds: [ID(12)], groupIds: [], invigilatorIds: [ID(13)] }],
    };
    expectTiedTo(
      examCreateBodySchema,
      [body, { ...body, ratingExam: true }, { ...body, subjectId: null }],
      examRequiredWhen,
    );
    expectTiedTo(
      examBodySchema,
      [{ ...body, keepCancelled: [ID(14)], keepReason: 'Moved to Friday' }],
      examRequiredWhen,
    );
  });

  it('a rating entry: a reason under a correction or over a stored entry', () => {
    // `rating_exam_reason` (rating.service.ts): the server's rule, outside the schema.
    const reason = ratingEntrySaveRequiredWhen.reason;
    expect(reason?.({ correction: false }, {})).toBe(false);
    expect(reason?.({ correction: false }, { stored: true })).toBe(true);
    expect(reason?.({ correction: true }, {})).toBe(true);
  });
});
