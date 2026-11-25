import type { AssistantPlaceLink, AssistantRole, Language } from '@sodiq/shared';
import { linkOf } from './platform-map.js';
import type { ModelTool } from './model.js';
import type { RoleLines } from './tools.js';

/**
 * Task 11.23 (`02`, Assistant, Helpers): four helpers of the assistant, each a tool of the engine
 * that runs only the platform's own reads as the person (the dispatcher, with the chosen role and
 * every switch checked per request; plan decision 2), and gives the model a short digest of what
 * it read. A helper writes nothing and never calculates a result: what it gives is what the reads
 * answered, cut, ordered or counted (`02`, Calculation stays here).
 */
export const TODAYS_BRIEFING = 'todays_briefing';
export const SUGGEST_SUBSTITUTES = 'suggest_substitutes';
export const DRAFT_PLAN_UNIT = 'draft_plan_unit';
export const EXPLAIN_RESULT = 'explain_result';

export const HELPER_TOOLS: readonly string[] = [
  TODAYS_BRIEFING,
  SUGGEST_SUBSTITUTES,
  DRAFT_PLAN_UNIT,
  EXPLAIN_RESULT,
];

/** The most rows of one kind the briefing names (plan decision 5); the rest are counted. */
export const BRIEFING_ROWS = 10;

/** The most teachers named for one lesson; the rest are counted. */
export const SUBSTITUTES_NAMED = 5;

/** The days of an absence the substitutes helper looks at in one call (plan decision 7). */
export const SUBSTITUTE_DAYS = 7;

/** The most works of one kind the explanation gives. */
export const EXPLAIN_WORKS = 60;

export const BRIEFING_READS = {
  absences: 'GET /api/timetable/absences',
  attention: 'GET /api/timetable/attention',
  unlocks: 'GET /api/journal/unlocks',
  planRequests: 'GET /api/plans/requests',
  completeness: 'GET /api/plans/reports/completeness',
  earlyWarning: 'GET /api/results/early-warning',
} as const;

export const SUBSTITUTE_READS = {
  lessons: 'GET /api/timetable/absences/:id/lessons',
  substitutes: 'GET /api/timetable/lessons/:id/substitutes',
  day: 'GET /api/timetable/views/branch',
} as const;

/** The change the substitutes lead to: declared for the model from its next call. */
export const SUBSTITUTE_CHANGE = 'POST /api/timetable/lessons/:id/substitute';

export const UNIT_READS = { plan: 'GET /api/plans/journals/:journalId' } as const;

/** The change a unit's items are proposed with. */
export const ITEM_CHANGE = 'POST /api/plans/journals/:journalId/items';

export const EXPLAIN_READS = {
  results: 'GET /api/results/students/:id',
  lessons: 'GET /api/results/students/:id/lessons',
  journal: 'GET /api/journal/journals/:journalId',
} as const;

const BRIEFING_ROLES: readonly AssistantRole[] = ['super_admin', 'academic_vice_principal'];

const TEXT = { type: 'string' } as const;
const ID = { type: 'string', format: 'uuid' } as const;

