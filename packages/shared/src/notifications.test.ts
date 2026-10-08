import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_KIND_FORMAT,
  NOTIFICATION_KIND_MAX_LENGTH,
  NOTIFICATION_KIND_NAMES,
  NOTIFICATION_KINDS,
  NOTIFICATION_LIST_LIMIT,
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
