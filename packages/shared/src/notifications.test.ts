import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_KIND_FORMAT,
  NOTIFICATION_KIND_MAX_LENGTH,
  NOTIFICATION_KIND_NAMES,
  NOTIFICATION_KINDS,
  NOTIFICATION_LIST_LIMIT,
  WEEK_CHANGE_KINDS,
  WEEK_KINDS,
  WEEK_LESSONS_MAX,
  notificationKindSchema,
  notificationListSchema,
  notificationSchema,
} from './notifications.js';

const ITEM = {
  id: '0199b2f4-6c1e-7a52-9d3b-4f8e2a1c7b60',
  kind: 'sample.message',
  data: { text: 'A message of the tests.' },
  branchId: null,
  branchName: null,
  createdAt: '2026-10-08T04:00:00.000Z',
  readAt: null,
};

// docs/spec/10-portal-notifications-release-2.md, Notifications: messages are
// written from templates; a kind names the template, its data fills it.
describe('the kinds of notification', () => {
  it('each have a name in the format of the database check and a schema of their data', () => {
    for (const [kind, schema] of Object.entries(NOTIFICATION_KINDS)) {
      expect(kind, kind).toMatch(NOTIFICATION_KIND_FORMAT);
      expect(kind.length).toBeLessThanOrEqual(NOTIFICATION_KIND_MAX_LENGTH);
      expect(schema.safeParse(undefined).success, kind).toBe(false);
    }
    expect(NOTIFICATION_KIND_NAMES).toEqual(Object.keys(NOTIFICATION_KINDS));
  });

  it('are the only kinds the kind schema accepts', () => {
    expect(notificationKindSchema.parse('sample.message')).toBe('sample.message');
    expect(notificationKindSchema.safeParse('timetable.changed').success).toBe(false);
    expect(notificationKindSchema.safeParse('').success).toBe(false);
  });

  it('sample.message carries a text and nothing else', () => {
    const schema = NOTIFICATION_KINDS['sample.message'];

    expect(schema.parse({ text: 'Hello' })).toEqual({ text: 'Hello' });
    expect(schema.safeParse({ text: '' }).success).toBe(false);
    expect(schema.safeParse({ text: 'x'.repeat(501) }).success).toBe(false);
    expect(schema.safeParse({ text: 'Hello', extra: 1 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });
});

// Task 5.5c-3a: "One notice per person per event, with the week before and
// after" (edge/timetable, After publishing).
describe('the notices of a timetable change', () => {
  const lesson = {
    date: '2026-10-19',
    start: '08:00',
    end: '08:45',
    unit: '7 Oxford',
    subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
    room: 'Room 101',
    cancelled: false,
    changed: false,
  };
  const week = { number: '3', weekStart: '2026-10-19', before: [lesson], after: [] };

  it('carry the number, the week and its lessons on both sides, for each kind', () => {
    for (const kind of WEEK_CHANGE_KINDS) {
      const schema = NOTIFICATION_KINDS[kind];
      expect(schema.parse(week)).toEqual(week);
      expect(schema.safeParse({ ...week, after: [{ ...lesson, room: null }] }).success).toBe(true);
    }
  });

  // Task 5.5c-3b, decision 3: a Tutor change publishes no version, so its
  // notice carries the week and no number.
  it('carry the week of a Tutor change without a number, and refuse one with a number', () => {
    const schema = NOTIFICATION_KINDS['timetable.tutor_changed'];
    const tutorWeek = { weekStart: week.weekStart, before: week.before, after: week.after };
    expect(schema.parse(tutorWeek)).toEqual(tutorWeek);
    expect(schema.safeParse(week).success).toBe(false);
    expect(schema.safeParse({ ...tutorWeek, before: [{ ...lesson, teacher: 'x' }] }).success).toBe(
      false,
    );
    // Task 5.6a-1 (decision 10, Look first: a pinned list widened by a new kind),
    // task 5.6b-1 (decision 8, Look first: the calendar change's kind) and
    // task 5.6b-4a (decision 6, Look first: the template change's kind),
    // task 5.6b-5a (decision 9, Look first: the quarter change's kind) and
    // task 5.6c-1 (decision 2, Look first: the exam's kind) and
    // task 5.7b-1 (decision 7 build note, Look first: the substitute's kind).
    expect(WEEK_KINDS).toEqual([
      ...WEEK_CHANGE_KINDS,
      'timetable.tutor_changed',
      'timetable.day_changed',
      'timetable.substitution_assigned',
      'timetable.calendar_changed',
      'timetable.template_changed',
      'timetable.quarters_changed',
      'timetable.exam_changed',
    ]);
  });

  // Task 5.6b-5a, decision 9: a quarter change carries the dates it wrote and the week, no name or number.
  it('carry the dates and the week of a quarter change', () => {
    const schema = NOTIFICATION_KINDS['timetable.quarters_changed'];
    const quartersWeek = {
      firstDate: '2026-11-01',
      lastDate: '2026-11-08',
      weekStart: week.weekStart,
      before: week.before,
      after: week.after,
    };
    expect(schema.parse(quartersWeek)).toEqual(quartersWeek);
    expect(schema.safeParse({ ...quartersWeek, name: 'Navruz' }).success).toBe(false);
    expect(schema.safeParse({ ...quartersWeek, firstDate: '01.11.2026' }).success).toBe(false);
  });

  // Task 5.6b-4a, decision 6: a template change carries its date and the week, no name or number.
  it('carry the date and the week of a template change', () => {
    const schema = NOTIFICATION_KINDS['timetable.template_changed'];
    const templateWeek = {
      from: '2026-10-19',
      weekStart: week.weekStart,
      before: week.before,
      after: week.after,
    };
    expect(schema.parse(templateWeek)).toEqual(templateWeek);
    expect(schema.safeParse({ ...templateWeek, name: 'Navruz' }).success).toBe(false);
    expect(schema.safeParse({ ...templateWeek, from: '19.10.2026' }).success).toBe(false);
  });

  // Task 5.6b-1, decision 8: a calendar change carries its entry's name and dates and the week, no number.
  it('carry the entry and the week of a calendar change without a number', () => {
    const schema = NOTIFICATION_KINDS['timetable.calendar_changed'];
    const calendarWeek = {
      name: 'Navruz',
      firstDate: '2026-10-19',
      lastDate: '2026-10-19',
      weekStart: week.weekStart,
      before: week.before,
      after: week.after,
    };
    expect(schema.parse(calendarWeek)).toEqual(calendarWeek);
    expect(schema.safeParse({ ...calendarWeek, number: '3' }).success).toBe(false);
    expect(schema.safeParse({ ...calendarWeek, name: '' }).success).toBe(false);
    expect(
      schema.parse({ ...calendarWeek, also: { weekStart: week.weekStart, before: [], after: [] } }),
    ).toHaveProperty('also');
  });

  // Task 5.6c-3b, decision 3: the invigilators of an exam a calendar or
  // template change moved or cancelled, in the event's own notice, with the
  // week or alone.
  it('carry the exams changed of an invigilator in a calendar or template notice, with the week or alone, never an empty list', () => {
    const moved = {
      title: 'Quarter exam',
      date: '2026-10-19',
      action: 'moved',
      invigilation: { start: '09:00', end: '09:45', room: 'Hall' },
    };
    const cancelled = {
      title: 'Quarter exam',
      date: '2026-10-19',
      action: 'cancelled',
      invigilation: null,
    };
    const entry = { name: 'Open day', firstDate: '2026-10-19', lastDate: '2026-10-19' };
    const calendar = NOTIFICATION_KINDS['timetable.calendar_changed'];
    const template = NOTIFICATION_KINDS['timetable.template_changed'];
    const weekOnly = { weekStart: week.weekStart, before: week.before, after: week.after };
    expect(calendar.parse({ ...entry, exams: [moved, cancelled] })).toEqual({
      ...entry,
      exams: [moved, cancelled],
    });
    expect(calendar.parse({ ...entry, ...weekOnly, exams: [moved] })).toHaveProperty('exams');
    expect(template.parse({ from: '2026-10-19', exams: [cancelled] })).toHaveProperty('exams');
    expect(template.parse({ from: '2026-10-19', ...weekOnly, exams: [moved] })).toHaveProperty(
      'weekStart',
    );
    // Neither a week nor an exam: nothing to tell.
    expect(calendar.safeParse(entry).success).toBe(false);
    expect(calendar.safeParse({ ...entry, exams: [] }).success).toBe(false);
    expect(template.safeParse({ from: '2026-10-19', exams: [] }).success).toBe(false);
    expect(calendar.safeParse({ ...entry, exams: [{ ...moved, action: 'created' }] }).success).toBe(
      false,
    );
    expect(
      calendar.safeParse({
        ...entry,
        exams: [{ ...moved, invigilation: { start: '9:00', end: '09:45', room: 'Hall' } }],
      }).success,
    ).toBe(false);
  });

  // Task 5.6b-2c-1, decision 4: an exam cancelled by a day off carries the entry, the exam and its date.
  it('carry the entry, the title and the date of an exam a day off cancelled', () => {
    const schema = NOTIFICATION_KINDS['timetable.exam_day_off'];
    const cancelled = { name: 'Navruz', title: 'Quarter exam', date: '2026-10-19' };
    expect(schema.parse(cancelled)).toEqual(cancelled);
    expect(schema.safeParse({ ...cancelled, title: '' }).success).toBe(false);
    expect(schema.safeParse({ ...cancelled, date: '19 October' }).success).toBe(false);
    expect(schema.safeParse({ ...cancelled, weekStart: '2026-10-19' }).success).toBe(false);
  });

  // Task 5.6a-1, decision 10: a one-day change carries the week without a number.
  it('carry the week of a one-day change without a number, and refuse one with a number', () => {
    const schema = NOTIFICATION_KINDS['timetable.day_changed'];
    const dayWeek = { weekStart: week.weekStart, before: week.before, after: week.after };
    expect(schema.parse(dayWeek)).toEqual(dayWeek);
    expect(schema.safeParse(week).success).toBe(false);
  });

  it('refuse a teacher in a lesson, a time not on the clock and more lessons than the most', () => {
    const schema = NOTIFICATION_KINDS['timetable.published'];
    // A vacancy never appears in a notice: a lesson names no teacher.
    expect(schema.safeParse({ ...week, before: [{ ...lesson, teacher: 'x' }] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...week, before: [{ ...lesson, start: '8:00' }] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...week, before: [{ ...lesson, end: '24:00' }] }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        ...week,
        after: Array.from({ length: WEEK_LESSONS_MAX + 1 }, () => lesson),
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...week, number: '0' }).success).toBe(false);
    expect(schema.safeParse({ ...week, weekStart: '19.10.2026' }).success).toBe(false);
  });
});

describe('the answers about notifications', () => {
  it('describe one notification', () => {
    expect(notificationSchema.parse(ITEM)).toEqual(ITEM);
    expect(
      notificationSchema.parse({
        ...ITEM,
        branchId: '0199b2f4-6c1e-7a52-9d3b-4f8e2a1c7b61',
        branchName: 'North',
        readAt: '2026-10-08T05:00:00.000Z',
      }).branchName,
    ).toBe('North');
  });

  it('take a kind the tab may not know, as long as it is written like one', () => {
    expect(notificationSchema.safeParse({ ...ITEM, kind: 'timetable.changed' }).success).toBe(true);
    expect(notificationSchema.safeParse({ ...ITEM, kind: 'Timetable' }).success).toBe(false);
  });

  it.each([
    ['no id', { ...ITEM, id: undefined }],
    ['a moment without a time zone', { ...ITEM, createdAt: '2026-10-08 04:00' }],
    ['a branch that is not an id', { ...ITEM, branchId: 'north' }],
    ['data that is not an object', { ...ITEM, data: 'text' }],
  ])('refuse %s', (_name, item) => {
    expect(notificationSchema.safeParse(item).success).toBe(false);
  });

  it('describe the list with its unread count and at most the latest ones', () => {
    expect(notificationListSchema.parse({ unreadCount: 0, items: [] })).toEqual({
      unreadCount: 0,
      items: [],
    });
    expect(notificationListSchema.safeParse({ unreadCount: -1, items: [] }).success).toBe(false);
    expect(notificationListSchema.safeParse({ unreadCount: 1.5, items: [] }).success).toBe(false);
    const tooMany = Array.from({ length: NOTIFICATION_LIST_LIMIT + 1 }, () => ITEM);
    expect(notificationListSchema.safeParse({ unreadCount: 0, items: tooMany }).success).toBe(
      false,
    );
  });
});
