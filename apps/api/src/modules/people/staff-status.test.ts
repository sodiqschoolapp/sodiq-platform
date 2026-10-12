import { describe, expect, it } from 'vitest';
import { planStatusChange, roleEndFor, type StoredStatusRow } from './staff-status.js';

const row = (
  id: string,
  status: StoredStatusRow['status'],
  validFrom: string,
  validUntil: string | null,
): StoredStatusRow => ({ id, status, validFrom, validUntil });

const TODAY = '2026-10-10';

// `edge/people-roles-accounts`, Staff over time; decision 4 and correction 6
// of the review of pull request #53: today or later, a planned change is
// taken back and replaced, nothing grows.
describe('a status change', () => {
  it('cuts the row in force and writes the new one', () => {
    expect(
      planStatusChange(
        [row('a', 'active', '2026-09-01', null)],
        { status: 'inactive', from: '2026-10-20' },
        TODAY,
      ),
    ).toEqual({
      cuts: [{ id: 'a', validUntil: '2026-10-20' }],
      writes: [{ status: 'inactive', validFrom: '2026-10-20', validUntil: null }],
      withdrawn: [],
    });
  });

  it('refuses a date in the past, before the admission, and the status already in force', () => {
    const rows = [row('a', 'active', '2026-09-01', null)];
    expect(planStatusChange(rows, { status: 'left', from: '2026-10-09' }, TODAY)).toEqual({
      refusal: 'status_from_past',
    });
    expect(
      planStatusChange(
        [row('a', 'active', '2026-11-01', null)],
        { status: 'left', from: '2026-10-20' },
        TODAY,
      ),
    ).toEqual({ refusal: 'status_before_admission' });
    expect(planStatusChange(rows, { status: 'active', from: '2026-10-20' }, TODAY)).toEqual({
      refusal: 'status_unchanged',
    });
  });

  it('takes back a planned change and replaces it with one dated before it', () => {
    const rows = [
      row('a', 'active', '2026-09-01', '2026-10-20'),
      row('b', 'left', '2026-10-20', null),
    ];
    expect(planStatusChange(rows, { status: 'inactive', from: '2026-10-15' }, TODAY)).toEqual({
      cuts: [
        { id: 'b', validUntil: '2026-10-20' },
        { id: 'a', validUntil: '2026-10-15' },
      ],
      writes: [{ status: 'inactive', validFrom: '2026-10-15', validUntil: null }],
      withdrawn: [rows[1]],
    });
  });

  it('takes back a planned change and fills the time up to one dated after it', () => {
    const rows = [
      row('a', 'active', '2026-09-01', '2026-10-20'),
      row('b', 'inactive', '2026-10-20', null),
    ];
    expect(planStatusChange(rows, { status: 'left', from: '2026-10-25' }, TODAY)).toEqual({
      cuts: [{ id: 'b', validUntil: '2026-10-20' }],
      writes: [
        { status: 'active', validFrom: '2026-10-20', validUntil: '2026-10-25' },
        { status: 'left', validFrom: '2026-10-25', validUntil: null },
      ],
      withdrawn: [rows[1]],
    });
  });

  it('cancels a planned change by asking for the status in force', () => {
    const rows = [
      row('a', 'active', '2026-09-01', '2026-10-20'),
      row('b', 'left', '2026-10-20', null),
    ];
    expect(planStatusChange(rows, { status: 'active', from: '2026-10-12' }, TODAY)).toEqual({
      cuts: [{ id: 'b', validUntil: '2026-10-20' }],
      writes: [{ status: 'active', validFrom: '2026-10-20', validUntil: null }],
      withdrawn: [rows[1]],
    });
  });

  it('takes back a row that starts on the date, and skips rows already taken back', () => {
    const rows = [
      row('a', 'active', '2026-09-01', '2026-10-10'),
      row('x', 'left', '2026-10-05', '2026-10-05'),
      row('b', 'inactive', '2026-10-10', null),
    ];
    expect(planStatusChange(rows, { status: 'left', from: '2026-10-10' }, TODAY)).toEqual({
      cuts: [{ id: 'b', validUntil: '2026-10-10' }],
      writes: [{ status: 'left', validFrom: '2026-10-10', validUntil: null }],
      withdrawn: [rows[2]],
    });
  });

  it('ends a role at the start of the date, or at its own start when that is later', () => {
    const date = new Date('2026-10-20T00:00:00+05:00');
    expect(roleEndFor(new Date('2026-09-01T00:00:00+05:00'), date)).toEqual(date);
    const later = new Date('2026-10-25T00:00:00+05:00');
    expect(roleEndFor(later, date)).toEqual(later);
  });
});
