import { describe, expect, it } from 'vitest';
import { departmentChangeKind } from './department-moves.js';

// Task 3.6b-3, decisions 4 and 6 of pull request #123. Ids are invented.
const STEAM = 'steam';
const NATIONAL = 'national';
const GENERAL = 'general';

describe('departmentChangeKind', () => {
  it('without a plan: the department in force is no change, another one a move', () => {
    const shown = { departmentId: STEAM, move: null };
    expect(departmentChangeKind(shown, STEAM, null)).toBe('none');
    expect(departmentChangeKind(shown, NATIONAL, null)).toBe('move');
    expect(departmentChangeKind(shown, NATIONAL, '2026-11-02')).toBe('move');
  });

  it('with a plan: the planned department with its date or none is no change, with another date a move', () => {
    const shown = { departmentId: STEAM, move: { departmentId: NATIONAL, startsOn: '2026-11-02' } };
    expect(departmentChangeKind(shown, NATIONAL, null)).toBe('none');
    expect(departmentChangeKind(shown, NATIONAL, '2026-11-02')).toBe('none');
    expect(departmentChangeKind(shown, NATIONAL, '2026-11-05')).toBe('move');
  });

  it('with a plan: the department in force cancels it, another one changes it', () => {
    const shown = { departmentId: STEAM, move: { departmentId: NATIONAL, startsOn: '2026-11-02' } };
    expect(departmentChangeKind(shown, STEAM, null)).toBe('cancel');
    expect(departmentChangeKind(shown, STEAM, '2026-11-02')).toBe('cancel');
    expect(departmentChangeKind(shown, GENERAL, '2026-11-02')).toBe('move');
  });
});
