import { describe, expect, it } from 'vitest';
import { publishRefusals, startChoices } from './publish.js';
import type { RuleResult } from './rules.js';

const year = {
  firstDate: '2026-09-02',
  lastDate: '2027-05-31',
  quarters: [
    { firstDate: '2026-09-02', lastDate: '2026-10-31' },
    { firstDate: '2026-11-09', lastDate: '2026-12-28' },
    { firstDate: '2027-01-11', lastDate: '2027-03-20' },
    { firstDate: '2027-03-30', lastDate: '2027-05-31' },
  ],
};

describe('startChoices', () => {
  // 06, How surprises are prevented, Start date: "next Monday by default and
  // tomorrow at the earliest, with the first day of each coming quarter
  // offered as a shortcut".
  it('starts tomorrow at the earliest and next Monday by default', () => {
    // 2026-10-14 is a Wednesday.
    expect(startChoices('2026-10-14', year)).toEqual({
      earliest: '2026-10-15',
      defaultStart: '2026-10-19',
      quarterStarts: ['2026-11-09', '2027-01-11', '2027-03-30'],
    });
  });

  it('takes the Monday after when today is a Monday, and Sunday gives tomorrow', () => {
    expect(startChoices('2026-10-19', year).defaultStart).toBe('2026-10-26');
    expect(startChoices('2026-10-18', year).defaultStart).toBe('2026-10-19');
  });

  it('keeps a quarter that starts tomorrow and leaves out one that starts today', () => {
    expect(startChoices('2026-11-08', year).quarterStarts).toEqual([
      '2026-11-09',
      '2027-01-11',
      '2027-03-30',
    ]);
    expect(startChoices('2026-11-09', year).quarterStarts).toEqual(['2027-01-11', '2027-03-30']);
  });

  // edge/timetable, Versions and drafts: in a planned year "a version can be
  // published there, starting on the first school day" (decision 15).
  it('defaults to the first day of a planned year', () => {
    expect(startChoices('2026-08-10', year)).toEqual({
      earliest: '2026-08-11',
      defaultStart: '2026-09-02',
      quarterStarts: ['2026-09-02', '2026-11-09', '2027-01-11', '2027-03-30'],
    });
  });
});

const result = (rule: RuleResult['rule'], severity: RuleResult['severity']): RuleResult => ({
  rule,
  severity,
  day: '1',
  lessonIds: ['lesson-1'],
});

describe('publishRefusals', () => {
  // 06, Editing in the grid: "A draft with errors cannot be published."
  it('refuses a blocked result and keeps a warning a warning', () => {
    const blocked = result('teacher_double', 'blocked');
    const warning = result('room_capacity', 'warning');
    expect(publishRefusals([blocked, warning])).toEqual({
      blocked: [blocked],
      mismatched: [],
      warnings: [warning],
    });
  });

  // 06, Rules, last row: the difference from the load "blocks publishing,
  // unless the load row is marked 'deliberately short' with a reason"; the
  // engine reports no `load_mismatch` for a short row so marked.
  it('refuses a difference from the load, which the engine leaves out for a row marked short', () => {
    const mismatch: RuleResult = {
      rule: 'load_mismatch',
      severity: 'warning',
      day: '',
      lessonIds: [],
      detail: { loadRowId: 'row-1', placed: 1, lessonsPerWeek: 2 },
    };
    expect(publishRefusals([mismatch])).toEqual({
      blocked: [],
      mismatched: [mismatch],
      warnings: [],
    });
  });
});
