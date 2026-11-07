import { describe, expect, it } from 'vitest';
import {
  announcementEditSchema,
  announcementRecordSchema,
  announcementsMonthQuerySchema,
  announcementsQuerySchema,
  monthDates,
} from './announcements.js';

const news = {
  kind: 'news',
  title: 'Sports day',
  body: 'All classes meet in the yard.',
  event: null,
  audience: { kind: 'branch' },
  forStaff: true,
  forParents: true,
} as const;

const event = {
  firstDate: '2026-11-20',
  lastDate: '2026-11-20',
  startsAt: '09:00',
  endsAt: '11:30',
  place: 'Main hall',
};

describe('an announcement record (task 11.7)', () => {
  it('takes news without dates and an event with them', () => {
    expect(announcementRecordSchema.safeParse(news).success).toBe(true);
    expect(announcementRecordSchema.safeParse({ ...news, kind: 'event', event }).success).toBe(
      true,
    );
  });

  it('refuses news with dates and an event without them', () => {
    expect(announcementRecordSchema.safeParse({ ...news, event }).success).toBe(false);
    expect(announcementRecordSchema.safeParse({ ...news, kind: 'event' }).success).toBe(false);
  });

  it('refuses an announcement for nobody', () => {
    expect(
      announcementRecordSchema.safeParse({ ...news, forStaff: false, forParents: false }).success,
    ).toBe(false);
  });

  it('refuses a last date before the first, an end without a start and an end before the start', () => {
    const parse = (part: object) =>
      announcementRecordSchema.safeParse({ ...news, kind: 'event', event: { ...event, ...part } })
        .success;
    expect(parse({ lastDate: '2026-11-19' })).toBe(false);
    expect(parse({ startsAt: null })).toBe(false);
    expect(parse({ endsAt: '09:00' })).toBe(false);
    expect(parse({ startsAt: null, endsAt: null })).toBe(true);
    expect(parse({ startsAt: '24:00', endsAt: null })).toBe(false);
  });

  it('takes grades 0 to 11 once each, and classes once each', () => {
    const parse = (audience: object) =>
      announcementRecordSchema.safeParse({ ...news, audience }).success;
    expect(parse({ kind: 'grades', grades: [0, 11] })).toBe(true);
    expect(parse({ kind: 'grades', grades: [12] })).toBe(false);
    expect(parse({ kind: 'grades', grades: [5, 5] })).toBe(false);
    expect(parse({ kind: 'grades', grades: [] })).toBe(false);
    const id = '0190c2a4-6a3b-7c1d-8e2f-1a2b3c4d5e6f';
    expect(parse({ kind: 'classes', classIds: [id] })).toBe(true);
    expect(parse({ kind: 'classes', classIds: [id, id.toUpperCase()] })).toBe(false);
    // A field the audience has no use for is refused, never dropped.
    expect(parse({ kind: 'branch', grades: [5] })).toBe(false);
  });

  it('trims the title and keeps to the bounds', () => {
    const parsed = announcementRecordSchema.parse({ ...news, title: '  Sports day  ' });
    expect(parsed.title).toBe('Sports day');
    expect(announcementRecordSchema.safeParse({ ...news, title: '   ' }).success).toBe(false);
    expect(announcementRecordSchema.safeParse({ ...news, title: 'x'.repeat(121) }).success).toBe(
      false,
    );
    expect(announcementRecordSchema.safeParse({ ...news, body: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('lets an edit change the text and the event part only (decision 5)', () => {
    expect(
      announcementEditSchema.safeParse({ title: 'a', body: 'b', event: null, version: 1 }).success,
    ).toBe(true);
    expect(
      announcementEditSchema.safeParse({
        title: 'a',
        body: 'b',
        event: null,
        version: 1,
        audience: { kind: 'school' },
      }).success,
    ).toBe(false);
  });
});

describe('the queries and months', () => {
  it('refuses a misspelled field and a wrong month', () => {
    expect(announcementsQuerySchema.safeParse({ archive: 'true' }).success).toBe(false);
    expect(announcementsMonthQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(announcementsMonthQuerySchema.safeParse({ month: '2026-02' }).success).toBe(true);
  });

  it('gives the first and last date of a month', () => {
    expect(monthDates('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(monthDates('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(monthDates('2026-12')).toEqual({ first: '2026-12-01', last: '2026-12-31' });
  });
});
