import { describe, expect, it } from 'vitest';
import {
  ROOM_CLOSURE_REASON_MAX,
  roomClosureEditSchema,
  roomClosureMoveSchema,
  roomClosureRecordSchema,
} from './room-closures.js';

const ROOM = '0199a000-0000-7000-8000-000000000002';

// Task 5.7a-2b: the bounds of a closure (`room_closures_reason_check` and
// `room_closures_days_check`, 0098) and the days a save may send (decisions 3
// and 4).
describe('roomClosureRecordSchema', () => {
  const record = (fields: object) =>
    roomClosureRecordSchema.safeParse({
      roomId: ROOM,
      startsOn: '2026-10-19',
      endsOn: '2026-11-06',
      reason: 'Repairs',
      ...fields,
    }).success;

  it('takes a closure with both days and a reason', () => {
    expect(record({})).toBe(true);
    expect(record({ endsOn: '2026-10-19' })).toBe(true);
    expect(record({ reason: 'x'.repeat(ROOM_CLOSURE_REASON_MAX) })).toBe(true);
  });

  it('refuses no last day, a last day before the first, an empty or long reason', () => {
    expect(record({ endsOn: null })).toBe(false);
    expect(record({ endsOn: '2026-10-18' })).toBe(false);
    expect(record({ reason: '   ' })).toBe(false);
    expect(record({ reason: 'x'.repeat(ROOM_CLOSURE_REASON_MAX + 1) })).toBe(false);
  });
});

describe('roomClosureEditSchema', () => {
  const edit = (endsOn: string | null) =>
    roomClosureEditSchema.safeParse({ startsOn: '2026-10-19', endsOn }).success;

  it('takes the day before the first, which ends a closure of today at the save', () => {
    expect(edit('2026-10-18')).toBe(true);
    expect(edit('2026-10-30')).toBe(true);
  });

  it('refuses a last day two days before the first, and no last day', () => {
    expect(edit('2026-10-17')).toBe(false);
    expect(edit(null)).toBe(false);
  });
});

describe('roomClosureMoveSchema', () => {
  it('needs a room and a reason, and nothing else', () => {
    expect(roomClosureMoveSchema.safeParse({ roomId: ROOM, reason: 'Repairs' }).success).toBe(true);
    expect(roomClosureMoveSchema.safeParse({ roomId: ROOM, reason: ' ' }).success).toBe(false);
    expect(
      roomClosureMoveSchema.safeParse({ roomId: ROOM, reason: 'Repairs', extra: 1 }).success,
    ).toBe(false);
  });
});
