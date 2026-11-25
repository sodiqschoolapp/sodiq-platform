import { describe, expect, it } from 'vitest';
import {
  BRIEFING_READS,
  DRAFT_PLAN_UNIT,
  EXPLAIN_RESULT,
  figuresOf,
  figuresOutsideBreakdown,
  helpersOf,
  rankSubstitutes,
  SUGGEST_SUBSTITUTES,
  SUBSTITUTE_CHANGE,
  SUBSTITUTE_READS,
  todaysBriefing,
  TODAYS_BRIEFING,
  UNIT_READS,
  ITEM_CHANGE,
  EXPLAIN_READS,
  type HelperContext,
  type HelperRead,
  type OfferedTeacher,
} from './helpers.js';
import type { RoleLines } from './tools.js';

// Task 11.23 (`02`, Assistant, Helpers; Calculation stays here). All names are invented.

const line = { group: 'timetable', description: 'x' } as const;
const linesOf = (routes: readonly string[]): RoleLines =>
  Object.fromEntries(routes.map((route) => [route, line]));

const teacher = (name: string, change: Partial<OfferedTeacher> = {}): OfferedTeacher => ({
  id: `00000000-0000-4000-8000-${String(name.length).padStart(12, '0')}`,
  name,
  group: 'subject',
  language: false,
  warnings: [],
  lessonsThatDay: 0,
  inBuilding: false,
  ...change,
});

describe('the ranking of substitutes (task 11.23, plan decision 6)', () => {
  it('puts the language-marked last of the whole list, then the group, fewest lessons that day, already in the building, then name; it keeps every teacher the route offered', () => {
    const offered = [
      teacher('Zarina Tursunova', { language: true }),
      teacher('Botir Aliyev', { group: 'department' }),
      teacher('Dilnoza Karimova', { lessonsThatDay: 3 }),
      teacher('Anvar Qodirov', { lessonsThatDay: 1 }),
      teacher('Farrux Nazarov', { lessonsThatDay: 1, inBuilding: true }),
      teacher('Kamola Yusupova', { group: 'other' }),
    ].map((one, index) => ({ ...one, id: `00000000-0000-4000-8000-00000000000${String(index)}` }));
    const ranked = rankSubstitutes(offered);
    expect(ranked.map((one) => one.name)).toEqual([
      'Farrux Nazarov',
      'Anvar Qodirov',
      'Dilnoza Karimova',
      'Botir Aliyev',
      'Kamola Yusupova',
      'Zarina Tursunova',
    ]);
    // Review correction 1: the set of ids out is the set the route returned.
    expect(new Set(ranked.map((one) => one.id))).toEqual(new Set(offered.map((one) => one.id)));
    expect(ranked).toHaveLength(offered.length);
  });
});

describe('the figure check (task 11.23, plan decision 9, review correction 3)', () => {
  it('reads whole numbers, decimals with a point or a comma, and a percent attached or apart', () => {
    expect(figuresOf('Classwork 82%, homework 82 %, attendance 82,5 and 82.50; grade 4.')).toEqual([
      '82',
      '82',
      '82.5',
      '82.5',
      '4',
    ]);
  });

  it('finds a figure that is not in the breakdown, also one a rounding away, and never splits a decimal', () => {
    const allowed = new Set(['82', '40', '4']);
    expect(figuresOutsideBreakdown('Classwork 82% at weight 40; grade 4.', allowed)).toEqual([]);
    expect(figuresOutsideBreakdown('Classwork 83%.', allowed)).toEqual(['83']);
    // "82,5" is never read as 82 and 5: a figure the check cannot match does not pass.
    expect(figuresOutsideBreakdown('Classwork 82,5 %.', allowed)).toEqual(['82.5']);
    expect(figuresOutsideBreakdown('Weighted: 32.8 points.', allowed)).toEqual(['32.8']);
  });
});