export const HELPER_DEFINITIONS: Readonly<Record<string, ModelTool>> = {
  [TODAYS_BRIEFING]: {
    name: TODAYS_BRIEFING,
    description:
      'Answers "what needs me today": reads the branch’s day at once (absences in force today and lessons without a teacher, unlock requests and plan edit requests waiting for a decision, overdue lesson plans, the early-warning list) and gives each kind counted, with its first rows and a link to its page. Answer it as a short list, one line per kind, naming the counts as given.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  [SUGGEST_SUBSTITUTES]: {
    name: SUGGEST_SUBSTITUTES,
    description:
      'For a teacher’s absence, gives each of its lessons not yet substituted (from today, at most 7 days) with the substitutes the platform offers for it, checked by the timetable rules at the lesson’s clock time, ranked: same subject first, then fewest lessons that day, then already in the building. Take the absence id from the absences read. Then propose one substitution per lesson with the substitute tool it declares, naming the teacher, lesson, date and time; never a teacher it did not offer.',
    parameters: {
      type: 'object',
      properties: {
        absenceId: { ...ID, description: 'The id of the absence.' },
        from: { ...TEXT, format: 'date', description: 'The first date (default today).' },
        to: { ...TEXT, format: 'date', description: 'The last date (default 6 days after from).' },
      },
      required: ['absenceId'],
    },
  },
  [DRAFT_PLAN_UNIT]: {
    name: DRAFT_PLAN_UNIT,
    description:
      'For a unit of N lessons of the person’s own lesson plan: gives the next N empty rows of the plan of a journal and quarter (position, lessonId, date, what may be written there now) and the plan window’s state. Then draft every item (topic, objectives, classworks, homeworks) and propose one item per row with the item tool it declares, all in this answer. A row open for text only takes the topic and objectives, no works. When the rows are closed (the window ended), say so and name the edit request; do not propose.',
    parameters: {
      type: 'object',
      properties: {
        journalId: { ...ID, description: 'The journal of the plan.' },
        quarterId: { ...ID, description: 'The quarter (default the quarter of today).' },
        count: { type: 'integer', description: 'How many lessons the unit has.' },
        fromNumber: {
          type: 'integer',
          description: 'The lesson number to start at (default the first empty row).',
        },
      },
      required: ['journalId', 'count'],
    },
  },
  [EXPLAIN_RESULT]: {
    name: EXPLAIN_RESULT,
    description:
      'Explains why a student has a result: gives the platform’s own breakdown of one subject and quarter (each part’s average, the quarter’s weight of each part, the parts left out and why, the shown result and grade, whether provisional, the lessons it is based on, and the works behind the averages). Quote only these figures, as given; never add, multiply or average them. Your answer is checked: a figure not in the breakdown is refused.',
    parameters: {
      type: 'object',
      properties: {
        studentId: { ...ID, description: 'The student.' },
        subjectId: { ...ID, description: 'The subject.' },
        quarterId: { ...ID, description: 'The quarter (default the latest with a result).' },
      },
      required: ['studentId', 'subjectId'],
    },
  },
};

const hasAll = (lines: RoleLines, routes: readonly string[]): boolean =>
  routes.every((route) => Object.hasOwn(lines, route));

/**
 * The helpers offered to the chosen role (plan decisions 3, 4 and 8): the briefing to the Super
 * Admin and the Academic Vice Principal while any of its reads is on (a part off is named
 * `action_off`); the substitutes while their reads and the substitution are on; the unit to the
 * Teacher alone; the explanation while the two results reads are on.
 */
export function helpersOf(role: AssistantRole, lines: RoleLines): ModelTool[] {
  const out: ModelTool[] = [];
  const add = (name: string): void => {
    const definition = HELPER_DEFINITIONS[name];
    if (definition !== undefined) out.push(definition);
  };
  if (
    BRIEFING_ROLES.includes(role) &&
    Object.values(BRIEFING_READS).some((route) => Object.hasOwn(lines, route))
  ) {
    add(TODAYS_BRIEFING);
  }
  if (hasAll(lines, [...Object.values(SUBSTITUTE_READS), SUBSTITUTE_CHANGE])) {
    add(SUGGEST_SUBSTITUTES);
  }
  if (role === 'teacher' && hasAll(lines, [UNIT_READS.plan, ITEM_CHANGE])) {
    add(DRAFT_PLAN_UNIT);
  }
  if (hasAll(lines, [EXPLAIN_READS.results, EXPLAIN_READS.lessons])) {
    add(EXPLAIN_RESULT);
  }
  return out;
}

/** What one read of a helper answered: the body of a success, or why there is none. */
export type HelperRead = { ok: true; body: unknown } | { ok: false; error: string };

/** What the engine gives a helper: its reads as the person, and what is left of the question. */
export interface HelperContext {
  role: AssistantRole;
  language: Language;
  /** The branch's school date of the question (the injected clock). */
  today: string;
  lines: RoleLines;
  /** Runs one read of the role's list as the person, stores it and counts it. */
  read(route: string, args: Record<string, unknown>): Promise<HelperRead>;
  /** The steps a proposal of this question may still take (reads and steps both bounded). */
  stepsLeft(): number;
}