describe('which helpers a role is given (task 11.23, plan decisions 3, 4 and 8)', () => {
  const every = linesOf([
    ...Object.values(BRIEFING_READS),
    ...Object.values(SUBSTITUTE_READS),
    SUBSTITUTE_CHANGE,
    UNIT_READS.plan,
    ITEM_CHANGE,
    ...Object.values(EXPLAIN_READS),
  ]);
  const names = (role: Parameters<typeof helpersOf>[0], lines: RoleLines) =>
    helpersOf(role, lines).map((one) => one.name);

  it('gives the briefing to the Super Admin and the Academic Vice Principal, the unit to the Teacher alone', () => {
    expect(names('super_admin', every)).toEqual([
      TODAYS_BRIEFING,
      SUGGEST_SUBSTITUTES,
      EXPLAIN_RESULT,
    ]);
    expect(names('academic_vice_principal', every)).toEqual([
      TODAYS_BRIEFING,
      SUGGEST_SUBSTITUTES,
      EXPLAIN_RESULT,
    ]);
    expect(names('teacher', every)).toEqual([SUGGEST_SUBSTITUTES, DRAFT_PLAN_UNIT, EXPLAIN_RESULT]);
  });

  it('gives a helper only while the reads it needs are on; the briefing while any of its reads is', () => {
    const without = (route: string) => linesOf(Object.keys(every).filter((one) => one !== route));
    expect(names('super_admin', without(SUBSTITUTE_READS.day))).not.toContain(SUGGEST_SUBSTITUTES);
    expect(names('super_admin', without(SUBSTITUTE_CHANGE))).not.toContain(SUGGEST_SUBSTITUTES);
    expect(names('teacher', without(ITEM_CHANGE))).not.toContain(DRAFT_PLAN_UNIT);
    expect(names('teacher', without(EXPLAIN_READS.lessons))).not.toContain(EXPLAIN_RESULT);
    expect(names('super_admin', without(BRIEFING_READS.earlyWarning))).toContain(TODAYS_BRIEFING);
    expect(names('super_admin', linesOf([]))).toEqual([]);
  });
});

describe('the briefing digest (task 11.23, plan decision 5)', () => {
  const TODAY = '2026-11-25';
  const bodies: Record<string, unknown> = {
    [BRIEFING_READS.absences]: {
      absences: [
        {
          id: 'a1',
          staff: { id: 's1', name: 'Olimova Sevara' },
          startsOn: '2026-11-24',
          endsOn: null,
          state: 'current',
        },
        {
          id: 'a2',
          staff: { id: 's2', name: 'Aliyev Botir' },
          startsOn: '2026-11-30',
          endsOn: null,
          state: 'planned',
        },
      ],
    },
    [BRIEFING_READS.attention]: {
      needsTeacher: [
        {
          cause: 'absence',
          teacher: { name: 'Olimova Sevara' },
          absence: { id: 'a1' },
          lessons: 3,
          firstDate: TODAY,
          lastDate: '2026-11-27',
        },
        {
          cause: 'vacancy',
          teacher: null,
          absence: null,
          lessons: 2,
          firstDate: '2026-11-26',
          lastDate: '2026-11-26',
        },
      ],
    },
    [BRIEFING_READS.unlocks]: {
      requests: [
        {
          person: 'Karimova Dilnoza',
          status: 'sent',
          unit: { name: '7 Oxford' },
          subject: { names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' } },
          date: '2026-11-20',
          reason: 'Ill',
        },
        {
          person: 'Qodirov Anvar',
          status: 'approved',
          unit: { name: '8 Cambridge' },
          subject: null,
          date: null,
          reason: 'x',
        },
      ],
    },
    [BRIEFING_READS.planRequests]: { requests: [], events: [] },
    [BRIEFING_READS.completeness]: {
      plans: [
        {
          journalId: 'j1',
          flag: 'overdue',
          unit: { name: '7 Oxford' },
          subject: { names: { en: 'Physics' } },
          teacher: { name: 'Nazarov Farrux' },
          empty: 4,
        },
        {
          journalId: 'j2',
          flag: null,
          unit: { name: '7 Oxford' },
          subject: { names: { en: 'History' } },
          teacher: null,
          empty: 0,
        },
      ],
    },
  };
  const read = (route: string): Promise<HelperRead> =>
    Promise.resolve(
      route === BRIEFING_READS.earlyWarning
        ? { ok: false, error: 'action_off' }
        : { ok: true, body: bodies[route] },
    );
  const context: HelperContext = {
    role: 'super_admin',
    language: 'en',
    today: TODAY,
    lines: linesOf(Object.values(BRIEFING_READS)),
    read,
    stepsLeft: () => 10,
  };

  it('counts each kind with its rows of today, says none for an empty kind, and names a refused part while keeping the rest', async () => {
    const outcome = await todaysBriefing(context);
    const result = outcome.result as Record<string, Record<string, unknown>>;
    expect(result.absencesToday?.count).toBe(1);
    expect(result.lessonsWithoutTeacher?.count).toBe(1);
    expect(result.lessonsWithoutTeacher?.laterDays).toBe(1);
    expect(result.unlockRequestsWaiting?.count).toBe(1);
    expect(result.planRequestsWaiting?.count).toBe(0);
    expect(result.overduePlans?.count).toBe(1);
    expect(result.earlyWarning).toEqual({ error: 'action_off' });
    expect(outcome.links.map((one) => one.to)).toEqual([
      '/timetable/absences',
      '/journal/unlocks',
      '/plans/requests',
      '/plans/reports',
    ]);
  });
});