/** What a helper gives back to the engine. */
export interface HelperOutcome {
  /** What the model is given. */
  result: unknown;
  links: AssistantPlaceLink[];
  /** The changes declared for the model from its next call. */
  found: string[];
  /** The figures an answer may quote (the explanation only). */
  figures?: ReadonlySet<string>;
  /** The helper cut its work at a limit: Continue is offered. */
  cut?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const listOf = (value: unknown, key: string): Record<string, unknown>[] => {
  if (!isRecord(value)) return [];
  const list = value[key];
  return Array.isArray(list) ? list.filter(isRecord) : [];
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Clock minutes of the day as "HH:MM". */
export function clockOf(minutes: unknown): string {
  if (typeof minutes !== 'number' || !Number.isInteger(minutes)) return '';
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** A name in the person's language from `{ uz, ru, en }`. */
function nameIn(names: unknown, language: Language): string {
  return isRecord(names) ? text(names[language]) || text(names.en) : '';
}

/** A link of a page the role opens, or none (the map decides, as `link_place`). */
function pageLink(
  role: AssistantRole,
  page: string,
  extra: { params?: Record<string, string>; search?: Record<string, string> } = {},
): AssistantPlaceLink | undefined {
  const pairs = (record: Record<string, string> | undefined) =>
    Object.entries(record ?? {}).map(([name, value]) => ({ name, value }));
  const made = linkOf(role, {
    page,
    ...(extra.params === undefined ? {} : { params: pairs(extra.params) }),
    ...(extra.search === undefined ? {} : { search: pairs(extra.search) }),
  });
  return 'link' in made ? made.link : undefined;
}

/** A kind of the briefing: its count, the rows named, and its page. */
interface BriefingKind {
  count?: number;
  rows?: unknown[];
  more?: number;
  page?: string;
  error?: string;
}

function kindOf(
  rows: unknown[],
  page: AssistantPlaceLink | undefined,
  extra: Record<string, unknown> = {},
): BriefingKind & Record<string, unknown> {
  return {
    count: rows.length,
    rows: rows.slice(0, BRIEFING_ROWS),
    ...(rows.length > BRIEFING_ROWS ? { more: rows.length - BRIEFING_ROWS } : {}),
    ...(page === undefined ? {} : { page: page.to }),
    ...extra,
  };
}

/**
 * The briefing (plan decision 5): each kind read through its own route, a part refused or
 * switched off named by its code and the others kept.
 */
export async function todaysBriefing(context: HelperContext): Promise<HelperOutcome> {
  const { role, today, lines, language } = context;
  const links: AssistantPlaceLink[] = [];
  const linked = (page: string, search?: Record<string, string>) => {
    const link = pageLink(role, page, search === undefined ? {} : { search });
    if (link !== undefined && !links.some((one) => one.to === link.to)) links.push(link);
    return link;
  };
  const run = async (route: string, args: Record<string, unknown>): Promise<HelperRead> =>
    Object.hasOwn(lines, route) ? context.read(route, args) : { ok: false, error: 'action_off' };
  const result: Record<string, unknown> = { today };

  const absences = await run(BRIEFING_READS.absences, {});
  result.absencesToday = absences.ok
    ? kindOf(
        listOf(absences.body, 'absences')
          .filter(
            (one) =>
              text(one.startsOn) <= today &&
              (one.endsOn === null || text(one.endsOn) >= today) &&
              one.state !== 'withdrawn',
          )
          .map((one) => ({
            absenceId: one.id,
            teacher: isRecord(one.staff) ? one.staff.name : null,
            from: one.startsOn,
            to: one.endsOn,
          })),
        linked('/timetable/absences'),
      )
    : { error: absences.error };

  const attention = await run(BRIEFING_READS.attention, {});
  result.lessonsWithoutTeacher = attention.ok
    ? kindOf(
        listOf(attention.body, 'needsTeacher')
          .filter((one) => text(one.firstDate) <= today && text(one.lastDate) >= today)
          .map((one) => ({
            cause: one.cause,
            teacher: isRecord(one.teacher) ? one.teacher.name : null,
            absenceId: isRecord(one.absence) ? one.absence.id : null,
            lessons: one.lessons,
            firstDate: one.firstDate,
            lastDate: one.lastDate,
          })),
        linked('/timetable/absences'),
        {
          laterDays: listOf(attention.body, 'needsTeacher').filter(
            (one) => text(one.firstDate) > today,
          ).length,
        },
      )
    : { error: attention.error };

  const unlocks = await run(BRIEFING_READS.unlocks, { view: 'deciding' });
  result.unlockRequestsWaiting = unlocks.ok
    ? kindOf(
        listOf(unlocks.body, 'requests')
          .filter((one) => one.status === 'sent')
          .map((one) => ({
            person: one.person,
            unit: isRecord(one.unit) ? one.unit.name : null,
            subject: isRecord(one.subject) ? nameIn(one.subject.names, language) : null,
            date: one.date,
            reason: one.reason,
          })),
        linked('/journal/unlocks'),
      )
    : { error: unlocks.error };

  const requests = await run(BRIEFING_READS.planRequests, { view: 'deciding' });
  result.planRequestsWaiting = requests.ok
    ? kindOf(
        listOf(requests.body, 'requests')
          .filter((one) => one.status === 'sent')
          .map((one) => ({
            owner: one.owner,
            unit: isRecord(one.unit) ? one.unit.name : null,
            subject: isRecord(one.subject) ? nameIn(one.subject.names, language) : null,
            quarter: one.quarter,
            lessons: Array.isArray(one.lessons) ? one.lessons.length : 0,
            reason: one.reason,
          })),
        linked('/plans/requests'),
      )
    : { error: requests.error };

  const completeness = await run(BRIEFING_READS.completeness, {});
  result.overduePlans = completeness.ok
    ? kindOf(
        listOf(completeness.body, 'plans')
          .filter((one) => one.flag === 'overdue')
          .map((one) => ({
            journalId: one.journalId,
            unit: isRecord(one.unit) ? one.unit.name : null,
            subject: isRecord(one.subject) ? nameIn(one.subject.names, language) : null,
            teacher: isRecord(one.teacher) ? one.teacher.name : null,
            lessonsWithoutTopic: one.empty,
          })),
        linked('/plans/reports'),
      )
    : { error: completeness.error };

  const warning = await run(BRIEFING_READS.earlyWarning, {});
  result.earlyWarning = warning.ok
    ? kindOf(
        listOf(warning.body, 'entries').map((one) => {
          const student = isRecord(one.student) ? one.student : {};
          return {
            studentId: student.id,
            student: [text(student.lastName), text(student.firstName)].join(' ').trim(),
            subject: isRecord(one.subject) ? nameIn(one.subject.names, language) : null,
            reasons: listOf(one, 'reasons').map((reason) => reason.kind),
          };
        }),
        linked('/results/early-warning'),
      )
    : { error: warning.error };

  return { result, links, found: [] };
}

/** One teacher the substitutes route offered, with what the ranking reads. */
export interface OfferedTeacher {
  id: string;
  name: string;
  group: 'subject' | 'department' | 'other';
  language: boolean;
  warnings: string[];
  /** Their lessons in the branch that date, not cancelled. */
  lessonsThatDay: number;
  /** A lesson of theirs in the branch that date ends at or before this lesson starts. */
  inBuilding: boolean;
}

const GROUP_ORDER = ['subject', 'department', 'other'] as const;

/**
 * The ranking (plan decision 6; `06`, Substitution: "Teachers who cannot teach in the class's
 * language are listed last and marked"; `02`, Helpers: "ranked"): the language-marked last of the
 * whole list, then the route's group, then fewest lessons that day, then already in the
 * building, then name. It orders the route's list: never adds a teacher, never drops one.
 */
export function rankSubstitutes(teachers: readonly OfferedTeacher[]): OfferedTeacher[] {
  return [...teachers].sort(
    (a, b) =>
      Number(a.language) - Number(b.language) ||
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      a.lessonsThatDay - b.lessonsThatDay ||
      Number(b.inBuilding) - Number(a.inBuilding) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

function addDays(date: string, days: number): string {
  const at = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The substitutes of an absence's lessons (plan decisions 6 and 7). */
export async function suggestSubstitutes(
  context: HelperContext,
  args: Record<string, unknown>,
): Promise<HelperOutcome> {
  const { language, today } = context;
  const absenceId = args.absenceId;
  const fromGiven = args.from;
  const toGiven = args.to;
  if (typeof absenceId !== 'string') return failed('absenceId is required');
  if (fromGiven !== undefined && (typeof fromGiven !== 'string' || !DATE.test(fromGiven))) {
    return failed('from is not a date');
  }
  if (toGiven !== undefined && (typeof toGiven !== 'string' || !DATE.test(toGiven))) {
    return failed('to is not a date');
  }
  const from = typeof fromGiven === 'string' && fromGiven > today ? fromGiven : today;
  const last = addDays(from, SUBSTITUTE_DAYS - 1);
  const to = typeof toGiven === 'string' && toGiven < last ? toGiven : last;
  const read = await context.read(SUBSTITUTE_READS.lessons, { id: absenceId });
  if (!read.ok) return { result: { error: read.error }, links: [], found: [] };
  const all = listOf(read.body, 'lessons').filter((one) => one.substitute === null);
  const lessons = all.filter((one) => text(one.date) >= from && text(one.date) <= to);
  const laterLessons = all.filter((one) => text(one.date) > to).length;
  // One read of the branch's day per date, for the lessons of each teacher that day.
  const days = new Map<string, Record<string, unknown>[] | string>();
  for (const date of [...new Set(lessons.map((one) => text(one.date)))].sort()) {
    const day = await context.read(SUBSTITUTE_READS.day, { date, span: 'day' });
    days.set(date, day.ok ? listOf(day.body, 'lessons') : day.error);
  }
  const out: Record<string, unknown>[] = [];
  for (const lesson of lessons) {
    const date = text(lesson.date);
    const start = typeof lesson.start === 'number' ? lesson.start : 0;
    const offered = await context.read(SUBSTITUTE_READS.substitutes, { id: lesson.id });
    const head = {
      lessonId: lesson.id,
      date,
      time: `${clockOf(lesson.start)}–${clockOf(lesson.end)}`,
      unit: lesson.unit,
      subject: nameIn(lesson.subject, language),
    };
    if (!offered.ok) {
      out.push({ ...head, error: offered.error });
      continue;
    }
    const day = days.get(date);
    const dayLessons = Array.isArray(day) ? day : [];
    const teachers = listOf(offered.body, 'teachers').map((one): OfferedTeacher => {
      const own = dayLessons.filter(
        (other) =>
          isRecord(other.teacher) && other.teacher.id === one.id && other.cancelCause === null,
      );
      return {
        id: text(one.id),
        name: text(one.name),
        group: GROUP_ORDER.includes(one.group as OfferedTeacher['group'])
          ? (one.group as OfferedTeacher['group'])
          : 'other',
        language: one.language === true,
        warnings: Array.isArray(one.warnings)
          ? one.warnings.filter((w) => typeof w === 'string')
          : [],
        lessonsThatDay: own.length,
        inBuilding: own.some((other) => typeof other.end === 'number' && other.end <= start),
      };
    });
    const ranked = rankSubstitutes(teachers);
    out.push({
      ...head,
      noSubjectTeacherFree: isRecord(offered.body) && offered.body.noSubjectTeacherFree === true,
      ...(typeof day === 'string' ? { dayNotRead: day } : {}),
      teachers: ranked.slice(0, SUBSTITUTES_NAMED),
      ...(ranked.length > SUBSTITUTES_NAMED
        ? { moreTeachers: ranked.length - SUBSTITUTES_NAMED }
        : {}),
    });
  }
  const link = pageLink(context.role, '/timetable/absences', { search: { open: absenceId } });
  return {
    result: {
      from,
      to,
      lessons: out,
      ...(laterLessons > 0 ? { lessonsAfterTo: laterLessons } : {}),
      note:
        out.length === 0
          ? 'No lesson of the absence needs a substitute in these dates.'
          : 'A teacher with warnings (noSubjectTeacherFree) needs the person to accept them: name the warnings in the proposal.',
    },
    links: link === undefined ? [] : [link],
    found: [SUBSTITUTE_CHANGE],
    ...(laterLessons > 0 ? { cut: true } : {}),
  };
}

function failed(detail: string): HelperOutcome {
  return { result: { error: 'invalid_arguments', detail }, links: [], found: [] };
}

/** The next N empty rows of an own plan (plan decision 8). */
export async function draftPlanUnit(
  context: HelperContext,
  args: Record<string, unknown>,
): Promise<HelperOutcome> {
  const { journalId, quarterId, count, fromNumber } = args;
  if (typeof journalId !== 'string') return failed('journalId is required');
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    return failed('count is not a whole number from 1');
  }
  if (
    fromNumber !== undefined &&
    (typeof fromNumber !== 'number' || !Number.isInteger(fromNumber))
  ) {
    return failed('fromNumber is not a whole number');
  }
  const read = await context.read(UNIT_READS.plan, {
    journalId,
    ...(typeof quarterId === 'string' ? { quarterId } : {}),
  });
  if (!read.ok) return { result: { error: read.error }, links: [], found: [] };
  const plan = isRecord(read.body) ? read.body : {};
  const window = isRecord(plan.window) ? plan.window : {};
  const start = typeof fromNumber === 'number' ? fromNumber : 1;
  const empty = listOf(plan, 'rows').filter(
    (row) => row.item === null && typeof row.number === 'number' && row.number >= start,
  );
  const writable = empty.filter((row) => row.open !== 'none');
  const fits = Math.max(0, Math.min(count, context.stepsLeft()));
  const rows = writable.slice(0, fits).map((row) => ({
    position: row.number,
    lessonId: row.lessonId,
    date: row.date,
    open: row.open,
  }));
  const cut = Math.min(count, writable.length) > rows.length;
  const link = pageLink(context.role, '/plans/$journalId', { params: { journalId } });
  return {
    result: {
      journalId,
      quarterId: plan.quarterId,
      unit: isRecord(plan.unit) ? plan.unit.name : null,
      subject: isRecord(plan.subject) ? nameIn(plan.subject.names, context.language) : null,
      canEdit: plan.canEdit === true,
      window: { state: window.state, endDate: window.endDate ?? null, off: window.off === true },
      rows,
      asked: count,
      ...(writable.length < count
        ? { emptyRowsOpen: writable.length, emptyRowsClosed: empty.length - writable.length }
        : {}),
      ...(cut ? { cut: Math.min(count, writable.length) - rows.length } : {}),
      note:
        plan.canEdit !== true
          ? 'The person cannot write this plan.'
          : rows.length === 0
            ? 'No empty row may be written now; outside the window an edit request opens rows.'
            : 'Propose one item per row with the quarterId, position and lessonId given, in this answer.',
    },
    links: link === undefined ? [] : [link],
    found: plan.canEdit === true && rows.length > 0 ? [ITEM_CHANGE] : [],
    ...(cut ? { cut: true } : {}),
  };
}

/** The numbers of a value's strings and numbers, for the figure check; ids are left out. */
function figuresIn(value: unknown, into: Set<string>, key = ''): void {
  if (typeof value === 'number') {
    into.add(normalFigure(String(value)));
    return;
  }
  if (typeof value === 'string') {
    if (/id$/i.test(key) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) return;
    for (const figure of figuresOf(value)) into.add(figure);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) figuresIn(item, into, key);
    return;
  }
  if (isRecord(value)) {
    for (const [name, item] of Object.entries(value)) figuresIn(item, into, name);
  }
}

/** A figure as compared: a comma as the decimal point, no leading zeros, no trailing zero decimals. */
function normalFigure(figure: string): string {
  const [whole = '', fraction] = figure.replace(',', '.').split('.');
  const wholePart = whole.replace(/^0+(?=\d)/, '');
  const fractionPart = fraction?.replace(/0+$/, '') ?? '';
  return fractionPart === '' ? wholePart : `${wholePart}.${fractionPart}`;
}

/**
 * The figures written in a text (plan decision 9, review correction 3): whole numbers and decimals
 * with a point or a comma ("82,5"), with a percent sign attached or apart ("82%", "82 %"). A
 * digit is never skipped: "82.5" is the figure 82.5, never 82 and 5.
 */
export function figuresOf(value: string): string[] {
  return [...value.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => normalFigure(match[0]));
}

/** The figures of an answer that are in no allowed figure (the breakdown, the person's words). */
export function figuresOutsideBreakdown(answer: string, allowed: ReadonlySet<string>): string[] {
  return [...new Set(figuresOf(answer).filter((figure) => !allowed.has(figure)))];
}

/** The figures of the person's own words, allowed in the answer. */
export function figuresOfWords(words: string): Set<string> {
  return new Set(figuresOf(words));
}

/** The breakdown of a student's subject and quarter, as the platform returns it (plan decision 1). */
export async function explainResult(
  context: HelperContext,
  args: Record<string, unknown>,
): Promise<HelperOutcome> {
  const { studentId, subjectId, quarterId } = args;
  if (typeof studentId !== 'string') return failed('studentId is required');
  if (typeof subjectId !== 'string') return failed('subjectId is required');
  const results = await context.read(EXPLAIN_READS.results, { id: studentId });
  if (!results.ok) return { result: { error: results.error }, links: [], found: [] };
  const subject = listOf(results.body, 'subjects').find(
    (one) => isRecord(one.subject) && one.subject.id === subjectId,
  );
  if (subject === undefined) {
    // "only the subjects the reader reads whole": not open, or no graded quarter.
    return {
      result: {
        error: 'not_open',
        note: 'The platform gives this person no result of this subject for this student.',
      },
      links: [],
      found: [],
    };
  }
  const quarters = listOf(results.body, 'quarters');
  const rows = listOf(subject, 'quarters');
  const row =
    typeof quarterId === 'string'
      ? rows.find((one) => one.quarterId === quarterId)
      : ([...rows]
          .reverse()
          .find((one) => isRecord(one.outcome) && one.outcome.kind === 'number') ?? rows.at(-1));
  if (row === undefined) {
    return {
      result: { error: 'no_result', note: 'No result of this quarter.' },
      links: [],
      found: [],
    };
  }
  const quarter = quarters.find((one) => one.id === row.quarterId);
  const unit = isRecord(row.unit) ? row.unit : {};
  const journalId = typeof unit.journalId === 'string' ? unit.journalId : undefined;
  const trace = await context.read(EXPLAIN_READS.lessons, {
    id: studentId,
    subjectId,
    quarterId: row.quarterId,
  });
  let weights: unknown = null;
  let weightsNote: string | undefined;
  if (journalId !== undefined && Object.hasOwn(context.lines, EXPLAIN_READS.journal)) {
    const journal = await context.read(EXPLAIN_READS.journal, {
      journalId,
      quarterId: row.quarterId,
    });
    if (journal.ok && isRecord(journal.body) && isRecord(journal.body.legend)) {
      weights = journal.body.legend.quarterly ?? null;
    } else {
      weightsNote = journal.ok ? 'no_weights' : journal.error;
    }
  } else {
    weightsNote = 'not_read';
  }
  const works = (kind: 'classworks' | 'homeworks') =>
    trace.ok
      ? listOf(trace.body, 'lessons')
          .flatMap((lesson) =>
            listOf(lesson, kind).map((work) => ({
              date: lesson.date,
              title: work.title,
              score: work.score,
              total: work.total,
              percent: work.percent,
            })),
          )
          .slice(0, EXPLAIN_WORKS)
      : [];
  const breakdown = {
    subject: isRecord(subject.subject) ? nameIn(subject.subject.names, context.language) : null,
    quarter: quarter === undefined ? null : { number: quarter.number, closed: quarter.closed },
    unit: unit.name ?? null,
    averages: {
      attendance: row.attendance,
      classwork: row.classwork,
      homework: row.homework,
      ratingExam: row.ratingShown === true ? row.ratingExam : 'not_in_this_quarter',
    },
    weights: weights ?? { note: weightsNote ?? 'none' },
    outcome: row.outcome,
    basedOn: row.basedOn,
    classworks: works('classworks'),
    homeworks: works('homeworks'),
    attendanceMarks: trace.ok
      ? listOf(trace.body, 'lessons').map((lesson) => ({
          date: lesson.date,
          value: lesson.attendanceValue,
        }))
      : { error: trace.ok ? null : trace.error },
    ratingExamEntry: trace.ok && isRecord(trace.body) ? (trace.body.ratingExam ?? null) : null,
  };
  const figures = new Set<string>();
  figuresIn(breakdown, figures);
  const link =
    journalId === undefined
      ? undefined
      : pageLink(context.role, '/journal/$journalId', { params: { journalId } });
  return {
    result: breakdown,
    links: link === undefined ? [] : [link],
    found: [],
    figures,
  };
}

/** Runs a helper by its tool name. */
export function runHelper(
  name: string,
  context: HelperContext,
  args: Record<string, unknown>,
): Promise<HelperOutcome> {
  switch (name) {
    case TODAYS_BRIEFING:
      return todaysBriefing(context);
    case SUGGEST_SUBSTITUTES:
      return suggestSubstitutes(context, args);
    case DRAFT_PLAN_UNIT:
      return draftPlanUnit(context, args);
    default:
      return explainResult(context, args);
  }
}
